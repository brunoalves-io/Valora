create table public.financial_budgets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  period_start date not null,
  scope text not null check (scope in ('category', 'cost_center')),
  category_id uuid references public.categories(id) on delete cascade,
  cost_center_id uuid references public.cost_centers(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  alert_percent integer not null default 80 check (alert_percent between 1 and 100),
  active boolean not null default true,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint financial_budgets_month_start check (period_start = date_trunc('month', period_start)::date),
  constraint financial_budgets_scope_target check (
    (scope = 'category' and category_id is not null and cost_center_id is null)
    or
    (scope = 'cost_center' and cost_center_id is not null and category_id is null)
  )
);

create unique index financial_budgets_category_unique
  on public.financial_budgets(company_id, period_start, category_id)
  where scope = 'category';

create unique index financial_budgets_cost_center_unique
  on public.financial_budgets(company_id, period_start, cost_center_id)
  where scope = 'cost_center';

create index financial_budgets_company_period_idx
  on public.financial_budgets(company_id, period_start);

alter table public.financial_budgets enable row level security;
revoke all on table public.financial_budgets from anon;
grant select, insert, update, delete on table public.financial_budgets to authenticated;

create policy "members can read financial budgets"
  on public.financial_budgets for select to authenticated
  using (public.is_company_member(company_id));

create policy "managers can insert financial budgets"
  on public.financial_budgets for insert to authenticated
  with check (public.can_manage_company(company_id) and created_by = (select auth.uid()));

create policy "managers can update financial budgets"
  on public.financial_budgets for update to authenticated
  using (public.can_manage_company(company_id))
  with check (public.can_manage_company(company_id));

create policy "managers can delete financial budgets"
  on public.financial_budgets for delete to authenticated
  using (public.can_manage_company(company_id));

create table public.financial_goals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  period_start date not null,
  kind text not null check (kind in ('revenue', 'expense', 'cash')),
  amount numeric(14,2) not null check (amount > 0),
  active boolean not null default true,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint financial_goals_month_start check (period_start = date_trunc('month', period_start)::date),
  constraint financial_goals_company_period_kind_unique unique (company_id, period_start, kind)
);

create index financial_goals_company_period_idx
  on public.financial_goals(company_id, period_start);

alter table public.financial_goals enable row level security;
revoke all on table public.financial_goals from anon;
grant select, insert, update, delete on table public.financial_goals to authenticated;

create policy "members can read financial goals"
  on public.financial_goals for select to authenticated
  using (public.is_company_member(company_id));

create policy "managers can insert financial goals"
  on public.financial_goals for insert to authenticated
  with check (public.can_manage_company(company_id) and created_by = (select auth.uid()));

create policy "managers can update financial goals"
  on public.financial_goals for update to authenticated
  using (public.can_manage_company(company_id))
  with check (public.can_manage_company(company_id));

create policy "managers can delete financial goals"
  on public.financial_goals for delete to authenticated
  using (public.can_manage_company(company_id));

