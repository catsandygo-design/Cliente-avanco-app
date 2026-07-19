create extension if not exists pgcrypto;

create type public.app_role as enum ('owner', 'admin', 'manager', 'analyst', 'broker', 'viewer');
create type public.priority_level as enum ('green', 'yellow', 'red');
create type public.document_status as enum ('pending', 'approved', 'rejected');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  avatar_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null default 'viewer',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  full_name text not null,
  phone text,
  email text,
  cpf_cnpj text,
  birth_date date,
  marital_status text,
  profession text,
  gross_income numeric(14,2),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  code text not null,
  broker_name text,
  real_estate_agency text,
  development text,
  unit text,
  current_stage integer not null default 0 check (current_stage between 0 and 9),
  status text not null default 'Em processo',
  priority public.priority_level not null default 'green',
  credit_provider boolean not null default false,
  monthly_transfer boolean not null default false,
  notes text,
  financial_data jsonb not null default '{}'::jsonb,
  operational_data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table public.transfers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  code text not null,
  status text not null default 'Início',
  correspondent_company text,
  correspondent_user text,
  financed_amount numeric(14,2) not null default 0,
  debt_balance numeric(14,2) not null default 0,
  financial_data jsonb not null default '{}'::jsonb,
  registry_data jsonb not null default '{}'::jsonb,
  contract_data jsonb not null default '{}'::jsonb,
  tax_data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table public.reservation_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  author_id uuid not null references auth.users(id),
  body text not null check (char_length(body) between 1 and 10000),
  audience text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table public.reservation_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  person_type text not null,
  document_type text not null,
  file_name text not null,
  storage_path text not null unique,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  status public.document_status not null default 'pending',
  expires_at date,
  uploaded_by uuid not null references auth.users(id),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid,
  actor_id uuid,
  table_name text not null,
  record_id uuid,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data jsonb,
  new_data jsonb,
  occurred_at timestamptz not null default now()
);

create index clients_org_idx on public.clients(organization_id);
create index reservations_org_stage_idx on public.reservations(organization_id, current_stage);
create index reservations_client_idx on public.reservations(client_id);
create index transfers_org_status_idx on public.transfers(organization_id, status);
create index transfers_reservation_idx on public.transfers(reservation_id);
create index messages_reservation_created_idx on public.reservation_messages(reservation_id, created_at desc);
create index documents_reservation_idx on public.reservation_documents(reservation_id);
create index audit_org_occurred_idx on public.audit_events(organization_id, occurred_at desc);
create index members_user_idx on public.organization_members(user_id, organization_id);

create or replace function public.is_org_member(target_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = target_org and m.user_id = (select auth.uid()) and m.active
  );
$$;

create or replace function public.has_org_role(target_org uuid, allowed_roles public.app_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = target_org and m.user_id = (select auth.uid())
      and m.active and m.role = any(allowed_roles)
  );
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger organizations_touch before update on public.organizations for each row execute function public.touch_updated_at();
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger clients_touch before update on public.clients for each row execute function public.touch_updated_at();
create trigger reservations_touch before update on public.reservations for each row execute function public.touch_updated_at();
create trigger transfers_touch before update on public.transfers for each row execute function public.touch_updated_at();

