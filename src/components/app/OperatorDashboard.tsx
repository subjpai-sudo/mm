import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { UniversalScanner } from "@/components/app/UniversalScanner";
import { useRealtimeSync } from "@/hooks/use-realtime-sync";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PackagePlus, PackageMinus, ScanLine, Boxes, AlertTriangle, ArrowUpRight, ArrowDownRight, ImageIcon } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export function OperatorDashboard() {
  useRealtimeSync({ silent: true });
  const [scanOpen, setScanOpen] = useState(false);
  const { fullName, avatarUrl, user } = useAuth();
  const greetName = fullName ?? user?.email?.split("@")[0] ?? "there";
  const initials = (fullName ?? user?.email ?? "U")
    .split(/[\s.@]+/).filter(Boolean).slice(0, 2).map(s => s[0]?.toUpperCase()).join("");

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await supabase.from("products").select("id, stock, low_stock_threshold")).data ?? [],
  });
  const { data: movements = [] } = useQuery({
    queryKey: ["movements-recent"],
    queryFn: async () => (await supabase.from("stock_movements").select("id, type, quantity, created_at, destination, products(name, image_url)").order("created_at", { ascending: false }).limit(4)).data ?? [],
  });
  const lowCount = (products as any[]).filter(p => p.stock > 0 && p.stock <= p.low_stock_threshold).length;
  const outCount = (products as any[]).filter(p => p.stock <= 0).length;
  const needsAttention = lowCount + outCount;

  return (
    <div className="p-4 md:p-8 max-w-[720px] mx-auto min-h-[80vh] flex flex-col gap-5">
      {/* Greeting */}
      <div className="flex items-center gap-3">
        <div className="size-14 rounded-full overflow-hidden border-2 border-primary/30 bg-muted grid place-items-center shrink-0">
          {avatarUrl
            ? <img src={avatarUrl} alt={greetName} className="size-full object-cover" />
            : <span className="font-semibold text-base">{initials || "U"}</span>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="upper-label">Welcome back</div>
          <div className="text-[26px] font-semibold tracking-[-0.025em] leading-tight truncate">{greetName}</div>
        </div>
        <span className="chip chip-ok"><span className="size-1.5 rounded-full bg-success animate-pulse" /> Online</span>
      </div>

      {/* Hero scan tile */}
      <button
        onClick={() => setScanOpen(true)}
        className="relative w-full rounded-[22px] gradient-primary text-primary-foreground text-left overflow-hidden px-6 py-7 min-h-[120px] active:scale-[0.99] transition shadow-[0_18px_40px_-20px_rgba(0,0,0,0.5)]"
      >
        <div aria-hidden className="grid-tex absolute inset-0 opacity-[0.18]" />
        <div className="relative flex items-center gap-5">
          <div className="size-16 rounded-[18px] bg-primary-foreground/15 grid place-items-center shrink-0">
            <ScanLine className="size-9" />
          </div>
          <div className="min-w-0">
            <div className="upper-label text-primary-foreground/80" style={{ color: "currentColor", opacity: 0.85 }}>Tap to scan</div>
            <div className="text-[22px] font-semibold tracking-tight leading-tight mt-1">Scan QR or Barcode</div>
            <div className="text-[12px] opacity-85 mt-1">Product info · rack contents · quick actions</div>
          </div>
        </div>
      </button>

      {/* 2-up Stock In / Out */}
      <div className="grid grid-cols-2 gap-3">
        <Link to="/stock-in" className="block">
          <button className="w-full min-h-[130px] rounded-[18px] border border-success/30 bg-success/10 hover:bg-success/15 text-success font-semibold inline-flex flex-col items-start justify-between p-4 transition active:scale-[0.98] hover:-translate-y-0.5 text-left">
            <span className="size-11 rounded-[12px] bg-success/20 grid place-items-center"><PackagePlus className="size-5" /></span>
            <span className="block">
              <span className="upper-label text-success/80" style={{ color: "currentColor", opacity: 0.8 }}>Receive</span>
              <span className="block text-[20px] font-semibold tracking-tight mt-0.5">Stock In</span>
            </span>
          </button>
        </Link>
        <Link to="/stock-out" className="block">
          <button className="w-full min-h-[130px] rounded-[18px] border border-destructive/30 bg-destructive/10 hover:bg-destructive/15 text-destructive font-semibold inline-flex flex-col items-start justify-between p-4 transition active:scale-[0.98] hover:-translate-y-0.5 text-left">
            <span className="size-11 rounded-[12px] bg-destructive/20 grid place-items-center"><PackageMinus className="size-5" /></span>
            <span className="block">
              <span className="upper-label text-destructive/80" style={{ color: "currentColor", opacity: 0.8 }}>Dispatch</span>
              <span className="block text-[20px] font-semibold tracking-tight mt-0.5">Stock Out</span>
            </span>
          </button>
        </Link>
      </div>

      {/* Attention banner */}
      {needsAttention > 0 && (
        <Link to="/products" search={{ filter: "low" } as any} className="block">
          <div className="rounded-[14px] border border-warning/30 bg-warning/10 p-4 flex items-center gap-3 hover-lift">
            <div className="size-10 rounded-[12px] bg-warning/20 text-warning grid place-items-center shrink-0">
              <AlertTriangle className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold">Needs attention</div>
              <div className="text-[12px] text-muted-foreground">{outCount} out of stock · {lowCount} running low</div>
            </div>
            <span className="chip chip-warn">{needsAttention}</span>
          </div>
        </Link>
      )}

      {/* Recent activity */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="upper-label">Your recent activity</div>
        </div>
        <div className="rounded-[14px] border border-border bg-card divide-y divide-border overflow-hidden">
          {(movements as any[]).length === 0 && (
            <div className="p-6 text-center text-muted-foreground text-sm">No recent activity</div>
          )}
          {(movements as any[]).map((m) => {
            const isIn = m.type === "in";
            return (
              <div key={m.id} className="flex items-center gap-3 p-3">
                {m.products?.image_url
                  ? <img src={m.products.image_url} alt="" className="size-10 rounded-[10px] object-cover border border-border shrink-0" />
                  : <div className="size-10 rounded-[10px] bg-secondary grid place-items-center text-muted-foreground border border-border shrink-0"><ImageIcon className="size-4" /></div>}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`chip ${isIn ? "chip-ok" : "chip-bad"}`}>
                      {isIn ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
                      {isIn ? "+" : "-"}{m.quantity}
                    </span>
                    <span className="text-[13px] font-medium truncate">{m.products?.name ?? "—"}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {m.destination ? `${m.destination} · ` : ""}{formatDistanceToNow(new Date(m.created_at), { addSuffix: true })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Link to="/products" className="mt-1 inline-flex items-center justify-center gap-2 text-[13px] text-muted-foreground hover:text-foreground transition py-2">
        <Boxes className="size-4" /> Browse product catalog
      </Link>

      <UniversalScanner open={scanOpen} onClose={() => setScanOpen(false)} />
    </div>
  );
}