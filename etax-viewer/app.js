import { readSecureMail, openSecureMail, parseInvoiceXml, normalizeId, PAYMENT_TYPES } from './etax.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'etax-viewer:bizno';

const store = {
  get() { try { return localStorage.getItem(STORE_KEY) || ''; } catch { return ''; } },
  set(v) { try { localStorage.setItem(STORE_KEY, v); } catch { /* 저장 못 해도 동작에는 문제 없음 */ } },
  clear() { try { localStorage.removeItem(STORE_KEY); } catch { /* 무시 */ } },
};

let mail = null;
let opened = null;

// ---------- 표시용 글자 ----------
const won = (n) => (n == null ? '' : `${n.toLocaleString('ko-KR')}원`);
const plain = (n) => (n == null ? '' : n.toLocaleString('ko-KR', { maximumFractionDigits: 4 }));
const ymd = (s) => (s && s.length >= 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s || '');
const ymdhm = (s) => (s && s.length >= 12 ? `${ymd(s)} ${s.slice(8, 10)}:${s.slice(10, 12)}` : ymd(s));
const bizno = (s) => (s && s.length === 10 ? `${s.slice(0, 3)}-${s.slice(3, 5)}-${s.slice(5)}` : s || '');
const issueNo = (s) => (s && s.length === 24 ? `${s.slice(0, 8)}-${s.slice(8, 16)}-${s.slice(16)}` : s || '');

// 데이터는 모두 textContent 로만 넣음 (파일 속 글자가 HTML 로 실행되지 않게)
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (typeof props === 'string') el.className = props;
  else if (props) Object.assign(el, props);
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

function rows(pairs) {
  return h('dl', null, pairs.filter(([, v]) => v).flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)]));
}

function partyCard(title, p) {
  if (!p) return null;
  return h('section', 'card',
    h('h2', null, title),
    h('div', 'party-name', p.name),
    rows([
      ['등록번호', bizno(p.id) + (p.subId && p.subId !== '0' ? ` (종사업장 ${p.subId})` : '')],
      ['대표자', p.ceo],
      ['주소', p.address],
      ['업태', p.bizType],
      ['종목', p.bizItem],
      ['이메일', [p.email, p.email2].filter(Boolean).join(', ')],
    ]),
  );
}

function renderSummary(inv) {
  const payments = inv.payments
    .filter((p) => p.amount)
    .map((p) => `${PAYMENT_TYPES[p.type] || p.type} ${won(p.amount)}`)
    .join(', ');
  const head = h('section', 'card',
    h('div', 'kind',
      h('span', 'tag', inv.kind),
      inv.detail && inv.detail !== '일반' ? h('span', 'tag', inv.detail) : null,
      inv.purpose ? h('span', 'tag', `${inv.purpose}함`) : null,
    ),
    h('div', 'total', won(inv.grandTotal)),
    h('div', 'sub', `공급가액 ${won(inv.supplyTotal)}` + (inv.kind.includes('세금') ? ` · 세액 ${won(inv.taxTotal)}` : '')),
    h('div', 'meta',
      `작성일자 ${ymd(inv.date)}`, h('br'),
      `승인번호 ${issueNo(inv.issueId)}`,
      inv.originalIssueId ? [h('br'), `당초 승인번호 ${issueNo(inv.originalIssueId)}`] : null,
      payments ? [h('br'), `결제 ${payments}`] : null,
    ),
  );
  const items = h('section', 'card',
    h('h2', null, `품목 ${inv.items.length}개`),
    inv.items.map((it) => h('div', 'item',
      h('div', 'item-name', it.name || '(품목명 없음)', it.spec ? ` · ${it.spec}` : ''),
      h('div', 'item-row',
        h('span', null, [ymd(it.date), it.quantity ? `${plain(it.quantity)}개` : '', it.unitPrice ? `단가 ${won(it.unitPrice)}` : ''].filter(Boolean).join(' · ')),
        h('b', null, won(it.supply)),
      ),
      it.tax ? h('div', 'item-row', h('span', null, '세액'), h('span', null, won(it.tax))) : null,
      it.note ? h('div', 'item-row', h('span', null, `비고: ${it.note}`)) : null,
    )),
  );
  const notes = inv.notes.length
    ? h('section', 'card', h('h2', null, '비고'), h('div', { style: 'white-space: pre-line' }, inv.notes.join('\n')))
    : null;
  const cards = [head, items, partyCard('공급자', inv.supplier), partyCard('공급받는자', inv.buyer),
    partyCard('수탁자', inv.broker), notes];
  $('summary').replaceChildren(...cards.filter(Boolean));
  document.title = `${inv.supplier?.name || '세금계산서'} ${won(inv.grandTotal)}`;
}

// ---------- 원본 화면 ----------
// 스크립트는 막고(sandbox), 바깥 이미지·연결도 막음(CSP) → 국세청 읽음 확인 이미지도 불러오지 않음
const FRAME_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";

