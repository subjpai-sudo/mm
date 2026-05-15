
-- 1. Extend order_status enum
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'backordered';

-- 2. Add shipment columns to order_requests
ALTER TABLE public.order_requests
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS container_date date,
  ADD COLUMN IF NOT EXISTS expected_arrival_date date,
  ADD COLUMN IF NOT EXISTS arrived_at timestamptz,
  ADD COLUMN IF NOT EXISTS decided_by uuid;

-- 3. Allow Owner to also manage order_requests (currently only admin)
DROP POLICY IF EXISTS "orders owner manage" ON public.order_requests;
CREATE POLICY "orders owner manage"
ON public.order_requests
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'owner'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'owner'::public.app_role));

-- 4. Realtime for order_requests is already managed by app; ensure included
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'order_requests'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.order_requests';
  END IF;
END $$;
