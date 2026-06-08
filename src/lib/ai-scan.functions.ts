import { createServerFn } from "@tanstack/start-client-core";
import { z } from "zod";
import { getConfiguredKey } from "@/lib/config.server";
import { alertKeyError, looksLikeKeyError } from "@/lib/keyalerts.functions";

export const scanProductImage = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ images: z.array(z.string()).min(1) }).parse(d))
  .handler(async ({ data }) => {
    const apiKey = await getConfiguredKey("gemini_api_key", "GEMINI_API_KEY");
    if (!apiKey) return { ok: false as const, error: "AI not configured — set Gemini key in Settings or GEMINI_API_KEY secret" };

    const imageParts: { inline_data: { mime_type: string; data: string } }[] = [];
    for (const img of data.images) {
      const m = img.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
      if (!m) continue;
      imageParts.push({ inline_data: { mime_type: m[1], data: m[2] } });
    }
    if (imageParts.length === 0) return { ok: false as const, error: "Invalid image format" };

    const prompt = `You are looking at ${imageParts.length} photo(s) of the same product from different angles (front, back, side, etc.). Extract all information you can see across ALL images combined. Return ONLY a valid JSON object, no markdown, no explanation:
{
  "name": "full product name as on label",
  "brand": "brand name or null",
  "sku": "SKU / item code printed on label or null",
  "size": "size/weight like 500ml or 1kg or null",
  "unit": "bottle or bag or can or box or pack or jar or sachet or pcs or null",
  "origin": "country of origin or null",
  "pcs_per_case": <integer if shown on case, otherwise null>
}`;

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            contents: [{
              parts: [
                ...imageParts,
                { text: prompt },
              ],
            }],
            generationConfig: { temperature: 0, maxOutputTokens: 512 },
          }),
        }
      );

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        if (looksLikeKeyError(res.status, errText)) await alertKeyError("Gemini", `${res.status}`);
        return { ok: false as const, error: `AI error: ${res.status} ${errText.slice(0, 100)}` };
      }

      const aiRes = (await res.json()) as any;
      const raw: string = aiRes?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
      let parsed: Record<string, any> = {};
      try {
        parsed = JSON.parse(raw);
      } catch {
        const mm = raw.match(/\{[\s\S]*\}/);
        try { parsed = mm ? JSON.parse(mm[0]) : {}; } catch { /* leave empty */ }
      }

      return { ok: true as const, product: parsed };
    } catch (e: any) {
      return { ok: false as const, error: e?.message ?? "Fetch failed" };
    }
  });
