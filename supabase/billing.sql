-- 코스트노트: 요금제 한도용 사용량 함수 (ocr_usage.sql 다음에 실행)
-- Supabase → SQL Editor 에 붙여 넣고 Run. (한 번만 실행)
--
-- ocr_usage_now 가 이제 '지금까지 전체 횟수(total)'와 '결제 기간 시작일부터 횟수(period)'도 알려 줍니다.
-- 무료 체험(가입 후 20장)과 요금제(결제일부터 한 달)의 한도를 계산할 때 씁니다.
-- 구독·결제 정보 자체는 Supabase 가 아니라 서버(Cloudflare)에만 저장합니다.

drop function if exists public.ocr_usage_now();

create or replace function public.ocr_usage_now(since date default null) returns json
  language sql stable security invoker set search_path = '' as $$
  select json_build_object(
    'day', coalesce((select u.count from public.ocr_usage u
                     where u.user_id = auth.uid() and u.day = (now() at time zone 'Asia/Seoul')::date), 0),
    'month', coalesce((select sum(u.count) from public.ocr_usage u
                       where u.user_id = auth.uid()
                         and u.day >= date_trunc('month', now() at time zone 'Asia/Seoul')::date), 0),
    'total', coalesce((select sum(u.count) from public.ocr_usage u where u.user_id = auth.uid()), 0),
    'period', case when since is null then null
                   else coalesce((select sum(u.count) from public.ocr_usage u
                                  where u.user_id = auth.uid() and u.day >= since), 0) end
  );
$$;

revoke execute on function public.ocr_usage_now(date) from public, anon;
grant execute on function public.ocr_usage_now(date) to authenticated;
