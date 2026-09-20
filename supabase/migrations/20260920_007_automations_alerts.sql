-- Valora v0.8.0 - internal automations and alert center
-- Apply after 20260920_006_team_audit.sql.

create table if not exists public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null check (
    kind in (
      'expense_due',
      'income_due',
      'expense_overdue',
      'income_overdue',
      'card_statement_due',
      'cash_projection'
    )
  ),
  enabled boolean not null default true,
  days_before integer not null default 3 check (days_before between 0 and 90),
  horizon_days integer not null default 30 check (horizon_days between 1 and 365),
  threshold numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, kind)
);

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null,
  severity text not null check (severity in ('info', 'warning', 'critical')),
  alert_key text not null,
  title text not null,
  message text not null,
  source_type text,
  source_id uuid,
  target_page text,
  reference_date date,
  amount numeric(14,2),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, alert_key)
);

create table if not exists public.alert_user_states (
  alert_id uuid not null references public.alerts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz,
  dismissed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (alert_id, user_id)
);

create index if not exists idx_automation_rules_company
  on public.automation_rules(company_id, kind);

create index if not exists idx_alerts_company_active
  on public.alerts(company_id, active, severity, reference_date);

create index if not exists idx_alert_states_user
  on public.alert_user_states(user_id, dismissed_at, read_at);

alter table public.automation_rules enable row level security;
alter table public.alerts enable row level security;
alter table public.alert_user_states enable row level security;

drop policy if exists "members can read automation rules" on public.automation_rules;
create policy "members can read automation rules"
  on public.automation_rules for select
  using (public.is_company_member(company_id));

drop policy if exists "admins can write automation rules" on public.automation_rules;
create policy "admins can write automation rules"
  on public.automation_rules for all
  using (public.can_admin_company(company_id))
  with check (public.can_admin_company(company_id));

drop policy if exists "members can read alerts" on public.alerts;
create policy "members can read alerts"
  on public.alerts for select
  using (public.is_company_member(company_id));

drop policy if exists "users can read own alert states" on public.alert_user_states;
create policy "users can read own alert states"
  on public.alert_user_states for select
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.alerts a
      where a.id = alert_user_states.alert_id
        and public.is_company_member(a.company_id)
    )
  );

drop policy if exists "users can insert own alert states" on public.alert_user_states;
create policy "users can insert own alert states"
  on public.alert_user_states for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.alerts a
      where a.id = alert_user_states.alert_id
        and public.is_company_member(a.company_id)
    )
  );

drop policy if exists "users can update own alert states" on public.alert_user_states;
create policy "users can update own alert states"
  on public.alert_user_states for update
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.alerts a
      where a.id = alert_user_states.alert_id
        and public.is_company_member(a.company_id)
    )
  )
  with check (user_id = auth.uid());

grant select, insert, update, delete on table public.automation_rules to authenticated;
grant select on table public.alerts to authenticated;
grant select, insert, update on table public.alert_user_states to authenticated;

insert into public.automation_rules (company_id, kind, enabled, days_before, horizon_days, threshold)
select
  c.id,
  defaults.kind,
  true,
  defaults.days_before,
  defaults.horizon_days,
  defaults.threshold
from public.companies c
cross join (
  values
    ('expense_due'::text, 3, 30, 0::numeric),
    ('income_due'::text, 3, 30, 0::numeric),
    ('expense_overdue'::text, 0, 30, 0::numeric),
    ('income_overdue'::text, 0, 30, 0::numeric),
    ('card_statement_due'::text, 3, 30, 0::numeric),
    ('cash_projection'::text, 0, 30, 0::numeric)
) as defaults(kind, days_before, horizon_days, threshold)
on conflict (company_id, kind) do nothing;

create or replace function public.seed_company_automation_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.automation_rules (
    company_id,
    kind,
    enabled,
    days_before,
    horizon_days,
    threshold
  )
  values
    (new.id, 'expense_due', true, 3, 30, 0),
    (new.id, 'income_due', true, 3, 30, 0),
    (new.id, 'expense_overdue', true, 0, 30, 0),
    (new.id, 'income_overdue', true, 0, 30, 0),
    (new.id, 'card_statement_due', true, 3, 30, 0),
    (new.id, 'cash_projection', true, 0, 30, 0)
  on conflict (company_id, kind) do nothing;

  return new;
