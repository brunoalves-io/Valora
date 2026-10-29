-- Valora v1.0.26 - Open Finance / bank connections foundation

create table if not exists public.bank_connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  provider text not null default 'pluggy'
    check (char_length(trim(provider)) between 2 and 40),
  provider_item_id text not null
    check (char_length(trim(provider_item_id)) between 2 and 180),
  connector_id text,
  institution_name text not null
    check (char_length(trim(institution_name)) between 1 and 180),
  institution_logo_url text,
  institution_primary_color text,
  connection_type text not null default 'aggregation'
    check (connection_type in ('aggregation', 'open_finance', 'unknown')),
  status text not null default 'active'
    check (status in ('pending', 'active', 'error', 'revoked')),
  last_sync_at timestamptz,
  last_successful_sync_at timestamptz,
  last_error text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_item_id)
);

create index if not exists idx_bank_connections_company
  on public.bank_connections(company_id, updated_at desc);

create table if not exists public.bank_connection_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  connection_id uuid not null references public.bank_connections(id) on delete cascade,
  provider_account_id text not null
    check (char_length(trim(provider_account_id)) between 2 and 180),
  name text not null
    check (char_length(trim(name)) between 1 and 180),
  account_type text not null default 'other'
    check (account_type in ('bank', 'credit', 'other')),
  subtype text,
  number_masked text,
  currency_code text not null default 'BRL'
    check (char_length(currency_code) between 3 and 8),
  balance numeric(18,2),
  available_balance numeric(18,2),
  local_account_id uuid references public.financial_accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, provider_account_id)
);

create index if not exists idx_bank_connection_accounts_company
  on public.bank_connection_accounts(company_id, connection_id);

create index if not exists idx_bank_connection_accounts_local
  on public.bank_connection_accounts(local_account_id)
  where local_account_id is not null;

create table if not exists public.bank_connection_transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  external_account_id uuid not null references public.bank_connection_accounts(id) on delete cascade,
  provider_transaction_id text not null
    check (char_length(trim(provider_transaction_id)) between 2 and 180),
  provider_id text,
  provider_code text,
  description text not null
    check (char_length(trim(description)) between 1 and 500),
  description_raw text,
  movement_type text not null
    check (movement_type in ('income', 'expense')),
  provider_type text not null
    check (provider_type in ('CREDIT', 'DEBIT')),
  status text not null default 'POSTED'
    check (status in ('POSTED', 'PENDING', 'UNKNOWN')),
  amount numeric(18,2) not null check (amount >= 0),
  raw_amount numeric(18,2) not null,
  currency_code text not null default 'BRL'
    check (char_length(currency_code) between 3 and 8),
  transaction_at timestamptz not null,
  transaction_date date not null,
  balance numeric(18,2),
  category text,
  operation_type text,
  provider_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (external_account_id, provider_transaction_id)
);

create index if not exists idx_bank_connection_transactions_company_date
  on public.bank_connection_transactions(company_id, transaction_date desc);

create index if not exists idx_bank_connection_transactions_account_date
  on public.bank_connection_transactions(external_account_id, transaction_date desc);

create table if not exists public.bank_sync_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  connection_id uuid not null references public.bank_connections(id) on delete cascade,
  status text not null default 'running'
    check (status in ('running', 'success', 'error')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  accounts_synced integer not null default 0 check (accounts_synced >= 0),
  transactions_upserted integer not null default 0 check (transactions_upserted >= 0),
  error_message text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null
);

create index if not exists idx_bank_sync_runs_connection
  on public.bank_sync_runs(connection_id, started_at desc);

alter table public.bank_connections enable row level security;
alter table public.bank_connection_accounts enable row level security;
alter table public.bank_connection_transactions enable row level security;
alter table public.bank_sync_runs enable row level security;

drop policy if exists "members can read bank connections" on public.bank_connections;
create policy "members can read bank connections"
  on public.bank_connections for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists "managers can create bank connections" on public.bank_connections;
create policy "managers can create bank connections"
  on public.bank_connections for insert to authenticated
  with check (public.can_manage_company(company_id));

drop policy if exists "managers can update bank connections" on public.bank_connections;
create policy "managers can update bank connections"
  on public.bank_connections for update to authenticated
  using (public.can_manage_company(company_id))
  with check (public.can_manage_company(company_id));

drop policy if exists "managers can delete bank connections" on public.bank_connections;
create policy "managers can delete bank connections"
  on public.bank_connections for delete to authenticated
  using (public.can_manage_company(company_id));

