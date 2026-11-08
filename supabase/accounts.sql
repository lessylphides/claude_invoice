-- 코스트노트: 회원 관리 (운영자가 추가 인식 횟수를 주거나 계정을 정지)
-- Supabase → SQL Editor 에 붙여 넣고 Run. (billing.sql, admin.sql, backup.sql 다음에 한 번)
--
-- - 계정 상태는 앱에서 바로 고칠 수 없는 private 표에 두고, 운영자 함수로만 바꿉니다.
-- - 정지된 계정은 장부를 서버에 새로 저장할 수 없고(읽기·내보내기는 됨), 영수증 자동 인식도 막힙니다.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.account_flags (
  user_id uuid primary key references auth.users (id) on delete cascade,
  suspended boolean not null default false,
  suspend_reason text,
  bonus integer not null default 0 check (bonus >= 0),   -- 남은 추가 인식 횟수 (한도를 넘으면 여기서 1씩 차감)
  bonus_granted integer not null default 0,              -- 지금까지 준 추가 인식 합계
  updated_at timestamptz not null default now()
);
alter table private.account_flags enable row level security;

-- 운영자인지 (운영자 이메일로 로그인한 경우)
create or replace function private.is_owner() returns boolean
  language sql stable set search_path = '' as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) in ('hanguk.soek@me.com');
$$;

-- 이 계정이 정지됐는지 (장부 저장 규칙에서 씀)
create or replace function public.is_suspended() returns boolean
  language sql stable security definer set search_path = '' as $$
  select coalesce((select f.suspended from private.account_flags f where f.user_id = auth.uid()), false);
$$;

-- 내 계정 상태 (추가 인식·정지)
create or replace function public.my_account() returns json
  language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'suspended', coalesce(f.suspended, false),
    'reason', f.suspend_reason,
    'bonus', coalesce(f.bonus, 0))
  from (select 1) x left join private.account_flags f on f.user_id = auth.uid();
$$;

-- 추가 인식 1회 쓰기 (남아 있을 때만, 본인 것만)
create or replace function public.use_bonus() returns integer
  language sql security definer set search_path = '' as $$
  update private.account_flags set bonus = bonus - 1, updated_at = now()
  where user_id = auth.uid() and bonus > 0
  returning bonus;
$$;

-- 영수증 인식 사용량에 계정 상태를 함께 (서버가 한 번에 확인)
drop function if exists public.ocr_usage_now(date);
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
                                  where u.user_id = auth.uid() and u.day >= since), 0) end,
    'account', public.my_account()
  );
$$;

-- 정지된 계정은 장부를 새로 저장할 수 없음 (읽기는 됨)
drop policy if exists "own ledger: insert" on public.ledgers;
drop policy if exists "own ledger: update" on public.ledgers;
create policy "own ledger: insert" on public.ledgers for insert to authenticated
  with check ((select auth.uid()) = user_id and not public.is_suspended());
create policy "own ledger: update" on public.ledgers for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id and not public.is_suspended());

-- 운영자: 회원 목록 (이메일로 찾기)
create or replace function public.admin_users(q text default '', lim integer default 50) returns json
  language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_owner() then raise exception 'forbidden'; end if;
  return (
    select coalesce(json_agg(r order by r.created_at desc), '[]'::json) from (
      select u.id, u.email, u.created_at, u.last_sign_in_at,
             u.email_confirmed_at is not null as confirmed,
             coalesce(f.suspended, false) as suspended, f.suspend_reason as reason,
             coalesce(f.bonus, 0) as bonus, coalesce(f.bonus_granted, 0) as bonus_granted,
             (select coalesce(sum(o.count), 0) from public.ocr_usage o
               where o.user_id = u.id and o.day >= date_trunc('month', now() at time zone 'Asia/Seoul')::date) as ocr_month,
             (select coalesce(sum(o.count), 0) from public.ocr_usage o where o.user_id = u.id) as ocr_total,
             exists (select 1 from public.ledgers l where l.user_id = u.id) as has_ledger
      from auth.users u
      left join private.account_flags f on f.user_id = u.id
      where coalesce(q, '') = '' or u.email ilike '%' || q || '%'
      order by u.created_at desc
      limit greatest(1, least(coalesce(lim, 50), 200))
    ) r
  );
end $$;

-- 운영자: 추가 인식 주기(add_bonus, 빼려면 음수) · 정지/해제
create or replace function public.admin_set_account(target uuid, add_bonus integer default 0, set_suspended boolean default null, reason text default null)
  returns json language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_owner() then raise exception 'forbidden'; end if;
  if not exists (select 1 from auth.users where id = target) then raise exception 'no such user'; end if;
  insert into private.account_flags (user_id) values (target) on conflict (user_id) do nothing;
  update private.account_flags set
    bonus = greatest(0, bonus + coalesce(add_bonus, 0)),
    bonus_granted = bonus_granted + greatest(0, coalesce(add_bonus, 0)),
    suspended = coalesce(set_suspended, suspended),
    suspend_reason = case when set_suspended is true then reason when set_suspended is false then null else suspend_reason end,
    updated_at = now()
  where user_id = target;
  return (select json_build_object('suspended', f.suspended, 'reason', f.suspend_reason, 'bonus', f.bonus, 'bonus_granted', f.bonus_granted)
          from private.account_flags f where f.user_id = target);
end $$;

revoke execute on function public.is_suspended(), public.my_account(), public.use_bonus(), public.ocr_usage_now(date),
  public.admin_users(text, integer), public.admin_set_account(uuid, integer, boolean, text) from public, anon;
grant execute on function public.is_suspended(), public.my_account(), public.use_bonus(), public.ocr_usage_now(date),
  public.admin_users(text, integer), public.admin_set_account(uuid, integer, boolean, text) to authenticated;
