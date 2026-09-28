-- Valora v1.0.1 - WhatsApp company contact
-- Apply after 20260921_010_company_branding_storage.sql.

alter table public.companies
  add column if not exists whatsapp text;

create or replace function public.normalize_company_whatsapp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.whatsapp := nullif(trim(new.whatsapp), '');
  return new;
end;
$$;

drop trigger if exists normalize_company_whatsapp_trigger on public.companies;
create trigger normalize_company_whatsapp_trigger
  before insert or update of whatsapp
  on public.companies
  for each row execute procedure public.normalize_company_whatsapp();

revoke all on function public.normalize_company_whatsapp() from public;
