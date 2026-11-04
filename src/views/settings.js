// 설정: Claude API 키·모델, 분류 목록, CSV 내보내기, 백업/복원
import { esc, todayStr } from '../lib/format.js';
import { purchasesCsv } from '../lib/csv.js';
import { download } from '../ui/download.js';
import { openSheet, toast } from '../ui/sheet.js';
import { store, MODELS } from '../store.js';
import { monthKey } from '../state.js';
import { monthPurchases } from './purchase.js';

export function openSettings() {
  openSheet({
    title: '설정',
    render(body, close) {
      const s = store.settings;
      body.innerHTML = `
        <form class="settings">
          <h3 class="sub">영수증 자동 인식 (Claude API)</h3>
          <label>API 키<input name="apiKey" type="password" autocomplete="off" placeholder="sk-ant-..." value="${esc(s.apiKey)}"></label>
          <p class="muted small">키는 이 기기의 브라우저에만 저장되고 Anthropic API 로만 전송됩니다. 키는 console.anthropic.com 에서 발급받을 수 있습니다.</p>
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
          <p class="muted small">데이터는 이 기기에만 저장됩니다. 기기를 바꾸거나 브라우저 데이터를 지우기 전에 백업하세요.</p>
        </form>`;
      const form = body.querySelector('form');
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        store.saveSettings({ apiKey: form.elements.apiKey.value.trim(), model: form.elements.model.value });
        store.setCategories(form.elements.cats.value.split('\n'));
        toast('설정을 저장했습니다.');
        close();
      });
      body.querySelector('[data-act=csv]').addEventListener('click', () => download(`매입_${monthKey()}.csv`, purchasesCsv(monthPurchases()), 'text/csv'));
      body.querySelector('[data-act=backup]').addEventListener('click', () => download(`매입장부_백업_${todayStr()}.json`, store.exportData(), 'application/json'));
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
