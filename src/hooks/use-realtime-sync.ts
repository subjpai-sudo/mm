import { useEffect, useRef, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/** Local Vite preview — skip Supabase realtime to avoid refetch storms while testing. */
const LOCAL_PREVIEW = import.meta.env.VITE_LOCAL_PREVIEW === "true";

let channelActive = false;
let globalLastUpdated = new Date();
const updateListeners = new Set<() => void>();

function notifyListeners() {
  globalLastUpdated = new Date();
  for (const fn of updateListeners) fn();
}

function createDebouncedInvalidator(qc: QueryClient, waitMs = 2500) {
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    for (const key of pending) {
      qc.invalidateQueries({ queryKey: [key] });
    }
    pending.clear();
  };

  return (...queryKeys: string[]) => {
    for (const key of queryKeys) pending.add(key);
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, waitMs);
  };
}

function ensureRealtimeChannel(qc: QueryClient, showToasts: boolean) {
  if (LOCAL_PREVIEW || channelActive) return;

  const invalidate = createDebouncedInvalidator(qc);
  let lastTouch = 0;
  let lastToast = 0;

  const touch = () => {
    const now = Date.now();
    if (now - lastTouch < 3000) return;
    lastTouch = now;
    notifyListeners();
  };

  const maybeToast = (fn: () => void) => {
    if (!showToasts) return;
    const now = Date.now();
    if (now - lastToast < 5000) return;
    lastToast = now;
    fn();
  };

  supabase
    .channel("realtime-inventory-global")
    .on("postgres_changes", { event: "*", schema: "public", table: "products" }, (payload) => {
      invalidate("products", "products-report", "recent-barcodes", "product-page", "notif-products");
      touch();
      maybeToast(() => {
        const name = (payload.new as any)?.name ?? (payload.old as any)?.name ?? "Inventory";
        if (payload.eventType === "INSERT") toast.success(`Added: ${name}`, { duration: 2000 });
        else if (payload.eventType === "DELETE") toast(`Removed: ${name}`, { duration: 2000 });
      });
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "stock_movements" }, (payload) => {
      invalidate("products", "movements-recent", "movements-all", "shop-movements", "products-report", "notif-movements");
      touch();
      maybeToast(() => {
        if (payload.eventType !== "INSERT") return;
        const m: any = payload.new;
        toast(`${m?.type === "in" ? "Stock in" : "Stock out"}: ${m?.quantity ?? "?"} units`, { duration: 1800 });
      });
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "warehouse_bills" }, () => {
      invalidate("warehouse-bills");
      touch();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "warehouse_bill_items" }, () => {
      invalidate("warehouse-bill-items", "warehouse-bills");
      touch();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "billing_customers" }, () => {
      invalidate("billing-customers");
      touch();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "billing_stores" }, () => {
      invalidate("billing-stores");
      touch();
    })
    .subscribe();

  channelActive = true;
}

/**
 * Single shared realtime subscription for the whole app.
 * Disabled in local Vite preview (VITE_LOCAL_PREVIEW=true).
 */
export function useRealtimeSync(opts?: { silent?: boolean; toasts?: boolean }) {
  const qc = useQueryClient();
  const showToastsRef = useRef(opts?.toasts === true && opts?.silent !== true);
  showToastsRef.current = opts?.toasts === true && opts?.silent !== true;

  const [lastUpdated, setLastUpdated] = useState(globalLastUpdated);

  useEffect(() => {
    if (LOCAL_PREVIEW) return;

    const bump = () => setLastUpdated(globalLastUpdated);
    updateListeners.add(bump);
    ensureRealtimeChannel(qc, showToastsRef.current);

    return () => {
      updateListeners.delete(bump);
    };
  }, [qc]);

  return { lastUpdated };
}
