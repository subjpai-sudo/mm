-- Add 18 new products from updated City Star catalog (Apr 2026)
-- Categories Sein Pa Laung and Yummy were already created via API

DO $$
DECLARE
  tomo_id uuid;
  a1_id uuid;
  sein_id uuid;
  yummy_id uuid;
BEGIN
  SELECT id INTO tomo_id FROM categories WHERE name = 'TOMO' LIMIT 1;
  SELECT id INTO a1_id FROM categories WHERE name = 'A1 Family' LIMIT 1;
  SELECT id INTO sein_id FROM categories WHERE name = 'Sein Pa Laung' LIMIT 1;
  SELECT id INTO yummy_id FROM categories WHERE name = 'Yummy' LIMIT 1;

  INSERT INTO products (name, sku, brand, origin, size, unit, pcs_per_case, price, price_10, price_case, category_id, stock, low_stock_threshold)
  VALUES
    ('TOMO Fried Fish Sauce 80g',              'MM188', 'TOMO',          'Myanmar', '80',  'g', 250, 550, 450, 350, tomo_id,  0, 5),
    ('Sein Pa Laung Tea Leaves (Non Spicy) 246g','MM189','Sein Pa Laung', 'Myanmar', '246', 'g',  60, 950, NULL, NULL, sein_id, 0, 5),
    ('Sein Pa Laung Tea Leaves (Spicy) 246g',  'MM190', 'Sein Pa Laung', 'Myanmar', '246', 'g',  60, 950, NULL, NULL, sein_id, 0, 5),
    ('Sein Pa Laung Tea Leaves (Shu Shae) 246g','MM191','Sein Pa Laung', 'Myanmar', '246', 'g',  60, 950, NULL, NULL, sein_id, 0, 5),
    ('Sein Pa Laung Tea Leaves (Non Spicy) 150g','MM192','Sein Pa Laung','Myanmar', '150', 'g', 100, 550, 450, 350, sein_id, 0, 5),
    ('Sein Pa Laung Tea Leaves (Spicy) 150g',  'MM193', 'Sein Pa Laung', 'Myanmar', '150', 'g', 100, 550, 450, 350, sein_id, 0, 5),
    ('Sein Pa Laung Tea Leaves (Shu Shae) 150g','MM194','Sein Pa Laung', 'Myanmar', '150', 'g', 100, 550, 450, 350, sein_id, 0, 5),
    ('Pure Turmeric Powder 90g',               'MM195', 'A1 Family',    'Myanmar',  '90', 'g', 100, 250, 200, 150, a1_id,   0, 5),
    ('Premium Chilli Powder Hot 90g',          'MM196', 'A1 Family',    'Myanmar',  '90', 'g', 100, 300, 232, 186, a1_id,   0, 5),
    ('Curry Powder Masala 90g',                'MM197', 'A1 Family',    'Myanmar',  '90', 'g', 100, 300, 250, 200, a1_id,   0, 5),
    ('BBQ Mala Seasoning Powder 80g',          'MM198', 'A1 Family',    'Myanmar',  '80', 'g', 200, 350, 300, 250, a1_id,   0, 5),
    ('Mala Xian Guo Paste 80g',                'MM199', 'Yummy',        'Myanmar',  '80', 'g', 250, 350, 300, 250, yummy_id, 0, 5),
    ('Mala Hot Pot Paste 80g',                 'MM200', 'Yummy',        'Myanmar',  '80', 'g', 250, 350, 300, 250, yummy_id, 0, 5),
    ('Mala Mouk Chike Paste 80g',              'MM201', 'Yummy',        'Myanmar',  '80', 'g', 250, 350, 300, 250, yummy_id, 0, 5),
    ('Mala Paste 80g',                         'MM202', 'Yummy',        'Myanmar',  '80', 'g', 250, 350, 300, 250, yummy_id, 0, 5),
    ('A1 Premium Chilli Flakes 400g',          'MM203', 'A1 Family',    'Myanmar', '400', 'g',  40, 850, 650, 500, a1_id,   0, 5),
    ('Fried Garlic 160g',                      'MM204', 'A1 Family',    'Myanmar', '160', 'g', 120, 450, NULL, 250, a1_id,   0, 5),
    ('Fried Onion 160g',                       'MM205', 'A1 Family',    'Myanmar', '160', 'g',  90, 350, 300, 250, a1_id,   0, 5)
  ON CONFLICT (sku) DO NOTHING;

END $$;
