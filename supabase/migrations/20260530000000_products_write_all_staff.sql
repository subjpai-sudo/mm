-- Extend products write policy to all staff roles (manager + owner + admin + operator)
-- Previously only admin/operator could update products — manager couldn't assign racks

DROP POLICY IF EXISTS "products write admin/operator" ON public.products;

CREATE POLICY "products write staff"
  ON public.products
  FOR ALL
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'operator')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'owner')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'operator')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'owner')
  );
