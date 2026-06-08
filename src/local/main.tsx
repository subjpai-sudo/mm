import React from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";

import "../styles.css";
import { getRouter } from "./router";

class LocalErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: "system-ui, sans-serif", maxWidth: 640 }}>
          <h1 style={{ fontSize: 18, fontWeight: 600 }}>Local dev failed to start</h1>
          <pre style={{ marginTop: 12, padding: 12, background: "#f5f5f5", overflow: "auto" }}>
            {this.state.error.message}
          </pre>
          <p style={{ marginTop: 12, color: "#666", fontSize: 14 }}>
            Check <code>.env</code> has VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY, then restart <code>npm run dev</code>.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

const router = getRouter();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LocalErrorBoundary>
      <RouterProvider router={router} />
    </LocalErrorBoundary>
  </React.StrictMode>,
);
