-- Add enable_ai_insights column to app_settings
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS enable_ai_insights boolean NOT NULL DEFAULT true;
