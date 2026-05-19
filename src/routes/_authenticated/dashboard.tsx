import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { StatCard } from "@/components/app/StatCard";
import { Boxes, AlertTriangle, ArrowUpRight, ArrowDownRight, Barcode, ImageIcon, Activity, Truck, Store, Warehouse } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDistanceToNow, format } from "date-fns";
import { useRealtimeSync } from "@/hooks/use-realtime-sync";
import { LiveBadge } from "@/components/app/LiveBadge";
import { SHOPS, isShop } from "@/lib/shops";
import { RACK_IDS } from "./racks";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/dashboard")({ component: Dashboard });

function Dashboard() {
  const { lastUpdated } = useRealtimeSync();
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
      <PageHeader title="Dashboard" subtitle="Live inventory overview." actions={<LiveBadge lastUpdated={lastUpdated} />} />

      <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4 mb-6">
        <StatCard label="Total products" value={total} icon={Boxes} tone="primary" hint={`${stockedIn24}/${stockedOut24} in/out 24h`} to="/products" search={{ filter: "all" }} />
        <DashCard
          to="/racks"
          tone="primary"
          icon={Warehouse}
          label="Racks"
          value={`${racksUsed}/${racksTotal}`}
          hint="In use"
        />
        <StatCard label="Low stock" value={low + out} icon={AlertTriangle} tone={out > 0 ? "destructive" : "warning"} hint={`${out} out · ${low} low`} to="/products" search={{ filter: "low" }} />
        <DashCard
          to="/shops"
          tone="warning"
          icon={Store}
          label="Shop tracker"
          value={shopTotal.toLocaleString()}
          hint={topShop && topShop[1] > 0 ? `Top: ${topShop[0]}` : "No deliveries yet"}
        />
      </div>

      <Tabs defaultValue="activity">
        <TabsList>
          <TabsTrigger value="activity">Recent Activity</TabsTrigger>
          <TabsTrigger value="products">Product List</TabsTrigger>
          <TabsTrigger value="low">Low Stock</TabsTrigger>
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
                      {a.kind === "barcode" && <Badge className="bg-primary/15 text-primary border-primary/30 hover:bg-primary/15"><Barcode className="size-3" /> Barcode</Badge>}
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
                      {a.kind === "barcode"
                        ? <span className="font-mono">{a.barcode}</span>
                        : <span>{a.reason || (a.kind === "stock_in" ? "Stock in" : "Stock out")}</span>}
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
          <Card className="card-elevated p-0 overflow-hidden">
            <Table>
              <TableHeader><TableRow>
                <TableHead>SKU</TableHead><TableHead>Name</TableHead><TableHead>Stock</TableHead><TableHead>Status</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {products.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-12">No products</TableCell></TableRow>}
                {products.map((p: any) => <ProductRow key={p.id} p={p} />)}
              </TableBody>
            </Table>
          </Card>
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

function DashCard({
  to, tone, icon: Icon, label, value, hint,
}: { to: string; tone: "primary" | "warning"; icon: any; label: string; value: string | number; hint?: string }) {
  const toneCls = tone === "warning"
    ? "from-warning/30 to-warning/0 text-warning"
    : "from-primary/30 to-primary/0 text-primary";
  return (
    <Link to={to as any} className="block focus:outline-none focus:ring-2 focus:ring-primary/40 rounded-2xl">
      <Card className="card-elevated relative overflow-hidden p-5 cursor-pointer hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.99] transition-all">
        <div className={`absolute -top-12 -right-12 size-32 rounded-full bg-gradient-to-br blur-2xl opacity-60 ${toneCls}`} />
        <div className="relative flex items-start justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
            <div className="mt-2 text-3xl font-semibold tracking-tight">{value}</div>
            {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
          </div>
          <div className={`size-10 rounded-xl grid place-items-center bg-secondary/60 border border-border ${toneCls.split(" ").pop()}`}>
            <Icon className="size-5" />
          </div>
        </div>
      </Card>
    </Link>
  );
}
