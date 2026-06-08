import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { billingServerUrl } from "@/lib/billing-server";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/billing-history")({ component: BillingHistoryRedirect });

/** Invoice history lives on the billing server. */
function BillingHistoryRedirect() {
  useEffect(() => {
    window.location.replace(billingServerUrl());
  }, []);

  return (
    <div className="min-h-[50vh] grid place-items-center text-muted-foreground gap-3">
      <Loader2 className="size-6 animate-spin" />
      <p className="text-sm">Opening billing history…</p>
    </div>
  );
}
