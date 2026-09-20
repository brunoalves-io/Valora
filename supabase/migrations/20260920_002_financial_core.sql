-- Valora v0.2.0 - financial management core
-- Apply after 20260918_001_initial_core.sql.

alter table public.categories
  add column if not exists parent_id uuid references public.categories(id) on delete set null;

create index if not exists idx_categories_parent
  on public.categories(parent_id);

create table if not exists public.cost_centers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (char_length(trim(name)) >= 2),
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);

create index if not exists idx_cost_centers_company
  on public.cost_centers(company_id);

alter table public.transactions
  add column if not exists cost_center_id uuid references public.cost_centers(id) on delete set null;

create index if not exists idx_transactions_cost_center
  on public.transactions(cost_center_id);

alter table public.cost_centers enable row level security;

drop policy if exists "members can read cost centers" on public.cost_centers;
create policy "members can read cost centers"
  on public.cost_centers for select
  using (public.is_company_member(company_id));

drop policy if exists "managers can write cost centers" on public.cost_centers;
create policy "managers can write cost centers"
  on public.cost_centers for all
  using (public.can_manage_company(company_id))
  with check (public.can_manage_company(company_id));

grant select, insert, update, delete on table public.cost_centers to authenticated;


-- Multi-tenant relationship guards.
create or replace function public.validate_category_parent_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.parent_id is not null then
    if new.parent_id = new.id then
      raise exception 'A category cannot be its own parent';
    end if;

    if not exists (
      select 1
      from public.categories parent
      where parent.id = new.parent_id
        and parent.company_id = new.company_id
        and parent.parent_id is null
    ) then
      raise exception 'Parent category must belong to the same company and be a root category';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists validate_category_parent_scope_trigger on public.categories;
create trigger validate_category_parent_scope_trigger
  before insert or update of company_id, parent_id
  on public.categories
  for each row execute procedure public.validate_category_parent_scope();

create or replace function public.validate_transaction_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.account_id is not null and not exists (
    select 1 from public.financial_accounts a
    where a.id = new.account_id and a.company_id = new.company_id
  ) then
    raise exception 'Financial account must belong to the same company';
  end if;

  if new.category_id is not null and not exists (
    select 1 from public.categories c
    where c.id = new.category_id
      and c.company_id = new.company_id
      and (c.type = new.type or c.type = 'both')
  ) then
    raise exception 'Category must belong to the same company and match transaction type';
  end if;

  if new.cost_center_id is not null and not exists (
    select 1 from public.cost_centers cc
    where cc.id = new.cost_center_id and cc.company_id = new.company_id
  ) then
    raise exception 'Cost center must belong to the same company';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_transaction_scope_trigger on public.transactions;
create trigger validate_transaction_scope_trigger
  before insert or update of company_id, account_id, category_id, cost_center_id, type
  on public.transactions
  for each row execute procedure public.validate_transaction_scope();

revoke all on function public.validate_category_parent_scope() from public;
revoke all on function public.validate_transaction_scope() from public;
