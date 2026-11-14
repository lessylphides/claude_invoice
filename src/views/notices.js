// 설정 → 공지사항: 최신순 목록, 누르면 내용 펼침. 열면 읽음 처리(설정 아이콘의 빨간 점이 사라짐)
// 운영자는 운영 현황에서 쓰기·고치기·지우기 (openNoticeEditor)
import { esc } from '../lib/format.js';
import { openSheet, toast } from '../ui/sheet.js';
import { auth } from '../auth.js';
import { rerender } from '../state.js';
import { NOTICE_KINDS, NOTICE_TITLE_MAX, NOTICE_BODY_MAX, noticeState } from '../lib/notices.js';

const day = (ms) => new Date(ms).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
const tag = (n) => `<span class="nt-tag nt-${esc(n.kind)}">${NOTICE_KINDS[n.kind]?.icon ?? ''} ${esc(NOTICE_KINDS[n.kind]?.label ?? '')}</span>`;
const paras = (s) => esc(s).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');

/** 설정 아이콘에 붙는 빨간 점 */
export const noticeDot = () => (noticeState.unread ? '<span class="nt-dot" role="img" aria-label="새 공지"></span>' : '');

/** @param {string} [openId] 펼쳐서 보여 줄 공지 */
export function openNotices(openId = null) {
  const seenBefore = noticeState.seenAt;
  openSheet({
    title: '공지사항',
    render(body) {
      const list = noticeState.list;
      body.innerHTML = list.length
        ? `<div class="nt-list">${list
            .map(
              (n, i) => `<details class="nt-item set-card"${n.id === openId || (!openId && i === 0) ? ' open' : ''}>
                <summary>${tag(n)}${n.important ? '<span class="nt-imp">중요</span>' : ''}${n.at > seenBefore ? '<span class="nt-new">새 글</span>' : ''}<b class="nt-title">${esc(n.title)}</b><small>${day(n.at)}</small></summary>
                <div class="nt-body">${paras(n.body)}</div>
              </details>`,
            )
            .join('')}</div>`
        : '<p class="muted small set-pad">아직 공지가 없어요.</p>';
    },
  });
  noticeState.markSeen();
  rerender();
}

async function adminApi(payload) {
  const token = await auth.accessToken();
  const res = await fetch('./api/admin/notices', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.error?.message || '저장하지 못했어요.');
  noticeState.set(j.notices);
  return j.notices;
}

/** 운영자: 공지 쓰기·고치기 */
export function openNoticeEditor(notice = null, onDone = () => {}) {
  const n = notice || { kind: 'feature', title: '', body: '', important: false };
  openSheet({
    title: notice ? '공지 고치기' : '공지 쓰기',
    render(body, close) {
      body.innerHTML = `
        <form class="nt-form" novalidate>
          <label>종류<select name="kind">${Object.entries(NOTICE_KINDS)
            .map(([k, v]) => `<option value="${k}"${k === n.kind ? ' selected' : ''}>${v.icon} ${v.label}</option>`)
            .join('')}</select></label>
          <label>제목<input name="title" maxlength="${NOTICE_TITLE_MAX}" value="${esc(n.title)}" placeholder="예) PDF 거래명세서도 인식돼요"></label>
          <label>내용<textarea name="body" rows="9" maxlength="${NOTICE_BODY_MAX}" placeholder="빈 줄로 문단을 나눠요.">${esc(n.body)}</textarea></label>
          <label class="agree"><input type="checkbox" name="important"${n.important ? ' checked' : ''}><span><b>중요 공지</b> — 회원이 앱을 열 때 한 번 띄워요 (결제·요금 변경, 큰 오류 안내에만)</span></label>
          <div class="btn-col">
            <button class="btn primary" type="submit">${notice ? '고친 내용 저장' : '올리기'}</button>
            ${notice ? '<button class="btn ghost danger" type="button" data-act="del">이 공지 지우기</button>' : ''}
          </div>
        </form>`;
      const form = body.querySelector('form');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = (k) => form.elements[k].value;
        if (!v('title').trim()) return toast('제목을 적어 주세요.');
        try {
          await adminApi({ action: 'save', notice: { id: notice?.id, kind: v('kind'), title: v('title'), body: v('body'), important: form.elements.important.checked } });
          toast(notice ? '공지를 고쳤어요.' : '공지를 올렸어요.');
          close();
          onDone();
        } catch (err) {
          toast(err.message);
        }
      });
      body.querySelector('[data-act=del]')?.addEventListener('click', async () => {
        if (!confirm('이 공지를 지울까요?')) return;
        try {
          await adminApi({ action: 'delete', id: notice.id });
          toast('공지를 지웠어요.');
          close();
          onDone();
        } catch (err) {
          toast(err.message);
        }
      });
    },
  });
}
