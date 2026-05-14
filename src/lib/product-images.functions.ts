import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function searchAndUpload(name: string): Promise<string> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) throw new Error("SERPAPI_KEY is not configured");

  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google_images");
  url.searchParams.set("q", `${name} product`);
  url.searchParams.set("ijn", "0");
  url.searchParams.set("api_key", apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`SerpAPI error ${res.status}`);
  const json: any = await res.json();
  const images: any[] = json.images_results ?? [];
  if (!images.length) throw new Error("No images found");

  // Try the first few until one downloads successfully
  let blob: ArrayBuffer | null = null;
  let contentType = "image/jpeg";
  let ext = "jpg";
  for (const img of images.slice(0, 5)) {
    const src = img.original || img.thumbnail;
    if (!src) continue;
    try {
      const r = await fetch(src);
      if (!r.ok) continue;
      contentType = r.headers.get("content-type") || "image/jpeg";
      if (!contentType.startsWith("image/")) continue;
      ext = contentType.split("/")[1]?.split(";")[0] || "jpg";
      blob = await r.arrayBuffer();
      break;
    } catch {
      continue;
    }
  }
  if (!blob) throw new Error("Could not download any image");

  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabaseAdmin.storage
    .from("product-images")
    .upload(path, blob, { contentType, upsert: false });
  if (error) throw new Error(error.message);
  const { data } = supabaseAdmin.storage.from("product-images").getPublicUrl(path);
  return data.publicUrl;
}

export const fetchProductImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ name: z.string().min(1).max(200) }).parse(d))
  .handler(async ({ data }) => {
    const url = await searchAndUpload(data.name);
    return { url };
  });

export const bulkFetchProductImages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { data: products, error } = await supabaseAdmin
      .from("products")
      .select("id, name, image_url");
    if (error) throw new Error(error.message);
    const targets = (products ?? []).filter((p) => !p.image_url);
    let updated = 0;
    const failures: { name: string; error: string }[] = [];
    for (const p of targets) {
      try {
        const url = await searchAndUpload(p.name);
        const { error: upErr } = await supabaseAdmin
          .from("products")
          .update({ image_url: url })
          .eq("id", p.id);
        if (upErr) throw upErr;
        updated++;
      } catch (e: any) {
        failures.push({ name: p.name, error: e?.message ?? "unknown" });
      }
    }
    return { updated, total: targets.length, failures };
  });