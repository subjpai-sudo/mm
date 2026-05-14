import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function sendViberText(text: string): Promise<{ sent: boolean; reason?: string; detail?: any }> {
  const { data: settings } = await supabaseAdmin
    .from("app_settings")
    .select("infobip_base_url, viber_sender, owner_phone")
    .eq("id", 1)
    .maybeSingle();
  const apiKey = process.env.INFOBIP_API_KEY;
  if (!apiKey) return { sent: false, reason: "infobip-key-missing" };
  if (!settings?.infobip_base_url || !settings?.viber_sender || !settings?.owner_phone) {
    return { sent: false, reason: "infobip-not-configured" };
  }
  const baseUrl = settings.infobip_base_url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  try {
    const res = await fetch(`https://${baseUrl}/viber/2/messages`, {
      method: "POST",
      headers: {
        Authorization: `App ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        messages: [
          {
            sender: settings.viber_sender,
            destinations: [{ to: settings.owner_phone.replace(/^\+/, "") }],
            content: { type: "TEXT", text },
          },
        ],
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { sent: false, reason: "infobip-error", detail: body };
    const status = body?.messages?.[0]?.status;
    const groupName = status?.groupName;
    if (groupName && groupName !== "PENDING" && groupName !== "DELIVERED") {
      return { sent: false, reason: "infobip-rejected", detail: status };
    }
    return { sent: true };
  } catch (e: any) {
    return { sent: false, reason: "infobip-exception", detail: e?.message };
  }
}

export const sendViberTest = createServerFn({ method: "POST" })
  .handler(async () => {
    return sendViberText(`✅ Viber connection test\nFrom Stock Bot at ${new Date().toLocaleString()}`);
  });

export const sendOrderRequestAlert = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ message: z.string().min(1).max(4000) }).parse(input))
  .handler(async ({ data }) => sendViberText(data.message));

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

    const result = await sendViberText(text);
    if (!result.sent) return result;

    await supabaseAdmin
      .from("products")
      .update({ last_alert_stock: product.stock })
      .eq("id", product.id);

    return { sent: true, stock: product.stock };
  });