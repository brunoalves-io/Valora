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
