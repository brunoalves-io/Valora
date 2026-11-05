create table if not exists public.monthly_financial_closings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  income numeric(14,2) not null default 0,
  expense numeric(14,2) not null default 0,
  result numeric(14,2) not null default 0,
  margin numeric(10,6) not null default 0,
  ending_balance numeric(14,2) not null default 0,
  overdue_receivable numeric(14,2) not null default 0,
  overdue_payable numeric(14,2) not null default 0,
  budget_amount numeric(14,2) not null default 0,
  budget_committed numeric(14,2) not null default 0,
  goals_total integer not null default 0,
  goals_achieved integer not null default 0,
  snapshot jsonb not null default '{}'::jsonb,
  ai_summary text,
  revision integer not null default 1,
  closed_by uuid not null default auth.uid(),
  closed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint monthly_financial_closings_month_start
    check (period_start = date_trunc('month', period_start)::date),
  constraint monthly_financial_closings_period_end
    check (period_end = (date_trunc('month', period_start) + interval '1 month - 1 day')::date),
  constraint monthly_financial_closings_unique
    unique (company_id, period_start)
);

create index if not exists monthly_financial_closings_company_period_idx
  on public.monthly_financial_closings(company_id, period_start desc);

alter table public.monthly_financial_closings enable row level security;
revoke all on table public.monthly_financial_closings from anon;
grant select, insert, update on table public.monthly_financial_closings to authenticated;

drop policy if exists "members can read monthly closings"
  on public.monthly_financial_closings;
create policy "members can read monthly closings"
  on public.monthly_financial_closings
  for select
  to authenticated
  using (public.is_company_member(company_id));

drop policy if exists "managers can insert monthly closings"
  on public.monthly_financial_closings;
create policy "managers can insert monthly closings"
  on public.monthly_financial_closings
  for insert
  to authenticated
  with check (
    public.can_manage_company(company_id)
    and closed_by = (select auth.uid())
  );

drop policy if exists "managers can update monthly closings"
  on public.monthly_financial_closings;
create policy "managers can update monthly closings"
  on public.monthly_financial_closings
  for update
  to authenticated
  using (public.can_manage_company(company_id))
  with check (public.can_manage_company(company_id));

