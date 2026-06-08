# CityStar Warehouse (stock-order-hub)

**Live:** https://stock-order-hub.citystar.workers.dev

This folder is **warehouse only** — inventory, stock-in/out, products, racks, users.

## Billing

Invoices and POS run on the separate billing server:

https://billing-server-421265140321.asia-southeast1.run.app/

Linked from **Dashboard** and sidebar **Billing** (opens in new tab). Stock-out can hand off warehouse bills to billing via query params.

## Data

All warehouse data (users, products, stock counts, images) is in **Supabase** — unchanged by the mm2 split.

## Other projects

Catalog, billing Python app, vendor images, and archives moved to:

`/Users/anique/Documents/mm2`

See `mm2/README.md`.
