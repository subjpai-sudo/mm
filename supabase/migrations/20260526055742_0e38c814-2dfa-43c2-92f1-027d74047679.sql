
-- backup_log: allow owner read
DROP POLICY IF EXISTS "backup log admin read" ON public.backup_log;
CREATE POLICY "backup log admin or owner read" ON public.backup_log
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'owner'::app_role));

-- mirror_sync_log: allow owner read
DROP POLICY IF EXISTS "mirror log admin read" ON public.mirror_sync_log;
CREATE POLICY "mirror log admin or owner read" ON public.mirror_sync_log
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'owner'::app_role));

-- app_settings: allow owner write
DROP POLICY IF EXISTS "settings admin write" ON public.app_settings;
CREATE POLICY "settings admin or owner write" ON public.app_settings
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'owner'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'owner'::app_role));

-- user_roles: allow owner to manage roles
DROP POLICY IF EXISTS "admins manage roles" ON public.user_roles;
CREATE POLICY "admins or owners manage roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'owner'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'owner'::app_role));
