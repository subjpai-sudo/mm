-- ============================================================
-- SCHEMA FOR NEW SUPABASE PROJECT
-- Run this FIRST in the SQL Editor of the new project
-- ============================================================

-- ── Enums ────────────────────────────────────────────────────
CREATE TYPE public.app_role      AS ENUM ('admin', 'operator', 'owner');
CREATE TYPE public.movement_type AS ENUM ('in', 'out');
CREATE TYPE public.order_status  AS ENUM ('pending', 'approved', 'declined', 'backordered');
CREATE TYPE public.order_type    AS ENUM ('restock', 'new_order');

-- ── app_settings ─────────────────────────────────────────────
CREATE TABLE public.app_settings (
  id                BIGINT PRIMARY KEY DEFAULT 1,
  viber_bot_token   TEXT,
  viber_owner_id    TEXT,
  viber_webhook_url TEXT,
  viber_sender      TEXT,
  infobip_base_url  TEXT,
  owner_phone       TEXT,
  twilio_from       TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── categories ───────────────────────────────────────────────
CREATE TABLE public.categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  parent_id  UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── racks ────────────────────────────────────────────────────
CREATE TABLE public.racks (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code       TEXT NOT NULL UNIQUE,
  name       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── products ─────────────────────────────────────────────────
CREATE TABLE public.products (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku                   TEXT,
  barcode               TEXT,
  barcode_registered_by TEXT,
  barcode_registered_at TIMESTAMPTZ,
  name                  TEXT NOT NULL,
  brand                 TEXT,
  origin                TEXT,
  size                  TEXT,
  unit                  TEXT,
  category_id           UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  price                 NUMERIC NOT NULL DEFAULT 0,
  price_10              NUMERIC,
  price_case            NUMERIC,
  pcs_per_case          INTEGER,
  stock                 INTEGER NOT NULL DEFAULT 0,
  low_stock_threshold   INTEGER NOT NULL DEFAULT 5,
  last_alert_stock      INTEGER,
  rack                  TEXT,
  shelf                 TEXT,
  image_url             TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── profiles ─────────────────────────────────────────────────
CREATE TABLE public.profiles (
  id             UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email          TEXT,
  full_name      TEXT,
  phone          TEXT,
  avatar_url     TEXT,
  must_change_pin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── user_roles ───────────────────────────────────────────────
CREATE TABLE public.user_roles (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, role)
);

-- ── stock_movements ──────────────────────────────────────────
CREATE TABLE public.stock_movements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  type        public.movement_type NOT NULL,
  quantity    INTEGER NOT NULL,
  reason      TEXT,
  destination TEXT,
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── order_requests ───────────────────────────────────────────
CREATE TABLE public.order_requests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type                  public.order_type NOT NULL,
  product_name          TEXT NOT NULL,
  quantity              INTEGER NOT NULL,
  notes                 TEXT,
  viber_message         TEXT,
  status                public.order_status NOT NULL DEFAULT 'pending',
  created_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  product_id            UUID REFERENCES public.products(id) ON DELETE SET NULL,
  category_id           UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  container_date        DATE,
  expected_arrival_date DATE,
  arrived_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── audit_logs ───────────────────────────────────────────────
CREATE TABLE public.audit_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action       TEXT NOT NULL,
  actor_id     TEXT,
  actor_email  TEXT,
  target_id    TEXT,
  target_label TEXT,
  details      JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── backup_log ───────────────────────────────────────────────
CREATE TABLE public.backup_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status       TEXT NOT NULL DEFAULT 'pending',
  triggered_by TEXT NOT NULL,
  file_path    TEXT,
  size_bytes   BIGINT,
  error        TEXT,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at  TIMESTAMPTZ
);

-- ── mirror_sync_log ──────────────────────────────────────────
CREATE TABLE public.mirror_sync_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status       TEXT NOT NULL DEFAULT 'pending',
  triggered_by TEXT NOT NULL,
  rows_synced  JSONB,
  error        TEXT,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at  TIMESTAMPTZ
);

-- ── has_role function ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE public.profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.racks          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_log     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mirror_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings   ENABLE ROW LEVEL SECURITY;

-- profiles: users can read/update their own row
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id);

-- user_roles: users can read their own role
CREATE POLICY "user_roles_select_own" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- products: all authenticated users can read
CREATE POLICY "products_select_auth" ON public.products
  FOR SELECT TO authenticated USING (true);

-- categories: all authenticated users can read
CREATE POLICY "categories_select_auth" ON public.categories
  FOR SELECT TO authenticated USING (true);

-- racks: all authenticated users can read
CREATE POLICY "racks_select_auth" ON public.racks
  FOR SELECT TO authenticated USING (true);

-- stock_movements: all authenticated users can read
CREATE POLICY "stock_movements_select_auth" ON public.stock_movements
  FOR SELECT TO authenticated USING (true);

-- order_requests: all authenticated users can read
CREATE POLICY "order_requests_select_auth" ON public.order_requests
  FOR SELECT TO authenticated USING (true);

-- audit_logs: authenticated users can read
CREATE POLICY "audit_logs_select_auth" ON public.audit_logs
  FOR SELECT TO authenticated USING (true);

-- backup_log: authenticated users can read
CREATE POLICY "backup_log_select_auth" ON public.backup_log
  FOR SELECT TO authenticated USING (true);

-- mirror_sync_log: authenticated users can read
CREATE POLICY "mirror_sync_log_select_auth" ON public.mirror_sync_log
  FOR SELECT TO authenticated USING (true);

-- app_settings: authenticated users can read
CREATE POLICY "app_settings_select_auth" ON public.app_settings
  FOR SELECT TO authenticated USING (true);

-- NOTE: All INSERT/UPDATE/DELETE goes through server functions
-- which use the service_role key (bypasses RLS automatically).
