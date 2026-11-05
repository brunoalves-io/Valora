-- Valora v1.0.34 - operational AI actions and richer financial context

create table if not exists public.ai_action_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  conversation_id uuid references public.ai_conversations(id) on delete set null,
  actor_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  action_type text not null
    check (action_type in ('create_transaction', 'create_recurrence')),
  status text not null default 'proposed'
    check (status in ('proposed', 'confirmed', 'cancelled', 'failed')),
  request_text text not null default ''
    check (char_length(request_text) <= 5000),
  summary text not null default ''
    check (char_length(summary) <= 500),
  payload jsonb not null default '{}'::jsonb,
  entity_type text,
  entity_id uuid,
  error_message text,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ai_action_logs_company_created
  on public.ai_action_logs(company_id, created_at desc);

create index if not exists idx_ai_action_logs_conversation
  on public.ai_action_logs(conversation_id, created_at desc)
  where conversation_id is not null;

create index if not exists idx_ai_action_logs_actor
  on public.ai_action_logs(actor_id, created_at desc);

alter table public.ai_action_logs enable row level security;

drop policy if exists "members can read ai action history"
  on public.ai_action_logs;
create policy "members can read ai action history"
  on public.ai_action_logs
  for select
  to authenticated
  using (public.is_company_member(company_id));

grant select on table public.ai_action_logs to authenticated;

create or replace function public.get_ai_operational_context(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_base jsonb;
  v_expense_categories_90 jsonb;
  v_income_categories_90 jsonb;
  v_expense_descriptions_90 jsonb;
  v_largest_expenses_90 jsonb;
  v_account_balances jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.is_company_member(p_company_id) then
    raise exception 'Not authorized';
  end if;

  v_base := public.get_ai_financial_context(p_company_id);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'category', x.category,
      'amount', x.amount,
      'count', x.item_count
    )
    order by x.amount desc
  ), '[]'::jsonb)
    into v_expense_categories_90
  from (
    select
      coalesce(c.name, 'Sem categoria') as category,
      sum(t.amount) as amount,
      count(*)::integer as item_count
    from public.transactions t
    left join public.categories c on c.id = t.category_id
    where t.company_id = p_company_id
      and t.type = 'expense'
      and t.status = 'paid'
      and t.paid_at::date between current_date - 89 and current_date
    group by coalesce(c.name, 'Sem categoria')
    order by sum(t.amount) desc
    limit 20
  ) x;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'category', x.category,
      'amount', x.amount,
      'count', x.item_count
    )
    order by x.amount desc
  ), '[]'::jsonb)
    into v_income_categories_90
  from (
    select
      coalesce(c.name, 'Sem categoria') as category,
      sum(t.amount) as amount,
      count(*)::integer as item_count
    from public.transactions t
    left join public.categories c on c.id = t.category_id
    where t.company_id = p_company_id
      and t.type = 'income'
      and t.status = 'paid'
      and t.paid_at::date between current_date - 89 and current_date
    group by coalesce(c.name, 'Sem categoria')
    order by sum(t.amount) desc
    limit 20
  ) x;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'description', x.description,
      'amount', x.amount,
      'count', x.item_count
    )
    order by x.amount desc
  ), '[]'::jsonb)
    into v_expense_descriptions_90
  from (
    select
      t.description,
      sum(t.amount) as amount,
      count(*)::integer as item_count
    from public.transactions t
    where t.company_id = p_company_id
      and t.type = 'expense'
      and t.status = 'paid'
      and t.paid_at::date between current_date - 89 and current_date
    group by t.description
    order by sum(t.amount) desc
    limit 30
  ) x;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'description', x.description,
      'amount', x.amount,
      'date', x.tx_date,
      'category', x.category,
      'partner', x.partner
    )
    order by x.amount desc
  ), '[]'::jsonb)
    into v_largest_expenses_90
  from (
    select
      t.description,
      t.amount,
      t.paid_at::date as tx_date,
      coalesce(c.name, 'Sem categoria') as category,
      bp.name as partner
    from public.transactions t
    left join public.categories c on c.id = t.category_id
    left join public.business_partners bp on bp.id = t.partner_id
    where t.company_id = p_company_id
      and t.type = 'expense'
      and t.status = 'paid'
      and t.paid_at::date between current_date - 89 and current_date
    order by t.amount desc
    limit 20
  ) x;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', x.id,
      'name', x.name,
      'kind', x.kind,
      'opening_balance', x.opening_balance,
      'realized_net', x.realized_net,
      'estimated_balance', x.opening_balance + x.realized_net
    )
    order by x.name
  ), '[]'::jsonb)
    into v_account_balances
  from (
    select
      a.id,
      a.name,
      a.kind,
      a.opening_balance,
      coalesce(sum(
        case
          when t.status = 'paid' and t.type = 'income' then t.amount
          when t.status = 'paid' and t.type = 'expense' then -t.amount
          else 0
        end
      ), 0) as realized_net
    from public.financial_accounts a
    left join public.transactions t
      on t.account_id = a.id
     and t.company_id = p_company_id
    where a.company_id = p_company_id
      and a.active = true
    group by a.id, a.name, a.kind, a.opening_balance
  ) x;

  return v_base || jsonb_build_object(
    'accounts', v_account_balances,
    'last_90_days', jsonb_build_object(
      'expense_categories', v_expense_categories_90,
      'income_categories', v_income_categories_90,
      'expense_descriptions', v_expense_descriptions_90,
      'largest_expenses', v_largest_expenses_90
    )
  );
