import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useMemo, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import { formatDistanceToNow, format, subDays, startOfDay } from "date-fns";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft, QrCode, Pencil, MapPin, Package, ArrowUpRight, ArrowDownRight,
  Truck, Warehouse, Store, ImageIcon, Barcode as BarcodeIcon, Calendar, User as UserIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { displaySize } from "@/lib/product-format";
import { originPalette } from "@/lib/origin-colors";
import { PageHeader } from "@/components/app/PageHeader";

export const Route = createFileRoute("/_authenticated/products_/$productId")({
  component: ProductDetailPage,
});

type Tab = "overview" | "history" | "location";

function ProductDetailPage() {
  const { productId } = Route.useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("overview");

  const { data: product, isLoading } = useQuery({
    queryKey: ["product-page", productId],
    queryFn: async () =>
      (await supabase.from("products").select("*, categories(name)").eq("id", productId).maybeSingle()).data,
  });

  const { data: history = [] } = useQuery({
    queryKey: ["product-page-history", productId],
    queryFn: async () =>
      (await supabase
        .from("stock_movements")
        .select("id, type, quantity, reason, destination, user_id, created_at")
        .eq("product_id", productId)
        .order("created_at", { ascending: false })
        .limit(200)).data ?? [],
  });

  const userIds = Array.from(new Set((history as any[]).map((m) => m.user_id).filter(Boolean)));
  const { data: users = [] } = useQuery({
    queryKey: ["product-page-users", userIds.join(",")],
    enabled: userIds.length > 0,
    queryFn: async () =>
      (await supabase.from("profiles").select("id, full_name, email").in("id", userIds)).data ?? [],
  });
  const userById = new Map((users as any[]).map((u) => [u.id, u.full_name || u.email || "Unknown"]));

  const { data: related = [] } = useQuery({
    queryKey: ["product-page-related", product?.category_id, productId],
    enabled: !!product?.category_id,
    queryFn: async () =>
      (await supabase
        .from("products")
        .select("id, name, sku, stock, low_stock_threshold, image_url, origin")
        .eq("category_id", product!.category_id as string)
        .neq("id", productId)
        .limit(4)).data ?? [],
  });

  // 7-day stats
  const sevenDays = useMemo(() => {
    const cutoff = subDays(new Date(), 7);
    const recent = (history as any[]).filter((m) => new Date(m.created_at) >= cutoff);
    const inQty = recent.filter((m) => m.type === "in").reduce((s, m) => s + m.quantity, 0);
    const outQty = recent.filter((m) => m.type === "out").reduce((s, m) => s + m.quantity, 0);
    // bucket per day for chart
    const days: { label: string; in: number; out: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = startOfDay(subDays(new Date(), i));
      const next = subDays(d, -1);
      const dayMoves = recent.filter((m) => {
        const t = new Date(m.created_at);
        return t >= d && t < next;
      });
      days.push({
        label: format(d, "EEE"),
        in: dayMoves.filter((m) => m.type === "in").reduce((s, m) => s + m.quantity, 0),
        out: dayMoves.filter((m) => m.type === "out").reduce((s, m) => s + m.quantity, 0),
      });
    }
    return { inQty, outQty, days };
  }, [history]);

  if (isLoading || !product) {
    return (
      <div className="p-6 max-w-[1280px] mx-auto">
        <div className="text-sm text-muted-foreground">Loading product…</div>
      </div>
    );
  }

  const p: any = product;
  const stock = p.stock ?? 0;
  const threshold = p.low_stock_threshold ?? 5;
  const isOut = stock <= 0;
  const isLow = !isOut && stock <= threshold;
  const toneKey: "success" | "warning" | "destructive" = isOut ? "destructive" : isLow ? "warning" : "success";
  const toneLabel = isOut ? "Out of stock" : isLow ? "Low stock" : "In stock";
  const palette = originPalette(p.origin);
  const suggested = Math.max(0, threshold * 2 - stock);
  const netSeven = sevenDays.inQty - sevenDays.outQty;

  // Fallback location label — when rack/shelf aren't assigned yet we still
  // want to surface a meaningful place (Kawaguchi warehouse) instead of "— · —".
  const rackLabel = p.rack ?? "Kawaguchi";
  const shelfLabel = (p.shelf ?? "Main").toString().toUpperCase();
  const locationLabel = `${rackLabel} · ${shelfLabel}`;

  return (
    <div className="px-4 md:px-8 py-5 max-w-[1280px] mx-auto pb-16">
      {/* Back / actions */}
      <div className="flex items-center gap-2 mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/products" })} className="-ml-2 shrink-0">
          <ChevronLeft className="size-4" />
          <span className="hidden sm:inline">All products</span>
        </Button>
        <div className="flex-1" />
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="secondary" size="sm" className="px-2 sm:px-3" title="Print label">
            <QrCode className="size-3.5" />
            <span className="hidden sm:inline">Print label</span>
          </Button>
          <Button variant="secondary" size="sm" className="px-2 sm:px-3" title="Edit">
            <Pencil className="size-3.5" />
            <span className="hidden sm:inline">Edit</span>
          </Button>
        </div>
      </div>

      {/* HERO */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-[var(--shadow-card)] mb-5">
        <div className="grid md:grid-cols-[420px_1fr]">
          {/* Image / origin-band */}
          <div
            className="relative min-h-[280px] md:min-h-[360px] grid place-items-center overflow-hidden"
            style={{ background: palette.background, color: palette.foreground }}
          >
            <div
              className="absolute inset-0 opacity-60"
              style={{
                backgroundImage:
                  "radial-gradient(circle at 20% 20%, rgba(255,255,255,0.18) 0%, transparent 45%), radial-gradient(circle at 80% 80%, rgba(0,0,0,0.18) 0%, transparent 55%)",
              }}
            />
            {p.image_url ? (
              <img
                src={p.image_url}
                alt={p.name}
                className="relative max-h-[260px] max-w-[260px] object-contain drop-shadow-[0_20px_30px_rgba(0,0,0,0.35)]"
              />
            ) : (
              <div className="relative w-[200px] h-[220px] rounded-lg border-2 border-black/20 shadow-2xl p-5 flex flex-col justify-between"
                style={{ background: `linear-gradient(180deg, ${palette.background}, rgba(0,0,0,0.25))` }}>
                <div className="size-14 rounded-full bg-white/25 backdrop-blur grid place-items-center border border-white/40">
                  <Package className="size-7" />
                </div>
                <div>
                  <div className="text-xs font-semibold leading-tight drop-shadow">{p.name.split(" ").slice(0, 4).join(" ")}</div>
                  {p.barcode && <div className="font-mono text-[10px] opacity-80 mt-1.5">{p.barcode}</div>}
                </div>
              </div>
            )}
            <div className="absolute left-4 bottom-4 flex items-center gap-1.5 text-[10px] font-mono tracking-[0.15em] opacity-90">
              <Package className="size-3" /> {palette.label.toUpperCase()}
            </div>
          </div>

          {/* Info */}
          <div className="p-6 md:p-7 flex flex-col">
            <div className="flex flex-wrap items-center gap-1.5 mb-3">
              <span className="chip chip-pri"><MapPin className="size-3" /> {locationLabel}</span>
              {p.categories?.name && <span className="chip">{p.categories.name}</span>}
              <span className={`chip chip-${isOut ? "bad" : isLow ? "warn" : "ok"}`}>
                <span className="chip-dot" /> {toneLabel}
              </span>
              {displaySize(p) && <span className="chip chip-acc">{displaySize(p)}</span>}
            </div>

            <h1 className="text-[28px] md:text-[34px] font-semibold tracking-[-0.025em] leading-[1.1]">{p.name}</h1>
            <div className="flex flex-wrap items-center gap-3 font-mono text-[13px] text-muted-foreground mt-2">
              <span className="text-primary">{p.sku ?? "—"}</span>
              <span className="opacity-60">·</span>
              <span className="break-all">{p.barcode ?? "no barcode"}</span>
            </div>

            <div className="flex flex-wrap items-end gap-5 mt-6">
              <div>
                <div className="upper-label mb-1">Current stock</div>
                <div className="flex items-baseline gap-2">
                  <span className={cn("num-xl", `text-${toneKey}`)}>{stock}</span>
                  <span className="text-muted-foreground text-sm">units</span>
                </div>
              </div>
              <div className="h-12 w-px bg-border" />
              <div>
                <div className="upper-label mb-1">Threshold</div>
                <div className="num-l text-muted-foreground">{threshold}</div>
              </div>
              <div className="h-12 w-px bg-border" />
              <div>
                <div className="upper-label mb-1">Suggested order</div>
                <div className="num-l text-primary">+{suggested}</div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 mt-6">
              <Button asChild className="flex-1 min-w-[140px] gradient-primary text-primary-foreground border-0">
                <Link to="/stock-in"><ArrowUpRight className="size-4" /> Stock in</Link>
              </Button>
              <Button asChild variant="secondary" className="flex-1 min-w-[140px]">
                <Link to="/stock-out"><ArrowDownRight className="size-4" /> Stock out</Link>
              </Button>
              <Button asChild variant="secondary" size="icon"><Link to="/shipments"><Truck className="size-4" /></Link></Button>
              {p.rack && (
                <Button asChild variant="secondary" size="icon" title="Open in rack view">
                  <Link to="/racks/$rackId" params={{ rackId: p.rack }}><Warehouse className="size-4" /></Link>
                </Button>
              )}
            </div>

            <div className="flex-1" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mt-6">
              <Mini label="In 7d" value={`+${sevenDays.inQty}`} tone="text-success" />
              <Mini label="Out 7d" value={`−${sevenDays.outQty}`} tone="text-destructive" />
              <Mini label="Net 7d" value={`${netSeven >= 0 ? "+" : ""}${netSeven}`} tone="text-foreground" />
              <Mini
                label="Days cover"
                value={sevenDays.outQty ? `${Math.round(stock / (sevenDays.outQty / 7))}d` : "—"}
                tone="text-accent"
              />
            </div>
          </div>
        </div>
      </div>

      {/* TABS */}
      <div className="flex gap-1 border-b border-border mb-5">
        {([
          { id: "overview", label: "Overview" },
          { id: "history", label: `History (${history.length})` },
          { id: "location", label: "Location" },
        ] as { id: Tab; label: string }[]).map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors",
                active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "overview" && (
        <OverviewTab p={p} related={related as any[]} history={history as any[]} userById={userById} sevenDays={sevenDays} locationLabel={locationLabel} />
      )}
      {tab === "history" && <HistoryTab history={history as any[]} userById={userById} />}
      {tab === "location" && <LocationTab p={p} rackLabel={rackLabel} shelfLabel={shelfLabel} />}
    </div>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-xl border border-border bg-secondary/40 p-2.5">
      <div className="upper-label" style={{ fontSize: 9.5 }}>{label}</div>
      <div className={cn("num-m mt-1", tone)}>{value}</div>
    </div>
  );
}

