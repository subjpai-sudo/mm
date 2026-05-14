DROP POLICY IF EXISTS "products write admin/operator" ON public.products;
CREATE POLICY "products write all roles" ON public.products FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role) OR has_role(auth.uid(), 'owner'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role) OR has_role(auth.uid(), 'owner'::app_role));

DROP POLICY IF EXISTS "categories write admin/operator" ON public.categories;
CREATE POLICY "categories write all roles" ON public.categories FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role) OR has_role(auth.uid(), 'owner'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role) OR has_role(auth.uid(), 'owner'::app_role));