end;
$$;

create or replace function public.propose_ai_action(
  p_company_id uuid,
  p_conversation_id uuid,
  p_action_type text,
  p_payload jsonb,
  p_summary text,
  p_request_text text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.can_manage_company(p_company_id) then
    raise exception 'Not authorized';
  end if;

  if p_action_type not in ('create_transaction', 'create_recurrence') then
    raise exception 'Invalid AI action type';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Invalid AI action payload';
  end if;

  if p_conversation_id is not null and not exists (
    select 1
    from public.ai_conversations c
    where c.id = p_conversation_id
      and c.company_id = p_company_id
      and c.user_id = auth.uid()
  ) then
    raise exception 'Invalid conversation';
  end if;

  insert into public.ai_action_logs (
    company_id, conversation_id, actor_id, action_type, status,
    request_text, summary, payload
  )
  values (
    p_company_id, p_conversation_id, auth.uid(), p_action_type, 'proposed',
    left(coalesce(p_request_text, ''), 5000),
    left(coalesce(p_summary, ''), 500),
    p_payload
  )
  returning id into v_action_id;

  return v_action_id;
end;
$$;

create or replace function public.cancel_ai_action(p_action_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action public.ai_action_logs%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into v_action
  from public.ai_action_logs
  where id = p_action_id
  for update;

  if v_action.id is null then raise exception 'AI action not found'; end if;

  if v_action.actor_id <> auth.uid()
    or not public.can_manage_company(v_action.company_id) then
    raise exception 'Not authorized';
  end if;

  if v_action.status <> 'proposed' then return; end if;

  update public.ai_action_logs
  set status = 'cancelled',
      cancelled_at = now(),
      updated_at = now()
  where id = v_action.id;
end;
$$;

create or replace function public.execute_ai_action(p_action_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action public.ai_action_logs%rowtype;
  v_payload jsonb;
  v_entity_id uuid;
  v_type text;
  v_description text;
  v_amount numeric;
  v_due_date date;
  v_status text;
  v_account_id uuid;
  v_category_id uuid;
  v_cost_center_id uuid;
  v_partner_id uuid;
  v_tag_ids uuid[];
  v_frequency text;
  v_interval_count integer;
  v_start_date date;
  v_end_date date;
  v_category_type text;
  v_partner_kind text;
  v_through_date date;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into v_action
  from public.ai_action_logs
  where id = p_action_id
  for update;

  if v_action.id is null then raise exception 'AI action not found'; end if;

  if v_action.actor_id <> auth.uid()
    or not public.can_manage_company(v_action.company_id) then
    raise exception 'Not authorized';
  end if;

  if v_action.status = 'confirmed' then
    return jsonb_build_object(
      'success', true,
      'entity_type', v_action.entity_type,
      'entity_id', v_action.entity_id,
      'already_confirmed', true
    );
  end if;

  if v_action.status <> 'proposed' then
    raise exception 'AI action is no longer available';
  end if;

  v_payload := v_action.payload;

  begin
    if v_action.action_type = 'create_transaction' then
      v_type := nullif(v_payload ->> 'type', '');
      v_description := trim(coalesce(v_payload ->> 'description', ''));
      v_amount := nullif(v_payload ->> 'amount', '')::numeric;
      v_due_date := nullif(v_payload ->> 'due_date', '')::date;
      v_status := nullif(v_payload ->> 'status', '');
      v_account_id := nullif(v_payload ->> 'account_id', '')::uuid;
      v_category_id := nullif(v_payload ->> 'category_id', '')::uuid;
      v_cost_center_id := nullif(v_payload ->> 'cost_center_id', '')::uuid;
      v_partner_id := nullif(v_payload ->> 'partner_id', '')::uuid;

      select coalesce(array_agg(distinct tag_id), '{}'::uuid[])
      into v_tag_ids
      from (
        select nullif(value, '')::uuid as tag_id
        from jsonb_array_elements_text(coalesce(v_payload -> 'tag_ids', '[]'::jsonb))
      ) tags
      where tag_id is not null;

      v_entity_id := public.create_transaction_with_tags(
        v_action.company_id, v_type, v_description, v_amount, v_due_date,
        v_status, v_account_id, v_category_id, v_cost_center_id,
        v_partner_id, coalesce(v_tag_ids, '{}'::uuid[])
      );

      update public.ai_action_logs
      set status = 'confirmed', entity_type = 'transaction',
          entity_id = v_entity_id, confirmed_at = now(), updated_at = now(),
          error_message = null
      where id = v_action.id;

      insert into public.audit_logs (
        company_id, actor_id, action, entity_type, entity_id, changes
      )
      values (
        v_action.company_id, auth.uid(), 'ai_confirmed', 'transaction', v_entity_id,
        jsonb_build_object(
          'ai_action_id', v_action.id,
          'request_text', v_action.request_text,
          'summary', v_action.summary
        )
      );

      return jsonb_build_object(
        'success', true, 'entity_type', 'transaction', 'entity_id', v_entity_id
      );
    end if;

    if v_action.action_type = 'create_recurrence' then
      v_type := nullif(v_payload ->> 'type', '');
      v_description := trim(coalesce(v_payload ->> 'description', ''));
      v_amount := nullif(v_payload ->> 'amount', '')::numeric;
      v_frequency := nullif(v_payload ->> 'frequency', '');
      v_interval_count := coalesce(nullif(v_payload ->> 'interval_count', '')::integer, 1);
      v_start_date := nullif(v_payload ->> 'start_date', '')::date;
      v_end_date := nullif(v_payload ->> 'end_date', '')::date;
      v_account_id := nullif(v_payload ->> 'account_id', '')::uuid;
      v_category_id := nullif(v_payload ->> 'category_id', '')::uuid;
      v_cost_center_id := nullif(v_payload ->> 'cost_center_id', '')::uuid;
      v_partner_id := nullif(v_payload ->> 'partner_id', '')::uuid;

      if v_type not in ('income', 'expense') then raise exception 'Invalid recurrence type'; end if;
      if char_length(v_description) < 2 or char_length(v_description) > 180 then raise exception 'Invalid recurrence description'; end if;
      if v_amount is null or v_amount <= 0 then raise exception 'Invalid recurrence amount'; end if;
      if v_frequency not in ('weekly', 'monthly', 'yearly') then raise exception 'Invalid recurrence frequency'; end if;
      if v_interval_count < 1 or v_interval_count > 24 then raise exception 'Invalid recurrence interval'; end if;
      if v_start_date is null then raise exception 'Recurrence start date is required'; end if;
      if v_end_date is not null and v_end_date < v_start_date then raise exception 'Invalid recurrence end date'; end if;

      if v_account_id is not null and not exists (
        select 1 from public.financial_accounts a
        where a.id = v_account_id
          and a.company_id = v_action.company_id
          and a.active = true
      ) then raise exception 'Invalid recurrence account'; end if;

      if v_category_id is not null then
        select c.type into v_category_type
        from public.categories c
        where c.id = v_category_id
          and c.company_id = v_action.company_id
          and c.active = true;

        if v_category_type is null or v_category_type not in (v_type, 'both') then
          raise exception 'Invalid recurrence category';
        end if;
      end if;

      if v_cost_center_id is not null and not exists (
        select 1 from public.cost_centers cc
        where cc.id = v_cost_center_id
          and cc.company_id = v_action.company_id
          and cc.active = true
      ) then raise exception 'Invalid recurrence cost center'; end if;

      if v_partner_id is not null then
        select bp.kind into v_partner_kind
        from public.business_partners bp
        where bp.id = v_partner_id
          and bp.company_id = v_action.company_id
          and bp.active = true;

        if v_partner_kind is null
          or not (
            v_partner_kind = 'both'
            or (v_type = 'income' and v_partner_kind = 'customer')
            or (v_type = 'expense' and v_partner_kind = 'supplier')
          ) then raise exception 'Invalid recurrence partner'; end if;
      end if;

      insert into public.recurring_rules (
        company_id, type, description, amount, frequency, interval_count,
        start_date, end_date, next_due_date, account_id, category_id,
        cost_center_id, partner_id, active, created_by
      )
      values (
        v_action.company_id, v_type, v_description, v_amount, v_frequency,
        v_interval_count, v_start_date, v_end_date, v_start_date, v_account_id,
        v_category_id, v_cost_center_id, v_partner_id, true, auth.uid()
      )
      returning id into v_entity_id;

      v_through_date := least(
        current_date + 90,
        coalesce(v_end_date, current_date + 90)
      );

      perform public.materialize_recurring_transactions(
        v_action.company_id, v_through_date
      );

      update public.ai_action_logs
      set status = 'confirmed', entity_type = 'recurring_rule',
          entity_id = v_entity_id, confirmed_at = now(), updated_at = now(),
          error_message = null
      where id = v_action.id;

      insert into public.audit_logs (
        company_id, actor_id, action, entity_type, entity_id, changes
      )
      values (
        v_action.company_id, auth.uid(), 'ai_confirmed', 'recurring_rule', v_entity_id,
        jsonb_build_object(
          'ai_action_id', v_action.id,
          'request_text', v_action.request_text,
          'summary', v_action.summary
        )
      );

      return jsonb_build_object(
        'success', true, 'entity_type', 'recurring_rule', 'entity_id', v_entity_id
      );
    end if;

    raise exception 'Unsupported AI action';
  exception
    when others then
      update public.ai_action_logs
      set status = 'failed',
          error_message = left(sqlerrm, 800),
          updated_at = now()
      where id = v_action.id;

      return jsonb_build_object('success', false, 'error', sqlerrm);
  end;
end;
$$;

revoke all on function public.get_ai_operational_context(uuid) from public;
revoke all on function public.propose_ai_action(uuid, uuid, text, jsonb, text, text) from public;
revoke all on function public.cancel_ai_action(uuid) from public;
revoke all on function public.execute_ai_action(uuid) from public;

grant execute on function public.get_ai_operational_context(uuid) to authenticated;
grant execute on function public.propose_ai_action(uuid, uuid, text, jsonb, text, text) to authenticated;
grant execute on function public.cancel_ai_action(uuid) to authenticated;
grant execute on function public.execute_ai_action(uuid) to authenticated;
