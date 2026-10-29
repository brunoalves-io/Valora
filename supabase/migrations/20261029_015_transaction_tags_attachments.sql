-- Valora v1.0.20 - transaction tags and private attachments
-- Apply after 20261029_014_professional_dre.sql.

create table if not exists public.transaction_tags (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 40),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_transaction_tags_company_name
  on public.transaction_tags(company_id, lower(name));

create index if not exists idx_transaction_tags_company
  on public.transaction_tags(company_id);

create table if not exists public.transaction_tag_links (
  company_id uuid not null references public.companies(id) on delete cascade,
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  tag_id uuid not null references public.transaction_tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (transaction_id, tag_id)
);

create index if not exists idx_transaction_tag_links_company
  on public.transaction_tag_links(company_id);

create index if not exists idx_transaction_tag_links_tag
  on public.transaction_tag_links(tag_id);

create table if not exists public.transaction_attachments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  file_name text not null check (char_length(trim(file_name)) between 1 and 180),
  file_path text not null unique,
  mime_type text,
  file_size bigint not null default 0 check (file_size >= 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_transaction_attachments_company_transaction
  on public.transaction_attachments(company_id, transaction_id);

create or replace function public.validate_transaction_tag_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.transactions t
    where t.id = new.transaction_id
      and t.company_id = new.company_id
  ) then
    raise exception 'Transaction must belong to the same company';
  end if;

  if not exists (
    select 1
    from public.transaction_tags tag
    where tag.id = new.tag_id
      and tag.company_id = new.company_id
  ) then
    raise exception 'Tag must belong to the same company';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_transaction_tag_scope_trigger
  on public.transaction_tag_links;
create trigger validate_transaction_tag_scope_trigger
  before insert or update of company_id, transaction_id, tag_id
  on public.transaction_tag_links
  for each row execute procedure public.validate_transaction_tag_scope();

create or replace function public.validate_transaction_attachment_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.transactions t
    where t.id = new.transaction_id
      and t.company_id = new.company_id
  ) then
    raise exception 'Transaction must belong to the same company';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_transaction_attachment_scope_trigger
  on public.transaction_attachments;
create trigger validate_transaction_attachment_scope_trigger
  before insert or update of company_id, transaction_id
  on public.transaction_attachments
  for each row execute procedure public.validate_transaction_attachment_scope();

alter table public.transaction_tags enable row level security;
alter table public.transaction_tag_links enable row level security;
alter table public.transaction_attachments enable row level security;

drop policy if exists "members can read transaction tags" on public.transaction_tags;
create policy "members can read transaction tags"
  on public.transaction_tags for select
  using (public.is_company_member(company_id));

drop policy if exists "managers can write transaction tags" on public.transaction_tags;
create policy "managers can write transaction tags"
  on public.transaction_tags for all
  using (public.can_manage_company(company_id))
  with check (public.can_manage_company(company_id));

drop policy if exists "members can read transaction tag links" on public.transaction_tag_links;
create policy "members can read transaction tag links"
  on public.transaction_tag_links for select
  using (public.is_company_member(company_id));

drop policy if exists "managers can write transaction tag links" on public.transaction_tag_links;
create policy "managers can write transaction tag links"
  on public.transaction_tag_links for all
  using (public.can_manage_company(company_id))
  with check (public.can_manage_company(company_id));

drop policy if exists "members can read transaction attachments" on public.transaction_attachments;
create policy "members can read transaction attachments"
  on public.transaction_attachments for select
  using (public.is_company_member(company_id));

drop policy if exists "managers can write transaction attachments" on public.transaction_attachments;
create policy "managers can write transaction attachments"
  on public.transaction_attachments for all
  using (public.can_manage_company(company_id))
  with check (public.can_manage_company(company_id));

grant select, insert, update, delete on table public.transaction_tags to authenticated;
grant select, insert, update, delete on table public.transaction_tag_links to authenticated;
grant select, insert, update, delete on table public.transaction_attachments to authenticated;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'transaction-attachments',
  'transaction-attachments',
  false,
  10485760,
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'text/plain',
    'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "company members can read transaction attachments" on storage.objects;
create policy "company members can read transaction attachments"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'transaction-attachments'
    and exists (
      select 1
      from public.company_members cm
      where cm.company_id::text = split_part(name, '/', 1)
        and cm.user_id = auth.uid()
    )
  );

drop policy if exists "company managers can upload transaction attachments" on storage.objects;
create policy "company managers can upload transaction attachments"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'transaction-attachments'
    and exists (
      select 1
      from public.company_members cm
      where cm.company_id::text = split_part(name, '/', 1)
        and cm.user_id = auth.uid()
        and cm.role in ('owner', 'admin')
    )
  );

drop policy if exists "company managers can update transaction attachments" on storage.objects;
create policy "company managers can update transaction attachments"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'transaction-attachments'
    and exists (
      select 1
      from public.company_members cm
      where cm.company_id::text = split_part(name, '/', 1)
        and cm.user_id = auth.uid()
        and cm.role in ('owner', 'admin')
    )
  )
  with check (
    bucket_id = 'transaction-attachments'
    and exists (
      select 1
      from public.company_members cm
      where cm.company_id::text = split_part(name, '/', 1)
        and cm.user_id = auth.uid()
        and cm.role in ('owner', 'admin')
    )
  );

drop policy if exists "company managers can delete transaction attachments" on storage.objects;
create policy "company managers can delete transaction attachments"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'transaction-attachments'
    and exists (
      select 1
      from public.company_members cm
      where cm.company_id::text = split_part(name, '/', 1)
        and cm.user_id = auth.uid()
        and cm.role in ('owner', 'admin')
    )
  );

revoke all on function public.validate_transaction_tag_scope() from public;
revoke all on function public.validate_transaction_attachment_scope() from public;
