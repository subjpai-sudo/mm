
-- Seed demo users directly so the one-click demo login works without signup.
DO $$
DECLARE
  demo_password text := 'demo12345';
  hashed text := crypt(demo_password, gen_salt('bf'));
  admin_id uuid := '11111111-1111-1111-1111-111111111111';
  oper_id  uuid := '22222222-2222-2222-2222-222222222222';
  owner_id uuid := '33333333-3333-3333-3333-333333333333';
BEGIN
  -- Admin
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', admin_id, 'authenticated', 'authenticated',
    'admin@demo.app', hashed, now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name','Demo Admin','role','admin'),
    now(), now(), '', '', '', ''
  ) ON CONFLICT (id) DO UPDATE SET encrypted_password = EXCLUDED.encrypted_password, email_confirmed_at = now();

  INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  VALUES (gen_random_uuid(), admin_id,
    jsonb_build_object('sub', admin_id::text, 'email', 'admin@demo.app', 'email_verified', true),
    'email', admin_id::text, now(), now(), now())
  ON CONFLICT (provider, provider_id) DO NOTHING;

  -- Operator
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', oper_id, 'authenticated', 'authenticated',
    'operator@demo.app', hashed, now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name','Demo Operator','role','operator'),
    now(), now(), '', '', '', ''
  ) ON CONFLICT (id) DO UPDATE SET encrypted_password = EXCLUDED.encrypted_password, email_confirmed_at = now();

  INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  VALUES (gen_random_uuid(), oper_id,
    jsonb_build_object('sub', oper_id::text, 'email', 'operator@demo.app', 'email_verified', true),
    'email', oper_id::text, now(), now(), now())
  ON CONFLICT (provider, provider_id) DO NOTHING;

  -- Owner
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', owner_id, 'authenticated', 'authenticated',
    'owner@demo.app', hashed, now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name','Demo Owner','role','owner'),
    now(), now(), '', '', '', ''
  ) ON CONFLICT (id) DO UPDATE SET encrypted_password = EXCLUDED.encrypted_password, email_confirmed_at = now();

  INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  VALUES (gen_random_uuid(), owner_id,
    jsonb_build_object('sub', owner_id::text, 'email', 'owner@demo.app', 'email_verified', true),
    'email', owner_id::text, now(), now(), now())
  ON CONFLICT (provider, provider_id) DO NOTHING;

  -- Ensure profiles exist (trigger may have already inserted; upsert to be safe)
  INSERT INTO public.profiles (id, email, full_name) VALUES
    (admin_id, 'admin@demo.app', 'Demo Admin'),
    (oper_id, 'operator@demo.app', 'Demo Operator'),
    (owner_id, 'owner@demo.app', 'Demo Owner')
  ON CONFLICT (id) DO NOTHING;

  -- Ensure correct roles (trigger inserts 'operator' by default; force right role)
  DELETE FROM public.user_roles WHERE user_id IN (admin_id, oper_id, owner_id);
  INSERT INTO public.user_roles (user_id, role) VALUES
    (admin_id, 'admin'),
    (oper_id, 'operator'),
    (owner_id, 'owner');
END $$;
