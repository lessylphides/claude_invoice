-- 코스트노트: 영수증 인식 사용량 (계정별·날짜별 횟수)
-- Supabase → SQL Editor 에 붙여 넣고 Run. (한 번만 실행)
--
-- 사용량은 서버만 늘릴 수 있게 함수로만 기록합니다. 사용자는 자기 사용량을 볼 수만 있고 고치거나 지울 수 없습니다.

create table if not exists public.ocr_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  count integer not null default 0,
  primary key (user_id, day)
);
alter table public.ocr_usage enable row level security;
drop policy if exists "own usage: read" on public.ocr_usage;
create policy "own usage: read" on public.ocr_usage for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.ocr_usage from anon, authenticated;
grant select on public.ocr_usage to authenticated;

-- 오늘·이번 달 사용 횟수 (한국 시간 기준)
create or replace function public.ocr_usage_now() returns json
  language sql stable security invoker set search_path = '' as $$
  select json_build_object(
    'day', coalesce((select u.count from public.ocr_usage u
                     where u.user_id = auth.uid() and u.day = (now() at time zone 'Asia/Seoul')::date), 0),
    'month', coalesce((select sum(u.count) from public.ocr_usage u
                       where u.user_id = auth.uid()
                         and u.day >= date_trunc('month', now() at time zone 'Asia/Seoul')::date), 0)
  );
$$;

-- 인식 한 번 기록 (본인 것만, 1씩만 늘어남)
create or replace function public.record_ocr_use() returns void
  language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;
  insert into public.ocr_usage (user_id, day, count)
  values (auth.uid(), (now() at time zone 'Asia/Seoul')::date, 1)
  on conflict (user_id, day) do update set count = public.ocr_usage.count + 1;
end $$;

revoke execute on function public.ocr_usage_now() from public, anon;
revoke execute on function public.record_ocr_use() from public, anon;
grant execute on function public.ocr_usage_now() to authenticated;
grant execute on function public.record_ocr_use() to authenticated;
