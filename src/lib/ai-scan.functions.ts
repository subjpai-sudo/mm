import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const scanProductImage = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ image: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { ok: false as const, error: "AI not configured (missing ANTHROPIC_API_KEY)" };

    const m = data.image.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
    if (!m) return { ok: false as const, error: "Invalid image" };
    const mediaType = m[1];
    const base64 = m[2];

    const prompt = `Look at this product packaging photo. Return ONLY a valid JSON object, no markdown, no explanation:
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
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 512,
          messages: [
            {
              role: "user",
              content: [
                { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
                { type: "text", text: prompt },
              ],
            },
          ],
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        console.error("Anthropic scan error", res.status, errText);
        return { ok: false as const, error: `AI error: ${res.status}` };
      }

      const aiRes = (await res.json()) as any;
      const raw: string = aiRes?.content?.[0]?.text ?? "{}";
      let parsed: Record<string, any> = {};
      try {
        parsed = JSON.parse(raw);
      } catch {
        const mm = raw.match(/\{[\s\S]*\}/);
        try { parsed = mm ? JSON.parse(mm[0]) : {}; } catch { /* leave empty */ }
      }

      return { ok: true as const, product: parsed };
    } catch (e: any) {
      console.error("AI scan failed", e);
      return { ok: false as const, error: e?.message ?? "Fetch failed" };
    }
  });
