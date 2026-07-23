
alter table public.pre_registrations
  add column if not exists approval_status text not null default 'Aguardando',
  add column if not exists rejection_reason text,
  add column if not exists details jsonb not null default '{}'::jsonb;

alter table public.pre_registration_documents
  add column if not exists status text not null default 'Aguardando aprovação',
  add column if not exists valid_until date;

create policy pre_docs_update on public.pre_registration_documents
  for update to authenticated
  using (public.has_org_role(organization_id, array['owner','admin','manager','analyst']::public.app_role[]))
  with check (public.has_org_role(organization_id, array['owner','admin','manager','analyst']::public.app_role[]));

