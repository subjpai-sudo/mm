import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  // Read root .env once at startup — avoids Vite restart loop when iCloud/tools touch .env
  const env = loadEnv(mode, repoRoot, "");

  return {
    root: path.join(repoRoot, "src/local"),
    /** Empty env dir so Vite does not watch repo-root .env for hot restarts */
    envDir: path.join(repoRoot, "src/local"),
    define: {
      "import.meta.env.VITE_LOCAL_PREVIEW": JSON.stringify("true"),
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(env.VITE_SUPABASE_URL ?? ""),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(env.VITE_SUPABASE_PUBLISHABLE_KEY ?? ""),
      "import.meta.env.VITE_SUPABASE_PROJECT_ID": JSON.stringify(env.VITE_SUPABASE_PROJECT_ID ?? ""),
    },
    plugins: [
      tailwindcss(),
      ],
    resolve: {
      alias: [
        { find: "@/components/app/ScannerFAB", replacement: path.join(repoRoot, "src/local/scanner-stubs.tsx") },
        { find: "@/components/app/UniversalScanner", replacement: path.join(repoRoot, "src/local/scanner-stubs.tsx") },
        { find: "@/components/app/StrichScanner", replacement: path.join(repoRoot, "src/local/scanner-stubs.tsx") },
        { find: "@/components/app/ReportPdfDialog", replacement: path.join(repoRoot, "src/local/scanner-stubs.tsx") },
        { find: "@/lib/notifications.functions", replacement: path.join(repoRoot, "src/local/server-function-stubs.ts") },
        { find: "@/lib/ai-scan.functions", replacement: path.join(repoRoot, "src/local/server-function-stubs.ts") },
        { find: "@/lib/strich.functions", replacement: path.join(repoRoot, "src/local/server-function-stubs.ts") },
        { find: "@/lib/keyalerts.functions", replacement: path.join(repoRoot, "src/local/server-function-stubs.ts") },
        { find: "@/lib/audit.functions", replacement: path.join(repoRoot, "src/local/server-function-stubs.ts") },
        { find: "@/lib/users.functions", replacement: path.join(repoRoot, "src/local/server-function-stubs.ts") },
        { find: "@/lib/shipments.functions", replacement: path.join(repoRoot, "src/local/server-function-stubs.ts") },
        { find: "@/lib/backups.functions", replacement: path.join(repoRoot, "src/local/server-function-stubs.ts") },
        { find: "@/lib/insights.functions", replacement: path.join(repoRoot, "src/local/server-function-stubs.ts") },
        { find: "@/lib/product-images.functions", replacement: path.join(repoRoot, "src/local/server-function-stubs.ts") },
        { find: "@", replacement: path.join(repoRoot, "src") },
      ],
      dedupe: ["react", "react-dom", "@tanstack/react-query", "@tanstack/query-core"],
    },
    optimizeDeps: {
      include: [
        "react",
        "react/jsx-dev-runtime",
        "react/jsx-runtime",
        "react-dom",
        "react-dom/client",
        "@supabase/supabase-js",
        "@tanstack/react-router",
        "@tanstack/react-query",
      ],
    },
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: false,
      fs: { allow: [repoRoot] },
    },
  };
});
