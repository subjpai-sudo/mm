-- Warehouse bills are packing-list style documents created from stock-out.
-- They are not final invoices; billing imports them and owns final prices.

create table if not exists public.warehouse_bills (
  id uuid primary key default gen_random_uuid(),
  bill_no text not null unique,
  destination_type text not null check (destination_type in ('delivery', 'shop')),
  destination_label text not null,
  customer_id uuid references public.billing_customers(id) on delete set null,
  shop_id text references public.billing_stores(id) on delete set null,
  status text not null default 'issued' check (status in ('issued', 'sent_to_billing', 'invoiced', 'cancelled')),
  subtotal numeric not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  billing_invoice_id text,
  billing_invoice_url text
);

alter table public.warehouse_bills enable row level security;

drop policy if exists "warehouse_bills: read" on public.warehouse_bills;
create policy "warehouse_bills: read"
  on public.warehouse_bills for select
  to authenticated
  using (true);

drop policy if exists "warehouse_bills: write" on public.warehouse_bills;
create policy "warehouse_bills: write"
  on public.warehouse_bills for all
  to authenticated
  using (true)
  with check (true);

alter table public.stock_movements
  add column if not exists warehouse_bill_id uuid references public.warehouse_bills(id) on delete set null;

create table if not exists public.warehouse_bill_items (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.warehouse_bills(id) on delete cascade,
  stock_movement_id uuid references public.stock_movements(id) on delete set null,
  product_id uuid not null references public.products(id) on delete restrict,
  sku text,
  name_snapshot text not null,
  barcode_snapshot text,
  boxes integer not null default 0,
  loose_pcs integer not null default 0,
  pcs_per_case integer,
  qty_pcs integer not null,
  default_price numeric not null default 0,
  line_total numeric not null default 0,
  created_at timestamptz not null default now()
);

alter table public.warehouse_bill_items enable row level security;

drop policy if exists "warehouse_bill_items: read" on public.warehouse_bill_items;
create policy "warehouse_bill_items: read"
  on public.warehouse_bill_items for select
  to authenticated
  using (true);

drop policy if exists "warehouse_bill_items: write" on public.warehouse_bill_items;
create policy "warehouse_bill_items: write"
  on public.warehouse_bill_items for all
  to authenticated
  using (true)
  with check (true);

create index if not exists idx_warehouse_bill_items_bill_id
  on public.warehouse_bill_items(bill_id);

create index if not exists idx_stock_movements_warehouse_bill_id
  on public.stock_movements(warehouse_bill_id);

do $$
begin
  execute 'alter publication supabase_realtime add table public.warehouse_bills';
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  execute 'alter publication supabase_realtime add table public.warehouse_bill_items';
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
