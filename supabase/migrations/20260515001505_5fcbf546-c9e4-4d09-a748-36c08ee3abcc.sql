-- Seed built-in admin & owner login accounts
do $$
declare
  v_admin_id uuid;
  v_owner_id uuid;
  v_pw text := crypt('12345678', gen_salt('bf'));
begin
  -- ADMIN
  select id into v_admin_id from auth.users where email = 'admin@stockflow.local';
  if v_admin_id is null then
    v_admin_id := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, is_super_admin, confirmation_token,
      email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_admin_id, 'authenticated', 'authenticated',
      'admin@stockflow.local', v_pw, now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Admin","role":"admin"}'::jsonb,
      false, '', '', '', ''
    );
    insert into auth.identities (id, user_id, identity_data, provider, provider_id, created_at, updated_at, last_sign_in_at)
    values (gen_random_uuid(), v_admin_id,
      jsonb_build_object('sub', v_admin_id::text, 'email', 'admin@stockflow.local'),
      'email', v_admin_id::text, now(), now(), now());
  else
    update auth.users set encrypted_password = v_pw, email_confirmed_at = coalesce(email_confirmed_at, now()) where id = v_admin_id;
  end if;

  insert into public.profiles (id, email, full_name) values (v_admin_id, 'admin@stockflow.local', 'Admin')
    on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;
  delete from public.user_roles where user_id = v_admin_id;
  insert into public.user_roles (user_id, role) values (v_admin_id, 'admin');

  -- OWNER
  select id into v_owner_id from auth.users where email = 'owner@stockflow.local';
  if v_owner_id is null then
    v_owner_id := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, is_super_admin, confirmation_token,
      email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_owner_id, 'authenticated', 'authenticated',
      'owner@stockflow.local', v_pw, now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Owner","role":"owner"}'::jsonb,
      false, '', '', '', ''
    );
    insert into auth.identities (id, user_id, identity_data, provider, provider_id, created_at, updated_at, last_sign_in_at)
    values (gen_random_uuid(), v_owner_id,
      jsonb_build_object('sub', v_owner_id::text, 'email', 'owner@stockflow.local'),
      'email', v_owner_id::text, now(), now(), now());
  else
    update auth.users set encrypted_password = v_pw, email_confirmed_at = coalesce(email_confirmed_at, now()) where id = v_owner_id;
  end if;

  insert into public.profiles (id, email, full_name) values (v_owner_id, 'owner@stockflow.local', 'Owner')
    on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;
  delete from public.user_roles where user_id = v_owner_id;
  insert into public.user_roles (user_id, role) values (v_owner_id, 'owner');
end $$;