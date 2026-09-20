-- Valora v0.3.0 - customers and suppliers
-- Apply after 20260920_002_financial_core.sql.

create table if not exists public.business_partners (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null default 'customer'
    check (kind in ('customer', 'supplier', 'both')),
  name text not null check (char_length(trim(name)) >= 2),
  document text,
  email text,
  phone text,
  city text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_business_partners_company
  on public.business_partners(company_id);

create index if not exists idx_business_partners_company_kind
  on public.business_partners(company_id, kind);

create unique index if not exists idx_business_partners_company_document_unique
  on public.business_partners(company_id, document)
  where document is not null and length(trim(document)) > 0;

alter table public.transactions
  add column if not exists partner_id uuid references public.business_partners(id) on delete set null;

create index if not exists idx_transactions_partner
  on public.transactions(partner_id);

alter table public.business_partners enable row level security;

drop policy if exists "members can read business partners" on public.business_partners;
create policy "members can read business partners"
  on public.business_partners for select
  using (public.is_company_member(company_id));

drop policy if exists "managers can write business partners" on public.business_partners;
create policy "managers can write business partners"
  on public.business_partners for all
  using (public.can_manage_company(company_id))
  with check (public.can_manage_company(company_id));

grant select, insert, update, delete on table public.business_partners to authenticated;

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

  if new.partner_id is not null and not exists (
    select 1
    from public.business_partners bp
    where bp.id = new.partner_id
      and bp.company_id = new.company_id
      and (
        bp.kind = 'both'
        or (new.type = 'income' and bp.kind = 'customer')
        or (new.type = 'expense' and bp.kind = 'supplier')
      )
  ) then
    raise exception 'Business partner must belong to the same company and match transaction type';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_transaction_scope_trigger on public.transactions;
create trigger validate_transaction_scope_trigger
  before insert or update of company_id, account_id, category_id, cost_center_id, partner_id, type
  on public.transactions
  for each row execute procedure public.validate_transaction_scope();

revoke all on function public.validate_transaction_scope() from public;
