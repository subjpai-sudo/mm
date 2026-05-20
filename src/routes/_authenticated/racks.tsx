import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { Card } from "@/components/ui/card";
import { Warehouse, Package, AlertTriangle, PackageX, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/racks")({ component: RacksIndex });

export const RACK_IDS = Array.from({ length: 20 }, (_, i) => `R${i + 1}`);

function RacksIndex() {
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await supabase.from("products").select("*").order("name")).data ?? [],
  });

  const byRack = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const p of products as any[]) {
      const key = (p.rack ?? "").trim();
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return map;
  }, [products]);

  const extraRacks = useMemo(
    () => Array.from(byRack.keys()).filter((r) => !RACK_IDS.includes(r)).sort(),
    [byRack],
  );

  const unassigned = (products as any[]).filter((p) => !(p.rack ?? "").trim());

  return (
    <div className="p-3 sm:p-6 md:p-10 max-w-7xl mx-auto">
      <PageHeader
        title="Racks"
        subtitle="Pick a rack to manage its shelves."
        actions={
          <Link to="/racks/print">
            <Button variant="outline" className="gap-2">
              <Printer className="size-4" /> Print all QR labels
            </Button>
          </Link>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
        {[...RACK_IDS, ...extraRacks].map((id) => {
          const items = byRack.get(id) ?? [];
          const out = items.filter((p) => p.stock <= 0).length;
          const low = items.filter((p) => p.stock > 0 && p.stock <= (p.low_stock_threshold ?? 5)).length;
          const ok = items.length - out - low;
          const tone =
            items.length === 0 ? "border-border bg-secondary/30"
            : out > 0 ? "border-destructive/50 bg-destructive/5"
            : low > 0 ? "border-warning/50 bg-warning/5"
            : "border-success/50 bg-success/5";
          return (
            <Link
              key={id}
              to="/racks/$rackId"
              params={{ rackId: id }}
              className={cn(
                "group relative rounded-2xl border-2 p-4 transition hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.98]",
                tone,
              )}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="size-10 rounded-xl gradient-primary grid place-items-center">
                  <Warehouse className="size-5 text-primary-foreground" />
                </div>
                <span className="text-xs font-mono text-muted-foreground">{items.length} item{items.length === 1 ? "" : "s"}</span>
              </div>
              <div className="font-bold text-lg tracking-tight">Rack {id}</div>
              <div className="mt-2 flex items-center gap-2 text-[11px]">
                <span className="inline-flex items-center gap-1 text-success"><span className="size-1.5 rounded-full bg-success" />{ok}</span>
                <span className="inline-flex items-center gap-1 text-warning"><AlertTriangle className="size-3" />{low}</span>
                <span className="inline-flex items-center gap-1 text-destructive"><PackageX className="size-3" />{out}</span>
              </div>
            </Link>
          );
        })}
      </div>

      <Card className="card-elevated p-4 mt-6">
        <div className="flex items-center gap-2 text-sm font-semibold mb-1">
          <Package className="size-4 text-muted-foreground" /> Unassigned products
          <span className="ml-auto text-xs font-normal text-muted-foreground">{unassigned.length}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Open any rack above, pick a shelf, then add products from this pool.
        </p>
      </Card>
    </div>
  );
}
