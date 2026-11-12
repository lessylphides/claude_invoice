// 세금계산서 뷰어: MD5·SEED 가 표준과 같은지, 보안메일을 번호로 여는지
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  md5, toHex, seedEncryptBlock, seedDecryptBlock, seedCbcEncrypt, seedCbcDecrypt,
  readSecureMail, openSecureMail, normalizeId,
} from '../../etax-viewer/etax.js';
import { makeSecureMail, SAMPLE_ID, SAMPLE_XML, SAMPLE_BODY } from './etaxSample.js';

const hex = (s) => Uint8Array.from(s.match(/../g), (x) => parseInt(x, 16));

describe('MD5', () => {
  it('RFC 1321 예시값', () => {
    expect(toHex(md5(''))).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(toHex(md5('abc'))).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(toHex(md5('message digest'))).toBe('f96b697d7cb7938d525a2f31aaf161d0');
  });
  it('여러 길이에서 Node 와 같음 (블록 경계 포함)', () => {
    for (const n of [1, 10, 55, 56, 63, 64, 65, 200]) {
      const s = '가'.repeat(n);
      expect(toHex(md5(s))).toBe(createHash('md5').update(s).digest('hex'));
    }
  });
});

describe('SEED', () => {
  // RFC 4269 부록의 시험값
  const vectors = [
    ['00000000000000000000000000000000', '000102030405060708090a0b0c0d0e0f', '5ebac6e0054e166819aff1cc6d346cdb'],
    ['000102030405060708090a0b0c0d0e0f', '00000000000000000000000000000000', 'c11f22f20140505084483597e4370f43'],
    ['4706480851e61be85d74bfb3fd956185', '83a2f8a288641fb9a4e9a5cc2f131c7d', 'ee54d13ebcae706d226bc3142cd40d4a'],
    ['28dbc3bc49ffd87dcfa509b11d422be7', 'b41e6be2eba84a148e2eed84593c5ec7', '9b9b7bfcd1813cb95d0b3618f40f5122'],
  ];
  it.each(vectors)('열쇠 %s', (key, plain, cipher) => {
    expect(toHex(seedEncryptBlock(hex(key), hex(plain)))).toBe(cipher);
    expect(toHex(seedDecryptBlock(hex(key), hex(cipher)))).toBe(plain);
  });
  it('CBC 암호화 후 해독하면 원래대로, 열쇠가 틀리면 null', () => {
    const key = md5('x'), iv = new Uint8Array(16);
    for (const n of [0, 1, 15, 16, 17, 100]) {
      const data = Uint8Array.from({ length: n }, (_, i) => (i * 37) & 255);
      expect(Array.from(seedCbcDecrypt(key, iv, seedCbcEncrypt(key, iv, data)))).toEqual(Array.from(data));
    }
    expect(seedCbcDecrypt(md5('y'), iv, seedCbcEncrypt(key, iv, new TextEncoder().encode(toHex(key))))).toBeNull();
  });
});

describe('보안메일 열기', () => {
  const file = makeSecureMail();

  it('헤더는 번호 없이 읽힘', () => {
    const mail = readSecureMail(file);
    expect(mail.algorithm).toBe('SEED');
    expect(mail.attachments).toEqual([{ name: '202610301000000012345678.xml', tagId: 'idCriAttachContents0' }]);
  });

  it('맞는 번호(하이픈 있어도)로 본문과 XML 을 풂', async () => {
    const r = await openSecureMail(readSecureMail(file), '123-45-67890');
    expect(r.body).toBe(SAMPLE_BODY);
    expect(r.attachments[0].text).toBe(SAMPLE_XML);
  });

  it('틀린 번호·잘못된 자릿수·다른 파일은 알려 줌', async () => {
    const mail = readSecureMail(file);
    await expect(openSecureMail(mail, '1234567891')).rejects.toMatchObject({ code: 'wrong-id' });
    await expect(openSecureMail(mail, '12345')).rejects.toMatchObject({ code: 'bad-id' });
    expect(() => readSecureMail('<html><body>hello</body></html>')).toThrow(/보안메일/);
    expect(normalizeId(' 123-45-67890 ')).toBe(SAMPLE_ID);
  });
});
