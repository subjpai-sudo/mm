-- ── billing_stores ────────────────────────────────────────────────────────────
create table public.billing_stores (
  id         text primary key,
  name       text not null,
  sub        text,
  address    text,
  tel        text,
  email      text,
  zip        text,
  created_at timestamptz default now()
);
alter table public.billing_stores enable row level security;
create policy "billing_stores: read" on public.billing_stores for select to authenticated using (true);
create policy "billing_stores: write" on public.billing_stores for all to authenticated using (true) with check (true);

insert into public.billing_stores (id, name, sub, address, tel, email, zip) values
  ('mm_kita_otsuka',  'MM-MART', 'Kita Otsuka',   '東京都豊島区北大塚3-32-3(201)',             '03-6903-6174', '', '170-0004'),
  ('mm_takadano',     'MM-MART', 'Takadano Baba',  '東京都新宿区高田馬場4丁目9-14 岩ビル1階',  '03-6768-0683', '', '169-0075'),
  ('mm_minami',       'MM-MART', 'Minami Otsuka',  '東京都豊島区南大塚',                        '',             '', '170-0005'),
  ('mm_higashi_jujo', 'MM-MART', 'Higashi Jujo',   '東京都北区東十条',                          '',             '', '114-0003'),
  ('mm_sugamo',       'MM-MART', 'Sugamo',         '東京都豊島区巣鴨',                          '',             '', '170-0002'),
  ('mm_kawaguchi',    'MM-MART', 'Kawaguchi',      '埼玉県川口市',                              '',             '', '332-0000'),
  ('mm_komagome',     'MM-MART', 'Komagome',       '東京都豊島区駒込',                          '',             '', '170-0003')
on conflict do nothing;

-- ── billing_customers ─────────────────────────────────────────────────────────
create table public.billing_customers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  company    text,
  address    text,
  tel        text,
  email      text,
  notes      text,
  created_at timestamptz default now()
);
alter table public.billing_customers enable row level security;
create policy "billing_customers: all" on public.billing_customers for all to authenticated using (true) with check (true);

-- ── billing_invoices ──────────────────────────────────────────────────────────
create table public.billing_invoices (
  id               uuid primary key default gen_random_uuid(),
  store_id         text references public.billing_stores(id),   -- issuing store (FROM)
  bill_to_type     text not null default 'store',               -- 'store' | 'customer'
  bill_to_store_id text references public.billing_stores(id),   -- destination store (TO)
  customer_id      uuid references public.billing_customers(id),-- customer (TO)
  invoice_no       text,
  date             date not null,
  items            jsonb not null default '[]'::jsonb,
  tax_rate         numeric not null default 8,
  discount         numeric not null default 0,
  subtotal         numeric not null default 0,
  tax              numeric not null default 0,
  total            numeric not null default 0,
  created_at       timestamptz default now(),
  created_by       uuid references auth.users(id)
);
alter table public.billing_invoices enable row level security;
create policy "billing_invoices: all" on public.billing_invoices for all to authenticated using (true) with check (true);
