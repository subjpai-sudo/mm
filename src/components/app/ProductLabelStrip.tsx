import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";
import { categoryPalette } from "@/lib/category-colors";
import { Package } from "lucide-react";

export type LabelStripProduct = {
  id: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  image_url?: string | null;
  shelf?: string | null;
  mainCategoryName?: string | null;
};

/**
 * Compact landscape barcode strip label for small stickers (XS/SM sizes).
 * Layout: [rack band] [product image] [name + SKU + barcode]
 */
export function ProductLabelStrip({
  rackCode,
  product,
  compact = false,
}: {
  rackCode: string;
  product: LabelStripProduct;
  compact?: boolean;
}) {
  const barcodeRef = useRef<SVGSVGElement | null>(null);

  const labelName = (product.mainCategoryName ?? "").toString();
  const palette = categoryPalette(labelName);
  const rack = rackCode.trim().toUpperCase();
  const shelf = (product.shelf ?? "").toString().trim();
  const slotLabel = shelf ? `${rack}·${shelf.toUpperCase().slice(0, 1)}` : rack;
  const code = (product.barcode ?? product.sku ?? product.id).toString();

  useEffect(() => {
    if (!barcodeRef.current || !code) return;
    const onlyDigits = /^\d+$/.test(code);
    const format = onlyDigits && code.length === 13 ? "EAN13" : onlyDigits && code.length === 8 ? "EAN8" : "CODE128";
    const tryRender = (fmt: string) => {
      try {
        JsBarcode(barcodeRef.current!, code, {
          format: fmt,
          displayValue: !compact,
          fontSize: compact ? 0 : 13,
          textMargin: 2,
          height: compact ? 24 : 30,
          width: compact ? 1.0 : 1.3,
          margin: 0,
          background: "#ffffff",
          lineColor: "#000000",
        });
      } catch {
        if (fmt !== "CODE128") tryRender("CODE128");
      }
    };
    tryRender(format);
  }, [code, compact]);

  return (
    <div className="rack-card border-2 border-black rounded overflow-hidden bg-white text-black break-inside-avoid flex flex-row items-stretch w-full h-full">
      {/* Left band: rack + shelf in origin color */}
      <div
        className="flex flex-col items-center justify-center shrink-0"
        style={{ background: palette.bg, color: palette.fg, minWidth: compact ? "1.4cm" : "1.6cm" }}
      >
        <span
          className="font-black text-center leading-none"
          style={{ fontSize: compact ? "7px" : "9px", writingMode: "vertical-rl", transform: "rotate(180deg)" }}
        >
          {slotLabel}
        </span>
      </div>

      {/* Product image */}
      <div
        className="shrink-0 bg-white flex items-center justify-center overflow-hidden border-r border-black/10"
        style={{ width: compact ? "2.4cm" : "3.2cm" }}
      >
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name}
            className="w-full h-full object-contain"
            referrerPolicy="no-referrer"
            loading="eager"
            decoding="sync"
            style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" } as React.CSSProperties}
          />
        ) : (
          <Package className="text-neutral-300" style={{ width: compact ? "16px" : "20px", height: compact ? "16px" : "20px" }} />
        )}
      </div>

      {/* Name + SKU + barcode */}
      <div className="flex flex-col justify-center px-1 py-0.5 overflow-hidden flex-1 min-w-0">
        <div className="font-bold leading-tight truncate" style={{ fontSize: compact ? "7px" : "9px" }}>
          {product.name}
        </div>
        {!compact && (
          <div className="font-mono text-neutral-600 leading-none" style={{ fontSize: "7px" }}>
            {product.sku ?? ""}
          </div>
        )}
        <svg ref={barcodeRef} className="w-full block mt-0.5" style={{ maxHeight: compact ? "26px" : "36px" }} />
      </div>
    </div>
  );
}
