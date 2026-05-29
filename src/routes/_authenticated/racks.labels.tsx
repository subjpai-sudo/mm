import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Printer } from "lucide-react";
import { ProductLocationCard } from "@/components/app/ProductLocationCard";
import { ProductLabelStrip } from "@/components/app/ProductLabelStrip";
import { resolveMainCategoryName, type CategoryLite } from "@/lib/category-colors";

const search = z.object({
  ids: z.string().optional(),
  shelf: z.enum(["upper", "mid", "down"]).optional(),
});

export const Route = createFileRoute("/_authenticated/racks/labels")({
  validateSearch: (s) => search.parse(s),
  component: PrintProductLabels,
});

const SHELF_ORDER: Record<string, number> = { upper: 0, mid: 1, down: 2 };

// Label size presets — w × h in cm. xs/sm = landscape strip, md/lg = portrait card
const SIZES = [
  { key: "xs", label: "XS", desc: "9 × 3 cm",   w: "9cm",  h: "3cm",  variant: "strip" as const },
  { key: "sm", label: "SM", desc: "11 × 4 cm",  w: "11cm", h: "4cm",  variant: "strip" as const },
  { key: "md", label: "MD", desc: "9 × 12 cm",  w: "9cm",  h: "12cm", variant: "card"  as const },
  { key: "lg", label: "LG", desc: "11 × 15 cm", w: "11cm", h: "15cm", variant: "card"  as const },
] as const;
type SizeKey = (typeof SIZES)[number]["key"];

function PrintProductLabels() {
  const { ids, shelf } = Route.useSearch();
  const rackCodes = useMemo(
    () => (ids ? ids.split(",").map((s: string) => s.trim()).filter(Boolean) : []),
    [ids],
  );

  const [sizeKey, setSizeKey] = useState<SizeKey>("sm");
  const sz = SIZES.find((s) => s.key === sizeKey)!;

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["products", "labels", rackCodes],
    enabled: rackCodes.length > 0,
    queryFn: async () =>
      (
        await supabase
          .from("products")
          .select("id, name, sku, barcode, image_url, origin, size, unit, rack, shelf, category_id")
          .in("rack", rackCodes)
          .order("rack")
          .order("name")
      ).data ?? [],
  });

  const { data: allCategories = [] } = useQuery<CategoryLite[]>({
    queryKey: ["categories", "lite"],
    queryFn: async () =>
      ((await supabase.from("categories").select("id, name, parent_id")).data ?? []) as CategoryLite[],
    staleTime: 60_000,
  });

  const grouped = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const code of rackCodes) map.set(code, []);
    for (const p of products as any[]) {
      if (shelf && (p.shelf ?? "mid").toLowerCase() !== shelf) continue;
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
  }, [products, rackCodes, shelf]);

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
          {/* Size picker */}
          <div className="flex items-center gap-1 border rounded-lg p-1 bg-muted/40">
            {SIZES.map((s) => (
              <button
                key={s.key}
                onClick={() => setSizeKey(s.key)}
                title={s.desc}
                className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                  sizeKey === s.key
                    ? "bg-background shadow text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {s.label}
                <span className="ml-1 text-xs opacity-60">{s.desc}</span>
              </button>
            ))}
          </div>
          <span className="text-sm text-muted-foreground">
            {totalCards} label{totalCards === 1 ? "" : "s"} · {rackCodes.length} rack{rackCodes.length === 1 ? "" : "s"}
          </span>
          <Button onClick={() => window.print()} className="gradient-primary text-primary-foreground border-0 gap-2">
            <Printer className="size-4" /> Print
          </Button>
        </div>
      </div>

      <div className="print:p-0">
        <h1 className="text-2xl font-semibold tracking-tight mb-1 print:hidden">Product location labels</h1>
        <p className="text-sm text-muted-foreground mb-6 print:hidden">
          XS / SM = barcode strip (landscape). MD / LG = full card (portrait).
          Labels are fixed physical size — cut and paste on shelf or product.
        </p>

        {rackCodes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No rack ids provided. Append <code>?ids=R1,R2</code> to the URL.</p>
        ) : isLoading ? (
          <p className="text-sm text-muted-foreground">Loading products…</p>
        ) : (
          <div id="print-area">
            {rackCodes.map((code: string) => {
              const items = grouped.get(code) ?? [];
              return (
                <section key={code}>
                  <div className="flex items-center justify-between mb-3 print:hidden">
                    <h2 className="text-lg font-bold">Rack {code}</h2>
                    <span className="text-xs text-muted-foreground">{items.length} item{items.length === 1 ? "" : "s"}</span>
                  </div>
                  <div
                    className="label-grid"
                    style={{ display: "flex", flexWrap: "wrap", gap: "3mm", alignItems: "flex-start" }}
                  >
                    {items.map((p: any) =>
                      sz.variant === "strip" ? (
                        <div key={p.id} className="label-item" style={{ width: sz.w, height: sz.h, flexShrink: 0 }}>
                          <ProductLabelStrip
                            rackCode={code}
                            product={{ ...p, mainCategoryName: resolveMainCategoryName(p.category_id, allCategories) }}
                            compact={sizeKey === "xs"}
                          />
                        </div>
                      ) : (
                        <div key={p.id} className="label-item" style={{ width: sz.w, minHeight: sz.h, flexShrink: 0 }}>
                          <ProductLocationCard
                            rackCode={code}
                            product={{ ...p, mainCategoryName: resolveMainCategoryName(p.category_id, allCategories) }}
                            showImage={true}
                          />
                        </div>
                      )
                    )}
                    {items.length === 0 && (
                      <div className="text-sm text-muted-foreground italic print:hidden">
                        No products{shelf ? ` on the ${shelf} shelf` : ""} in rack {code} yet.
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
          @page { size: A4 portrait; margin: 8mm; }
          html, body { background: white !important; margin: 0 !important; padding: 0 !important; }
          body * { visibility: hidden !important; }
          #print-area, #print-area * { visibility: visible !important; }
          #print-area {
            position: absolute !important;
            left: 0; top: 0;
            width: 100%;
            padding: 0 !important;
            margin: 0 !important;
          }
          .label-grid {
            display: flex !important;
            flex-wrap: wrap !important;
            gap: 3mm !important;
            align-items: flex-start !important;
          }
          .label-item {
            width: ${sz.w} !important;
            ${sz.variant === "strip" ? `height: ${sz.h} !important;` : `min-height: ${sz.h} !important;`}
            flex-shrink: 0 !important;
            break-inside: avoid !important;
            overflow: hidden !important;
          }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
          img { display: block !important; max-width: 100% !important; }
        }
      `}</style>
    </div>
  );
}
