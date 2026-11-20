// 운영비 → 월말 판매 불러오기: 포스(페이히어) 매출 엑셀 + 네이버페이 주문 엑셀(비밀번호)을 기기 안에서 읽어
// 한 달 매출·메뉴별 판매 수량을 계산하고, 판매 이름을 앱 메뉴와 이어 줌 (한 번 이으면 기억)
import { esc, num } from '../lib/format.js';
import { openSheet, toast } from '../ui/sheet.js';
import { store } from '../store.js';
import { menuCost, bottleCost } from '../lib/cost.js';
import { detectSalesFile, parseNaver, parsePayhere, combineSales, suggestMenu, analyzeSales } from '../lib/salesImport.js';

const won = (n) => `${num(n)}원`;
const ymLabel = (ym) => `${Number(ym.slice(0, 4))}년 ${Number(ym.slice(5, 7))}월`;
const dayLabel = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

/** 메뉴 원가·판매가 (보틀 판매면 보틀 기준). 원가를 모르면 cost=null */
export function menuInfo(id, kind = 'glass') {
  const m = store.menus.find((x) => x.id === id);
  if (!m) return null;
  if (kind === 'bottle') {
    const b = bottleCost(m, store.index);
    return { id, name: m.name, cost: b ? b.cost : null, price: m.bottlePrice || 0 };
  }
  const c = menuCost(m, store.index);
  const none = !c.parts.length || c.missing === c.parts.length;
  return { id, name: m.name, cost: none ? null : c.cost, price: Number(m.price) || 0 };
}

/**
 * @param {{ links: Record<string,string>, dayStart: number, onDone: (r: {ym, month, links, dayStart}) => void }} opts
 */
