-- Valora v0.7.0 - team permissions, invitations and audit log
-- Apply after 20260920_005_cards_recurring.sql.

create table if not exists public.team_invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null check (char_length(trim(email)) >= 5),
  role text not null check (role in ('admin', 'member', 'viewer')),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'cancelled')),
  invited_by uuid default auth.uid() references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_team_invitations_pending_email
  on public.team_invitations(company_id, lower(trim(email)))
  where status = 'pending';

create index if not exists idx_team_invitations_company
  on public.team_invitations(company_id, status, created_at desc);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  changes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_company_created
  on public.audit_logs(company_id, created_at desc);

create index if not exists idx_audit_logs_actor
  on public.audit_logs(actor_id, created_at desc);

alter table public.team_invitations enable row level security;
alter table public.audit_logs enable row level security;

create or replace function public.is_company_owner(target_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_members
    where company_id = target_company
      and user_id = auth.uid()
      and role = 'owner'
  );
$$;

create or replace function public.can_admin_company(target_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_members
    where company_id = target_company
      and user_id = auth.uid()
      and role in ('owner', 'admin')
  );
$$;

drop policy if exists "admins can read team invitations" on public.team_invitations;
create policy "admins can read team invitations"
  on public.team_invitations for select
  using (public.can_admin_company(company_id));

drop policy if exists "admins can read audit logs" on public.audit_logs;
create policy "admins can read audit logs"
  on public.audit_logs for select
  using (public.can_admin_company(company_id));

grant select on table public.team_invitations to authenticated;
grant select on table public.audit_logs to authenticated;

create or replace function public.list_company_team(p_company_id uuid)
returns table (
  user_id uuid,
  full_name text,
  email text,
  role text,
  joined_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not public.can_admin_company(p_company_id) then
    raise exception 'Not authorized';
  end if;

  return query
  select
    cm.user_id,
    coalesce(nullif(trim(p.full_name), ''), nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''), split_part(u.email, '@', 1))::text,
    u.email::text,
    cm.role::text,
    cm.created_at
  from public.company_members cm
  join auth.users u on u.id = cm.user_id
  left join public.profiles p on p.id = cm.user_id
  where cm.company_id = p_company_id
  order by
    case cm.role
      when 'owner' then 1
      when 'admin' then 2
      when 'member' then 3
      else 4
    end,
    coalesce(p.full_name, u.email);
end;
$$;

