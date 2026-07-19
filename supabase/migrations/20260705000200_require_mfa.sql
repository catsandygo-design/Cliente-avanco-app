-- Require a verified TOTP/phone second factor for all business data access.
-- Supabase adds aal2 to the JWT after a successful MFA challenge.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'organizations', 'organization_members', 'clients', 'reservations',
    'transfers', 'reservation_documents', 'reservation_messages', 'audit_events'
  ] loop
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using ((select auth.jwt()->>''aal'') = ''aal2'') with check ((select auth.jwt()->>''aal'') = ''aal2'')',
      table_name || '_mfa_required', table_name
    );
  end loop;
end $$;

create policy storage_documents_mfa_required
on storage.objects as restrictive for all to authenticated
using (bucket_id <> 'reservation-documents' or (select auth.jwt()->>'aal') = 'aal2')
with check (bucket_id <> 'reservation-documents' or (select auth.jwt()->>'aal') = 'aal2');