create or replace function public.refresh_financial_planning_alerts(p_company_id uuid)
returns integer
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_month date := date_trunc('month', current_date)::date;
  v_month_end date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
  v_active_count integer := 0;
  v_cash_balance numeric(14,2) := 0;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_company_member(p_company_id) then raise exception 'Not authorized'; end if;

  update public.alerts
  set active = false, updated_at = now()
  where company_id = p_company_id
    and kind in ('budget_warning', 'budget_exceeded', 'goal_risk');

  insert into public.alerts (
    company_id, kind, severity, alert_key, title, message,
    source_type, source_id, target_page, reference_date, amount, active
  )
  select
    b.company_id,
    case when x.committed >= b.amount then 'budget_exceeded' else 'budget_warning' end,
    case when x.committed >= b.amount then 'critical' else 'warning' end,
    'budget:' || b.id::text,
    case when x.committed >= b.amount then 'Orçamento mensal excedido' else 'Orçamento próximo do limite' end,
    format(
      '%s consumiu R$ %s de R$ %s (%s%% comprometido).',
      x.scope_name,
      trim(to_char(x.committed, 'FM999G999G990D00')),
      trim(to_char(b.amount, 'FM999G999G990D00')),
      round((x.committed / nullif(b.amount, 0)) * 100)
    ),
    'financial_budget', b.id, 'planning', v_month_end, x.committed, true
  from public.financial_budgets b
  cross join lateral (
    select
      case
        when b.scope = 'category' then coalesce((select c.name from public.categories c where c.id = b.category_id), 'Categoria')
        else coalesce((select cc.name from public.cost_centers cc where cc.id = b.cost_center_id), 'Centro de custo')
      end as scope_name,
      coalesce(sum(t.amount) filter (
        where t.type = 'expense'
          and (
            (t.status = 'paid' and t.paid_at::date between v_month and v_month_end)
            or (t.status = 'pending' and t.due_date between v_month and v_month_end)
          )
      ), 0) as committed
    from public.transactions t
    where t.company_id = b.company_id
      and (
        (b.scope = 'category' and t.category_id = b.category_id)
        or (b.scope = 'cost_center' and t.cost_center_id = b.cost_center_id)
      )
  ) x
  where b.company_id = p_company_id
    and b.period_start = v_month
    and b.active = true
    and x.committed >= b.amount * (b.alert_percent::numeric / 100)
  on conflict (company_id, alert_key) do update
  set kind = excluded.kind, severity = excluded.severity, title = excluded.title,
      message = excluded.message, reference_date = excluded.reference_date,
      amount = excluded.amount, active = true, updated_at = now();

  select
    coalesce((select sum(a.opening_balance)
              from public.financial_accounts a
              where a.company_id = p_company_id and a.active = true), 0)
    +
    coalesce((select sum(case when t.type = 'income' then t.amount else -t.amount end)
              from public.transactions t
              where t.company_id = p_company_id and t.status = 'paid'), 0)
  into v_cash_balance;

  insert into public.alerts (
    company_id, kind, severity, alert_key, title, message,
    source_type, source_id, target_page, reference_date, amount, active
  )
  select
    g.company_id,
    'goal_risk',
    case
      when g.kind = 'expense' and x.current_value > g.amount then 'critical'
      when g.kind = 'cash' and x.current_value < 0 then 'critical'
      else 'warning'
    end,
    'goal:' || g.id::text,
    case g.kind
      when 'revenue' then 'Meta de receita em risco'
      when 'expense' then 'Limite mensal de despesas em risco'
      else 'Meta de saldo em risco'
    end,
    case g.kind
      when 'revenue' then format(
        'Receita projetada no mês: R$ %s. Meta: R$ %s.',
        trim(to_char(x.projected_value, 'FM999G999G990D00')),
        trim(to_char(g.amount, 'FM999G999G990D00'))
      )
      when 'expense' then format(
        'Despesas realizadas e previstas: R$ %s. Limite: R$ %s.',
        trim(to_char(x.projected_value, 'FM999G999G990D00')),
        trim(to_char(g.amount, 'FM999G999G990D00'))
      )
      else format(
        'Saldo atual: R$ %s. Meta mínima: R$ %s.',
        trim(to_char(x.current_value, 'FM999G999G990D00')),
        trim(to_char(g.amount, 'FM999G999G990D00'))
      )
    end,
    'financial_goal', g.id, 'planning', v_month_end,
    case when g.kind = 'cash' then x.current_value else x.projected_value end,
    true
  from public.financial_goals g
  cross join lateral (
    select
      case g.kind
        when 'revenue' then coalesce((
          select sum(t.amount) from public.transactions t
          where t.company_id = g.company_id and t.type = 'income' and t.status = 'paid'
            and t.paid_at::date between v_month and v_month_end
        ), 0)
        when 'expense' then coalesce((
          select sum(t.amount) from public.transactions t
          where t.company_id = g.company_id and t.type = 'expense' and t.status = 'paid'
            and t.paid_at::date between v_month and v_month_end
        ), 0)
        else v_cash_balance
      end as current_value,
      case g.kind
        when 'revenue' then coalesce((
          select sum(t.amount) from public.transactions t
          where t.company_id = g.company_id and t.type = 'income'
            and (
              (t.status = 'paid' and t.paid_at::date between v_month and v_month_end)
              or (t.status = 'pending' and t.due_date between v_month and v_month_end)
            )
        ), 0)
        when 'expense' then coalesce((
          select sum(t.amount) from public.transactions t
          where t.company_id = g.company_id and t.type = 'expense'
            and (
              (t.status = 'paid' and t.paid_at::date between v_month and v_month_end)
              or (t.status = 'pending' and t.due_date between v_month and v_month_end)
            )
        ), 0)
        else v_cash_balance
      end as projected_value
  ) x
  where g.company_id = p_company_id
    and g.period_start = v_month
    and g.active = true
    and (
      (g.kind = 'revenue' and extract(day from current_date) >= 15 and x.projected_value < g.amount)
      or (g.kind = 'expense' and x.projected_value >= g.amount * 0.8)
      or (g.kind = 'cash' and x.current_value < g.amount)
    )
  on conflict (company_id, alert_key) do update
  set severity = excluded.severity, title = excluded.title, message = excluded.message,
      reference_date = excluded.reference_date, amount = excluded.amount,
      active = true, updated_at = now();

  select count(*) into v_active_count
  from public.alerts
  where company_id = p_company_id
    and active = true
    and kind in ('budget_warning', 'budget_exceeded', 'goal_risk');

  return v_active_count;
