import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { BILLING_SERVER_URL } from "@/lib/billing-server";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/billing")({ component: BillingRedirect });

/** Legacy in-app billing moved to Cloud Run — redirect keeps old bookmarks working. */
function BillingRedirect() {
  useEffect(() => {
    window.location.replace(BILLING_SERVER_URL);
  }, []);

  return (
    <div className="min-h-[50vh] grid place-items-center text-muted-foreground gap-3">
      <Loader2 className="size-6 animate-spin" />
      <p className="text-sm">Opening billing system…</p>
    </div>
  );
}
