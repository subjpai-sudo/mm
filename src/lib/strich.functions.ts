import { createServerFn } from "@tanstack/react-start";

async function getCfEnv(): Promise<Record<string, string>> {
  try {
    const m = await import("cloudflare:workers" as string);
    return (m.env as Record<string, string>) ?? {};
  } catch {
    return {};
  }
}

export const getStrichLicense = createServerFn({ method: "GET" }).handler(async () => {
  let key = process.env.STRICH_LICENSE_KEY ?? "";
  if (!key) {
    const cfEnv = await getCfEnv();
    key = cfEnv.STRICH_LICENSE_KEY ?? "";
  }
  console.log("[strich] key present:", !!key, "len:", key.length);
  return { key };
});