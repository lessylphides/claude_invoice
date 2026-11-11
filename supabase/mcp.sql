-- 코스트노트: 클로드 연결(커넥터)용 함수
-- Supabase → SQL Editor 에 붙여 넣고 Run. (한 번만 실행. 다시 실행해도 괜찮음)
--
-- 클로드가 사장님 장부를 읽고 쓸 때, 서버(Cloudflare)가 이 함수로 그 사장님 장부 한 줄만 다룹니다.
-- - 서버만 아는 비밀 값(BACKUP_SECRET, backup.sql 에서 만든 것)이 맞을 때만 동작
-- - 쓸 때는 앱과 같은 규칙: 서버 장부 번호(rev)가 마지막으로 읽은 번호와 같을 때만 덮어씀 (다른 기기·앱 변경을 덮지 않음)
-- - 이용 정지된 계정은 읽기·쓰기 모두 막음

create or replace function public.mcp_ledger_get(secret text, uid uuid) returns json
  language plpgsql stable security definer set search_path = '' as $$
begin
  if secret is null or encode(sha256(convert_to(secret, 'UTF8')), 'hex')
       is distinct from (select v from private.settings where k = 'backup_hash') then
    raise exception 'forbidden';
  end if;
  if coalesce((select f.suspended from private.account_flags f where f.user_id = uid), false) then
    raise exception 'suspended';
  end if;
  return (select json_build_object('rev', l.rev, 'data', l.data, 'updated_at', l.updated_at)
          from public.ledgers l where l.user_id = uid);
end $$;

-- 덮어썼으면 새 번호, 그 사이 다른 곳에서 바뀌었으면(번호가 다르면) null
create or replace function public.mcp_ledger_put(secret text, uid uuid, payload jsonb, expected bigint) returns bigint
  language plpgsql volatile security definer set search_path = '' as $$
declare
  new_rev bigint;
begin
  if secret is null or encode(sha256(convert_to(secret, 'UTF8')), 'hex')
       is distinct from (select v from private.settings where k = 'backup_hash') then
    raise exception 'forbidden';
  end if;
  if coalesce((select f.suspended from private.account_flags f where f.user_id = uid), false) then
    raise exception 'suspended';
  end if;
  update public.ledgers set data = payload, rev = expected + 1
    where user_id = uid and rev = expected
    returning rev into new_rev;
  return new_rev;
end $$;

revoke execute on function public.mcp_ledger_get(text, uuid) from public, authenticated;
revoke execute on function public.mcp_ledger_put(text, uuid, jsonb, bigint) from public, authenticated;
grant execute on function public.mcp_ledger_get(text, uuid) to anon;
grant execute on function public.mcp_ledger_put(text, uuid, jsonb, bigint) to anon;
