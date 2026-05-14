import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { StatCard } from "@/components/app/StatCard";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowDownRight, ArrowUpRight, ArrowLeftRight, TrendingDown, TrendingUp, AlertTriangle, PackageX, Download, ExternalLink, ImageIcon } from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/reports")({ component: Reports });

function Reports() {
  const { role } = useAuth();
  const canSeeAlerts = role === "admin" || role === "owner";
  const { data: movements = [] } = useQuery({
    queryKey: ["movements-all"],
    queryFn: async () => (await supabase.from("stock_movements").select("*, products(name)").order("created_at", { ascending: false }).limit(500)).data ?? [],
  });
  const { data: products = [] } = useQuery({
    queryKey: ["products-report"],
    queryFn: async () => (await supabase.from("products").select("id, name, sku, barcode, stock, low_stock_threshold, image_url, last_alert_stock, categories(name, parent_id)").order("name")).data ?? [],
  });

  const inQty = movements.filter((m: any) => m.type === "in").reduce((a, m: any) => a + m.quantity, 0);
  const outQty = movements.filter((m: any) => m.type === "out").reduce((a, m: any) => a + m.quantity, 0);
  const net = inQty - outQty;

  const lowList = products.filter((p: any) => p.stock > 0 && p.stock <= p.low_stock_threshold);
  const outList = products.filter((p: any) => p.stock <= 0);

  function downloadCsv(filename: string, rows: any[]) {
    const headers = ["Name", "SKU", "Barcode", "Category", "Stock", "Threshold", "Last alert stock", "Status", "Image URL"];
    const escape = (v: any) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(",")];
    for (const p of rows) {
      lines.push([
        p.name, p.sku ?? "", p.barcode ?? "", p.categories?.name ?? "",
        p.stock, p.low_stock_threshold, p.last_alert_stock ?? "",
        p.stock <= 0 ? "Out of stock" : "Low stock", p.image_url ?? "",
      ].map(escape).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const today = format(new Date(), "yyyy-MM-dd");

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <PageHeader title="Reports" subtitle="Transaction log and stock summary." />

      <div className="grid sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="Total stock in" value={inQty} icon={TrendingUp} tone="success" />
        <StatCard label="Total stock out" value={outQty} icon={TrendingDown} tone="warning" />
        <StatCard label="Net movement" value={net} icon={ArrowLeftRight} tone={net >= 0 ? "success" : "destructive"} />
      </div>

      <Tabs defaultValue="movements">
        <TabsList>
          <TabsTrigger value="movements">Movements</TabsTrigger>
          {canSeeAlerts && <TabsTrigger value="alerts">Stock Alerts</TabsTrigger>}
        </TabsList>

        <TabsContent value="movements">
          <Card className="card-elevated p-0 overflow-hidden">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Product</TableHead>
            <TableHead>Qty</TableHead><TableHead>Reason</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {movements.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-12">No transactions yet</TableCell></TableRow>}
            {movements.map((m: any) => (
              <TableRow key={m.id}>
                <TableCell className="text-xs text-muted-foreground">{format(new Date(m.created_at), "PP p")}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={m.type === "in" ? "text-success border-success/30 bg-success/10" : "text-destructive border-destructive/30 bg-destructive/10"}>
                    {m.type === "in" ? <ArrowUpRight className="size-3 mr-1" /> : <ArrowDownRight className="size-3 mr-1" />}
                    {m.type === "in" ? "In" : "Out"}
                  </Badge>
                </TableCell>
                <TableCell className="font-medium">{m.products?.name ?? "—"}</TableCell>
                <TableCell>{m.quantity}</TableCell>
                <TableCell className="text-muted-foreground">{m.reason ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
          </Card>
        </TabsContent>

        {canSeeAlerts && (
          <TabsContent value="alerts" className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <Card className="card-elevated p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <AlertTriangle className="size-3.5 text-warning" /> Low stock
                    </div>
                    <div className="text-3xl font-bold mt-1">{lowList.length}</div>
                    <div className="text-xs text-muted-foreground">Products at or below threshold</div>
                  </div>
                  <Button size="sm" variant="secondary" disabled={lowList.length === 0}
                    onClick={() => downloadCsv(`low-stock-${today}.csv`, lowList)}>
                    <Download className="size-3.5" /> CSV
                  </Button>
                </div>
              </Card>
              <Card className="card-elevated p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <PackageX className="size-3.5 text-destructive" /> Out of stock
                    </div>
                    <div className="text-3xl font-bold mt-1">{outList.length}</div>
                    <div className="text-xs text-muted-foreground">Products with zero stock</div>
                  </div>
                  <Button size="sm" variant="secondary" disabled={outList.length === 0}
                    onClick={() => downloadCsv(`out-of-stock-${today}.csv`, outList)}>
                    <Download className="size-3.5" /> CSV
                  </Button>
                </div>
              </Card>
            </div>

            <Card className="card-elevated p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <div className="text-sm font-semibold flex items-center gap-2"><AlertTriangle className="size-4 text-warning" /> Low stock products</div>
                <Button size="sm" variant="ghost" disabled={lowList.length === 0}
                  onClick={() => downloadCsv(`low-stock-${today}.csv`, lowList)}>
                  <Download className="size-3.5" /> Download
                </Button>
              </div>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Product</TableHead><TableHead>SKU</TableHead><TableHead>Category</TableHead>
                  <TableHead className="text-right">Stock</TableHead><TableHead className="text-right">Threshold</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {lowList.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">All good — no low-stock items</TableCell></TableRow>}
                  {lowList.map((p: any) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          {p.image_url ? (
                            <img src={p.image_url} alt={p.name} className="size-9 rounded-md object-cover border border-border" />
                          ) : (
                            <div className="size-9 rounded-md bg-secondary grid place-items-center text-muted-foreground"><ImageIcon className="size-4" /></div>
                          )}
                          <span className="font-medium">{p.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{p.sku ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{p.categories?.name ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold text-warning">{p.stock}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{p.low_stock_threshold}</TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="ghost">
                          <Link to="/products" search={{ filter: "low" }}><ExternalLink className="size-3.5" /> Open</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>

            <Card className="card-elevated p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <div className="text-sm font-semibold flex items-center gap-2"><PackageX className="size-4 text-destructive" /> Out of stock products</div>
                <Button size="sm" variant="ghost" disabled={outList.length === 0}
                  onClick={() => downloadCsv(`out-of-stock-${today}.csv`, outList)}>
                  <Download className="size-3.5" /> Download
                </Button>
              </div>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Product</TableHead><TableHead>SKU</TableHead><TableHead>Category</TableHead>
                  <TableHead className="text-right">Threshold</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {outList.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Nothing is out of stock</TableCell></TableRow>}
                  {outList.map((p: any) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          {p.image_url ? (
                            <img src={p.image_url} alt={p.name} className="size-9 rounded-md object-cover border border-border" />
                          ) : (
                            <div className="size-9 rounded-md bg-secondary grid place-items-center text-muted-foreground"><ImageIcon className="size-4" /></div>
                          )}
                          <span className="font-medium">{p.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{p.sku ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{p.categories?.name ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{p.low_stock_threshold}</TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="ghost">
                          <Link to="/products" search={{ filter: "out" }}><ExternalLink className="size-3.5" /> Open</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