function OverviewTab({
  p, related, history, userById, sevenDays, locationLabel,
}: { p: any; related: any[]; history: any[]; userById: Map<string, string>; sevenDays: { inQty: number; outQty: number; days: { label: string; in: number; out: number }[] }; locationLabel: string }) {
  const navigate = useNavigate();
  const net = sevenDays.inQty - sevenDays.outQty;
  return (
    <div className="grid lg:grid-cols-[1fr_360px] gap-5">
      <div className="flex flex-col gap-4">
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
            <div>
              <div className="upper-label">7-day flow</div>
              <div className="flex items-baseline gap-3 mt-1.5">
                <span className="num-m text-success">+{sevenDays.inQty}</span>
                <span className="text-muted-foreground">/</span>
                <span className="num-m text-destructive">−{sevenDays.outQty}</span>
                <span className="font-mono text-[11px] text-muted-foreground">NET {net >= 0 ? "+" : ""}{net}</span>
              </div>
            </div>
            <div className="flex gap-1.5">
              <span className="chip chip-ok"><span className="chip-dot" /> In</span>
              <span className="chip chip-bad"><span className="chip-dot" /> Out</span>
            </div>
          </div>
          <BigChart days={sevenDays.days} />
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="upper-label">Related in {p.categories?.name ?? "this category"}</span>
          </div>
          {related.length === 0 ? (
            <div className="text-sm text-muted-foreground italic">No related products yet.</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              {related.map((r) => {
                const t = r.stock <= 0 ? "destructive" : r.stock <= (r.low_stock_threshold ?? 5) ? "warning" : "success";
                const pal = originPalette(r.origin);
                return (
                  <button
                    key={r.id}
                    onClick={() => navigate({ to: "/products/$productId", params: { productId: r.id } })}
                    className="rounded-xl border border-border bg-secondary/40 p-2.5 text-left hover:border-primary/40 transition-colors"
                  >
                    <div className="aspect-square rounded-md mb-2 overflow-hidden grid place-items-center" style={{ background: pal.background }}>
                      {r.image_url ? (
                        <img src={r.image_url} alt={r.name} className="w-full h-full object-contain" loading="lazy" />
                      ) : (
                        <Package className="size-8" style={{ color: pal.foreground }} />
                      )}
                    </div>
                    <div className="text-xs font-semibold leading-tight line-clamp-2 h-[30px]">{r.name}</div>
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="font-mono text-[10px] text-muted-foreground truncate">{r.sku ?? "—"}</span>
                      <span className={cn("text-sm font-semibold", `text-${t}`)}>{r.stock}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT */}
      <div className="flex flex-col gap-4">
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="upper-label mb-3">Identification</div>
          <KV k="SKU" v={p.sku ?? "—"} mono />
          <KV k="Barcode" v={p.barcode ?? "—"} mono />
          <KV k="Category" v={p.categories?.name ?? "Uncategorized"} />
          <KV k="Location" v={locationLabel} mono />
          <KV k="Threshold" v={`${p.low_stock_threshold ?? 5} units`} mono last={!p.barcode} />
          {p.barcode && (
            <div className="mt-3 p-3 bg-white text-black rounded-lg border border-border">
              <BarcodeImage code={p.barcode} />
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="upper-label">Last events</span>
            <span className="font-mono text-[11px] text-muted-foreground">{history.length} TOTAL</span>
          </div>
          {history.length === 0 ? (
            <div className="text-sm text-muted-foreground italic">No events yet.</div>
          ) : (
            <div className="flex flex-col gap-2">
              {history.slice(0, 6).map((m) => (
                <div key={m.id} className="flex items-center gap-2.5 p-2 rounded-lg bg-secondary/40">
                  <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold",
                    m.type === "in" ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive")}>
                    {m.type === "in" ? "+" : "−"}{m.quantity}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{m.reason || (m.type === "in" ? "Stock in" : "Stock out")}</div>
                    <div className="font-mono text-[10px] text-muted-foreground truncate">
                      {userById.get(m.user_id) ?? "Unknown"} · {formatDistanceToNow(new Date(m.created_at), { addSuffix: true })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function KV({ k, v, mono, last }: { k: string; v: string; mono?: boolean; last?: boolean }) {
  return (
    <div className={cn("flex items-center py-2 text-[12.5px]", !last && "border-b border-border")}>
      <span className="w-[100px] upper-label" style={{ fontSize: 10.5 }}>{k}</span>
      <span className={cn("font-medium break-all", mono && "font-mono")}>{v}</span>
    </div>
  );
}

function BarcodeImage({ code }: { code: string }) {
  const ref = useRef<SVGSVGElement | null>(null);
  useEffect(() => {
    if (!ref.current || !code) return;
    try {
      const onlyDigits = /^\d+$/.test(code);
      const fmt = onlyDigits && code.length === 13 ? "EAN13" : onlyDigits && code.length === 8 ? "EAN8" : "CODE128";
      JsBarcode(ref.current, code, { format: fmt, displayValue: true, fontSize: 14, height: 56, width: 1.8, margin: 0 });
    } catch {
      try { JsBarcode(ref.current, code, { format: "CODE128", displayValue: true, height: 56, margin: 0 }); } catch { /* noop */ }
    }
  }, [code]);
  return <svg ref={ref} className="w-full" />;
}

function BigChart({ days }: { days: { label: string; in: number; out: number }[] }) {
  const max = Math.max(1, ...days.flatMap((d) => [d.in, d.out]));
  return (
    <div className="flex items-end gap-3 h-[170px] px-2">
      {days.map((d, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1">
          <div className="flex items-end gap-1 h-[140px]">
            <div className="relative w-3 rounded-t-md bg-gradient-to-b from-success to-success/60"
              style={{ height: `${(d.in / max) * 130 || 2}px` }}>
              {d.in > 0 && (
                <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[10px] font-mono font-bold text-success">{d.in}</span>
              )}
            </div>
            <div className="relative w-3 rounded-t-md bg-gradient-to-b from-destructive to-destructive/60"
              style={{ height: `${(d.out / max) * 130 || 2}px` }}>
              {d.out > 0 && (
                <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[10px] font-mono font-bold text-destructive">{d.out}</span>
              )}
            </div>
          </div>
          <span className="font-mono text-[10.5px] text-muted-foreground">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

function HistoryTab({ history, userById }: { history: any[]; userById: Map<string, string> }) {
  if (history.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">No history</div>
    );
  }
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="hidden md:flex px-5 py-2.5 border-b border-border text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
        <div className="w-[90px]">Type</div>
        <div className="w-[90px] text-right">Qty</div>
        <div className="flex-1 pl-5">Reason</div>
        <div className="flex-1">Destination</div>
        <div className="w-[140px]">Operator</div>
        <div className="w-[130px]">When</div>
      </div>
      {history.map((m, i) => (
        <div key={m.id} className={cn("flex flex-wrap md:flex-nowrap items-center px-5 py-3 gap-2", i !== history.length - 1 && "border-b border-border")}>
          <div className="md:w-[90px]">
            <span className={cn("chip", m.type === "in" ? "chip-ok" : "chip-bad")}>
              {m.type === "in" ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
              {m.type.toUpperCase()}
            </span>
          </div>
          <div className="md:w-[90px] md:text-right num-m">
            <span className={m.type === "in" ? "text-success" : "text-destructive"}>{m.type === "in" ? "+" : "−"}{m.quantity}</span>
          </div>
          <div className="flex-1 md:pl-5 text-sm w-full md:w-auto">{m.reason || "—"}</div>
          <div className="flex-1 text-[12.5px] text-muted-foreground w-full md:w-auto">{m.destination || "—"}</div>
          <div className="md:w-[140px] text-[12.5px]">{userById.get(m.user_id) ?? "Unknown"}</div>
          <div className="md:w-[130px] font-mono text-[11px] text-muted-foreground">{formatDistanceToNow(new Date(m.created_at), { addSuffix: true })}</div>
        </div>
      ))}
    </div>
  );
}

function LocationTab({ p }: { p: any }) {
  const shelves = ["upper", "mid", "down"] as const;
  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <div className="flex flex-wrap gap-6 items-start">
        <div className="flex-1 min-w-[260px]">
          <div className="upper-label">Stored at</div>
          <div className="flex items-end gap-4 mt-2">
            <div className="num-l font-mono text-primary">{p.rack ?? "—"}</div>
            <div className="pb-1.5 text-muted-foreground">/</div>
            <div className="num-l font-mono text-accent uppercase">{p.shelf ?? "—"}</div>
          </div>
          <p className="text-sm text-muted-foreground mt-3 max-w-[420px]">
            {p.rack
              ? `${p.shelf ?? "—"} shelf of rack ${p.rack}. Open the 3D rack view to see the full layout.`
              : "This product has no rack assigned yet."}
          </p>
          <div className="flex flex-wrap gap-2 mt-4">
            {p.rack && (
              <Button asChild className="gradient-primary text-primary-foreground border-0">
                <Link to="/racks/$rackId" params={{ rackId: p.rack }}>
                  <Warehouse className="size-4" /> Open in rack view
                </Link>
              </Button>
            )}
            <Button asChild variant="secondary"><Link to="/racks"><MapPin className="size-4" /> Change location</Link></Button>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-secondary/40 p-4 min-w-[260px]">
          <div className="flex flex-col gap-2">
            {shelves.map((s, i) => {
              const active = (p.shelf ?? "").toString().toLowerCase() === s;
              return (
                <div key={s} className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg border",
                  active ? "border-primary bg-primary/5" : "border-border bg-card",
                )}>
                  <span className="font-mono text-[11px] text-primary">LV {i + 1}</span>
                  <span className="flex-1 font-semibold capitalize text-sm">{s} shelf</span>
                  {active && <span className="chip chip-pri">HERE</span>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}