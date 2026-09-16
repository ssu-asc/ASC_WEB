begin;

create extension if not exists supabase_vault with schema vault;

create table if not exists public.staff_private_settings (
  id boolean primary key default true check (id),
  staff_memo text not null default '' check (char_length(staff_memo) <= 20000),
  version bigint not null default 1 check (version > 0),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.staff_private_settings (id, staff_memo)
select
  true,
  coalesce((
    select string_agg(format('Google (%s): %s', semester, google_account_email), E'\n' order by semester)
    from public.staff_workspace_settings
    where nullif(btrim(google_account_email), '') is not null
  ), '')
on conflict (id) do nothing;

create table if not exists public.staff_shared_secrets (
  id uuid primary key,
  label text not null check (char_length(btrim(label)) between 1 and 100),
  account_identifier text not null default '' check (char_length(account_identifier) <= 320),
  login_url text,
  vault_secret_id uuid not null unique,
  active boolean not null default true,
  version bigint not null default 1 check (version > 0),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_shared_secrets_login_url_https check (login_url is null or login_url ~ '^https://')
);

create index if not exists staff_shared_secrets_active_order
on public.staff_shared_secrets(active desc, label, created_at);

create table if not exists public.staff_shared_secret_audit (
  id bigint generated always as identity primary key,
  secret_id uuid not null references public.staff_shared_secrets(id) on delete restrict,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  action text not null check (action in ('created', 'updated', 'revealed', 'deactivated', 'reactivated')),
  created_at timestamptz not null default now()
);

create index if not exists staff_shared_secret_audit_recent
on public.staff_shared_secret_audit(created_at desc, id desc);

alter table public.staff_private_settings enable row level security;
alter table public.staff_shared_secrets enable row level security;
alter table public.staff_shared_secret_audit enable row level security;

revoke all on public.staff_private_settings, public.staff_shared_secrets, public.staff_shared_secret_audit from anon, authenticated;
grant select on public.staff_private_settings to authenticated;
grant all on public.staff_private_settings, public.staff_shared_secrets, public.staff_shared_secret_audit to service_role;

create policy staff_private_settings_read_staff
on public.staff_private_settings
for select
to authenticated
using ((select private.is_active_staff()));

-- The portal never grants browser roles direct Vault access.
revoke all on schema vault from anon, authenticated;
revoke all on vault.secrets from anon, authenticated;
revoke all on vault.decrypted_secrets from anon, authenticated;

create or replace function public.update_staff_private_settings_atomic(
  p_expected_version bigint,
  p_staff_memo text,
  p_actor uuid
) returns public.staff_private_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_row public.staff_private_settings%rowtype;
  next_row public.staff_private_settings%rowtype;
begin
  if p_expected_version is null or p_expected_version < 1 then
    raise exception using errcode = '22023', message = '운영진 메모 버전을 확인해 주세요.';
  end if;
  if p_staff_memo is null or char_length(p_staff_memo) > 20000 then
    raise exception using errcode = '22023', message = '운영진 메모는 20000자 이하로 입력해 주세요.';
  end if;

  select * into current_row
  from public.staff_private_settings
  where id = true
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = '운영진 메모 설정을 찾을 수 없습니다.';
  end if;
  if current_row.version <> p_expected_version then
    raise exception using errcode = 'P0001', message = '운영진 메모가 변경되었습니다. 새로고침 후 다시 저장해 주세요.';
  end if;

  update public.staff_private_settings
  set staff_memo = p_staff_memo,
      version = current_row.version + 1,
      updated_by = p_actor,
      updated_at = now()
  where id = true
  returning * into next_row;

  return next_row;
end;
$$;

create or replace function public.create_staff_shared_secret_atomic(
  p_label text,
  p_account_identifier text,
  p_login_url text,
  p_secret text,
  p_actor uuid
) returns public.staff_shared_secrets
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid := gen_random_uuid();
  new_vault_id uuid;
  next_row public.staff_shared_secrets%rowtype;
begin
  if p_label is null or char_length(btrim(p_label)) not between 1 and 100 then
    raise exception using errcode = '22023', message = '공용 계정 이름은 1~100자로 입력해 주세요.';
  end if;
  if p_account_identifier is null or char_length(p_account_identifier) > 320 then
    raise exception using errcode = '22023', message = '계정/아이디는 320자 이하로 입력해 주세요.';
  end if;
  if p_login_url is not null and p_login_url !~ '^https://' then
    raise exception using errcode = '22023', message = '로그인 주소는 https 주소만 사용할 수 있습니다.';
  end if;
  if p_secret is null or char_length(p_secret) not between 1 and 2048 then
    raise exception using errcode = '22023', message = '비밀값은 1~2048자로 입력해 주세요.';
  end if;

  new_vault_id := vault.create_secret(
    p_secret,
    'asc-staff-secret-' || new_id::text,
    'ASC staff shared credential'
  );

  insert into public.staff_shared_secrets (
    id, label, account_identifier, login_url, vault_secret_id,
    active, version, created_by, updated_by
  ) values (
    new_id, btrim(p_label), btrim(p_account_identifier), nullif(btrim(p_login_url), ''), new_vault_id,
    true, 1, p_actor, p_actor
  ) returning * into next_row;

  insert into public.staff_shared_secret_audit(secret_id, actor_profile_id, action)
  values (new_id, p_actor, 'created');

  return next_row;
end;
$$;

create or replace function public.update_staff_shared_secret_atomic(
  p_secret_id uuid,
  p_expected_version bigint,
  p_label text,
  p_account_identifier text,
  p_login_url text,
  p_secret text,
  p_actor uuid
) returns public.staff_shared_secrets
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_row public.staff_shared_secrets%rowtype;
  next_row public.staff_shared_secrets%rowtype;
begin
  if p_expected_version is null or p_expected_version < 1 then
    raise exception using errcode = '22023', message = '공용 계정 버전을 확인해 주세요.';
  end if;
  if p_label is null or char_length(btrim(p_label)) not between 1 and 100 then
    raise exception using errcode = '22023', message = '공용 계정 이름은 1~100자로 입력해 주세요.';
  end if;
  if p_account_identifier is null or char_length(p_account_identifier) > 320 then
    raise exception using errcode = '22023', message = '계정/아이디는 320자 이하로 입력해 주세요.';
  end if;
  if p_login_url is not null and p_login_url !~ '^https://' then
    raise exception using errcode = '22023', message = '로그인 주소는 https 주소만 사용할 수 있습니다.';
  end if;
  if p_secret is not null and char_length(p_secret) not between 1 and 2048 then
    raise exception using errcode = '22023', message = '비밀값은 1~2048자로 입력해 주세요.';
  end if;

  select * into current_row
  from public.staff_shared_secrets
  where id = p_secret_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = '공용 계정을 찾을 수 없습니다.';
  end if;
  if current_row.version <> p_expected_version then
    raise exception using errcode = 'P0001', message = '공용 계정이 변경되었습니다. 새로고침 후 다시 저장해 주세요.';
  end if;

  if p_secret is not null then
    perform vault.update_secret(current_row.vault_secret_id, p_secret);
  end if;

  update public.staff_shared_secrets
  set label = btrim(p_label),
      account_identifier = btrim(p_account_identifier),
      login_url = nullif(btrim(p_login_url), ''),
      version = current_row.version + 1,
      updated_by = p_actor,
      updated_at = now()
  where id = p_secret_id
  returning * into next_row;

  insert into public.staff_shared_secret_audit(secret_id, actor_profile_id, action)
  values (p_secret_id, p_actor, 'updated');

  return next_row;
end;
$$;

create or replace function public.reveal_staff_shared_secret(
  p_secret_id uuid,
  p_actor uuid
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  vault_id uuid;
  plaintext text;
begin
  select vault_secret_id into vault_id
  from public.staff_shared_secrets
  where id = p_secret_id and active = true;

  if not found then
    raise exception using errcode = 'P0002', message = '활성 공용 계정을 찾을 수 없습니다.';
  end if;

  select decrypted_secret into plaintext
  from vault.decrypted_secrets
  where id = vault_id;

  if plaintext is null then
    raise exception using errcode = 'P0002', message = '비밀정보를 확인할 수 없습니다.';
  end if;

  insert into public.staff_shared_secret_audit(secret_id, actor_profile_id, action)
  values (p_secret_id, p_actor, 'revealed');

  return plaintext;
end;
$$;

create or replace function public.set_staff_shared_secret_active(
  p_secret_id uuid,
  p_expected_version bigint,
  p_active boolean,
  p_actor uuid
) returns public.staff_shared_secrets
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_row public.staff_shared_secrets%rowtype;
  next_row public.staff_shared_secrets%rowtype;
begin
  if p_expected_version is null or p_expected_version < 1 then
    raise exception using errcode = '22023', message = '공용 계정 버전을 확인해 주세요.';
  end if;

  select * into current_row
  from public.staff_shared_secrets
  where id = p_secret_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = '공용 계정을 찾을 수 없습니다.';
  end if;
  if current_row.version <> p_expected_version then
    raise exception using errcode = 'P0001', message = '공용 계정이 변경되었습니다. 새로고침 후 다시 저장해 주세요.';
  end if;

  update public.staff_shared_secrets
  set active = p_active,
      version = current_row.version + 1,
      updated_by = p_actor,
      updated_at = now()
  where id = p_secret_id
  returning * into next_row;

  insert into public.staff_shared_secret_audit(secret_id, actor_profile_id, action)
  values (p_secret_id, p_actor, case when p_active then 'reactivated' else 'deactivated' end);

  return next_row;
end;
$$;

revoke all on function public.update_staff_private_settings_atomic(bigint, text, uuid) from public, anon, authenticated;
revoke all on function public.create_staff_shared_secret_atomic(text, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.update_staff_shared_secret_atomic(uuid, bigint, text, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.reveal_staff_shared_secret(uuid, uuid) from public, anon, authenticated;
revoke all on function public.set_staff_shared_secret_active(uuid, bigint, boolean, uuid) from public, anon, authenticated;

grant execute on function public.update_staff_private_settings_atomic(bigint, text, uuid) to service_role;
grant execute on function public.create_staff_shared_secret_atomic(text, text, text, text, uuid) to service_role;
grant execute on function public.update_staff_shared_secret_atomic(uuid, bigint, text, text, text, text, uuid) to service_role;
grant execute on function public.reveal_staff_shared_secret(uuid, uuid) to service_role;
grant execute on function public.set_staff_shared_secret_active(uuid, bigint, boolean, uuid) to service_role;

commit;
