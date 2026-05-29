-- ============================================================
-- Add 'manager' role — run in Supabase SQL Editor
-- ============================================================

-- Extend the enum (safe to run; no-op if already exists)
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'manager';
