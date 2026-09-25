-- Valora v1.0.0 - company settings
-- Apply after 20260920_008_valora_ai.sql.

alter table public.companies
  add column if not exists legal_name text,
  add column if not exists tax_id text,
  add column if not exists state_registration text,
  add column if not exists municipal_registration text,
  add column if not exists email text,
  add column if not exists phone text,
  add column if not exists website text,
  add column if not exists address_street text,
  add column if not exists address_number text,
  add column if not exists address_complement text,
  add column if not exists address_district text,
  add column if not exists address_city text,
  add column if not exists address_state text,
  add column if not exists postal_code text,
  add column if not exists country_code text not null default 'BR',
  add column if not exists currency_code text not null default 'BRL',
  add column if not exists locale text not null default 'pt-BR',
  add column if not exists timezone text not null default 'America/Sao_Paulo',
  add column if not exists logo_url text;

alter table public.companies
  drop constraint if exists companies_country_code_check,
  add constraint companies_country_code_check
    check (char_length(country_code) = 2),
  drop constraint if exists companies_currency_code_check,
  add constraint companies_currency_code_check
    check (char_length(currency_code) = 3),
  drop constraint if exists companies_locale_check,
  add constraint companies_locale_check
    check (char_length(trim(locale)) between 2 and 20),
  drop constraint if exists companies_timezone_check,
  add constraint companies_timezone_check
    check (char_length(trim(timezone)) between 3 and 80);

create unique index if not exists idx_companies_tax_id_unique
  on public.companies(regexp_replace(tax_id, '[^0-9]', '', 'g'))
  where tax_id is not null
    and length(regexp_replace(tax_id, '[^0-9]', '', 'g')) > 0;

create or replace function public.validate_company_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tax_digits text;
begin
  new.name := trim(new.name);
  new.legal_name := nullif(trim(new.legal_name), '');
  new.tax_id := nullif(trim(new.tax_id), '');
  new.state_registration := nullif(trim(new.state_registration), '');
  new.municipal_registration := nullif(trim(new.municipal_registration), '');
  new.email := nullif(lower(trim(new.email)), '');
  new.phone := nullif(trim(new.phone), '');
  new.website := nullif(trim(new.website), '');
  new.address_street := nullif(trim(new.address_street), '');
  new.address_number := nullif(trim(new.address_number), '');
  new.address_complement := nullif(trim(new.address_complement), '');
  new.address_district := nullif(trim(new.address_district), '');
  new.address_city := nullif(trim(new.address_city), '');
  new.address_state := nullif(upper(trim(new.address_state)), '');
  new.postal_code := nullif(trim(new.postal_code), '');
  new.country_code := upper(trim(new.country_code));
  new.currency_code := upper(trim(new.currency_code));
  new.locale := trim(new.locale);
  new.timezone := trim(new.timezone);
  new.logo_url := nullif(trim(new.logo_url), '');

  if char_length(new.name) < 2 then
    raise exception 'Company name must have at least 2 characters';
  end if;

  if new.tax_id is not null then
    v_tax_digits := regexp_replace(new.tax_id, '[^0-9]', '', 'g');
    if char_length(v_tax_digits) not in (11, 14) then
      raise exception 'Tax ID must contain 11 digits for CPF or 14 digits for CNPJ';
    end if;
  end if;

  if new.email is not null
    and new.email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
    raise exception 'Invalid company email';
  end if;

  if new.address_state is not null and char_length(new.address_state) > 2 then
    raise exception 'State must use the 2-letter abbreviation';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_company_settings_trigger on public.companies;
create trigger validate_company_settings_trigger
  before insert or update of
    name,
    legal_name,
    tax_id,
    state_registration,
    municipal_registration,
    email,
    phone,
    website,
    address_street,
    address_number,
    address_complement,
    address_district,
    address_city,
    address_state,
    postal_code,
    country_code,
    currency_code,
    locale,
    timezone,
    logo_url
  on public.companies
  for each row execute procedure public.validate_company_settings();

-- Make the generic audit function aware that companies use their own id
-- as the tenant id, instead of a company_id column.
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
    v_company_id := case
      when tg_table_name = 'companies'
        then nullif(v_new ->> 'id', '')::uuid
      else nullif(v_new ->> 'company_id', '')::uuid
    end;
    v_entity_id := nullif(v_new ->> 'id', '')::uuid;
    v_action := 'created';
    v_changes := jsonb_build_object('after', v_new);
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_company_id := case
      when tg_table_name = 'companies'
        then nullif(v_new ->> 'id', '')::uuid
      else nullif(v_new ->> 'company_id', '')::uuid
    end;
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
    v_company_id := case
      when tg_table_name = 'companies'
        then nullif(v_old ->> 'id', '')::uuid
      else nullif(v_old ->> 'company_id', '')::uuid
    end;
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

drop trigger if exists audit_companies on public.companies;
create trigger audit_companies
  after update on public.companies
  for each row execute procedure public.capture_audit_log();

revoke all on function public.validate_company_settings() from public;
