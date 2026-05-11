import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { StatCard } from "@/components/app/StatCard";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArrowDownRight, ArrowUpRight, ArrowLeftRight, TrendingDown, TrendingUp } from "lucide-react";
import { format } from "date-fns";

export const Route = createFileRoute("/_authenticated/reports")({ component: Reports });

function Reports() {
  const { data: movements = [] } = useQuery({
    queryKey: ["movements-all"],
    queryFn: async () => (await supabase.from("stock_movements").select("*, products(name)").order("created_at", { ascending: false }).limit(500)).data ?? [],
  });

  const inQty = movements.filter((m: any) => m.type === "in").reduce((a, m: any) => a + m.quantity, 0);
  const outQty = movements.filter((m: any) => m.type === "out").reduce((a, m: any) => a + m.quantity, 0);
  const net = inQty - outQty;

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <PageHeader title="Reports" subtitle="Transaction log and stock summary." />

      <div className="grid sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="Total stock in" value={inQty} icon={TrendingUp} tone="success" />
        <StatCard label="Total stock out" value={outQty} icon={TrendingDown} tone="warning" />
        <StatCard label="Net movement" value={net} icon={ArrowLeftRight} tone={net >= 0 ? "success" : "destructive"} />
      </div>

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
    </div>
  );
}
