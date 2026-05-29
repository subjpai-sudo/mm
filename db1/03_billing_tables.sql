-- ============================================================
-- BILLING TABLES — run in Supabase SQL Editor
-- These were migrated from Firebase RTDB to Supabase
-- ============================================================

-- ── billing_stores ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.billing_stores (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  sub        TEXT,
  address    TEXT,
  tel        TEXT,
  email      TEXT,
  zip        TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── billing_customers ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.billing_customers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  company    TEXT,
  address    TEXT,
  tel        TEXT,
  email      TEXT,
  notes      TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── billing_invoices ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.billing_invoices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id          TEXT REFERENCES public.billing_stores(id) ON DELETE SET NULL,
  bill_to_type      TEXT NOT NULL DEFAULT 'store',
  bill_to_store_id  TEXT REFERENCES public.billing_stores(id) ON DELETE SET NULL,
  customer_id       UUID REFERENCES public.billing_customers(id) ON DELETE SET NULL,
  invoice_no        TEXT,
  date              TEXT NOT NULL,
  items             JSONB NOT NULL DEFAULT '[]',
  tax_rate          NUMERIC NOT NULL DEFAULT 0,
  discount          NUMERIC NOT NULL DEFAULT 0,
  subtotal          NUMERIC NOT NULL DEFAULT 0,
  tax               NUMERIC NOT NULL DEFAULT 0,
  total             NUMERIC NOT NULL DEFAULT 0,
  created_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE public.billing_stores    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_invoices  ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read billing data
CREATE POLICY "billing_stores_select"    ON public.billing_stores    FOR SELECT TO authenticated USING (true);
CREATE POLICY "billing_customers_select" ON public.billing_customers FOR SELECT TO authenticated USING (true);
CREATE POLICY "billing_invoices_select"  ON public.billing_invoices  FOR SELECT TO authenticated USING (true);

-- Authenticated users can insert/update/delete (billing is internal)
CREATE POLICY "billing_stores_write"    ON public.billing_stores    FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "billing_customers_write" ON public.billing_customers FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "billing_invoices_write"  ON public.billing_invoices  FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- ── Seed default MM-MART stores ──────────────────────────────
INSERT INTO public.billing_stores (id, name, sub, address, tel, zip) VALUES
  ('mm_kita_otsuka',  'MM-MART', 'Kita Otsuka',   '東京都豊島区北大塚3-32-3(201)',           '03-6903-6174', '170-0004'),
  ('mm_takadano',     'MM-MART', 'Takadano Baba', '東京都新宿区高田馬場4丁目9-14 岩ビル1階', '03-6768-0683', '169-0075'),
  ('mm_minami',       'MM-MART', 'Minami Otsuka', '東京都豊島区南大塚',                       '',             '170-0005'),
  ('mm_higashi_jujo', 'MM-MART', 'Higashi Jujo',  '東京都北区東十条',                         '',             '114-0003'),
  ('mm_sugamo',       'MM-MART', 'Sugamo',        '東京都豊島区巣鴨',                         '',             '170-0002'),
  ('mm_kawaguchi',    'MM-MART', 'Kawaguchi',     '埼玉県川口市',                             '',             '332-0000'),
  ('mm_komagome',     'MM-MART', 'Komagome',      '東京都豊島区駒込',                         '',             '170-0003')
ON CONFLICT (id) DO NOTHING;
