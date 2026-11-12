// 국세청 전자세금계산서 보안메일(NTS_eTaxInvoice.html) 해독 + 표준 XML 읽기
// 모든 계산은 브라우저 안에서만 합니다. 서버로 보내는 것은 없습니다.
//
// 파일 구조 (실제 메일 첨부파일로 확인)
//   idCriHeader          : Base64 → 바이트마다 XOR 0x6B → "이름:값" 줄 (암호 방식, HashKey, 첨부 이름 등)
//   idCriPcContents      : 세금계산서 화면(HTML) 암호문 (Base64)
//   idCriAttachContentsN : 첨부파일 암호문 (Base64). 해독하면 다시 Base64 → 국세청 표준 XML
//   열쇠 = MD5(사업자등록번호 숫자), IV = 0 (16바이트), CBC + PKCS#7
//   HashKey 를 해독한 글자가 열쇠의 16진수 표기와 같으면 비밀번호가 맞음

// ---------- 작은 도구 ----------
const utf8 = new TextDecoder('utf-8');

export function base64ToBytes(b64) {
  const bin = atob(String(b64).replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

// UTF-8 이 아니면 옛 한글 인코딩(EUC-KR/CP949)으로 읽음
export function decodeText(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('euc-kr').decode(bytes);
  }
}

// ---------- MD5 (RFC 1321) ----------
const MD5_S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const MD5_K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

export function md5(input) {
  const msg = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const len = ((msg.length + 8) >>> 6 << 6) + 64;
  const buf = new Uint8Array(len);
  buf.set(msg);
  buf[msg.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(len - 8, (msg.length * 8) >>> 0, true);
  view.setUint32(len - 4, Math.floor(msg.length / 0x20000000), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let off = 0; off < len; off += 64) {
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const s = MD5_S[(i >> 4) * 4 + (i % 4)];
      const t = (a + f + MD5_K[i] + view.getUint32(off + g * 4, true)) | 0;
      a = d; d = c; c = b;
      b = (b + ((t << s) | (t >>> (32 - s)))) | 0;
    }
    a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0;
  }
  const out = new Uint8Array(16);
  const ov = new DataView(out.buffer);
  [a0, b0, c0, d0].forEach((w, i) => ov.setUint32(i * 4, w, true));
  return out;
}

// ---------- SEED (KISA, RFC 4269) ----------
// S-box 두 개만 두고 나머지 표(SS0~SS3, KC)는 표준 정의대로 계산해서 만듦
const S1 = hexToBytes(
  'a985d6d3541dac255d43181e51fcca632844209de0e2c817a58f037bbb13d2ee708c3fa832ddf674ec950b575c5bbd01241c739810ccf2d92ce772839bd186c9' +
  '6050a3eb0db69e4fb75ac678a612afd561c3b441527d8d081f9900190453f7e1fd762f27b08b0eaba26e934d697c090abfeff3c58714fe64de2e4b1a06216b66' +
  '02f5928a0cb37ed07a4796e52680addfa13037ae36152238f4a7454c81e9849735cbce3c7111c78975fbdaf8945982c4ff493967c0cfd7b80f8e4223916cdba4' +
  '34f148c26f3d2d40be3ebcc1aaba4e553bdc687f9cd84a5677a0ed46b52b65fae3b9b19f5ef9e6b231ea6d5fe4f0cd88163a58d462290733e81b0579906a2a9a',
);
const S2 = hexToBytes(
  '38e82da6cfdeb3b8af6055c7446f6b5bc36233b529a0e2a7d39111061cbc364bef886ca817c416f4c245e1d63f3d8e98284ef63ea5f90ddfd82b667a272ff172' +
  '42d441c07367ac8bf7ad801fca2caa34d20beee95d9418f857ae08c513cd86b9ff7dc131f58a6ab1d120d7022204687107db9d9961bee659dd5190dc9aa3abd0' +
  '810f471ae3ec8dbf967b5ca2a163234dc89e9c3a0c2eba6e9f5af292f34978cc15fb70757f351003646dc674d5b4ea097619fe4012e0bd05fa01f02a5ea95643' +
  '8514899bb0e5487997fc1e82218c1b5f7754b21d254f0046ed5852eb7edac9fd3095653cb6e4bb7c0e5039263284699337e724a4cb530a87d94c838fce3b4ab7',
);
const MASK = [0xfc, 0xf3, 0xcf, 0x3f];
const makeSS = (S, r) => Uint32Array.from(S, (s) =>
  (((s & MASK[(3 + r) % 4]) << 24) | ((s & MASK[(2 + r) % 4]) << 16) | ((s & MASK[(1 + r) % 4]) << 8) | (s & MASK[r % 4])) >>> 0);
const SS0 = makeSS(S1, 0), SS1 = makeSS(S2, 1), SS2 = makeSS(S1, 2), SS3 = makeSS(S2, 3);
const KC = Array.from({ length: 16 }, (_, i) => ((0x9e3779b9 << i) | (0x9e3779b9 >>> (32 - i))) >>> 0);

const G = (x) => SS0[x & 255] ^ SS1[(x >>> 8) & 255] ^ SS2[(x >>> 16) & 255] ^ SS3[x >>> 24];

function seedKeySchedule(key) {
  const v = new DataView(key.buffer, key.byteOffset, 16);
  let A = v.getUint32(0), B = v.getUint32(4), C = v.getUint32(8), D = v.getUint32(12);
  const K = new Uint32Array(32);
  for (let i = 0; i < 16; i++) {
    K[2 * i] = G((A + C - KC[i]) >>> 0);
    K[2 * i + 1] = G((B - D + KC[i]) >>> 0);
    if (i % 2 === 0) { const t = A; A = ((A >>> 8) | (B << 24)) >>> 0; B = ((B >>> 8) | (t << 24)) >>> 0; }
    else { const t = C; C = ((C << 8) | (D >>> 24)) >>> 0; D = ((D << 8) | (t >>> 24)) >>> 0; }
  }
  return K;
}

// 블록 하나(16바이트). decrypt=true 이면 라운드 열쇠를 거꾸로 씀
function seedBlock(K, inp, decrypt) {
  const v = new DataView(inp.buffer, inp.byteOffset, 16);
  const W = [v.getUint32(0), v.getUint32(4), v.getUint32(8), v.getUint32(12)]; // L0 L1 R0 R1
  for (let r = 0; r < 16; r++) {
    const k = decrypt ? 15 - r : r;
    const [x, y] = r % 2 === 0 ? [0, 2] : [2, 0]; // 짝수 라운드: L ^= F(R), 홀수: R ^= F(L)
    let t0 = (W[y] ^ K[2 * k]) >>> 0;
    let t1 = (W[y + 1] ^ K[2 * k + 1]) >>> 0;
    t1 = G((t1 ^ t0) >>> 0);
    t0 = G((t0 + t1) >>> 0);
    t1 = G((t1 + t0) >>> 0);
    t0 = (t0 + t1) >>> 0;
    W[x] = (W[x] ^ t0) >>> 0;
    W[x + 1] = (W[x + 1] ^ t1) >>> 0;
  }
  const out = new Uint8Array(16);
  const ov = new DataView(out.buffer);
  [W[2], W[3], W[0], W[1]].forEach((w, i) => ov.setUint32(i * 4, w));
  return out;
}

export function seedEncryptBlock(key, block) { return seedBlock(seedKeySchedule(key), block, false); }
export function seedDecryptBlock(key, block) { return seedBlock(seedKeySchedule(key), block, true); }

function unpad(bytes) {
  const n = bytes[bytes.length - 1];
  if (!n || n > 16 || n > bytes.length) return null;
  for (let i = bytes.length - n; i < bytes.length; i++) if (bytes[i] !== n) return null;
  return bytes.subarray(0, bytes.length - n);
}

// SEED-CBC 해독. 패딩이 깨지면 null (= 열쇠가 틀림)
export function seedCbcDecrypt(key, iv, data) {
  if (data.length === 0 || data.length % 16) return null;
  const K = seedKeySchedule(key);
  const out = new Uint8Array(data.length);
  let prev = iv;
  for (let off = 0; off < data.length; off += 16) {
    const block = data.subarray(off, off + 16);
    const plain = seedBlock(K, block, true);
    for (let i = 0; i < 16; i++) out[off + i] = plain[i] ^ prev[i];
    prev = block;
  }
  return unpad(out);
}

// 시험용 (테스트에서 가짜 보안메일을 만들 때 씀)
export function seedCbcEncrypt(key, iv, data) {
  const n = 16 - (data.length % 16);
  const buf = new Uint8Array(data.length + n);
  buf.set(data);
  buf.fill(n, data.length);
  const K = seedKeySchedule(key);
  let prev = iv;
  for (let off = 0; off < buf.length; off += 16) {
    const block = buf.subarray(off, off + 16);
    for (let i = 0; i < 16; i++) block[i] ^= prev[i];
    block.set(seedBlock(K, block, false));
    prev = block;
  }
  return buf;
}

// AES-CBC (브라우저 내장 기능). 국세청 파일은 지금 SEED 를 쓰지만 헤더가 AES 를 가리킬 때를 대비
async function aesCbcDecrypt(key, iv, data) {
  try {
    const k = await crypto.subtle.importKey('raw', key, 'AES-CBC', false, ['decrypt']);
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, k, data));
  } catch {
    return null;
  }
}

