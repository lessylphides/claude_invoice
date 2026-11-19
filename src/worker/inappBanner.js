// 소개 페이지를 앱 안 브라우저로 열면 맨 위에 '밖에서 열기' 안내 띠
import { inAppOf, escapeUrl, escapeHint } from '../lib/inapp.js';
import { cleanRef } from '../lib/ref.js';

/** 앱 안 브라우저(인스타·카카오톡 등)로 소개 페이지를 열면 맨 위에 '밖에서 열기' 안내 (소개 페이지는 스크립트가 없어서 서버가 끼워 넣음) */
export function inAppBanner(request, url) {
  const info = inAppOf(request.headers.get('user-agent') || '');
  if (!info) return '';
  const target = new URL(url);
  if (target.searchParams.has('ref')) target.searchParams.set('nv', '1'); // 밖에서 다시 열 때 방문 두 번 세지 않게
  const direct = escapeUrl(info, target.href);
  const browser = info.os === 'android' ? '크롬' : 'Safari';
  const how = direct
    ? `<a href="${direct.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" style="display:inline-block;margin-top:8px;background:#fff;color:#2459c4;font-weight:700;padding:8px 14px;border-radius:999px;text-decoration:none">${browser}에서 열기</a>`
    : `<span style="display:block;margin-top:4px">${escapeHint(info)}</span>`;
  return `<div class="inapp-banner" role="note" style="background:#2459c4;color:#fff;padding:12px 16px;font-size:14px;line-height:1.5;text-align:center">📱 지금 <b>${info.name}</b> 앱 안에서 보고 계세요. <b>${browser}</b>에서 열면 코스트노트를 홈 화면에 앱처럼 설치해 쓸 수 있어요.${how}</div>`;
}

// 광고로 온 사람 전용 첫 화면: 광고에서 본 말 그대로 + 큰 시작 버튼 (꼬리표 igad…)
const AD_COPY = {
  igad2: {
    h1: '위스키 한 잔,<br><em>얼마 받을지</em><br>바로 알려 드려요',
    lead: '보틀 매입가로 잔 원가를 계산하고, 최소 가격·목표 가격을 추천해요. 매입가가 바뀌면 추천도 같이 바뀌어요.',
  },
  default: {
    h1: '영수증 찍으면<br><em>장부 정리 끝</em>',
    lead: '날짜·거래처·품목·단가·할인까지 자동으로 넣고, 메뉴 한 잔의 원가율과 마진까지 계산해요.',
  },
};
export function adHero(raw) {
  const ref = cleanRef(raw);
  if (!ref || !/^igad/.test(ref)) return '';
  const c = AD_COPY[ref] || AD_COPY.default;
  const start = `https://app.costnote.co.kr/?start=signup&amp;ref=${encodeURIComponent(ref)}`;
  return `<p class="ad-kicker">사장님, 반가워요 👋</p>
          <h1 id="hero-title">${c.h1}</h1>
          <p class="lead">${c.lead}</p>
          <ul class="ad-points"><li>가입 30초 · 카드 등록 없음</li><li>영수증 자동 인식 <b>20회 무료</b></li><li>앱스토어 설치 없이 바로</li></ul>
          <div class="ctas"><a class="btn primary ad-start" href="${start}">무료로 시작하기</a></div>
          <p class="note">이미 가입했다면 <a href="https://app.costnote.co.kr/">로그인</a> · 아래에서 기능을 더 볼 수 있어요</p>
          <style>.ad-kicker{margin:0 0 6px;font-weight:700;color:var(--accent)}.ad-points{list-style:none;padding:0;margin:14px 0 18px;display:grid;gap:6px}.ad-points li::before{content:'✔ ';color:var(--ok);font-weight:700}.ad-start{font-size:1.15rem;padding:16px 30px;width:100%;max-width:360px;text-align:center;box-sizing:border-box}</style>`;
}

/** 소개 페이지: 앱 안 브라우저 안내 띠 + 광고로 온 사람 전용 첫 화면 (소개 페이지는 스크립트가 없어서 서버가 끼워 넣음) */
export function withBanner(request, url, res) {
  if (!res.ok || !(res.headers.get('content-type') || '').startsWith('text/html')) return res;
  const ad = new URL(url).pathname === '/' ? adHero(new URL(url).searchParams.get('ref')) : '';
  // 광고로 온 사람에게는 '밖에서 열기' 띠를 빼고 가입 버튼에 집중 (앱 안 브라우저에서도 인증 코드로 가입돼요)
  const banner = ad ? '' : inAppBanner(request, url);
  if (!banner && !ad) return res;
  return res.text().then((html) => {
    const headers = new Headers(res.headers);
    headers.set('vary', 'user-agent');
    if (banner) html = html.replace(/<body([^>]*)>/, (m) => m + banner);
    // 첫 화면 글(제목·설명·버튼)만 광고용으로 바꾸고 오른쪽 앱 화면 그림은 그대로
    if (ad) html = html.replace(/(<section class="hero"[^>]*>\s*<div>)[\s\S]*?(<\/div>\s*<div class="phones")/, (_, a, b) => `${a}${ad}\n        ${b}`);
    return new Response(html, { status: res.status, headers });
  });
}