function showOriginal() {
  const box = $('original');
  if (!box.firstChild) {
    const frame = h('iframe', { title: '세금계산서 원본 화면' });
    frame.setAttribute('sandbox', 'allow-same-origin');
    frame.srcdoc = `<meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">` + opened.body;
    frame.addEventListener('load', () => fitFrame(frame));
    box.append(frame);
  }
  box.hidden = false;
}

function fitFrame(frame) {
  const doc = frame.contentDocument;
  if (!doc) return;
  const box = frame.parentElement;
  frame.style.width = '800px';
  const w = Math.max(doc.documentElement.scrollWidth, 320);
  frame.style.width = `${w}px`;
  const hgt = doc.documentElement.scrollHeight;
  frame.style.height = `${hgt}px`;
  const scale = Math.min(1, box.clientWidth / w);
  frame.style.transform = `scale(${scale})`;
  box.style.height = `${Math.ceil(hgt * scale)}px`;
}

// ---------- 흐름 ----------
function showError(msg) {
  $('error').textContent = msg;
  $('error').hidden = !msg;
}

function reset() {
  mail = null;
  opened = null;
  $('file').value = '';
  $('step-file').hidden = false;
  $('step-id').hidden = true;
  $('result').hidden = true;
  $('original').hidden = true;
  $('original').replaceChildren();
  $('original').style.height = '';
  $('toggle-original').textContent = '원본 화면 보기';
  document.title = '세금계산서 뷰어';
  showError('');
}

async function loadFile(file) {
  reset();
  try {
    mail = readSecureMail(await file.text());
  } catch (e) {
    $('step-id').hidden = false;
    $('id-form').hidden = true;
    $('filename').textContent = file.name;
    showError(e.message || '파일을 읽지 못했어요.');
    return;
  }
  $('filename').textContent = `${file.name} · 첨부 ${mail.attachments.map((a) => a.name).join(', ') || '없음'}`;
  $('id-form').hidden = false;
  $('step-id').hidden = false;
  const saved = store.get();
  $('bizno').value = saved;
  if (saved && (await tryOpen(saved, true))) return;
  $('bizno').focus();
}

async function tryOpen(id, quiet) {
  try {
    opened = await openSecureMail(mail, id);
  } catch (e) {
    if (!quiet) showError(e.message);
    return false;
  }
  showError('');
  if ($('remember').checked) store.set(normalizeId(id));
  updateForget();

  const xml = opened.attachments.find((a) => /\.xml$/i.test(a.name)) || opened.attachments[0];
  const inv = xml ? parseInvoiceXml(xml.text) : null;
  $('step-file').hidden = true;
  $('step-id').hidden = true;
  $('result').hidden = false;
  $('save-xml').hidden = !xml;
  if (inv) {
    renderSummary(inv);
  } else {
    $('summary').replaceChildren(h('section', 'card', '요약할 수 있는 XML 이 없어 원본 화면을 보여드려요.'));
    showOriginal();
    $('toggle-original').textContent = '원본 화면 닫기';
  }
  window.scrollTo(0, 0);
  return true;
}

function saveXml() {
  const xml = opened.attachments.find((a) => /\.xml$/i.test(a.name)) || opened.attachments[0];
  const url = URL.createObjectURL(new Blob([xml.bytes], { type: 'application/xml' }));
  const a = h('a', { href: url, download: xml.name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function updateForget() {
  $('forget').hidden = !store.get();
}

$('file').addEventListener('change', (e) => {
  const f = e.target.files?.[0];
  if (f) loadFile(f);
});

$('id-form').addEventListener('submit', (e) => {
  e.preventDefault();
  tryOpen($('bizno').value, false);
});

$('remember').addEventListener('change', (e) => {
  if (!e.target.checked) { store.clear(); updateForget(); }
});

$('toggle-original').addEventListener('click', () => {
  const box = $('original');
  if (box.hidden) {
    showOriginal();
    $('toggle-original').textContent = '원본 화면 닫기';
  } else {
    box.hidden = true;
    $('toggle-original').textContent = '원본 화면 보기';
  }
});

$('save-xml').addEventListener('click', saveXml);
$('again').addEventListener('click', () => { reset(); $('file').click(); });
$('forget').addEventListener('click', () => { store.clear(); $('bizno').value = ''; updateForget(); });

window.addEventListener('resize', () => {
  const f = $('original').querySelector('iframe');
  if (f && !$('original').hidden) fitFrame(f);
});

// PC: 파일을 끌어다 놓기
for (const ev of ['dragenter', 'dragover']) {
  document.addEventListener(ev, (e) => { e.preventDefault(); document.body.classList.add('drag'); });
}
for (const ev of ['dragleave', 'drop']) {
  document.addEventListener(ev, (e) => { e.preventDefault(); document.body.classList.remove('drag'); });
}
document.addEventListener('drop', (e) => {
  const f = e.dataTransfer?.files?.[0];
  if (f) loadFile(f);
});

updateForget();
