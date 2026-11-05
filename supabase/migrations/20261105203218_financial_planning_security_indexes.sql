create index if not exists financial_budgets_category_fk_idx
  on public.financial_budgets(category_id)
  where category_id is not null;

create index if not exists financial_budgets_cost_center_fk_idx
  on public.financial_budgets(cost_center_id)
  where cost_center_id is not null;

alter function public.get_financial_planning_context(uuid) security invoker;
