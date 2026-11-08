// 서버 메일 보내기 (Resend API). 키는 Cloudflare 비밀 값 RESEND_API_KEY 에만 있음
// 키가 없으면 보내지 않고 기록만 남김 (메일 때문에 결제 처리가 멈추지 않게)
import { esc } from '../lib/format.js';

const FROM = '코스트노트 <noreply@costnote.co.kr>';
const APP = 'https://app.costnote.co.kr';

/** @returns {Promise<boolean>} 보냈으면 true */
export async function sendMail(env, fetchImpl, { to, subject, text, html }) {
  if (!env.RESEND_API_KEY || !to) {
    console.log('[mail] skipped (no key or address):', subject);
    return false;
  }
  try {
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], subject, text, html }),
    });
    if (!res.ok) console.error('[mail] resend', res.status, await res.text().catch(() => ''));
    return res.ok;
  } catch (e) {
    console.error('[mail] network', String(e));
    return false;
  }
}

/** 간단한 메일 본문 (글자 + 버튼 하나) */
function layout(title, paragraphs, button) {
  const text = [title, '', ...paragraphs, '', button ? `${button.label}: ${button.href}` : '', '', '코스트노트 · 문의 hanguk.soek@me.com'].join('\n');
  const html = `<div style="font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1b1e24;line-height:1.6">
  <h2 style="font-size:18px;margin:0 0 12px">${esc(title)}</h2>
  ${paragraphs.map((p) => `<p style="margin:0 0 10px;font-size:15px">${esc(p)}</p>`).join('')}
  ${button ? `<p style="margin:20px 0"><a href="${button.href}" style="background:#2459c4;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700;display:inline-block">${esc(button.label)}</a></p>` : ''}
  <p style="margin:24px 0 0;font-size:12px;color:#636a77">코스트노트 · 문의 hanguk.soek@me.com</p>
</div>`;
  return { text, html };
}

const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`;
const md = (ms) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(5, 10).replace('-', '월 ').replace(/^0/, '') + '일';

/** 정기결제 실패 (아직 다시 시도함) */
export function renewFailedMail({ planName, amount, reason, retriesLeft, graceEnd }) {
  return {
    subject: '[코스트노트] 정기결제에 실패했어요',
    ...layout(
      '정기결제에 실패했어요',
      [
        `${planName} 요금제 ${won(amount)} 결제가 되지 않았어요.${reason ? ` (사유: ${reason})` : ''}`,
        `내일 다시 결제를 시도해요. 남은 시도: ${retriesLeft}번. ${md(graceEnd)}까지 결제되지 않으면 구독이 끝나요.`,
        '카드 한도·유효기간을 확인하거나, 앱의 ⚙ 설정 → 요금제 관리 → [카드 다시 등록]에서 다른 카드를 등록하면 바로 결제돼요.',
        '장부는 그대로 남아 있어요.',
      ],
      { label: '앱에서 카드 다시 등록하기', href: APP },
    ),
  };
}

/** 결제가 끝내 안 되어 구독 종료 */
export function subscriptionEndedMail({ planName }) {
  return {
    subject: '[코스트노트] 결제가 되지 않아 구독이 끝났어요',
    ...layout(
      '결제가 되지 않아 구독이 끝났어요',
      [
        `여러 번 시도했지만 ${planName} 요금제 결제가 되지 않아 구독이 끝났어요.`,
        '장부와 원가 계산, 직접 입력은 계속 쓸 수 있어요. 영수증 자동 인식을 다시 쓰려면 앱에서 요금제를 다시 시작해 주세요.',
      ],
      { label: '앱 열기', href: APP },
    ),
  };
}

/** 운영자에게: 오늘 정기결제 결과 (실패·종료가 있을 때만) */
export function ownerRenewalMail(out, lines) {
  return {
    subject: `[코스트노트 운영] 정기결제 실패 ${out.failed}건 · 종료 ${out.ended}건`,
    ...layout('오늘 정기결제 결과', [`성공 ${out.renewed}건 · 실패 ${out.failed}건 · 종료 ${out.ended}건`, ...lines]),
  };
}
