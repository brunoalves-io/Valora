-- Valora v1.0.25 - AI-assisted transaction creation
-- Apply after 20261029_015_transaction_tags_attachments.sql.

create or replace function public.get_ai_transaction_context(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_name text;
  v_accounts jsonb;
  v_categories jsonb;
  v_cost_centers jsonb;
  v_partners jsonb;
  v_tags jsonb;
  v_recent_transactions jsonb;
begin
  if not public.can_manage_company(p_company_id) then
    raise exception 'Not authorized';
  end if;

  select c.name
    into v_company_name
  from public.companies c
  where c.id = p_company_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', a.id,
        'name', a.name
      )
      order by a.name
    ),
    '[]'::jsonb
  )
    into v_accounts
  from public.financial_accounts a
  where a.company_id = p_company_id
    and a.active = true;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'type', c.type
      )
      order by c.name
    ),
    '[]'::jsonb
  )
    into v_categories
  from public.categories c
  where c.company_id = p_company_id
    and c.active = true;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', cc.id,
        'name', cc.name
      )
      order by cc.name
    ),
    '[]'::jsonb
  )
    into v_cost_centers
  from public.cost_centers cc
  where cc.company_id = p_company_id
    and cc.active = true;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', bp.id,
        'name', bp.name,
        'kind', bp.kind
      )
      order by bp.name
    ),
    '[]'::jsonb
  )
    into v_partners
  from public.business_partners bp
  where bp.company_id = p_company_id
    and bp.active = true;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', tag.id,
        'name', tag.name
      )
      order by tag.name
    ),
    '[]'::jsonb
  )
    into v_tags
  from public.transaction_tags tag
  where tag.company_id = p_company_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'description', x.description,
        'type', x.type,
        'amount', x.amount,
        'status', x.status,
        'due_date', x.due_date,
        'account_id', x.account_id,
        'account', x.account,
        'category_id', x.category_id,
        'category', x.category,
        'cost_center_id', x.cost_center_id,
        'cost_center', x.cost_center,
        'partner_id', x.partner_id,
        'partner', x.partner,
        'tags', x.tags
      )
      order by x.created_at desc
    ),
    '[]'::jsonb
  )
    into v_recent_transactions
  from (
    select
      t.created_at,
      t.description,
      t.type,
      t.amount,
      t.status,
      t.due_date,
      t.account_id,
      a.name as account,
      t.category_id,
      c.name as category,
      t.cost_center_id,
      cc.name as cost_center,
      t.partner_id,
      bp.name as partner,
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', tag.id,
              'name', tag.name
            )
            order by tag.name
          )
          from public.transaction_tag_links ttl
          join public.transaction_tags tag
            on tag.id = ttl.tag_id
          where ttl.transaction_id = t.id
        ),
        '[]'::jsonb
      ) as tags
    from public.transactions t
    left join public.financial_accounts a on a.id = t.account_id
    left join public.categories c on c.id = t.category_id
    left join public.cost_centers cc on cc.id = t.cost_center_id
    left join public.business_partners bp on bp.id = t.partner_id
    where t.company_id = p_company_id
      and t.status in ('pending', 'paid')
    order by t.created_at desc
    limit 60
  ) x;

  return jsonb_build_object(
    'company', jsonb_build_object(
      'id', p_company_id,
      'name', v_company_name
    ),
    'accounts', v_accounts,
    'categories', v_categories,
    'cost_centers', v_cost_centers,
    'partners', v_partners,
    'tags', v_tags,
    'recent_transactions', v_recent_transactions
  );
end;
$$;

