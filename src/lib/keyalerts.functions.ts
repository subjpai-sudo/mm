import { createServerFn } from "@tanstack/start-client-core";
import { z } from "zod";
import { sendOwnerSms } from "./notifications.server";

// Notify the owner (once per service per 6h window) when a key/credential fails,
// so they know to update it in Settings. Throttled in-memory to avoid SMS spam.
const lastAlert = new Map<string, number>();
const THROTTLE_MS = 6 * 60 * 60 * 1000;

export async function alertKeyError(service: string, detail: string) {
  const now = Date.now();
  if ((lastAlert.get(service) ?? 0) + THROTTLE_MS > now) return;
  lastAlert.set(service, now);
  try {
    await sendOwnerSms(`⚠️ ${service} key error: ${detail}\nUpdate it in Settings → Keys.`);
  } catch {
    /* Twilio itself may be the thing that's down — nothing else we can do */
  }
}

/** Heuristic: does this HTTP status/body look like an auth/key failure (vs a transient error)? */
export function looksLikeKeyError(status: number, body: string): boolean {
  if (status === 401 || status === 403) return true;
  if (status !== 400) return false;
  const b = (body || "").toLowerCase();
  return b.includes("api key") || b.includes("api_key") || b.includes("permission") || b.includes("unauthor");
}

// Lets client code (e.g. the STRICH scanner, which initializes in the browser)
// report a key failure so the owner still gets alerted.
export const reportKeyError = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ service: z.string().min(1).max(40), detail: z.string().max(300) }).parse(d))
  .handler(async ({ data }) => {
    await alertKeyError(data.service, data.detail);
    return { ok: true };
  });
