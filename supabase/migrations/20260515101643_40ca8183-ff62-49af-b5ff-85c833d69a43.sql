
-- Create public storage bucket for shareable PDF reports
insert into storage.buckets (id, name, public)
values ('reports', 'reports', true)
on conflict (id) do update set public = true;

-- Allow authenticated owners/admins to upload reports
create policy "owners and admins upload reports"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'reports'
  and (public.has_role(auth.uid(), 'admin'::public.app_role)
       or public.has_role(auth.uid(), 'owner'::public.app_role))
);

create policy "owners and admins update reports"
on storage.objects for update
to authenticated
using (
  bucket_id = 'reports'
  and (public.has_role(auth.uid(), 'admin'::public.app_role)
       or public.has_role(auth.uid(), 'owner'::public.app_role))
);

create policy "owners and admins delete reports"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'reports'
  and (public.has_role(auth.uid(), 'admin'::public.app_role)
       or public.has_role(auth.uid(), 'owner'::public.app_role))
);

create policy "reports are publicly readable"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'reports');