export function openSalesImport({ links: savedLinks = {}, dayStart: savedDayStart = 6, onDone }) {
  const files = []; // { name, u8, kind, parsed, needPw, err }
  let dayStart = savedDayStart;
  const links = { ...savedLinks };
  const touched = new Set();
  let result = null;

  openSheet({
    title: '판매 파일 불러오기',
    render(body, close) {
      body.innerHTML = `
        <div class="si">
          <section class="set-card set-pad">
            <p class="si-lead">월말에 <b>포스 매출 파일</b>과 <b>네이버 주문 파일</b>(엑셀)을 올리면 한 달 매출과 메뉴별 판매 수량을 계산해요.</p>
            <ul class="si-how">
              <li><b>페이히어</b>: 백오피스 → 매출 리포트 → 엑셀 받기 (매출 내역·상품별이 든 파일)</li>
              <li><b>네이버페이</b>: 판매자센터 → 구매확정 내역 → 엑셀 받기 (비밀번호 파일도 괜찮아요)</li>
            </ul>
            <label class="btn primary si-pick">엑셀 파일 고르기<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" multiple data-files hidden></label>
            <ul class="si-files" aria-live="polite"></ul>
            <label class="si-day">하루 시작 시각
              <select data-daystart>${Array.from({ length: 13 }, (_, h) => `<option value="${h}"${h === dayStart ? ' selected' : ''}>${h === 0 ? '자정 (0시)' : `${h}시`}</option>`).join('')}</select>
            </label>
            <p class="set-note">이 시각 전에 찍힌 <b>포스</b> 결제는 전날 영업일로 쳐요 (새벽 마감, 다음 날 아침에 넣은 기타 결제). 네이버 주문은 결제한 날짜 그대로 봐요. 파일은 이 기기 안에서만 읽고 서버로 보내지 않아요.</p>
          </section>
          <div class="si-result" aria-live="polite"></div>
          <div class="actions">
            <button type="button" class="btn ghost cancel">닫기</button>
            <button type="button" class="btn primary" data-save disabled>저장</button>
          </div>
        </div>`;
      const listEl = body.querySelector('.si-files');
      const resEl = body.querySelector('.si-result');
      const saveBtn = body.querySelector('[data-save]');

      const KIND = { payhere: '포스(페이히어) 매출', naver: '네이버페이 주문' };
      const drawFiles = () => {
        listEl.innerHTML = files
          .map(
            (f, i) => `<li data-i="${i}"><span class="grow">${esc(f.name)}<small>${
              f.kind ? `${KIND[f.kind]} ✓` : f.err ? esc(f.err) : f.needPw ? '비밀번호가 걸린 파일이에요' : '읽는 중…'
            }</small></span>${
              f.needPw
                ? `<input type="password" inputmode="numeric" autocomplete="off" placeholder="비밀번호" aria-label="${esc(f.name)} 비밀번호" data-pw="${i}"><button type="button" class="btn ghost small-btn" data-open="${i}">열기</button>`
                : ''
            }<button type="button" class="icon-btn" data-rm="${i}" aria-label="${esc(f.name)} 빼기">✕</button></li>`,
          )
          .join('');
      };

      const recompute = () => {
        const payhere = files.find((f) => f.kind === 'payhere');
        const naver = files.find((f) => f.kind === 'naver');
        if (!payhere && !naver) {
          result = null;
          resEl.innerHTML = '';
          saveBtn.disabled = true;
          return;
        }
        result = combineSales({ payhere: payhere && parsePayhere(payhere.parsed, dayStart), naver: naver && parseNaver(naver.parsed.sheet) });
        drawResult();
      };

      const options = (sel) => {
        const menus = [...store.menus].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
        return `<option value="">— 메뉴 아님 / 나중에 —</option>${menus.map((m) => `<option value="${esc(m.id)}"${m.id === sel ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}`;
      };

      const drawResult = () => {
        const r = result;
        if (!r?.ym) {
          resEl.innerHTML = '<p class="set-note">파일에서 매출을 찾지 못했어요. 받은 파일이 맞는지 확인해 주세요.</p>';
          saveBtn.disabled = true;
          return;
        }
        // 연결 추천 (처음 보는 이름만)
        for (const it of r.items) if (!(it.key in links) && !touched.has(it.key)) {
          const sg = suggestMenu(it.key, store.menus, {});
          it.suggest = sg;
        }
        const chosen = (it) => (it.key in links ? links[it.key] : it.suggest?.menuId || '');
        const linked = r.items.filter((it) => chosen(it)).length;
        const hasPos = files.some((f) => f.kind === 'payhere');
        const hasNaver = files.some((f) => f.kind === 'naver');
        resEl.innerHTML = `
          <section class="set-card set-pad si-sum">
            <h3>${ymLabel(r.ym)}</h3>
            <p class="ops-need"><span>${hasPos ? '실매출 (포스)' : '매출 (네이버 주문만)'}</span><b>${won(r.sales)}</b></p>
            <p class="ops-sub">판매 <b>${num(r.qty)}</b>잔·접시${r.items.some((i) => i.kind === 'bottle') ? ` · 보틀 ${num(r.items.filter((i) => i.kind === 'bottle').reduce((t, i) => t + i.qty, 0))}병` : ''}${hasNaver ? ` · 네이버 주문 ${num(r.orders)}건` : ''}${r.reserved.count ? ` · 예약금 ${r.reserved.count}건 뺌` : ''}</p>
            ${!hasPos ? '<p class="set-note">포스 파일도 올리면 매장 결제까지 합친 매출이 나와요.</p>' : ''}
            ${
              hasPos && hasNaver
                ? `<p class="ops-sub">네이버 주문 ${won(r.naverTotal)} · 포스 기타 결제 ${won(r.etcTotal)}${r.etcTotal !== r.naverTotal ? ` <span class="${Math.abs(r.etcTotal - r.naverTotal) > 50000 ? 'warn' : 'muted'}">(차이 ${r.etcTotal > r.naverTotal ? '+' : '−'}${won(Math.abs(r.etcTotal - r.naverTotal))})</span>` : ' ✓'}</p>${
                    r.mismatch.length
                      ? `<details class="si-mis"><summary>날짜별로 1만 원 넘게 다른 날 ${r.mismatch.length}일</summary><ul>${r.mismatch
                          .map((m) => `<li><span class="grow">${dayLabel(m.day)}<small>네이버 ${won(m.naver)} · 기타 결제 ${won(m.etc)}</small></span><b>${m.diff > 0 ? '+' : '−'}${won(Math.abs(m.diff))}</b></li>`)
                          .join('')}</ul><p class="set-note">하루 늦게 넣은 날은 앞뒤 날짜가 서로 상쇄돼요. 혼자 다른 날만 확인해 보세요.</p></details>`
                      : ''
                  }`
                : ''
            }
            ${r.otherMonths.length ? `<p class="set-note">파일에 ${r.otherMonths.map(ymLabel).join(', ')} 매출도 조금 있어서 빼고 ${ymLabel(r.ym)}만 셌어요.${hasPos ? ' 포스 <b>상품별 수량</b>은 파일 기간 전체 기준이에요.' : ''}</p>` : ''}
          </section>
          <section>
            <h3 class="set-title">메뉴 연결 <small>${linked} / ${r.items.length}개 연결됨</small></h3>
            <p class="set-note">판매 이름을 앱 메뉴와 이어 주면 원가로 계산해요. 한 번 이으면 다음 달부터 기억해요. <b>확인</b> 표시는 이름이 비슷해서 제가 고른 거예요.</p>
            <div class="set-card list si-links">${r.items
              .map((it) => {
                const sel = chosen(it);
                const guess = !(it.key in links) && it.suggest?.menuId && !it.suggest.sure;
                return `<div class="si-link" data-key="${esc(it.key)}"><span class="grow">${esc(it.name)}${it.kind === 'bottle' ? ' <em class="tag">보틀</em>' : ''}${guess ? ' <em class="tag warn">확인</em>' : ''}<small>${num(it.qty)}${it.kind === 'bottle' ? '병' : '개'}${it.pos && it.naver ? ` (매장 ${num(it.pos)} · 네이버 ${num(it.naver)})` : it.naver ? ' (네이버)' : ''}</small></span><select aria-label="${esc(it.name)} 메뉴">${options(sel)}</select></div>`;
              })
              .join('')}</div>
          </section>`;
        saveBtn.disabled = false;
      };

      const readFile = async (f) => {
        try {
          const [{ readXlsx }, crypto] = await Promise.all([import('../lib/xlsx.js'), import('../lib/officeCrypto.js')]);
          let u8 = f.u8;
          if (crypto.isCfb(u8)) {
            if (f.pw == null) {
              f.needPw = true;
              return;
            }
            try {
              u8 = crypto.decryptOffice(u8, f.pw);
            } catch (e) {
              f.err = e instanceof crypto.WrongPassword ? '비밀번호가 맞지 않아요' : '열 수 없는 암호 방식이에요';
              f.needPw = e instanceof crypto.WrongPassword;
              return;
            }
          }
          const d = detectSalesFile(readXlsx(u8));
          f.needPw = false;
          if (!d) f.err = '포스·네이버 매출 파일이 아니에요';
          else if (files.some((x) => x !== f && x.kind === d.kind)) f.err = `${KIND[d.kind]} 파일은 하나만 올려 주세요`;
          else (f.kind = d.kind), (f.parsed = d), (f.err = '');
        } catch {
          f.err = '엑셀(.xlsx) 파일을 읽지 못했어요';
          f.needPw = false;
        }
      };

      body.querySelector('[data-files]').addEventListener('change', async (e) => {
        for (const file of e.target.files) {
          const f = { name: file.name, u8: new Uint8Array(await file.arrayBuffer()) };
          files.push(f);
          drawFiles();
          await readFile(f);
        }
        e.target.value = '';
        drawFiles();
        recompute();
        body.querySelector('[data-pw]')?.focus();
      });
      const openWithPw = async (i) => {
        const f = files[i];
        f.pw = body.querySelector(`[data-pw="${i}"]`)?.value ?? '';
        if (!f.pw) return;
        f.err = '';
        listEl.querySelector(`[data-i="${i}"] small`).textContent = '여는 중…';
        await new Promise((r) => setTimeout(r, 30)); // 글자 먼저 보이게
        await readFile(f);
        drawFiles();
        recompute();
        if (f.needPw) body.querySelector(`[data-pw="${i}"]`)?.focus();
      };
      body.addEventListener('click', (e) => {
        const op = e.target.closest('[data-open]');
        const rm = e.target.closest('[data-rm]');
        if (op) openWithPw(Number(op.dataset.open));
        else if (rm) {
          files.splice(Number(rm.dataset.rm), 1);
          drawFiles();
          recompute();
        }
      });
      body.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.dataset.pw != null) {
          e.preventDefault();
          openWithPw(Number(e.target.dataset.pw));
        }
      });
      body.addEventListener('change', (e) => {
        if (e.target.matches('[data-daystart]')) {
          dayStart = Number(e.target.value);
          recompute();
        } else if (e.target.closest('.si-link')) {
          const key = e.target.closest('.si-link').dataset.key;
          links[key] = e.target.value;
          touched.add(key);
          const head = body.querySelector('.si-links')?.previousElementSibling?.previousElementSibling?.querySelector('small');
          if (head && result) head.textContent = `${result.items.filter((it) => (it.key in links ? links[it.key] : it.suggest?.menuId)).length} / ${result.items.length}개 연결됨`;
          e.target.closest('.si-link').querySelector('.tag.warn')?.remove();
        }
      });
      body.querySelector('.cancel').addEventListener('click', close);
      saveBtn.addEventListener('click', () => {
        if (!result?.ym) return;
        // 추천으로 고른 연결도 저장 (사장님이 안 바꾼 것 = 동의). '메뉴 아님'은 직접 고른 것만 기억
        for (const it of result.items) {
          if (it.key in links) continue;
          if (it.suggest?.menuId) links[it.key] = it.suggest.menuId;
        }
        const month = {
          sales: result.sales,
          naverTotal: result.naverTotal,
          etcTotal: result.etcTotal,
          qty: result.qty,
          at: new Date().toISOString().slice(0, 16),
          items: result.items.map(({ key, name, qty, pos, naver, unitPrice, kind }) => ({ key, name, qty, pos, naver, unitPrice, kind })),
          mismatch: result.mismatch,
        };
        onDone({ ym: result.ym, month, links, dayStart });
        toast(`${ymLabel(result.ym)} 판매를 저장했어요.`);
        close();
      });
    },
  });
}

/** 운영비 화면에 보이는 판매 분석 (가장 최근에 불러온 달) */
export function salesAnalysisHtml(ops, need, materialOf) {
  const yms = Object.keys(ops.salesMonths || {}).sort();
  const ym = yms.at(-1);
  if (!ym) return '';
  const m = ops.salesMonths[ym];
  const a = analyzeSales(m, ops.salesLinks || {}, menuInfo);
  const material = materialOf(ym);
  const perActual = m.qty ? Math.ceil(need / m.qty) : null;
  const top = a.rows.filter((r) => r.kind !== 'bottle').slice(0, 5);
  return `<div class="set-card set-pad si-ana">
    <h4>${ymLabel(ym)} 판매 분석</h4>
    <ul class="ops-rows">
      <li><span class="grow">실제 판매<small>파일에서 센 잔·접시 수</small></span><b>${num(m.qty)}잔</b></li>
      ${perActual ? `<li><span class="grow">실제 판매 기준 잔당 최소 마진<small>${won(need)} ÷ ${num(m.qty)}잔</small></span><b>${won(perActual)}</b></li>` : ''}
      <li><span class="grow">레시피대로라면 쓴 재료비<small>메뉴와 연결된 ${num(a.linkedQty)}개 × 메뉴 원가</small></span><b>${won(a.theory)}</b></li>
      <li><span class="grow">그달 재료 매입<small>장부 기준 (비품·시설·광고 빼고)</small></span><b>${won(material)}</b></li>
    </ul>
    ${
      a.linkedQty && material
        ? `<p class="set-note">${
            material > a.theory
              ? `매입이 레시피보다 <b>${won(material - a.theory)}</b> 많아요. 재고로 남았거나, 넉넉히 따르기·서비스·깨짐으로 나간 돈이에요. 연결 안 된 메뉴의 재료도 여기 들어 있어서, 연결이 늘수록 정확해져요.`
              : '레시피대로 쓴 재료비가 매입보다 많아요. 그달 매입이 장부에 다 안 들어갔거나, 전달 재고를 썼을 수 있어요.'
          }</p>`
        : ''
    }
    <p class="si-top"><b>많이 팔린 메뉴</b> ${top.map((r) => `${esc(r.name)} ${num(r.qty)}`).join(' · ')}</p>
    ${a.unlinkedTop.length ? `<p class="si-top"><b>원가 연결 안 된 인기 메뉴</b> ${a.unlinkedTop.slice(0, 5).map((r) => `${esc(r.name)} ${num(r.qty)}`).join(' · ')}</p>` : ''}
    ${m.qty && m.qty !== ops.monthlyGlasses ? `<button type="button" class="btn ghost small-btn" data-useqty="${m.qty}">예상 판매를 실제 ${num(m.qty)}잔으로</button>` : ''}
  </div>`;
}
