import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Store, ImageIcon, ArrowDownRight } from "lucide-react";
import { SHOPS, isShop } from "@/lib/shops";
import { cn } from "@/lib/utils";
import { format, formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_authenticated/shops")({ component: ShopsPage });

function ShopsPage() {
  const [active, setActive] = useState<string>("all");

  const { data: movements = [] } = useQuery({
    queryKey: ["shop-movements"],
    queryFn: async () => (await supabase
      .from("stock_movements")
      .select("*, products(name, image_url)")
      .eq("type", "out")
      .order("created_at", { ascending: false })
      .limit(500)).data ?? [],
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ["profiles-all"],
    queryFn: async () => (await supabase.from("profiles").select("id, email, full_name")).data ?? [],
  });
  const profileMap = useMemo(() => new Map(profiles.map((p: any) => [p.id, p.full_name || p.email || "—"])), [profiles]);

  const shopMoves = useMemo(() => (movements as any[]).filter((m) => isShop(m.destination)), [movements]);

  const totals = useMemo(() => {
    const t: Record<string, number> = Object.fromEntries(SHOPS.map((s) => [s, 0]));
    for (const m of shopMoves) t[m.destination] += m.quantity;
    return t;
  }, [shopMoves]);
  const grand = Object.values(totals).reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...Object.values(totals));

  const visible = active === "all" ? shopMoves : shopMoves.filter((m) => m.destination === active);

  return (
    <div className="p-3 sm:p-6 md:p-10 max-w-7xl mx-auto">
      <PageHeader title="Shops tracker" subtitle="Every unit delivered to each shop, with full movement history." />

      <Card className="card-elevated p-4 sm:p-5 mb-5">
        <div className="flex items-center gap-2 mb-3 text-sm font-semibold">
          <Store className="size-4 text-warning" />
          Totals delivered
          <span className="ml-auto text-xs font-normal text-muted-foreground">{grand.toLocaleString()} units</span>
        </div>
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
          {SHOPS.map((name) => {
            const qty = totals[name] ?? 0;
            const pct = Math.round((qty / max) * 100);
            const share = grand ? Math.round((qty / grand) * 100) : 0;
            return (
              <button
                key={name}
                type="button"
                onClick={() => setActive(active === name ? "all" : name)}
                className={cn(
                  "text-left rounded-lg p-2 -m-2 transition",
                  active === name ? "bg-warning/10 ring-1 ring-warning/40" : "hover:bg-secondary/40",
                )}
              >
                <div className="flex items-center gap-2 text-sm mb-1">
                  <Store className="size-3.5 text-muted-foreground" />
                  <span className="font-medium">{name}</span>
                  <span className="ml-auto tabular-nums font-semibold">{qty.toLocaleString()}</span>
                  <span className="text-xs text-muted-foreground tabular-nums w-10 text-right">{share}%</span>
                </div>
                <div className="h-2 rounded-full bg-secondary overflow-hidden">
                  <div className="h-full gradient-warning rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <button
          type="button"
          onClick={() => setActive("all")}
          className={cn(
            "inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium border transition",
            active === "all" ? "bg-primary text-primary-foreground border-primary" : "bg-secondary/40 border-border hover:bg-secondary",
          )}
        >
          All shops
        </button>
        {SHOPS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setActive(s)}
            className={cn(
              "inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium border transition",
              active === s ? "bg-warning text-warning-foreground border-warning" : "bg-secondary/40 border-border hover:bg-secondary",
            )}
          >
            <Store className="size-3" /> {s}
          </button>
        ))}
        <span className="text-xs text-muted-foreground ml-1">{visible.length} movement{visible.length === 1 ? "" : "s"}</span>
      </div>

      <Card className="card-elevated p-0 overflow-hidden">
        <div className="divide-y divide-border max-h-[calc(100vh-360px)] overflow-auto">
          {visible.length === 0 && <p className="text-center text-muted-foreground py-12 text-sm">No shop movements yet</p>}
          {visible.map((m: any) => (
            <div key={m.id} className="flex items-center gap-3 p-3 sm:p-4 hover:bg-secondary/30">
              {m.products?.image_url ? (
                <img src={m.products.image_url} alt="" className="size-10 rounded-lg object-cover border border-border shrink-0" />
              ) : (
                <div className="size-10 rounded-lg bg-secondary grid place-items-center text-muted-foreground border border-border shrink-0"><ImageIcon className="size-4" /></div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className="bg-destructive/15 text-destructive border-destructive/30 hover:bg-destructive/15">
                    <ArrowDownRight className="size-3" /> -{m.quantity}
                  </Badge>
                  <span className="font-medium truncate">{m.products?.name ?? "—"}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                  <span className="inline-flex items-center gap-1 font-semibold text-warning">
                    <Store className="size-3" /> {m.destination}
                  </span>
                  {m.reason && <><span>·</span><span>{m.reason}</span></>}
                  <span>·</span>
                  <span>by <span className="text-foreground font-medium">{profileMap.get(m.user_id) ?? "System"}</span></span>
                </div>
              </div>
              <div className="text-[11px] text-muted-foreground text-right shrink-0">
                <div>{formatDistanceToNow(new Date(m.created_at), { addSuffix: true })}</div>
                <div className="hidden sm:block">{format(new Date(m.created_at), "MMM d, p")}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
