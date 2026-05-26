import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Printer } from "lucide-react";
import { RackQRLabel } from "@/components/app/RackQRLabel";
import { ProductLocationCard } from "@/components/app/ProductLocationCard";

const search = z.object({
  ids: z.string().optional(), // comma-separated rack codes; required
  includeRack: z.union([z.literal("1"), z.literal("0")]).optional().default("1"),
});

export const Route = createFileRoute("/_authenticated/racks/labels")({
  validateSearch: (s) => search.parse(s),
  component: PrintProductLabels,
});

const SHELF_ORDER: Record<string, number> = { upper: 0, mid: 1, down: 2 };

function PrintProductLabels() {
  const { ids, includeRack } = Route.useSearch();
  const rackCodes = useMemo(
    () => (ids ? ids.split(",").map((s: string) => s.trim()).filter(Boolean) : []),
    [ids],
  );

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["products", "labels", rackCodes],
    enabled: rackCodes.length > 0,
    queryFn: async () =>
      (
        await supabase
          .from("products")
          .select("id, name, sku, barcode, image_url, origin, size, unit, rack, shelf")
          .in("rack", rackCodes)
          .order("rack")
          .order("name")
      ).data ?? [],
  });

  const grouped = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const code of rackCodes) map.set(code, []);
    for (const p of products as any[]) {
      const list = map.get(p.rack ?? "") ?? [];
      list.push(p);
      map.set(p.rack ?? "", list);
    }
    for (const [, list] of map) {
      list.sort((a, b) => {
        const sa = SHELF_ORDER[(a.shelf ?? "mid").toLowerCase()] ?? 1;
        const sb = SHELF_ORDER[(b.shelf ?? "mid").toLowerCase()] ?? 1;
        if (sa !== sb) return sa - sb;
        return (a.name ?? "").localeCompare(b.name ?? "");
      });
    }
    return map;
  }, [products, rackCodes]);

  const totalCards = (products as any[]).length;

  useEffect(() => {
    document.title = `Print product labels · ${rackCodes.join(", ") || "rack"}`;
  }, [rackCodes]);

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6 print:hidden">
        <Link to="/racks" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> Back to racks
        </Link>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {totalCards} product label{totalCards === 1 ? "" : "s"} · {rackCodes.length} rack{rackCodes.length === 1 ? "" : "s"}
          </span>
          <Button onClick={() => window.print()} className="gradient-primary text-primary-foreground border-0 gap-2">
            <Printer className="size-4" /> Print
          </Button>
        </div>
      </div>

      <div className="print:p-0">
        <h1 className="text-2xl font-semibold tracking-tight mb-1 print:hidden">Product location labels</h1>
        <p className="text-sm text-muted-foreground mb-6 print:hidden">
          One card per product. Colored header = rack code with origin/country color.
          Body = product image, SKU, barcode and a QR mirroring the barcode for camera scans.
        </p>

        {rackCodes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No rack ids provided. Append <code>?ids=R1,R2</code> to the URL.</p>
        ) : isLoading ? (
          <p className="text-sm text-muted-foreground">Loading products…</p>
        ) : (
          <div className="space-y-8">
            {rackCodes.map((code: string) => {
              const items = grouped.get(code) ?? [];
              return (
                <section key={code} className="break-inside-avoid">
                  <div className="flex items-center justify-between mb-3 print:hidden">
                    <h2 className="text-lg font-bold">Rack {code}</h2>
                    <span className="text-xs text-muted-foreground">{items.length} item{items.length === 1 ? "" : "s"}</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 print:grid-cols-2 print:gap-3">
                    {includeRack === "1" && (
                      <div className="break-inside-avoid">
                        <RackQRLabel rackId={code} />
                      </div>
                    )}
                    {items.map((p: any) => (
                      <ProductLocationCard key={p.id} rackCode={code} product={p} />
                    ))}
                    {items.length === 0 && (
                      <div className="col-span-full text-sm text-muted-foreground italic print:hidden">
                        No products assigned to rack {code} yet.
                      </div>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>

      <style>{`
        @media print {
          @page { size: A4; margin: 8mm; }
          body { background: white !important; }
          aside, nav, header, .print\\:hidden { display: none !important; }
          main { padding: 0 !important; }
        }
      `}</style>
    </div>
  );
}