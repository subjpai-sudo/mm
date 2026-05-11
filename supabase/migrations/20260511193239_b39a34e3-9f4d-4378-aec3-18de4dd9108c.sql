
alter function public.handle_new_user() set search_path = public;
alter function public.apply_stock_movement() set search_path = public;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.apply_stock_movement() from public, anon, authenticated;
revoke execute on function public.has_role(uuid, public.app_role) from public, anon;
