-- Valora v1.0.19 - professional managerial DRE
-- Apply after 20261028_013_bank_reconciliation_fitid.sql.

alter table public.categories
  add column if not exists dre_group text;

update public.categories
set dre_group = case
  when type = 'income' then 'revenue'
  else 'operating_expense'
end
where dre_group is null;

alter table public.categories
  alter column dre_group set default 'operating_expense';

alter table public.categories
  alter column dre_group set not null;

alter table public.categories
  drop constraint if exists categories_dre_group_check;

alter table public.categories
  add constraint categories_dre_group_check
  check (
    dre_group in (
      'revenue',
      'other_income',
      'cost',
      'operating_expense',
      'tax',
      'other_expense'
    )
  );

create index if not exists idx_categories_company_dre_group
  on public.categories(company_id, dre_group);
