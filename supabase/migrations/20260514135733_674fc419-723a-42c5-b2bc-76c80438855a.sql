ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS infobip_base_url text,
  ADD COLUMN IF NOT EXISTS viber_sender text,
  ADD COLUMN IF NOT EXISTS owner_phone text;