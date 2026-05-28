-- Billing stores (shops with full address info for invoice headers)
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
create policy "billing_stores: authenticated read"
  on public.billing_stores for select to authenticated using (true);
create policy "billing_stores: admin write"
  on public.billing_stores for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Seed default MM-MART stores
insert into public.billing_stores (id, name, sub, address, tel, email, zip) values
  ('mm_kita_otsuka',  'MM-MART', 'Kita Otsuka',   '東京都豊島区北大塚3-32-3(201)',              '03-6903-6174', '', '170-0004'),
  ('mm_takadano',     'MM-MART', 'Takadano Baba',  '東京都新宿区高田馬場4丁目9-14 岩ビル1階',   '03-6768-0683', '', '169-0075'),
  ('mm_minami',       'MM-MART', 'Minami Otsuka',  '東京都豊島区南大塚',                         '',             '', '170-0005'),
  ('mm_higashi_jujo', 'MM-MART', 'Higashi Jujo',   '東京都北区東十条',                           '',             '', '114-0003'),
  ('mm_sugamo',       'MM-MART', 'Sugamo',         '東京都豊島区巣鴨',                           '',             '', '170-0002'),
  ('mm_kawaguchi',    'MM-MART', 'Kawaguchi',      '埼玉県川口市',                               '',             '', '332-0000'),
  ('mm_komagome',     'MM-MART', 'Komagome',       '東京都豊島区駒込',                           '',             '', '170-0003')
on conflict do nothing;

-- Billing invoices
create table public.billing_invoices (
  id         uuid primary key default gen_random_uuid(),
  store_id   text references public.billing_stores(id),
  invoice_no text,
  date       date not null,
  items      jsonb not null default '[]'::jsonb,
  tax_rate   numeric not null default 8,
  subtotal   numeric not null default 0,
  tax        numeric not null default 0,
  total      numeric not null default 0,
  created_at timestamptz default now(),
  created_by uuid references auth.users(id)
);

alter table public.billing_invoices enable row level security;
create policy "billing_invoices: authenticated all"
  on public.billing_invoices for all to authenticated
  using (true) with check (true);
