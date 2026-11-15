// 가입 다음 날 사용 안내 메일 (한 번만): 처음 로그인하고 하루쯤 지났는데 영수증을 0~1장만 기록한 회원에게
// 매일 한 번(cron) 돌림. 광고·결제 권유가 아닌 사용 안내만 담음
import { db, isOwner } from './billing.js';
import { sendMail, nudgeMail } from './mail.js';
import { readLedger } from './mcp/ledger.js';

const MIN_AGE = 20 * 3600 * 1000; // 처음 로그인하고 20시간 뒤부터
const MAX_AGE = 7 * 86400 * 1000; // 일주일이 지나면 보내지 않음

export async function runNudges(env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const d = db(env);
  if (!d?.list || !env.RESEND_API_KEY) return { skipped: true };
  const out = { sent: 0, active: 0, waiting: 0 };
  let after = null;
  do {
    const page = await d.list('joined:', after);
    for (const key of page.keys) {
      const v = await d.get(key);
      if (!v || v.nudged || !v.email) continue;
      const age = now - v.at;
      if (age < MIN_AGE) {
        out.waiting++;
        continue;
      }
      const uid = key.slice(7);
      const mark = (how) => d.put(key, { ...v, nudged: how, nudgedAt: now });
      if (age > MAX_AGE || isOwner(env, v.email)) {
        await mark('skip');
        continue;
      }
      let receipts = 0;
      try {
        receipts = (await readLedger(env, uid, fetchImpl)).data.purchases.length;
      } catch (e) {
        console.error('[nudge] ledger', String(e));
        continue; // 다음 날 다시
      }
      if (receipts >= 2) {
        out.active++;
        await mark('active');
        continue;
      }
      if (await sendMail(env, fetchImpl, { to: v.email, replyTo: env.SUPPORT_EMAIL, ...nudgeMail({ receipts }) })) {
        out.sent++;
        await mark('sent');
      }
    }
    after = page.next;
  } while (after);
  return out;
}
