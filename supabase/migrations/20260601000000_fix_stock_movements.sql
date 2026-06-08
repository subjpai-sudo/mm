-- Fix 1: Add 'manager' to app_role enum (was missing, causing type errors in RLS policies)
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'manager';

-- Fix 2: Make the stock trigger SECURITY DEFINER so it can always update product stock
-- regardless of the calling user's RLS permissions on products
CREATE OR REPLACE FUNCTION public.apply_stock_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.type = 'in' THEN
    UPDATE public.products SET stock = stock + NEW.quantity, updated_at = NOW() WHERE id = NEW.product_id;
  ELSE
    UPDATE public.products SET stock = GREATEST(0, stock - NEW.quantity), updated_at = NOW() WHERE id = NEW.product_id;
  END IF;
  RETURN NEW;
END;
$$;

-- Fix 3: Rebuild products write policy with proper enum casts including manager
DROP POLICY IF EXISTS "products write staff" ON public.products;
CREATE POLICY "products write staff" ON public.products FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'operator'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
    OR public.has_role(auth.uid(), 'owner'::public.app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'operator'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
    OR public.has_role(auth.uid(), 'owner'::public.app_role)
  );

-- Fix 4: Add manager to movements insert policy
DROP POLICY IF EXISTS "movements insert any role" ON public.stock_movements;
CREATE POLICY "movements insert any role" ON public.stock_movements FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'operator'::public.app_role)
    OR public.has_role(auth.uid(), 'owner'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );

-- Fix 5: Add manager to movements read policy
DROP POLICY IF EXISTS "movements staff read" ON public.stock_movements;
CREATE POLICY "movements staff read" ON public.stock_movements FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'operator'::public.app_role)
    OR public.has_role(auth.uid(), 'owner'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );

-- Fix 6: Rebuild categories write policy to include manager
-- (Without this, 'manager' enum value missing causes has_role to error for ALL users including admin)
DROP POLICY IF EXISTS "categories write all roles" ON public.categories;
DROP POLICY IF EXISTS "categories write admin/operator" ON public.categories;
CREATE POLICY "categories write all roles" ON public.categories FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'operator'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
    OR public.has_role(auth.uid(), 'owner'::public.app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'operator'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
    OR public.has_role(auth.uid(), 'owner'::public.app_role)
  );
