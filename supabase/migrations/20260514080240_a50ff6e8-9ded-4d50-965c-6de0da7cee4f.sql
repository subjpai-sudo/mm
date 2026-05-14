
-- Allow owner role to do stock in/out
DROP POLICY IF EXISTS "movements insert admin/operator" ON public.stock_movements;
CREATE POLICY "movements insert any role"
ON public.stock_movements
FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'operator'::app_role)
  OR has_role(auth.uid(), 'owner'::app_role)
);

-- Add image_url column for product pictures
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS image_url text;

-- Storage bucket for product pictures
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
DROP POLICY IF EXISTS "product images public read" ON storage.objects;
CREATE POLICY "product images public read"
ON storage.objects FOR SELECT
USING (bucket_id = 'product-images');

DROP POLICY IF EXISTS "product images authenticated write" ON storage.objects;
CREATE POLICY "product images authenticated write"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'product-images');

DROP POLICY IF EXISTS "product images authenticated update" ON storage.objects;
CREATE POLICY "product images authenticated update"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'product-images');

DROP POLICY IF EXISTS "product images authenticated delete" ON storage.objects;
CREATE POLICY "product images authenticated delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'product-images');
