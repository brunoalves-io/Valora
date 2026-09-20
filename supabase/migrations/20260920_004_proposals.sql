-- Valora v0.4.0 - proposals and quotations
-- Apply after 20260920_003_business_partners.sql.

create table if not exists public.proposals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.business_partners(id) on delete restrict,
  proposal_number integer not null,
  title text not null check (char_length(trim(title)) >= 2),
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'approved', 'rejected', 'expired')),
  issue_date date not null default current_date,
  valid_until date,
  notes text,
  subtotal numeric(14,2) not null default 0 check (subtotal >= 0),
  discount numeric(14,2) not null default 0 check (discount >= 0),
  total numeric(14,2) not null default 0 check (total >= 0),
  converted_transaction_id uuid references public.transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, proposal_number),
  check (valid_until is null or valid_until >= issue_date),
  check (discount <= subtotal),
  check (total = subtotal - discount)
);

create index if not exists idx_proposals_company
  on public.proposals(company_id);

create index if not exists idx_proposals_customer
  on public.proposals(customer_id);

create index if not exists idx_proposals_status
  on public.proposals(company_id, status);

create table if not exists public.proposal_items (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  description text not null check (char_length(trim(description)) >= 2),
  quantity numeric(12,3) not null default 1 check (quantity > 0),
  unit_price numeric(14,2) not null default 0 check (unit_price >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_proposal_items_proposal
  on public.proposal_items(proposal_id, sort_order);

alter table public.proposals enable row level security;
alter table public.proposal_items enable row level security;

drop policy if exists "members can read proposals" on public.proposals;
create policy "members can read proposals"
  on public.proposals for select
  using (public.is_company_member(company_id));

drop policy if exists "managers can write proposals" on public.proposals;
create policy "managers can write proposals"
  on public.proposals for all
  using (public.can_manage_company(company_id))
  with check (public.can_manage_company(company_id));

drop policy if exists "members can read proposal items" on public.proposal_items;
create policy "members can read proposal items"
  on public.proposal_items for select
  using (public.is_company_member(company_id));

drop policy if exists "managers can write proposal items" on public.proposal_items;
create policy "managers can write proposal items"
  on public.proposal_items for all
  using (public.can_manage_company(company_id))
  with check (public.can_manage_company(company_id));

grant select, insert, update, delete on table public.proposals to authenticated;
grant select, insert, update, delete on table public.proposal_items to authenticated;

create or replace function public.assign_proposal_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.proposal_number is null or new.proposal_number <= 0 then
    perform pg_advisory_xact_lock(hashtextextended(new.company_id::text, 0));

    select coalesce(max(p.proposal_number), 0) + 1
      into new.proposal_number
    from public.proposals p
    where p.company_id = new.company_id;
  end if;

  return new;
end;
$$;

drop trigger if exists assign_proposal_number_trigger on public.proposals;
create trigger assign_proposal_number_trigger
  before insert on public.proposals
  for each row execute procedure public.assign_proposal_number();

create or replace function public.validate_proposal_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.business_partners bp
    where bp.id = new.customer_id
      and bp.company_id = new.company_id
      and bp.kind in ('customer', 'both')
  ) then
    raise exception 'Proposal customer must belong to the same company and be a customer';
  end if;

  if new.converted_transaction_id is not null and not exists (
    select 1
    from public.transactions t
    where t.id = new.converted_transaction_id
      and t.company_id = new.company_id
      and t.type = 'income'
      and t.partner_id = new.customer_id
  ) then
    raise exception 'Converted transaction must be a receivable for the same customer and company';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_proposal_scope_trigger on public.proposals;
create trigger validate_proposal_scope_trigger
  before insert or update of company_id, customer_id, converted_transaction_id
  on public.proposals
  for each row execute procedure public.validate_proposal_scope();

create or replace function public.validate_proposal_item_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.proposals p
    where p.id = new.proposal_id
      and p.company_id = new.company_id
  ) then
    raise exception 'Proposal item must belong to the same company as the proposal';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_proposal_item_scope_trigger on public.proposal_items;
create trigger validate_proposal_item_scope_trigger
  before insert or update of proposal_id, company_id
  on public.proposal_items
  for each row execute procedure public.validate_proposal_item_scope();

create or replace function public.recalculate_proposal_totals(p_proposal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subtotal numeric(14,2);
begin
  select coalesce(sum(quantity * unit_price), 0)::numeric(14,2)
    into v_subtotal
  from public.proposal_items
  where proposal_id = p_proposal_id;

  update public.proposals
  set subtotal = v_subtotal,
      discount = least(discount, v_subtotal),
      total = v_subtotal - least(discount, v_subtotal),
      updated_at = now()
  where id = p_proposal_id;
end;
$$;

create or replace function public.refresh_proposal_totals_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recalculate_proposal_totals(old.proposal_id);
    return old;
  end if;

  perform public.recalculate_proposal_totals(new.proposal_id);

  if tg_op = 'UPDATE' and old.proposal_id <> new.proposal_id then
    perform public.recalculate_proposal_totals(old.proposal_id);
  end if;

  return new;
end;
$$;

drop trigger if exists refresh_proposal_totals_trigger on public.proposal_items;
create trigger refresh_proposal_totals_trigger
  after insert or update or delete on public.proposal_items
  for each row execute procedure public.refresh_proposal_totals_trigger();

create or replace function public.convert_proposal_to_receivable(
  p_proposal_id uuid,
  p_due_date date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal public.proposals%rowtype;
  v_transaction_id uuid;
begin
  select *
    into v_proposal
  from public.proposals
  where id = p_proposal_id
  for update;

  if not found then
    raise exception 'Proposal not found';
  end if;

  if not public.can_manage_company(v_proposal.company_id) then
    raise exception 'Not authorized';
  end if;

  if v_proposal.status <> 'approved' then
    raise exception 'Only approved proposals can become receivables';
  end if;

  if v_proposal.converted_transaction_id is not null then
    return v_proposal.converted_transaction_id;
  end if;

  if v_proposal.total <= 0 then
    raise exception 'Proposal total must be greater than zero';
  end if;

  insert into public.transactions (
    company_id,
    type,
    description,
    amount,
    due_date,
    status,
    partner_id
  )
  values (
    v_proposal.company_id,
    'income',
    'Proposta #' || lpad(v_proposal.proposal_number::text, 4, '0') || ' - ' || v_proposal.title,
    v_proposal.total,
    p_due_date,
    'pending',
    v_proposal.customer_id
  )
  returning id into v_transaction_id;

  update public.proposals
  set converted_transaction_id = v_transaction_id,
      updated_at = now()
  where id = v_proposal.id;

  return v_transaction_id;
end;
$$;

revoke all on function public.assign_proposal_number() from public;
revoke all on function public.validate_proposal_scope() from public;
revoke all on function public.validate_proposal_item_scope() from public;
revoke all on function public.recalculate_proposal_totals(uuid) from public;
revoke all on function public.refresh_proposal_totals_trigger() from public;
revoke all on function public.convert_proposal_to_receivable(uuid, date) from public;

grant execute on function public.convert_proposal_to_receivable(uuid, date) to authenticated;
