ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS barcode_registered_by uuid,
  ADD COLUMN IF NOT EXISTS barcode_registered_at timestamptz;