
insert into public.profiles (id, full_name)
select
  id,
  coalesce(raw_user_meta_data->>'full_name', split_part(email, '@', 1))
from auth.users
on conflict (id) do nothing;

with target_org as (
  select id from public.organizations where slug = '7lm' limit 1
),
ranked_users as (
  select id, row_number() over (order by created_at, id) as position
  from auth.users
)
insert into public.organization_members (organization_id, user_id, role)
select
  target_org.id,
  ranked_users.id,
  case
    when ranked_users.position = 1
      and not exists (select 1 from public.organization_members where organization_id = target_org.id)
      then 'owner'::public.app_role
    else 'viewer'::public.app_role
  end
from target_org
cross join ranked_users
on conflict (organization_id, user_id) do nothing;

