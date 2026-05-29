import { createFileRoute } from "@tanstack/react-router";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export const Route = createFileRoute("/api/public/rack-assign")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const json = () => new Response(JSON.stringify({ ok: false, error: "bad request" }), {
          status: 400, headers: { "content-type": "application/json" },
        });

        if (!SUPABASE_URL || !SERVICE_KEY) {
          return new Response(JSON.stringify({ ok: false, error: "not configured" }), {
            status: 503, headers: { "content-type": "application/json" },
          });
        }

        // Verify caller is an authenticated Supabase user
        const auth = request.headers.get("Authorization") ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        if (!token) return new Response(JSON.stringify({ ok: false, error: "unauthenticated" }), {
          status: 401, headers: { "content-type": "application/json" },
        });

        const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
          headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
        });
        if (!userRes.ok) return new Response(JSON.stringify({ ok: false, error: "unauthenticated" }), {
          status: 401, headers: { "content-type": "application/json" },
        });

        let body: { productId?: string; rack?: string | null; shelf?: string | null };
        try { body = await request.json(); } catch { return json(); }
        const { productId, rack, shelf } = body;
        if (!productId) return json();

        const patch = await fetch(
          `${SUPABASE_URL}/rest/v1/products?id=eq.${encodeURIComponent(productId)}`,
          {
            method: "PATCH",
            headers: {
              apikey: SERVICE_KEY,
              Authorization: `Bearer ${SERVICE_KEY}`,
              "Content-Type": "application/json",
              Prefer: "return=minimal",
            },
            body: JSON.stringify({ rack: rack ?? null, shelf: shelf ?? null }),
          },
        );

        if (!patch.ok) {
          const err = await patch.text();
          return new Response(JSON.stringify({ ok: false, error: err }), {
            status: 502, headers: { "content-type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