create or replace function public.get_monthly_close_preview(
  p_company_id uuid,
  p_period_start date
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = 'public'
as $function$
declare
  v_start date := date_trunc('month', p_period_start)::date;
  v_end date := (date_trunc('month', p_period_start) + interval '1 month - 1 day')::date;
  v_income numeric(14,2) := 0;
  v_expense numeric(14,2) := 0;
  v_result numeric(14,2) := 0;
  v_margin numeric := 0;
  v_ending_balance numeric(14,2) := 0;
  v_overdue_receivable numeric(14,2) := 0;
  v_overdue_payable numeric(14,2) := 0;
  v_budget_amount numeric(14,2) := 0;
  v_budget_committed numeric(14,2) := 0;
  v_goals_total integer := 0;
  v_goals_achieved integer := 0;
  v_dre jsonb := '{}'::jsonb;
  v_budgets jsonb := '[]'::jsonb;
  v_goals jsonb := '[]'::jsonb;
  v_categories jsonb := '[]'::jsonb;
  v_cost_centers jsonb := '[]'::jsonb;
  v_top_expense jsonb := null;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.is_company_member(p_company_id) then
    raise exception 'Not authorized';
  end if;

  select
    coalesce(sum(t.amount) filter (where t.type = 'income'), 0),
    coalesce(sum(t.amount) filter (where t.type = 'expense'), 0)
  into v_income, v_expense
  from public.transactions t
  where t.company_id = p_company_id
    and t.status = 'paid'
    and t.paid_at::date between v_start and v_end;

  v_result := v_income - v_expense;
  v_margin := case when v_income > 0 then v_result / v_income else 0 end;

  select
    coalesce((
      select sum(a.opening_balance)
      from public.financial_accounts a
      where a.company_id = p_company_id
        and a.active = true
    ), 0)
    +
    coalesce((
      select sum(case when t.type = 'income' then t.amount else -t.amount end)
      from public.transactions t
      where t.company_id = p_company_id
        and t.status = 'paid'
        and t.paid_at::date <= v_end
        and t.account_id in (
          select a.id
          from public.financial_accounts a
          where a.company_id = p_company_id
            and a.active = true
        )
    ), 0)
  into v_ending_balance;

  select
    coalesce(sum(t.amount) filter (where t.type = 'income'), 0),
    coalesce(sum(t.amount) filter (where t.type = 'expense'), 0)
  into v_overdue_receivable, v_overdue_payable
  from public.transactions t
  where t.company_id = p_company_id
    and t.status <> 'cancelled'
    and t.due_date <= v_end
    and (t.paid_at is null or t.paid_at::date > v_end);

  with month_items as (
    select
      t.type,
      t.amount,
      coalesce(
        c.dre_group,
        case when t.type = 'income' then 'revenue' else 'operating_expense' end
      ) as dre_group
    from public.transactions t
    left join public.categories c on c.id = t.category_id
    where t.company_id = p_company_id
      and t.status = 'paid'
      and t.paid_at::date between v_start and v_end
  ),
  sums as (
    select
      coalesce(sum(amount) filter (where type = 'income' and dre_group <> 'other_income'), 0) as revenue,
      coalesce(sum(amount) filter (where type = 'income' and dre_group = 'other_income'), 0) as other_income,
      coalesce(sum(amount) filter (where type = 'expense' and dre_group = 'tax'), 0) as taxes,
      coalesce(sum(amount) filter (where type = 'expense' and dre_group = 'cost'), 0) as costs,
      coalesce(sum(amount) filter (where type = 'expense' and dre_group = 'operating_expense'), 0) as operating_expenses,
      coalesce(sum(amount) filter (where type = 'expense' and dre_group = 'other_expense'), 0) as other_expenses
    from month_items
  )
  select jsonb_build_object(
    'revenue', revenue,
    'taxes', taxes,
    'net_revenue', revenue - taxes,
    'costs', costs,
    'gross_profit', revenue - taxes - costs,
    'operating_expenses', operating_expenses,
    'operating_result', revenue - taxes - costs - operating_expenses,
    'other_income', other_income,
    'other_expenses', other_expenses,
    'net_result', revenue - taxes - costs - operating_expenses + other_income - other_expenses,
    'gross_margin',
      case when revenue - taxes > 0
        then (revenue - taxes - costs) / (revenue - taxes)
        else 0
      end,
    'operating_margin',
      case when revenue - taxes > 0
        then (revenue - taxes - costs - operating_expenses) / (revenue - taxes)
        else 0
      end,
    'net_margin',
      case when revenue > 0
        then (revenue - taxes - costs - operating_expenses + other_income - other_expenses) / revenue
        else 0
      end
  )
  into v_dre
  from sums;

  with budget_calc as (
    select
      b.id,
      b.scope,
      case when b.scope = 'category' then c.name else cc.name end as name,
      b.amount,
      b.alert_percent,
      coalesce(x.realized, 0) as realized,
      coalesce(x.pending_at_close, 0) as pending_at_close,
      coalesce(x.realized, 0) + coalesce(x.pending_at_close, 0) as committed
    from public.financial_budgets b
    left join public.categories c on c.id = b.category_id
    left join public.cost_centers cc on cc.id = b.cost_center_id
    left join lateral (
      select
        coalesce(sum(t.amount) filter (
          where t.type = 'expense'
            and t.status = 'paid'
            and t.paid_at::date between v_start and v_end
        ), 0) as realized,
        coalesce(sum(t.amount) filter (
          where t.type = 'expense'
            and t.status <> 'cancelled'
            and t.due_date between v_start and v_end
            and (t.paid_at is null or t.paid_at::date > v_end)
        ), 0) as pending_at_close
      from public.transactions t
      where t.company_id = b.company_id
        and (
          (b.scope = 'category' and t.category_id = b.category_id)
          or
          (b.scope = 'cost_center' and t.cost_center_id = b.cost_center_id)
        )
    ) x on true
    where b.company_id = p_company_id
      and b.period_start = v_start
      and b.active = true
  )
  select
    coalesce(sum(amount), 0),
    coalesce(sum(committed), 0),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', id,
          'scope', scope,
          'name', name,
          'amount', amount,
          'alert_percent', alert_percent,
          'realized', realized,
          'pending_at_close', pending_at_close,
          'committed', committed,
          'remaining', amount - committed,
          'usage_ratio', case when amount > 0 then committed / amount else 0 end,
          'status', case
            when committed > amount then 'exceeded'
            when committed >= amount * (alert_percent::numeric / 100) then 'warning'
            else 'healthy'
          end
        )
        order by case when amount > 0 then committed / amount else 0 end desc, name
      ),
      '[]'::jsonb
    )
  into v_budget_amount, v_budget_committed, v_budgets
  from budget_calc;

  with goal_calc as (
    select
      g.id,
      g.kind,
      g.amount,
      case
        when g.kind = 'revenue' then v_income
        when g.kind = 'expense' then v_expense
        else v_ending_balance
      end as actual_value,
      case
        when g.kind = 'expense' then v_expense <= g.amount
        when g.kind = 'revenue' then v_income >= g.amount
        else v_ending_balance >= g.amount
      end as achieved
    from public.financial_goals g
    where g.company_id = p_company_id
      and g.period_start = v_start
      and g.active = true
  )
  select
    count(*)::integer,
    count(*) filter (where achieved)::integer,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', id,
          'kind', kind,
          'amount', amount,
          'actual_value', actual_value,
          'achievement_ratio', case when amount > 0 then actual_value / amount else 0 end,
          'achieved', achieved
        )
        order by kind
      ),
      '[]'::jsonb
    )
  into v_goals_total, v_goals_achieved, v_goals
  from goal_calc;

  with category_calc as (
    select
      coalesce(c.name, 'Sem categoria') as name,
      coalesce(sum(t.amount) filter (where t.type = 'income'), 0) as income,
      coalesce(sum(t.amount) filter (where t.type = 'expense'), 0) as expense
    from public.transactions t
    left join public.categories c on c.id = t.category_id
    where t.company_id = p_company_id
      and t.status = 'paid'
      and t.paid_at::date between v_start and v_end
    group by coalesce(c.name, 'Sem categoria')
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'name', name,
        'income', income,
        'expense', expense,
        'result', income - expense
      )
      order by expense desc, income desc, name
    ),
    '[]'::jsonb
  )
  into v_categories
  from category_calc;

  with center_calc as (
    select
      coalesce(cc.name, 'Sem centro de custo') as name,
      coalesce(sum(t.amount) filter (where t.type = 'income'), 0) as income,
      coalesce(sum(t.amount) filter (where t.type = 'expense'), 0) as expense
    from public.transactions t
    left join public.cost_centers cc on cc.id = t.cost_center_id
    where t.company_id = p_company_id
      and t.status = 'paid'
      and t.paid_at::date between v_start and v_end
    group by coalesce(cc.name, 'Sem centro de custo')
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'name', name,
        'income', income,
        'expense', expense,
        'result', income - expense
      )
      order by abs(income - expense) desc, name
    ),
    '[]'::jsonb
  )
  into v_cost_centers
  from center_calc;

  select jsonb_build_object(
    'name', x.name,
    'amount', x.amount
  )
  into v_top_expense
  from (
    select
      coalesce(c.name, 'Sem categoria') as name,
      sum(t.amount) as amount
    from public.transactions t
    left join public.categories c on c.id = t.category_id
    where t.company_id = p_company_id
      and t.type = 'expense'
      and t.status = 'paid'
      and t.paid_at::date between v_start and v_end
    group by coalesce(c.name, 'Sem categoria')
    order by sum(t.amount) desc
    limit 1
  ) x;

  return jsonb_build_object(
    'company_id', p_company_id,
    'period_start', v_start,
    'period_end', v_end,
    'is_complete_period', v_start < date_trunc('month', current_date)::date,
    'income', v_income,
    'expense', v_expense,
    'result', v_result,
    'margin', v_margin,
    'ending_balance', v_ending_balance,
    'overdue_receivable', v_overdue_receivable,
    'overdue_payable', v_overdue_payable,
    'budget_amount', v_budget_amount,
    'budget_committed', v_budget_committed,
    'budget_variance', v_budget_amount - v_budget_committed,
    'goals_total', v_goals_total,
    'goals_achieved', v_goals_achieved,
    'goals_rate', case when v_goals_total > 0 then v_goals_achieved::numeric / v_goals_total else 0 end,
    'dre', v_dre,
    'budgets', v_budgets,
    'goals', v_goals,
    'categories', v_categories,
    'cost_centers', v_cost_centers,
    'top_expense_category', v_top_expense
  );
