-- 코스트노트: 운영자 화면용 가입자 통계 (운영자 이메일로 로그인한 경우에만 숫자를 돌려줌)
-- Supabase → SQL Editor 에 붙여 넣고 Run. (한 번만 실행)
-- 개인 정보(이메일 등)는 돌려주지 않고 숫자만 돌려줍니다.

create or replace function public.admin_stats() returns json
  language plpgsql stable security definer set search_path = '' as $$
begin
  if lower(coalesce(auth.jwt() ->> 'email', '')) not in ('hanguk.soek@me.com') then
    raise exception 'forbidden';
  end if;
  return json_build_object(
    'total', (select count(*) from auth.users),
    'confirmed', (select count(*) from auth.users where email_confirmed_at is not null),
    'new7', (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'new30', (select count(*) from auth.users where created_at > now() - interval '30 days'),
    'active7', (select count(*) from auth.users where last_sign_in_at > now() - interval '7 days'),
    'ledgers', (select count(*) from public.ledgers),
    'ocrUsers30', (select count(distinct user_id) from public.ocr_usage
                   where day > (now() at time zone 'Asia/Seoul')::date - 30),
    'signups', (select coalesce(json_agg(json_build_object('date', d, 'count', c) order by d), '[]'::json)
                from (select (created_at at time zone 'Asia/Seoul')::date as d, count(*) as c
                      from auth.users where created_at > now() - interval '30 days' group by 1) t)
  );
end $$;

revoke execute on function public.admin_stats() from public, anon;
grant execute on function public.admin_stats() to authenticated;
