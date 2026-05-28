ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS rack text,
  ADD COLUMN IF NOT EXISTS shelf text CHECK (shelf IN ('upper','mid','down'));

CREATE INDEX IF NOT EXISTS idx_products_rack ON public.products(rack);