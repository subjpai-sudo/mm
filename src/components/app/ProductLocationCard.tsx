import { useEffect, useRef } from "react";
import QRCode from "qrcode";
import JsBarcode from "jsbarcode";
import { Package } from "lucide-react";
import { categoryPalette } from "@/lib/category-colors";
import { displaySize } from "@/lib/product-format";

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

/** Printable rack location card.
 *  Header band uses origin-based color (Myanmar = yellow, India/Pakistan/Bangladesh etc. use flag colors).
 *  Body shows the product image, name, SKU, the registered barcode (rendered as a real EAN/Code128 barcode),
 *  and a QR code that encodes the same barcode for quick mobile scanning. */
export function ProductLocationCard({
  rackCode,
  product,
}: {
  rackCode: string;
  product: LocationCardProduct;
}) {
  const barcodeRef = useRef<SVGSVGElement | null>(null);
  const qrRef = useRef<HTMLCanvasElement | null>(null);

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
      // Pick format that fits the data — EAN-13 for 13-digit, otherwise Code128.
      const onlyDigits = /^\d+$/.test(code);
      const format = onlyDigits && code.length === 13 ? "EAN13" : onlyDigits && code.length === 8 ? "EAN8" : "CODE128";
      JsBarcode(barcodeRef.current, code, {
        format,
        displayValue: true,
        fontSize: 20,
        textMargin: 4,
        height: 90,
        width: 2.4,
        margin: 0,
        background: "#ffffff",
        lineColor: "#000000",
      });
    } catch {
      // Fallback to Code128 if data isn't valid for the inferred symbology.
        try {
          JsBarcode(barcodeRef.current, code, {
            format: "CODE128",
            displayValue: true,
            fontSize: 20,
            textMargin: 4,
            height: 90,
            width: 2.4,
            margin: 0,
          });
      } catch {
        /* leave svg empty */
      }
    }
  }, [code]);

  useEffect(() => {
    if (!qrRef.current) return;
    QRCode.toCanvas(qrRef.current, code, {
      width: 110,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#0a0f0d", light: "#ffffff" },
    }).catch(() => {});
  }, [code]);

  return (
    <div
      className="rack-card border-[3px] border-black rounded-2xl overflow-hidden bg-white text-black break-inside-avoid flex flex-col"
      style={{ width: "100%" }}
    >
      {/* Colored header band — origin/flag color */}
      <div
        className="px-3 py-2 text-center font-black tracking-tight"
        style={{ background: palette.bg, color: palette.fg }}
      >
        <div className="text-[10px] uppercase tracking-[0.2em] opacity-80 leading-none">
          {paletteLabel}
        </div>
        <div className="text-3xl leading-tight">{slotLabel}</div>
      </div>

      <div className="p-3 flex flex-col items-center gap-2">
        <div className="w-full aspect-square max-h-[180px] bg-white grid place-items-center overflow-hidden">
          {product.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.image_url}
              alt={product.name}
              className="w-full h-full object-contain print:!block"
              referrerPolicy="no-referrer"
              loading="eager"
              decoding="sync"
              style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" } as React.CSSProperties}
            />
          ) : (
            <Package className="size-12 text-neutral-300" />
          )}
        </div>

        <div className="text-center font-bold text-[15px] leading-tight line-clamp-2 min-h-[36px]">
          {product.name}
          {size ? <span className="ml-1 font-semibold text-neutral-600">· {size}</span> : null}
        </div>

        <div className="w-full flex items-center justify-between gap-3 pt-1">
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-mono text-neutral-700 truncate">
              SKU: <span className="font-bold text-black">{product.sku ?? "—"}</span>
            </div>
            {/* Larger barcode so operators can scan reliably from a printed label */}
            <svg ref={barcodeRef} className="w-full mt-1 block" />
          </div>
          <canvas ref={qrRef} className="rounded-md [image-rendering:pixelated] shrink-0" />
        </div>
      </div>
    </div>
  );
}