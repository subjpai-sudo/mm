import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type ScanResult = { ok: true; product: Record<string, any> } | { ok: false; error: string };

export const scanProductImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ image: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { ok: false, error: "AI not configured" };

    const match = data.image.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return { ok: false, error: "Invalid image" };

    const mediaType = match[1] as "image/jpeg" | "image/png" | "image/webp";
    const base64Data = match[2];

    const prompt = `Look at this product packaging photo. Return ONLY a valid JSON object, no markdown, no explanation:
{
  "name": "full product name as on label",
  "brand": "brand name or null",
  "size": "size/weight like 500ml or 1kg or null",
  "unit": "bottle or bag or can or box or pack or jar or sachet or pcs or null",
  "origin": "country of origin or null",
  "pcs_per_case": <integer if shown on case, otherwise null>
}`;

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 512,
          messages: [
            {
              role: "user",
              content: [
                { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } },
                { type: "text", text: prompt },
              ],
            },
          ],
        }),
      });

      if (!res.ok) return { ok: false, error: `AI error: ${res.status}` };

      const aiRes = await res.json() as any;
      const raw: string = aiRes?.content?.[0]?.text ?? "{}";
      let parsed: Record<string, any> = {};
      try {
        parsed = JSON.parse(raw);
      } catch {
        const m = raw.match(/\{[\s\S]*\}/);
        try { parsed = m ? JSON.parse(m[0]) : {}; } catch { /* leave empty */ }
      }

      return { ok: true, product: parsed };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? "Fetch failed" };
    }
  });
