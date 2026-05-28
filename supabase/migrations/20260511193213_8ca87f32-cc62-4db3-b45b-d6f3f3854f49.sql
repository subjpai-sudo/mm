
-- Roles
create type public.app_role as enum ('admin', 'operator', 'owner');
create type public.movement_type as enum ('in', 'out');
create type public.order_type as enum ('restock', 'new_order');
create type public.order_status as enum ('pending', 'approved', 'declined');

-- Profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "profiles readable by authenticated" on public.profiles for select to authenticated using (true);
create policy "users update own profile" on public.profiles for update to authenticated using (auth.uid() = id);

-- User roles
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique(user_id, role)
);
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create policy "roles readable by authenticated" on public.user_roles for select to authenticated using (true);
create policy "admins manage roles" on public.user_roles for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

-- Auto-create profile + default operator role
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  insert into public.user_roles (user_id, role)
  values (new.id, coalesce((new.raw_user_meta_data->>'role')::public.app_role, 'operator'));
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Categories (self-referencing for subcategories)
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  parent_id uuid references public.categories(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.categories enable row level security;
create policy "categories read" on public.categories for select to authenticated using (true);
create policy "categories write admin/operator" on public.categories for all to authenticated
  using (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'operator'))
  with check (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'operator'));

-- Products
create table public.products (
  id uuid primary key default gen_random_uuid(),
  sku text unique,
  barcode text unique,
  name text not null,
  category_id uuid references public.categories(id) on delete set null,
  price numeric(12,2) not null default 0,
  stock integer not null default 0,
  low_stock_threshold integer not null default 5,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.products enable row level security;
create policy "products read" on public.products for select to authenticated using (true);
create policy "products write admin/operator" on public.products for all to authenticated
  using (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'operator'))
  with check (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'operator'));

-- Stock movements
create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  type public.movement_type not null,
  quantity integer not null check (quantity > 0),
  reason text,
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.stock_movements enable row level security;
create policy "movements read" on public.stock_movements for select to authenticated using (true);
create policy "movements insert admin/operator" on public.stock_movements for insert to authenticated
  with check (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'operator'));

-- Apply movement to product stock
create or replace function public.apply_stock_movement()
returns trigger language plpgsql as $$
begin
  if new.type = 'in' then
    update public.products set stock = stock + new.quantity, updated_at = now() where id = new.product_id;
  else
    update public.products set stock = greatest(0, stock - new.quantity), updated_at = now() where id = new.product_id;
  end if;
  return new;
end;
$$;
create trigger trg_apply_movement after insert on public.stock_movements
  for each row execute function public.apply_stock_movement();

-- Order requests
create table public.order_requests (
  id uuid primary key default gen_random_uuid(),
  type public.order_type not null,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  notes text,
  viber_message text,
  status public.order_status not null default 'pending',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.order_requests enable row level security;
create policy "orders read" on public.order_requests for select to authenticated using (true);
create policy "orders admin manage" on public.order_requests for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- Settings (single-row keyed by id)
create table public.app_settings (
  id integer primary key default 1 check (id = 1),
  viber_bot_token text,
  viber_owner_id text,
  viber_webhook_url text,
  updated_at timestamptz not null default now()
);
insert into public.app_settings (id) values (1);
alter table public.app_settings enable row level security;
create policy "settings read" on public.app_settings for select to authenticated using (true);
create policy "settings admin write" on public.app_settings for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