create or replace function public.capture_audit_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  row_data jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into public.audit_events (organization_id, actor_id, table_name, record_id, action, old_data, new_data)
  values (
    nullif(row_data->>'organization_id','')::uuid,
    (select auth.uid()),
    tg_table_name,
    nullif(row_data->>'id','')::uuid,
    tg_op,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

create trigger clients_audit after insert or update or delete on public.clients for each row execute function public.capture_audit_event();
create trigger reservations_audit after insert or update or delete on public.reservations for each row execute function public.capture_audit_event();
create trigger transfers_audit after insert or update or delete on public.transfers for each row execute function public.capture_audit_event();
create trigger documents_audit after insert or update or delete on public.reservation_documents for each row execute function public.capture_audit_event();

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_members enable row level security;
alter table public.clients enable row level security;
alter table public.reservations enable row level security;
alter table public.transfers enable row level security;
alter table public.reservation_messages enable row level security;
alter table public.reservation_documents enable row level security;
alter table public.audit_events enable row level security;

create policy organizations_read on public.organizations for select to authenticated using (public.is_org_member(id));
create policy organizations_admin_update on public.organizations for update to authenticated using (public.has_org_role(id, array['owner','admin']::public.app_role[])) with check (public.has_org_role(id, array['owner','admin']::public.app_role[]));
create policy profiles_self_read on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_self_update on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy members_read on public.organization_members for select to authenticated using (public.is_org_member(organization_id));
create policy members_admin_all on public.organization_members for all to authenticated using (public.has_org_role(organization_id, array['owner','admin']::public.app_role[])) with check (public.has_org_role(organization_id, array['owner','admin']::public.app_role[]));

create policy clients_read on public.clients for select to authenticated using (public.is_org_member(organization_id));
create policy clients_write on public.clients for insert to authenticated with check (public.has_org_role(organization_id, array['owner','admin','manager','analyst','broker']::public.app_role[]));
create policy clients_update on public.clients for update to authenticated using (public.has_org_role(organization_id, array['owner','admin','manager','analyst','broker']::public.app_role[])) with check (public.has_org_role(organization_id, array['owner','admin','manager','analyst','broker']::public.app_role[]));
create policy clients_delete on public.clients for delete to authenticated using (public.has_org_role(organization_id, array['owner','admin']::public.app_role[]));

create policy reservations_read on public.reservations for select to authenticated using (public.is_org_member(organization_id));
create policy reservations_write on public.reservations for insert to authenticated with check (public.has_org_role(organization_id, array['owner','admin','manager','analyst','broker']::public.app_role[]));
create policy reservations_update on public.reservations for update to authenticated using (public.has_org_role(organization_id, array['owner','admin','manager','analyst','broker']::public.app_role[])) with check (public.has_org_role(organization_id, array['owner','admin','manager','analyst','broker']::public.app_role[]));
create policy reservations_delete on public.reservations for delete to authenticated using (public.has_org_role(organization_id, array['owner','admin']::public.app_role[]));

create policy transfers_read on public.transfers for select to authenticated using (public.is_org_member(organization_id));
create policy transfers_write on public.transfers for insert to authenticated with check (public.has_org_role(organization_id, array['owner','admin','manager','analyst']::public.app_role[]));
create policy transfers_update on public.transfers for update to authenticated using (public.has_org_role(organization_id, array['owner','admin','manager','analyst']::public.app_role[])) with check (public.has_org_role(organization_id, array['owner','admin','manager','analyst']::public.app_role[]));
create policy transfers_delete on public.transfers for delete to authenticated using (public.has_org_role(organization_id, array['owner','admin']::public.app_role[]));

create policy messages_read on public.reservation_messages for select to authenticated using (public.is_org_member(organization_id));
create policy messages_insert on public.reservation_messages for insert to authenticated with check (author_id = (select auth.uid()) and public.has_org_role(organization_id, array['owner','admin','manager','analyst','broker']::public.app_role[]));
create policy documents_read on public.reservation_documents for select to authenticated using (public.is_org_member(organization_id));
create policy documents_insert on public.reservation_documents for insert to authenticated with check (uploaded_by = (select auth.uid()) and public.has_org_role(organization_id, array['owner','admin','manager','analyst','broker']::public.app_role[]));
create policy documents_review on public.reservation_documents for update to authenticated using (public.has_org_role(organization_id, array['owner','admin','manager','analyst']::public.app_role[])) with check (public.has_org_role(organization_id, array['owner','admin','manager','analyst']::public.app_role[]));
create policy audit_read on public.audit_events for select to authenticated using (public.has_org_role(organization_id, array['owner','admin','manager']::public.app_role[]));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reservation-documents', 'reservation-documents', false, 25165824, array['image/jpeg','image/png','image/gif','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/zip'])
on conflict (id) do nothing;

create policy storage_documents_read on storage.objects for select to authenticated
using (bucket_id = 'reservation-documents' and public.is_org_member((storage.foldername(name))[1]::uuid));
create policy storage_documents_insert on storage.objects for insert to authenticated
with check (bucket_id = 'reservation-documents' and public.has_org_role((storage.foldername(name))[1]::uuid, array['owner','admin','manager','analyst','broker']::public.app_role[]));
create policy storage_documents_delete on storage.objects for delete to authenticated
using (bucket_id = 'reservation-documents' and public.has_org_role((storage.foldername(name))[1]::uuid, array['owner','admin']::public.app_role[]));

insert into public.organizations (name, slug) values ('7LM Empreendimentos', '7lm') on conflict (slug) do nothing;
