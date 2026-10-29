-- Valora v1.0.26 - Open Finance supporting indexes

create index if not exists idx_bank_connections_created_by
  on public.bank_connections(created_by)
  where created_by is not null;

create index if not exists idx_bank_sync_runs_company
  on public.bank_sync_runs(company_id, started_at desc);

create index if not exists idx_bank_sync_runs_created_by
  on public.bank_sync_runs(created_by)
  where created_by is not null;
