# MM-MART Billing Server — Claude Context

## Project Overview
Flask billing server for MM-MART stores (Japan). Deployed on Google Cloud Run.
Firebase RTDB syncs product catalog (barcodes, prices, names) to billing DB.

- **Live URL**: https://billing-server-421265140321.asia-southeast1.run.app
- **Firebase Hosting**: https://mm-mart-live.web.app (catalog + CRM at root)
- **Cloud Run project**: `mm-mart-live`, region `asia-southeast1`
- **Latest revision**: `billing-server-00014-84x`

---

## Architecture

| Layer | Tech | Notes |
|-------|------|-------|
| Backend | Flask (Python) + Gunicorn | `app.py` |
| Database | SQLite (`billing.db`) | **Ephemeral on Cloud Run** — rebuilt fresh on every container start |
| Product source | Firebase RTDB | `mm-mart-live-default-rtdb.asia-southeast1.firebasedatabase.app/catalog` |
| Frontend | Single HTML file | `templates/index.html` — all JS/CSS inline |
| Container | Docker → Cloud Run | `--min-instances=1` keeps it always alive |
| Static hosting | Firebase Hosting | `firebase.json` in `/Users/anique/Documents/MM/` |

---

## Key Files

- `app.py` — Flask app, all API routes, DB init, Firebase sync logic
- `templates/index.html` — entire frontend (billing, catalog, history, settings, print)
- `Dockerfile` — container config
- `requirements.txt` — Python deps
- `/Users/anique/Documents/MM/firebase.json` — Firebase Hosting config (rewrites for `/catalog/**`, `/crm`, `/billing`)

---

## Database Schema (SQLite — rebuilt on each deploy)

```sql
products(sku, name, supplier, price, category_id, barcode, image_url, fb_no)
categories(id, name, parent_id)
stores(id, name, sub, address, tel, email, zip)
invoices(id, store_id, date, data_json, total, created_at)
```

> `billing.db` is **not** persistent across Cloud Run deploys. All data comes from Firebase RTDB at startup.

---

## SKU Format & Firebase Mapping

Products have prefixed SKUs. `_sku_to_no(sku)` converts to Firebase catalog number:

```python
_PREFIX_BASE = {'TM': 1000, 'IM': 2000, 'HM': 3000}
# TM5  → 1005   IM3  → 2003   HM10 → 3010
# MM products use fb_no column directly (not derived from SKU)
```

Firebase RTDB paths:
- `catalog/barcodes` — `{product_no: barcode_string}`
- `catalog/custom` — MM products full data
- `catalog/overrides` — price/name overrides

---

## Sync Logic

**Background sync** — runs every 5 seconds in a daemon thread (`_start_bg_sync()`).
**Inline sync** — also triggers on every `/api/products` request if >5s since last sync.
**Startup sequence** in `app.py`:
```python
init_db()
seed_categories()
seed_stores()          # seeds DEFAULT_STORES if table empty
load_products_if_empty()
sync_myanmar_catalog() # creates MM brand subcategories + assigns category_id
_start_bg_sync()
```

> `--min-instances=1` on Cloud Run prevents scale-to-zero killing background threads.

---

## Store / Shop System

Default stores seeded from `_DEFAULT_STORES` in `app.py` at startup. Stores are also loaded from DB via `/api/stores`.

**Stores API:**
- `GET /api/stores` — list all stores
- `POST /api/stores` — create new store (`{name, sub, branch, address, tel, email, zip}`)
- `DELETE /api/stores/<id>` — delete store

**Frontend**: `populateStoreDropdowns()` embeds full store object as `data-store` JSON on each `<option>` element. `doPrint()` reads directly from the selected option — no array lookup needed.

---

## Invoice Print / PDF

- `doPrint()` function in `index.html` (around line 1110) generates HTML invoice
- `#printOut` div is a **direct child of `<body>`** (not inside `#main-content`) — required for print CSS
- Print CSS: `@media print { body>*:not(.print-only){display:none!important} }`
- Stamp image is embedded as base64 `STAMP` constant in JS
- Store address reads from `opt.dataset.store` (JSON on the selected option element)

---

## Category System

