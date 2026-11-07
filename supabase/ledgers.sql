-- 코스트노트: 계정별 장부 저장 표
-- Supabase → SQL Editor 에 붙여 넣고 Run. (한 번만 실행)
--
-- 각 계정은 자기 장부 한 줄만 읽고 쓸 수 있습니다 (RLS).
-- 지우기 권한은 주지 않습니다 (앱에서 실수로 서버 장부를 지울 수 없게).

create table if not exists public.ledgers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  rev bigint not null default 1,          -- 바뀔 때마다 1씩 증가 (두 기기가 동시에 덮어쓰지 않게)
  updated_at timestamptz not null default now(),
  constraint ledgers_size check (pg_column_size(data) < 10485760)  -- 장부 하나 10MB 까지
);

alter table public.ledgers enable row level security;

drop policy if exists "own ledger: read" on public.ledgers;
drop policy if exists "own ledger: insert" on public.ledgers;
drop policy if exists "own ledger: update" on public.ledgers;
create policy "own ledger: read" on public.ledgers for select to authenticated using ((select auth.uid()) = user_id);
create policy "own ledger: insert" on public.ledgers for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own ledger: update" on public.ledgers for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

revoke all on public.ledgers from anon;
grant select, insert, update on public.ledgers to authenticated;

-- 저장 시각은 서버 시계로
create or replace function public.ledgers_touch() returns trigger
  language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists ledgers_touch on public.ledgers;
create trigger ledgers_touch before insert or update on public.ledgers
  for each row execute function public.ledgers_touch();
