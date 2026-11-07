// 서버 영수증 인식(/api/ocr): 로그인·사용 한도·입력 확인·Claude 호출·오류 안내
import { describe, it, expect } from 'vitest';
import { handleOcr } from '../../src/worker/ocr.js';
import { validateOcrInput, buildOcrRequest, kstToday } from '../../src/lib/ocrRequest.js';

const IMG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
const body = { images: [IMG], categories: ['채소·과일', '기타'], knownVendors: ['가락청과'] };
const env = { ANTHROPIC_API_KEY: 'sk-test', OCR_DAILY_LIMIT: '30', OCR_MONTHLY_LIMIT: '300' };
const RESULT = { documentType: '영수증', date: '2026-11-04', vendor: '가락청과', paymentHint: 'card', items: [], total: 0 };

/** 가짜 Supabase·Anthropic. calls 에 부른 주소가 쌓임 */
function fakeFetch({ user = true, usage = { day: 0, month: 0 }, claude = null } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    const j = (status, b) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (u.endsWith('/auth/v1/user')) return user ? j(200, { id: 'u1' }) : j(401, { msg: 'bad jwt' });
    if (u.endsWith('/rpc/ocr_usage_now')) return j(200, usage);
    if (u.endsWith('/rpc/record_ocr_use')) return new Response(null, { status: 204 });
    if (u.includes('api.anthropic.com')) {
      if (claude) return claude(JSON.parse(init.body));
      return j(200, {
        id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_details: null,
        usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: JSON.stringify(RESULT) }],
      });
    }
    throw new Error(`unexpected ${u}`);
  };
  return { fetchImpl, calls };
}
const req = (b = body, token = 'jwt') =>
  new Request('https://app.costnote.co.kr/api/ocr', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(b),
  });
const read = async (res) => ({ status: res.status, body: await res.json() });

describe('서버 영수증 인식', () => {
  it('정상: 로그인 확인 → 사용량 확인 → Claude → 사용 기록, 결과와 사용량을 돌려줌', async () => {
    const f = fakeFetch({ usage: { day: 2, month: 10 } });
    const r = await read(await handleOcr(req(), env, f));
    expect(r.status).toBe(200);
    expect(r.body.result).toEqual(RESULT);
    expect(r.body.usage).toEqual({ day: 3, month: 11 });
    expect(r.body.limits).toEqual({ day: 30, month: 300 });
    expect(f.calls.map((c) => new URL(c.url).pathname)).toEqual(['/auth/v1/user', '/rest/v1/rpc/ocr_usage_now', '/v1/messages', '/rest/v1/rpc/record_ocr_use']);
    // Supabase 는 사용자 본인 토큰으로, Claude 는 서버 키로
    expect(f.calls[0].init.headers.authorization).toBe('Bearer jwt');
    const claude = f.calls[2];
    const h = new Headers(claude.init.headers);
    expect(h.get('x-api-key') ?? h.get('authorization')).toMatch(/sk-test$/); // 서버 키 (사용자 토큰이 아님)
    const sent = JSON.parse(claude.init.body);
    expect(sent.model).toBe('claude-opus-5-5');
    expect(sent.messages[0].content[0]).toMatchObject({ type: 'image', source: { data: IMG } });
    expect(sent.output_config.format.schema.properties.items.items.properties.category.enum).toEqual(['채소·과일', '기타']);
  });

  it('로그인 안 했거나 만료되면 401, Claude 는 부르지 않음', async () => {
    let f = fakeFetch();
    expect((await read(await handleOcr(req(body, null), env, f))).status).toBe(401);
    f = fakeFetch({ user: false });
    const r = await read(await handleOcr(req(), env, f));
    expect(r.status).toBe(401);
    expect(r.body.error.message).toContain('다시 로그인');
    expect(f.calls.some((c) => c.url.includes('anthropic'))).toBe(false);
  });

  it('하루·한 달 한도를 넘으면 429, Claude 는 부르지 않음', async () => {
    let f = fakeFetch({ usage: { day: 30, month: 30 } });
    let r = await read(await handleOcr(req(), env, f));
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe('daily_limit');
    f = fakeFetch({ usage: { day: 1, month: 300 } });
    r = await read(await handleOcr(req(), env, f));
    expect(r.body.error.code).toBe('monthly_limit');
    expect(f.calls.some((c) => c.url.includes('anthropic'))).toBe(false);
  });

  it('이상한 입력은 400 (사진 없음, 너무 많음, 형식 오류)', async () => {
    const f = fakeFetch();
    expect((await read(await handleOcr(req({ ...body, images: [] }), env, f))).body.error.message).toBe('사진이 없습니다.');
    expect((await read(await handleOcr(req({ ...body, images: Array(7).fill(IMG) }), env, f))).status).toBe(400);
    expect((await read(await handleOcr(req({ ...body, images: ['<script>'] }), env, f))).body.error.message).toBe('사진 형식이 올바르지 않습니다.');
  });

  it('Anthropic 크레딧 소진은 관리자용 안내로, 사용량은 기록하지 않음', async () => {
    const f = fakeFetch({
      claude: () =>
        new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } }), {
          status: 400, headers: { 'content-type': 'application/json' },
        }),
    });
    const r = await read(await handleOcr(req(), env, f));
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('billing');
    expect(f.calls.some((c) => c.url.endsWith('record_ocr_use'))).toBe(false);
  });

  it('서버에 Anthropic 키가 없으면 준비 안 됨 안내', async () => {
    const r = await read(await handleOcr(req(), { ...env, ANTHROPIC_API_KEY: '' }, fakeFetch()));
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('not_configured');
  });
});

describe('인식 요청 만들기', () => {
  it('여러 장이면 사진 번호를 붙이고 한 건으로 합치라고 함, 분류·거래처 정리', () => {
    const input = validateOcrInput({ images: [IMG, IMG], categories: [' 기타 ', '기타', ''], knownVendors: ['가락청과', 3] });
    expect(input.categories).toEqual(['기타']);
    expect(input.knownVendors).toEqual(['가락청과']);
    const r = buildOcrRequest(input, { model: 'claude-haiku-5-5', today: '2026-11-04' });
    expect(r.betas).toBeUndefined(); // haiku 는 대체 모델 기능 없이
    expect(r.messages[0].content.filter((c) => c.type === 'text')[0].text).toBe('사진 1/2');
    expect(r.messages[0].content.at(-1).text).toContain('오늘 날짜: 2026-11-04');
    expect(r.messages[0].content.at(-1).text).toContain('2장은 영수증');
  });
  it('한국 시간 기준 오늘', () => {
    expect(kstToday(Date.parse('2026-11-04T16:00:00Z'))).toBe('2026-11-05');
  });
});
