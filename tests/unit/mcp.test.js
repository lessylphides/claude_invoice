// 클로드 연결(MCP 커넥터): 로그인(OAuth) → 허락 → 토큰 → 도구 사용까지 클로드가 하는 그대로
import { describe, it, expect, beforeEach } from 'vitest';
import { makeProvider, MCP_URL } from '../../src/worker/mcp/provider.js';
import { handleAuthorize } from '../../src/worker/mcp/authorize.js';
import { handleAiChanges } from '../../src/worker/mcp/changes.js';
import { overview, listMenus, setMenuPrice, createCategory, moveMenu, undoChange, findMenu } from '../../src/worker/mcp/tools.js';
import { migrate } from '../../src/lib/model.js';

const UID = '11111111-2222-3333-4444-555555555555';
const OTHER = '99999999-2222-3333-4444-555555555555';
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const ORIGIN = 'https://app.costnote.co.kr';

/** 메모리 KV (OAuth 라이브러리·변경 기록용) */
function memKV() {
  const m = new Map();
  return {
    m,
    async get(k, opt) {
      if (!m.has(k)) return null;
      const v = m.get(k);
      return opt === 'json' || opt?.type === 'json' ? JSON.parse(v) : v;
    },
    async put(k, v) {
      m.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    },
    async delete(k) {
      m.delete(k);
    },
    async list({ prefix = '', limit = 1000 } = {}) {
      const keys = [...m.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit).map((name) => ({ name }));
      return { keys, list_complete: true, cursor: '' };
    },
  };
}

const ledger0 = () =>
  migrate(
    {
      purchases: [
        { id: 'p1', date: '2026-11-01', vendor: '서광컴퍼니', payType: 'tax', items: [{ name: '어벨라워 아부나흐 700ml', qty: 1, unitPrice: 140000, amount: 140000, packSize: 700, packUnit: 'ml' }] },
        { id: 'p2', date: '2026-11-04', vendor: '서광컴퍼니', payType: 'tax', items: [{ name: '어벨라워 아부나흐 700ml', qty: 1, unitPrice: 154000, amount: 154000, packSize: 700, packUnit: 'ml' }] },
      ],
      menus: [{ id: 'm1', name: '어벨라워 아부나흐', category: '위스키', price: 33000, bottlePrice: 450000, ingredients: [{ id: 'g1', type: 'item', itemName: '어벨라워 아부나흐 700ml', packSize: 700, unit: 'ml', use: 45 }] }],
      minMargins: { 위스키: [{ value: 16000, bottle: 150000, at: '2026-11-06' }] },
    },
    { trusted: false },
  );

/** Supabase 흉내: 로그인 확인 + 장부 함수 (번호가 맞을 때만 저장) */
function fakeSupabase(rows) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    const j = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
    if (u.endsWith('/auth/v1/user')) {
      const tok = (init.headers?.authorization || '').replace('Bearer ', '');
      return tok === 'sb-token' ? j({ id: UID, email: 'owner@example.com' }) : tok === 'sb-other' ? j({ id: OTHER, email: 'o@x.c' }) : j({}, 401);
    }
    if (u.includes('/rpc/mcp_ledger_get')) {
      const b = JSON.parse(init.body);
      calls.push(['get', b.uid]);
      if (b.secret !== 'sek') return j({ message: 'forbidden' }, 400);
      const r = rows.get(b.uid);
      return j(r ? { rev: r.rev, data: JSON.parse(JSON.stringify(r.data)) } : null);
    }
    if (u.includes('/rpc/mcp_ledger_put')) {
      const b = JSON.parse(init.body);
      calls.push(['put', b.uid, b.expected]);
      const r = rows.get(b.uid);
      if (!r || r.rev !== b.expected) return j(null);
      rows.set(b.uid, { rev: r.rev + 1, data: b.payload });
      return j(r.rev + 1);
    }
    throw new Error(`unexpected ${u}`);
  };
  return { fetchImpl, calls };
}

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('도구 (장부 계산)', () => {
  it('메뉴 원가: 최근 단가로 잔·보틀 원가율, 목표·최소 마진 맞추는 가격', () => {
    const d = ledger0();
    const r = listMenus(d, { category: '위스키' });
    const m = r.menus[0];
    expect(m.glass).toMatchObject({ price: 33000, cost: 9900, cost_rate_percent: 30, margin: 23100, min_margin: 16000, price_for_target_rate: 39600, price_for_min_margin: 25900 });
    expect(m.glass.status).toBe('원가율은 넘지만 최소 마진 충족');
    expect(m.bottle).toMatchObject({ price: 450000, cost: 154000, min_margin: 150000 });
    expect(m.ingredients[0]).toMatchObject({ latest_unit_price: 154000, previous_unit_price: 140000, use_per_serving: 45 });
    expect(overview(d).menu_categories.find((c) => c.name === '위스키')).toMatchObject({ menus: 1, min_margin_glass: 16000, min_margin_bottle: 150000 });
  });

  it('판매가·분류 바꾸기와 되돌리기 (그 사이 다시 바뀌었으면 건드리지 않음)', () => {
    const d = ledger0();
    const p = setMenuPrice(d, { menu: '어벨라워아부나흐', price: 36000 });
    expect(p.changes).toEqual([expect.objectContaining({ field: 'price', before: 33000, after: 36000 })]);
    expect(p.menu.glass.cost_rate_percent).toBe(27.5);
    const c = createCategory(d, { name: '하이볼' });
    const mv = moveMenu(d, { menu: 'm1', category: '하이볼' });
    expect(d.menus[0].category).toBe('하이볼');
    expect(() => createCategory(d, { name: '하이볼' })).toThrow(/이미/);
    expect(() => moveMenu(d, { menu: 'm1', category: '없는분류' })).toThrow(/없어요/);
    expect(() => findMenu(d, '라떼')).toThrow(/찾지 못했어요/);
    // 분류 만들기는 메뉴가 있으면 되돌리지 않음 → 메뉴부터 되돌리면 됨
    expect(undoChange(d, c.changes[0]).ok).toBe(false);
    expect(undoChange(d, mv.changes[0]).ok).toBe(true);
    expect(undoChange(d, c.changes[0]).ok).toBe(true);
    expect(d.menuCategories).not.toContain('하이볼');
    d.menus[0].price = 35000; // 사장님이 앱에서 또 바꿈
    expect(undoChange(d, p.changes[0])).toMatchObject({ ok: false });
    expect(d.menus[0].price).toBe(35000);
  });
});

