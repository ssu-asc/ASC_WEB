begin;

-- Serialize every active-staff count change through one private row. This closes the
-- two-admin race where separate transactions could otherwise deactivate each other.
create table if not exists private.staff_guard (
  singleton boolean primary key default true check (singleton),
  active_staff_count integer not null check (active_staff_count >= 0)
);

insert into private.staff_guard (singleton, active_staff_count)
values (
  true,
  (select count(*)::integer from public.profiles where role = 'staff' and active = true)
)
on conflict (singleton) do update
set active_staff_count = excluded.active_staff_count;

revoke all on private.staff_guard from public, anon, authenticated;

drop trigger if exists profiles_keep_active_staff on public.profiles;
drop function if exists private.ensure_active_staff_exists();

create or replace function private.maintain_active_staff_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  was_active_staff boolean := false;
  is_active_staff boolean := false;
  delta integer := 0;
  next_count integer;
begin
  if tg_op <> 'INSERT' then
    was_active_staff := old.role = 'staff' and old.active = true;
  end if;
  if tg_op <> 'DELETE' then
    is_active_staff := new.role = 'staff' and new.active = true;
  end if;

  delta := (case when is_active_staff then 1 else 0 end)
         - (case when was_active_staff then 1 else 0 end);

  if delta <> 0 then
    update private.staff_guard
    set active_staff_count = active_staff_count + delta
    where singleton = true
    returning active_staff_count into next_count;

    if next_count < 1 and delta < 0 then
      raise exception 'at least one active staff account is required' using errcode = '23514';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.maintain_active_staff_guard() from public, anon, authenticated;

create trigger profiles_keep_active_staff
after insert or update or delete on public.profiles
for each row execute function private.maintain_active_staff_guard();

commit;
