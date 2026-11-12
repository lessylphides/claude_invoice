// 소개 페이지를 앱 안 브라우저로 열면 맨 위에 '밖에서 열기' 안내 띠
import { inAppOf, escapeUrl, escapeHint } from '../lib/inapp.js';

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

export function withBanner(request, url, res) {
  const banner = res.ok && (res.headers.get('content-type') || '').startsWith('text/html') ? inAppBanner(request, url) : '';
  if (!banner) return res;
  return res.text().then((html) => {
    const headers = new Headers(res.headers);
    headers.set('vary', 'user-agent');
    return new Response(html.replace(/<body([^>]*)>/, (m) => m + banner), { status: res.status, headers });
  });
}

