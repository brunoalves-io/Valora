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
  v_cash_balance numeric(14,2) := 0;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_company_member(p_company_id) then raise exception 'Not authorized'; end if;

  select
    coalesce((select sum(a.opening_balance)
              from public.financial_accounts a
              where a.company_id = p_company_id and a.active = true), 0)
    +
    coalesce((select sum(case when t.type = 'income' then t.amount else -t.amount end)
              from public.transactions t
              where t.company_id = p_company_id and t.status = 'paid'), 0)
  into v_cash_balance;

  select jsonb_build_object(
    'period_start', v_month,
    'budgets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id,
        'scope', b.scope,
        'name', case when b.scope = 'category' then c.name else cc.name end,
        'amount', b.amount,
        'alert_percent', b.alert_percent,
        'realized', coalesce(x.realized, 0),
        'pending', coalesce(x.pending, 0),
        'committed', coalesce(x.realized, 0) + coalesce(x.pending, 0),
        'remaining', b.amount - (coalesce(x.realized, 0) + coalesce(x.pending, 0)),
        'usage_ratio', case
          when b.amount > 0 then (coalesce(x.realized, 0) + coalesce(x.pending, 0)) / b.amount
          else 0
        end
      ) order by case when b.scope = 'category' then c.name else cc.name end)
      from public.financial_budgets b
      left join public.categories c on c.id = b.category_id
      left join public.cost_centers cc on cc.id = b.cost_center_id
      left join lateral (
        select
          coalesce(sum(t.amount) filter (
            where t.type = 'expense'
              and t.status = 'paid'
              and t.paid_at::date between v_month and v_month_end
          ), 0) as realized,
          coalesce(sum(t.amount) filter (
            where t.type = 'expense'
              and t.status = 'pending'
              and t.due_date between v_month and v_month_end
          ), 0) as pending
        from public.transactions t
        where t.company_id = b.company_id
          and (
            (b.scope = 'category' and t.category_id = b.category_id)
            or
            (b.scope = 'cost_center' and t.cost_center_id = b.cost_center_id)
          )
      ) x on true
      where b.company_id = p_company_id
        and b.period_start = v_month
        and b.active = true
    ), '[]'::jsonb),
    'goals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id,
        'kind', g.kind,
        'amount', g.amount,
        'current_value', x.current_value,
        'projected_value', x.projected_value,
        'current_ratio', case when g.amount > 0 then x.current_value / g.amount else 0 end,
        'projected_ratio', case when g.amount > 0 then x.projected_value / g.amount else 0 end,
        'on_track', case
          when g.kind = 'expense' then x.projected_value <= g.amount
          else x.projected_value >= g.amount
        end
      ) order by g.kind)
      from public.financial_goals g
      cross join lateral (
        select
          case g.kind
            when 'revenue' then coalesce((
              select sum(t.amount)
              from public.transactions t
              where t.company_id = g.company_id
                and t.type = 'income'
                and t.status = 'paid'
                and t.paid_at::date between v_month and v_month_end
            ), 0)
            when 'expense' then coalesce((
              select sum(t.amount)
              from public.transactions t
              where t.company_id = g.company_id
                and t.type = 'expense'
                and t.status = 'paid'
                and t.paid_at::date between v_month and v_month_end
            ), 0)
            else v_cash_balance
          end as current_value,
          case g.kind
            when 'revenue' then coalesce((
              select sum(t.amount)
              from public.transactions t
              where t.company_id = g.company_id
                and t.type = 'income'
                and (
                  (t.status = 'paid' and t.paid_at::date between v_month and v_month_end)
                  or
                  (t.status = 'pending' and t.due_date between v_month and v_month_end)
                )
            ), 0)
            when 'expense' then coalesce((
              select sum(t.amount)
              from public.transactions t
              where t.company_id = g.company_id
                and t.type = 'expense'
                and (
                  (t.status = 'paid' and t.paid_at::date between v_month and v_month_end)
                  or
                  (t.status = 'pending' and t.due_date between v_month and v_month_end)
                )
            ), 0)
            else v_cash_balance
          end as projected_value
      ) x
      where g.company_id = p_company_id
        and g.period_start = v_month
        and g.active = true
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$function$;

revoke all on function public.get_financial_planning_context(uuid) from public;
grant execute on function public.get_financial_planning_context(uuid) to authenticated;
