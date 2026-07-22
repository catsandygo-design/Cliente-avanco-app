
create table if not exists public.pre_registration_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  pre_registration_id uuid not null references public.pre_registrations(id) on delete cascade,
  person_type text not null default 'Titular',
  document_type text not null default 'Documento adicional',
  file_name text not null,
  storage_path text not null unique,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  uploaded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists pre_registration_documents_pre_idx on public.pre_registration_documents(pre_registration_id, created_at desc);
alter table public.pre_registration_documents enable row level security;
create policy pre_docs_read on public.pre_registration_documents for select to authenticated using (public.is_org_member(organization_id));
create policy pre_docs_insert on public.pre_registration_documents for insert to authenticated with check (uploaded_by = (select auth.uid()) and public.has_org_role(organization_id, array['owner','admin','manager','analyst','broker']::public.app_role[]));
create policy pre_docs_delete on public.pre_registration_documents for delete to authenticated using (public.has_org_role(organization_id, array['owner','admin','manager','analyst','broker']::public.app_role[]));

