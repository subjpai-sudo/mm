import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Subscribes to realtime changes on products + stock_movements,
 * invalidates relevant queries, exposes a "lastUpdated" timestamp,
 * and shows a subtle toast when changes arrive.
 */
export function useRealtimeSync(opts?: { silent?: boolean }) {
  const qc = useQueryClient();
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  useEffect(() => {
    const channel = supabase
      .channel("realtime-inventory")
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, (payload) => {
        qc.invalidateQueries({ queryKey: ["products"] });
        qc.invalidateQueries({ queryKey: ["products-report"] });
        setLastUpdated(new Date());
        if (!opts?.silent) {
          const name = (payload.new as any)?.name ?? (payload.old as any)?.name ?? "Inventory";
          if (payload.eventType === "INSERT") toast.success(`Added: ${name}`, { duration: 2000 });
          else if (payload.eventType === "DELETE") toast(`Removed: ${name}`, { duration: 2000 });
          else toast(`Updated: ${name}`, { duration: 1800 });
        }
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "stock_movements" }, (payload) => {
        qc.invalidateQueries({ queryKey: ["products"] });
        qc.invalidateQueries({ queryKey: ["movements-recent"] });
        qc.invalidateQueries({ queryKey: ["movements-all"] });
        qc.invalidateQueries({ queryKey: ["products-report"] });
        setLastUpdated(new Date());
        if (!opts?.silent) {
          const m: any = payload.new;
          const verb = m?.type === "in" ? "Stock in" : "Stock out";
          toast(`${verb}: ${m?.quantity ?? "?"} units`, { duration: 1800 });
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [qc, opts?.silent]);

  return { lastUpdated };
}