INSERT INTO public.categories (name) VALUES ('Myanmar Vendor') ON CONFLICT DO NOTHING;
DELETE FROM public.products WHERE category_id IS NULL;