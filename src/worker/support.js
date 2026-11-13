// POST /api/support: 설정 → 문의하기. 운영자 메일로 보내고(답장하면 회원에게 감), 회원에게 접수 메일
// 메일 본문은 그대로 클로드에게 붙여 넣어도 바로 살펴볼 수 있게 정리된 형식
import { json, fail, authUser } from './common.js';
import { db, kstDate, getSub, entitlement } from './billing.js';
import { sendMail, supportOwnerMail, supportAckMail } from './mail.js';
import { kindOf, deviceLabel, SUPPORT_MIN, SUPPORT_MAX, SUPPORT_MAX_IMAGES, SUPPORT_MAX_IMAGE_B64, SUPPORT_DAILY } from '../lib/support.js';
import { PLANS } from '../lib/plans.js';

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const planLabel = (ent) =>
  ent.kind === 'plan' ? `${PLANS[ent.plan]?.name ?? ent.plan} 요금제` : ent.kind === 'owner' ? '운영자' : ent.kind === 'trial' ? '무료 체험' : '시범 운영';

export async function handleSupport(request, env, { fetchImpl = fetch, now = Date.now() } = {}) {
  if (request.method !== 'POST') return fail(405, 'method', 'POST 만 받습니다.');
  const a = await authUser(request, fetchImpl);
  if (a.error) return a.error;
  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, 'bad_request', '요청을 읽지 못했어요.');
  }
  const owner = String(env.OWNER_EMAILS || '').split(',')[0]?.trim();
  const text = String(body?.text ?? '').trim();
  if (text.length < SUPPORT_MIN) return fail(400, 'too_short', `내용을 ${SUPPORT_MIN}자 이상 적어 주세요.`);
  if (text.length > SUPPORT_MAX) return fail(400, 'too_long', `내용은 ${SUPPORT_MAX.toLocaleString()}자까지 보낼 수 있어요.`);
  const images = Array.isArray(body.images) ? body.images : [];
  if (images.length > SUPPORT_MAX_IMAGES) return fail(400, 'too_many_images', `사진은 ${SUPPORT_MAX_IMAGES}장까지 붙일 수 있어요.`);
  if (images.some((b) => typeof b !== 'string' || b.length > SUPPORT_MAX_IMAGE_B64 || !B64.test(b))) return fail(400, 'bad_image', '사진을 읽지 못했어요. 다른 사진으로 해 주세요.');

  const d = db(env);
  const dayKey = `support:${a.user.id}:${kstDate(now)}`;
  const used = (d && (await d.get(dayKey))) || 0;
  if (used >= SUPPORT_DAILY) return fail(429, 'too_many', `문의는 하루 ${SUPPORT_DAILY}번까지 보낼 수 있어요. 급한 일은 ${owner} 로 메일 주세요.`);

  const kind = kindOf(body.kind);
  const meta = body.meta && typeof body.meta === 'object' ? body.meta : {};
  const sub = d ? await getSub(env, a.user.id).catch(() => null) : null;
  const info = {
    kind: `${kind.icon} ${kind.label}`,
    text,
    email: a.user.email,
    uid: a.user.id,
    joined: a.user.createdAt ? kstDate(Date.parse(a.user.createdAt)) : '?',
    plan: planLabel(entitlement(env, a.user, sub, now)),
    device: `${deviceLabel(String(meta.device || ''))}${meta.standalone ? ' · 홈 화면 앱' : ' · 브라우저'}${meta.screen ? ` · 화면 ${String(meta.screen).slice(0, 20)}` : ''}`,
    version: String(meta.version || '?').slice(0, 40),
    tab: String(meta.tab || '?').slice(0, 20),
    at: new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' '),
    images: images.length,
  };
  const sent = await sendMail(env, fetchImpl, {
    to: owner,
    replyTo: a.user.email,
    ...supportOwnerMail(info),
    attachments: images.map((content, i) => ({ filename: `capture${i + 1}.jpg`, content })),
  });
  if (!sent) return fail(502, 'mail_failed', `문의를 보내지 못했어요. 잠시 후 다시 시도하거나 ${owner} 로 메일 주세요.`);
  if (d) await d.put(dayKey, used + 1);
  await sendMail(env, fetchImpl, { to: a.user.email, ...supportAckMail(info) });
  return json(200, { ok: true });
}
