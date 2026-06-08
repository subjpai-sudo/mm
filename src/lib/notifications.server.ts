import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function getSettings() {
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("twilio_sid, twilio_token, twilio_from, owner_phone")
    .eq("id", 1)
    .maybeSingle();
  return data ?? {};
}

export async function sendSmsTo(to: string, text: string): Promise<{ sent: boolean; reason?: string; detail?: any }> {
  const settings: any = await getSettings();
  const sid   = (settings.twilio_sid   ?? "").trim();
  const token = (settings.twilio_token ?? "").trim();
  const from  = (settings.twilio_from  ?? "").trim();

  if (!sid || !token) return { sent: false, reason: "twilio-key-missing" };
  if (!from)          return { sent: false, reason: "twilio-not-configured" };
  if (!to)            return { sent: false, reason: "no-recipient" };

  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: to, From: from, Body: text }),
      }
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return { sent: false, reason: "twilio-error", detail: body };
    return { sent: true, detail: { sid: body?.sid, status: body?.status } };
  } catch (error: any) {
    return { sent: false, reason: "twilio-exception", detail: error?.message };
  }
}

export async function sendOwnerSms(text: string) {
  const settings: any = await getSettings();
  const ownerPhone = (settings.owner_phone ?? "").trim();
  if (!ownerPhone) return { sent: false, reason: "twilio-not-configured" };
  return sendSmsTo(ownerPhone, text);
}
