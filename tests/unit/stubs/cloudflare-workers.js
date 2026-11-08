// 단위 테스트용: Cloudflare 실행 환경의 DurableObject 자리 표시
export class DurableObject {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
}
