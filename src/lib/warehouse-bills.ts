import { supabase } from "@/integrations/supabase/client";
import { billingImportUrl, billingReprintUrl, notifyBillingStockSync } from "@/lib/billing-server";
import { checkLowStockAlert } from "@/lib/notifications.functions";

export type WarehouseBillRow = {
  productId: string;
  name: string;
  stock: number;
  barcode: string | null;
  boxes: string;
  qty: string;
  pcsPerCase: number | null;
};

export type WarehouseProduct = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  stock: number;
  price: number;
  pcs_per_case: number | null;
};

export type CreateWarehouseBillInput = {
  rows: WarehouseBillRow[];
  products: WarehouseProduct[];
  destKind: "Delivery" | "Shops";
  shop: string | null;
  customerId: string | null;
  billingStores: Array<{ id: string; name: string; sub: string | null }>;
  billingCustomers: Array<{ id: string; name: string; company: string | null }>;
  userId?: string | null;
};

function isMissingWarehouseBillSchema(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const fields = error as { code?: string; message?: string };
  return (
    fields.code === "PGRST205" ||
    (fields.message ?? "").includes("warehouse_bills") ||
    (fields.message ?? "").includes("warehouse_bill_items")
  );
}

function warehouseBillSchemaError(): Error {
  return new Error("Warehouse bill tables are missing in Supabase. Run migration 20260606183000_add_warehouse_bills.sql, then try Generate bill again.");
}

export type IssuedBillLine = {
  name: string;
  sku: string | null;
  qty_pcs: number;
  boxes: number;
  loose_pcs: number;
  pcs_per_case: number | null;
  default_price: number;
  line_total: number;
};

export type IssuedBill = {
  id: string;
  bill_no: string;
  destination_label: string;
  destination_type: "delivery" | "shop";
  customer_id: string | null;
  shop_id: string | null;
  subtotal: number;
  itemCount: number;
  lines: IssuedBillLine[];
};