drop policy if exists "members can read bank connection accounts" on public.bank_connection_accounts;
create policy "members can read bank connection accounts"
  on public.bank_connection_accounts for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists "managers can create bank connection accounts" on public.bank_connection_accounts;
create policy "managers can create bank connection accounts"
  on public.bank_connection_accounts for insert to authenticated
  with check (public.can_manage_company(company_id));

drop policy if exists "managers can update bank connection accounts" on public.bank_connection_accounts;
create policy "managers can update bank connection accounts"
  on public.bank_connection_accounts for update to authenticated
  using (public.can_manage_company(company_id))
  with check (public.can_manage_company(company_id));

drop policy if exists "managers can delete bank connection accounts" on public.bank_connection_accounts;
create policy "managers can delete bank connection accounts"
  on public.bank_connection_accounts for delete to authenticated
  using (public.can_manage_company(company_id));

drop policy if exists "members can read bank connection transactions" on public.bank_connection_transactions;
create policy "members can read bank connection transactions"
  on public.bank_connection_transactions for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists "managers can create bank connection transactions" on public.bank_connection_transactions;
create policy "managers can create bank connection transactions"
  on public.bank_connection_transactions for insert to authenticated
  with check (public.can_manage_company(company_id));

drop policy if exists "managers can update bank connection transactions" on public.bank_connection_transactions;
create policy "managers can update bank connection transactions"
  on public.bank_connection_transactions for update to authenticated
  using (public.can_manage_company(company_id))
  with check (public.can_manage_company(company_id));

drop policy if exists "managers can delete bank connection transactions" on public.bank_connection_transactions;
create policy "managers can delete bank connection transactions"
  on public.bank_connection_transactions for delete to authenticated
  using (public.can_manage_company(company_id));

drop policy if exists "members can read bank sync runs" on public.bank_sync_runs;
create policy "members can read bank sync runs"
  on public.bank_sync_runs for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists "managers can create bank sync runs" on public.bank_sync_runs;
create policy "managers can create bank sync runs"
  on public.bank_sync_runs for insert to authenticated
  with check (public.can_manage_company(company_id));

drop policy if exists "managers can update bank sync runs" on public.bank_sync_runs;
create policy "managers can update bank sync runs"
  on public.bank_sync_runs for update to authenticated
  using (public.can_manage_company(company_id))
  with check (public.can_manage_company(company_id));

drop policy if exists "managers can delete bank sync runs" on public.bank_sync_runs;
create policy "managers can delete bank sync runs"
  on public.bank_sync_runs for delete to authenticated
  using (public.can_manage_company(company_id));

grant select, insert, update, delete on table public.bank_connections to authenticated;
grant select, insert, update, delete on table public.bank_connection_accounts to authenticated;
grant select, insert, update, delete on table public.bank_connection_transactions to authenticated;
grant select, insert, update, delete on table public.bank_sync_runs to authenticated;

create or replace function public.validate_bank_connection_account_scope()
returns trigger language plpgsql set search_path = public
as $$
begin
  if not exists (
    select 1 from public.bank_connections bc
    where bc.id = new.connection_id and bc.company_id = new.company_id
  ) then
    raise exception 'Bank connection must belong to the same company';
  end if;

  if new.local_account_id is not null and not exists (
    select 1 from public.financial_accounts fa
    where fa.id = new.local_account_id and fa.company_id = new.company_id
  ) then
    raise exception 'Local financial account must belong to the same company';
  end if;

  return new;
end;
$$;

create or replace function public.validate_bank_connection_transaction_scope()
returns trigger language plpgsql set search_path = public
as $$
begin
  if not exists (
    select 1 from public.bank_connection_accounts bca
    where bca.id = new.external_account_id and bca.company_id = new.company_id
  ) then
    raise exception 'External bank account must belong to the same company';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_bank_connection_account_scope_trigger
  on public.bank_connection_accounts;
create trigger validate_bank_connection_account_scope_trigger
  before insert or update of company_id, connection_id, local_account_id
  on public.bank_connection_accounts
  for each row execute procedure public.validate_bank_connection_account_scope();

drop trigger if exists validate_bank_connection_transaction_scope_trigger
  on public.bank_connection_transactions;
create trigger validate_bank_connection_transaction_scope_trigger
  before insert or update of company_id, external_account_id
  on public.bank_connection_transactions
  for each row execute procedure public.validate_bank_connection_transaction_scope();

revoke execute on function public.validate_bank_connection_account_scope()
  from public, anon, authenticated;
revoke execute on function public.validate_bank_connection_transaction_scope()
  from public, anon, authenticated;
