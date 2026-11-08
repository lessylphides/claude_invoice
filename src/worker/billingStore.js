// 구독 정보 저장소: Durable Object (한 곳에서 순서대로 읽고 써서, 결제 직후에도 바로 최신 상태가 보임)
// Cloudflare KV 는 저장 직후 다른 지역 서버에서 최대 1분간 예전 값이 보일 수 있어 결제 정보에는 맞지 않음
import { DurableObject } from 'cloudflare:workers';

export class BillingStore extends DurableObject {
  async read(key) {
    return (await this.ctx.storage.get(key)) ?? null;
  }
  async write(key, value) {
    await this.ctx.storage.put(key, value);
  }
  /** prefix 로 시작하는 키 목록 (after 다음부터 최대 500개) */
  async keys(prefix, after = null) {
    const m = await this.ctx.storage.list({ prefix, ...(after ? { startAfter: after } : {}), limit: 500 });
    const keys = [...m.keys()];
    return { keys, next: keys.length === 500 ? keys.at(-1) : null };
  }
}
