// 영수증 인식 요청 만들기 (서버가 Claude API 에 보낼 내용). 브라우저 기능을 쓰지 않아 서버·테스트에서 함께 씀

export const MAX_IMAGES = 6;
export const MAX_IMAGE_B64 = 3_000_000; // 사진 한 장(base64) 최대 약 3MB — 앱은 1568px JPEG 로 줄여 보내므로 보통 0.3~0.6MB

export function buildSchema(categories) {
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

export const SYSTEM = `당신은 한국 식당·소상공인의 매입 장부 입력을 돕는 도우미입니다.
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


/** 한국 시간 기준 오늘 YYYY-MM-DD */
export const kstToday = (now = Date.now()) => new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);

/**
 * 앱이 보낸 요청 확인. 이상하면 오류 문구를 던짐
 * @returns {{images: string[], categories: string[], knownVendors: string[]}}
 */
export function validateOcrInput(body) {
  const b = body && typeof body === 'object' ? body : {};
  const images = Array.isArray(b.images) ? b.images : [];
  if (!images.length) throw new Error('사진이 없습니다.');
  if (images.length > MAX_IMAGES) throw new Error(`사진은 한 번에 ${MAX_IMAGES}장까지 인식할 수 있어요.`);
  if (images.some((x) => typeof x !== 'string' || !x || x.length > MAX_IMAGE_B64 || !/^[A-Za-z0-9+/=]+$/.test(x.slice(0, 200))))
    throw new Error('사진 형식이 올바르지 않습니다.');
  const strings = (v, max, len) => (Array.isArray(v) ? v : []).filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().slice(0, len)).slice(0, max);
  const categories = [...new Set(strings(b.categories, 40, 30))];
  if (!categories.length) throw new Error('분류 목록이 없습니다.');
  return { images, categories, knownVendors: strings(b.knownVendors, 60, 40) };
}

/** Claude API 요청 본문 */
export function buildOcrRequest({ images, categories, knownVendors = [] }, { model, today = kstToday() }) {
  const prompt = `오늘 날짜: ${today} (연도가 생략된 문서는 오늘 기준 가장 가까운 과거 날짜로 판단)
분류 목록: ${categories.join(', ')}
${knownVendors.length ? `기존 거래처(같은 곳이면 이 표기를 그대로 사용): ${knownVendors.join(', ')}` : ''}
${
    images.length > 1
      ? `위 사진 ${images.length}장은 영수증(또는 거래명세서) 한 장을 위에서부터 순서대로 나눠 찍은 것입니다. 하나로 이어서 한 건의 매입 내역으로 추출하세요. 사진끼리 겹쳐 찍힌 줄은 한 번만 넣습니다. 상호·날짜·합계는 어느 사진에 있든 찾아서 채웁니다.`
      : '이 사진의 매입 내역을 추출해 주세요.'
  }`;
  const usesFallback = !model.startsWith('claude-haiku');
  return {
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
  };
}

/** Claude 응답 → 인식 결과. 쓸 수 없는 응답이면 {code} 를 가진 오류를 던짐 */
export function parseOcrResponse(res) {
  const fail = (code, message) => Object.assign(new Error(message), { code });
  if (res.stop_reason === 'refusal') throw fail('refusal', '이 사진은 인식할 수 없습니다. 직접 입력해 주세요.');
  if (res.stop_reason === 'max_tokens') throw fail('too_long', '품목이 너무 많아 인식이 중간에 끊겼습니다. 나눠서 촬영해 주세요.');
  const text = (res.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    return JSON.parse(text);
  } catch {
    throw fail('bad_result', '인식 결과를 해석하지 못했습니다. 다시 시도하거나 직접 입력해 주세요.');
  }
}
