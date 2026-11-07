// 설정: Claude API 키·모델, 분류 목록, CSV 내보내기, 백업/복원
import { dotDate, esc, num, todayStr } from '../lib/format.js';
import { purchasesCsv } from '../lib/csv.js';
import { daysBetween } from '../lib/backup.js';
import { download } from '../ui/download.js';
import { openSheet, toast } from '../ui/sheet.js';
import { storageInfo } from '../persist.js';
import { store } from '../store.js';
import { client } from '../auth.js';
import { monthKey } from '../state.js';
import { monthPurchases, backupNow } from './purchase.js';
import { auth } from '../auth.js';
import { setAuthNotice } from './authScreen.js';
import { sync } from '../sync.js';

function syncLine() {
  const t = sync.syncedAt ? new Date(sync.syncedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;
  const map = {
    syncing: '서버에 저장하는 중…',
    offline: '<b class="warn">인터넷 연결이 없어 이 기기에만 저장됨</b> (연결되면 자동으로 올림)',
    error: '<b class="warn">서버 저장에 실패했어요</b> — [지금 동기화]로 다시 시도해 주세요',
    conflict: '<b class="warn">다른 기기와 내용이 달라요</b> — [지금 동기화]를 눌러 고르세요',
  };
  return map[sync.status] ?? (sync.dirty ? '서버에 올릴 변경이 있어요' : t ? `서버에 저장됨 · ${t}` : '서버와 맞추는 중…');
}

/** 오늘·이번 달 영수증 인식 횟수 (한도는 마지막 인식 때 서버가 알려 준 값) */
async function showOcrUsage(el) {
  try {
    const { data, error } = await (await client()).rpc('ocr_usage_now');
    if (error) throw error;
    const { lastUsage } = await import('../ocr.js');
    const lim = lastUsage?.limits;
    if (el.isConnected)
      el.textContent = `오늘 ${num(data.day)}회${lim ? ` / ${num(lim.day)}회` : ''} · 이번 달 ${num(data.month)}회${lim ? ` / ${num(lim.month)}회` : ''} 사용`;
  } catch {
    if (el.isConnected) el.textContent = '사용량을 불러오지 못했어요.';
  }
}

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
          <div class="account-row"><p class="small sync-line">${syncLine()}</p><button type="button" class="btn ghost small-btn" data-act="sync-now">지금 동기화</button></div>
          <p class="muted small">장부는 계정에 저장되어 다른 기기에서 로그인해도 볼 수 있어요.</p>

          <h3 class="sub">영수증 자동 인식</h3>
          <p class="small ocr-usage">사용량 확인 중…</p>
          <p class="muted small">사진은 코스트노트 서버를 거쳐 Claude 가 읽습니다. 인식이 끝나면 사진은 서버에 남기지 않아요.</p>

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
          <p class="muted small">장부는 서버(계정)와 이 기기에 함께 저장됩니다. 백업 파일은 만일을 위한 추가 사본이에요.</p>
        </form>`;
      const form = body.querySelector('form');
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        store.setCategories(form.elements.cats.value.split('\n'));
        toast('설정을 저장했습니다.');
        close();
      });
      showOcrUsage(body.querySelector('.ocr-usage'));
      const unsubSync = sync.subscribe(() => {
        const el = body.querySelector('.sync-line');
        if (el?.isConnected) el.innerHTML = syncLine();
        else unsubSync();
      });
      body.querySelector('[data-act=sync-now]').addEventListener('click', () => sync.now());
      body.querySelector('[data-act=logout]').addEventListener('click', async () => {
        const warn = sync.dirty ? '\n\n⚠ 아직 서버에 올라가지 않은 변경이 있어요. 인터넷에 연결한 뒤 로그아웃하는 걸 권해요.' : '';
        if (!confirm(`로그아웃할까요?${warn}`)) return;
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