end;
$$;

drop trigger if exists seed_company_automation_rules_trigger on public.companies;
create trigger seed_company_automation_rules_trigger
  after insert on public.companies
  for each row execute procedure public.seed_company_automation_rules();

create or replace function public.ensure_default_automation_rules(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_company_member(p_company_id) then
    raise exception 'Not authorized';
  end if;

  insert into public.automation_rules (
    company_id,
    kind,
    enabled,
    days_before,
    horizon_days,
    threshold
  )
  values
    (p_company_id, 'expense_due', true, 3, 30, 0),
    (p_company_id, 'income_due', true, 3, 30, 0),
    (p_company_id, 'expense_overdue', true, 0, 30, 0),
    (p_company_id, 'income_overdue', true, 0, 30, 0),
    (p_company_id, 'card_statement_due', true, 3, 30, 0),
    (p_company_id, 'cash_projection', true, 0, 30, 0)
  on conflict (company_id, kind) do nothing;
end;
$$;

create or replace function public.refresh_company_alerts(p_company_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule public.automation_rules%rowtype;
  v_current_balance numeric(14,2);
  v_projected_balance numeric(14,2);
  v_active_count integer;
begin
  if not public.is_company_member(p_company_id) then
    raise exception 'Not authorized';
  end if;

  perform public.ensure_default_automation_rules(p_company_id);

  update public.alerts
  set active = false,
      updated_at = now()
  where company_id = p_company_id
    and kind in (
      'expense_due',
      'income_due',
      'expense_overdue',
      'income_overdue',
      'card_statement_due',
      'cash_projection'
    );

  select *
    into v_rule
  from public.automation_rules
  where company_id = p_company_id
    and kind = 'expense_due';

  if v_rule.enabled then
    insert into public.alerts (
      company_id, kind, severity, alert_key, title, message,
      source_type, source_id, target_page, reference_date, amount, active
    )
    select
      p_company_id,
      'expense_due',
      'warning',
      'expense_due:' || t.id::text,
      'Conta a pagar próxima do vencimento',
      format('%s vence em %s.', t.description, to_char(t.due_date, 'DD/MM/YYYY')),
      'transaction',
      t.id,
      'payables',
      t.due_date,
      t.amount,
      true
    from public.transactions t
    where t.company_id = p_company_id
      and t.type = 'expense'
      and t.status = 'pending'
      and t.credit_card_id is null
      and t.due_date between current_date and current_date + v_rule.days_before
    on conflict (company_id, alert_key) do update
    set severity = excluded.severity,
        title = excluded.title,
        message = excluded.message,
        reference_date = excluded.reference_date,
        amount = excluded.amount,
        active = true,
        updated_at = now();
  end if;

  select *
    into v_rule
  from public.automation_rules
  where company_id = p_company_id
    and kind = 'income_due';

  if v_rule.enabled then
    insert into public.alerts (
      company_id, kind, severity, alert_key, title, message,
      source_type, source_id, target_page, reference_date, amount, active
    )
    select
      p_company_id,
      'income_due',
      'info',
      'income_due:' || t.id::text,
      'Conta a receber próxima do vencimento',
      format('%s vence em %s.', t.description, to_char(t.due_date, 'DD/MM/YYYY')),
      'transaction',
      t.id,
      'receivables',
      t.due_date,
      t.amount,
      true
    from public.transactions t
    where t.company_id = p_company_id
      and t.type = 'income'
      and t.status = 'pending'
      and t.due_date between current_date and current_date + v_rule.days_before
    on conflict (company_id, alert_key) do update
    set severity = excluded.severity,
        title = excluded.title,
        message = excluded.message,
        reference_date = excluded.reference_date,
        amount = excluded.amount,
        active = true,
        updated_at = now();
  end if;

  select *
    into v_rule
  from public.automation_rules
  where company_id = p_company_id
    and kind = 'expense_overdue';

  if v_rule.enabled then
    insert into public.alerts (
      company_id, kind, severity, alert_key, title, message,
      source_type, source_id, target_page, reference_date, amount, active
    )
    select
      p_company_id,
      'expense_overdue',
      'critical',
      'expense_overdue:' || t.id::text,
      'Conta a pagar em atraso',
      format('%s venceu em %s.', t.description, to_char(t.due_date, 'DD/MM/YYYY')),
      'transaction',
      t.id,
      'payables',
      t.due_date,
      t.amount,
      true
    from public.transactions t
    where t.company_id = p_company_id
      and t.type = 'expense'
      and t.status = 'pending'
      and t.credit_card_id is null
      and t.due_date < current_date
    on conflict (company_id, alert_key) do update
    set severity = excluded.severity,
        title = excluded.title,
        message = excluded.message,
        reference_date = excluded.reference_date,
        amount = excluded.amount,
        active = true,
        updated_at = now();
  end if;

  select *
    into v_rule
  from public.automation_rules
  where company_id = p_company_id
    and kind = 'income_overdue';

  if v_rule.enabled then
    insert into public.alerts (
      company_id, kind, severity, alert_key, title, message,
      source_type, source_id, target_page, reference_date, amount, active
    )
    select
      p_company_id,
      'income_overdue',
      'critical',
      'income_overdue:' || t.id::text,
      'Conta a receber em atraso',
      format('%s venceu em %s.', t.description, to_char(t.due_date, 'DD/MM/YYYY')),
      'transaction',
      t.id,
      'receivables',
      t.due_date,
      t.amount,
      true
    from public.transactions t
    where t.company_id = p_company_id
      and t.type = 'income'
      and t.status = 'pending'
      and t.due_date < current_date
    on conflict (company_id, alert_key) do update
    set severity = excluded.severity,
        title = excluded.title,
        message = excluded.message,
        reference_date = excluded.reference_date,
        amount = excluded.amount,
        active = true,
        updated_at = now();
  end if;

  select *
    into v_rule
  from public.automation_rules
  where company_id = p_company_id
    and kind = 'card_statement_due';

  if v_rule.enabled then
    insert into public.alerts (
      company_id, kind, severity, alert_key, title, message,
      source_type, source_id, target_page, reference_date, amount, active
    )
    select
      p_company_id,
      'card_statement_due',
      case when t.due_date < current_date then 'critical' else 'warning' end,
      'card_statement_due:' || t.credit_card_id::text || ':' || t.due_date::text,
      case
        when t.due_date < current_date then 'Fatura do cartão em atraso'
        else 'Fatura do cartão próxima do vencimento'
      end,
      format(
        '%s · %s · total de R$ %s.',
        c.name,
        to_char(t.due_date, 'DD/MM/YYYY'),
        trim(to_char(sum(t.amount), 'FM999G999G990D00'))
      ),
      'credit_card',
      t.credit_card_id,
      'cards',
      t.due_date,
      sum(t.amount),
      true
    from public.transactions t
    join public.credit_cards c
      on c.id = t.credit_card_id
     and c.company_id = p_company_id
    where t.company_id = p_company_id
      and t.status = 'pending'
      and t.credit_card_id is not null
      and t.due_date <= current_date + v_rule.days_before
    group by t.credit_card_id, t.due_date, c.name
    on conflict (company_id, alert_key) do update
    set severity = excluded.severity,
        title = excluded.title,
        message = excluded.message,
        reference_date = excluded.reference_date,
        amount = excluded.amount,
        active = true,
        updated_at = now();
  end if;

  select *
    into v_rule
  from public.automation_rules
  where company_id = p_company_id
    and kind = 'cash_projection';

  if v_rule.enabled then
    select
      coalesce((
        select sum(a.opening_balance)
        from public.financial_accounts a
        where a.company_id = p_company_id
          and a.active = true
      ), 0)
      +
      coalesce((
        select sum(
          case when t.type = 'income' then t.amount else -t.amount end
        )
        from public.transactions t
        where t.company_id = p_company_id
          and t.status = 'paid'
      ), 0)
    into v_current_balance;

    select
      v_current_balance
      +
      coalesce((
        select sum(
          case when t.type = 'income' then t.amount else -t.amount end
        )
        from public.transactions t
        where t.company_id = p_company_id
          and t.status = 'pending'
          and t.due_date <= current_date + v_rule.horizon_days
      ), 0)
    into v_projected_balance;

    if v_projected_balance < v_rule.threshold then
      insert into public.alerts (
        company_id, kind, severity, alert_key, title, message,
        source_type, source_id, target_page, reference_date, amount, active
      )
      values (
        p_company_id,
        'cash_projection',
        case when v_projected_balance < 0 then 'critical' else 'warning' end,
        'cash_projection:' || v_rule.horizon_days::text,
        'Projeção de caixa abaixo do limite',
        format(
          'Em %s dias, o saldo projetado é de R$ %s. Limite configurado: R$ %s.',
          v_rule.horizon_days,
          trim(to_char(v_projected_balance, 'FM999G999G990D00')),
          trim(to_char(v_rule.threshold, 'FM999G999G990D00'))
        ),
        'cash_projection',
        null,
        'reports',
        current_date + v_rule.horizon_days,
        v_projected_balance,
        true
      )
      on conflict (company_id, alert_key) do update
      set severity = excluded.severity,
          title = excluded.title,
          message = excluded.message,
          reference_date = excluded.reference_date,
          amount = excluded.amount,
          active = true,
          updated_at = now();
    end if;
  end if;

  select count(*)
    into v_active_count
  from public.alerts
  where company_id = p_company_id
    and active = true;

  return v_active_count;
end;
$$;

create or replace function public.list_company_alerts(
  p_company_id uuid,
  p_include_dismissed boolean default false
)
returns table (
  id uuid,
  kind text,
  severity text,
  title text,
  message text,
  source_type text,
  source_id uuid,
  target_page text,
  reference_date date,
  amount numeric,
  created_at timestamptz,
  updated_at timestamptz,
  is_read boolean,
  is_dismissed boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_company_member(p_company_id) then
    raise exception 'Not authorized';
  end if;

  return query
  select
    a.id,
    a.kind,
    a.severity,
    a.title,
    a.message,
    a.source_type,
    a.source_id,
    a.target_page,
    a.reference_date,
    a.amount,
    a.created_at,
    a.updated_at,
    (s.read_at is not null) as is_read,
    (s.dismissed_at is not null) as is_dismissed
  from public.alerts a
  left join public.alert_user_states s
    on s.alert_id = a.id
   and s.user_id = auth.uid()
  where a.company_id = p_company_id
    and a.active = true
    and (p_include_dismissed or s.dismissed_at is null)
  order by
    case a.severity
      when 'critical' then 1
      when 'warning' then 2
      else 3
    end,
    a.reference_date nulls last,
    a.updated_at desc;
end;
$$;

create or replace function public.set_alert_state(
  p_alert_id uuid,
  p_action text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
begin
  select company_id
    into v_company_id
  from public.alerts
  where id = p_alert_id
    and active = true;

  if v_company_id is null or not public.is_company_member(v_company_id) then
    raise exception 'Alert not found or not authorized';
  end if;

  if p_action not in ('read', 'unread', 'dismiss', 'restore') then
    raise exception 'Invalid alert action';
  end if;

  insert into public.alert_user_states (
    alert_id,
    user_id,
    read_at,
    dismissed_at,
    updated_at
  )
  values (
    p_alert_id,
    auth.uid(),
    case when p_action in ('read', 'dismiss') then now() else null end,
    case when p_action = 'dismiss' then now() else null end,
    now()
  )
  on conflict (alert_id, user_id) do update
  set read_at = case
        when p_action = 'read' then now()
        when p_action = 'unread' then null
        when p_action = 'dismiss' then coalesce(alert_user_states.read_at, now())
        else alert_user_states.read_at
      end,
      dismissed_at = case
        when p_action = 'dismiss' then now()
        when p_action = 'restore' then null
        else alert_user_states.dismissed_at
      end,
      updated_at = now();
end;
$$;

drop trigger if exists audit_automation_rules on public.automation_rules;
create trigger audit_automation_rules
  after insert or update or delete on public.automation_rules
  for each row execute procedure public.capture_audit_log();

revoke all on function public.seed_company_automation_rules() from public;
revoke all on function public.ensure_default_automation_rules(uuid) from public;
revoke all on function public.refresh_company_alerts(uuid) from public;
revoke all on function public.list_company_alerts(uuid, boolean) from public;
revoke all on function public.set_alert_state(uuid, text) from public;

grant execute on function public.ensure_default_automation_rules(uuid) to authenticated;
grant execute on function public.refresh_company_alerts(uuid) to authenticated;
grant execute on function public.list_company_alerts(uuid, boolean) to authenticated;
grant execute on function public.set_alert_state(uuid, text) to authenticated;
