create table if not exists public.racks (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

alter table public.racks enable row level security;

drop policy if exists "racks read" on public.racks;
create policy "racks read"
on public.racks
for select
to authenticated
using (true);

drop policy if exists "racks manage all roles" on public.racks;
create policy "racks manage all roles"
on public.racks
for all
to authenticated
using (
  has_role(auth.uid(), 'admin'::app_role)
  or has_role(auth.uid(), 'operator'::app_role)
  or has_role(auth.uid(), 'owner'::app_role)
)
with check (
  has_role(auth.uid(), 'admin'::app_role)
  or has_role(auth.uid(), 'operator'::app_role)
  or has_role(auth.uid(), 'owner'::app_role)
);

create or replace function public.set_racks_updated_at()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists update_racks_updated_at on public.racks;
create trigger update_racks_updated_at
before update on public.racks
for each row
execute function public.set_racks_updated_at();

insert into public.racks (code, name)
select seeded.code, seeded.code
from (
  select format('R%s', gs)::text as code
  from generate_series(1, 20) as gs
  union
  select distinct upper(trim(rack)) as code
  from public.products
  where nullif(trim(rack), '') is not null
) as seeded
on conflict (code) do nothing;