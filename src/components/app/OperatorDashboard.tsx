import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { LiveBadge } from "@/components/app/LiveBadge";
import { UniversalScanner } from "@/components/app/UniversalScanner";
import { useRealtimeSync } from "@/hooks/use-realtime-sync";
import { PackagePlus, PackageMinus, ScanLine, Boxes } from "lucide-react";

export function OperatorDashboard() {
  const { lastUpdated } = useRealtimeSync({ silent: true });
  const [scanOpen, setScanOpen] = useState(false);

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto min-h-[80vh] flex flex-col">
      <PageHeader title="Operator" subtitle="Pick an action." actions={<LiveBadge lastUpdated={lastUpdated} />} />

      <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
        <Link to="/stock-in" className="block">
          <button className="w-full h-full min-h-[180px] rounded-3xl border-2 border-success/30 bg-success/10 hover:bg-success/20 text-success font-bold inline-flex flex-col items-center justify-center gap-3 transition active:scale-[0.98] shadow-sm hover:shadow-md hover:-translate-y-0.5">
            <PackagePlus className="size-12" />
            <span className="text-xl">Stock In</span>
          </button>
        </Link>
        <Link to="/stock-out" className="block">
          <button className="w-full h-full min-h-[180px] rounded-3xl border-2 border-destructive/30 bg-destructive/10 hover:bg-destructive/20 text-destructive font-bold inline-flex flex-col items-center justify-center gap-3 transition active:scale-[0.98] shadow-sm hover:shadow-md hover:-translate-y-0.5">
            <PackageMinus className="size-12" />
            <span className="text-xl">Stock Out</span>
            <span className="text-[11px] font-medium opacity-80">Shop or Delivery</span>
          </button>
        </Link>
        <button
          onClick={() => setScanOpen(true)}
          className="w-full h-full min-h-[180px] rounded-3xl gradient-primary text-primary-foreground font-bold inline-flex flex-col items-center justify-center gap-3 transition active:scale-[0.98] shadow-[0_14px_36px_-14px_rgba(0,0,0,0.5)] hover:-translate-y-0.5"
        >
          <ScanLine className="size-12" />
          <span className="text-xl">Scan QR / Barcode</span>
        </button>
      </div>

      <Link to="/products" className="mt-6 inline-flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground transition">
        <Boxes className="size-4" /> View product list
      </Link>

      <UniversalScanner open={scanOpen} onClose={() => setScanOpen(false)} />
    </div>
  );
}