import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ArrowUpRight, ArrowDownRight, ImageIcon, Activity, Truck, Store, PackagePlus, PackageMinus, ScanLine, Printer, History, Plus, Lightbulb, AlertTriangle, Package } from "lucide-react";
import { UniversalScanner } from "@/components/app/UniversalScanner";
import { AIInsightsPanel } from "@/components/app/AIInsightsPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDistanceToNow, format } from "date-fns";
import { useRealtimeSync } from "@/hooks/use-realtime-sync";
import { LiveBadge } from "@/components/app/LiveBadge";
import { SHOPS, isShop } from "@/lib/shops";
import { DEFAULT_RACK_CODES as RACK_IDS } from "@/lib/racks";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { OperatorDashboard } from "@/components/app/OperatorDashboard";

export const Route = createFileRoute("/_authenticated/dashboard")({ component: Dashboard });

function Dashboard() {
  const { role } = useAuth();
  if (role === "operator") return <OperatorDashboard />;
  return <AdminDashboard />;
}

function AdminDashboard() {
  const { lastUpdated } = useRealtimeSync();
  const { fullName, user } = useAuth();
  const [scanOpen, setScanOpen] = useState(false);
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await supabase.from("products").select("*, categories(name, parent_id)").order("created_at", { ascending: false })).data ?? [],
  });
  const { data: movements = [] } = useQuery({
    queryKey: ["movements-recent"],
    queryFn: async () => (await supabase.from("stock_movements").select("*, products(name, image_url)").order("created_at", { ascending: false }).limit(30)).data ?? [],
  });
  const { data: profiles = [] } = useQuery({
    queryKey: ["profiles-all"],
    queryFn: async () => (await supabase.from("profiles").select("id, email, full_name")).data ?? [],
  });
  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => (await supabase.from("categories").select("*")).data ?? [],
  });
  const { data: recentBarcodes = [] } = useQuery({
    queryKey: ["recent-barcodes"],
    queryFn: async () => (await supabase.from("products")
      .select("id, name, barcode, image_url, barcode_registered_at, barcode_registered_by")
      .not("barcode_registered_at", "is", null)
      .order("barcode_registered_at", { ascending: false }).limit(15)).data ?? [],
  });
  const { data: shipments = [] } = useQuery({
    queryKey: ["shipments"],
    queryFn: async () => (await supabase.from("order_requests").select("id, status, arrived_at")).data ?? [],
  });
  const pendingShipmentCount = shipments.filter((s: any) => !s.arrived_at && (s.status === "approved" || s.status === "backordered")).length;
  const containersCount = shipments.filter((s: any) => !s.arrived_at && s.status !== "declined").length;

  const total = products.length;
  const out = products.filter((p: any) => p.stock <= 0).length;
  const low = products.filter((p: any) => p.stock > 0 && p.stock <= p.low_stock_threshold).length;
  const lowList = products.filter((p: any) => p.stock <= p.low_stock_threshold);

  // Racks occupancy: distinct racks with at least 1 product
  const racksWithItems = new Set(
    (products as any[]).map((p) => (p.rack ?? "").trim()).filter(Boolean),
  );
  const racksUsed = racksWithItems.size;
  const racksTotal = RACK_IDS.length;

  // Activity in last 24h / 7d
  const now = Date.now();
  const last24 = movements.filter((m: any) => now - new Date(m.created_at).getTime() < 86400000);
  const stockedIn24 = last24.filter((m: any) => m.type === "in").reduce((s: number, m: any) => s + m.quantity, 0);
  const stockedOut24 = last24.filter((m: any) => m.type === "out").reduce((s: number, m: any) => s + m.quantity, 0);

  // Stock-out destination breakdown
  const outMoves = movements.filter((m: any) => m.type === "out");
  const destTotals = outMoves.reduce((acc: Record<string, number>, m: any) => {
    const key = m.destination || "Unspecified";
    acc[key] = (acc[key] || 0) + m.quantity;
    return acc;
  }, {});
  const destEntries = Object.entries(destTotals).sort((a, b) => b[1] - a[1]);
  const destMax = Math.max(1, ...destEntries.map(([, v]) => v));
  const totalOutQty = outMoves.reduce((s: number, m: any) => s + m.quantity, 0);

  // Per-shop stock-out tracker
  const shopTotals: Record<string, number> = Object.fromEntries(SHOPS.map((s) => [s, 0]));
  for (const m of outMoves) {
    if (isShop(m.destination)) shopTotals[m.destination] += m.quantity;
  }
  const shopTotal = Object.values(shopTotals).reduce((a, b) => a + b, 0);
  const topShop = Object.entries(shopTotals).sort((a, b) => b[1] - a[1])[0];

  // Top products per destination
  const topByDest: Record<string, { id: string; name: string; qty: number; image?: string }[]> = {};
  for (const [dest] of destEntries) {
    const map = new Map<string, { id: string; name: string; qty: number; image?: string }>();
    outMoves
      .filter((m: any) => (m.destination || "Unspecified") === dest)
      .forEach((m: any) => {
        const id = m.product_id;
        const name = m.products?.name ?? "—";
        const cur = map.get(id) ?? { id, name, qty: 0, image: m.products?.image_url };
        cur.qty += m.quantity;
        map.set(id, cur);
      });
    topByDest[dest] = [...map.values()].sort((a, b) => b.qty - a.qty).slice(0, 5);
  }

  // Filter state for activity feed
  const [destFilter, setDestFilter] = useState<"all" | "Delivery" | "Shops">("all");
  const [openDest, setOpenDest] = useState<string | null>(null);
  const [drill, setDrill] = useState<{ destination: string; productId: string; productName: string; image?: string } | null>(null);

  const { data: drillEvents = [], isLoading: drillLoading } = useQuery({
    queryKey: ["drill-events", drill?.destination, drill?.productId],
    enabled: !!drill,
    queryFn: async () => {
      const { data } = await supabase
        .from("stock_movements")
        .select("id, created_at, quantity, reason, user_id")
        .eq("type", "out")
        .eq("destination", drill!.destination)
        .eq("product_id", drill!.productId)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const profileMap = new Map(profiles.map((p: any) => [p.id, p.full_name || p.email || "Unknown"]));

  // Combined activity feed: stock movements + barcode registrations
  const activity = [
    ...movements.map((m: any) => ({
      kind: m.type === "in" ? "stock_in" : "stock_out",
      id: `mv-${m.id}`,
      when: m.created_at,
      who: profileMap.get(m.user_id) ?? "System",
      product: m.products?.name ?? "—",
      image: m.products?.image_url,
      quantity: m.quantity,
      reason: m.reason,
      destination: m.destination,
    })),
  ].sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime()).slice(0, 30);

  const filteredActivity = destFilter === "all"
    ? activity
    : activity.filter((a: any) => {
        if (a.kind !== "stock_out") return false;
        if (destFilter === "Delivery") return a.destination === "Delivery";
        if (destFilter === "Shops") return isShop(a.destination);
        return false;
      });

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      {/* Greeting header */}
      <DashboardGreeting
        name={fullName ?? user?.email?.split("@")[0] ?? "there"}
        stockedIn24={stockedIn24}
        stockedOut24={stockedOut24}
        events24={last24.length}
        lastUpdated={lastUpdated}
      />

      {/* Quick actions — Stock In / Stock Out / Scan */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-6">
        <Link to="/stock-in" className="block">
          <button className="w-full h-14 sm:h-16 rounded-2xl border border-success/30 bg-success/10 hover:bg-success/15 text-success font-semibold inline-flex items-center justify-center gap-2 transition active:scale-[0.98]">
            <PackagePlus className="size-5" /> <span className="hidden sm:inline">Stock In</span><span className="sm:hidden">In</span>
          </button>
        </Link>
        <Link to="/stock-out" className="block">
          <button className="w-full h-14 sm:h-16 rounded-2xl border border-destructive/30 bg-destructive/10 hover:bg-destructive/15 text-destructive font-semibold inline-flex items-center justify-center gap-2 transition active:scale-[0.98]">
            <PackageMinus className="size-5" /> <span className="hidden sm:inline">Stock Out</span><span className="sm:hidden">Out</span>
          </button>
        </Link>
        <button
          onClick={() => setScanOpen(true)}
          className="w-full h-14 sm:h-16 rounded-2xl gradient-primary text-primary-foreground font-semibold inline-flex items-center justify-center gap-2 transition active:scale-[0.98] shadow-[0_8px_24px_-12px_rgba(0,0,0,0.4)]"
        >
          <ScanLine className="size-5" /> <span className="hidden sm:inline">Scan QR / Barcode</span><span className="sm:hidden">Scan</span>
        </button>
      </div>

      {/* Stat cards — visual style per handoff screenshot */}
      <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4 mb-6">
        <KpiCard
          to="/products"
          search={{ filter: "all" }}
          label="Total products"
          value={total.toLocaleString()}
          hint={`+${stockedIn24} this week`}
          tone="success"
          visual={<Sparkline tone="success" />}
        />
        <KpiCard
          to="/racks"
          label="Racks occupied"
          value={
            <>
              <span>{racksUsed}</span>
              <span className="text-muted-foreground"> / {racksTotal}</span>
            </>
          }
          hint={racksUsed < racksTotal ? `${racksTotal - racksUsed} empty` : "All in use"}
          tone="success"
          visual={<RackBars used={racksUsed} total={racksTotal} />}
        />
        <KpiCard
          to="/products"
          search={{ filter: "low" }}
          label="Low + Out of stock"
          value={(low + out).toString()}
          hint={`${out} out · ${low} low`}
          tone="warning"
          visual={<Sparkline tone="warning" bars />}
        />
        <KpiCard
          to="/shops"
          label="Shop deliveries (24h)"
          value={stockedOut24.toLocaleString()}
          hint={topShop && topShop[1] > 0 ? `Top: ${topShop[0]}` : "No deliveries yet"}
          tone="warning"
          visual={<Sparkline tone="warning" />}
        />
      </div>

      {/* AI insights */}
      <div className="mb-6">
        <AIInsightsPanel />
      </div>

      <Tabs defaultValue="activity">
        <TabsList className="h-auto p-1 gap-1 bg-card border border-border rounded-[14px]">
          <TabsTrigger value="activity" className="gap-2 rounded-[10px] data-[state=active]:bg-secondary/60">
            <Activity className="size-4" /> Recent Activity
            <span className="ml-1 text-[11px] text-muted-foreground tabular-nums">{activity.length}</span>
          </TabsTrigger>
          <TabsTrigger value="low" className="gap-2 rounded-[10px] data-[state=active]:bg-secondary/60">
            <AlertTriangle className="size-4" /> Low Stock
            {(low + out) > 0 && (
              <span className="ml-1 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-destructive/20 text-destructive text-[10px] font-bold tabular-nums">
                {low + out}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="products" className="gap-2 rounded-[10px] data-[state=active]:bg-secondary/60">
            <Package className="size-4" /> Product List
            <span className="ml-1 text-[11px] text-muted-foreground tabular-nums">{total}</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="activity">
          <div className="flex items-center gap-2 mt-3 mb-2 flex-wrap">
            <span className="text-xs text-muted-foreground mr-1">Filter:</span>
            {([
              { k: "all", label: "All", Icon: Activity },
              { k: "Delivery", label: "Delivery", Icon: Truck },
              { k: "Shops", label: "Shops", Icon: Store },
            ] as const).map(({ k, label, Icon }) => (
              <button
                key={k}
                type="button"
                onClick={() => setDestFilter(k)}
                className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium border transition ${
                  destFilter === k
                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                    : "bg-secondary/40 border-border hover:bg-secondary"
                }`}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
            {destFilter !== "all" && (
              <span className="text-xs text-muted-foreground ml-1">{filteredActivity.length} stock-out events</span>
            )}
          </div>
          <Card className="card-elevated p-0 overflow-hidden">
            <div className="divide-y divide-border max-h-[560px] overflow-auto">
              {filteredActivity.length === 0 && <p className="text-center text-muted-foreground py-12">No activity</p>}
              {filteredActivity.map((a: any) => (
                <div key={a.id} className="flex items-center gap-3 p-3 sm:p-4 hover:bg-secondary/30">
                  {a.image ? (
                    <img src={a.image} alt="" className="size-10 rounded-lg object-cover border border-border shrink-0" />
                  ) : (
                    <div className="size-10 rounded-lg bg-secondary grid place-items-center text-muted-foreground border border-border shrink-0"><ImageIcon className="size-4" /></div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {a.kind === "stock_in" && <Badge className="bg-success/15 text-success border-success/30 hover:bg-success/15"><ArrowUpRight className="size-3" /> +{a.quantity}</Badge>}
                      {a.kind === "stock_out" && <Badge className="bg-destructive/15 text-destructive border-destructive/30 hover:bg-destructive/15"><ArrowDownRight className="size-3" /> -{a.quantity}</Badge>}
                      <span className="font-medium truncate">{a.product}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                      {a.kind === "stock_out" && a.destination && (
                        <span className={`inline-flex items-center gap-1 font-semibold ${a.destination === "Delivery" ? "text-primary" : "text-warning"}`}>
                          {a.destination === "Delivery" ? <Truck className="size-3" /> : <Store className="size-3" />}
                          {a.destination}
                        </span>
                      )}
                      {a.kind === "stock_out" && a.destination && (a.reason || a.who) && <span>·</span>}
                      <span>{a.reason || (a.kind === "stock_in" ? "Stock in" : "Stock out")}</span>
                      <span>·</span>
                      <span>by <span className="text-foreground font-medium">{a.who}</span></span>
                    </div>
                  </div>
                  <div className="text-[11px] text-muted-foreground text-right shrink-0">
                    <div>{formatDistanceToNow(new Date(a.when), { addSuffix: true })}</div>
                    <div className="hidden sm:block">{format(new Date(a.when), "MMM d, p")}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="products">
          <ProductListTable products={products} />
        </TabsContent>

        <TabsContent value="low">
          <Card className="card-elevated p-0 overflow-hidden">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Name</TableHead><TableHead>Stock</TableHead><TableHead>Threshold</TableHead><TableHead>Status</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {lowList.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-12">All products well stocked</TableCell></TableRow>}
                {lowList.map((p: any) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>{p.stock}</TableCell>
                    <TableCell>{p.low_stock_threshold}</TableCell>
                    <TableCell><StockStatus stock={p.stock} threshold={p.low_stock_threshold} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!drill} onOpenChange={(o) => !o && setDrill(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {drill?.image ? (
                <img src={drill.image} alt="" className="size-9 rounded object-cover border border-border" />
              ) : (
                <div className="size-9 rounded bg-secondary grid place-items-center text-muted-foreground border border-border"><ImageIcon className="size-4" /></div>
              )}
              <div className="min-w-0">
                <div className="truncate text-base">{drill?.productName}</div>
                <div className="text-xs font-normal text-muted-foreground inline-flex items-center gap-1">
                  {drill?.destination === "Delivery" ? <Truck className="size-3" /> : <Store className="size-3" />}
                  {drill?.destination} stock-out events
                </div>
              </div>
            </DialogTitle>
          </DialogHeader>
          <div className="border-t border-border -mx-6 px-6 pt-3">
            {drillLoading && <p className="text-center text-muted-foreground py-8 text-sm">Loading…</p>}
            {!drillLoading && drillEvents.length === 0 && <p className="text-center text-muted-foreground py-8 text-sm">No events found</p>}
            {!drillLoading && drillEvents.length > 0 && (
              <>
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                  <span>{drillEvents.length} events</span>
                  <span className="font-semibold text-foreground tabular-nums">
                    Total: {drillEvents.reduce((s: number, e: any) => s + e.quantity, 0)} units
                  </span>
                </div>
                <div className="max-h-[400px] overflow-auto divide-y divide-border rounded-lg border border-border">
                  {drillEvents.map((e: any) => (
                    <div key={e.id} className="flex items-center gap-3 p-3 text-sm">
                      <Badge className="bg-destructive/15 text-destructive border-destructive/30 hover:bg-destructive/15 tabular-nums">−{e.quantity}</Badge>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{e.reason || "—"}</div>
                        <div className="text-xs text-muted-foreground">by {profileMap.get(e.user_id) ?? "System"}</div>
                      </div>
                      <div className="text-xs text-muted-foreground text-right shrink-0">
                        <div>{format(new Date(e.created_at), "MMM d, yyyy")}</div>
                        <div>{format(new Date(e.created_at), "p")}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <UniversalScanner open={scanOpen} onClose={() => setScanOpen(false)} />
    </div>
  );
}

function ProductRow({ p }: { p: any }) {
  return (
    <TableRow>
      <TableCell className="font-mono text-xs text-muted-foreground">{p.sku ?? "—"}</TableCell>
      <TableCell className="font-medium">{p.name}</TableCell>
      <TableCell>{p.stock}</TableCell>
      <TableCell><StockStatus stock={p.stock} threshold={p.low_stock_threshold} /></TableCell>
    </TableRow>
  );
}

export function StockStatus({ stock, threshold }: { stock: number; threshold: number }) {
  if (stock <= 0) return <Badge className="bg-destructive/15 text-destructive border-destructive/30 hover:bg-destructive/15">Out of stock</Badge>;
  if (stock <= threshold) return <Badge className="bg-warning/15 text-warning border-warning/30 hover:bg-warning/15">Low stock</Badge>;
  return <Badge className="bg-success/15 text-success border-success/30 hover:bg-success/15">In stock</Badge>;
}

/* ====================== Header greeting ====================== */
function greetingPart(d = new Date()) {
  const h = d.getHours();
  if (h < 5) return "Good night";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 22) return "Good evening";
  return "Good night";
}

function DashboardGreeting({
  name, stockedIn24, stockedOut24, events24, lastUpdated,
}: { name: string; stockedIn24: number; stockedOut24: number; events24: number; lastUpdated: Date | null }) {
  const first = name.split(/[\s.@]+/)[0] ?? name;
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-7">
      <div className="min-w-0">
        <div className="upper-label">{format(new Date(), "EEEE · MMM d").toUpperCase()}</div>
        <h1 className="text-[34px] md:text-[44px] font-semibold tracking-[-0.03em] leading-[1.05] mt-1">
          {greetingPart()}, {first}.
        </h1>
        <p className="mt-2 text-[14px] text-muted-foreground">
          <span className="text-success font-semibold">+{stockedIn24}</span> in
          <span className="mx-1">/</span>
          <span className="text-destructive font-semibold">−{stockedOut24}</span> out in the last 24h
          <span className="mx-1.5">·</span>
          <span className="text-foreground font-semibold tabular-nums">{events24}</span> events
        </p>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {lastUpdated && <LiveBadge lastUpdated={lastUpdated} />}
        <Link to="/racks/print" className="inline-flex items-center gap-2 h-10 px-3.5 rounded-[12px] border border-border bg-card hover:bg-secondary/60 text-[13px] font-semibold transition">
          <Printer className="size-4" /> Print QR sheet
        </Link>
        <Link to="/reports" className="inline-flex items-center gap-2 h-10 px-3.5 rounded-[12px] border border-border bg-card hover:bg-secondary/60 text-[13px] font-semibold transition">
          <History className="size-4" /> Reports
        </Link>
        <Link to="/stock-in" className="inline-flex items-center gap-2 h-10 px-3.5 rounded-[12px] gradient-primary text-primary-foreground text-[13px] font-semibold transition hover:opacity-95">
          <Plus className="size-4" /> Stock movement
        </Link>
      </div>
    </div>
  );
}

/* ====================== KPI card ====================== */
function KpiCard({
  to, search, label, value, hint, tone = "success", visual,
}: {
  to: string;
  search?: any;
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "success" | "warning";
  visual?: React.ReactNode;
}) {
  const valueCls = tone === "warning" ? "text-warning" : "text-success";
  return (
    <Link to={to as any} search={search} className="block group">
      <Card className="card-elevated relative overflow-hidden p-4 sm:p-5 rounded-[18px] hover:-translate-y-0.5 transition-all">
        <div className="flex items-start justify-between gap-2">
          <div className="upper-label">{label}</div>
          <ArrowUpRight className="size-4 text-muted-foreground group-hover:text-foreground transition" />
        </div>
        <div className="mt-3 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className={`text-[40px] leading-none font-semibold tracking-[-0.03em] tabular-nums ${valueCls}`}>
              {value}
            </div>
            {hint && <div className="text-[11px] text-muted-foreground mt-2">{hint}</div>}
          </div>
          {visual && <div className="shrink-0 opacity-90">{visual}</div>}
        </div>
      </Card>
    </Link>
  );
}

/* ====================== Sparkline ====================== */
function Sparkline({ tone = "success", bars = false }: { tone?: "success" | "warning"; bars?: boolean }) {
  const stroke = tone === "warning" ? "var(--warning, #f59e0b)" : "var(--success, #10b981)";
  if (bars) {
    const heights = [10, 16, 12, 22, 14, 26, 18, 30, 24];
    return (
      <svg width="92" height="36" viewBox="0 0 92 36">
        {heights.map((h, i) => (
          <rect key={i} x={i * 10} y={36 - h} width="6" height={h} rx="2" fill={stroke} opacity={0.55 + (i / heights.length) * 0.45} />
        ))}
      </svg>
    );
  }
  return (
    <svg width="92" height="36" viewBox="0 0 92 36" fill="none">
      <path d="M2 28 L14 22 L24 25 L34 18 L46 20 L58 12 L70 16 L82 8 L90 11"
        stroke={stroke} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 28 L14 22 L24 25 L34 18 L46 20 L58 12 L70 16 L82 8 L90 11 L90 36 L2 36 Z"
        fill={stroke} opacity="0.12" />
    </svg>
  );
}

/* ====================== Rack bars ====================== */
function RackBars({ used, total }: { used: number; total: number }) {
  const cells = Array.from({ length: Math.max(total, 8) }).slice(0, 10);
  return (
    <div className="flex items-end gap-[3px] h-9">
      {cells.map((_, i) => {
        const isUsed = i < used;
        const empty = !isUsed;
        const lowSpot = isUsed && i === used - 1;
        const tone = empty ? "bg-muted/50" : lowSpot ? "bg-destructive" : i % 3 === 0 ? "bg-warning" : "bg-success";
        const h = 14 + (i % 4) * 5;
        return <span key={i} className={`w-[6px] rounded-sm ${tone}`} style={{ height: h }} />;
      })}
    </div>
  );
}

/* ====================== Product list table ====================== */
const AVATAR_PALETTE = [
  "bg-rose-500/20 text-rose-400 border-rose-500/30",
  "bg-amber-500/20 text-amber-400 border-amber-500/30",
  "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  "bg-sky-500/20 text-sky-400 border-sky-500/30",
  "bg-violet-500/20 text-violet-400 border-violet-500/30",
  "bg-orange-500/20 text-orange-400 border-orange-500/30",
];
function paletteFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}
function initialsOf(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("") || "•";
}
function ProductListTable({ products }: { products: any[] }) {
  if (products.length === 0) {
    return (
      <Card className="card-elevated p-12 text-center text-muted-foreground">No products</Card>
    );
  }
  return (
    <Card className="card-elevated p-0 overflow-hidden rounded-[14px]">
      <div className="grid grid-cols-[1fr_180px_140px_180px_24px] gap-3 px-5 py-3 border-b border-border bg-secondary/30">
        <div className="upper-label">Product</div>
        <div className="upper-label">SKU / Barcode</div>
        <div className="upper-label">Rack</div>
        <div className="upper-label text-right pr-2">Stock · Status</div>
        <div />
      </div>
      <div className="divide-y divide-border max-h-[640px] overflow-auto">
        {products.map((p: any) => {
          const palette = paletteFor(p.name ?? "");
          const rackParts = (p.rack ?? "").trim().split(/[\s/·-]+/).filter(Boolean);
          const shelfLabel = p.shelf_position ?? rackParts[1] ?? "mid";
          const rackLabel = rackParts[0] ?? p.rack ?? null;
          const status = p.stock <= 0 ? "out" : p.stock <= p.low_stock_threshold ? "low" : "ok";
          const numCls = status === "out" ? "text-destructive" : status === "low" ? "text-warning" : "text-success";
          return (
            <Link
              key={p.id}
              to="/products"
              search={{ filter: "all" } as any}
              className="grid grid-cols-[1fr_180px_140px_180px_24px] gap-3 px-5 py-4 items-center hover:bg-secondary/30 transition"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className={`size-10 rounded-[10px] border grid place-items-center text-[12px] font-bold tracking-wider shrink-0 ${palette}`}>
                  {initialsOf(p.name ?? "")}
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-[14px] truncate">{p.name}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{p.categories?.name ?? "—"}</div>
                </div>
              </div>
              <div className="font-mono text-[12px] min-w-0">
                <div className="truncate text-foreground">{p.sku ?? "—"}</div>
                <div className="truncate text-muted-foreground">{p.barcode ?? "—"}</div>
              </div>
              <div>
                {rackLabel ? (
                  <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-border bg-secondary/40 text-[11px] font-mono">
                    <span className="size-3 grid place-items-center text-muted-foreground">🏠</span>
                    {rackLabel}<span className="text-muted-foreground">/</span>{shelfLabel}
                  </span>
                ) : <span className="text-[11px] text-muted-foreground">Unassigned</span>}
              </div>
              <div className="flex items-center justify-end gap-2 pr-1">
                <span className={`text-[22px] font-semibold tabular-nums ${numCls}`}>{p.stock}</span>
                <StockStatus stock={p.stock} threshold={p.low_stock_threshold} />
              </div>
              <ArrowUpRight className="size-4 text-muted-foreground rotate-45" />
            </Link>
          );
        })}
      </div>
    </Card>
  );
}
