import { createFileRoute, Outlet, useNavigate, Link, useLocation, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, NAV_BY_ROLE, type Role } from "@/lib/auth";
import {
  LayoutDashboard, PackagePlus, PackageMinus, Boxes,
  ShoppingCart, ClipboardList, BarChart3, Settings as SettingsIcon,
  LogOut, Shield, UserCog, Eye, Menu, Activity, Users as UsersIcon,
  ScrollText, PackageCheck, Database, Warehouse, Store,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

export const Route = createFileRoute("/_authenticated")({ component: ProtectedLayout });

const NAV = [
  { id: "dashboard", to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "stock-in", to: "/stock-in", label: "Stock In", icon: PackagePlus },
  { id: "stock-out", to: "/stock-out", label: "Stock Out", icon: PackageMinus },
  { id: "products", to: "/products", label: "Products", icon: Boxes },
  { id: "racks", to: "/racks", label: "Racks", icon: Warehouse },
  { id: "shops", to: "/shops", label: "Shops", icon: Store },
  { id: "order-request", to: "/order-request", label: "Order Request", icon: ShoppingCart },
  { id: "shipments", to: "/shipments", label: "Shipments", icon: PackageCheck },
  { id: "order-history", to: "/order-history", label: "Order History", icon: ClipboardList },
  { id: "reports", to: "/reports", label: "Reports", icon: BarChart3 },
  { id: "settings", to: "/settings", label: "Settings", icon: SettingsIcon },
  { id: "users", to: "/users", label: "Users", icon: UsersIcon },
  { id: "audit", to: "/audit", label: "Audit Log", icon: ScrollText },
  { id: "health", to: "/health", label: "Health", icon: Activity },
  { id: "backups", to: "/backups", label: "Backups", icon: Database },
] as const;

const ROLE_META: Record<Role, { label: string; icon: any; cls: string }> = {
  admin:    { label: "Admin",    icon: Shield,  cls: "bg-primary/15 text-primary border-primary/30" },
  operator: { label: "Operator", icon: UserCog, cls: "bg-accent/15 text-accent border-accent/30" },
  owner:    { label: "Owner",    icon: Eye,     cls: "bg-success/15 text-success border-success/30" },
};

function ProtectedLayout() {
  const { session, loading, role, user, signOut, mustChangePin } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const qc = useQueryClient();

  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  useEffect(() => {
    if (!loading && !session) nav({ to: "/login" });
  }, [loading, session, nav]);

  // Global realtime: invalidate caches when any of these tables change
  useEffect(() => {
    if (!session) return;
    const channel = supabase
      .channel("global-db-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, () => {
        qc.invalidateQueries({ queryKey: ["products"] });
        qc.invalidateQueries({ queryKey: ["recent-barcodes"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "stock_movements" }, () => {
        qc.invalidateQueries({ queryKey: ["movements-recent"] });
        qc.invalidateQueries({ queryKey: ["products"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "order_requests" }, () => {
        qc.invalidateQueries({ queryKey: ["orders"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "categories" }, () => {
        qc.invalidateQueries({ queryKey: ["categories"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session, qc]);

  if (loading || !session || !role) {
    return <div className="min-h-screen grid place-items-center text-muted-foreground">Loading…</div>;
  }

  // Force PIN change before accessing any other page
  if (mustChangePin && location.pathname !== "/change-pin") {
    return <Navigate to="/change-pin" />;
  }

  const allowed = new Set(NAV_BY_ROLE[role]);
  const items = NAV.filter(n => allowed.has(n.id));
  const Meta = ROLE_META[role];

  const NavList = ({ onClick }: { onClick?: () => void }) => (
    <>
      {items.map(item => {
        const Icon = item.icon;
        const active = location.pathname.startsWith(item.to);
        return (
          <Link
            key={item.id} to={item.to} onClick={onClick}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-sm"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
            )}
          >
            <Icon className="size-4" />
            {item.label}
            {active && <span className="ml-auto size-1.5 rounded-full bg-primary glow" />}
          </Link>
        );
      })}
    </>
  );

  return (
    <div className="min-h-screen flex">
      <aside className="hidden md:flex flex-col w-64 border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="p-5 flex items-center gap-2.5 border-b border-sidebar-border">
          <div className="size-9 rounded-lg gradient-primary grid place-items-center"><Boxes className="size-5 text-primary-foreground" /></div>
          <div>
            <div className="font-semibold tracking-tight leading-tight">Stockflow</div>
            <div className="text-[10px] text-muted-foreground">Inventory OS</div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          <NavList />
        </nav>

        <div className="p-3 border-t border-sidebar-border">
          <div className={cn("flex items-center gap-2 px-3 py-2 rounded-lg border text-xs", Meta.cls)}>
            <Meta.icon className="size-3.5" /> <span className="font-medium">{Meta.label}</span>
          </div>
          <div className="px-1 mt-3 text-xs">
            <div className="truncate font-medium">{user?.email}</div>
          </div>
          <Button onClick={() => signOut()} variant="ghost" size="sm" className="w-full justify-start mt-2 text-muted-foreground">
            <LogOut className="size-4" /> Sign out
          </Button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 pb-20 md:pb-0">
        <div className="md:hidden sticky top-0 z-30 flex items-center justify-between px-4 h-14 border-b border-border bg-sidebar/90 backdrop-blur">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Menu"><Menu className="size-5" /></Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0 bg-sidebar border-sidebar-border">
              <div className="p-5 flex items-center gap-2.5 border-b border-sidebar-border">
                <div className="size-9 rounded-lg gradient-primary grid place-items-center"><Boxes className="size-5 text-primary-foreground" /></div>
                <div>
                  <div className="font-semibold tracking-tight leading-tight">Stockflow</div>
                  <div className="text-[10px] text-muted-foreground">Inventory OS</div>
                </div>
              </div>
              <nav className="p-3 space-y-1">
                <NavList onClick={() => setMobileOpen(false)} />
              </nav>
              <div className="p-3 border-t border-sidebar-border mt-auto">
                <div className={cn("flex items-center gap-2 px-3 py-2 rounded-lg border text-xs", Meta.cls)}>
                  <Meta.icon className="size-3.5" /> <span className="font-medium">{Meta.label}</span>
                </div>
                <div className="px-1 mt-3 text-xs truncate font-medium">{user?.email}</div>
                <Button onClick={() => signOut()} variant="ghost" size="sm" className="w-full justify-start mt-2 text-muted-foreground">
                  <LogOut className="size-4" /> Sign out
                </Button>
              </div>
            </SheetContent>
          </Sheet>
          <div className="flex items-center gap-2">
            <div className="size-7 rounded-lg gradient-primary grid place-items-center"><Boxes className="size-4 text-primary-foreground" /></div>
            <span className="font-semibold text-sm">Stockflow</span>
          </div>
          <div className={cn("flex items-center gap-1.5 px-2 py-1 rounded-full border text-[10px]", Meta.cls)}>
            <Meta.icon className="size-3" />{Meta.label}
          </div>
        </div>
        <Outlet />

        {/* Mobile bottom tab bar — primary actions */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-sidebar/95 backdrop-blur border-t border-sidebar-border flex items-stretch h-16 px-2 pb-[env(safe-area-inset-bottom)]">
          {items.slice(0, 5).map(item => {
            const Icon = item.icon;
            const active = location.pathname.startsWith(item.to);
            return (
              <Link key={item.id} to={item.to}
                className={cn(
                  "flex-1 flex flex-col items-center justify-center gap-1 text-[10px] font-medium rounded-lg mx-0.5 my-1.5 transition-all",
                  active ? "text-primary bg-primary/10" : "text-muted-foreground"
                )}>
                <Icon className="size-5" />
                <span className="truncate max-w-full px-1">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </main>
    </div>
  );
}
