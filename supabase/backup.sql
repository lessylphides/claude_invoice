-- 코스트노트: 장부 정기 백업용 함수 (서버가 매일 한 번 모든 장부를 받아 암호화해 보관)
-- Supabase → SQL Editor 에 붙여 넣고 Run. 결과 칸에 나오는 값을 Cloudflare 비밀 값 BACKUP_SECRET 으로 넣으세요.
-- (다시 실행하면 새 값이 만들어지고 예전 값은 더 이상 통하지 않습니다. 그때는 Cloudflare 값도 바꿔 주세요.)
--
-- Supabase 에는 비밀 값 자체가 아니라 그 해시만 저장합니다.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.settings (k text primary key, v text not null);
alter table private.settings enable row level security; -- 정책 없음 = 앱에서는 아무도 못 읽음 (함수만 읽음)

-- 비밀 값이 맞을 때만 모든 장부를 돌려줌
create or replace function public.backup_ledgers(secret text) returns json
  language plpgsql stable security definer set search_path = '' as $$
begin
  if secret is null or encode(sha256(convert_to(secret, 'UTF8')), 'hex')
       is distinct from (select v from private.settings where k = 'backup_hash') then
    raise exception 'forbidden';
  end if;
  return (select coalesce(json_agg(json_build_object('user_id', l.user_id, 'rev', l.rev, 'updated_at', l.updated_at, 'data', l.data)), '[]'::json)
          from public.ledgers l);
end $$;

revoke execute on function public.backup_ledgers(text) from public, authenticated;
grant execute on function public.backup_ledgers(text) to anon;

-- 비밀 값 만들기 (결과로 한 번만 보여 줌)
with s as (select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') as v),
     ins as (insert into private.settings (k, v)
             select 'backup_hash', encode(sha256(convert_to(v, 'UTF8')), 'hex') from s
             on conflict (k) do update set v = excluded.v
             returning 1)
select s.v as "BACKUP_SECRET" from s, ins;