end;
$function$;

revoke all on function public.get_monthly_close_preview(uuid, date) from public;
grant execute on function public.get_monthly_close_preview(uuid, date) to authenticated;

create or replace function public.close_monthly_financial_period(
  p_company_id uuid,
  p_period_start date
)
returns public.monthly_financial_closings
language plpgsql
security invoker
set search_path = 'public'
as $function$
declare
  v_start date := date_trunc('month', p_period_start)::date;
  v_preview jsonb;
  v_row public.monthly_financial_closings;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.can_manage_company(p_company_id) then
    raise exception 'Not authorized';
  end if;

  if v_start >= date_trunc('month', current_date)::date then
    raise exception 'Only completed months can be closed';
  end if;

  v_preview := public.get_monthly_close_preview(p_company_id, v_start);

  insert into public.monthly_financial_closings (
    company_id,
    period_start,
    period_end,
    income,
    expense,
    result,
    margin,
    ending_balance,
    overdue_receivable,
    overdue_payable,
    budget_amount,
    budget_committed,
    goals_total,
    goals_achieved,
    snapshot,
    closed_by,
    closed_at,
    updated_at
  )
  values (
    p_company_id,
    v_start,
    (v_preview->>'period_end')::date,
    coalesce((v_preview->>'income')::numeric, 0),
    coalesce((v_preview->>'expense')::numeric, 0),
    coalesce((v_preview->>'result')::numeric, 0),
    coalesce((v_preview->>'margin')::numeric, 0),
    coalesce((v_preview->>'ending_balance')::numeric, 0),
    coalesce((v_preview->>'overdue_receivable')::numeric, 0),
    coalesce((v_preview->>'overdue_payable')::numeric, 0),
    coalesce((v_preview->>'budget_amount')::numeric, 0),
    coalesce((v_preview->>'budget_committed')::numeric, 0),
    coalesce((v_preview->>'goals_total')::integer, 0),
    coalesce((v_preview->>'goals_achieved')::integer, 0),
    v_preview,
    auth.uid(),
    now(),
    now()
  )
  on conflict (company_id, period_start) do update
  set period_end = excluded.period_end,
      income = excluded.income,
      expense = excluded.expense,
      result = excluded.result,
      margin = excluded.margin,
      ending_balance = excluded.ending_balance,
      overdue_receivable = excluded.overdue_receivable,
      overdue_payable = excluded.overdue_payable,
      budget_amount = excluded.budget_amount,
      budget_committed = excluded.budget_committed,
      goals_total = excluded.goals_total,
      goals_achieved = excluded.goals_achieved,
      snapshot = excluded.snapshot,
      ai_summary = null,
      revision = public.monthly_financial_closings.revision + 1,
      closed_by = excluded.closed_by,
      closed_at = now(),
      updated_at = now()
  returning * into v_row;

  return v_row;
end;
$function$;

revoke all on function public.close_monthly_financial_period(uuid, date) from public;
grant execute on function public.close_monthly_financial_period(uuid, date) to authenticated;
