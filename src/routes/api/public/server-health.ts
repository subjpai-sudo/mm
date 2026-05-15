import { createFileRoute } from "@tanstack/react-router";

// Public, read-only health check for the Worker runtime.
// Returns ONLY booleans (presence flags) — never the values themselves.
export const Route = createFileRoute("/api/public/server-health")({
  server: {
    handlers: {
      GET: async () => {
        const required = [
          "SUPABASE_URL",
          "SUPABASE_PUBLISHABLE_KEY",
          "SUPABASE_SERVICE_ROLE_KEY",
        ] as const;
        const present: Record<string, boolean> = {};
        const missing: string[] = [];
        for (const k of required) {
          const ok = Boolean(process.env[k]);
          present[k] = ok;
          if (!ok) missing.push(k);
        }
        return new Response(
          JSON.stringify({
            ok: missing.length === 0,
            present,
            missing,
            runtime: "cloudflare-worker",
            checkedAt: new Date().toISOString(),
          }),
          {
            status: missing.length === 0 ? 200 : 503,
            headers: {
              "content-type": "application/json",
              "cache-control": "no-store",
            },
          },
        );
      },
    },
  },
});