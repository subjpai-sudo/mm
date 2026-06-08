import { createServerFn } from "@tanstack/start-client-core";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getConfiguredKey } from "@/lib/config.server";
import { alertKeyError, looksLikeKeyError } from "@/lib/keyalerts.functions";

async function uploadToFirebase(filename: string, bytes: Uint8Array, contentType: string): Promise<string> {
  const bucket = "mm-mart-live.firebasestorage.app";
  const uploadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o?name=${encodeURIComponent(filename)}&uploadType=media`;
  
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Type": contentType,
    },
    body: bytes,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Firebase upload failed: ${txt}`);
  }
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(filename)}?alt=media`;
}

export const uploadProductImageFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ dataUrl: z.string().min(10), ext: z.string().max(10).default("jpg") }).parse(d)
  )
  .handler(async ({ data }) => {
    const match = /^data:(image\/[^;]+);base64,(.+)$/.exec(data.dataUrl);
    if (!match) throw new Error("Invalid image data URL");
    const contentType = match[1];
    const ext = contentType.split("/")[1]?.split(";")[0] || data.ext;
    const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));

    const path = `product-images/${crypto.randomUUID()}.${ext}`;
    const url = await uploadToFirebase(path, bytes, contentType);
    return { url };
  });

// =====================================================
// AI photo cleanup via Google Gemini (direct, no gateway)
// Uses gemini-2.5-flash-image (Nano Banana) in image-EDIT
// mode: takes the product's own photo and returns a
// cleaned-up version — pure white background, even studio
// lighting, crisp/professional — WITHOUT changing the
// product, packaging, labels or text.
//
// Calls the Google Generative Language API directly with
// GEMINI_API_KEY (same key/pattern as ai-scan.functions.ts),
// so there is no dependency on any third-party gateway.
// =====================================================

const CLEAN_PROMPT = [
  "Edit this product photo to look like a professional retail catalog image.",
  "Cut out the product and place it on a pure solid white background (#FFFFFF).",
  "Remove any background clutter, props, hands, shadows and reflections.",
  "Apply even, bright studio lighting and make the product crisp, sharp and clean.",
  "Center the product so it fills about 85% of a square frame.",
  "CRITICAL: keep the product itself, its packaging, shape, colors, logos, labels and all text",
  "EXACTLY the same as the original — do not invent, add, remove or change any product detail,",
  "and do not add any new text, watermarks or graphics.",
].join(" ");

/** Resolve the input image (data URL or http URL) to { mime_type, data(base64) }. */
async function toInlineData(image: string): Promise<{ mime_type: string; data: string }> {
  if (image.startsWith("data:")) {
    const m = /^data:(image\/[^;]+);base64,(.+)$/.exec(image);
    if (!m) throw new Error("Invalid image data URL");
    return { mime_type: m[1], data: m[2] };
  }
  const r = await fetch(image);
  if (!r.ok) throw new Error(`Could not load the current image (${r.status})`);
  const mime_type = r.headers.get("content-type") || "image/jpeg";
  if (!mime_type.startsWith("image/")) throw new Error("Current image is not a valid image file");
  const buf = new Uint8Array(await r.arrayBuffer());
  let binary = "";
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
  return { mime_type, data: btoa(binary) };
}

async function cleanAndUpload(image: string): Promise<string> {
  const apiKey = await getConfiguredKey("gemini_api_key", "GEMINI_API_KEY");
  if (!apiKey) throw new Error("AI not configured — set Gemini key in Settings or GEMINI_API_KEY secret");

  const inline = await toInlineData(image);

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: CLEAN_PROMPT }, { inline_data: inline }] }],
        generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    if (looksLikeKeyError(res.status, errText)) await alertKeyError("Gemini", `${res.status}`);
    throw new Error(`AI error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const json: any = await res.json();
  const parts: any[] = json?.candidates?.[0]?.content?.parts ?? [];
  const imgPart = parts.find((p) => p?.inlineData?.data || p?.inline_data?.data);
  const out = imgPart?.inlineData ?? imgPart?.inline_data;
  if (!out?.data) throw new Error("No cleaned image returned from AI");

  const contentType: string = out.mimeType ?? out.mime_type ?? "image/png";
  const ext = contentType.split("/")[1] || "png";
  const bytes = Uint8Array.from(atob(out.data), (c) => c.charCodeAt(0));

  const path = `product-images/clean-${crypto.randomUUID()}.${ext}`;
  const url = await uploadToFirebase(path, bytes, contentType);
  return url;
}

export const cleanProductImageAI = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ image: z.string().min(10) }).parse(d))
  .handler(async ({ data }) => {
    const url = await cleanAndUpload(data.image);
    return { url };
  });
