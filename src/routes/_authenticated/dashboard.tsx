import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { StatCard } from "@/components/app/StatCard";
import { Boxes, AlertTriangle, PackageX, TrendingUp, ArrowUpRight, ArrowDownRight, Barcode, ImageIcon, FolderTree, Activity, Truck, Store } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDistanceToNow, format } from "date-fns";

export const Route = createFileRoute("/_authenticated/dashboard")({ component: Dashboard });

function Dashboard() {
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

  const total = products.length;
  const out = products.filter((p: any) => p.stock <= 0).length;
  const low = products.filter((p: any) => p.stock > 0 && p.stock <= p.low_stock_threshold).length;
  const inStockRate = total ? Math.round(((total - out) / total) * 100) : 0;
  const lowList = products.filter((p: any) => p.stock <= p.low_stock_threshold);
  const totalUnits = products.reduce((s: number, p: any) => s + (p.stock || 0), 0);

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

  const profileMap = new Map(profiles.map((p: any) => [p.id, p.full_name || p.email || "Unknown"]));

  // Group products by main category for breakdown
  const mainCats = categories.filter((c: any) => !c.parent_id);
  const breakdown = mainCats.map((mc: any) => {
    const childIds = new Set(categories.filter((c: any) => c.parent_id === mc.id).map((c: any) => c.id));
    childIds.add(mc.id);
    const items = products.filter((p: any) => childIds.has(p.category_id));
    return { name: mc.name, count: items.length, units: items.reduce((s: number, p: any) => s + (p.stock || 0), 0) };
  }).filter((g: any) => g.count > 0).sort((a: any, b: any) => b.count - a.count);

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
      detail: m.reason,
    })),
    ...recentBarcodes.map((b: any) => ({
      kind: "barcode",
      id: `bc-${b.id}`,
      when: b.barcode_registered_at,
      who: profileMap.get(b.barcode_registered_by) ?? "System",
      product: b.name,
      image: b.image_url,
      detail: b.barcode,
    })),
  ].sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime()).slice(0, 30);

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <PageHeader title="Dashboard" subtitle="Live inventory overview." />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-3 mb-4">
        <StatCard label="Total products" value={total} icon={Boxes} tone="primary" />
        <StatCard label="Low stock" value={low} icon={AlertTriangle} tone="warning" hint="At or below threshold" />
        <StatCard label="Out of stock" value={out} icon={PackageX} tone="destructive" />
        <StatCard label="In-stock rate" value={`${inStockRate}%`} icon={TrendingUp} tone="success" />
        <StatCard label="Total units" value={totalUnits.toLocaleString()} icon={Boxes} tone="primary" hint="Across all products" />
        <StatCard label="24h activity" value={`+${stockedIn24} / -${stockedOut24}`} icon={Activity} tone="warning" hint="Units in / out" />
      </div>

      {breakdown.length > 0 && (
        <Card className="card-elevated p-5 mb-6">
          <div className="flex items-center gap-2 mb-3 text-sm font-semibold"><FolderTree className="size-4 text-primary" />Catalog breakdown</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {breakdown.map((g: any) => (
              <div key={g.name} className="rounded-xl border border-border bg-secondary/40 p-3">
                <div className="text-xs text-muted-foreground uppercase tracking-wider">{g.name}</div>
                <div className="text-2xl font-bold mt-1">{g.count}</div>
                <div className="text-xs text-muted-foreground">{g.units.toLocaleString()} units in stock</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {destEntries.length > 0 && (
        <Card className="card-elevated p-5 mb-6">
          <div className="flex items-center gap-2 mb-4 text-sm font-semibold">
            <Truck className="size-4 text-primary" />Stock-out destinations
            <span className="ml-auto text-xs text-muted-foreground font-normal">Last {outMoves.length} movements</span>
          </div>
          <div className="space-y-3">
            {destEntries.map(([name, qty]) => {
              const pct = Math.round((qty / destMax) * 100);
              const share = Math.round((qty / outMoves.reduce((s: number, m: any) => s + m.quantity, 0)) * 100);
              const Icon = name === "Delivery" ? Truck : name === "Shops" ? Store : Boxes;
              return (
                <div key={name}>
                  <div className="flex items-center gap-2 text-sm mb-1">
                    <Icon className="size-4 text-muted-foreground" />
                    <span className="font-medium">{name}</span>
                    <span className="ml-auto tabular-nums font-semibold">{qty.toLocaleString()}</span>
                    <span className="text-xs text-muted-foreground tabular-nums w-10 text-right">{share}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-secondary overflow-hidden">
                    <div className="h-full gradient-warning rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Tabs defaultValue="activity">
        <TabsList>
          <TabsTrigger value="activity">Recent Activity</TabsTrigger>
          <TabsTrigger value="products">Product List</TabsTrigger>
          <TabsTrigger value="low">Low Stock</TabsTrigger>
        </TabsList>

        <TabsContent value="activity">
          <Card className="card-elevated p-0 overflow-hidden">
            <div className="divide-y divide-border max-h-[560px] overflow-auto">
              {activity.length === 0 && <p className="text-center text-muted-foreground py-12">No activity yet</p>}
              {activity.map((a: any) => (
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
                    <div className="text-xs text-muted-foreground mt-0.5 truncate">
                      {a.kind === "barcode" ? <span className="font-mono">{a.detail}</span> : a.detail || (a.kind === "stock_in" ? "Stock in" : "Stock out")}
                      {" · "}by <span className="text-foreground font-medium">{a.who}</span>
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
