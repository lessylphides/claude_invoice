// 비밀번호 걸린 엑셀(.xlsx) 열기: 네이버페이 같은 곳에서 받은 파일은 Office '암호로 보호' (Agile, AES) 형식
// - 파일은 CFB(복합 문서) 안에 EncryptionInfo(XML) + EncryptedPackage(암호화된 xlsx) 로 들어 있음
// - 비밀번호 → SHA-512 반복 → 키 복호화 → 4096바이트씩 AES-CBC 로 원래 xlsx 를 꺼냄
// 모두 기기 안에서만 처리 (파일·비밀번호를 서버로 보내지 않음)
import { cbc } from '@noble/ciphers/aes.js';
import { sha512, sha256, sha384 } from '@noble/hashes/sha2.js';
import { sha1 } from '@noble/hashes/legacy.js';

const CFB_SIG = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const END = 0xfffffffe;
const FREE = 0xffffffff;

/** CFB(복합 문서) 파일인지: 암호 걸린 오피스 파일은 zip 이 아니라 이 형식 */
export const isCfb = (u8) => CFB_SIG.every((b, i) => u8[i] === b);

/** CFB 안의 스트림들을 { 이름: Uint8Array } 로 (필요한 최소 기능만) */
export function readCfb(u8) {
  if (!isCfb(u8)) throw new Error('not cfb');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const u32 = (o) => dv.getUint32(o, true);
  const ss = 1 << dv.getUint16(0x1e, true);
  const mss = 1 << dv.getUint16(0x20, true);
  const sector = (n) => u8.subarray((n + 1) * ss, (n + 2) * ss);
  // FAT 위치: 헤더의 109개 + DIFAT 섹터들
  const difat = [];
  for (let i = 0; i < 109; i++) difat.push(u32(0x4c + i * 4));
  let d = u32(0x44);
  for (let k = 0; k < u32(0x48) && d !== END && d !== FREE; k++) {
    const s = sector(d);
    const sdv = new DataView(s.buffer, s.byteOffset, s.byteLength);
    for (let i = 0; i < ss / 4 - 1; i++) difat.push(sdv.getUint32(i * 4, true));
    d = sdv.getUint32(ss - 4, true);
  }
  const fatSecs = difat.filter((x) => x !== FREE && x !== END).slice(0, u32(0x2c));
  const fat = new Uint32Array(fatSecs.length * (ss / 4));
  fatSecs.forEach((s, i) => {
    const b = sector(s);
    const bdv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    for (let j = 0; j < ss / 4; j++) fat[i * (ss / 4) + j] = bdv.getUint32(j * 4, true);
  });
  const chain = (start, table) => {
    const out = [];
    for (let s = start, guard = 0; s !== END && s !== FREE && s < table.length && guard < table.length; s = table[s], guard++) out.push(s);
    return out;
  };
  const readChain = (start, size) => {
    const secs = chain(start, fat);
    const out = new Uint8Array(secs.length * ss);
    secs.forEach((s, i) => out.set(sector(s), i * ss));
    return size == null ? out : out.subarray(0, size);
  };
  // 디렉터리
  const dir = readChain(u32(0x30));
  const ddv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  const entries = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const len = ddv.getUint16(o + 64, true);
    const type = dir[o + 66];
    if (!type) continue;
    let name = '';
    for (let i = 0; i < Math.max(0, len - 2); i += 2) name += String.fromCharCode(ddv.getUint16(o + i, true));
    entries.push({ name, type, start: ddv.getUint32(o + 116, true), size: ddv.getUint32(o + 120, true) });
  }
  const root = entries.find((e) => e.type === 5);
  const cutoff = u32(0x38);
  const ministream = root ? readChain(root.start, root.size) : new Uint8Array();
  const miniFatRaw = u32(0x3c) === END ? new Uint8Array() : readChain(u32(0x3c));
  const mdv = new DataView(miniFatRaw.buffer, miniFatRaw.byteOffset, miniFatRaw.byteLength);
  const minifat = new Uint32Array(miniFatRaw.length / 4);
  for (let i = 0; i < minifat.length; i++) minifat[i] = mdv.getUint32(i * 4, true);
  const out = {};
  for (const e of entries) {
    if (e.type !== 2) continue;
    if (e.size < cutoff) {
      const secs = chain(e.start, minifat);
      const buf = new Uint8Array(secs.length * mss);
      secs.forEach((s, i) => buf.set(ministream.subarray(s * mss, (s + 1) * mss), i * mss));
      out[e.name] = buf.subarray(0, e.size);
    } else out[e.name] = readChain(e.start, e.size);
  }
  return out;
}

