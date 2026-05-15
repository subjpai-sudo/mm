import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendOwnerSms, sendSmsTo } from "./notifications.server";

export { sendSmsTo };

export const sendViberTest = createServerFn({ method: "POST" })
  .handler(async () => {
    return sendOwnerSms(`Stock Bot SMS test at ${new Date().toLocaleString()}`);
  });

export const sendOrderRequestAlert = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ message: z.string().min(1).max(1500) }).parse(input))
  .handler(async ({ data }) => sendOwnerSms(data.message));

export const sendReportLinkSms = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        phone: z.string().regex(/^\+[1-9]\d{1,14}$/, "Phone must be E.164 (e.g. +15551234567)"),
        url: z.string().url().max(500),
        label: z.string().min(1).max(120).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) =>
    sendSmsTo(
      data.phone,
      `📊 ${data.label ?? "Stock Report"}\nDownload: ${data.url}`,
    ),
  );

export const checkLowStockAlert = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ productId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { data: product } = await supabaseAdmin
      .from("products")
      .select("id, name, sku, stock, low_stock_threshold, last_alert_stock")
      .eq("id", data.productId)
      .single();
    if (!product) return { sent: false, reason: "no-product" };

    // Stock recovered above threshold — reset so future drops re-alert.
    if (product.stock > product.low_stock_threshold) {
      if (product.last_alert_stock !== null) {
        await supabaseAdmin.from("products").update({ last_alert_stock: null }).eq("id", product.id);
      }
      return { sent: false, reason: "above-threshold" };
    }

    // Already alerted at this (or higher-equal) drop — skip duplicate.
    if (product.last_alert_stock !== null && product.stock >= product.last_alert_stock) {
      return { sent: false, reason: "already-alerted" };
    }

    const status = product.stock <= 0 ? "OUT OF STOCK" : "LOW STOCK";
    const text = `⚠️ ${status}\n${product.name}${product.sku ? ` (${product.sku})` : ""}\nRemaining: ${product.stock} / threshold ${product.low_stock_threshold}`;

    const result = await sendOwnerSms(text);
    if (!result.sent) return result;

    await supabaseAdmin
      .from("products")
      .update({ last_alert_stock: product.stock })
      .eq("id", product.id);

    return { sent: true, stock: product.stock };
  });