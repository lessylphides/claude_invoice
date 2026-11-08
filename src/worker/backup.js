// 장부 정기 백업: 매일 한 번 모든 장부를 받아 압축·암호화해서 Cloudflare KV 에 14일간 보관
//
// - 장부 받기: Supabase 함수 backup_ledgers(secret) — 비밀 값이 맞을 때만 돌려줌 (Supabase 에는 비밀 값의 해시만 있음)
// - 암호화: AES-GCM, 키는 같은 비밀 값(BACKUP_SECRET, Cloudflare 비밀 값)에서 만듦 → KV 가 새어도 내용은 못 읽음
// - 복구: 운영 현황 화면에서 날짜별 백업 파일을 내려받아 해당 계정 장부를 되돌림
import { SUPABASE_URL, SUPABASE_KEY } from '../config.js';

const KEEP_DAYS = 14;
const enc = new TextEncoder();

async function aesKey(secret) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(`costnote-backup:${secret}`));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function streamBytes(stream) {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
const gzip = (bytes) => streamBytes(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')));
const gunzip = (bytes) => streamBytes(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')));

/** JSON → gzip → AES-GCM. 앞 12바이트는 iv */
export async function seal(secret, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(secret), await gzip(enc.encode(JSON.stringify(obj)))));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}
export async function unseal(secret, bytes) {
  const b = new Uint8Array(bytes);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(0, 12) }, await aesKey(secret), b.slice(12));
  return JSON.parse(new TextDecoder().decode(await gunzip(new Uint8Array(plain))));
}

const kstDate = (ms) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);

/** 오늘 백업 만들기. 결과 요약을 돌려줌 */
export async function runBackup(env, { fetchImpl = fetch, now = Date.now() } = {}) {
  if (!env.BACKUP_SECRET || !env.BILLING) return { skipped: true };
  const res = await fetchImpl(`${SUPABASE_URL}/rest/v1/rpc/backup_ledgers`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ secret: env.BACKUP_SECRET }),
  });
  if (!res.ok) {
    console.error('[backup] supabase', res.status, (await res.text().catch(() => '')).slice(0, 200));
    return { ok: false, status: res.status };
  }
  const ledgers = (await res.json()) ?? [];
  const date = kstDate(now);
  const bytes = await seal(env.BACKUP_SECRET, { date, at: now, ledgers });
  const meta = { date, at: now, users: ledgers.length, bytes: bytes.length };
  await env.BILLING.put(`backup:${date}`, bytes, { expirationTtl: KEEP_DAYS * 86400, metadata: meta });
  return { ok: true, ...meta };
}

/** 보관 중인 백업 목록 (최신순) */
export async function listBackups(env) {
  if (!env.BILLING) return [];
  const page = await env.BILLING.list({ prefix: 'backup:' });
  return page.keys.map((k) => k.metadata ?? { date: k.name.slice(7) }).sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** 백업 하나를 풀어서 돌려줌 (운영자 내려받기용) */
export async function readBackup(env, date) {
  if (!env.BACKUP_SECRET || !env.BILLING || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const bytes = await env.BILLING.get(`backup:${date}`, 'arrayBuffer');
  return bytes ? unseal(env.BACKUP_SECRET, bytes) : null;
}
