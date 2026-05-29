import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";
import { categoryPalette } from "@/lib/category-colors";

export type LabelStripProduct = {
  id: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  shelf?: string | null;
  mainCategoryName?: string | null;
};

/**
 * Compact landscape barcode strip label for small stickers (XS/SM sizes).
 * Left band = rack/shelf in origin color. Right side = name, SKU, barcode.
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
          fontSize: compact ? 0 : 14,
          textMargin: 2,
          height: compact ? 28 : 36,
          width: compact ? 1.2 : 1.5,
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
    <div
      className="rack-card border-2 border-black rounded overflow-hidden bg-white text-black break-inside-avoid flex flex-row items-stretch w-full h-full"
    >
      {/* Left band: rack + shelf in origin color */}
      <div
        className="flex flex-col items-center justify-center px-1 shrink-0"
        style={{ background: palette.bg, color: palette.fg, minWidth: compact ? "1.6cm" : "2cm" }}
      >
        <span className="font-black text-center leading-none" style={{ fontSize: compact ? "8px" : "10px", writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
          {slotLabel}
        </span>
      </div>

      {/* Right: name + SKU + barcode */}
      <div className="flex flex-col justify-center px-1 py-0.5 overflow-hidden flex-1 min-w-0">
        <div
          className="font-bold leading-tight truncate"
          style={{ fontSize: compact ? "7px" : "9px" }}
        >
          {product.name}
        </div>
        {!compact && (
          <div className="font-mono text-neutral-600 leading-none" style={{ fontSize: "7px" }}>
            {product.sku ?? ""}
          </div>
        )}
        <svg ref={barcodeRef} className="w-full block mt-0.5" style={{ maxHeight: compact ? "30px" : "42px" }} />
      </div>
    </div>
  );
}
