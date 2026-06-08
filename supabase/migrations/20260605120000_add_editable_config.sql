-- Editable runtime config: keys + notification preferences.
-- Stored on the single-row app_settings table (id=1).
-- RLS on app_settings is already admin/owner-only for both read and write,
-- so these key columns are never readable by non-admins.

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS strich_license_key  text,
  ADD COLUMN IF NOT EXISTS gemini_api_key      text,
  ADD COLUMN IF NOT EXISTS anthropic_api_key   text,
  ADD COLUMN IF NOT EXISTS firebase_config     jsonb,
  ADD COLUMN IF NOT EXISTS notify_low_stock    boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_out_of_stock boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_new_order    boolean NOT NULL DEFAULT true;
