import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const TWILIO_GATEWAY = "https://connector-gateway.lovable.dev/twilio";

async function sendOwnerSms(text: string): Promise<{ sent: boolean; reason?: string; detail?: any }> {
  const { data: settings } = await supabaseAdmin
    .from("app_settings")
    .select("twilio_from, owner_phone")
    .eq("id", 1)
    .maybeSingle();
  const lovableKey = process.env.LOVABLE_API_KEY;
  const twilioKey = process.env.TWILIO_API_KEY;
  if (!lovableKey) return { sent: false, reason: "lovable-key-missing" };
  if (!twilioKey) return { sent: false, reason: "twilio-key-missing" };
  if (!settings?.twilio_from || !settings?.owner_phone) {
    return { sent: false, reason: "twilio-not-configured" };
  }
  try {
    const res = await fetch(`${TWILIO_GATEWAY}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": twilioKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: settings.owner_phone,
        From: settings.twilio_from,
        Body: text,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { sent: false, reason: "twilio-error", detail: body };
    return { sent: true, detail: { sid: body?.sid, status: body?.status } };
  } catch (e: any) {
    return { sent: false, reason: "twilio-exception", detail: e?.message };
  }
}

export const sendViberTest = createServerFn({ method: "POST" })
  .handler(async () => {
    return sendOwnerSms(`Stock Bot SMS test at ${new Date().toLocaleString()}`);
  });

export const sendOrderRequestAlert = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ message: z.string().min(1).max(1500) }).parse(input))
  .handler(async ({ data }) => sendOwnerSms(data.message));

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