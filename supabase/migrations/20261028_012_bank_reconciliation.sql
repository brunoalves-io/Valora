-- Valora v1.0.14 - bank reconciliation
-- Apply after 20260928_011_company_whatsapp.sql.

create table if not exists public.bank_reconciliations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  account_id uuid not null references public.financial_accounts(id) on delete cascade,
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  source_format text not null check (source_format in ('CSV', 'Excel', 'OFX')),
  statement_reference text,
  statement_date date not null,
  statement_description text not null check (char_length(trim(statement_description)) >= 1),
  statement_amount numeric(14,2) not null check (statement_amount > 0),
  statement_type text not null check (statement_type in ('income', 'expense')),
  matched_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  unique (company_id, transaction_id)
);

create index if not exists idx_bank_reconciliations_account_date
  on public.bank_reconciliations(company_id, account_id, statement_date desc);

create unique index if not exists idx_bank_reconciliations_statement_reference
  on public.bank_reconciliations(company_id, account_id, statement_reference)
  where statement_reference is not null;

alter table public.bank_reconciliations enable row level security;

drop policy if exists "members can read bank reconciliations" on public.bank_reconciliations;
create policy "members can read bank reconciliations"
  on public.bank_reconciliations for select
  using (public.is_company_member(company_id));

drop policy if exists "managers can write bank reconciliations" on public.bank_reconciliations;
create policy "managers can write bank reconciliations"
  on public.bank_reconciliations for all
  using (public.can_manage_company(company_id))
  with check (
    public.can_manage_company(company_id)
    and created_by = auth.uid()
  );

grant select, insert, update, delete on table public.bank_reconciliations to authenticated;

create or replace function public.reconcile_bank_statement_entry(
  p_company_id uuid,
  p_account_id uuid,
  p_transaction_id uuid,
  p_source_format text,
  p_statement_reference text,
  p_statement_date date,
  p_statement_description text,
  p_statement_amount numeric,
  p_statement_type text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transaction_id uuid;
  v_existing_transaction_id uuid;
  v_transaction public.transactions%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.can_manage_company(p_company_id) then
    raise exception 'Insufficient permission';
  end if;

  if p_source_format not in ('CSV', 'Excel', 'OFX') then
    raise exception 'Unsupported statement source';
  end if;

  if p_statement_type not in ('income', 'expense') then
    raise exception 'Invalid statement type';
  end if;

  if p_statement_amount is null or p_statement_amount <= 0 then
    raise exception 'Statement amount must be positive';
  end if;

  if not exists (
    select 1
    from public.financial_accounts a
    where a.id = p_account_id
      and a.company_id = p_company_id
  ) then
    raise exception 'Financial account must belong to the same company';
  end if;

  if p_statement_reference is not null then
    select br.transaction_id
      into v_existing_transaction_id
    from public.bank_reconciliations br
    where br.company_id = p_company_id
      and br.account_id = p_account_id
      and br.statement_reference = p_statement_reference
    limit 1;

    if v_existing_transaction_id is not null then
      return v_existing_transaction_id;
    end if;
  end if;

  if p_transaction_id is null then
    insert into public.transactions (
      company_id,
      type,
      description,
      amount,
      status,
      due_date,
      paid_at,
      account_id,
      category_id,
      cost_center_id,
      partner_id,
      notes,
      created_by
    )
    values (
      p_company_id,
      p_statement_type,
      trim(p_statement_description),
      p_statement_amount,
      'paid',
      p_statement_date,
      (p_statement_date::timestamp + time '12:00') at time zone 'UTC',
      p_account_id,
      null,
      null,
      null,
      'Importado e conciliado a partir de extrato bancário.',
      auth.uid()
    )
    returning id into v_transaction_id;
  else
    select *
      into v_transaction
    from public.transactions t
    where t.id = p_transaction_id
      and t.company_id = p_company_id;

    if v_transaction.id is null then
      raise exception 'Transaction not found';
    end if;

    if v_transaction.account_id is distinct from p_account_id then
      raise exception 'Transaction must belong to the selected account';
    end if;

    if v_transaction.status <> 'paid' then
      raise exception 'Only paid transactions can be reconciled';
    end if;

    if v_transaction.type <> p_statement_type then
      raise exception 'Transaction type does not match statement entry';
    end if;

    if abs(v_transaction.amount - p_statement_amount) > 0.009 then
      raise exception 'Transaction amount does not match statement entry';
    end if;

    if exists (
      select 1
      from public.bank_reconciliations br
      where br.company_id = p_company_id
        and br.transaction_id = p_transaction_id
    ) then
      raise exception 'Transaction is already reconciled';
    end if;

    v_transaction_id := p_transaction_id;
  end if;

  insert into public.bank_reconciliations (
    company_id,
    account_id,
    transaction_id,
    source_format,
    statement_reference,
    statement_date,
    statement_description,
    statement_amount,
    statement_type,
    created_by
  )
  values (
    p_company_id,
    p_account_id,
    v_transaction_id,
    p_source_format,
    nullif(trim(p_statement_reference), ''),
    p_statement_date,
    trim(p_statement_description),
    p_statement_amount,
    p_statement_type,
    auth.uid()
  );

  return v_transaction_id;
end;
$$;

revoke all on function public.reconcile_bank_statement_entry(
  uuid, uuid, uuid, text, text, date, text, numeric, text
) from public;

grant execute on function public.reconcile_bank_statement_entry(
  uuid, uuid, uuid, text, text, date, text, numeric, text
) to authenticated;
