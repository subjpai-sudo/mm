import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase, getCachedStorageUrl } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { StatCard } from "@/components/app/StatCard";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowDownRight, ArrowUpRight, ArrowLeftRight, TrendingDown, TrendingUp, AlertTriangle, PackageX, ExternalLink, ImageIcon } from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/lib/auth";
import { ReportPdfDialog } from "@/components/app/ReportPdfDialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { resolveMainCategoryName, type CategoryLite } from "@/lib/category-colors";

export const Route = createFileRoute("/_authenticated/reports")({ component: Reports });

function Reports() {
  const { role } = useAuth();
  const canSeeAlerts = role === "admin" || role === "owner";
  const { data: movements = [] } = useQuery({
    queryKey: ["movements-all"],
    queryFn: async () => (await supabase.from("stock_movements").select("*, products(id,name)").order("created_at", { ascending: false }).limit(500)).data ?? [],
  });
  const { data: products = [] } = useQuery({
    queryKey: ["products-report"],
    queryFn: async () => (await supabase.from("products").select("id, name, sku, barcode, brand, category_id, stock, low_stock_threshold, image_url, last_alert_stock, price, rack, shelf, origin, size, unit, pcs_per_case, categories(name, parent_id)").order("name")).data ?? [],
  });
  const { data: categories = [] } = useQuery<CategoryLite[]>({
    queryKey: ["categories", "report-filters"],
    queryFn: async () => ((await supabase.from("categories").select("id, name, parent_id").order("name")).data ?? []) as CategoryLite[],
    staleTime: 60_000,
  });

  const [stockFilter, setStockFilter] = useState<"all" | "low" | "out">("all");
  const [mainFilter, setMainFilter] = useState("all");
  const [vendorFilter, setVendorFilter] = useState("all");

  const mainCats = useMemo(() => categories.filter((c) => !c.parent_id).sort((a, b) => a.name.localeCompare(b.name)), [categories]);
  const vendorCats = useMemo(() => {
    if (mainFilter === "all") return categories.filter((c) => c.parent_id).sort((a, b) => a.name.localeCompare(b.name));
    return categories.filter((c) => c.parent_id === mainFilter).sort((a, b) => a.name.localeCompare(b.name));
  }, [categories, mainFilter]);

  const categoryLabel = useMemo(() => (p: any) => {
    const main = resolveMainCategoryName(p.category_id, categories) ?? "";
    const vendor = p.categories?.name ?? "";
    if (main && vendor && main !== vendor) return `${main} -> ${vendor}`;
    return main || vendor || "Uncategorized";
  }, [categories]);

  const filteredProducts = useMemo(() => {
    return (products as any[]).filter((p) => {
      if (stockFilter === "low" && !(p.stock > 0 && p.stock <= p.low_stock_threshold)) return false;
      if (stockFilter === "out" && !(p.stock <= 0)) return false;
      if (mainFilter !== "all" && resolveMainCategoryName(p.category_id, categories) !== categories.find((c) => c.id === mainFilter)?.name) return false;
      if (vendorFilter !== "all" && p.category_id !== vendorFilter) return false;
      return true;
    });
  }, [products, stockFilter, mainFilter, vendorFilter, categories]);

  const reportProducts = useMemo(() => filteredProducts.map((p: any) => ({
    ...p,
    report_category: categoryLabel(p),
    main_category: resolveMainCategoryName(p.category_id, categories) ?? "",
  })), [filteredProducts, categories, categoryLabel]);

  const filteredProductIds = useMemo(() => new Set(filteredProducts.map((p: any) => p.id)), [filteredProducts]);
  const filteredMovements = useMemo(() => {
    if (mainFilter === "all" && vendorFilter === "all" && stockFilter === "all") return movements as any[];
    return (movements as any[]).filter((m) => filteredProductIds.has(m.product_id));
  }, [movements, filteredProductIds, mainFilter, vendorFilter, stockFilter]);

  const inQty = filteredMovements.filter((m: any) => m.type === "in").reduce((a, m: any) => a + m.quantity, 0);
  const outQty = filteredMovements.filter((m: any) => m.type === "out").reduce((a, m: any) => a + m.quantity, 0);
  const net = inQty - outQty;

  const lowList = reportProducts.filter((p: any) => p.stock > 0 && p.stock <= p.low_stock_threshold);
  const outList = reportProducts.filter((p: any) => p.stock <= 0);

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <PageHeader
        title="Reports"
        subtitle="Transaction log and stock summary."
        actions={canSeeAlerts ? (
          <ReportPdfDialog
            products={reportProducts as any}
            lowList={lowList as any}
            outList={outList as any}
            movements={{ inQty, outQty, total: filteredMovements.length }}
            rawMovements={filteredMovements as any}
          />
        ) : undefined}
      />

      <Card className="card-elevated p-4 mb-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="grid sm:grid-cols-3 gap-3 flex-1">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">Product report</div>
              <Select value={stockFilter} onValueChange={(v) => setStockFilter(v as "all" | "low" | "out")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All products</SelectItem>
                  <SelectItem value="low">Low stock only</SelectItem>
                  <SelectItem value="out">Out of stock only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">Main category</div>
              <Select value={mainFilter} onValueChange={(v) => { setMainFilter(v); setVendorFilter("all"); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {mainCats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">Vendor</div>
              <Select value={vendorFilter} onValueChange={setVendorFilter}>
                <SelectTrigger><SelectValue placeholder="All vendors" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All vendors</SelectItem>
                  {vendorCats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="text-sm text-muted-foreground lg:text-right">
            Showing <span className="font-semibold text-foreground">{filteredProducts.length}</span> of {products.length} products
            <div className="text-xs">PDF reports use these filters.</div>
          </div>
        </div>
      </Card>

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
            {filteredMovements.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-12">No transactions yet</TableCell></TableRow>}
            {filteredMovements.map((m: any) => (
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
                  <ReportPdfDialog
                    products={lowList as any}
                    lowList={lowList as any}
                    outList={[] as any}
                    movements={{ inQty, outQty, total: filteredMovements.length }}
                    rawMovements={filteredMovements as any}
                    triggerLabel="PDF"
                    triggerClassName="h-8 px-3 text-xs"
                    triggerDisabled={lowList.length === 0}
                    defaultSelected={{ summary: true, low: true, out: false, all: false, insights: false, destinations: false }}
                  />
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
                  <ReportPdfDialog
                    products={outList as any}
                    lowList={[] as any}
                    outList={outList as any}
                    movements={{ inQty, outQty, total: filteredMovements.length }}
                    rawMovements={filteredMovements as any}
                    triggerLabel="PDF"
                    triggerClassName="h-8 px-3 text-xs"
                    triggerDisabled={outList.length === 0}
                    defaultSelected={{ summary: true, low: false, out: true, all: false, insights: false, destinations: false }}
                  />
                </div>
              </Card>
            </div>

            <Card className="card-elevated p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <div className="text-sm font-semibold flex items-center gap-2"><AlertTriangle className="size-4 text-warning" /> Low stock products</div>
                <ReportPdfDialog
                  products={lowList as any}
                  lowList={lowList as any}
                  outList={[] as any}
                  movements={{ inQty, outQty, total: filteredMovements.length }}
                  rawMovements={filteredMovements as any}
                  triggerLabel="Download PDF"
                  triggerClassName="h-8 px-3 text-xs"
                  triggerDisabled={lowList.length === 0}
                  defaultSelected={{ summary: true, low: true, out: false, all: false, insights: false, destinations: false }}
                />
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
                            <img src={getCachedStorageUrl(p.image_url)} alt={p.name} className="size-9 rounded-md object-cover border border-border" />
                          ) : (
                            <div className="size-9 rounded-md bg-secondary grid place-items-center text-muted-foreground"><ImageIcon className="size-4" /></div>
                          )}
                          <span className="font-medium">{p.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{p.sku ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{categoryLabel(p)}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold text-warning">{p.stock}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{p.low_stock_threshold}</TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="ghost">
                          <Link to="/products/$productId" params={{ productId: p.id }}><ExternalLink className="size-3.5" /> Open</Link>
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
                <ReportPdfDialog
                  products={outList as any}
                  lowList={[] as any}
                  outList={outList as any}
                  movements={{ inQty, outQty, total: filteredMovements.length }}
                  rawMovements={filteredMovements as any}
                  triggerLabel="Download PDF"
                  triggerClassName="h-8 px-3 text-xs"
                  triggerDisabled={outList.length === 0}
                  defaultSelected={{ summary: true, low: false, out: true, all: false, insights: false, destinations: false }}
                />
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
                            <img src={getCachedStorageUrl(p.image_url)} alt={p.name} className="size-9 rounded-md object-cover border border-border" />
                          ) : (
                            <div className="size-9 rounded-md bg-secondary grid place-items-center text-muted-foreground"><ImageIcon className="size-4" /></div>
                          )}
                          <span className="font-medium">{p.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{p.sku ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{categoryLabel(p)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{p.low_stock_threshold}</TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="ghost">
                          <Link to="/products/$productId" params={{ productId: p.id }}><ExternalLink className="size-3.5" /> Open</Link>
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
