-- Valora v0.6.0 - credit cards, installments and recurring transactions
-- Apply after 20260920_004_proposals.sql.

create table if not exists public.credit_cards (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (char_length(trim(name)) >= 2),
  brand text,
  last_four text check (last_four is null or last_four ~ '^[0-9]{4}$'),
  credit_limit numeric(14,2) not null default 0 check (credit_limit >= 0),
  closing_day integer not null check (closing_day between 1 and 28),
  due_day integer not null check (due_day between 1 and 28),
  default_payment_account_id uuid references public.financial_accounts(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_credit_cards_company
  on public.credit_cards(company_id);

create table if not exists public.recurring_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  type text not null check (type in ('income', 'expense')),
  description text not null check (char_length(trim(description)) >= 2),
  amount numeric(14,2) not null check (amount > 0),
  frequency text not null check (frequency in ('weekly', 'monthly', 'yearly')),
  interval_count integer not null default 1 check (interval_count between 1 and 24),
  start_date date not null,
  end_date date,
  next_due_date date not null,
  account_id uuid references public.financial_accounts(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  cost_center_id uuid references public.cost_centers(id) on delete set null,
  partner_id uuid references public.business_partners(id) on delete set null,
  active boolean not null default true,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date),
  check (next_due_date >= start_date)
);

create index if not exists idx_recurring_rules_company
  on public.recurring_rules(company_id);

create index if not exists idx_recurring_rules_next_due
  on public.recurring_rules(company_id, active, next_due_date);

alter table public.transactions
  add column if not exists credit_card_id uuid references public.credit_cards(id) on delete set null,
  add column if not exists installment_group_id uuid,
  add column if not exists installment_number integer,
  add column if not exists installment_total integer,
  add column if not exists recurring_rule_id uuid references public.recurring_rules(id) on delete set null,
  add column if not exists recurrence_date date;

create index if not exists idx_transactions_credit_card
  on public.transactions(credit_card_id, due_date);

create index if not exists idx_transactions_installment_group
  on public.transactions(installment_group_id);

create unique index if not exists idx_transactions_recurring_occurrence_unique
  on public.transactions(recurring_rule_id, recurrence_date)
  where recurring_rule_id is not null and recurrence_date is not null;

alter table public.credit_cards enable row level security;
alter table public.recurring_rules enable row level security;

drop policy if exists "members can read credit cards" on public.credit_cards;
create policy "members can read credit cards"
  on public.credit_cards for select
  using (public.is_company_member(company_id));

drop policy if exists "managers can write credit cards" on public.credit_cards;
create policy "managers can write credit cards"
  on public.credit_cards for all
  using (public.can_manage_company(company_id))
  with check (public.can_manage_company(company_id));

drop policy if exists "members can read recurring rules" on public.recurring_rules;
create policy "members can read recurring rules"
  on public.recurring_rules for select
  using (public.is_company_member(company_id));

drop policy if exists "managers can write recurring rules" on public.recurring_rules;
create policy "managers can write recurring rules"
  on public.recurring_rules for all
  using (public.can_manage_company(company_id))
  with check (public.can_manage_company(company_id));

grant select, insert, update, delete on table public.credit_cards to authenticated;
grant select, insert, update, delete on table public.recurring_rules to authenticated;

create or replace function public.validate_credit_card_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.default_payment_account_id is not null and not exists (
    select 1
    from public.financial_accounts a
    where a.id = new.default_payment_account_id
      and a.company_id = new.company_id
  ) then
    raise exception 'Default payment account must belong to the same company';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_credit_card_scope_trigger on public.credit_cards;
create trigger validate_credit_card_scope_trigger
  before insert or update of company_id, default_payment_account_id
  on public.credit_cards
  for each row execute procedure public.validate_credit_card_scope();

create or replace function public.validate_recurring_rule_scope()
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
    raise exception 'Recurring account must belong to the same company';
  end if;

  if new.category_id is not null and not exists (
    select 1 from public.categories c
    where c.id = new.category_id
      and c.company_id = new.company_id
      and (c.type = new.type or c.type = 'both')
  ) then
    raise exception 'Recurring category must belong to the same company and match type';
  end if;

  if new.cost_center_id is not null and not exists (
    select 1 from public.cost_centers cc
    where cc.id = new.cost_center_id and cc.company_id = new.company_id
  ) then
    raise exception 'Recurring cost center must belong to the same company';
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
    raise exception 'Recurring partner must belong to the same company and match type';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_recurring_rule_scope_trigger on public.recurring_rules;
create trigger validate_recurring_rule_scope_trigger
  before insert or update of company_id, type, account_id, category_id, cost_center_id, partner_id
  on public.recurring_rules
  for each row execute procedure public.validate_recurring_rule_scope();

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

  if new.credit_card_id is not null then
    if new.type <> 'expense' then
      raise exception 'Credit card transactions must be expenses';
    end if;

    if not exists (
      select 1 from public.credit_cards c
      where c.id = new.credit_card_id and c.company_id = new.company_id
    ) then
      raise exception 'Credit card must belong to the same company';
    end if;
  end if;

  if new.recurring_rule_id is not null and not exists (
    select 1 from public.recurring_rules r
    where r.id = new.recurring_rule_id
      and r.company_id = new.company_id
      and r.type = new.type
  ) then
    raise exception 'Recurring rule must belong to the same company and match transaction type';
  end if;

  if new.installment_group_id is not null then
    if new.installment_number is null or new.installment_total is null then
      raise exception 'Installment number and total are required for installment transactions';
    end if;

    if new.installment_number < 1
      or new.installment_total < 1
      or new.installment_number > new.installment_total then
      raise exception 'Invalid installment numbering';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists validate_transaction_scope_trigger on public.transactions;
create trigger validate_transaction_scope_trigger
  before insert or update of
    company_id,
    type,
    account_id,
    category_id,
    cost_center_id,
    partner_id,
    credit_card_id,
    recurring_rule_id,
    installment_group_id,
    installment_number,
    installment_total
  on public.transactions
  for each row execute procedure public.validate_transaction_scope();

create or replace function public.card_first_due_date(
  p_purchase_date date,
  p_closing_day integer,
  p_due_day integer
)
returns date
language plpgsql
immutable
set search_path = public
as $$
declare
  v_close_date date;
  v_due_date date;
  v_due_month date;
begin
  v_close_date := make_date(
    extract(year from p_purchase_date)::integer,
    extract(month from p_purchase_date)::integer,
    p_closing_day
  );

  if p_purchase_date > v_close_date then
    v_close_date := (v_close_date + interval '1 month')::date;
  end if;

  if p_due_day > p_closing_day then
    v_due_month := v_close_date;
  else
    v_due_month := (v_close_date + interval '1 month')::date;
  end if;

  v_due_date := make_date(
    extract(year from v_due_month)::integer,
    extract(month from v_due_month)::integer,
    p_due_day
  );

  return v_due_date;
end;
$$;

create or replace function public.create_installment_series(
  p_company_id uuid,
  p_type text,
  p_description text,
  p_total_amount numeric,
  p_first_due_date date,
  p_installments integer,
  p_account_id uuid default null,
  p_category_id uuid default null,
  p_cost_center_id uuid default null,
  p_partner_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid := gen_random_uuid();
  v_total_cents bigint;
  v_base_cents bigint;
  v_remainder bigint;
  v_installment_cents bigint;
  v_index integer;
begin
  if not public.can_manage_company(p_company_id) then
    raise exception 'Not authorized';
  end if;

  if p_type not in ('income', 'expense') then
    raise exception 'Invalid transaction type';
  end if;

  if p_total_amount <= 0 then
    raise exception 'Total amount must be greater than zero';
  end if;

  if p_installments < 2 or p_installments > 120 then
    raise exception 'Installments must be between 2 and 120';
  end if;

  v_total_cents := round(p_total_amount * 100)::bigint;
  v_base_cents := v_total_cents / p_installments;
  v_remainder := v_total_cents % p_installments;

  for v_index in 1..p_installments loop
    v_installment_cents := v_base_cents + case when v_index <= v_remainder then 1 else 0 end;

    insert into public.transactions (
      company_id,
      type,
      description,
      amount,
      status,
      due_date,
      account_id,
      category_id,
      cost_center_id,
      partner_id,
      installment_group_id,
      installment_number,
      installment_total
    )
    values (
      p_company_id,
      p_type,
      trim(p_description) || ' (' || v_index || '/' || p_installments || ')',
      v_installment_cents::numeric / 100,
      'pending',
      (p_first_due_date + make_interval(months => v_index - 1))::date,
      p_account_id,
      p_category_id,
      p_cost_center_id,
      p_partner_id,
      v_group_id,
      v_index,
      p_installments
    );
  end loop;

  return v_group_id;
end;
$$;

create or replace function public.create_card_purchase(
  p_company_id uuid,
  p_card_id uuid,
  p_description text,
  p_total_amount numeric,
  p_purchase_date date,
  p_installments integer,
  p_category_id uuid default null,
  p_cost_center_id uuid default null,
  p_partner_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card public.credit_cards%rowtype;
  v_group_id uuid := gen_random_uuid();
  v_first_due_date date;
  v_total_cents bigint;
  v_base_cents bigint;
  v_remainder bigint;
  v_installment_cents bigint;
  v_index integer;
begin
  if not public.can_manage_company(p_company_id) then
    raise exception 'Not authorized';
  end if;

  select *
    into v_card
  from public.credit_cards
  where id = p_card_id
    and company_id = p_company_id
    and active = true;

  if not found then
    raise exception 'Active credit card not found';
  end if;

  if p_total_amount <= 0 then
    raise exception 'Total amount must be greater than zero';
  end if;

  if p_installments < 1 or p_installments > 120 then
    raise exception 'Installments must be between 1 and 120';
  end if;

  v_first_due_date := public.card_first_due_date(
    p_purchase_date,
    v_card.closing_day,
    v_card.due_day
  );

  v_total_cents := round(p_total_amount * 100)::bigint;
  v_base_cents := v_total_cents / p_installments;
  v_remainder := v_total_cents % p_installments;

  for v_index in 1..p_installments loop
    v_installment_cents := v_base_cents + case when v_index <= v_remainder then 1 else 0 end;

    insert into public.transactions (
      company_id,
      type,
      description,
      amount,
      status,
      due_date,
      category_id,
      cost_center_id,
      partner_id,
      credit_card_id,
      installment_group_id,
      installment_number,
      installment_total
    )
    values (
      p_company_id,
      'expense',
      trim(p_description) ||
        case
          when p_installments > 1 then ' (' || v_index || '/' || p_installments || ')'
          else ''
        end,
      v_installment_cents::numeric / 100,
      'pending',
      (v_first_due_date + make_interval(months => v_index - 1))::date,
      p_category_id,
      p_cost_center_id,
      p_partner_id,
      p_card_id,
      v_group_id,
      v_index,
      p_installments
    );
  end loop;

  return v_group_id;
end;
$$;

create or replace function public.pay_card_statement(
  p_card_id uuid,
  p_due_date date,
  p_account_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_count integer;
begin
  select company_id
    into v_company_id
  from public.credit_cards
  where id = p_card_id;

  if v_company_id is null then
    raise exception 'Credit card not found';
  end if;

  if not public.can_manage_company(v_company_id) then
    raise exception 'Not authorized';
  end if;

  if not exists (
    select 1
    from public.financial_accounts a
    where a.id = p_account_id
      and a.company_id = v_company_id
      and a.active = true
  ) then
    raise exception 'Payment account must be an active account from the same company';
  end if;

  update public.transactions
  set status = 'paid',
      paid_at = now(),
      account_id = p_account_id,
      updated_at = now()
  where company_id = v_company_id
    and credit_card_id = p_card_id
    and due_date = p_due_date
    and status = 'pending';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.advance_recurring_due_date(
  p_current_due date,
  p_anchor_date date,
  p_frequency text,
  p_interval_count integer
)
returns date
language plpgsql
immutable
set search_path = public
as $
declare
  v_target_month date;
  v_last_day date;
  v_target_year integer;
  v_anchor_month integer;
  v_anchor_day integer;
begin
  if p_frequency = 'weekly' then
    return (p_current_due + make_interval(days => 7 * p_interval_count))::date;
  end if;

  v_anchor_month := extract(month from p_anchor_date)::integer;
  v_anchor_day := extract(day from p_anchor_date)::integer;

  if p_frequency = 'monthly' then
    v_target_month :=
      (date_trunc('month', p_current_due)::date
        + make_interval(months => p_interval_count))::date;

    v_last_day :=
      (date_trunc('month', v_target_month)
        + interval '1 month'
        - interval '1 day')::date;

    return make_date(
      extract(year from v_target_month)::integer,
      extract(month from v_target_month)::integer,
      least(v_anchor_day, extract(day from v_last_day)::integer)
    );
  end if;

  if p_frequency = 'yearly' then
    v_target_year := extract(year from p_current_due)::integer + p_interval_count;
    v_target_month := make_date(v_target_year, v_anchor_month, 1);
    v_last_day :=
      (date_trunc('month', v_target_month)
        + interval '1 month'
        - interval '1 day')::date;

    return make_date(
      v_target_year,
      v_anchor_month,
      least(v_anchor_day, extract(day from v_last_day)::integer)
    );
  end if;

  raise exception 'Invalid recurring frequency';
end;
$;

create or replace function public.materialize_recurring_transactions(
  p_company_id uuid,
  p_through_date date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule public.recurring_rules%rowtype;
  v_due date;
  v_generated integer := 0;
begin
  if not public.can_manage_company(p_company_id) then
    raise exception 'Not authorized';
  end if;

  for v_rule in
    select *
    from public.recurring_rules
    where company_id = p_company_id
      and active = true
      and next_due_date <= p_through_date
    order by next_due_date
    for update
  loop
    v_due := v_rule.next_due_date;

    while v_due <= p_through_date
      and (v_rule.end_date is null or v_due <= v_rule.end_date)
    loop
      insert into public.transactions (
        company_id,
        type,
        description,
        amount,
        status,
        due_date,
        account_id,
        category_id,
        cost_center_id,
        partner_id,
        recurring_rule_id,
        recurrence_date
      )
      values (
        v_rule.company_id,
        v_rule.type,
        v_rule.description,
        v_rule.amount,
        'pending',
        v_due,
        v_rule.account_id,
        v_rule.category_id,
        v_rule.cost_center_id,
        v_rule.partner_id,
        v_rule.id,
        v_due
      )
      on conflict (recurring_rule_id, recurrence_date)
      where recurring_rule_id is not null and recurrence_date is not null
      do nothing;

      if found then
        v_generated := v_generated + 1;
      end if;

      v_due := public.advance_recurring_due_date(
        v_due,
        v_rule.start_date,
        v_rule.frequency,
        v_rule.interval_count
      );
    end loop;

    update public.recurring_rules
    set next_due_date = v_due,
        active = case
          when end_date is not null and v_due > end_date then false
          else active
        end,
        updated_at = now()
    where id = v_rule.id;
  end loop;

  return v_generated;
end;
$$;

revoke all on function public.validate_credit_card_scope() from public;
revoke all on function public.validate_recurring_rule_scope() from public;
revoke all on function public.validate_transaction_scope() from public;
revoke all on function public.card_first_due_date(date, integer, integer) from public;
revoke all on function public.create_installment_series(uuid, text, text, numeric, date, integer, uuid, uuid, uuid, uuid) from public;
revoke all on function public.create_card_purchase(uuid, uuid, text, numeric, date, integer, uuid, uuid, uuid) from public;
revoke all on function public.pay_card_statement(uuid, date, uuid) from public;
revoke all on function public.advance_recurring_due_date(date, date, text, integer) from public;
revoke all on function public.materialize_recurring_transactions(uuid, date) from public;

grant execute on function public.create_installment_series(uuid, text, text, numeric, date, integer, uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.create_card_purchase(uuid, uuid, text, numeric, date, integer, uuid, uuid, uuid) to authenticated;
grant execute on function public.pay_card_statement(uuid, date, uuid) to authenticated;
grant execute on function public.materialize_recurring_transactions(uuid, date) to authenticated;
