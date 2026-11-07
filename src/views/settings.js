// 설정: Claude API 키·모델, 분류 목록, CSV 내보내기, 백업/복원
import { dotDate, esc, maskKey, num, todayStr } from '../lib/format.js';
import { purchasesCsv } from '../lib/csv.js';
import { daysBetween } from '../lib/backup.js';
import { download } from '../ui/download.js';
import { openSheet, toast } from '../ui/sheet.js';
import { storageInfo } from '../persist.js';
import { store, MODELS } from '../store.js';
import { monthKey } from '../state.js';
import { monthPurchases, backupNow } from './purchase.js';
import { auth } from '../auth.js';
import { setAuthNotice } from './authScreen.js';

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)}MB`;

function backupLine() {
  const last = store.settings.lastBackupAt;
  if (!last) return '마지막 백업: <b class="warn">아직 없음</b>';
  const days = daysBetween(last, todayStr());
  return `마지막 백업: <b>${dotDate(last)}</b> (${days > 0 ? `${days}일 전` : '오늘'})`;
}

export function openSettings() {
  openSheet({
    title: '설정',
    render(body, close) {
      const s = store.settings;
      body.innerHTML = `
        <form class="settings">
          <h3 class="sub">계정</h3>
          <div class="account-row"><p class="small">로그인: <b class="account-email">${esc(auth.user?.email ?? '')}</b></p><button type="button" class="btn ghost small-btn" data-act="logout">로그아웃</button></div>

          <h3 class="sub">영수증 자동 인식 (Claude API)</h3>
          <p class="key-status small">${
            s.apiKey ? `저장된 키: <code>${esc(maskKey(s.apiKey))}</code>` : '<b class="warn">저장된 키 없음</b> — 영수증 자동 인식을 쓰려면 키를 넣어 주세요.'
          }</p>
          <label>${s.apiKey ? '새 키로 바꾸기 (비워 두면 그대로)' : 'API 키'}<input name="apiKey" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="sk-ant-api03-..."></label>
          ${s.apiKey ? '<button type="button" class="btn ghost danger-text" data-act="clear-key">이 기기에서 키 지우기</button>' : ''}
          <p class="muted small">키는 <b>이 기기에만</b> 저장되고 Anthropic API 로만 전송됩니다(앱 코드·주소에는 없음). 키는 platform.claude.com 에서 발급합니다.</p>
          <p class="muted small">안전하게 쓰려면 Console 에서 <b>자동 충전 끄기</b>, <b>월 사용 한도</b> 정하기, <b>이 앱 전용 키</b>를 쓰세요. 휴대폰을 잃어버리면 Console 에서 키를 바로 삭제하세요.</p>
          <label>인식 모델<select name="model">${MODELS.map((m) => `<option value="${m.id}" ${m.id === s.model ? 'selected' : ''}>${m.label}</option>`).join('')}</select></label>

          <h3 class="sub">항목(분류) 목록</h3>
          <textarea name="cats" rows="6" aria-label="분류 목록, 한 줄에 하나">${esc(store.categories.join('\n'))}</textarea>
          <p class="muted small">한 줄에 하나씩. 촬영 시 품목이 이 분류 중 하나로 자동 분류됩니다.</p>
          <div class="actions"><button class="btn primary" type="submit">저장</button></div>

          <h3 class="sub">데이터</h3>
          <div class="btn-col">
            <button class="btn ghost" type="button" data-act="csv">이번 달 CSV 내보내기 (엑셀)</button>
            <button class="btn ghost" type="button" data-act="backup">전체 백업 파일 저장</button>
            <button class="btn ghost" type="button" data-act="restore">백업 파일 불러오기</button>
          </div>
          <input type="file" accept="application/json,.json" hidden class="restore-file">
          <p class="small backup-line">${backupLine()}</p>
          <p class="muted small storage-line">매입 ${num(store.purchases.length)}건 · 메뉴 ${num(store.menus.length)}개</p>
          <p class="muted small">데이터는 이 기기에만 저장됩니다. 기기를 바꾸거나 홈 화면 아이콘·브라우저 데이터를 지우기 전에 백업하세요.</p>
        </form>`;
      const form = body.querySelector('form');
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const newKey = form.elements.apiKey.value.trim();
        // 새 키를 적었을 때만 바꿈 (저장된 키는 화면에 다시 넣지 않음)
        store.saveSettings({ ...(newKey ? { apiKey: newKey } : {}), model: form.elements.model.value });
        store.setCategories(form.elements.cats.value.split('\n'));
        toast('설정을 저장했습니다.');
        close();
      });
      body.querySelector('[data-act=clear-key]')?.addEventListener('click', () => {
        if (!confirm('이 기기에서 API 키를 지울까요? 영수증 자동 인식이 꺼집니다. (Console 의 키 자체는 지워지지 않습니다)')) return;
        store.saveSettings({ apiKey: '' });
        toast('이 기기에서 키를 지웠습니다.');
        close();
      });
      body.querySelector('[data-act=logout]').addEventListener('click', async () => {
        if (!confirm('로그아웃할까요? 이 기기에 저장된 장부는 지워지지 않습니다.')) return;
        close();
        setAuthNotice('로그아웃했어요.');
        await auth.signOut();
      });
      body.querySelector('[data-act=csv]').addEventListener('click', () => download(`매입_${monthKey()}.csv`, purchasesCsv(monthPurchases()), 'text/csv'));
      body.querySelector('[data-act=backup]').addEventListener('click', async () => {
        await backupNow();
        if (body.isConnected) body.querySelector('.backup-line').innerHTML = backupLine();
      });
      // 저장 공간 사용량 (브라우저가 알려 주는 경우만)
      storageInfo().then((info) => {
        if (!info || !body.isConnected) return;
        body.querySelector('.storage-line').textContent += ` · ${info.backend} ${mb(info.usage)} 사용${info.persisted ? ' · 보호됨' : ''}`;
      });
      const rf = body.querySelector('.restore-file');
      body.querySelector('[data-act=restore]').addEventListener('click', () => rf.click());
      rf.addEventListener('change', async () => {
        const f = rf.files[0];
        if (!f || !confirm('현재 데이터를 백업 파일 내용으로 바꿉니다. 계속할까요?')) return;
        try {
          store.importData(await f.text());
          toast('불러왔습니다.');
          close();
        } catch (err) {
          alert(`불러오기 실패: ${err instanceof SyntaxError ? '파일 형식이 올바르지 않습니다.' : err.message}`);
        }
      });
    },
  });
}
