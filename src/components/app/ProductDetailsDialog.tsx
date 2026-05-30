import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";
import { format, formatDistanceToNow } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Package,
  Barcode as BarcodeIcon,
  User,
  Calendar,
  Warehouse,
  Tag,
  ArrowUpRight,
  ArrowDownRight,
  Info,
} from "lucide-react";
import { displaySize } from "@/lib/product-format";
import { categoryPalette, resolveMainCategoryName, type CategoryLite } from "@/lib/category-colors";

export function ProductDetailsDialog({
  productId,
  open,
  onOpenChange,
}: {
  productId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { data: product, isLoading } = useQuery({
    queryKey: ["product-detail", productId],
    enabled: !!productId && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*, categories(name)")
        .eq("id", productId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: allCategories = [] } = useQuery<CategoryLite[]>({
    queryKey: ["categories", "lite"],
    enabled: open,
    queryFn: async () =>
      ((await supabase.from("categories").select("id, name, parent_id")).data ?? []) as CategoryLite[],
    staleTime: 60_000,
  });

  const registrarId = (product as any)?.barcode_registered_by ?? null;

  const { data: registrar } = useQuery({
    queryKey: ["profile", registrarId],
    enabled: !!registrarId && open,
    queryFn: async () =>
      (
        await supabase
          .from("profiles")
          .select("id, full_name")
          .eq("id", registrarId!)
          .maybeSingle()
      ).data,
  });

  const { data: movements = [] } = useQuery({
    queryKey: ["product-movements", productId],
    enabled: !!productId && open,
    queryFn: async () =>
      (
        await supabase
          .from("stock_movements")
          .select("id, type, quantity, reason, destination, user_id, created_at")
          .eq("product_id", productId!)
          .order("created_at", { ascending: false })
          .limit(10)
      ).data ?? [],
  });

  const movementUserIds = Array.from(
    new Set((movements as any[]).map((m) => m.user_id).filter(Boolean)),
  );
  const { data: movementUsers = [] } = useQuery({
    queryKey: ["profiles", "movements", movementUserIds],
    enabled: open && movementUserIds.length > 0,
    queryFn: async () =>
      (
        await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", movementUserIds)
      ).data ?? [],
  });
  const userById = new Map(
    (movementUsers as any[]).map((u) => [u.id, u.full_name || "Unknown"]),
  );

  const mainCatName =
    resolveMainCategoryName((product as any)?.category_id, allCategories) ??
    (product as any)?.categories?.name ??
    "";
  const palette = categoryPalette(mainCatName);
  const paletteLabel = (mainCatName || "Uncategorized").toUpperCase();
  const code = ((product as any)?.barcode ?? (product as any)?.sku ?? "").toString();

  const barcodeRef = useRef<SVGSVGElement | null>(null);
  const qrRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!open || !barcodeRef.current || !code) return;
    try {
      const onlyDigits = /^\d+$/.test(code);
      const fmt =
        onlyDigits && code.length === 13
          ? "EAN13"
          : onlyDigits && code.length === 8
            ? "EAN8"
            : "CODE128";
      JsBarcode(barcodeRef.current, code, {
        format: fmt,
        displayValue: true,
        fontSize: 18,
        textMargin: 4,
        height: 80,
        width: 2,
        margin: 0,
      });
    } catch {
      try {
        JsBarcode(barcodeRef.current, code, {
          format: "CODE128",
          displayValue: true,
          fontSize: 18,
          height: 80,
          margin: 0,
        });
      } catch {
        /* noop */
      }
    }
  }, [code, open]);

  useEffect(() => {
    if (!open || !qrRef.current || !code) return;
    QRCode.toCanvas(qrRef.current, code, {
      width: 120,
      margin: 1,
      errorCorrectionLevel: "M",
    }).catch(() => {});
  }, [code, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Info className="size-5 text-primary" /> Product details
          </DialogTitle>
        </DialogHeader>

        {isLoading || !product ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="space-y-4">
            {/* Header band — origin / rack color */}
            <div
              className="rounded-xl px-4 py-3 flex items-center justify-between"
              style={{ background: palette.bg, color: palette.fg }}
            >
              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] opacity-80">
                  {paletteLabel}
                </div>
                <div className="text-lg font-black leading-tight">
                  {(product as any).rack ? `Rack ${(product as any).rack}` : "Unassigned"}
                  {(product as any).shelf ? ` · ${String((product as any).shelf).toUpperCase()}` : ""}
                </div>
              </div>
              <Warehouse className="size-6 opacity-70" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-4">
              <div className="rounded-xl border border-border bg-secondary/30 aspect-square grid place-items-center overflow-hidden">
                {(product as any).image_url ? (
                  <img
                    src={(product as any).image_url}
                    alt={(product as any).name}
                    className="w-full h-full object-contain"
                    loading="lazy"
                  />
                ) : (
                  <Package className="size-10 text-muted-foreground" />
                )}
              </div>
              <div className="space-y-1 min-w-0">
                <h2 className="text-xl font-bold leading-tight">{(product as any).name}</h2>
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  {(product as any).categories?.name && (
                    <span className="px-2 py-0.5 rounded-full bg-secondary border border-border inline-flex items-center gap-1">
                      <Tag className="size-3" /> {(product as any).categories.name}
                    </span>
                  )}
                  {(product as any).brand && (
                    <span className="px-2 py-0.5 rounded-full bg-secondary border border-border">
                      {(product as any).brand}
                    </span>
                  )}
                  {displaySize(product as any) && (
                    <span className="px-2 py-0.5 rounded-full bg-accent/20 border border-accent/30 text-accent font-semibold">
                      {displaySize(product as any)}
                    </span>
                  )}
                  {(product as any).origin && (
                    <span className="px-2 py-0.5 rounded-full bg-secondary border border-border">
                      {(product as any).origin}
                    </span>
                  )}
                </div>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm mt-2">
                  <dt className="text-muted-foreground">SKU</dt>
                  <dd className="font-mono">{(product as any).sku ?? "—"}</dd>
                  <dt className="text-muted-foreground">Barcode</dt>
                  <dd className="font-mono break-all">{(product as any).barcode ?? "—"}</dd>
                  <dt className="text-muted-foreground">Stock</dt>
                  <dd className="font-bold tabular-nums">
                    {(() => {
                      const stock = (product as any).stock ?? 0;
                      const ppc = (product as any).pcs_per_case;
                      if (ppc && ppc >= 2) {
                        const boxes = Math.floor(stock / ppc);
                        const pcs = stock % ppc;
                        return (
                          <span>
                            {boxes} <span className="font-normal text-muted-foreground text-xs">boxes</span>
                            {" + "}{pcs} <span className="font-normal text-muted-foreground text-xs">pcs</span>
                            <span className="ml-1 text-xs font-normal text-muted-foreground">({stock} total)</span>
                          </span>
                        );
                      }
                      return stock;
                    })()}
                  </dd>
                  <dt className="text-muted-foreground">Low at</dt>
                  <dd className="tabular-nums">{(product as any).low_stock_threshold}</dd>
                  {(product as any).price ? (
                    <>
                      <dt className="text-muted-foreground">Price</dt>
                      <dd className="tabular-nums">{(product as any).price}</dd>
                    </>
                  ) : null}
                  {(product as any).pcs_per_case ? (
                    <>
                      <dt className="text-muted-foreground">Pcs / box</dt>
                      <dd className="tabular-nums">{(product as any).pcs_per_case}</dd>
                    </>
                  ) : null}
                </dl>
              </div>
            </div>

            {/* Barcode + QR */}
            {code && (
              <div className="rounded-xl border border-border p-3 bg-white text-black flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] uppercase tracking-[0.15em] text-neutral-500 mb-1 flex items-center gap-1">
                    <BarcodeIcon className="size-3" /> Registered barcode
                  </div>
                  <svg ref={barcodeRef} className="w-full" />
                </div>
                <canvas ref={qrRef} className="rounded-md [image-rendering:pixelated] shrink-0" />
              </div>
            )}

            {/* Registration audit */}
            <div className="rounded-xl border border-border p-3 bg-secondary/30">
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1">
                <User className="size-3" /> Barcode registration
              </div>
              {(product as any).barcode_registered_at ? (
                <div className="text-sm space-y-1">
                  <div className="flex items-center gap-2">
                    <User className="size-4 text-primary" />
                    <span className="font-medium">
                      {(registrar as any)?.full_name || (registrar as any)?.email || "Unknown user"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Calendar className="size-4" />
                    {format(new Date((product as any).barcode_registered_at), "PPpp")}
                    <span className="text-xs">
                      ({formatDistanceToNow(new Date((product as any).barcode_registered_at), { addSuffix: true })})
                    </span>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground italic">
                  Barcode was not registered via the scanner (legacy or imported product).
                </div>
              )}
            </div>

            {/* Recent movements */}
            <div className="rounded-xl border border-border p-3">
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                Recent stock activity
              </div>
              {movements.length === 0 ? (
                <div className="text-sm text-muted-foreground italic">No movements recorded.</div>
              ) : (
                <ul className="divide-y divide-border">
                  {(movements as any[]).map((m) => (
                    <li key={m.id} className="py-2 flex items-center gap-3 text-sm">
                      {m.type === "in" ? (
                        <span className="size-7 rounded-full bg-success/15 text-success grid place-items-center shrink-0">
                          <ArrowUpRight className="size-4" />
                        </span>
                      ) : (
                        <span className="size-7 rounded-full bg-destructive/15 text-destructive grid place-items-center shrink-0">
                          <ArrowDownRight className="size-4" />
                        </span>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold">
                          {m.type === "in" ? "+" : "-"}
                          {m.quantity}{" "}
                          <span className="text-xs text-muted-foreground font-normal">
                            by {userById.get(m.user_id) ?? "Unknown"}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {m.destination ? `→ ${m.destination} · ` : ""}
                          {m.reason || (m.type === "in" ? "Stock in" : "Stock out")}
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDistanceToNow(new Date(m.created_at), { addSuffix: true })}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}