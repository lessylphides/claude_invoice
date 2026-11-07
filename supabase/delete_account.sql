-- 코스트노트: 회원 탈퇴 (본인 계정만)
-- Supabase → SQL Editor 에 붙여 넣고 Run. (한 번만 실행)
--
-- 로그인한 사람이 자기 계정을 지우면, 연결된 장부(ledgers)·인식 사용량(ocr_usage)도 함께 지워집니다
-- (두 표 모두 auth.users 를 'on delete cascade' 로 가리킴). 다른 사람 계정은 지울 수 없습니다.

create or replace function public.delete_my_account() returns void
  language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;
  delete from auth.users where id = auth.uid();
end $$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
