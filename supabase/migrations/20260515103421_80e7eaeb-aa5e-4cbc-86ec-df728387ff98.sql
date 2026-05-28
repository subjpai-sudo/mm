
-- Extensions
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Private backups bucket
insert into storage.buckets (id, name, public)
values ('backups', 'backups', false)
on conflict (id) do nothing;

-- Storage policies: admins only
create policy "backups admin read"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'backups' and public.has_role(auth.uid(), 'admin'));

create policy "backups admin insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'backups' and public.has_role(auth.uid(), 'admin'));

create policy "backups admin delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'backups' and public.has_role(auth.uid(), 'admin'));

-- Backup log
create table public.backup_log (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  file_path text,
  size_bytes bigint,
  error text,
  triggered_by text not null default 'cron'
);
alter table public.backup_log enable row level security;
create policy "backup log admin read"
  on public.backup_log for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- Mirror sync log
create table public.mirror_sync_log (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  rows_synced jsonb,
  error text,
  triggered_by text not null default 'cron'
);
alter table public.mirror_sync_log enable row level security;
create policy "mirror log admin read"
  on public.mirror_sync_log for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));
