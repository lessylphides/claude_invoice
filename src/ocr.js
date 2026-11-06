// 영수증·거래명세서 사진 → Claude API(비전 + 구조화 출력)로 매입 내역 추출

import Anthropic from '@anthropic-ai/sdk';
import { todayStr } from './lib/format.js';

/** 사진을 긴 변 1568px 이하 JPEG(base64)로 줄임 – 전송량을 줄이고 인식 품질은 유지 */
export async function fileToJpegBase64(file, maxSide = 1568) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('이미지를 읽을 수 없습니다. (HEIC 형식이면 JPG로 촬영해 주세요)'));
      el.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
  } finally {
    URL.revokeObjectURL(url);
  }
}

function buildSchema(categories) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['documentType', 'date', 'vendor', 'paymentHint', 'items', 'total'],
    properties: {
      documentType: { type: 'string', enum: ['영수증', '거래명세서', '세금계산서', '기타'] },
      date: { type: 'string', description: '거래일 YYYY-MM-DD. 알 수 없으면 빈 문자열' },
      vendor: { type: 'string', description: '판매자(공급자) 상호명' },
      paymentHint: {
        type: 'string',
        enum: ['card', 'tax', 'cash', 'unknown'],
        description: 'card=카드 결제 흔적(카드번호/승인번호), tax=세금계산서 또는 세금계산서 발행 예정 거래명세서, cash=현금, unknown',
      },
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'category', 'qty', 'unit', 'unitPrice', 'discount', 'amount', 'packSize', 'packUnit'],
          properties: {
            name: { type: 'string' },
            category: { type: 'string', enum: categories },
            qty: { type: 'number' },
            unit: { type: 'string', description: 'kg, 개, 박스, 봉 등. 없으면 빈 문자열' },
            unitPrice: { type: 'number', description: '할인 전 정가 단가(원)' },
            discount: { type: 'number', description: '이 품목에 붙은 쿠폰·할인 금액의 합(원, 양수). 없으면 0' },
            amount: { type: 'number', description: '할인을 뺀 실제 지불 금액(원) = qty×unitPrice - discount. 부가세 포함' },
            packSize: { type: 'number', description: '수량 1개(1병·1봉·1박스)에 든 용량. 품목명·규격에서 읽음. 모르면 0' },
            packUnit: { type: 'string', enum: ['ml', 'g', '개', '병', ''], description: 'packSize 의 단위. L→ml, kg→g 로 환산. 모르면 빈 문자열' },
          },
        },
      },
      total: { type: 'number', description: '문서의 최종 합계 금액(원)' },
    },
  };
}

const SYSTEM = `당신은 한국 식당·소상공인의 매입 장부 입력을 돕는 도우미입니다.
사진 속 구매 영수증, 거래명세서, 세금계산서를 읽어 매입 내역을 정확히 추출합니다.
- 금액은 원 단위 숫자만 (쉼표·'원' 제외). 품목별 amount 는 부가세 포함 실제 지불 금액으로 적고, 거래명세서에 공급가액과 세액이 따로 있으면 합산합니다.
- 특정 상품에 대한 쿠폰·할인 줄(예: 상품 바로 아래의 "*** CPN", "할인", "쿠폰" 줄, 또는 할인 줄에 상품명이 적힌 경우)은 별도 품목으로 만들지 말고, 해당 상품의 discount 에 양수로 더하고 그 상품의 amount 에서 뺍니다. unitPrice 는 할인 전 정가로 둡니다.
- 어느 상품에도 속하지 않는 할인(영수증 전체 할인 등)과 봉투값 등만 별도 품목으로 넣고, 할인은 음수 금액으로 적습니다.
- 같은 상품이 여러 줄로 나뉘어 있어도 문서에 적힌 대로 줄마다 따로 적습니다.
- 품목 amount 의 합이 문서의 최종 합계와 같은지 확인합니다.
- 수량이나 단가가 없으면 qty=1, unitPrice=amount 로 둡니다.
- 품목명은 문서에 적힌 그대로 씁니다(규격 표기도 이름에 그대로 둠).
- 용량(packSize/packUnit)은 수량 1개에 든 양입니다. 품목명이나 규격 칸의 '700ML'→700 ml, '2L'→2000 ml, '510G'→510 g, '20kg'→20000 g 처럼 환산합니다. 'X24', '20입'처럼 낱개 묶음이면 낱개 수를 packSize 로, packUnit 은 병 음료(맥주·탄산수 등)면 '병', 그 밖에는 '개'로 둡니다. 알 수 없으면 0 과 빈 문자열로 둡니다.
- 각 품목을 주어진 분류 중 가장 알맞은 것으로 분류합니다.
- 읽을 수 없는 값은 추측하지 말고 빈 문자열 또는 0 으로 둡니다.`;

