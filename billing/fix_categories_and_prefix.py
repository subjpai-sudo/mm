"""Fix duplicate Myanmar subcategories and rename prefixes to TM/IM/HM/MM."""
import sqlite3, json, os, re

DB = os.path.join(os.path.dirname(__file__), 'billing.db')
conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row

# ── 1. Delete zero-product duplicate subcategories under Myanmar ──────────────
dupes = conn.execute("""
    SELECT c.id, c.name FROM categories c
    WHERE c.parent_id = 4
      AND (SELECT COUNT(*) FROM products WHERE category_id = c.id) = 0
      AND c.name IN (
          SELECT c2.name FROM categories c2 WHERE c2.parent_id != 4
      )
""").fetchall()

for d in dupes:
    conn.execute('DELETE FROM categories WHERE id=?', (d['id'],))
    print(f'  Deleted duplicate: {d["name"]} (id={d["id"]})')

# Also delete the catch-all "Myanmar" subcategory (0 products, name=main category)
conn.execute("""
    DELETE FROM categories WHERE parent_id=4 AND name='Myanmar'
      AND (SELECT COUNT(*) FROM products WHERE category_id=id) = 0
""")
conn.commit()
print(f'Removed {len(dupes)} duplicate subcategories')

# ── 2. Rename SKU prefixes Tm→TM, Im→IM, Hm→HM, Mm→MM ──────────────────────
renames = [('Tm', 'TM'), ('Im', 'IM'), ('Hm', 'HM'), ('Mm', 'MM')]
total_renamed = 0

for old_pfx, new_pfx in renames:
    # Use temp prefix to avoid collisions
    conn.execute(f"UPDATE products SET sku=('_TMP_'||sku) WHERE sku GLOB '{old_pfx}[0-9]*'")
    conn.commit()
    conn.execute(f"UPDATE products SET sku=('{new_pfx}'||SUBSTR(sku,7)) WHERE sku LIKE '_TMP_{old_pfx}%'")
    conn.commit()
    n = conn.execute(f"SELECT COUNT(*) FROM products WHERE sku GLOB '{new_pfx}[0-9]*'").fetchone()[0]
    total_renamed += n
    print(f'  {old_pfx} → {new_pfx}: {n} products')

# ── 3. Update category sku_prefix ────────────────────────────────────────────
conn.execute("UPDATE categories SET sku_prefix='TM' WHERE parent_id=1")
conn.execute("UPDATE categories SET sku_prefix='IM' WHERE parent_id=2")
conn.execute("UPDATE categories SET sku_prefix='HM' WHERE parent_id=3")
conn.execute("UPDATE categories SET sku_prefix='MM' WHERE parent_id=4")
conn.commit()
print(f'Updated category sku_prefix values')

# ── 4. Also update fb_no for MM products ─────────────────────────────────────
conn.execute("""
    UPDATE products SET fb_no = CAST(SUBSTR(sku, 3) AS INTEGER)
    WHERE sku GLOB 'MM[0-9]*' AND (fb_no IS NULL OR fb_no = 0)
""")
conn.commit()

# ── 5. Update invoice items JSON ─────────────────────────────────────────────
pfx_map = {'Tm': 'TM', 'Im': 'IM', 'Hm': 'HM', 'Mm': 'MM'}
invoices = conn.execute('SELECT id, items FROM invoices WHERE items IS NOT NULL').fetchall()
inv_updated = 0
for inv in invoices:
    try:
        items = json.loads(inv['items'] or '[]')
        changed = False
        for item in items:
            sku = item.get('sku', '')
            for old, new in pfx_map.items():
                if sku.startswith(old) and sku[2:].isdigit():
                    item['sku'] = new + sku[2:]
                    changed = True
                    break
        if changed:
            conn.execute('UPDATE invoices SET items=? WHERE id=?', (json.dumps(items), inv['id']))
            inv_updated += 1
    except Exception as e:
        print(f'  Invoice {inv["id"]} warning: {e}')
conn.commit()
print(f'Updated {inv_updated} invoices')

# ── 6. Verify ─────────────────────────────────────────────────────────────────
print('\nFinal state:')
for pfx, name in [('TM','Thailand'),('IM','Indonesia'),('HM','Asian Halal'),('MM','Myanmar')]:
    cnt = conn.execute(f"SELECT COUNT(*) FROM products WHERE sku GLOB '{pfx}[0-9]*'").fetchone()[0]
    print(f'  {name} ({pfx}): {cnt} products')

print('\nSubcategories per main:')
for main_name in ['Thailand','Indonesia','Asian Halal','Myanmar']:
    subs = conn.execute("""
        SELECT c.name FROM categories c
        JOIN categories pm ON c.parent_id=pm.id
        WHERE pm.name=? ORDER BY c.sort_order, c.name
    """, (main_name,)).fetchall()
    print(f'  {main_name}: {[s["name"] for s in subs]}')

old_remain = conn.execute(
    "SELECT COUNT(*) FROM products WHERE sku GLOB 'Tm[0-9]*' OR sku GLOB 'Im[0-9]*' OR sku GLOB 'Hm[0-9]*' OR sku GLOB 'Mm[0-9]*'"
).fetchone()[0]
print(f'\nOld mixed-case SKUs remaining: {old_remain}')
conn.close()
print('\nDone!')
