import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Printer } from "lucide-react";
import { RackQRLabel } from "@/components/app/RackQRLabel";
import { DEFAULT_RACK_CODES } from "@/lib/racks";

const search = z.object({
  ids: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/racks/print")({
  validateSearch: (s) => search.parse(s),
  component: PrintRackLabels,
});

const SIZES = [
  { key: "xs", label: "XS", desc: "4 × 5.5 cm", w: "4cm", h: "5.5cm", qr: 110, cols: 4 },
  { key: "sm", label: "SM", desc: "5 × 7 cm",   w: "5cm", h: "7cm",   qr: 140, cols: 3 },
  { key: "md", label: "MD", desc: "6 × 9 cm",   w: "6cm", h: "9cm",   qr: 170, cols: 3 },
  { key: "lg", label: "LG", desc: "6 × 11 cm",  w: "6cm", h: "11cm",  qr: 190, cols: 3 },
] as const;
type SizeKey = (typeof SIZES)[number]["key"];

function PrintRackLabels() {
  const { ids } = Route.useSearch();
  const list: string[] = ids
    ? ids.split(",").map((s: string) => s.trim()).filter(Boolean)
    : [...DEFAULT_RACK_CODES];

  const [sizeKey, setSizeKey] = useState<SizeKey>("lg");
  const sz = SIZES.find((s) => s.key === sizeKey)!;

  useEffect(() => {
    document.title = `Print rack labels (${list.length})`;
  }, [list.length]);

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto">
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
          <span className="text-sm text-muted-foreground">{list.length} label{list.length === 1 ? "" : "s"}</span>
          <Button onClick={() => window.print()} className="gradient-primary text-primary-foreground border-0 gap-2">
            <Printer className="size-4" /> Print
          </Button>
        </div>
      </div>

      <div className="print:p-0 print:max-w-none">
        <h1 className="text-2xl font-semibold tracking-tight mb-1 print:hidden">Rack QR labels</h1>
        <p className="text-sm text-muted-foreground mb-6 print:hidden">
          Stick one on each rack. Scan with the floating scanner to open that rack instantly.
          Select a size above, then print — labels are fixed physical size for easy cutting.
        </p>
        <div
          id="print-area"
          style={{ display: "flex", flexWrap: "wrap", gap: "4mm", alignItems: "flex-start" }}
        >
          {list.map((id: string) => (
            <div
              key={id}
              className="rack-label-wrap"
              style={{ width: sz.w, minHeight: sz.h, flexShrink: 0 }}
            >
              <RackQRLabel rackId={id} size={sz.qr} />
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 10mm; }
          html, body { background: white !important; margin: 0 !important; padding: 0 !important; }
          body * { visibility: hidden !important; }
          #print-area, #print-area * { visibility: visible !important; }
          #print-area {
            position: absolute !important;
            left: 0; top: 0;
            width: 100%;
            display: flex !important;
            flex-wrap: wrap !important;
            gap: 4mm !important;
            align-items: flex-start !important;
            padding: 0 !important;
            margin: 0 !important;
          }
          .rack-label-wrap {
            width: ${sz.w} !important;
            min-height: ${sz.h} !important;
            flex-shrink: 0 !important;
            break-inside: avoid !important;
          }
          .rack-label { break-inside: avoid; page-break-inside: avoid; height: 100%; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>
    </div>
  );
}
