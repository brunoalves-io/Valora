-- Valora v1.0.33 - safe automatic bank reconciliation

create table if not exists public.bank_reconciliation_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  safe_auto_reconcile_enabled boolean not null default false,
  minimum_auto_score integer not null default 92
    check (minimum_auto_score between 85 and 100),
  detect_duplicates boolean not null default true,
  detect_transfers boolean not null default true,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.bank_reconciliation_settings enable row level security;

drop policy if exists "members can read bank reconciliation settings"
  on public.bank_reconciliation_settings;
create policy "members can read bank reconciliation settings"
  on public.bank_reconciliation_settings
  for select
  to authenticated
  using (public.is_company_member(company_id));

drop policy if exists "managers can create bank reconciliation settings"
  on public.bank_reconciliation_settings;
create policy "managers can create bank reconciliation settings"
  on public.bank_reconciliation_settings
  for insert
  to authenticated
  with check (
    public.can_manage_company(company_id)
    and (updated_by is null or updated_by = (select auth.uid()))
  );

drop policy if exists "managers can update bank reconciliation settings"
  on public.bank_reconciliation_settings;
create policy "managers can update bank reconciliation settings"
  on public.bank_reconciliation_settings
  for update
  to authenticated
  using (public.can_manage_company(company_id))
  with check (
    public.can_manage_company(company_id)
    and (updated_by is null or updated_by = (select auth.uid()))
  );

grant select, insert, update on table public.bank_reconciliation_settings
  to authenticated;

alter table public.bank_reconciliations
  add column if not exists reconciliation_mode text not null default 'manual',
  add column if not exists automation_score integer,
  add column if not exists automation_reason text;

alter table public.bank_reconciliations
  drop constraint if exists bank_reconciliations_reconciliation_mode_check;
alter table public.bank_reconciliations
  add constraint bank_reconciliations_reconciliation_mode_check
  check (reconciliation_mode in ('manual', 'automatic'));

alter table public.bank_reconciliations
  drop constraint if exists bank_reconciliations_automation_score_check;
alter table public.bank_reconciliations
  add constraint bank_reconciliations_automation_score_check
  check (automation_score is null or automation_score between 0 and 100);

create index if not exists idx_bank_reconciliations_mode
  on public.bank_reconciliations(company_id, account_id, reconciliation_mode, statement_date desc);