const HASHES = { SHA512: sha512, SHA384: sha384, SHA256: sha256, SHA1: sha1, 'SHA-1': sha1 };
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const concat = (...arrs) => {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) out.set(a, o), (o += a.length);
  return out;
};
const le32 = (n) => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
const fit = (h, n, pad) => {
  if (h.length >= n) return h.subarray(0, n);
  const o = new Uint8Array(n).fill(pad);
  o.set(h);
  return o;
};
const attr = (xml, tag, name) => {
  const m = new RegExp(`<${tag}\\b[^>]*\\s${name}="([^"]*)"`).exec(xml);
  return m ? m[1] : null;
};

export class WrongPassword extends Error {}

/**
 * 비밀번호 걸린 오피스 파일 → 원래 xlsx(zip) 바이트
 * @param {Uint8Array} u8 파일 전체
 * @param {string} password
 */
export function decryptOffice(u8, password) {
  const files = readCfb(u8);
  const info = files.EncryptionInfo;
  const pkg = files.EncryptedPackage;
  if (!info || !pkg) throw new Error('not encrypted office file');
  const ver = info[0] + (info[2] << 16);
  if (ver !== 0x40004) throw new Error('unsupported encryption'); // Agile 만
  const xml = new TextDecoder().decode(info.subarray(8));
  const kd = (n) => attr(xml, 'keyData', n);
  const ke = (n) => attr(xml, 'p:encryptedKey', n) ?? attr(xml, 'encryptedKey', n);
  const H = HASHES[ke('hashAlgorithm')];
  const H2 = HASHES[kd('hashAlgorithm')];
  if (!H || !H2 || (ke('cipherAlgorithm') ?? 'AES') !== 'AES' || (kd('cipherAlgorithm') ?? 'AES') !== 'AES') throw new Error('unsupported encryption');
  const keyBytes = Number(ke('keyBits')) / 8;
  const salt = b64(ke('saltValue'));
  const spin = Number(ke('spinCount'));
  // 비밀번호(UTF-16LE) + salt → 해시 반복
  const pw = new Uint8Array(password.length * 2);
  for (let i = 0; i < password.length; i++) (pw[i * 2] = password.charCodeAt(i) & 255), (pw[i * 2 + 1] = password.charCodeAt(i) >> 8);
  let h = H(concat(salt, pw));
  const buf = new Uint8Array(4 + h.length);
  for (let i = 0; i < spin; i++) {
    buf.set(le32(i), 0);
    buf.set(h, 4);
    h = H(buf);
  }
  const derive = (block) => fit(H(concat(h, block)), keyBytes, 0x36);
  const dec = (key, iv, data) => cbc(key, iv, { disablePadding: true }).decrypt(data);
  // 비밀번호 확인 (verifier)
  const vIn = dec(derive(new Uint8Array([0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79])), salt, b64(ke('encryptedVerifierHashInput')));
  const vHash = dec(derive(new Uint8Array([0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e])), salt, b64(ke('encryptedVerifierHashValue')));
  const expect = H(vIn.subarray(0, Number(ke('saltSize')) || 16));
  if (!expect.every((b, i) => b === vHash[i])) throw new WrongPassword('wrong password');
  const secret = dec(derive(new Uint8Array([0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6])), salt, b64(ke('encryptedKeyValue'))).subarray(0, Number(kd('keyBits')) / 8);
  // 패키지: 앞 8바이트 = 원래 크기, 이후 4096 바이트씩
  const size = new DataView(pkg.buffer, pkg.byteOffset, 8).getUint32(0, true);
  const kSalt = b64(kd('saltValue'));
  const blockSize = Number(kd('blockSize')) || 16;
  const out = new Uint8Array(Math.ceil((pkg.length - 8) / 16) * 16);
  for (let i = 0, o = 8; o < pkg.length; i++, o += 4096) {
    let seg = pkg.subarray(o, Math.min(o + 4096, pkg.length));
    if (seg.length % 16) seg = fit(seg, Math.ceil(seg.length / 16) * 16, 0);
    out.set(dec(secret, fit(H2(concat(kSalt, le32(i))), blockSize, 0x36), seg), i * 4096);
  }
  return out.subarray(0, size);
}
