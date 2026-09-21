-- Valora v1.0.0 - company branding storage
-- Apply after 20260921_009_company_settings.sql.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'company-branding',
  'company-branding',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "company managers can upload branding" on storage.objects;
create policy "company managers can upload branding"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'company-branding'
    and exists (
      select 1
      from public.company_members cm
      where cm.company_id::text = split_part(name, '/', 1)
        and cm.user_id = auth.uid()
        and cm.role in ('owner', 'admin')
    )
  );

drop policy if exists "company managers can update branding" on storage.objects;
create policy "company managers can update branding"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'company-branding'
    and exists (
      select 1
      from public.company_members cm
      where cm.company_id::text = split_part(name, '/', 1)
        and cm.user_id = auth.uid()
        and cm.role in ('owner', 'admin')
    )
  )
  with check (
    bucket_id = 'company-branding'
    and exists (
      select 1
      from public.company_members cm
      where cm.company_id::text = split_part(name, '/', 1)
        and cm.user_id = auth.uid()
        and cm.role in ('owner', 'admin')
    )
  );

drop policy if exists "company managers can delete branding" on storage.objects;
create policy "company managers can delete branding"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'company-branding'
    and exists (
      select 1
      from public.company_members cm
      where cm.company_id::text = split_part(name, '/', 1)
        and cm.user_id = auth.uid()
        and cm.role in ('owner', 'admin')
    )
  );
