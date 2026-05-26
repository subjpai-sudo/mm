
-- Create demo users for one-tap demo login
do $$
declare
  v_admin_id uuid;
  v_operator_id uuid;
  v_owner_id uuid;
  v_now timestamptz := now();
  v_pw text := crypt('demo12345', gen_salt('bf'));
begin
  -- ADMIN
  if not exists (select 1 from auth.users where email = 'admin@demo.app') then
    v_admin_id := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_admin_id, 'authenticated', 'authenticated',
      'admin@demo.app', v_pw, v_now,
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Demo Admin","role":"admin"}'::jsonb,
      v_now, v_now, '', '', '', ''
    );
    insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_admin_id,
      jsonb_build_object('sub', v_admin_id::text, 'email', 'admin@demo.app', 'email_verified', true),
      'email', v_admin_id::text, v_now, v_now, v_now);
    -- ensure role row exists with 'admin' (handle_new_user trigger may have inserted 'operator')
    delete from public.user_roles where user_id = v_admin_id;
    insert into public.user_roles (user_id, role) values (v_admin_id, 'admin');
  end if;

  -- OPERATOR
  if not exists (select 1 from auth.users where email = 'operator@demo.app') then
    v_operator_id := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_operator_id, 'authenticated', 'authenticated',
      'operator@demo.app', v_pw, v_now,
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Demo Operator","role":"operator"}'::jsonb,
      v_now, v_now, '', '', '', ''
    );
    insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_operator_id,
      jsonb_build_object('sub', v_operator_id::text, 'email', 'operator@demo.app', 'email_verified', true),
      'email', v_operator_id::text, v_now, v_now, v_now);
    delete from public.user_roles where user_id = v_operator_id;
    insert into public.user_roles (user_id, role) values (v_operator_id, 'operator');
  end if;

  -- OWNER
  if not exists (select 1 from auth.users where email = 'owner@demo.app') then
    v_owner_id := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_owner_id, 'authenticated', 'authenticated',
      'owner@demo.app', v_pw, v_now,
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Demo Owner","role":"owner"}'::jsonb,
      v_now, v_now, '', '', '', ''
    );
    insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_owner_id,
      jsonb_build_object('sub', v_owner_id::text, 'email', 'owner@demo.app', 'email_verified', true),
      'email', v_owner_id::text, v_now, v_now, v_now);
    delete from public.user_roles where user_id = v_owner_id;
    insert into public.user_roles (user_id, role) values (v_owner_id, 'owner');
  end if;
end $$;
