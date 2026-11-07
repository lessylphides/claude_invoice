// 로그인·가입 오류를 한국어 안내로
export const MIN_PASSWORD = 8;

/** 비밀번호 규칙 검사 (통과하면 null) */
export function passwordProblem(pw) {
  if (pw.length < MIN_PASSWORD) return `비밀번호는 ${MIN_PASSWORD}자 이상이어야 해요.`;
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return '비밀번호에 영문과 숫자를 함께 넣어 주세요.';
  return null;
}

export const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

const MESSAGES = {
  invalid_credentials: '이메일 또는 비밀번호가 맞지 않아요.',
  email_not_confirmed: '아직 이메일 인증을 하지 않았어요. 메일함의 인증 링크를 눌러 주세요.',
  user_already_exists: '이미 가입된 이메일이에요. 로그인해 주세요.',
  email_exists: '이미 가입된 이메일이에요. 로그인해 주세요.',
  weak_password: '비밀번호가 너무 쉬워요. 8자 이상, 영문과 숫자를 섞어 주세요.',
  same_password: '지금 쓰는 비밀번호와 다른 비밀번호를 정해 주세요.',
  over_email_send_rate_limit: '메일을 너무 자주 보냈어요. 잠시 후 다시 시도해 주세요.',
  over_request_rate_limit: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.',
  email_address_invalid: '이메일 주소를 확인해 주세요.',
  signup_disabled: '지금은 새로 가입할 수 없어요.',
  otp_expired: '링크가 만료됐어요. 메일을 다시 받아 주세요.',
  user_not_found: '가입되지 않은 이메일이에요.',
};

export function authMessage(err) {
  if (!err) return '';
  const code = err.code || err.error_code;
  if (code && MESSAGES[code]) return MESSAGES[code];
  if (err.name === 'AuthRetryableFetchError' || err.status === 0 || /fetch|network/i.test(err.message || '')) return '인터넷 연결을 확인해 주세요.';
  return `문제가 생겼어요: ${err.message || err}`;
}
