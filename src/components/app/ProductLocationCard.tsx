import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";
import { Package } from "lucide-react";
import { categoryPalette } from "@/lib/category-colors";
import { displaySize } from "@/lib/product-format";
import { getCachedStorageUrl } from "@/integrations/supabase/client";

export type LocationCardProduct = {
  id: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  image_url?: string | null;
  origin?: string | null;
  size?: string | null;
  unit?: string | null;
  shelf?: string | null;
  /** Resolved top-level category name (e.g. "Myanmar"). Used for the header color. */
  mainCategoryName?: string | null;
};

export function ProductLocationCard({
  rackCode,
  product,
  showImage = true,
}: {
  rackCode: string;
  product: LocationCardProduct;
  showImage?: boolean;
}) {
  const barcodeRef = useRef<SVGSVGElement | null>(null);

  const labelName = (product.mainCategoryName ?? product.origin ?? "").toString();
  const palette = categoryPalette(labelName);
  const paletteLabel = (labelName || "Uncategorized").toUpperCase();
  const rack = rackCode.trim().toUpperCase();
  const shelf = (product.shelf ?? "").toString().trim();
  const slotLabel = shelf ? `${rack} · ${shelf.toUpperCase()}` : rack;
  const code = (product.barcode ?? product.sku ?? product.id).toString();
  const size = displaySize(product);

  useEffect(() => {
    if (!barcodeRef.current || !code) return;
    try {
      const onlyDigits = /^\d+$/.test(code);
      const format = onlyDigits && code.length === 13 ? "EAN13" : onlyDigits && code.length === 8 ? "EAN8" : "CODE128";
      JsBarcode(barcodeRef.current, code, {
        format,
        displayValue: true,
        fontSize: 20,
        textMargin: 4,
        height: 80,
        width: 2.4,
        margin: 0,
        background: "#ffffff",
        lineColor: "#000000",
      });
    } catch {
      try {
        JsBarcode(barcodeRef.current, code, {
          format: "CODE128",
          displayValue: true,
          fontSize: 20,
          textMargin: 4,
          height: 80,
          width: 2.4,
          margin: 0,
        });
      } catch {
        /* leave svg empty */
      }
    }
  }, [code]);

  return (
    <div
      className="rack-card border-[3px] border-black rounded-2xl overflow-hidden bg-white text-black break-inside-avoid flex flex-col h-full"
      style={{ width: "100%" }}
    >
      {/* Colored header band */}
      <div
        className="px-3 py-2 text-center font-black tracking-tight shrink-0"
        style={{ background: palette.bg, color: palette.fg }}
      >
        <div className="text-[10px] uppercase tracking-[0.2em] opacity-80 leading-none">
          {paletteLabel}
        </div>
        <div className="text-3xl leading-tight">{slotLabel}</div>
      </div>

      {/* Image — edge-to-edge, fills all available height between header and content */}
      {showImage && (
        <div className="w-full flex-1 min-h-0 bg-white overflow-hidden">
          {product.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={getCachedStorageUrl(product.image_url)}
              alt={product.name}
              className="w-full h-full object-cover print:!block"
              referrerPolicy="no-referrer"
              loading="eager"
              decoding="sync"
              style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" } as React.CSSProperties}
            />
          ) : (
            <div className="w-full h-full grid place-items-center">
              <Package className="size-16 text-neutral-300" />
            </div>
          )}
        </div>
      )}

      {/* Name, SKU, barcode — fixed at bottom */}
      <div className="px-3 py-2 flex flex-col items-center gap-1 shrink-0 border-t border-neutral-200">
        <div className="text-center font-bold text-[15px] leading-tight line-clamp-2">
          {product.name}
          {size ? <span className="ml-1 font-semibold text-neutral-600">· {size}</span> : null}
        </div>
        <div className="w-full">
          <div className="text-[11px] font-mono text-neutral-700 truncate text-center">
            SKU: <span className="font-bold text-black">{product.sku ?? "—"}</span>
          </div>
          <svg ref={barcodeRef} className="w-full mt-0.5 block" />
        </div>
      </div>
    </div>
  );
}
