
DROP POLICY IF EXISTS "settings read" ON public.app_settings;
CREATE POLICY "settings admin or owner read"
  ON public.app_settings
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'owner'::app_role));

DROP POLICY IF EXISTS "movements read" ON public.stock_movements;
CREATE POLICY "movements staff read"
  ON public.stock_movements
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'operator'::app_role)
    OR public.has_role(auth.uid(), 'owner'::app_role)
  );

REVOKE SELECT ON public.profiles FROM authenticated;
GRANT SELECT (id, full_name, avatar_url, created_at, must_change_pin) ON public.profiles TO authenticated;
GRANT UPDATE ON public.profiles TO authenticated;
GRANT INSERT ON public.profiles TO authenticated;

UPDATE storage.buckets SET public = false WHERE id = 'reports';
DROP POLICY IF EXISTS "reports are publicly readable" ON storage.objects;
CREATE POLICY "reports admin or owner read"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'reports'
    AND (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'owner'::app_role))
  );
