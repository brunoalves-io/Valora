-- Valora v1.0.32 - smart categorization rules

create table if not exists public.bank_categorization_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  pattern text not null check (char_length(trim(pattern)) between 2 and 180),
  match_mode text not null default 'contains'
    check (match_mode in ('contains', 'starts_with', 'exact')),
  transaction_type text not null
    check (transaction_type in ('income', 'expense')),
  category_id uuid not null references public.categories(id) on delete cascade,
  priority integer not null default 100 check (priority between 0 and 1000),
  active boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_bank_categorization_rules_unique
  on public.bank_categorization_rules (
    company_id,
    lower(pattern),
    match_mode,
    transaction_type
  );

create index if not exists idx_bank_categorization_rules_company_active
  on public.bank_categorization_rules(company_id, active, priority desc, updated_at desc);

create index if not exists idx_bank_categorization_rules_category
  on public.bank_categorization_rules(category_id);

create index if not exists idx_bank_categorization_rules_created_by
  on public.bank_categorization_rules(created_by)
  where created_by is not null;

alter table public.bank_categorization_rules enable row level security;

drop policy if exists "members can read bank categorization rules"
  on public.bank_categorization_rules;
create policy "members can read bank categorization rules"
  on public.bank_categorization_rules
  for select
  to authenticated
  using (public.is_company_member(company_id));

drop policy if exists "managers can create bank categorization rules"
  on public.bank_categorization_rules;
create policy "managers can create bank categorization rules"
  on public.bank_categorization_rules
  for insert
  to authenticated
  with check (
    public.can_manage_company(company_id)
    and (created_by is null or created_by = (select auth.uid()))
  );

drop policy if exists "managers can update bank categorization rules"
  on public.bank_categorization_rules;
create policy "managers can update bank categorization rules"
  on public.bank_categorization_rules
  for update
  to authenticated
  using (public.can_manage_company(company_id))
  with check (public.can_manage_company(company_id));

drop policy if exists "managers can delete bank categorization rules"
  on public.bank_categorization_rules;
create policy "managers can delete bank categorization rules"
  on public.bank_categorization_rules
  for delete
  to authenticated
  using (public.can_manage_company(company_id));

grant select, insert, update, delete
  on table public.bank_categorization_rules
  to authenticated;

create or replace function public.validate_bank_categorization_rule_scope()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_category_type text;
begin
  select c.type
    into v_category_type
  from public.categories c
  where c.id = new.category_id
    and c.company_id = new.company_id;

  if v_category_type is null then
    raise exception 'Category must belong to the same company';
  end if;

  if v_category_type not in (new.transaction_type, 'both') then
    raise exception 'Category type is incompatible with the rule transaction type';
  end if;

  new.pattern := trim(new.pattern);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists validate_bank_categorization_rule_scope_trigger
  on public.bank_categorization_rules;
create trigger validate_bank_categorization_rule_scope_trigger
  before insert or update of company_id, pattern, transaction_type, category_id
  on public.bank_categorization_rules
  for each row
  execute procedure public.validate_bank_categorization_rule_scope();

revoke execute on function public.validate_bank_categorization_rule_scope()
  from public, anon, authenticated;

create or replace function public.reconcile_bank_statement_entry_v2(
  p_company_id uuid,
  p_account_id uuid,
  p_transaction_id uuid,
  p_source_format text,
  p_statement_reference text,
  p_statement_date date,
  p_statement_description text,
  p_statement_amount numeric,
  p_statement_type text,
  p_category_id uuid
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
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.can_manage_company(p_company_id) then
    raise exception 'Insufficient permission';
  end if;

  if p_source_format not in ('CSV', 'Excel', 'OFX', 'Open Finance') then
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

  if p_category_id is not null and not exists (
    select 1
    from public.categories c
    where c.id = p_category_id
      and c.company_id = p_company_id
      and c.active = true
      and c.type in (p_statement_type, 'both')
  ) then
    raise exception 'Category is invalid for this transaction';
  end if;

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
      if p_category_id is not null then
        update public.transactions
           set category_id = p_category_id,
               updated_at = now()
         where id = v_existing_transaction_id
           and company_id = p_company_id;
      end if;
      return v_existing_transaction_id;
    end if;
  end if;

  if v_reference is not null then
    select br.transaction_id
      into v_existing_transaction_id
    from public.bank_reconciliations br
    where br.company_id = p_company_id
      and br.account_id = p_account_id
      and br.statement_reference = v_reference
    limit 1;

    if v_existing_transaction_id is not null then
      if p_category_id is not null then
        update public.transactions
           set category_id = p_category_id,
               updated_at = now()
         where id = v_existing_transaction_id
           and company_id = p_company_id;
      end if;
      return v_existing_transaction_id;
    end if;
  end if;

  if p_transaction_id is null then
    v_notes := case
      when p_source_format = 'Open Finance'
        then 'Criado e conciliado automaticamente a partir do Open Finance.'
      else 'Importado e conciliado a partir de extrato bancário.'
    end;

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
      p_category_id,
      null,
      null,
      v_notes,
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

    if p_category_id is not null then
      update public.transactions
         set category_id = p_category_id,
             updated_at = now()
       where id = v_transaction_id
         and company_id = p_company_id;
    end if;
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

revoke all on function public.reconcile_bank_statement_entry_v2(
  uuid, uuid, uuid, text, text, date, text, numeric, text, uuid
) from public;

grant execute on function public.reconcile_bank_statement_entry_v2(
  uuid, uuid, uuid, text, text, date, text, numeric, text, uuid
) to authenticated;