end;
$function$;

revoke all on function public.refresh_financial_planning_alerts(uuid) from public;
grant execute on function public.refresh_financial_planning_alerts(uuid) to authenticated;

create or replace function public.get_financial_planning_context(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public'
as $function$
declare
  v_month date := date_trunc('month', current_date)::date;
  v_month_end date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_company_member(p_company_id) then raise exception 'Not authorized'; end if;

  select jsonb_build_object(
    'period_start', v_month,
    'budgets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'scope', b.scope,
        'name', case when b.scope = 'category' then c.name else cc.name end,
        'amount', b.amount, 'alert_percent', b.alert_percent,
        'realized', coalesce(x.realized, 0),
        'pending', coalesce(x.pending, 0),
        'committed', coalesce(x.realized, 0) + coalesce(x.pending, 0)
      ) order by case when b.scope = 'category' then c.name else cc.name end)
      from public.financial_budgets b
      left join public.categories c on c.id = b.category_id
      left join public.cost_centers cc on cc.id = b.cost_center_id
      left join lateral (
        select
          coalesce(sum(t.amount) filter (
            where t.type = 'expense' and t.status = 'paid'
              and t.paid_at::date between v_month and v_month_end
          ), 0) as realized,
          coalesce(sum(t.amount) filter (
            where t.type = 'expense' and t.status = 'pending'
              and t.due_date between v_month and v_month_end
          ), 0) as pending
        from public.transactions t
        where t.company_id = b.company_id
          and (
            (b.scope = 'category' and t.category_id = b.category_id)
            or (b.scope = 'cost_center' and t.cost_center_id = b.cost_center_id)
          )
      ) x on true
      where b.company_id = p_company_id
        and b.period_start = v_month
        and b.active = true
    ), '[]'::jsonb),
    'goals', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'kind', g.kind, 'amount', g.amount) order by g.kind)
      from public.financial_goals g
      where g.company_id = p_company_id
        and g.period_start = v_month
        and g.active = true
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;

revoke all on function public.get_financial_planning_context(uuid) from public;
grant execute on function public.get_financial_planning_context(uuid) to authenticated;
