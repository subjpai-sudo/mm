import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

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

    const { data: settings } = await supabaseAdmin
      .from("app_settings")
      .select("viber_bot_token, viber_owner_id")
      .eq("id", 1)
      .maybeSingle();

    if (!settings?.viber_bot_token || !settings?.viber_owner_id) {
      return { sent: false, reason: "viber-not-configured" };
    }

    const status = product.stock <= 0 ? "OUT OF STOCK" : "LOW STOCK";
    const text = `⚠️ ${status}\n${product.name}${product.sku ? ` (${product.sku})` : ""}\nRemaining: ${product.stock} / threshold ${product.low_stock_threshold}`;

    try {
      const res = await fetch("https://chatapi.viber.com/pa/send_message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Viber-Auth-Token": settings.viber_bot_token,
        },
        body: JSON.stringify({
          receiver: settings.viber_owner_id,
          min_api_version: 1,
          sender: { name: "Stock Bot" },
          type: "text",
          text,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.status !== 0) {
        return { sent: false, reason: "viber-error", detail: body };
      }
    } catch (e: any) {
      return { sent: false, reason: "viber-exception", detail: e?.message };
    }

    await supabaseAdmin
      .from("products")
      .update({ last_alert_stock: product.stock })
      .eq("id", product.id);

    return { sent: true, stock: product.stock };
  });