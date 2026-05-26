import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Store, ImageIcon, ArrowDownRight, MapPin, TrendingUp } from "lucide-react";
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
    queryFn: async () => (await supabase.from("profiles").select("id, full_name")).data ?? [],
  });
  const profileMap = useMemo(() => new Map(profiles.map((p: any) => [p.id, p.full_name || "—"])), [profiles]);

  const shopMoves = useMemo(() => (movements as any[]).filter((m) => isShop(m.destination)), [movements]);

  const totals = useMemo(() => {
    const t: Record<string, number> = Object.fromEntries(SHOPS.map((s) => [s, 0]));
    for (const m of shopMoves) t[m.destination] += m.quantity;
    return t;
  }, [shopMoves]);
  const grand = Object.values(totals).reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...Object.values(totals));

  const visible = active === "all" ? shopMoves : shopMoves.filter((m) => m.destination === active);

  // assign a stable color per shop
  const palette = ["var(--cs-primary)", "var(--cs-accent)", "var(--cs-ok)", "var(--cs-warn)", "var(--cs-bad)", "var(--cs-primary-2)", "oklch(0.7 0.16 320)", "oklch(0.7 0.16 220)"];
  const shopColor = (name: string) => palette[(SHOPS as readonly string[]).indexOf(name) % palette.length] ?? "var(--cs-primary)";

  const ranked = useMemo(
    () => [...SHOPS].map(name => ({ name, qty: totals[name] ?? 0 })).sort((a, b) => b.qty - a.qty),
    [totals],
  );

  return (
    <div className="p-3 sm:p-6 md:p-10 max-w-7xl mx-auto">
      <PageHeader eyebrow="Distribution" title="Shops tracker" subtitle="Every unit delivered to each shop, with full movement history." />

      {/* Stat strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {[
          { label: "Units delivered", value: grand.toLocaleString(), tone: "chip-pri" },
          { label: "Active shops", value: ranked.filter(r => r.qty > 0).length, tone: "chip-acc" },
          { label: "Top shop", value: ranked[0]?.name ?? "—", tone: "chip-ok" },
          { label: "Movements", value: shopMoves.length.toLocaleString(), tone: "chip-warn" },
        ].map(s => (
          <Card key={s.label} className="card-elevated p-4">
            <div className="upper-label">{s.label}</div>
            <div className="num-m mt-1.5 truncate">{s.value}</div>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-[1fr_360px] gap-5 mb-5">
        {/* Ranking */}
        <Card className="card-elevated p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="upper-label">Ranking</div>
              <h2 className="text-[20px] font-semibold tracking-tight">Top shops</h2>
            </div>
            <TrendingUp className="size-4 text-muted-foreground" />
          </div>
          <div className="space-y-2.5">
            {ranked.map((r, i) => {
              const pct = Math.round((r.qty / max) * 100);
              const color = shopColor(r.name);
              const sel = active === r.name;
              return (
                <button
                  key={r.name}
                  type="button"
                  onClick={() => setActive(active === r.name ? "all" : r.name)}
                  className={cn("w-full text-left rounded-[12px] border px-3 py-2.5 hover-lift", sel ? "border-primary/40 bg-primary/5" : "border-border bg-card")}
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[11px] text-muted-foreground w-5">#{i + 1}</span>
                    <span className="size-2.5 rounded-full" style={{ background: color }} />
                    <span className="font-medium text-[13.5px] truncate flex-1">{r.name}</span>
                    <span className="num-m text-[18px] tabular-nums">{r.qty.toLocaleString()}</span>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-secondary overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${color}, color-mix(in oklch, ${color} 50%, transparent))` }} />
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        {/* Network map */}
        <Card className="card-elevated p-5 relative overflow-hidden">
          <div className="upper-label">Network</div>
          <h2 className="text-[20px] font-semibold tracking-tight mb-3">Kawaguchi map</h2>
          <div className="relative h-[320px] rounded-[14px] bg-secondary/40 border border-border overflow-hidden">
            <svg viewBox="0 0 300 320" className="absolute inset-0 w-full h-full opacity-50">
              <path d="M0,180 Q80,140 150,170 T300,150" stroke="var(--cs-primary)" strokeWidth="2" fill="none" opacity="0.4" />
              <path d="M0,200 Q80,160 150,190 T300,170" stroke="var(--cs-primary)" strokeWidth="6" fill="none" opacity="0.15" />
            </svg>
            {SHOPS.map((s, i) => {
              const positions = [[50, 60], [180, 80], [240, 140], [80, 150], [200, 220], [120, 250], [260, 260], [60, 220]];
              const [x, y] = positions[i] ?? [150, 150];
              const isActive = active === s;
              const color = shopColor(s);
              return (
                <button
                  key={s}
                  onClick={() => setActive(active === s ? "all" : s)}
                  className="absolute -translate-x-1/2 -translate-y-1/2 group"
                  style={{ left: `${(x / 300) * 100}%`, top: `${(y / 320) * 100}%` }}
                >
                  {isActive && (
                    <span
                      className="absolute inset-0 -m-3 rounded-full animate-ping"
                      style={{ background: color, opacity: 0.3 }}
                    />
                  )}
                  <span className="relative block size-3 rounded-full ring-2 ring-background" style={{ background: color }} />
                  <span className="absolute top-4 left-1/2 -translate-x-1/2 mt-0.5 text-[9px] font-mono uppercase tracking-wide whitespace-nowrap bg-background/80 backdrop-blur px-1 rounded">{s}</span>
                </button>
              );
            })}
            <div className="absolute bottom-2 right-2 chip">
              <MapPin className="size-3" /> {ranked.filter(r => r.qty > 0).length} active
            </div>
          </div>
        </Card>
      </div>

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

      <div className="upper-label mb-2">Recent deliveries</div>
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
                  <span className="chip chip-bad">
                    <ArrowDownRight className="size-3" /> -{m.quantity}
                  </span>
                  <span className="font-medium truncate">{m.products?.name ?? "—"}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                  <span className="inline-flex items-center gap-1 font-semibold" style={{ color: shopColor(m.destination) }}>
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
