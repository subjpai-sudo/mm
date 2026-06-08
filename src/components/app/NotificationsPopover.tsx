import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import {
  Bell, ArrowUpRight, ArrowDownRight, AlertTriangle,
  PackageX, ShoppingCart, CheckCheck, ChevronRight,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

const LAST_SEEN_KEY = "cs-notif-last-seen";
function getLastSeen(): Date {
  try { const v = localStorage.getItem(LAST_SEEN_KEY); if (v) return new Date(v); } catch { /* */ }
  return new Date(0);
}
function saveLastSeen() {
  try { localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString()); } catch { /* */ }
}

type NotifKind = "stock_in" | "stock_out" | "low_stock" | "out_of_stock" | "order";

type NotifItem = {
  id: string;
  kind: NotifKind;
  title: string;
  detail: string;
  time: Date;
  to: string;
  search?: Record<string, string>;
};

const KIND_CONFIG: Record<NotifKind, {
  Icon: React.ElementType;
  iconCls: string;
  label: string;
}> = {
  stock_in:     { Icon: ArrowUpRight,   iconCls: "bg-success/15 text-success",      label: "Stock In" },
  stock_out:    { Icon: ArrowDownRight, iconCls: "bg-destructive/15 text-destructive", label: "Stock Out" },
  low_stock:    { Icon: AlertTriangle,  iconCls: "bg-warning/15 text-warning",       label: "Low Stock" },
  out_of_stock: { Icon: PackageX,       iconCls: "bg-destructive/15 text-destructive", label: "Out of Stock" },
  order:        { Icon: ShoppingCart,   iconCls: "bg-primary/15 text-primary",       label: "Order" },
};