function makeBillNo() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `WB-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export async function createWarehouseBill(input: CreateWarehouseBillInput): Promise<IssuedBill> {
  const { rows, products, destKind, shop, customerId, billingStores, billingCustomers, userId } = input;
  if (rows.length === 0) throw new Error("Nothing scanned yet");
  if (destKind === "Shops" && !shop) throw new Error("Pick a shop first");

  const selectedCustomer = destKind === "Delivery"
    ? billingCustomers.find((c) => c.id === customerId) ?? null
    : null;
  const selectedShop = destKind === "Shops"
    ? billingStores.find((s) => (s.sub || s.name) === shop)
    : null;
  const finalDestination = destKind === "Shops"
    ? (shop ?? "")
    : (selectedCustomer ? (selectedCustomer.company || selectedCustomer.name) : "Delivery");
  const reasonBase = destKind === "Shops" ? `Shop · ${shop}` : `Delivery · ${finalDestination}`;

  const normalized = rows.map((r) => {
    const product = products.find((p) => p.id === r.productId);
    if (!product) throw new Error(`${r.name}: product no longer exists`);
    const b = Math.max(0, Number(r.boxes) || 0);
    const loose = Math.max(0, Number(r.qty) || 0);
    const perBox = r.pcsPerCase && r.pcsPerCase > 0 ? r.pcsPerCase : 0;
    const actual = perBox > 0 ? b * perBox + loose : loose;
    if (!actual || actual < 1) throw new Error(`Set quantity for ${r.name}`);
    if (actual > r.stock) throw new Error(`${r.name}: ${actual} pcs exceeds stock (${r.stock})`);
    const parts = perBox > 0 && b > 0
      ? `${b} box${b !== 1 ? "es" : ""} × ${perBox}${loose > 0 ? ` + ${loose} pcs` : ""} = ${actual} pcs`
      : `${actual} pcs`;
    const defaultPrice = Number(product.price ?? 0);
    return {
      row: r,
      product,
      boxes: b,
      loose,
      perBox,
      actual,
      defaultPrice,
      lineTotal: actual * defaultPrice,
      reason: `${reasonBase} · ${parts}`,
      destination: finalDestination,
    };
  });

  const subtotal = normalized.reduce((sum, item) => sum + item.lineTotal, 0);
  const { data: bill, error: billError } = await supabase
    .from("warehouse_bills")
    .insert({
      bill_no: makeBillNo(),
      destination_type: destKind === "Shops" ? "shop" : "delivery",
      destination_label: finalDestination,
      customer_id: destKind === "Delivery" ? customerId : null,
      shop_id: selectedShop?.id ?? null,
      subtotal,
      created_by: userId ?? null,
    })
    .select("id,bill_no,destination_label,subtotal")
    .single();
  if (isMissingWarehouseBillSchema(billError)) throw warehouseBillSchemaError();
  if (billError) throw billError;

  const movementRows = normalized.map((item) => ({
    product_id: item.row.productId,
    type: "out" as const,
    quantity: item.actual,
    user_id: userId,
    reason: item.reason,
    destination: item.destination,
    warehouse_bill_id: bill.id,
  }));
  const { data: movements, error: movementError } = await supabase
    .from("stock_movements")
    .insert(movementRows)
    .select("id,product_id");
  if (movementError) throw movementError;

  const movementByProduct = new Map((movements ?? []).map((m) => [m.product_id, m.id]));
  const billItems = normalized.map((item) => ({
    bill_id: bill.id,
    stock_movement_id: movementByProduct.get(item.row.productId) ?? null,
    product_id: item.row.productId,
    sku: item.product.sku ?? null,
    name_snapshot: item.product.name,
    barcode_snapshot: item.product.barcode ?? null,
    boxes: item.boxes,
    loose_pcs: item.loose,
    pcs_per_case: item.perBox || null,
    qty_pcs: item.actual,
    default_price: item.defaultPrice,
    line_total: item.lineTotal,
  }));
  const { error: itemError } = await supabase.from("warehouse_bill_items").insert(billItems);
  if (isMissingWarehouseBillSchema(itemError)) throw warehouseBillSchemaError();
  if (itemError) throw itemError;

  normalized.forEach((item) => {
    checkLowStockAlert({ data: { productId: item.row.productId } }).catch(() => {});
  });

  notifyBillingStockSync();

  return {
    id: bill.id,
    bill_no: bill.bill_no,
    destination_label: bill.destination_label,
    destination_type: destKind === "Shops" ? "shop" : "delivery",
    customer_id: destKind === "Delivery" ? customerId : null,
    shop_id: selectedShop?.id ?? null,
    subtotal: Number(bill.subtotal ?? subtotal),
    itemCount: normalized.length,
    lines: normalized.map((item) => ({
      name: item.product.name,
      sku: item.product.sku ?? null,
      qty_pcs: item.actual,
      boxes: item.boxes,
      loose_pcs: item.loose,
      pcs_per_case: item.perBox || null,
      default_price: item.defaultPrice,
      line_total: item.lineTotal,
    })),
  };
}

/** Restore stock for a warehouse bill by inserting reversal stock-in movements. */
export async function reverseBillStock(billId: string, userId?: string | null): Promise<void> {
  const { data: bill, error: billError } = await supabase
    .from("warehouse_bills")
    .select("id,bill_no,status,destination_label")
    .eq("id", billId)
    .single();
  if (billError || !bill) throw new Error("Bill not found");
  if (bill.status === "cancelled" || bill.status === "deleted") return;

  const { data: items, error: itemsError } = await supabase
    .from("warehouse_bill_items")
    .select("product_id,qty_pcs,name_snapshot")
    .eq("bill_id", billId);
  if (itemsError) throw itemsError;
  if (!items?.length) return;

  const reversalRows = items.map((item) => ({
    product_id: item.product_id,
    type: "in" as const,
    quantity: item.qty_pcs,
    user_id: userId ?? null,
    reason: `Void bill · stock returned · ${bill.bill_no}`,
    destination: bill.destination_label,
    warehouse_bill_id: billId,
  }));
  const { error: movementError } = await supabase.from("stock_movements").insert(reversalRows);
  if (movementError) throw movementError;

  notifyBillingStockSync();
}

async function updateBillDeletedStatus(billId: string): Promise<void> {
  const patch = { status: "deleted", updated_at: new Date().toISOString() };
  const { error } = await supabase.from("warehouse_bills").update(patch).eq("id", billId);
  if (!error) return;
  const { error: fallbackError } = await supabase
    .from("warehouse_bills")
    .update({ status: "cancelled", updated_at: patch.updated_at })
    .eq("id", billId);
  if (fallbackError) throw fallbackError;
}

/** Void a bill and reverse stock. Uses "deleted" when the DB status allows it, otherwise falls back to cancelled. */
export async function voidWarehouseBill(billId: string, userId?: string | null): Promise<void> {
  const { data: bill, error: billError } = await supabase
    .from("warehouse_bills")
    .select("status")
    .eq("id", billId)
    .single();
  if (billError || !bill) throw new Error("Bill not found");
  if (bill.status === "cancelled" || bill.status === "deleted") return;

  await reverseBillStock(billId, userId);
  await updateBillDeletedStatus(billId);
}

export const cancelWarehouseBill = voidWarehouseBill;

/** Open billing server invoice builder with warehouse bill handoff. */
export function warehouseBillInvoiceUrl(bill: Pick<IssuedBill, "id" | "bill_no" | "customer_id" | "shop_id" | "destination_type">): string {
  return billingImportUrl({
    warehouseBillId: bill.id,
    billNo: bill.bill_no,
    customerId: bill.customer_id,
    shopId: bill.shop_id,
    destinationType: bill.destination_type,
  });
}

export function warehouseBillDownloadUrl(bill: { billing_invoice_id?: string | number | null } & Pick<IssuedBill, "id" | "bill_no" | "customer_id" | "shop_id" | "destination_type">): string {
  return bill.billing_invoice_id ? billingReprintUrl(bill.billing_invoice_id) : warehouseBillInvoiceUrl(bill);
}

export async function markWarehouseBillInvoiceGenerated(bill: Pick<IssuedBill, "id" | "bill_no" | "customer_id" | "shop_id" | "destination_type">): Promise<string> {
  const url = warehouseBillInvoiceUrl(bill);
  const { error } = await supabase
    .from("warehouse_bills")
    .update({
      status: "invoiced",
      billing_invoice_url: url,
      updated_at: new Date().toISOString(),
    })
    .eq("id", bill.id);
  if (error) throw error;
  return url;
}

export async function openBillingInvoiceBuilder(bill: Pick<IssuedBill, "id" | "bill_no" | "customer_id" | "shop_id" | "destination_type">): Promise<void> {
  const url = await markWarehouseBillInvoiceGenerated(bill);
  window.location.assign(url);
}
