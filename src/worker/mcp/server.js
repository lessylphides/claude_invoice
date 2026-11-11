// 클로드 연결(MCP): 클로드가 쓸 수 있는 도구 목록과 요청 처리
// - 로그인(OAuth)은 index.js 의 OAuthProvider 가 확인하고, 여기에는 ctx.props.userId(사장님 계정)만 넘어옴
// - 읽기 4개 + 쓰기 3개. 지우기 도구는 없음. 쓴 내용은 '클로드가 바꾼 기록'에 남고 앱에서 되돌릴 수 있음
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import * as z from 'zod';
import { readLedger, updateLedger, LedgerError } from './ledger.js';
import { overview, listMenus, searchPurchases, itemHistory, setMenuPrice, setMenuPrices, createCategory, moveMenu } from './tools.js';
import { logChanges } from './changes.js';

const INSTRUCTIONS = `코스트노트는 한국 음식점·카페·바 사장님의 매입 장부와 메뉴 원가율 앱입니다.
- 숫자는 장부에서 직접 읽으세요 (get_cost_overview, list_menus, search_purchases, get_item_price_history). 원가는 메뉴에 연결된 매입 품목의 가장 최근 매입 단가로 계산되며, 금액 단위는 원입니다.
- 판매가를 제안할 때는 목표 원가율, 분류별 최소 마진(잔·보틀), 최근 단가 변화를 근거로 이유를 설명하세요.
- 장부를 바꾸는 도구(set_menu_price, set_menu_prices, create_menu_category, move_menu_to_category)는 사장님이 그 값으로 바꾸라고 분명히 말했을 때만 쓰세요. 바꾼 내용은 앱의 '클로드가 바꾼 기록'에서 되돌릴 수 있다고 알려 주세요.
- 바꾼 값은 사장님이 코스트노트 앱을 다시 열거나 새로고침하면 보입니다.`;

const text = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 1) }] });
const err = (message) => ({ content: [{ type: 'text', text: message }], isError: true });

