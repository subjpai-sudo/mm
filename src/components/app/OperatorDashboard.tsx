import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { LiveBadge } from "@/components/app/LiveBadge";
import { UniversalScanner } from "@/components/app/UniversalScanner";
import { useRealtimeSync } from "@/hooks/use-realtime-sync";
import { useAuth } from "@/lib/auth";
import { PackagePlus, PackageMinus, ScanLine, Boxes } from "lucide-react";

export function OperatorDashboard() {
  const { lastUpdated } = useRealtimeSync({ silent: true });
  const [scanOpen, setScanOpen] = useState(false);
  const { fullName, avatarUrl, user } = useAuth();
  const greetName = fullName ?? user?.email?.split("@")[0] ?? "there";
  const initials = (fullName ?? user?.email ?? "U")
    .split(/[\s.@]+/).filter(Boolean).slice(0, 2).map(s => s[0]?.toUpperCase()).join("");

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto min-h-[80vh] flex flex-col">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="size-12 rounded-full overflow-hidden border-2 border-primary/30 bg-muted grid place-items-center shrink-0">
            {avatarUrl ? (
              <img src={avatarUrl} alt={greetName} className="size-full object-cover" />
            ) : (
              <span className="font-semibold text-sm">{initials || "U"}</span>
            )}
          </div>
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Welcome</div>
            <div className="text-2xl font-semibold tracking-tight truncate">{greetName}</div>
          </div>
        </div>
        <LiveBadge lastUpdated={lastUpdated} />
      </div>

      <div className="flex-1 grid grid-cols-3 gap-3 sm:gap-4 mt-6">
        <Link to="/stock-in" className="block">
          <button className="w-full h-full min-h-[160px] sm:min-h-[200px] rounded-3xl border-2 border-success/30 bg-success/10 hover:bg-success/20 text-success font-bold inline-flex flex-col items-center justify-center gap-2 sm:gap-3 transition active:scale-[0.98] shadow-sm hover:shadow-md hover:-translate-y-0.5">
            <PackagePlus className="size-8 sm:size-12" />
            <span className="text-base sm:text-xl">Stock In</span>
          </button>
        </Link>
        <Link to="/stock-out" className="block">
          <button className="w-full h-full min-h-[160px] sm:min-h-[200px] rounded-3xl border-2 border-destructive/30 bg-destructive/10 hover:bg-destructive/20 text-destructive font-bold inline-flex flex-col items-center justify-center gap-2 sm:gap-3 transition active:scale-[0.98] shadow-sm hover:shadow-md hover:-translate-y-0.5">
            <PackageMinus className="size-8 sm:size-12" />
            <span className="text-base sm:text-xl">Stock Out</span>
            <span className="text-[10px] sm:text-[11px] font-medium opacity-80 hidden sm:inline">Shop or Delivery</span>
          </button>
        </Link>
        <button
          onClick={() => setScanOpen(true)}
          className="w-full h-full min-h-[160px] sm:min-h-[200px] rounded-3xl gradient-primary text-primary-foreground font-bold inline-flex flex-col items-center justify-center gap-2 sm:gap-3 transition active:scale-[0.98] shadow-[0_14px_36px_-14px_rgba(0,0,0,0.5)] hover:-translate-y-0.5"
        >
          <ScanLine className="size-8 sm:size-12" />
          <span className="text-base sm:text-xl text-center px-2">Scan QR / Barcode</span>
        </button>
      </div>

      <Link to="/products" className="mt-6 inline-flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground transition">
        <Boxes className="size-4" /> View product list
      </Link>

      <UniversalScanner open={scanOpen} onClose={() => setScanOpen(false)} />
    </div>
  );
}