import { createFileRoute } from "@tanstack/react-router";

// Caching proxy endpoint for Supabase storage objects.
// Intercepts requests, caches them at Cloudflare Edge (zero egress fee), and serves them.
export const Route = createFileRoute("/api/public/storage")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const urlObj = new URL(request.url);
        let targetUrl = urlObj.searchParams.get("url");
        const bucket = urlObj.searchParams.get("bucket");
        const path = urlObj.searchParams.get("path");

        const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;

        if (!targetUrl && bucket && path) {
          if (!supabaseUrl) {
            return new Response("Supabase URL is not configured", { status: 500 });
          }
          // Construct URL: e.g. https://xyz.supabase.co/storage/v1/object/public/bucket/path
          targetUrl = `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${bucket}/${path}`;
        }

        if (!targetUrl) {
          return new Response("Missing 'url' or 'bucket' and 'path' parameters", { status: 400 });
        }

        // Security: Prevent open proxy vulnerability by ensuring the target URL points to our Supabase domain or Firebase Storage.
        try {
          const parsedTarget = new URL(targetUrl);
          const allowedHosts = ["firebasestorage.googleapis.com"];
          if (supabaseUrl) {
            allowedHosts.push(new URL(supabaseUrl).hostname);
          }
          if (!allowedHosts.includes(parsedTarget.hostname)) {
            return new Response("Access forbidden: Domain not authorized", { status: 403 });
          }
        } catch {
          return new Response("Invalid target URL", { status: 400 });
        }

        // Caching logic for Cloudflare Worker runtime
        const isCloudflare = typeof caches !== "undefined" && !!(caches as any).default;
        if (isCloudflare) {
          try {
            const cache = (caches as any).default;
            const cachedResponse = await cache.match(request);
            if (cachedResponse) {
              return cachedResponse;
            }
          } catch (err) {
            console.error("Cache API match error:", err);
          }
        }

        // Fetch the file from Supabase Storage
        try {
          // Pass along relevant headers like range if requested (e.g. for videos/audio/large assets)
          const headers = new Headers();
          const range = request.headers.get("range");
          if (range) {
            headers.set("range", range);
          }

          const res = await fetch(targetUrl, { headers });
          if (!res.ok) {
            return new Response(res.body, {
              status: res.status,
              statusText: res.statusText,
              headers: res.headers,
            });
          }

          const responseHeaders = new Headers(res.headers);
          // Force aggressive caching on Cloudflare Edge and Client
          responseHeaders.set("Cache-Control", "public, max-age=31536000, immutable");
          responseHeaders.set("Access-Control-Allow-Origin", "*");
          responseHeaders.set("X-Cache-Proxy", "MISS");

          const proxiedResponse = new Response(res.body, {
            status: res.status,
            statusText: res.statusText,
            headers: responseHeaders,
          });

          if (isCloudflare && res.ok && res.status !== 206) {
            try {
              const cache = (caches as any).default;
              const cachedResponseToPut = proxiedResponse.clone();
              cachedResponseToPut.headers.set("X-Cache-Proxy", "HIT");
              // Save in background
              await cache.put(request, cachedResponseToPut);
            } catch (err) {
              console.error("Cache API put error:", err);
            }
          }

          return proxiedResponse;
        } catch (error: any) {
          console.error("Storage proxy fetch failed:", error);
          return new Response(`Failed to fetch asset: ${error.message || error}`, { status: 500 });
        }
      },
    },
  },
});
