"""Rename all product SKUs to the new format: Tm, Im, Hm, Mm."""
import sqlite3, json, os

DB = os.path.join(os.path.dirname(__file__), 'billing.db')
conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row

# ── 1. Clean up garbage products ─────────────────────────────────────────────
deleted = conn.execute(
    "DELETE FROM products WHERE name='New Product' OR sku='none'"
).rowcount
conn.commit()
print(f'Removed {deleted} empty/invalid products')

# ── 2. Add fb_no column (for Myanmar Firebase mapping) ────────────────────────
try:
    conn.execute('ALTER TABLE products ADD COLUMN fb_no INTEGER')
    conn.commit()
    print('Added fb_no column')
except Exception:
    print('fb_no column already exists')

# Set fb_no for MM0xxx products → their product number in Lovable
conn.execute("""
    UPDATE products SET fb_no = CAST(SUBSTR(sku, 3) AS INTEGER)
    WHERE sku GLOB 'MM[0-9]*' AND (fb_no IS NULL OR fb_no = 0)
""")
conn.commit()
print(f'Set fb_no for MM products')

# ── 3. Build old → new SKU mapping ───────────────────────────────────────────
# Thailand: sub sort_order 0→5 (A1Thai→ABC), then sku asc → Tm1…Tm217
# Indonesia: sub sort_order 0→1 (Dobar→MY ANH), then sku asc → Im1…Im60
# Asian Halal: sub sort_order 0→1 (AMBIKA→SARTAJ), then sku asc → Hm1…Hm136
# Myanmar: MM0xxx by sku (numeric order), then FR0xxx → Mm1…Mm197

prefix_map = {1: 'Tm', 2: 'Im', 3: 'Hm', 4: 'Mm'}
old_to_new = {}

for main_id, pfx in prefix_map.items():
    if main_id != 4:
        rows = conn.execute("""
            SELECT p.sku FROM products p
            JOIN categories c ON p.category_id = c.id
            WHERE c.parent_id = ?
            ORDER BY c.sort_order, p.sku
        """, (main_id,)).fetchall()
    else:
        # Myanmar: MM0xxx first (numeric), then FR0xxx, then others
        mm_rows = conn.execute("""
            SELECT p.sku FROM products p
            JOIN categories c ON p.category_id = c.id
            WHERE c.parent_id = 4 AND p.sku GLOB 'MM[0-9]*'
            ORDER BY CAST(SUBSTR(p.sku, 3) AS INTEGER)
        """).fetchall()
        fr_rows = conn.execute("""
            SELECT p.sku FROM products p
            JOIN categories c ON p.category_id = c.id
            WHERE c.parent_id = 4 AND p.sku GLOB 'FR[0-9]*'
            ORDER BY p.sku
        """).fetchall()
        other_rows = conn.execute("""
            SELECT p.sku FROM products p
            JOIN categories c ON p.category_id = c.id
            WHERE c.parent_id = 4 AND p.sku NOT GLOB 'MM[0-9]*' AND p.sku NOT GLOB 'FR[0-9]*'
            ORDER BY p.sku
        """).fetchall()
        rows = mm_rows + fr_rows + other_rows

    for i, row in enumerate(rows, 1):
        old_to_new[row['sku']] = f'{pfx}{i}'

print(f'\nRename mapping preview:')
# Show first 3 and last 3 per category
for main_id, pfx in prefix_map.items():
    entries = [(k, v) for k, v in old_to_new.items() if v.startswith(pfx)]
    print(f'  {pfx}: {entries[0][0]}→{entries[0][1]}, {entries[1][0]}→{entries[1][1]}  ...  {entries[-2][0]}→{entries[-2][1]}, {entries[-1][0]}→{entries[-1][1]}  (total {len(entries)})')

# ── 4. Execute rename ─────────────────────────────────────────────────────────
# Use a temp prefix to avoid collisions during rename
print('\nRenaming products...')
for old, new in old_to_new.items():
    conn.execute('UPDATE products SET sku=? WHERE sku=?', ('_tmp_' + new, old))
conn.commit()
for old, new in old_to_new.items():
    conn.execute('UPDATE products SET sku=? WHERE sku=?', (new, '_tmp_' + new))
conn.commit()
print(f'  Renamed {len(old_to_new)} products')

# ── 5. Update Myanmar fb_no for new SKUs ─────────────────────────────────────
# For Mm1-Mm187, fb_no should be 1-187 (already set from MM0xxx)
# For Mm188+ (FR0xxx renamed), fb_no is NULL — set it to match new number
conn.execute("""
    UPDATE products SET fb_no = CAST(SUBSTR(sku, 3) AS INTEGER)
    WHERE sku GLOB 'Mm[0-9]*' AND (fb_no IS NULL OR fb_no = 0)
""")
conn.commit()

# ── 6. Update invoice item references ────────────────────────────────────────
print('Updating invoice items...')
invoices = conn.execute('SELECT id, items FROM invoices WHERE items IS NOT NULL').fetchall()
updated_invoices = 0
for inv in invoices:
    try:
        items = json.loads(inv['items'] or '[]')
        changed = False
        for item in items:
            if item.get('sku') in old_to_new:
                item['sku'] = old_to_new[item['sku']]
                changed = True
        if changed:
            conn.execute('UPDATE invoices SET items=? WHERE id=?', (json.dumps(items), inv['id']))
            updated_invoices += 1
    except Exception as e:
        print(f'  Warning: invoice {inv["id"]}: {e}')
conn.commit()
print(f'  Updated {updated_invoices} invoices')

# ── 7. Verify ─────────────────────────────────────────────────────────────────
print('\nFinal counts:')
for pfx, name in [('Tm', 'Thailand'), ('Im', 'Indonesia'), ('Hm', 'Asian Halal'), ('Mm', 'Myanmar')]:
    cnt = conn.execute(f"SELECT COUNT(*) FROM products WHERE sku GLOB '{pfx}[0-9]*'").fetchone()[0]
    print(f'  {name} ({pfx}): {cnt} products')

remaining_old = conn.execute(
    "SELECT COUNT(*) FROM products WHERE sku GLOB 'AT[0-9]*' OR sku GLOB 'LT[0-9]*' OR sku GLOB 'MM[0-9]*'"
).fetchone()[0]
print(f'  Old-format SKUs remaining: {remaining_old}')

conn.close()
print('\nMigration complete!')