create or replace function public.reconcile_bank_statement_entry_v3(
  p_company_id uuid,
  p_account_id uuid,
  p_transaction_id uuid,
  p_source_format text,
  p_statement_reference text,
  p_statement_date date,
  p_statement_description text,
  p_statement_amount numeric,
  p_statement_type text,
  p_category_id uuid,
  p_reconciliation_mode text,
  p_automation_score integer,
  p_automation_reason text
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
  v_notes text;
  v_settings public.bank_reconciliation_settings%rowtype;
  v_transaction_date date;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.can_manage_company(p_company_id) then raise exception 'Insufficient permission'; end if;
  if p_source_format not in ('CSV', 'Excel', 'OFX', 'Open Finance') then raise exception 'Unsupported statement source'; end if;
  if p_statement_type not in ('income', 'expense') then raise exception 'Invalid statement type'; end if;
  if p_statement_amount is null or p_statement_amount <= 0 then raise exception 'Statement amount must be positive'; end if;
  if p_reconciliation_mode not in ('manual', 'automatic') then raise exception 'Invalid reconciliation mode'; end if;

  if not exists (
    select 1 from public.financial_accounts a
    where a.id = p_account_id and a.company_id = p_company_id
  ) then
    raise exception 'Financial account must belong to the same company';
  end if;

  if p_category_id is not null and not exists (
    select 1 from public.categories c
    where c.id = p_category_id
      and c.company_id = p_company_id
      and c.active = true
      and c.type in (p_statement_type, 'both')
  ) then
    raise exception 'Category is invalid for this transaction';
  end if;

  if p_reconciliation_mode = 'automatic' then
    if p_source_format <> 'Open Finance' then raise exception 'Automatic reconciliation is only available for Open Finance'; end if;
    if p_transaction_id is null then raise exception 'Automatic reconciliation cannot create new transactions'; end if;

    select * into v_settings
    from public.bank_reconciliation_settings s
    where s.company_id = p_company_id;

    if v_settings.company_id is null or v_settings.safe_auto_reconcile_enabled is not true then
      raise exception 'Safe automatic reconciliation is disabled';
    end if;

    if p_automation_score is null or p_automation_score < v_settings.minimum_auto_score then
      raise exception 'Automation score is below the configured threshold';
    end if;
  end if;

  if p_source_format = 'OFX' then v_fitid := v_reference; end if;

  if v_fitid is not null then
    select br.transaction_id into v_existing_transaction_id
    from public.bank_reconciliations br
    where br.company_id = p_company_id
      and br.account_id = p_account_id
      and (
        br.statement_fitid = v_fitid
        or (br.statement_fitid is null and br.source_format = 'OFX' and br.statement_reference = v_fitid)
      )
    limit 1;

    if v_existing_transaction_id is not null then
      if p_category_id is not null then
        update public.transactions
        set category_id = p_category_id, updated_at = now()
        where id = v_existing_transaction_id and company_id = p_company_id;
      end if;
      return v_existing_transaction_id;
    end if;
  end if;

  if v_reference is not null then
    select br.transaction_id into v_existing_transaction_id
    from public.bank_reconciliations br
    where br.company_id = p_company_id
      and br.account_id = p_account_id
      and br.statement_reference = v_reference
    limit 1;

    if v_existing_transaction_id is not null then
      if p_category_id is not null then
        update public.transactions
        set category_id = p_category_id, updated_at = now()
        where id = v_existing_transaction_id and company_id = p_company_id;
      end if;
      return v_existing_transaction_id;
    end if;
  end if;

  if p_transaction_id is null then
    v_notes := case
      when p_source_format = 'Open Finance' then 'Criado e conciliado a partir do Open Finance.'
      else 'Importado e conciliado a partir de extrato bancário.'
    end;

    insert into public.transactions (
      company_id, type, description, amount, status, due_date, paid_at,
      account_id, category_id, cost_center_id, partner_id, notes, created_by
    ) values (
      p_company_id, p_statement_type, trim(p_statement_description), p_statement_amount,
      'paid', p_statement_date, (p_statement_date::timestamp + time '12:00') at time zone 'UTC',
      p_account_id, p_category_id, null, null, v_notes, auth.uid()
    )
    returning id into v_transaction_id;
  else
    select * into v_transaction
    from public.transactions t
    where t.id = p_transaction_id and t.company_id = p_company_id;

    if v_transaction.id is null then raise exception 'Transaction not found'; end if;
    if v_transaction.account_id is distinct from p_account_id then raise exception 'Transaction must belong to the selected account'; end if;
    if v_transaction.status <> 'paid' then raise exception 'Only paid transactions can be reconciled'; end if;
    if v_transaction.type <> p_statement_type then raise exception 'Transaction type does not match statement entry'; end if;
    if abs(v_transaction.amount - p_statement_amount) > 0.009 then raise exception 'Transaction amount does not match statement entry'; end if;

    if exists (
      select 1 from public.bank_reconciliations br
      where br.company_id = p_company_id and br.transaction_id = p_transaction_id
    ) then
      raise exception 'Transaction is already reconciled';
    end if;

    if p_reconciliation_mode = 'automatic' then
      v_transaction_date := coalesce(v_transaction.paid_at::date, v_transaction.due_date);
      if abs(v_transaction_date - p_statement_date) > 1 then
        raise exception 'Automatic reconciliation requires dates within one day';
      end if;
    end if;

    v_transaction_id := p_transaction_id;

    if p_category_id is not null then
      update public.transactions
      set category_id = p_category_id, updated_at = now()
      where id = v_transaction_id and company_id = p_company_id;
    end if;
  end if;

  insert into public.bank_reconciliations (
    company_id, account_id, transaction_id, source_format, statement_reference,
    statement_fitid, statement_date, statement_description, statement_amount,
    statement_type, reconciliation_mode, automation_score, automation_reason, created_by
  ) values (
    p_company_id, p_account_id, v_transaction_id, p_source_format, v_reference,
    v_fitid, p_statement_date, trim(p_statement_description), p_statement_amount,
    p_statement_type, p_reconciliation_mode,
    case when p_reconciliation_mode = 'automatic' then p_automation_score else null end,
    case when p_reconciliation_mode = 'automatic'
      then nullif(left(trim(coalesce(p_automation_reason, '')), 500), '')
      else null
    end,
    auth.uid()
  );

  return v_transaction_id;
end;
$$;

revoke all on function public.reconcile_bank_statement_entry_v3(
  uuid, uuid, uuid, text, text, date, text, numeric, text, uuid, text, integer, text
) from public;

grant execute on function public.reconcile_bank_statement_entry_v3(
  uuid, uuid, uuid, text, text, date, text, numeric, text, uuid, text, integer, text
) to authenticated;