// ---------- 보안메일 파일 ----------
export class NtsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const ALGORITHMS = { 1: 'AES', 2: 'SEED', 3: 'ARIA' };

function hiddenValue(html, id) {
  const re = new RegExp(`<input[^>]*\\bid\\s*=\\s*["']${id}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  return tag?.match(/\bvalue\s*=\s*["']([^"']*)["']/i)?.[1] ?? null;
}

// 비밀번호 없이 읽을 수 있는 부분: 헤더
export function readSecureMail(html) {
  const headerB64 = hiddenValue(html, 'idCriHeader');
  if (!headerB64) throw new NtsError('not-nts', '국세청 보안메일 파일(NTS_eTaxInvoice.html)이 아니에요.');
  const raw = base64ToBytes(headerB64).map((b) => b ^ 0x6b);
  const header = {};
  for (const line of decodeText(raw).split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) header[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const count = Number(header.AttachFileCount || 0);
  const attachments = [];
  for (let i = 0; i < count; i++) {
    const sfx = i === 0 ? '' : String(i);
    const names = (header.AttachFileName || '').split('|');
    const tags = (header.AttachFileTagID || '').split('|');
    attachments.push({
      name: header[`AttachFileName${sfx}`] || names[i] || `첨부${i + 1}`,
      tagId: header[`AttachFileTagID${sfx}`] || tags[i] || `idCriAttachContents${i}`,
    });
  }
  return {
    algorithm: ALGORITHMS[header.ContentEncryptionAlgorithm] || `알 수 없음(${header.ContentEncryptionAlgorithm})`,
    hint: header.HintKey || '',
    header,
    attachments,
    html,
  };
}

export function normalizeId(id) {
  return String(id || '').replace(/\D/g, '');
}

// 사업자등록번호로 해독 → { body(HTML 글자), attachments: [{name, bytes, text}] }
export async function openSecureMail(mail, id) {
  const digits = normalizeId(id);
  if (digits.length !== 10 && digits.length !== 13) {
    throw new NtsError('bad-id', '사업자등록번호 10자리(개인은 주민등록번호 13자리)를 입력하세요.');
  }
  const key = md5(digits);
  const iv = new Uint8Array(16);
  let decrypt;
  if (mail.algorithm === 'SEED') decrypt = async (d) => seedCbcDecrypt(key, iv, d);
  else if (mail.algorithm === 'AES') decrypt = (d) => aesCbcDecrypt(key, iv, d);
  else throw new NtsError('unsupported', `${mail.algorithm} 방식 파일은 아직 열 수 없어요.`);

  const hash = mail.header.HashKey ? await decrypt(base64ToBytes(mail.header.HashKey)) : null;
  if (!hash || utf8.decode(hash).trim().toLowerCase() !== toHex(key)) {
    throw new NtsError('wrong-id', '번호가 맞지 않아요. 공급받는 사업자의 등록번호인지 확인하세요.');
  }

  const read = async (tagId) => {
    const v = hiddenValue(mail.html, tagId);
    return v ? decrypt(base64ToBytes(v)) : null;
  };
  const bodyBytes = (await read('idCriPcContents')) || (await read('idCriMobileContents'));
  const attachments = [];
  for (const a of mail.attachments) {
    let bytes = await read(a.tagId);
    if (!bytes) continue;
    // 첨부는 해독하면 Base64 글자가 한 번 더 나옴
    const asText = utf8.decode(bytes).trim();
    if (/^[A-Za-z0-9+/=\s]+$/.test(asText)) {
      try { bytes = base64ToBytes(asText); } catch { /* 그대로 둠 */ }
    }
    attachments.push({ name: a.name, bytes, text: decodeText(bytes) });
  }
  return { body: bodyBytes ? decodeText(bodyBytes) : '', attachments };
}

// ---------- 국세청 표준 XML (TaxInvoice) ----------
const TYPE_KIND = { '01': '세금계산서', '02': '수정세금계산서', '03': '계산서', '04': '수정계산서' };
const TYPE_DETAIL = { '01': '일반', '02': '영세율', '03': '위수탁', '04': '수입', '05': '영세율위수탁', '06': '수입납부유예' };
const PURPOSE = { '01': '영수', '02': '청구' };

const kids = (el, name) => (el ? Array.from(el.children).filter((c) => c.localName === name) : []);
const kid = (el, name) => kids(el, name)[0] || null;
const path = (el, ...names) => names.reduce((e, n) => kid(e, n), el);
const text = (el, ...names) => path(el, ...names)?.textContent.trim() ?? '';
const num = (s) => (s === '' || s == null ? null : Number(s));

function party(el) {
  if (!el) return null;
  return {
    id: text(el, 'ID'),
    subId: text(el, 'SpecifiedOrganization', 'TaxRegistrationID'),
    name: text(el, 'NameText'),
    ceo: text(el, 'SpecifiedPerson', 'NameText'),
    address: text(el, 'SpecifiedAddress', 'LineOneText'),
    bizType: text(el, 'TypeCode'),
    bizItem: text(el, 'ClassificationCode'),
    email: text(el, 'DefinedContact', 'URICommunication') || text(el, 'PrimaryDefinedContact', 'URICommunication'),
    email2: text(el, 'SecondaryDefinedContact', 'URICommunication'),
  };
}

// DOMParser 는 브라우저 것을 씀 (테스트에서는 넘겨받음)
export function parseInvoiceXml(xml, DOMParserImpl = globalThis.DOMParser) {
  const doc = new DOMParserImpl().parseFromString(xml, 'application/xml');
  const root = doc.documentElement;
  if (!root || root.localName !== 'TaxInvoice') return null;
  const d = kid(root, 'TaxInvoiceDocument');
  const s = kid(root, 'TaxInvoiceTradeSettlement');
  const typeCode = text(d, 'TypeCode');
  const sum = kid(s, 'SpecifiedMonetarySummation');
  return {
    issueId: text(d, 'IssueID'),
    typeCode,
    kind: TYPE_KIND[typeCode.slice(0, 2)] || '세금계산서',
    detail: TYPE_DETAIL[typeCode.slice(2, 4)] || '',
    purpose: PURPOSE[text(d, 'PurposeCode')] || '',
    date: text(d, 'IssueDateTime'),
    issuedAt: text(root, 'ExchangedDocument', 'IssueDateTime'),
    notes: kids(d, 'DescriptionText').map((e) => e.textContent.trim()).filter(Boolean),
    amendmentCode: text(d, 'AmendmentStatusCode'),
    originalIssueId: text(d, 'OriginalIssueID'),
    supplier: party(kid(s, 'InvoicerParty')),
    buyer: party(kid(s, 'InvoiceeParty')),
    broker: party(kid(s, 'BrokerParty')),
    supplyTotal: num(text(sum, 'ChargeTotalAmount')),
    taxTotal: num(text(sum, 'TaxTotalAmount')),
    grandTotal: num(text(sum, 'GrandTotalAmount')),
    payments: kids(s, 'SpecifiedPaymentMeans').map((p) => ({ type: text(p, 'TypeCode'), amount: num(text(p, 'PaidAmount')) })),
    items: kids(root, 'TaxInvoiceTradeLineItem').map((it) => ({
      seq: text(it, 'SequenceNumeric'),
      date: text(it, 'PurchaseExpiryDateTime'),
      name: text(it, 'NameText'),
      spec: text(it, 'InformationText'),
      quantity: num(text(it, 'ChargeableUnitQuantity')),
      unitPrice: num(text(it, 'UnitPrice', 'UnitAmount')),
      supply: num(text(it, 'InvoiceAmount')),
      tax: num(text(it, 'TotalTax', 'CalculatedAmount')),
      note: text(it, 'DescriptionText'),
    })),
  };
}

export const PAYMENT_TYPES = { 10: '현금', 20: '수표', 30: '어음', 40: '외상' };
