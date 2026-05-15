import { supabaseAdmin } from "@/integrations/supabase/client.server";

const TWILIO_GATEWAY = "https://connector-gateway.lovable.dev/twilio";

export async function sendSmsTo(to: string, text: string): Promise<{ sent: boolean; reason?: string; detail?: any }> {
  const { data: settings } = await supabaseAdmin
    .from("app_settings")
    .select("twilio_from")
    .eq("id", 1)
    .maybeSingle();

  const lovableKey = process.env.LOVABLE_API_KEY;
  const twilioKey = process.env.TWILIO_API_KEY;

  if (!lovableKey) return { sent: false, reason: "lovable-key-missing" };
  if (!twilioKey) return { sent: false, reason: "twilio-key-missing" };
  if (!settings?.twilio_from) return { sent: false, reason: "twilio-not-configured" };
  if (!to) return { sent: false, reason: "no-recipient" };

  try {
    const response = await fetch(`${TWILIO_GATEWAY}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": twilioKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: to,
        From: settings.twilio_from,
        Body: text,
      }),
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) return { sent: false, reason: "twilio-error", detail: body };
    return { sent: true, detail: { sid: body?.sid, status: body?.status } };
  } catch (error: any) {
    return { sent: false, reason: "twilio-exception", detail: error?.message };
  }
}

export async function sendOwnerSms(text: string) {
  const { data: settings } = await supabaseAdmin
    .from("app_settings")
    .select("owner_phone")
    .eq("id", 1)
    .maybeSingle();

  if (!settings?.owner_phone) return { sent: false, reason: "twilio-not-configured" };
  return sendSmsTo(settings.owner_phone, text);
}
