// 문의하기: 종류별 안내 문구 (앱 화면과 서버 메일이 같이 씀)
export const SUPPORT_KINDS = [
  { id: 'bug', icon: '🐞', label: '잘 안 돼요', guide: '어느 화면에서 무엇을 눌렀더니 어떻게 됐는지 적어 주세요. 화면 캡처를 붙이면 훨씬 빨리 고칠 수 있어요.', example: '예) 매입 탭에서 영수증을 찍었는데 "인식에 실패했어요"가 떠요. 3번 다시 해도 같아요.' },
  { id: 'ocr', icon: '🧾', label: '인식이 틀려요', guide: '어떤 영수증에서 무엇이 틀렸는지 적어 주세요. 그 영수증 사진을 같이 붙여 주시면 인식을 고치는 데 큰 도움이 돼요.', example: '예) ○○상회 거래명세서에서 할인 금액이 빠졌어요.' },
  { id: 'howto', icon: '❓', label: '사용법', guide: '무엇을 하고 싶으신지 적어 주세요. 방법을 차근차근 알려 드릴게요.', example: '예) 칵테일 한 잔 원가를 재료별로 넣고 싶어요.' },
  { id: 'idea', icon: '💡', label: '이런 기능 있으면', guide: '어떤 기능이 있으면 좋을지, 가게에서 어떤 때 필요한지 같이 적어 주세요.', example: '예) 거래처별로 지난달과 이번 달 매입을 비교해 보고 싶어요. 단가 협상할 때 쓰려고요.' },
  { id: 'billing', icon: '💳', label: '결제·요금', guide: '결제·환불·요금제에 대해 궁금한 점을 적어 주세요.', example: '예) 기본 요금제에서 라이트로 바꾸면 언제부터 적용되나요?' },
  { id: 'etc', icon: '💬', label: '기타', guide: '무엇이든 편하게 적어 주세요.', example: '' },
];
export const kindOf = (id) => SUPPORT_KINDS.find((k) => k.id === id) || SUPPORT_KINDS.at(-1);
export const SUPPORT_MIN = 10;
export const SUPPORT_MAX = 3000;
export const SUPPORT_MAX_IMAGES = 3;
export const SUPPORT_MAX_IMAGE_B64 = 1_500_000; // 한 장 약 1.1MB
export const SUPPORT_DAILY = 5;

/** 기기 정보를 사람이 읽기 쉽게 (예: iPhone · iOS 18.0) */
export function deviceLabel(ua = '') {
  const ios = ua.match(/(iPhone|iPad)[^)]*OS (\d+)[_.](\d+)/);
  if (ios) return `${ios[1]} · iOS ${ios[2]}.${ios[3]}`;
  const and = ua.match(/Android ([\d.]+)(?:; ([^;)]+))?/);
  if (and) return `Android ${and[1]}${and[2] ? ` · ${and[2].trim()}` : ''}`;
  if (/Mac OS X/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return '알 수 없음';
}
