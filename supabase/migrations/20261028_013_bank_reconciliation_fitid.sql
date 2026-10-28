-- Valora v1.0.16 - explicit OFX FITID duplicate protection
-- Apply after 20261028_012_bank_reconciliation.sql.

alter table public.bank_reconciliations
  add column if not exists statement_fitid text;

-- Existing OFX reconciliations already stored FITID in statement_reference.
-- Backfill the explicit field so old imports remain protected.
update public.bank_reconciliations
set statement_fitid = nullif(trim(statement_reference), '')
where source_format = 'OFX'
  and statement_fitid is null
  and statement_reference is not null;

create unique index if not exists idx_bank_reconciliations_fitid
  on public.bank_reconciliations(company_id, account_id, statement_fitid)
  where statement_fitid is not null;

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
  v_reference text := nullif(trim(p_statement_reference), '');
  v_fitid text;
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

  -- OFX/QFX parsers send FITID as statement_reference.
  -- Persist it explicitly and use it as the strongest idempotency key.
  if p_source_format = 'OFX' then
    v_fitid := v_reference;
  end if;

  if v_fitid is not null then
    select br.transaction_id
      into v_existing_transaction_id
    from public.bank_reconciliations br
    where br.company_id = p_company_id
      and br.account_id = p_account_id
      and (
        br.statement_fitid = v_fitid
        or (
          br.statement_fitid is null
          and br.source_format = 'OFX'
          and br.statement_reference = v_fitid
        )
      )
    limit 1;

    if v_existing_transaction_id is not null then
      return v_existing_transaction_id;
    end if;
  end if;

  -- Keep the general statement-reference idempotency used by all formats.
  if v_reference is not null then
    select br.transaction_id
      into v_existing_transaction_id
    from public.bank_reconciliations br
    where br.company_id = p_company_id
      and br.account_id = p_account_id
      and br.statement_reference = v_reference
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
    statement_fitid,
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
    v_reference,
    v_fitid,
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
