DELETE FROM public.stock_movements;
UPDATE public.order_requests SET product_id=NULL, category_id=NULL;
DELETE FROM public.products;
DELETE FROM public.categories;