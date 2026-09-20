-- Valora v0.9.0 - Valora AI foundation
-- Apply after 20260920_007_automations_alerts.sql.

create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default 'Nova conversa'
    check (char_length(trim(title)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null
    check (char_length(trim(content)) between 1 and 20000),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_conversations_user_company
  on public.ai_conversations(user_id, company_id, updated_at desc);

create index if not exists idx_ai_messages_conversation
  on public.ai_messages(conversation_id, created_at);

alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;

drop policy if exists "users can read own ai conversations" on public.ai_conversations;
create policy "users can read own ai conversations"
  on public.ai_conversations for select
  using (
    user_id = auth.uid()
    and public.is_company_member(company_id)
  );

drop policy if exists "users can create own ai conversations" on public.ai_conversations;
create policy "users can create own ai conversations"
  on public.ai_conversations for insert
  with check (
    user_id = auth.uid()
    and public.is_company_member(company_id)
  );

drop policy if exists "users can update own ai conversations" on public.ai_conversations;
create policy "users can update own ai conversations"
  on public.ai_conversations for update
  using (
    user_id = auth.uid()
    and public.is_company_member(company_id)
  )
  with check (
    user_id = auth.uid()
    and public.is_company_member(company_id)
  );

drop policy if exists "users can delete own ai conversations" on public.ai_conversations;
create policy "users can delete own ai conversations"
  on public.ai_conversations for delete
  using (
    user_id = auth.uid()
    and public.is_company_member(company_id)
  );

drop policy if exists "users can read own ai messages" on public.ai_messages;
create policy "users can read own ai messages"
  on public.ai_messages for select
  using (
    user_id = auth.uid()
    and public.is_company_member(company_id)
  );

drop policy if exists "users can create own ai messages" on public.ai_messages;
create policy "users can create own ai messages"
  on public.ai_messages for insert
  with check (
    user_id = auth.uid()
    and public.is_company_member(company_id)
    and exists (
      select 1
      from public.ai_conversations c
      where c.id = ai_messages.conversation_id
        and c.company_id = ai_messages.company_id
        and c.user_id = auth.uid()
    )
  );

drop policy if exists "users can delete own ai messages" on public.ai_messages;
create policy "users can delete own ai messages"
  on public.ai_messages for delete
  using (
    user_id = auth.uid()
    and public.is_company_member(company_id)
  );

grant select, insert, update, delete on table public.ai_conversations to authenticated;
grant select, insert, delete on table public.ai_messages to authenticated;

create or replace function public.validate_ai_message_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id <> auth.uid() then
    raise exception 'AI message must belong to the authenticated user';
  end if;

  if not exists (
    select 1
    from public.ai_conversations c
    where c.id = new.conversation_id
      and c.company_id = new.company_id
      and c.user_id = new.user_id
  ) then
    raise exception 'AI conversation must belong to the same user and company';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_ai_message_scope_trigger on public.ai_messages;
create trigger validate_ai_message_scope_trigger
  before insert or update of conversation_id, company_id, user_id
  on public.ai_messages
  for each row execute procedure public.validate_ai_message_scope();

create or replace function public.touch_ai_conversation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ai_conversations
  set updated_at = now()
  where id = new.conversation_id;

  return new;
end;
$$;

drop trigger if exists touch_ai_conversation_trigger on public.ai_messages;
create trigger touch_ai_conversation_trigger
  after insert on public.ai_messages
  for each row execute procedure public.touch_ai_conversation();

create or replace function public.get_ai_financial_context(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_name text;
  v_role text;
  v_opening_balance numeric(14,2);
  v_realized_net numeric(14,2);
  v_current_balance numeric(14,2);
  v_month_income numeric(14,2);
  v_month_expense numeric(14,2);
  v_pending_income numeric(14,2);
  v_pending_expense numeric(14,2);
  v_overdue_income numeric(14,2);
  v_overdue_expense numeric(14,2);
  v_overdue_income_count integer;
  v_overdue_expense_count integer;
  v_next7_income numeric(14,2);
  v_next7_expense numeric(14,2);
  v_next30_income numeric(14,2);
  v_next30_expense numeric(14,2);
  v_card_due30 numeric(14,2);
  v_card_overdue numeric(14,2);
  v_open_proposals integer;
  v_open_proposals_value numeric(14,2);
  v_active_alerts integer;
  v_critical_alerts integer;
  v_top_expense_categories jsonb;
  v_top_receivables jsonb;
  v_monthly_trend jsonb;
  v_upcoming_items jsonb;
  v_alert_items jsonb;
begin
  if not public.is_company_member(p_company_id) then
    raise exception 'Not authorized';
  end if;

  select c.name
    into v_company_name
  from public.companies c
  where c.id = p_company_id;

  select cm.role
    into v_role
  from public.company_members cm
  where cm.company_id = p_company_id
    and cm.user_id = auth.uid();

  select coalesce(sum(a.opening_balance), 0)
    into v_opening_balance
  from public.financial_accounts a
  where a.company_id = p_company_id
    and a.active = true;

  select coalesce(sum(
    case when t.type = 'income' then t.amount else -t.amount end
  ), 0)
    into v_realized_net
  from public.transactions t
  where t.company_id = p_company_id
    and t.status = 'paid';

  v_current_balance := v_opening_balance + v_realized_net;

  select
    coalesce(sum(t.amount) filter (where t.type = 'income'), 0),
    coalesce(sum(t.amount) filter (where t.type = 'expense'), 0)
    into v_month_income, v_month_expense
  from public.transactions t
  where t.company_id = p_company_id
    and t.status = 'paid'
    and t.paid_at::date >= date_trunc('month', current_date)::date
    and t.paid_at::date < (date_trunc('month', current_date) + interval '1 month')::date;

  select
    coalesce(sum(t.amount) filter (where t.type = 'income'), 0),
    coalesce(sum(t.amount) filter (where t.type = 'expense'), 0)
    into v_pending_income, v_pending_expense
  from public.transactions t
  where t.company_id = p_company_id
    and t.status = 'pending';

  select
    coalesce(sum(t.amount) filter (where t.type = 'income'), 0),
    coalesce(sum(t.amount) filter (where t.type = 'expense'), 0),
    count(*) filter (where t.type = 'income')::integer,
    count(*) filter (where t.type = 'expense')::integer
    into
      v_overdue_income,
      v_overdue_expense,
      v_overdue_income_count,
      v_overdue_expense_count
  from public.transactions t
  where t.company_id = p_company_id
    and t.status = 'pending'
    and t.due_date < current_date;

  select
    coalesce(sum(t.amount) filter (where t.type = 'income'), 0),
    coalesce(sum(t.amount) filter (where t.type = 'expense'), 0)
    into v_next7_income, v_next7_expense
  from public.transactions t
  where t.company_id = p_company_id
    and t.status = 'pending'
    and t.due_date between current_date and current_date + 7;

  select
    coalesce(sum(t.amount) filter (where t.type = 'income'), 0),
    coalesce(sum(t.amount) filter (where t.type = 'expense'), 0)
    into v_next30_income, v_next30_expense
  from public.transactions t
  where t.company_id = p_company_id
    and t.status = 'pending'
    and t.due_date between current_date and current_date + 30;

  select
    coalesce(sum(t.amount) filter (
      where t.due_date between current_date and current_date + 30
    ), 0),
    coalesce(sum(t.amount) filter (
      where t.due_date < current_date
    ), 0)
    into v_card_due30, v_card_overdue
  from public.transactions t
  where t.company_id = p_company_id
    and t.status = 'pending'
    and t.credit_card_id is not null;

  select
    count(*)::integer,
    coalesce(sum(p.total), 0)
    into v_open_proposals, v_open_proposals_value
  from public.proposals p
  where p.company_id = p_company_id
    and p.status in ('draft', 'sent', 'approved')
    and p.converted_transaction_id is null;

  select
    count(*)::integer,
    count(*) filter (where a.severity = 'critical')::integer
    into v_active_alerts, v_critical_alerts
  from public.alerts a
  where a.company_id = p_company_id
    and a.active = true;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'category', x.category,
      'amount', x.amount
    )
    order by x.amount desc
  ), '[]'::jsonb)
    into v_top_expense_categories
  from (
    select
      coalesce(c.name, 'Sem categoria') as category,
      sum(t.amount) as amount
    from public.transactions t
    left join public.categories c on c.id = t.category_id
    where t.company_id = p_company_id
      and t.type = 'expense'
      and t.status = 'paid'
      and t.paid_at::date >= date_trunc('month', current_date)::date
      and t.paid_at::date < (date_trunc('month', current_date) + interval '1 month')::date
    group by coalesce(c.name, 'Sem categoria')
    order by sum(t.amount) desc
    limit 5
  ) x;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'customer', x.customer,
      'amount', x.amount,
      'oldest_due_date', x.oldest_due_date
    )
    order by x.amount desc
  ), '[]'::jsonb)
    into v_top_receivables
  from (
    select
      coalesce(bp.name, 'Sem cliente') as customer,
      sum(t.amount) as amount,
      min(t.due_date) as oldest_due_date
    from public.transactions t
    left join public.business_partners bp on bp.id = t.partner_id
    where t.company_id = p_company_id
      and t.type = 'income'
      and t.status = 'pending'
    group by coalesce(bp.name, 'Sem cliente')
    order by sum(t.amount) desc
    limit 5
  ) x;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'month', to_char(x.month_start, 'YYYY-MM'),
      'income', x.income,
      'expense', x.expense,
      'result', x.income - x.expense
    )
    order by x.month_start
  ), '[]'::jsonb)
    into v_monthly_trend
  from (
    select
      months.month_start,
      coalesce(sum(t.amount) filter (where t.type = 'income'), 0) as income,
      coalesce(sum(t.amount) filter (where t.type = 'expense'), 0) as expense
    from (
      select generate_series(
        date_trunc('month', current_date) - interval '5 months',
        date_trunc('month', current_date),
        interval '1 month'
      )::date as month_start
    ) months
    left join public.transactions t
      on t.company_id = p_company_id
     and t.status = 'paid'
     and t.paid_at::date >= months.month_start
     and t.paid_at::date < (months.month_start + interval '1 month')::date
    group by months.month_start
    order by months.month_start
  ) x;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'type', x.type,
      'description', x.description,
      'due_date', x.due_date,
      'amount', x.amount,
      'partner', x.partner
    )
    order by x.due_date, x.amount desc
  ), '[]'::jsonb)
    into v_upcoming_items
  from (
    select
      t.type,
      t.description,
      t.due_date,
      t.amount,
      bp.name as partner
    from public.transactions t
    left join public.business_partners bp on bp.id = t.partner_id
    where t.company_id = p_company_id
      and t.status = 'pending'
      and t.due_date <= current_date + 30
    order by t.due_date, t.amount desc
    limit 12
  ) x;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'severity', x.severity,
      'title', x.title,
      'message', x.message,
      'reference_date', x.reference_date,
      'amount', x.amount
    )
    order by
      case x.severity
        when 'critical' then 1
        when 'warning' then 2
        else 3
      end,
      x.reference_date nulls last
  ), '[]'::jsonb)
    into v_alert_items
  from (
    select
      a.severity,
      a.title,
      a.message,
      a.reference_date,
      a.amount
    from public.alerts a
    where a.company_id = p_company_id
      and a.active = true
    order by
      case a.severity
        when 'critical' then 1
        when 'warning' then 2
        else 3
      end,
      a.reference_date nulls last
    limit 10
  ) x;

  return jsonb_build_object(
    'company', jsonb_build_object(
      'id', p_company_id,
      'name', v_company_name,
      'user_role', v_role,
      'as_of', current_date
    ),
    'cash', jsonb_build_object(
      'opening_balance', v_opening_balance,
      'realized_net_all_time', v_realized_net,
      'current_balance', v_current_balance
    ),
    'current_month_realized', jsonb_build_object(
      'income', v_month_income,
      'expense', v_month_expense,
      'result', v_month_income - v_month_expense
    ),
    'pending', jsonb_build_object(
      'receivable', v_pending_income,
      'payable', v_pending_expense,
      'net', v_pending_income - v_pending_expense
    ),
    'overdue', jsonb_build_object(
      'receivable_amount', v_overdue_income,
      'receivable_count', v_overdue_income_count,
      'payable_amount', v_overdue_expense,
      'payable_count', v_overdue_expense_count
    ),
    'next_7_days', jsonb_build_object(
      'receivable', v_next7_income,
      'payable', v_next7_expense,
      'net', v_next7_income - v_next7_expense
    ),
    'next_30_days', jsonb_build_object(
      'receivable', v_next30_income,
      'payable', v_next30_expense,
      'net', v_next30_income - v_next30_expense,
      'projected_balance', v_current_balance + v_next30_income - v_next30_expense
    ),
    'cards', jsonb_build_object(
      'due_next_30_days', v_card_due30,
      'overdue', v_card_overdue
    ),
    'proposals', jsonb_build_object(
      'open_count', v_open_proposals,
      'open_value', v_open_proposals_value
    ),
    'alerts', jsonb_build_object(
      'active_count', v_active_alerts,
      'critical_count', v_critical_alerts,
      'items', v_alert_items
    ),
    'top_expense_categories_current_month', v_top_expense_categories,
    'top_pending_receivables', v_top_receivables,
    'monthly_realized_trend', v_monthly_trend,
    'upcoming_30_days', v_upcoming_items
  );
end;
$$;

revoke all on function public.validate_ai_message_scope() from public;
revoke all on function public.touch_ai_conversation() from public;
revoke all on function public.get_ai_financial_context(uuid) from public;

grant execute on function public.get_ai_financial_context(uuid) to authenticated;
