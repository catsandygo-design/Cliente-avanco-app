
create table if not exists public.pre_registrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  client_name text not null,
  cpf_cnpj text,
  email text,
  phone text,
  development text,
  broker_name text,
  real_estate_agency text,
  status text not null default 'Novo',
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);

create index if not exists pre_registrations_org_status_idx on public.pre_registrations(organization_id, status);
alter table public.pre_registrations enable row level security;

create policy pre_registrations_read on public.pre_registrations for select to authenticated using (public.is_org_member(organization_id));
create policy pre_registrations_write on public.pre_registrations for insert to authenticated with check (public.has_org_role(organization_id, array['owner','admin','manager','analyst','broker']::public.app_role[]));
create policy pre_registrations_update on public.pre_registrations for update to authenticated using (public.has_org_role(organization_id, array['owner','admin','manager','analyst','broker']::public.app_role[])) with check (public.has_org_role(organization_id, array['owner','admin','manager','analyst','broker']::public.app_role[]));
create policy pre_registrations_delete on public.pre_registrations for delete to authenticated using (public.has_org_role(organization_id, array['owner','admin']::public.app_role[]));

create trigger pre_registrations_touch before update on public.pre_registrations for each row execute function public.touch_updated_at();
create trigger pre_registrations_audit after insert or update or delete on public.pre_registrations for each row execute function public.capture_audit_event();

