import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { StatCard } from "@/components/app/StatCard";
import { Boxes, AlertTriangle, PackageX, TrendingUp, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_authenticated/dashboard")({ component: Dashboard });

function Dashboard() {
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await supabase.from("products").select("*").order("created_at", { ascending: false })).data ?? [],
  });
  const { data: movements = [] } = useQuery({
    queryKey: ["movements-recent"],
    queryFn: async () => (await supabase.from("stock_movements").select("*, products(name)").order("created_at", { ascending: false }).limit(20)).data ?? [],
  });

  const total = products.length;
  const out = products.filter(p => p.stock <= 0).length;
  const low = products.filter(p => p.stock > 0 && p.stock <= p.low_stock_threshold).length;
  const inStockRate = total ? Math.round(((total - out) / total) * 100) : 0;
  const lowList = products.filter(p => p.stock <= p.low_stock_threshold);

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <PageHeader title="Dashboard" subtitle="Live inventory overview." />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <StatCard label="Total products" value={total} icon={Boxes} tone="primary" />
        <StatCard label="Low stock" value={low} icon={AlertTriangle} tone="warning" hint="At or below threshold" />
        <StatCard label="Out of stock" value={out} icon={PackageX} tone="destructive" />
        <StatCard label="In-stock rate" value={`${inStockRate}%`} icon={TrendingUp} tone="success" />
      </div>

      <Tabs defaultValue="activity">
        <TabsList>
          <TabsTrigger value="activity">Recent Activity</TabsTrigger>
          <TabsTrigger value="products">Product List</TabsTrigger>
          <TabsTrigger value="low">Low Stock</TabsTrigger>
        </TabsList>

        <TabsContent value="activity">
          <Card className="card-elevated p-0 overflow-hidden">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Type</TableHead><TableHead>Product</TableHead><TableHead>Qty</TableHead><TableHead>Reason</TableHead><TableHead>When</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {movements.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-12">No activity yet</TableCell></TableRow>}
                {movements.map((m: any) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <Badge variant="outline" className={m.type === "in" ? "text-success border-success/30 bg-success/10" : "text-destructive border-destructive/30 bg-destructive/10"}>
                        {m.type === "in" ? <ArrowUpRight className="size-3 mr-1" /> : <ArrowDownRight className="size-3 mr-1" />}
                        {m.type === "in" ? "Stock In" : "Stock Out"}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">{m.products?.name ?? "—"}</TableCell>
                    <TableCell>{m.quantity}</TableCell>
                    <TableCell className="text-muted-foreground">{m.reason ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDistanceToNow(new Date(m.created_at), { addSuffix: true })}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
                {products.map(p => <ProductRow key={p.id} p={p} />)}
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
                {lowList.map(p => (
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