/**
 * @param {File|File[]} files  여러 장이면 '영수증 한 장을 나눠 찍은 사진들'로 보고 한 건으로 인식
 */
export async function extractReceipt(files, { apiKey, model, categories, knownVendors = [] }) {
  if (!apiKey) throw new Error('설정에서 Claude API 키를 먼저 입력해 주세요.');
  files = Array.isArray(files) ? files : [files];
  const images = await Promise.all(files.map((f) => fileToJpegBase64(f)));

  // 키는 이 기기 브라우저에만 저장되며 Anthropic API 로만 전송됩니다.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });

  const prompt = `오늘 날짜: ${todayStr()} (연도가 생략된 문서는 오늘 기준 가장 가까운 과거 날짜로 판단)
분류 목록: ${categories.join(', ')}
${knownVendors.length ? `기존 거래처(같은 곳이면 이 표기를 그대로 사용): ${knownVendors.slice(0, 60).join(', ')}` : ''}
${
    images.length > 1
      ? `위 사진 ${images.length}장은 영수증(또는 거래명세서) 한 장을 위에서부터 순서대로 나눠 찍은 것입니다. 하나로 이어서 한 건의 매입 내역으로 추출하세요. 사진끼리 겹쳐 찍힌 줄은 한 번만 넣습니다. 상호·날짜·합계는 어느 사진에 있든 찾아서 채웁니다.`
      : '이 사진의 매입 내역을 추출해 주세요.'
  }`;

  const usesFallback = !model.startsWith('claude-haiku');
  let res;
  try {
    res = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      ...(usesFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: buildSchema(categories) } },
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            ...images.flatMap((data, i) => [
              ...(images.length > 1 ? [{ type: 'text', text: `사진 ${i + 1}/${images.length}` }] : []),
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
            ]),
            { type: 'text', text: prompt },
          ],
        },
      ],
    });
  } catch (err) {
    // 크레딧 소진·사용 한도는 400 이라 다른 요청 오류와 종류로는 구분되지 않아 안내 문구로 구분
    if (err instanceof Anthropic.AuthenticationError) throw new Error('API 키가 올바르지 않습니다. 설정에서 확인해 주세요.');
    if (err instanceof Anthropic.PermissionDeniedError) throw new Error('이 API 키로는 선택한 모델을 쓸 수 없습니다.');
    if (err instanceof Anthropic.RateLimitError) throw new Error('요청이 많습니다. 잠시 후 다시 시도해 주세요.');
    if (err instanceof Anthropic.BadRequestError) throw new Error(billingMessage(err.message) ?? `요청 오류: ${err.message}`);
    if (err instanceof Anthropic.APIConnectionError) throw new Error('인터넷 연결을 확인해 주세요.');
    if (err instanceof Anthropic.APIError) throw new Error(`Claude API 오류 (${err.status ?? '?'}): ${err.message}`);
    throw err;
  }

  if (res.stop_reason === 'refusal') throw new Error('이 사진은 인식할 수 없습니다. 직접 입력해 주세요.');
  if (res.stop_reason === 'max_tokens') throw new Error('품목이 너무 많아 인식이 중간에 끊겼습니다. 나눠서 촬영해 주세요.');

  const text = res.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('인식 결과를 해석하지 못했습니다. 다시 시도하거나 직접 입력해 주세요.');
  }
}

/**
 * 결제 관련 400 오류를 알아보기 쉬운 안내로 (해당 없으면 null → 원래 오류를 그대로 보여 줌)
 * Anthropic 이 문구를 바꾸면 못 알아볼 수 있지만, 그때도 원래 오류 내용은 그대로 보임
 */
export function billingMessage(message) {
  const m = String(message ?? '');
  if (/credit balance/i.test(m))
    return '💳 API 크레딧이 다 떨어졌어요. Claude Console → Billing에서 충전하면 바로 다시 인식됩니다. 지금은 아래에 직접 입력해 주세요.';
  if (/usage limit/i.test(m))
    return '💳 이번 달 API 사용 한도에 닿았어요. Claude Console → Limits에서 한도를 올리거나, 그때까지는 아래에 직접 입력해 주세요.';
  return null;
}
