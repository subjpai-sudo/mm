import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

type ScanResult = { ok: true; product: Record<string, any> } | { ok: false; error: string };

export const scanProductImage = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ image: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) return { ok: false, error: "AI not configured" };

    if (!/^data:image\/(jpeg|png|webp);base64,/.test(data.image)) {
      return { ok: false, error: "Invalid image" };
    }

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
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Lovable-API-Key": apiKey,
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                { type: "image_url", image_url: { url: data.image } },
              ],
            },
          ],
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        console.error("Lovable AI scan error", res.status, errText);
        return { ok: false, error: `AI error: ${res.status}` };
      }

      const aiRes = (await res.json()) as any;
      const raw: string = aiRes?.choices?.[0]?.message?.content ?? "{}";
      let parsed: Record<string, any> = {};
      try {
        parsed = JSON.parse(raw);
      } catch {
        const m = raw.match(/\{[\s\S]*\}/);
        try { parsed = m ? JSON.parse(m[0]) : {}; } catch { /* leave empty */ }
      }

      return { ok: true, product: parsed };
    } catch (e: any) {
      console.error("AI scan failed", e);
      return { ok: false, error: e?.message ?? "Fetch failed" };
    }
  });
