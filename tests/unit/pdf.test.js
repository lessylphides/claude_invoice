// PDF 인식: 쪽수 세기(압축된 PDF 포함), 사진 2장·PDF 2쪽마다 1회, 서버가 직접 세서 기록
import { describe, it, expect } from 'vitest';
import { deflateSync } from 'node:zlib';
import { countPdfPages, ocrUnits, b64ToBytes, MAX_PAGES } from '../../src/lib/pdfPages.js';
import { validateOcrInput, buildOcrRequest } from '../../src/lib/ocrRequest.js';
import { overLimit } from '../../src/worker/billing.js';
import { handleOcr } from '../../src/worker/ocr.js';

const enc = (s) => new TextEncoder().encode(s);
const cat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) out.set(p, (o += p.length) - p.length);
  return out;
};
/** 평범한 PDF: 쪽 정보가 그대로 보임 */
const plainPdf = (n) =>
  enc(
    `%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [${Array.from({ length: n }, (_, i) => `${3 + i} 0 R`).join(' ')}] /Count ${n} >> endobj\n` +
      Array.from({ length: n }, (_, i) => `${3 + i} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >> endobj\n`).join('') +
      '%%EOF',
  );
/** 쪽 정보가 압축된 묶음(object stream) 안에만 있는 PDF */
const compressedPdf = (n) => {
  const inner = enc(
    `<< /Type /Pages /Kids [] /Count ${n} >> ` + Array.from({ length: n }, () => '<< /Type /Page /Parent 2 0 R >>').join(' '),
  );
  const z = deflateSync(inner);
  return cat(enc(`%PDF-1.7\n5 0 obj << /Type /ObjStm /N ${n + 1} /First 10 /Filter /FlateDecode /Length ${z.length} >>\nstream\n`), z, enc('\nendstream\nendobj\n%%EOF'));
};
const b64 = (bytes) => Buffer.from(bytes).toString('base64');

describe('PDF 쪽수', () => {
  it('평범한 PDF와 압축된 PDF 모두 셈, PDF 가 아니면 0', async () => {
    expect(await countPdfPages(plainPdf(1))).toBe(1);
    expect(await countPdfPages(plainPdf(3))).toBe(3);
    expect(await countPdfPages(compressedPdf(4))).toBe(4);
    expect(await countPdfPages(enc('hello'))).toBe(0);
    expect(await countPdfPages(b64ToBytes(b64(plainPdf(2))))).toBe(2);
  });

  it('사진 2장·PDF 2쪽마다 1회', () => {
    expect([1, 2, 3, 4, 5, 6].map(ocrUnits)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(MAX_PAGES).toBe(6);
  });

  it('한도: 남은 횟수가 이번에 쓸 횟수보다 적으면 못 함', () => {
    const trial = { kind: 'trial', total: 20, day: 10, month: null };
    expect(overLimit(trial, { day: 0, month: 0, total: 19, period: 0 }, 1)).toBeNull();
    expect(overLimit(trial, { day: 0, month: 0, total: 19, period: 0 }, 2).code).toBe('trial_used');
    expect(overLimit(trial, { day: 0, month: 0, total: 18, period: 0 }, 2)).toBeNull();
  });

  it('요청: PDF 는 문서로 보내고, 사진과 섞을 수 없음', () => {
    const pdf = b64(plainPdf(2));
    const input = validateOcrInput({ pdf, categories: ['기타'] });
    const req = buildOcrRequest({ ...input, pages: 2 }, { model: 'claude-opus-5-5', today: '2026-11-12' });
    expect(req.messages[0].content[0]).toEqual({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf } });
    expect(req.messages[0].content.at(-1).text).toContain('PDF(2쪽)');
    expect(() => validateOcrInput({ pdf, images: ['iVBORw0KGgo='], categories: ['기타'] })).toThrow(/따로/);
  });
});

describe('서버: PDF 인식', () => {
  const UID = '11111111-2222-3333-4444-555555555555';
  function fake(usage = { day: 0, month: 0, total: 0, period: 0, account: { suspended: false, bonus: 0 } }) {
    const calls = [];
    let sent = null;
    const fetchImpl = async (url, init = {}) => {
      const u = String(url);
      const j = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
      calls.push(new URL(u).pathname);
      if (u.endsWith('/auth/v1/user')) return j({ id: UID, email: 'a@b.c' });
      if (u.endsWith('/rpc/ocr_usage_now')) return j(usage);
      if (u.endsWith('/rpc/record_ocr_use')) return new Response(null, { status: 204 });
      if (u.includes('api.anthropic.com')) {
        sent = JSON.parse(init.body);
        return j({ id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_details: null, usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: JSON.stringify({ documentType: '거래명세서', date: '2026-11-12', vendor: 'x', paymentHint: 'tax', items: [], total: 0 }) }] });
      }
      throw new Error(`unexpected ${u}`);
    };
    return { fetchImpl, calls, sent: () => sent };
  }
  const ocr = (body, f) =>
    handleOcr(new Request('https://app.costnote.co.kr/api/ocr', { method: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify(body) }), { ANTHROPIC_API_KEY: 'sk' }, { fetchImpl: f.fetchImpl, now: Date.UTC(2026, 10, 12) });

  it('3쪽 PDF → 2회로 기록, 클로드에 문서로 보냄', async () => {
    const f = fake();
    const res = await ocr({ pdf: b64(compressedPdf(3)), categories: ['기타'] }, f);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.units).toBe(2);
    expect(j.usage.day).toBe(2);
    expect(f.calls.filter((c) => c.endsWith('/record_ocr_use'))).toHaveLength(2);
    expect(f.sent().messages[0].content[0].type).toBe('document');
  });

  it('7쪽 PDF·쪽수를 셀 수 없는 PDF는 인식 전에 거절 (AI 비용 없음)', async () => {
    const f = fake();
    const r7 = await ocr({ pdf: b64(plainPdf(7)), categories: ['기타'] }, f);
    expect(r7.status).toBe(400);
    expect((await r7.json()).error.message).toContain('6쪽까지');
    const bad = await ocr({ pdf: b64(enc('%PDF-1.4 nothing here')), categories: ['기타'] }, f);
    expect((await bad.json()).error.code).toBe('bad_pdf');
    expect(f.calls.some((c) => c.includes('messages'))).toBe(false);
  });

  it('사진 4장 → 2회, 남은 횟수가 1회뿐이면 알아듣기 쉬운 말로 거절', async () => {
    const img = 'iVBORw0KGgo=';
    const ok = fake();
    const r = await ocr({ images: [img, img, img, img], categories: ['기타'] }, ok);
    expect((await r.json()).units).toBe(2);
    // 시범 운영(legacy) 하루 한도 30 중 29회 사용
    const low = fake({ day: 29, month: 29, total: 29, period: 0, account: { suspended: false, bonus: 0 } });
    const r2 = await ocr({ images: [img, img, img], categories: ['기타'] }, low);
    expect(r2.status).toBe(429);
    expect((await r2.json()).error.message).toContain('사진 3장은 인식 2회');
  });
});