| Prefix | Country |
|--------|---------|
| TM | Thailand |
| IM | Indonesia |
| HM | Asian Halal |
| MM | Myanmar |

Myanmar products get brand-based subcategories via `sync_myanmar_catalog()` at startup.
JS `getMainCat()` uses **uppercase** prefix matching (`'TM'`, `'IM'`, `'HM'`, `'MM'`).

---

## Deploying

```bash
# From /Users/anique/Documents/MM/billing-server/
gcloud run deploy billing-server --source . --region asia-southeast1 --project mm-mart-live --quiet
```

Check logs:
```bash
gcloud run services logs read billing-server --region asia-southeast1 --project mm-mart-live --limit 50
```

---

## Known Issues Fixed (history)

| Issue | Fix |
|-------|-----|
| Barcodes not syncing | `_sku_to_no()` mapping + inline sync on `/api/products` |
| Container dying (scale-to-zero) | `--min-instances=1` on Cloud Run |
| Myanmar category empty | `sync_myanmar_catalog()` called at startup |
| Country label wrong in price list | JS prefix was `'Mm'` not `'MM'` — fixed all 4 |
| Print area hidden | Moved `#printOut` to direct child of `<body>` |
| Store address missing in PDF | `populateStoreDropdowns()` now sets `data-store` JSON on `<option>`; `doPrint()` reads from `opt.dataset.store` |

---

## Product Images

### Myanmar products
Images already served from Lovable CDN — set automatically by `sync_myanmar_catalog()` at startup:
`https://artful-catalog-maker.lovable.app/products/product_NNN.jpg`

### Vendor folder images (TM / IM / HM products)
Images stored in GCS bucket: `gs://mm-mart-products/products/{SKU}.jpg`
Public URL: `https://storage.googleapis.com/mm-mart-products/products/{SKU}.jpg`

Image URLs are stored in Firebase RTDB at `catalog/images/{SKU}` and synced to billing DB on every `_pull_firebase_changes()` call (every 5s).

**Matching script**: `billing-server/match_upload_images.py`
- Uses OpenAI GPT-4o-mini vision to identify products from vendor photos
- Source folders in `/Users/anique/Documents/MM/` (one folder per vendor)
- Converts HEIC → JPEG via macOS `sips`, uploads to GCS, pushes to Firebase RTDB
- Run: `OPENAI_API_KEY=sk-... python3 match_upload_images.py`
- Dry run: add `--dry-run` flag
- Single vendor: add `--folder "A 1 Thai"` flag

**Vendor → DB supplier mapping:**
| Folder | DB supplier |
|--------|-------------|
| A 1 Thai | A1 Thai |
| ABC Company | ABC COMPANY |
| Ambika corporation | AMBIKA |
| Bompex Japan | BOMPEX JAPAN |
| Ichiba | ICHIBA |
| Imai Japan | IMAI JAPAN |
| Lifu Tou Thai | Lifu Tou |
| Sartaz Corporation | SARTAJ |
| Kara Indonasian | (not in DB yet) |
| Next International | (not in DB yet) |

## Twilio SMS

| Key | Value |
|-----|-------|
| Account SID | see `.env` / secret manager |
| Auth Token | see `.env` / secret manager |
| From number | +19893316329 |

Send SMS via REST:
```python
from twilio.rest import Client
client = Client(os.environ['TWILIO_ACCOUNT_SID'], os.environ['TWILIO_AUTH_TOKEN'])
client.messages.create(to='+81XXXXXXXXXX', from_='+19893316329', body='Your message')
```

Or raw HTTP:
```bash
curl -X POST https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/Messages.json \
  -u $TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN \
  -d "From=+19893316329" -d "To=+81XXXXXXXXXX" -d "Body=Hello from MM-MART"
```

Add `twilio` to `requirements.txt` before using the Python client.

---

## Related Projects

- **Catalog app**: `/Users/anique/artful-catalog-maker/` — React/Vite, Firebase hosted at `/catalog`
- **Firebase config**: `/Users/anique/Documents/MM/firebase.json`
- **Firebase project**: `mm-mart-live` / `catalog-58ec8.web.app`
