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

// =====================================================
// AI image generation via Lovable AI Gateway (Gemini)
// Uses google/gemini-2.5-flash-image (Nano Banana) to
// generate a clean product photo, optionally referencing
// the City Star catalog website packaging style.
// =====================================================

const CATALOG_REF = "https://catalog-58ec8.web.app/";

function buildPrompt(p: { name: string; brand?: string | null; size?: string | null; origin?: string | null }) {
  const parts = [
    `Generate a high-resolution (1024x1024) professional product photograph of "${p.name}"`,
    p.brand ? `by ${p.brand}` : "",
    p.size ? `, size ${p.size}` : "",
    p.origin ? `, origin ${p.origin}` : "",
    `. Studio lighting, pure clean white background, centered, sharp focus, true-to-life packaging colors and labels.`,
    `Match real retail packaging style used on the City Star catalog (${CATALOG_REF}) so it looks consistent with other items from the same brand/company.`,
    `No text overlays, no watermarks, no shadows behind product.`,
  ];
  return parts.filter(Boolean).join(" ");
}

async function generateAndUpload(p: { name: string; brand?: string | null; size?: string | null; origin?: string | null }): Promise<string> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-image",
      modalities: ["image", "text"],
      messages: [
        { role: "user", content: buildPrompt(p) },
      ],
    }),
  });

  if (res.status === 429) throw new Error("Rate limit hit — please retry shortly");
  if (res.status === 402) throw new Error("AI credits exhausted — add credits in Settings → Workspace");
  if (!res.ok) throw new Error(`AI gateway error ${res.status}: ${await res.text().catch(() => "")}`);

  const json: any = await res.json();
  const dataUrl: string | undefined =
    json?.choices?.[0]?.message?.images?.[0]?.image_url?.url ??
    json?.choices?.[0]?.message?.images?.[0]?.url;
  if (!dataUrl || !dataUrl.startsWith("data:")) throw new Error("No image returned from AI");

  const match = /^data:(image\/[^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error("Invalid image data URL");
  const contentType = match[1];
  const ext = contentType.split("/")[1] || "png";
  const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));

  const path = `ai-${crypto.randomUUID()}.${ext}`;
  const { error } = await supabaseAdmin.storage
    .from("product-images")
    .upload(path, bytes, { contentType, upsert: false });
  if (error) throw new Error(error.message);
  const { data } = supabaseAdmin.storage.from("product-images").getPublicUrl(path);
  return data.publicUrl;
}

export const generateProductImageAI = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid() }).parse(d)
  )
  .handler(async ({ data }) => {
    const { data: product, error } = await supabaseAdmin
      .from("products")
      .select("id, name, brand, size, origin")
      .eq("id", data.id)
      .single();
    if (error || !product) throw new Error(error?.message ?? "Product not found");
    const url = await generateAndUpload(product as any);
    const { error: upErr } = await supabaseAdmin
      .from("products")
      .update({ image_url: url })
      .eq("id", data.id);
    if (upErr) throw new Error(upErr.message);
    return { url };
  });

export const bulkGenerateProductImagesAI = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      mode: z.enum(["missing", "all"]).default("missing"),
      limit: z.number().int().min(1).max(50).default(20),
    }).parse(d ?? {})
  )
  .handler(async ({ data }) => {
    const { data: products, error } = await supabaseAdmin
      .from("products")
      .select("id, name, brand, size, origin, image_url");
    if (error) throw new Error(error.message);
    const targets = (products ?? [])
      .filter((p) => (data.mode === "all" ? true : !p.image_url))
      .slice(0, data.limit);

    let updated = 0;
    const failures: { name: string; error: string }[] = [];
    for (const p of targets) {
      try {
        const url = await generateAndUpload(p as any);
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