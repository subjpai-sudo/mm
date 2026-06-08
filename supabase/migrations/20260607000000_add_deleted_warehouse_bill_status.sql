-- Allow warehouse bills to show a true deleted/voided state.
-- Older code used cancelled; the app still falls back to cancelled if this
-- migration has not been applied yet.

alter table public.warehouse_bills
  drop constraint if exists warehouse_bills_status_check;

alter table public.warehouse_bills
  add constraint warehouse_bills_status_check
  check (status in ('issued', 'sent_to_billing', 'invoiced', 'cancelled', 'deleted'));

alter table public.warehouse_bills
  add column if not exists billing_invoice_id text,
  add column if not exists billing_invoice_url text;
