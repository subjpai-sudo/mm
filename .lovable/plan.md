
## Goal

1. Clean up the Dashboard (uniform stat cards, drop catalog breakdown).
2. Add an Owner approval workflow for order/restock requests with three outcomes: Accepted (green), Backordered (yellow), Declined (red).
3. Track each approved request as a "Pending Shipment / Container" until Admin marks it Arrived — at which point stock is added to the matching product.
4. Let Admin & Owner log container details: container date, expected arrival date, product name, and category.

---

## Dashboard changes

- Remove the **Catalog breakdown** card entirely.
- Make every stat card identical width/height: switch grid to `grid-cols-2 md:grid-cols-4` with consistent `gap-4`, fixed minimum height on the card, and uniform value sizing.
- Add two new identical stat cards:
  - **Pending Shipment** — count of approved/backordered/declined requests not yet arrived. Links to `/shipments`.
  - **Containers** — count of logged containers in transit. Links to `/shipments`.

## Database (single migration)

- Extend `order_status` enum: add `backordered`.
- Add columns to `order_requests`:
  - `product_id uuid` (nullable) — optional link to existing product so arrival can credit stock.
  - `category_id uuid` (nullable) — for category tagging.
  - `container_date timestamptz` (nullable) — date container was dispatched/loaded.
  - `expected_arrival_date date` (nullable).
  - `arrived_at timestamptz` (nullable).
- Add RLS policy so **Owner** can update `order_requests` (currently only Admin can). This lets Owner accept/backorder/decline.

## Server functions (`src/lib/shipments.functions.ts`)

- `decideOrderRequest({ id, decision: 'approved' | 'backordered' | 'declined', container_date?, expected_arrival_date?, product_id?, category_id? })` — Owner/Admin only. Updates row.
- `markShipmentArrived({ id, quantity?, product_id? })` — Admin only. Sets `arrived_at = now()`, inserts a `stock_movements` row (`type=in`) for the linked product so trigger updates `products.stock`. If no `product_id`, just marks arrived.
- `updateShipment({ id, container_date?, expected_arrival_date?, product_id?, category_id?, product_name?, quantity? })` — Owner/Admin only.

All write the audit log.

## New page: `/_authenticated/shipments`

A single page replacing/augmenting the order-history flow:

- **Tabs / filters:** Pending (approved + backordered + declined, not arrived), Arrived, All.
- Each row shows: status pill (green/yellow/red/blue Arrived), product name, category, qty, container date, expected arrival.
- **Owner actions** on `pending` order_requests: Accept / Backorder / Decline buttons (with optional inline container date + expected arrival inputs + product/category pickers).
- **Admin action** on approved/backordered shipments: **Arrived** button → opens a small dialog (confirm product & quantity) → calls `markShipmentArrived`.
- **Log Container** button (Admin & Owner): opens dialog to create a row directly with type `restock`, status `approved`, plus container/arrival/product/category fields. Categories pulled from `categories` table.

Sidebar nav: add "Shipments" entry; keep "Order History" or fold it into Shipments → All tab. Recommend folding (rename Order History route's component to redirect to /shipments) to avoid duplication.

## Files touched

- `supabase/migrations/<new>.sql` — enum + columns + RLS.
- `src/lib/shipments.functions.ts` — new.
- `src/routes/_authenticated/shipments.tsx` — new.
- `src/routes/_authenticated/dashboard.tsx` — strip catalog breakdown, normalize cards, add 2 new cards.
- `src/routes/_authenticated/order-history.tsx` — extend buttons (Accept/Backorder/Decline) or redirect to /shipments.
- `src/components/app/AppSidebar` (if present) — add Shipments link.

## Out of scope (will not change)

- Twilio/SMS notification wiring — existing alert on order request stays as-is.
- Existing PIN/invite/auth flows.
- Reports page.