export function NotificationsPopover() {
  const [open, setOpen] = useState(false);
  const [lastSeen, setLastSeen] = useState<Date>(getLastSeen);
  const nav = useNavigate();

  const { data: movements = [] } = useQuery({
    queryKey: ["notif-movements"],
    queryFn: async () =>
      (await supabase
        .from("stock_movements")
        .select("id, type, quantity, created_at, destination, products(id, name)")
        .order("created_at", { ascending: false })
        .limit(30)
      ).data ?? [],
    refetchInterval: false,
  });

  const { data: stockAlerts = [] } = useQuery({
    queryKey: ["notif-products"],
    queryFn: async () =>
      (await supabase
        .from("products")
        .select("id, name, stock, low_stock_threshold")
        .or("stock.lte.0,stock.lte.low_stock_threshold")
        .limit(50)
      ).data ?? [],
    refetchInterval: false,
  });

  const { data: orders = [] } = useQuery({
    queryKey: ["notif-orders"],
    queryFn: async () =>
      (await supabase
        .from("order_requests")
        .select("id, status, created_at, notes")
        .order("created_at", { ascending: false })
        .limit(10)
      ).data ?? [],
    refetchInterval: false,
  });

  const notifications: NotifItem[] = [
    ...(movements as any[]).map((m) => ({
      id: `mv-${m.id}`,
      kind: (m.type === "in" ? "stock_in" : "stock_out") as NotifKind,
      title: m.type === "in"
        ? `Stock In · ${m.products?.name ?? "Unknown"}`
        : `Stock Out · ${m.products?.name ?? "Unknown"}`,
      detail: m.type === "out" && m.destination
        ? `${m.quantity} units → ${m.destination}`
        : `${m.quantity} units received`,
      time: new Date(m.created_at),
      to: m.type === "in" ? "/stock-in" : "/stock-out",
    })),
    ...(stockAlerts as any[])
      .filter((p) => p.stock <= 0)
      .map((p) => ({
        id: `out-${p.id}`,
        kind: "out_of_stock" as NotifKind,
        title: "Out of Stock",
        detail: p.name,
        time: new Date(),
        to: "/products",
        search: { filter: "out" },
      })),
    ...(stockAlerts as any[])
      .filter((p) => p.stock > 0 && p.stock <= (p.low_stock_threshold ?? 5))
      .map((p) => ({
        id: `low-${p.id}`,
        kind: "low_stock" as NotifKind,
        title: `Low Stock · ${p.name}`,
        detail: `Only ${p.stock} left (min ${p.low_stock_threshold ?? 5})`,
        time: new Date(),
        to: "/products",
        search: { filter: "low" },
      })),
    ...(orders as any[]).map((o) => ({
      id: `ord-${o.id}`,
      kind: "order" as NotifKind,
      title: `Order Request · ${o.status ?? "pending"}`,
      detail: o.notes ? String(o.notes).slice(0, 60) : "New order request submitted",
      time: new Date(o.created_at),
      to: "/order-history",
    })),
  ].sort((a, b) => b.time.getTime() - a.time.getTime()).slice(0, 30);

  const unread =
    notifications.filter(
      (n) => n.kind !== "out_of_stock" && n.kind !== "low_stock" && n.time > lastSeen,
    ).length + (stockAlerts as any[]).filter((p) => p.stock <= 0).length;

  const handleOpen = useCallback((v: boolean) => {
    setOpen(v);
    if (v) { saveLastSeen(); setLastSeen(new Date()); }
  }, []);

  function goTo(n: NotifItem) {
    setOpen(false);
    nav({ to: n.to as any, search: n.search as any });
  }

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-9 rounded-[10px] border border-border hover:bg-secondary relative"
          aria-label="Notifications"
        >
          <Bell className="size-4" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold grid place-items-center px-0.5 leading-none">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" sideOffset={8} className="w-[380px] p-0 shadow-xl border-border overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Bell className="size-4 text-primary" />
            <span className="font-semibold text-sm">Notifications</span>
            {unread > 0 && (
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold px-1">
                {unread}
              </span>
            )}
          </div>
          {unread > 0 && (
            <button
              onClick={() => { saveLastSeen(); setLastSeen(new Date()); }}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition"
            >
              <CheckCheck className="size-3" /> Mark all read
            </button>
          )}
        </div>

        {/* List */}
        <div className="max-h-[440px] overflow-y-auto divide-y divide-border">
          {notifications.length === 0 && (
            <div className="p-8 text-center text-sm text-muted-foreground">No activity yet</div>
          )}

          {notifications.map((n) => {
            const { Icon, iconCls, label } = KIND_CONFIG[n.kind];
            const isNew = n.kind !== "out_of_stock" && n.kind !== "low_stock" && n.time > lastSeen;
            return (
              <button
                key={n.id}
                onClick={() => goTo(n)}
                className={cn(
                  "w-full flex items-start gap-3 px-4 py-3 text-left transition-colors group",
                  isNew
                    ? "bg-primary/[0.04] hover:bg-primary/[0.08]"
                    : "hover:bg-secondary/60",
                )}
              >
                {/* Icon */}
                <div className={cn("size-8 rounded-xl grid place-items-center shrink-0 mt-0.5", iconCls)}>
                  <Icon className="size-3.5" />
                </div>

                {/* Text */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-semibold leading-snug truncate">{n.title}</span>
                    {isNew && <span className="size-1.5 rounded-full bg-primary shrink-0" />}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug line-clamp-1">{n.detail}</p>
                  {n.kind !== "out_of_stock" && n.kind !== "low_stock" && (
                    <p className="text-[10px] text-muted-foreground/70 mt-0.5 tabular-nums">
                      {formatDistanceToNow(n.time, { addSuffix: true })}
                    </p>
                  )}
                </div>

                {/* Go arrow */}
                <ChevronRight className="size-3.5 text-muted-foreground shrink-0 mt-1 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            );
          })}
        </div>

        {/* Footer */}
        {notifications.length > 0 && (
          <div className="px-4 py-2.5 border-t border-border bg-secondary/30 flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">
              Tap any alert to open that section
            </span>
            <span className="text-[11px] text-muted-foreground opacity-60">
              Refreshes every 30s
            </span>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
