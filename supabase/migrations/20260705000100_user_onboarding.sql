create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  default_org uuid;
  initial_role public.app_role;
begin
  select id into default_org from public.organizations where slug = '7lm' limit 1;
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  if default_org is not null then
    select case when exists(select 1 from public.organization_members where organization_id = default_org)
      then 'viewer'::public.app_role else 'owner'::public.app_role end into initial_role;
    insert into public.organization_members (organization_id, user_id, role)
    values (default_org, new.id, initial_role)
    on conflict (organization_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();
