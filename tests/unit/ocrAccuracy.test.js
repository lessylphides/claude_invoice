// 인식 정확도: 초안과 저장본 비교 → 고친 곳 개수만
import { describe, it, expect } from 'vitest';
import { ocrEdits } from '../../src/lib/ocrAccuracy.js';
import { cleanEdits, handleOcrFeedback, adminStats } from '../../src/worker/stats.js';

const it_ = (id, name, amount, extra = {}) => ({ id, name, category: '기타', qty: 1, unitPrice: amount, discount: 0, amount, ...extra });
const draft = () => ({ date: '2026-11-08', vendor: '가락청과', items: [it_('a', '양파', 3000), it_('b', '대파', 2000), it_('c', '봉투', 100)] });

describe('인식 결과를 얼마나 고쳤는지', () => {
  it('그대로 저장하면 고친 곳 0, untouched 1', () => {
    expect(ocrEdits(draft(), structuredClone(draft()))).toMatchObject({ receipts: 1, untouched: 1, items: 3, name: 0, price: 0 });
  });
  it('거래처·품목 이름·가격을 고치고, 품목을 지우고 더하면 각각 셈', () => {
    const s = structuredClone(draft());
    s.vendor = '가락청과 ';  // 앞뒤 공백만 다르면 고친 걸로 안 봄
    s.items[0].name = '양파 15kg';
    s.items[1].amount = 2500;
    s.items[1].unitPrice = 2500;
    s.items.splice(2, 1);
    s.items.push(it_('new', '마늘', 4000));
    const e = ocrEdits(draft(), s);
    expect(e).toMatchObject({ untouched: 0, vendor: 0, name: 1, price: 1, itemsRemoved: 1, itemsAdded: 1, total: 1 });
  });
  it('저장하지 않고 닫으면 discarded', () => {
    expect(ocrEdits(draft(), null)).toMatchObject({ receipts: 1, discarded: 1, items: 0 });
  });
});

describe('서버 기록', () => {
  it('이상한 숫자는 버림', () => {
    expect(cleanEdits({ receipts: 1, name: -1 })).toBeNull();
    expect(cleanEdits({ receipts: 2 })).toBeNull();
    expect(cleanEdits({ receipts: 1, vendor: 'x' })).toBeNull();
    expect(cleanEdits({ receipts: 1, name: 2 })).toMatchObject({ receipts: 1, name: 2, date: 0 });
  });

  it('모델별로 모여 운영 현황에 나옴', async () => {
    const m = new Map();
    const BILLING = { get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), put: async (k, v) => void m.set(k, v), list: async () => ({ keys: [], list_complete: true }) };
    const env = { BILLING, OCR_MODEL: 'claude-opus-5-5' };
    const now = Date.UTC(2026, 10, 10, 3);
    const fetchImpl = async () => new Response(JSON.stringify({ id: 'u', email: 'a@b' }), { status: 200 });
    const send = (b) => handleOcrFeedback(new Request('https://x/api/ocr/feedback', { method: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify(b) }), env, { fetchImpl, now });
    expect((await send(ocrEdits(draft(), structuredClone(draft())))).status).toBe(200);
    const s = structuredClone(draft());
    s.items[0].name = 'x';
    await send(ocrEdits(draft(), s));
    expect((await send({ receipts: 9 })).status).toBe(400);
    const st = await adminStats(env, { now });
    expect(st.ocr.accuracy['claude-opus-5-5']).toMatchObject({ receipts: 2, untouched: 1, items: 6, name: 1 });
  });
});
