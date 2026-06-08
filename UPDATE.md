# Repository Migration and Update Notes (June 8, 2026)

This update consolidates the codebase by merging the separate `warehouse` subproject directly into the repository root and adds configuration for standalone local development.

## Key Changes

### 1. Codebase Consolidation (Monorepo Merge)
- The separate `warehouse` directory has been removed.
- All warehouse pages, components, and routes have been moved to the root project under `src/`.
- This unifies development dependencies and configuration.

### 2. Standalone Local Development (`vite.local.config.ts`)
- Added `vite.local.config.ts` to allow developers to run the warehouse front-end completely standalone.
- Includes stub replacements (`src/local/scanner-stubs.tsx` and `src/local/server-function-stubs.ts`) for browser-only mode, bypassing native devices (cameras, scanners) and server-only functions.
- Run the local dev server with:
  ```bash
  npm run dev
  ```
  *(Runs Vite on port `5173` or falls back to `5174` if `5173` is occupied).*

### 3. Database Migrations (June 1 - June 7)
Added seven new migrations under `supabase/migrations/`:
- `20260601000000_fix_stock_movements.sql`: Fixes stock movements behavior.
- `20260601100000_add_twilio_creds.sql`: Configuration for Twilio notifications.
- `20260604000000_add_new_catalog_products.sql`: Adds new catalog product schemas.
- `20260605120000_add_editable_config.sql`: Dynamic client app editing capabilities.
- `20260606183000_add_warehouse_bills.sql`: Integrates warehouse bills table.
- `20260606200000_billing_realtime.sql`: Adds realtime triggers for bills.
- `20260607000000_add_deleted_warehouse_bill_status.sql`: Introduces soft-deleted status logic.
