// 매입 추가: 촬영/앨범/직접 입력 메뉴 → (여러 장이면 합칠지 묻기) → Claude 인식 → 확인 화면
import { todayStr } from '../lib/format.js';
import { draftFromOcr } from '../lib/draft.js';
import { openSheet, showBusy, toast } from '../ui/sheet.js';
import { store } from '../store.js';
import { view, goToMonth } from '../state.js';
import { openEditor } from './editor.js';

let captureDate = null; // 날짜 화면에서 열었으면 그 날짜 (영수증에서 날짜를 못 읽을 때 사용)

function startCapture(source, date = null) {
  captureDate = date;
  const input = document.getElementById(source === 'camera' ? 'cam' : 'gallery');
  input.value = '';
  input.click();
}

/** 촬영 / 앨범 / 직접 입력 선택 메뉴. date 가 있으면 그 날짜 화면에서 연 것 */
export function openCaptureMenu(date = null) {
  const [, m, d] = (date || '').split('-').map(Number);
  openSheet({
    title: date ? `${m}월 ${d}일 매입 추가` : '매입 내역 추가',
    render(body, close) {
      body.innerHTML = `
        <div class="menu">
          <button class="menu-btn" data-src="camera"><span aria-hidden="true">📷</span>카메라로 촬영<small>영수증·거래명세서를 바로 찍기</small></button>
          <button class="menu-btn" data-src="gallery"><span aria-hidden="true">🖼</span>앨범에서 선택<small>여러 장을 한 번에 인식</small></button>
          <button class="menu-btn" data-src="manual"><span aria-hidden="true">✍️</span>직접 입력</button>
        </div>
        ${date ? `<p class="muted small menu-note">영수증에 날짜가 있으면 그 날짜로, 날짜를 읽지 못하면 ${m}월 ${d}일로 들어갑니다.</p>` : ''}`;
      body.addEventListener('click', (e) => {
        const b = e.target.closest('[data-src]');
        if (!b) return;
        close();
        if (b.dataset.src === 'manual') openEditor({ date: date || todayStr() });
        else startCapture(b.dataset.src, date);
      });
    },
  });
}

/** 여러 장을 골랐을 때: 영수증 한 장을 나눠 찍은 것인지, 각각 다른 영수증인지 묻기 */
function askMerge(count) {
  return new Promise((resolve) => {
    let answer = null;
    openSheet({
      title: `사진 ${count}장을 골랐습니다`,
      onClose: () => resolve(answer),
      render(body, close) {
        body.innerHTML = `
          <div class="menu">
            <button class="menu-btn" data-merge="merge"><span aria-hidden="true">🧾</span>영수증 한 장이에요<small>긴 영수증을 나눠 찍은 사진 → 한 건으로 합쳐 인식</small></button>
            <button class="menu-btn" data-merge="separate"><span aria-hidden="true">🗂</span>각각 다른 영수증이에요<small>사진마다 한 건씩 따로 인식</small></button>
          </div>
          <p class="muted small menu-note">한 장으로 합칠 때는 영수증 위쪽부터 순서대로 골라 주세요.</p>`;
        body.addEventListener('click', (e) => {
          const b = e.target.closest('[data-merge]');
          if (!b) return;
          answer = b.dataset.merge;
          close();
        });
      },
    });
  });
}

async function handleFiles(files) {
  if (!files.length) return;
  const fallbackDate = captureDate || view.selectedDate || todayStr();

  let groups = files.map((f) => [f]);
  if (files.length > 1) {
    const how = await askMerge(files.length);
    if (!how) return;
    if (how === 'merge') groups = [files];
  }

  const label = groups.length > 1 ? (n) => `영수증 인식 중… (${n}/${groups.length})` : () => `영수증 인식 중… (사진 ${files.length}장)`;
  const busy = showBusy(label(0));
  let results;
  try {
    // 인식 코드는 처음 인식할 때만 불러옴 (앱 첫 화면을 가볍게)
    const { extractReceipt } = await import('../ocr.js');
    let done = 0;
    results = await Promise.allSettled(
      groups.map((g) =>
        extractReceipt(g, { categories: store.categories, knownVendors: store.vendorNames() }).finally(() => busy.update(label(++done))),
      ),
    );
  } catch (err) {
    // 인식 코드를 못 불러온 경우(오프라인 등): 모두 직접 입력으로
    results = groups.map(() => ({ status: 'rejected', reason: err }));
  } finally {
    busy.done();
  }

  let lastSaved = null;
  for (let i = 0; i < groups.length; i++) {
    const r = results[i];
    const saved =
      r.status === 'fulfilled'
        ? await openEditor(...withNote(draftFromOcr(r.value, fallbackDate, (n) => store.index.spec(n)), groups[i]))
        : await openEditor({ date: fallbackDate }, { imageFiles: groups[i], note: `자동 인식 실패: ${r.reason?.message || r.reason}` });
    if (saved) lastSaved = saved;
  }
  if (lastSaved && !view.selectedDate) goToMonth(lastSaved.date);
}

const withNote = ({ draft, note }, imageFiles) => [draft, { imageFiles, note }];

/** 한가할 때 인식 코드를 미리 받아 둠 (첫 촬영이 기다리지 않게, 서비스워커가 오프라인용으로 보관) */
export function preloadOcr() {
  const run = () => import('../ocr.js').catch(() => {});
  if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 5000 });
  else setTimeout(run, 2000);
}

export function bindCaptureInputs() {
  for (const id of ['cam', 'gallery']) document.getElementById(id).addEventListener('change', (e) => handleFiles([...e.target.files]));
}
