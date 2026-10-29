-- Supabase security hardening
-- Keep internal trigger/event-trigger functions inaccessible through the Data API.

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
