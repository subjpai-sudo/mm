-- Enable realtime for billing destination tables used in stock-out.

do $$
begin
  execute 'alter publication supabase_realtime add table public.billing_customers';
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  execute 'alter publication supabase_realtime add table public.billing_stores';
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
