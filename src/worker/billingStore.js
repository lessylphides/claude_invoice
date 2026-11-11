// 구독 정보 저장소: Durable Object (한 곳에서 순서대로 읽고 써서, 결제 직후에도 바로 최신 상태가 보임)
// Cloudflare KV 는 저장 직후 다른 지역 서버에서 최대 1분간 예전 값이 보일 수 있어 결제 정보에는 맞지 않음
import { DurableObject } from 'cloudflare:workers';
import { applyOcrStat, applyAccStat, emptyDay, emptyMonth } from './stats.js';
import { applyClaim, applyUse } from './levels.js';

export class BillingStore extends DurableObject {
  async read(key) {
    return (await this.ctx.storage.get(key)) ?? null;
  }
  async write(key, value) {
    await this.ctx.storage.put(key, value);
  }
  /** 영수증 인식 통계 한 건 더하기 (여기서 한 번에 처리해 동시에 와도 빠지지 않음) */
  async addOcrStat(date, month, stat) {
    const dk = `stat:day:${date}`;
    const mk = `stat:month:${month}`;
    const day = (await this.ctx.storage.get(dk)) ?? emptyDay();
    const m = (await this.ctx.storage.get(mk)) ?? emptyMonth();
    applyOcrStat(day, m, stat);
    await this.ctx.storage.put({ [dk]: day, [mk]: m });
  }
  /** 인식 정확도 통계 한 건 더하기 */
  async addAccStat(date, model, edits) {
    const k = `stat:acc:${date}`;
    const day = (await this.ctx.storage.get(k)) ?? {};
    applyAccStat(day, model, edits);
    await this.ctx.storage.put(k, day);
  }
  /** 레벨업 선물 받기 (같은 레벨은 한 번만, 하루 한도) */
  async claimLevel(key, level, today, now) {
    const out = applyClaim(await this.ctx.storage.get(key), level, today, now);
    if (out.gifts.length) await this.ctx.storage.put(key, out.rec);
    return out;
  }
  /** 레벨업 선물 1장 쓰기 */
  async useLevelGift(key) {
    const { rec, used } = applyUse(await this.ctx.storage.get(key));
    if (used) await this.ctx.storage.put(key, rec);
    return used;
  }
  /** prefix 로 시작하는 키 목록 (after 다음부터 최대 500개) */
  /** 목록 앞에 붙이기 (클로드가 바꾼 기록): 읽고 쓰기를 한 번에 해서 동시에 와도 빠지지 않음 */
  async prepend(key, items, max) {
    const list = [...items, ...((await this.ctx.storage.get(key)) || [])].slice(0, max);
    await this.ctx.storage.put(key, list);
    return list;
  }
  async keys(prefix, after = null) {
    const m = await this.ctx.storage.list({ prefix, ...(after ? { startAfter: after } : {}), limit: 500 });
    const keys = [...m.keys()];
    return { keys, next: keys.length === 500 ? keys.at(-1) : null };
  }
}