/** 도구 실행: 장부 오류는 사장님께 보여 줄 말로 */
async function run(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof LedgerError) return err(e.message);
    console.error('[mcp] tool failed', e);
    return err('코스트노트 서버에서 문제가 생겼어요. 잠시 후 다시 시도해 주세요.');
  }
}

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export function buildServer(env, uid, fetchImpl = fetch) {
  const server = new McpServer({ name: 'costnote', title: '코스트노트', version: '1.0.0' }, { instructions: INSTRUCTIONS });
  const read = async (fn) => run(async () => text(fn((await readLedger(env, uid, fetchImpl)).data)));
  const write = (tool, fn) =>
    run(async () => {
      const { result } = await updateLedger(env, uid, fn, fetchImpl);
      // 장부는 이미 저장됨: 기록을 못 남겨도 실패로 알리지 않음 (대신 안내)
      const logged = await logChanges(env, uid, result.changes, tool).then(
        () => true,
        (e) => (console.error('[mcp] log failed', e), false),
      );
      const { changes, ...rest } = result;
      return text({ ...(logged ? {} : { note: '바꾼 기록을 남기지 못해 앱에서 되돌리기가 안 될 수 있어요.' }), changed: changes.map(({ label, menuName, category, before, after, kind }) => ({ kind, menu: menuName, field: label, category, before, after })), ...rest });
    });

  server.registerTool(
    'get_cost_overview',
    {
      title: '원가 요약',
      description: '목표 원가율, 메뉴 분류와 분류별 최소 마진(잔·보틀), 메뉴·매입 개수와 기간을 돌려줍니다. 원가 상담을 시작할 때 먼저 부르세요.',
      annotations: READ,
    },
    () => read(overview),
  );

  server.registerTool(
    'list_menus',
    {
      title: '메뉴별 원가',
      description:
        '메뉴마다 잔·보틀 판매가, 원가, 원가율, 마진, 판정(목표 이내/최소 마진 충족/미달), 목표 원가율·최소 마진을 맞추는 판매가, 재료별 최근 매입 단가를 돌려줍니다. 분류나 이름 일부로 거를 수 있어요.',
      inputSchema: {
        category: z.string().optional().describe('메뉴 분류 이름 (예: 위스키). 분류 없는 메뉴는 "미분류"'),
        name: z.string().optional().describe('메뉴 이름 일부'),
      },
      annotations: READ,
    },
    (args) => read((d) => listMenus(d, args)),
  );

  server.registerTool(
    'search_purchases',
    {
      title: '매입 기록 찾기',
      description: '영수증 매입 기록을 최근 순으로 찾습니다. 품목 이름 일부, 거래처 이름 일부, 기간(YYYY-MM-DD)으로 거를 수 있어요.',
      inputSchema: {
        query: z.string().optional().describe('품목 이름 일부 (예: 아부나흐)'),
        vendor: z.string().optional().describe('거래처 이름 일부'),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('시작 날짜 YYYY-MM-DD'),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('끝 날짜 YYYY-MM-DD'),
        limit: z.number().int().min(1).max(100).optional().describe('최대 건수 (기본 30)'),
      },
      annotations: READ,
    },
    (args) => read((d) => searchPurchases(d, args)),
  );

  server.registerTool(
    'get_item_price_history',
    {
      title: '품목 단가 기록',
      description: '매입 품목 하나의 단가 기록(최근 순, 거래처·용량 포함)을 돌려줍니다. 같은 품목으로 묶어 둔 다른 이름도 함께 봅니다.',
      inputSchema: { item: z.string().describe('매입 품목 이름 (영수증에 적힌 이름)') },
      annotations: READ,
    },
    (args) => read((d) => itemHistory(d, args)),
  );

  server.registerTool(
    'set_menu_price',
    {
      title: '판매가 입력',
      description: '메뉴의 잔 판매가(price)나 보틀 판매가(bottle_price)를 바꿉니다. 사장님이 그 금액으로 바꾸라고 분명히 말했을 때만 쓰세요. 바꾼 뒤의 원가율·마진을 돌려줍니다.',
      inputSchema: {
        menu: z.string().describe('메뉴 이름 또는 id (list_menus 결과)'),
        price: z.number().int().min(0).optional().describe('잔(1인분) 판매가, 원'),
        bottle_price: z.number().int().min(0).optional().describe('보틀 판매가, 원 (0 이면 보틀 안 팜)'),
      },
      annotations: WRITE,
    },
    (args) => write('set_menu_price', (d) => setMenuPrice(d, args)),
  );

  server.registerTool(
    'set_menu_prices',
    {
      title: '여러 메뉴 판매가 한 번에 입력',
      description: '여러 메뉴의 잔·보틀 판매가를 한 번에 바꿉니다 (최대 50개). 메뉴 여러 개를 바꿀 때는 set_menu_price 를 여러 번 부르지 말고 이걸 쓰세요. 하나라도 못 찾으면 아무것도 바꾸지 않아요.',
      inputSchema: {
        items: z
          .array(
            z.object({
              menu: z.string().describe('메뉴 이름 또는 id'),
              price: z.number().int().min(0).optional().describe('잔 판매가, 원'),
              bottle_price: z.number().int().min(0).optional().describe('보틀 판매가, 원'),
            }),
          )
          .min(1)
          .max(50),
      },
      annotations: WRITE,
    },
    (args) => write('set_menu_prices', (d) => setMenuPrices(d, args)),
  );

  server.registerTool(
    'create_menu_category',
    {
      title: '메뉴 분류 만들기',
      description: '원가 탭에 새 메뉴 분류를 만듭니다 (예: 하이볼). 사장님이 원할 때만 쓰세요.',
      inputSchema: { name: z.string().describe('새 분류 이름 (20자 이내)') },
      annotations: WRITE,
    },
    (args) => write('create_menu_category', (d) => createCategory(d, args)),
  );

  server.registerTool(
    'move_menu_to_category',
    {
      title: '메뉴 분류 옮기기',
      description: '메뉴를 다른 분류로 옮깁니다. 분류가 없으면 먼저 create_menu_category 로 만드세요. "미분류"로 빼낼 수도 있어요.',
      inputSchema: {
        menu: z.string().describe('메뉴 이름 또는 id'),
        category: z.string().describe('옮길 분류 이름 (또는 "미분류")'),
      },
      annotations: WRITE,
    },
    (args) => write('move_menu_to_category', (d) => moveMenu(d, args)),
  );

  return server;
}

/** POST /mcp (Streamable HTTP, 상태 없이 요청마다 새로) */
export async function handleMcp(request, env, uid, fetchImpl = fetch) {
  // 상태 없는 서버: 알림 스트림(GET)·세션 종료(DELETE)는 쓰지 않음
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: { allow: 'POST' } });
  const server = buildServer(env, uid, fetchImpl);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    // 응답을 다 만든 뒤 정리 (상태 없는 서버)
    queueMicrotask(() => server.close().catch(() => {}));
  }
}
