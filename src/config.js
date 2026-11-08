// 회원 계정(로그인) 서버: Supabase
// 이 두 값은 앱 안에 그대로 들어가는 '공개용' 값입니다 (비밀 아님).
// 관리자용 secret / service_role 키는 절대 여기에 넣지 않습니다.
export const SUPABASE_URL = 'https://azcpuihnuumfdcoouyew.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_He9WhHA2VNjLrd2ImlDZTg_x3p0ZYM2';

// 결제(토스페이먼츠) '클라이언트 키': 앱 안에 들어가는 공개용 값 (비밀 아님)
// 시크릿 키는 서버(Cloudflare 비밀 값 TOSS_SECRET_KEY)에만 있습니다. 실제 결제를 시작할 때 live_ck_ 키로 바꿉니다.
export const TOSS_CLIENT_KEY = 'test_ck_c19x04T4SU93uKVuTK1sC36KfCLQU8W7np';