describe('클로드 연결: 로그인부터 도구까지', () => {
  let env, rows, sb, provider, ctx;
  beforeEach(() => {
    rows = new Map([
      [UID, { rev: 5, data: ledger0() }],
      [OTHER, { rev: 1, data: migrate({ menus: [{ id: 'x', name: '남의 메뉴', price: 1000 }] }) }],
    ]);
    sb = fakeSupabase(rows);
    env = { OAUTH_KV: memKV(), BILLING: memKV(), BACKUP_SECRET: 'sek' };
    const app = {
      fetch: (request, e) => {
        const p = new URL(request.url).pathname;
        if (p === '/oauth/authorize') return handleAuthorize(request, e, { fetchImpl: sb.fetchImpl });
        if (p.startsWith('/api/ai-changes')) return handleAiChanges(request, e, { fetchImpl: sb.fetchImpl });
        return new Response('app');
      },
    };
    provider = makeProvider(app, { fetchImpl: sb.fetchImpl });
    ctx = { waitUntil() {}, passThroughOnException() {}, props: {} };
  });
  const call = (url, init) => provider.fetch(new Request(url.startsWith('http') ? url : `${ORIGIN}${url}`, init), env, ctx);

  /** 클로드가 하는 그대로: 등록 → 허락 화면 → 허락 → 토큰 */
  async function connect(sbToken = 'sb-token', decision = 'approve') {
    const reg = await call('/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'Claude', redirect_uris: [CALLBACK], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }),
    });
    expect(reg.status).toBe(201);
    const { client_id } = await reg.json();
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const q = new URLSearchParams({ response_type: 'code', client_id, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: 'S256', state: 'st8', scope: 'costnote offline_access', resource: MCP_URL });
    const pageRes = await call(`/oauth/authorize?${q}`);
    expect(pageRes.status).toBe(200);
    const html = await pageRes.text();
    expect(html).toContain('코스트노트 · 클로드 연결');
    expect(html).toContain('claude.ai');
    expect(pageRes.headers.get('content-security-policy')).toMatch(/script-src 'nonce-/);
    const handle = html.match(/name="handle" value="([^"]+)"/)[1];
    const cookie = (pageRes.headers.getSetCookie?.() ?? [pageRes.headers.get('set-cookie')]).map((c) => c.split(';')[0]).join('; ');
    const form = new URLSearchParams({ handle, token: sbToken, decision });
    for (const s of html.matchAll(/name="scope" value="([^"]+)"/g)) form.append('scope', s[1]);
    const post = await call(`/oauth/authorize?${q}`, { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', origin: ORIGIN }, body: form });
    return { post, client_id, verifier };
  }

  async function token() {
    const { post, client_id, verifier } = await connect();
    expect(post.status).toBe(302);
    const loc = new URL(post.headers.get('location'));
    expect(loc.origin + loc.pathname).toBe(CALLBACK);
    expect(loc.searchParams.get('state')).toBe('st8');
    const res = await call('/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: loc.searchParams.get('code'), redirect_uri: CALLBACK, client_id, code_verifier: verifier, resource: MCP_URL }),
    });
    expect(res.status).toBe(200);
    const t = await res.json();
    expect(t.refresh_token).toBeTruthy();
    return t.access_token;
  }

  let id = 0;
  const rpc = (tok, method, params = {}) =>
    call('/mcp', {
      method: 'POST',
      headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
    }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const tool = async (tok, name, args = {}) => {
    const r = await rpc(tok, 'tools/call', { name, arguments: args });
    const c = r.body.result;
    return { isError: !!c.isError, data: c.isError ? c.content[0].text : JSON.parse(c.content[0].text) };
  };

  it('로그인 없이 /mcp 를 부르면 401 + 로그인 안내(메타데이터 주소)', async () => {
    const r = await call('/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(r.status).toBe(401);
    expect(r.headers.get('www-authenticate')).toMatch(/resource_metadata="https:\/\/app\.costnote\.co\.kr\/\.well-known\/oauth-protected-resource/);
    const meta = await (await call('/.well-known/oauth-protected-resource/mcp')).json();
    expect(meta).toMatchObject({ resource: MCP_URL, authorization_servers: [ORIGIN] });
    const as = await (await call('/.well-known/oauth-authorization-server')).json();
    expect(as.code_challenge_methods_supported).toContain('S256');
    expect(as.registration_endpoint).toBe(`${ORIGIN}/oauth/register`);
  });

  it('거절하면 클로드에 access_denied, 로그인 토큰이 틀리면 연결 안 됨', async () => {
    const d = await connect('sb-token', 'deny');
    expect(new URL(d.post.headers.get('location')).searchParams.get('error')).toBe('access_denied');
    const bad = await connect('wrong');
    expect(bad.post.status).toBe(400);
  });

  it('도구: 목록 → 메뉴 읽기 → 판매가 입력 → 기록 → 앱에서 되돌리기', async () => {
    const tok = await token();
    const init = await rpc(tok, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude', version: '1' } });
    expect(init.body.result.serverInfo.name).toBe('costnote');
    expect(init.body.result.instructions).toContain('코스트노트');
    const list = await rpc(tok, 'tools/list');
    const names = list.body.result.tools.map((t) => t.name);
    expect(names).toEqual(['get_cost_overview', 'list_menus', 'search_purchases', 'get_item_price_history', 'set_menu_price', 'create_menu_category', 'move_menu_to_category']);
    expect(list.body.result.tools.find((t) => t.name === 'list_menus').annotations.readOnlyHint).toBe(true);

    const menus = await tool(tok, 'list_menus', { category: '위스키' });
    expect(menus.data.menus[0].glass.cost).toBe(9900);
    expect(sb.calls.every((c) => c[1] === UID)).toBe(true); // 다른 사장님 장부는 절대 안 건드림

    const hist = await tool(tok, 'get_item_price_history', { item: '어벨라워 아부나흐 700ml' });
    expect(hist.data.history.map((h) => h.net_unit_price)).toEqual([154000, 140000]);

    const set = await tool(tok, 'set_menu_price', { menu: '어벨라워 아부나흐', price: 36000 });
    expect(set.isError).toBe(false);
    expect(set.data.changed).toEqual([expect.objectContaining({ field: '잔 판매가', before: 33000, after: 36000 })]);
    expect(rows.get(UID).rev).toBe(6);
    expect(rows.get(UID).data.menus[0].price).toBe(36000);

    const missing = await tool(tok, 'set_menu_price', { menu: '라떼', price: 5000 });
    expect(missing.isError).toBe(true);
    expect(missing.data).toContain('찾지 못했어요');

    // 앱: 클로드가 바꾼 기록 보기 → 되돌리기
    const auth = { authorization: 'Bearer sb-token' };
    const log = await (await call('/api/ai-changes', { headers: auth })).json();
    expect(log.changes[0]).toMatchObject({ tool: 'set_menu_price', menuName: '어벨라워 아부나흐', before: 33000, after: 36000 });
    const undo = await call('/api/ai-changes/undo', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ id: log.changes[0].id }) });
    expect(undo.status).toBe(200);
    expect(rows.get(UID).data.menus[0].price).toBe(33000);
    const again = await call('/api/ai-changes/undo', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ id: log.changes[0].id }) });
    expect(again.status).toBe(409);
    // 다른 계정은 내 기록을 못 봄
    const other = await (await call('/api/ai-changes', { headers: { authorization: 'Bearer sb-other' } })).json();
    expect(other.changes).toEqual([]);
  });

  it('앱에서 동시에 저장해 번호가 바뀌면 다시 읽어서 반영 (앱 변경을 덮지 않음)', async () => {
    const tok = await token();
    let first = true;
    const orig = sb.fetchImpl;
    // 클로드가 읽은 직후 앱이 먼저 저장한 상황
    const racing = async (url, init) => {
      if (first && String(url).includes('mcp_ledger_put')) {
        first = false;
        const r = rows.get(UID);
        r.data.menus[0].bottlePrice = 470000; // 앱에서 바꾼 보틀가
        r.rev += 1;
      }
      return orig(url, init);
    };
    sb.fetchImpl = racing;
    provider = makeProvider({ fetch: () => new Response('app') }, { fetchImpl: racing });
    const set = await tool(tok, 'set_menu_price', { menu: 'm1', price: 35000 });
    expect(set.isError).toBe(false);
    expect(rows.get(UID).data.menus[0]).toMatchObject({ price: 35000, bottlePrice: 470000 });
  });
});