create or replace function public.invite_company_member(
  p_company_id uuid,
  p_email text,
  p_role text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text;
  v_actor_role text;
  v_invitation_id uuid;
begin
  if not public.can_admin_company(p_company_id) then
    raise exception 'Not authorized';
  end if;

  v_email := lower(trim(p_email));

  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'Invalid email address';
  end if;

  if p_role not in ('admin', 'member', 'viewer') then
    raise exception 'Invalid team role';
  end if;

  select role into v_actor_role
  from public.company_members
  where company_id = p_company_id
    and user_id = auth.uid();

  if v_actor_role = 'admin' and p_role = 'admin' then
    raise exception 'Only the owner can invite administrators';
  end if;

  if exists (
    select 1
    from auth.users u
    join public.company_members cm
      on cm.user_id = u.id
     and cm.company_id = p_company_id
    where lower(u.email) = v_email
  ) then
    raise exception 'This user is already a member of the company';
  end if;

  select id
    into v_invitation_id
  from public.team_invitations
  where company_id = p_company_id
    and lower(trim(email)) = v_email
    and status = 'pending'
  limit 1;

  if v_invitation_id is not null then
    update public.team_invitations
    set role = p_role,
        invited_by = auth.uid(),
        updated_at = now()
    where id = v_invitation_id;
  else
    insert into public.team_invitations (
      company_id,
      email,
      role,
      status,
      invited_by
    )
    values (
      p_company_id,
      v_email,
      p_role,
      'pending',
      auth.uid()
    )
    returning id into v_invitation_id;
  end if;

  insert into public.audit_logs (
    company_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    changes
  )
  values (
    p_company_id,
    auth.uid(),
    'invited',
    'team_invitation',
    v_invitation_id,
    jsonb_build_object('email', v_email, 'role', p_role)
  );

  return v_invitation_id;
end;
$$;

create or replace function public.accept_my_company_invitations()
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_invitation public.team_invitations%rowtype;
  v_count integer := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select lower(email)
    into v_email
  from auth.users
  where id = v_user_id;

  if v_email is null then
    return 0;
  end if;

  for v_invitation in
    select *
    from public.team_invitations
    where lower(trim(email)) = v_email
      and status = 'pending'
    order by created_at
    for update
  loop
    insert into public.company_members (company_id, user_id, role)
    values (v_invitation.company_id, v_user_id, v_invitation.role)
    on conflict (company_id, user_id) do nothing;

    update public.team_invitations
    set status = 'accepted',
        accepted_at = now(),
        updated_at = now()
    where id = v_invitation.id;

    insert into public.audit_logs (
      company_id,
      actor_id,
      action,
      entity_type,
      entity_id,
      changes
    )
    values (
      v_invitation.company_id,
      v_user_id,
      'joined',
      'team_member',
      v_user_id,
      jsonb_build_object('email', v_email, 'role', v_invitation.role)
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create or replace function public.update_company_member_role(
  p_company_id uuid,
  p_user_id uuid,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role text;
  v_target_role text;
begin
  if not public.can_admin_company(p_company_id) then
    raise exception 'Not authorized';
  end if;

  if p_role not in ('admin', 'member', 'viewer') then
    raise exception 'Invalid team role';
  end if;

  select role into v_actor_role
  from public.company_members
  where company_id = p_company_id
    and user_id = auth.uid();

  select role into v_target_role
  from public.company_members
  where company_id = p_company_id
    and user_id = p_user_id;

  if v_target_role is null then
    raise exception 'Member not found';
  end if;

  if v_target_role = 'owner' then
    raise exception 'The owner role cannot be changed here';
  end if;

  if v_actor_role = 'admin' and (v_target_role = 'admin' or p_role = 'admin') then
    raise exception 'Only the owner can manage administrators';
  end if;

  update public.company_members
  set role = p_role
  where company_id = p_company_id
    and user_id = p_user_id;

  insert into public.audit_logs (
    company_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    changes
  )
  values (
    p_company_id,
    auth.uid(),
    'role_changed',
    'team_member',
    p_user_id,
    jsonb_build_object('before', v_target_role, 'after', p_role)
  );
end;
$$;

create or replace function public.remove_company_member(
  p_company_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role text;
  v_target_role text;
begin
  if not public.can_admin_company(p_company_id) then
    raise exception 'Not authorized';
  end if;

  select role into v_actor_role
  from public.company_members
  where company_id = p_company_id
    and user_id = auth.uid();

  select role into v_target_role
  from public.company_members
  where company_id = p_company_id
    and user_id = p_user_id;

  if v_target_role is null then
    raise exception 'Member not found';
  end if;

  if v_target_role = 'owner' then
    raise exception 'The owner cannot be removed';
  end if;

  if v_actor_role = 'admin' and v_target_role = 'admin' then
    raise exception 'Only the owner can remove administrators';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'You cannot remove your own access from this screen';
  end if;

  delete from public.company_members
  where company_id = p_company_id
    and user_id = p_user_id;

  insert into public.audit_logs (
    company_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    changes
  )
  values (
    p_company_id,
    auth.uid(),
    'removed',
    'team_member',
    p_user_id,
    jsonb_build_object('role', v_target_role)
  );
end;
$$;

create or replace function public.cancel_company_invitation(
  p_invitation_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invitation public.team_invitations%rowtype;
  v_actor_role text;
begin
  select *
    into v_invitation
  from public.team_invitations
  where id = p_invitation_id
  for update;

  if not found then
    raise exception 'Invitation not found';
  end if;

  if not public.can_admin_company(v_invitation.company_id) then
    raise exception 'Not authorized';
  end if;

  select role into v_actor_role
  from public.company_members
  where company_id = v_invitation.company_id
    and user_id = auth.uid();

  if v_actor_role = 'admin' and v_invitation.role = 'admin' then
    raise exception 'Only the owner can manage administrator invitations';
  end if;

  update public.team_invitations
  set status = 'cancelled',
      updated_at = now()
  where id = p_invitation_id
    and status = 'pending';

  insert into public.audit_logs (
    company_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    changes
  )
  values (
    v_invitation.company_id,
    auth.uid(),
    'invitation_cancelled',
    'team_invitation',
    v_invitation.id,
    jsonb_build_object('email', v_invitation.email, 'role', v_invitation.role)
  );
end;
$$;

create or replace function public.capture_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_entity_id uuid;
  v_action text;
  v_changes jsonb;
  v_old jsonb;
  v_new jsonb;
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    v_company_id := (v_new ->> 'company_id')::uuid;
    v_entity_id := nullif(v_new ->> 'id', '')::uuid;
    v_action := 'created';
    v_changes := jsonb_build_object('after', v_new);
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_company_id := (v_new ->> 'company_id')::uuid;
    v_entity_id := nullif(v_new ->> 'id', '')::uuid;

    if tg_table_name = 'transactions'
      and (v_old ->> 'status') is distinct from (v_new ->> 'status')
      and (v_new ->> 'status') = 'paid' then
      v_action := 'settled';
    elsif tg_table_name = 'transactions'
      and (v_old ->> 'status') is distinct from (v_new ->> 'status')
      and (v_new ->> 'status') = 'cancelled' then
      v_action := 'cancelled';
    else
      v_action := 'updated';
    end if;

    v_changes := jsonb_build_object('before', v_old, 'after', v_new);
  else
    v_old := to_jsonb(old);
    v_company_id := (v_old ->> 'company_id')::uuid;
    v_entity_id := nullif(v_old ->> 'id', '')::uuid;
    v_action := 'deleted';
    v_changes := jsonb_build_object('before', v_old);
  end if;

  insert into public.audit_logs (
    company_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    changes
  )
  values (
    v_company_id,
    auth.uid(),
    v_action,
    tg_table_name,
    v_entity_id,
    v_changes
  );

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists audit_transactions on public.transactions;
create trigger audit_transactions
  after insert or update or delete on public.transactions
  for each row execute procedure public.capture_audit_log();

drop trigger if exists audit_financial_accounts on public.financial_accounts;
create trigger audit_financial_accounts
  after insert or update or delete on public.financial_accounts
  for each row execute procedure public.capture_audit_log();

drop trigger if exists audit_categories on public.categories;
create trigger audit_categories
  after insert or update or delete on public.categories
  for each row execute procedure public.capture_audit_log();

drop trigger if exists audit_cost_centers on public.cost_centers;
create trigger audit_cost_centers
  after insert or update or delete on public.cost_centers
  for each row execute procedure public.capture_audit_log();

drop trigger if exists audit_business_partners on public.business_partners;
create trigger audit_business_partners
  after insert or update or delete on public.business_partners
  for each row execute procedure public.capture_audit_log();

drop trigger if exists audit_proposals on public.proposals;
create trigger audit_proposals
  after insert or update or delete on public.proposals
  for each row execute procedure public.capture_audit_log();

drop trigger if exists audit_credit_cards on public.credit_cards;
create trigger audit_credit_cards
  after insert or update or delete on public.credit_cards
  for each row execute procedure public.capture_audit_log();

drop trigger if exists audit_recurring_rules on public.recurring_rules;
create trigger audit_recurring_rules
  after insert or update or delete on public.recurring_rules
  for each row execute procedure public.capture_audit_log();

revoke all on function public.is_company_owner(uuid) from public;
revoke all on function public.can_admin_company(uuid) from public;
revoke all on function public.list_company_team(uuid) from public;
revoke all on function public.invite_company_member(uuid, text, text) from public;
revoke all on function public.accept_my_company_invitations() from public;
revoke all on function public.update_company_member_role(uuid, uuid, text) from public;
revoke all on function public.remove_company_member(uuid, uuid) from public;
revoke all on function public.cancel_company_invitation(uuid) from public;
revoke all on function public.capture_audit_log() from public;

grant execute on function public.is_company_owner(uuid) to authenticated;
grant execute on function public.can_admin_company(uuid) to authenticated;
grant execute on function public.list_company_team(uuid) to authenticated;
grant execute on function public.invite_company_member(uuid, text, text) to authenticated;
grant execute on function public.accept_my_company_invitations() to authenticated;
grant execute on function public.update_company_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.remove_company_member(uuid, uuid) to authenticated;
grant execute on function public.cancel_company_invitation(uuid) to authenticated;