create or replace function public.create_transaction_with_tags(
  p_company_id uuid,
  p_type text,
  p_description text,
  p_amount numeric,
  p_due_date date,
  p_status text,
  p_account_id uuid default null,
  p_category_id uuid default null,
  p_cost_center_id uuid default null,
  p_partner_id uuid default null,
  p_tag_ids uuid[] default '{}'::uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transaction_id uuid;
  v_category_type text;
  v_partner_kind text;
  v_tag_count integer;
begin
  if not public.can_manage_company(p_company_id) then
    raise exception 'Not authorized';
  end if;

  if p_type not in ('income', 'expense') then
    raise exception 'Invalid transaction type';
  end if;

  if p_status not in ('pending', 'paid') then
    raise exception 'Invalid transaction status';
  end if;

  if p_description is null
    or char_length(trim(p_description)) < 2
    or char_length(trim(p_description)) > 180 then
    raise exception 'Invalid transaction description';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Invalid transaction amount';
  end if;

  if p_due_date is null then
    raise exception 'Due date is required';
  end if;

  if p_account_id is not null and not exists (
    select 1
    from public.financial_accounts a
    where a.id = p_account_id
      and a.company_id = p_company_id
      and a.active = true
  ) then
    raise exception 'Invalid account';
  end if;

  if p_category_id is not null then
    select c.type
      into v_category_type
    from public.categories c
    where c.id = p_category_id
      and c.company_id = p_company_id
      and c.active = true;

    if v_category_type is null
      or v_category_type not in (p_type, 'both') then
      raise exception 'Invalid category';
    end if;
  end if;

  if p_cost_center_id is not null and not exists (
    select 1
    from public.cost_centers cc
    where cc.id = p_cost_center_id
      and cc.company_id = p_company_id
      and cc.active = true
  ) then
    raise exception 'Invalid cost center';
  end if;

  if p_partner_id is not null then
    select bp.kind
      into v_partner_kind
    from public.business_partners bp
    where bp.id = p_partner_id
      and bp.company_id = p_company_id
      and bp.active = true;

    if v_partner_kind is null
      or not (
        v_partner_kind = 'both'
        or (p_type = 'income' and v_partner_kind = 'customer')
        or (p_type = 'expense' and v_partner_kind = 'supplier')
      ) then
      raise exception 'Invalid business partner';
    end if;
  end if;

  if coalesce(array_length(p_tag_ids, 1), 0) > 0 then
    select count(*)
      into v_tag_count
    from public.transaction_tags tag
    where tag.company_id = p_company_id
      and tag.id = any(p_tag_ids);

    if v_tag_count <> (
      select count(distinct selected_tag_id)
      from unnest(p_tag_ids) as tag_values(selected_tag_id)
    ) then
      raise exception 'Invalid tag';
    end if;
  end if;

  insert into public.transactions (
    company_id,
    type,
    description,
    amount,
    due_date,
    status,
    paid_at,
    account_id,
    category_id,
    cost_center_id,
    partner_id
  )
  values (
    p_company_id,
    p_type,
    trim(p_description),
    p_amount,
    p_due_date,
    p_status,
    case when p_status = 'paid' then now() else null end,
    p_account_id,
    p_category_id,
    p_cost_center_id,
    p_partner_id
  )
  returning id into v_transaction_id;

  if coalesce(array_length(p_tag_ids, 1), 0) > 0 then
    insert into public.transaction_tag_links (
      company_id,
      transaction_id,
      tag_id
    )
    select
      p_company_id,
      v_transaction_id,
      selected.tag_id
    from (
      select distinct selected_tag_id as tag_id
      from unnest(p_tag_ids) as tag_values(selected_tag_id)
    ) selected;
  end if;

  return v_transaction_id;
end;
$$;

revoke all on function public.get_ai_transaction_context(uuid) from public;
revoke all on function public.create_transaction_with_tags(
  uuid, text, text, numeric, date, text, uuid, uuid, uuid, uuid, uuid[]
) from public;

grant execute on function public.get_ai_transaction_context(uuid) to authenticated;
grant execute on function public.create_transaction_with_tags(
  uuid, text, text, numeric, date, text, uuid, uuid, uuid, uuid, uuid[]
) to authenticated;
