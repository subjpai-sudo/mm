
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS must_change_pin boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  insert into public.profiles (id, email, full_name, must_change_pin)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce((new.raw_user_meta_data->>'must_change_pin')::boolean, false)
  );
  insert into public.user_roles (user_id, role)
  values (new.id, coalesce((new.raw_user_meta_data->>'role')::public.app_role, 'operator'));
  return new;
end;
$function$;

-- Force seeded admin/owner to change PIN
UPDATE public.profiles
SET must_change_pin = true
WHERE email IN ('admin@stockflow.local', 'owner@stockflow.local');
