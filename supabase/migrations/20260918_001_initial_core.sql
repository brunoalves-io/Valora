-- Valora v0.2 - multi-company foundation and financial core
-- Run this migration in Supabase before using the authenticated app.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) >= 2),
  slug text not null unique,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_members (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member'
    check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

create table if not exists public.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  kind text not null default 'cash'
    check (kind in ('cash', 'checking', 'savings', 'wallet', 'other')),
  opening_balance numeric(14,2) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  type text not null default 'both'
    check (type in ('income', 'expense', 'both')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, name, type)
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  type text not null check (type in ('income', 'expense')),
  description text not null check (char_length(trim(description)) >= 2),
  amount numeric(14,2) not null check (amount > 0),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'cancelled')),
  due_date date not null,
  paid_at timestamptz,
  account_id uuid references public.financial_accounts(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  notes text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_company_members_user
  on public.company_members(user_id);

create index if not exists idx_transactions_company_due
  on public.transactions(company_id, due_date);

create index if not exists idx_transactions_company_status
  on public.transactions(company_id, status);

create index if not exists idx_accounts_company
  on public.financial_accounts(company_id);

create index if not exists idx_categories_company
  on public.categories(company_id);

create or replace function public.is_company_member(target_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_members
    where company_id = target_company
      and user_id = auth.uid()
  );
$$;

create or replace function public.can_manage_company(target_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_members
    where company_id = target_company
      and user_id = auth.uid()
      and role in ('owner', 'admin', 'member')
  );
$$;

revoke all on function public.is_company_member(uuid) from public;
revoke all on function public.can_manage_company(uuid) from public;
grant execute on function public.is_company_member(uuid) to authenticated;
grant execute on function public.can_manage_company(uuid) to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.create_company_with_owner(company_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_company_id uuid;
  clean_name text;
  generated_slug text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  clean_name := trim(company_name);
  if char_length(clean_name) < 2 then
    raise exception 'Company name must have at least 2 characters';
  end if;

  generated_slug :=
    trim(both '-' from regexp_replace(lower(clean_name), '[^a-z0-9]+', '-', 'g'))
    || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);

  insert into public.companies (name, slug, created_by)
  values (clean_name, generated_slug, auth.uid())
  returning id into new_company_id;

  insert into public.company_members (company_id, user_id, role)
  values (new_company_id, auth.uid(), 'owner');

  insert into public.financial_accounts (company_id, name, kind)
  values (new_company_id, 'Caixa', 'cash');

  insert into public.categories (company_id, name, type)
  values
    (new_company_id, 'Vendas e serviços', 'income'),
    (new_company_id, 'Outras receitas', 'income'),
    (new_company_id, 'Fornecedores', 'expense'),
    (new_company_id, 'Administrativo', 'expense'),
    (new_company_id, 'Marketing', 'expense'),
    (new_company_id, 'Impostos e taxas', 'expense'),
    (new_company_id, 'Outras despesas', 'expense');

  return new_company_id;
end;
$$;

revoke all on function public.create_company_with_owner(text) from public;
grant execute on function public.create_company_with_owner(text) to authenticated;

alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.financial_accounts enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;

drop policy if exists "users can read own profile" on public.profiles;
create policy "users can read own profile"
  on public.profiles for select
  using (id = auth.uid());

drop policy if exists "users can update own profile" on public.profiles;
create policy "users can update own profile"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists "members can read companies" on public.companies;
create policy "members can read companies"
  on public.companies for select
  using (public.is_company_member(id));

drop policy if exists "owners and admins can update companies" on public.companies;
create policy "owners and admins can update companies"
  on public.companies for update
  using (
    exists (
      select 1 from public.company_members
      where company_id = companies.id
        and user_id = auth.uid()
        and role in ('owner', 'admin')
    )
  );

drop policy if exists "members can view company members" on public.company_members;
create policy "members can view company members"
  on public.company_members for select
  using (public.is_company_member(company_id));

drop policy if exists "members can read accounts" on public.financial_accounts;
create policy "members can read accounts"
  on public.financial_accounts for select
  using (public.is_company_member(company_id));

drop policy if exists "managers can write accounts" on public.financial_accounts;
create policy "managers can write accounts"
  on public.financial_accounts for all
  using (public.can_manage_company(company_id))
  with check (public.can_manage_company(company_id));

drop policy if exists "members can read categories" on public.categories;
create policy "members can read categories"
  on public.categories for select
  using (public.is_company_member(company_id));

drop policy if exists "managers can write categories" on public.categories;
create policy "managers can write categories"
  on public.categories for all
  using (public.can_manage_company(company_id))
  with check (public.can_manage_company(company_id));

drop policy if exists "members can read transactions" on public.transactions;
create policy "members can read transactions"
  on public.transactions for select
  using (public.is_company_member(company_id));

drop policy if exists "managers can insert transactions" on public.transactions;
create policy "managers can insert transactions"
  on public.transactions for insert
  with check (
    public.can_manage_company(company_id)
    and created_by = auth.uid()
  );

drop policy if exists "managers can update transactions" on public.transactions;
create policy "managers can update transactions"
  on public.transactions for update
  using (public.can_manage_company(company_id))
  with check (public.can_manage_company(company_id));

drop policy if exists "managers can delete transactions" on public.transactions;
create policy "managers can delete transactions"
  on public.transactions for delete
  using (public.can_manage_company(company_id));


-- Explicit Data API privileges.
-- This lets us keep "Automatically expose new tables" disabled in Supabase
-- and grant access only to the objects Valora actually uses.
grant usage on schema public to authenticated;

grant select, update on table public.profiles to authenticated;
grant select, update on table public.companies to authenticated;
grant select on table public.company_members to authenticated;
grant select, insert, update, delete on table public.financial_accounts to authenticated;
grant select, insert, update, delete on table public.categories to authenticated;
grant select, insert, update, delete on table public.transactions to authenticated;
