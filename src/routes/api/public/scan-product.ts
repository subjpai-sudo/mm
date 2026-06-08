import { createFileRoute } from "@tanstack/react-router";
import { getConfiguredKey } from "@/lib/config.server";
import { alertKeyError, looksLikeKeyError } from "@/lib/keyalerts.functions";

export const Route = createFileRoute("/api/public/scan-product")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = await getConfiguredKey("anthropic_api_key", "ANTHROPIC_API_KEY");
        if (!apiKey) {
          return new Response(JSON.stringify({ ok: false, error: "AI not configured" }), {
            status: 503,
            headers: { "content-type": "application/json" },
          });
        }

        let body: { image?: string };
        try {
          body = await request.json();
        } catch {
          return new Response(JSON.stringify({ ok: false, error: "Invalid request" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }

        const { image } = body;
        if (!image) {
          return new Response(JSON.stringify({ ok: false, error: "No image provided" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }

        const match = image.match(/^data:([^;]+);base64,(.+)$/);
        if (!match) {
          return new Response(JSON.stringify({ ok: false, error: "Invalid image format" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }

        const mediaType = match[1] as "image/jpeg" | "image/png" | "image/webp";
        const base64Data = match[2];

        const prompt = `Look at this product packaging photo and extract all visible details. Return ONLY a valid JSON object with no markdown, no explanation, just the raw JSON:
{
  "name": "full product name as shown on label",
  "brand": "brand name or null",
  "size": "size/weight/volume like 500ml or 1kg or null",
  "unit": "bottle or bag or can or box or pack or jar or sachet or pcs or null",
  "origin": "country of origin or null",
  "pcs_per_case": <integer if shown on case packaging, otherwise null>
}`;

        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-opus-4-8",
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

        if (!res.ok) {
          const err = await res.text();
          if (looksLikeKeyError(res.status, err)) await alertKeyError("Anthropic", `${res.status}`);
          return new Response(JSON.stringify({ ok: false, error: `AI error: ${res.status}`, detail: err }), {
            status: 502,
            headers: { "content-type": "application/json" },
          });
        }

        const aiRes = await res.json() as any;
        const raw: string = aiRes?.content?.[0]?.text ?? "{}";

        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(raw);
        } catch {
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          try { parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {}; } catch { /* leave empty */ }
        }

        return new Response(JSON.stringify({ ok: true, product: parsed }), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
