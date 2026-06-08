import { createServerFn } from "@tanstack/start-client-core";
import { getConfiguredKey } from "@/lib/config.server";

export const getStrichLicense = createServerFn({ method: "GET" }).handler(async () => {
  // app_settings.strich_license_key first, then STRICH_LICENSE_KEY env/secret.
  const key = await getConfiguredKey("strich_license_key", "STRICH_LICENSE_KEY");
  console.log("[strich] key present:", !!key, "len:", key.length);
  return { key };
});
