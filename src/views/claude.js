// 설정 → 클로드 연결: 연결 방법 안내, 연결 주소 복사, 클로드가 바꾼 기록과 되돌리기
import { esc, num } from '../lib/format.js';
import { openSheet, toast } from '../ui/sheet.js';
import { auth } from '../auth.js';
import { sync } from '../sync.js';

export const MCP_URL = 'https://app.costnote.co.kr/mcp';

async function api(path, init = {}) {
  const token = await auth.accessToken();
  if (!token) throw new Error('로그인이 필요해요.');
  const res = await fetch(`.${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers || {}) } });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.error?.message || '잠시 후 다시 시도해 주세요.');
  return j;
}

const when = (ms) => new Date(ms).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const val = (c, v) => (c.field === 'category' ? v || '미분류' : v ? `${num(v)}원` : '없음');

function changeLi(c) {
  const what =
    c.kind === 'category_create'
      ? `메뉴 분류 <b>${esc(c.category)}</b> 만들기`
      : `<b>${esc(c.menuName)}</b> ${esc(c.label)} ${esc(val(c, c.before))} → <b>${esc(val(c, c.after))}</b>`;
  return `<li class="ai-ch${c.undoneAt ? ' undone' : ''}">
    <span class="grow">${what}<small>${when(c.at)}${c.undoneAt ? ' · 되돌림' : ''}</small></span>
    ${c.undoneAt ? '' : `<button type="button" class="btn ghost small-btn" data-undo="${esc(c.id)}">되돌리기</button>`}
  </li>`;
}

/** 클로드 연결 모두 끊기 (탈퇴할 때) */
export const disconnectClaude = () => api('/api/claude/revoke', { method: 'POST', body: JSON.stringify({ all: true }) });

function grantLi(g) {
  const d = new Date(g.createdAt * (g.createdAt < 1e12 ? 1000 : 1)).toLocaleDateString('ko-KR');
  return `<li class="ai-ch"><span class="grow">🤖 ${esc(g.client || 'Claude')}<small>${d} 연결</small></span>
    <button type="button" class="btn ghost small-btn" data-revoke="${esc(g.id)}">연결 끊기</button></li>`;
}

export function openClaudeConnect() {
  openSheet({
    title: '클로드 연결',
    render(body) {
      body.innerHTML = `
        <div class="claude-sheet">
          <div class="set-card set-pad">
            <p><b>클로드(Claude)에 코스트노트를 연결하면</b> 클로드 앱에서 이렇게 물어볼 수 있어요.</p>
            <p class="claude-ex">"위스키 메뉴들 원가 보고 잔·보틀 판매가가 적당한지 설명해 줘. 괜찮으면 반영해 줘."</p>
            <p class="small muted">클로드가 장부의 매입가·원가율·최소 마진을 직접 읽고 상담해 주고, 사장님이 허락하면 판매가를 입력하거나 메뉴 분류를 만들어요. AI 비용은 사장님의 클로드 요금제에서 나가요.</p>
          </div>

          <section>
            <h3 class="set-title">연결 주소</h3>
            <div class="set-card set-pad claude-url">
              <code>${MCP_URL}</code>
              <button type="button" class="btn ghost small-btn" data-act="copy">복사</button>
            </div>
          </section>

          <section>
            <h3 class="set-title">연결 방법 (처음 한 번)</h3>
            <div class="set-card set-pad">
              <ol class="claude-steps">
                <li>클로드 웹(claude.ai)이나 데스크톱 앱에서 <b>설정 → 커넥터</b>(Customize → Connectors)로 가요.</li>
                <li><b>추가 → 커스텀 커넥터 추가</b>를 눌러요.</li>
                <li>이름은 <b>코스트노트</b>, 주소는 위 <b>연결 주소</b>를 붙여 넣고 추가해요. 인증 설정은 그대로 두면 돼요.</li>
                <li><b>연결</b>을 누르면 코스트노트 로그인 화면이 떠요. 로그인하고 <b>허락하기</b>를 눌러요.</li>
                <li>이제 클로드와 대화할 때 코스트노트를 쓸 수 있어요. 휴대폰 클로드 앱에서도 같은 계정이면 바로 써요.</li>
              </ol>
              <p><a href="https://costnote.co.kr/ai#connect" target="_blank" rel="noopener">🖼 화면 그림으로 연결 방법 보기 ›</a></p>
              <p class="set-note">클로드는 지우기를 할 수 없어요. 장부를 바꿀 때마다 클로드가 사장님께 허락을 물어요. 연결은 클로드 커넥터 설정에서 언제든 끊을 수 있어요.</p>
            </div>
          </section>

          <section>
            <h3 class="set-title">연결된 클로드</h3>
            <div class="set-card set-pad ai-grants" aria-live="polite"><p class="small muted">불러오는 중…</p></div>
            <p class="set-note">모르는 연결이 보이면 바로 끊어 주세요. 끊으면 그 클로드는 장부를 더 이상 볼 수 없어요.</p>
          </section>

          <section>
            <h3 class="set-title">클로드가 바꾼 기록</h3>
            <div class="set-card set-pad ai-log" aria-live="polite"><p class="small muted">불러오는 중…</p></div>
            <p class="set-note">되돌리기는 클로드가 바꾼 뒤 그대로일 때만 돼요. 그 뒤에 앱에서 다시 바꾼 값은 건드리지 않아요.</p>
          </section>
        </div>`;

      body.querySelector('[data-act=copy]').addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(MCP_URL);
          toast('연결 주소를 복사했어요.');
        } catch {
          toast('복사하지 못했어요. 주소를 길게 눌러 복사해 주세요.');
        }
      });

      const gbox = body.querySelector('.ai-grants');
      const drawGrants = (gs) => {
        if (!gbox.isConnected) return;
        gbox.innerHTML = gs.length ? `<ul class="ai-list">${gs.map(grantLi).join('')}</ul>` : '<p class="small muted">연결된 클로드가 없어요.</p>';
      };
      const loadGrants = () =>
        api('/api/claude/grants').then(
          (j) => drawGrants(j.grants || []),
          (e) => gbox.isConnected && (gbox.innerHTML = `<p class="small muted">${esc(e.message)}</p>`),
        );
      loadGrants();
      gbox.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-revoke]');
        if (!b || !confirm('이 클로드 연결을 끊을까요?')) return;
        b.disabled = true;
        try {
          await api('/api/claude/revoke', { method: 'POST', body: JSON.stringify({ id: b.dataset.revoke }) });
          toast('연결을 끊었어요.');
          loadGrants();
        } catch (err) {
          toast(err.message);
          b.disabled = false;
        }
      });

      const box = body.querySelector('.ai-log');
      const draw = (changes) => {
        if (!box.isConnected) return;
        box.innerHTML = changes.length
          ? `<ul class="ai-list">${changes.map(changeLi).join('')}</ul>`
          : '<p class="small muted">아직 클로드가 바꾼 내용이 없어요.</p>';
      };
      api('/api/ai-changes').then(
        (j) => draw(j.changes || []),
        (e) => box.isConnected && (box.innerHTML = `<p class="small muted">${esc(e.message)}</p>`),
      );
      box.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-undo]');
        if (!b) return;
        b.disabled = true;
        try {
          if (sync.dirty) await sync.now(); // 이 기기에서 바꾼 게 있으면 먼저 올려야 되돌린 장부와 엇갈리지 않음
          const j = await api('/api/ai-changes/undo', { method: 'POST', body: JSON.stringify({ id: b.dataset.undo }) });
          toast(j.message || '되돌렸어요.');
          draw(j.changes || []);
          await sync.pullNow(); // 서버에서 되돌린 장부를 바로 받아 옴
        } catch (err) {
          toast(err.message);
          b.disabled = false;
        }
      });
    },
  });
}
