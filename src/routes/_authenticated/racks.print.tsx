import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Printer } from "lucide-react";
import { RackQRLabel } from "@/components/app/RackQRLabel";
import { RACK_IDS } from "./racks";

const search = z.object({
  ids: z.string().optional(), // comma-separated rack IDs; defaults to all
});

export const Route = createFileRoute("/_authenticated/racks/print")({
  validateSearch: (s) => search.parse(s),
  component: PrintRackLabels,
});

function PrintRackLabels() {
  const { ids } = Route.useSearch();
  const list: string[] = ids
    ? ids.split(",").map((s: string) => s.trim()).filter(Boolean)
    : [...RACK_IDS];

  useEffect(() => {
    document.title = `Print rack labels (${list.length})`;
  }, [list.length]);

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto">
      {/* Toolbar — hidden in print */}
      <div className="flex items-center justify-between mb-6 print:hidden">
        <Link to="/racks" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> Back to racks
        </Link>
        <div className="flex items-center gap-2">
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
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 gap-4 print:gap-3">
          {list.map((id: string) => (
            <RackQRLabel key={id} rackId={id} />
          ))}
        </div>
      </div>

      <style>{`
        @media print {
          @page { size: A4; margin: 10mm; }
          body { background: white !important; }
          aside, nav, header, .print\\:hidden { display: none !important; }
          main { padding: 0 !important; }
        }
      `}</style>
    </div>
  );
}