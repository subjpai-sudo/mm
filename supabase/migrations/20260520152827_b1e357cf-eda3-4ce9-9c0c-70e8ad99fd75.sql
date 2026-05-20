
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS brand text,
  ADD COLUMN IF NOT EXISTS origin text,
  ADD COLUMN IF NOT EXISTS size text,
  ADD COLUMN IF NOT EXISTS pcs_per_case integer,
  ADD COLUMN IF NOT EXISTS price_10 numeric,
  ADD COLUMN IF NOT EXISTS price_case numeric;

CREATE UNIQUE INDEX IF NOT EXISTS products_sku_unique ON public.products (sku) WHERE sku IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS products_barcode_unique ON public.products (barcode) WHERE barcode IS NOT NULL;
