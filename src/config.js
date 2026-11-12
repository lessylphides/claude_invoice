// 회원 계정(로그인) 서버: Supabase
// 이 두 값은 앱 안에 그대로 들어가는 '공개용' 값입니다 (비밀 아님).
// 관리자용 secret / service_role 키는 절대 여기에 넣지 않습니다.
export const SUPABASE_URL = 'https://azcpuihnuumfdcoouyew.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_He9WhHA2VNjLrd2ImlDZTg_x3p0ZYM2';

// 결제(토스페이먼츠) '클라이언트 키': 앱 안에 들어가는 공개용 값 (비밀 아님)
// 시크릿 키는 서버(Cloudflare 비밀 값 TOSS_SECRET_KEY)에만 있습니다. 둘은 같은 종류(live/test)여야 합니다.
// 2026-11-12: 토스페이먼츠 계약 완료 → 실제 결제 키 (상점아이디 bill_costny7rx)
export const TOSS_CLIENT_KEY = 'live_ck_c19wZFOxTYvQyRcEnJxS4huEq4JUepv5vp';
