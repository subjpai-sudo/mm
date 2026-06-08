/** Live MM-MART billing server (Cloud Run). */
export const BILLING_SERVER_URL =
  "https://billing-server-421265140321.asia-southeast1.run.app";

/** Browser billing app (Firebase Hosting). */
export const BILLING_APP_URL = "https://mm-mart-live.web.app";

export function billingServerUrl(path = ""): string {
  const base = BILLING_APP_URL.replace(/\/$/, "");
  if (!path) return base;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Notify billing server to pull latest stock from warehouse sync pipeline. */
export function notifyBillingStockSync(): void {
  fetch(`${BILLING_SERVER_URL}/api/sync/stock`, {
    method: "POST",
    credentials: "include",
  }).catch(() => {});
}

export type BillingImportParams = {
  warehouseBillId: string;
  billNo: string;
  customerId?: string | null;
  shopId?: string | null;
  destinationType?: "delivery" | "shop";
};

function billingBaseUrl() {
  const isLocalPreview = typeof window !== "undefined"
    && (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost");
  return isLocalPreview ? "http://127.0.0.1:8080" : BILLING_SERVER_URL;
}

function currentWarehouseReturnUrl(path = "/warehouse-bills") {
  if (typeof window === "undefined") return "";
  return new URL(path, window.location.origin).toString();
}

/** Open billing invoice builder with warehouse bill handoff query params. */
export function billingImportUrl(params: BillingImportParams | string, billNo?: string): string {
  const p: BillingImportParams = typeof params === "string"
    ? { warehouseBillId: params, billNo: billNo ?? "" }
    : params;
  const u = new URL(billingBaseUrl());
  u.searchParams.set("mode", "import");
  u.searchParams.set("warehouse_bill_id", p.warehouseBillId);
  u.searchParams.set("bill_no", p.billNo);
  if (p.customerId) u.searchParams.set("customer_id", p.customerId);
  if (p.shopId) u.searchParams.set("shop_id", p.shopId);
  if (p.destinationType) u.searchParams.set("destination_type", p.destinationType);
  u.searchParams.set("return_to", currentWarehouseReturnUrl("/warehouse-bills"));
  return u.toString();
}

export function billingReprintUrl(invoiceId: string | number): string {
  const u = new URL(billingBaseUrl());
  u.searchParams.set("mode", "reprint");
  u.searchParams.set("invoice_id", String(invoiceId));
  const path = typeof window !== "undefined" ? window.location.pathname || "/warehouse-bills" : "/warehouse-bills";
  u.searchParams.set("return_to", currentWarehouseReturnUrl(path));
  return u.toString();
}
