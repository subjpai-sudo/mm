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
  Search, Bell, ScanLine, Sun, Moon, ChevronDown, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { ScannerFAB } from "@/components/app/ScannerFAB";
import { UniversalScanner } from "@/components/app/UniversalScanner";

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
  const [scanOpen, setScanOpen] = useState(false);
  const [dark, setDark] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const stored = localStorage.getItem("cs-theme");
    if (stored) return stored === "dark";
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  });
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    localStorage.setItem("cs-theme", dark ? "dark" : "light");
  }, [dark]);
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
  const displayName = (user as any)?.user_metadata?.full_name || user?.email?.split("@")[0] || "User";
  const initials = (displayName as string).split(/[\s.@]+/).filter(Boolean).slice(0, 2).map(s => s[0]?.toUpperCase()).join("");

  // Breadcrumb from path
  const segs = location.pathname.split("/").filter(Boolean);
  const crumb = segs.length === 0 ? "Home" : segs.join(" / ");

  const NavList = ({ onClick }: { onClick?: () => void }) => (
    <>
      {items.map(item => {
        const Icon = item.icon;
        const active = location.pathname.startsWith(item.to);
        return (
          <Link
            key={item.id} to={item.to} onClick={onClick}
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-[10px] text-[13px] transition-all",
              active
                ? "bg-primary/10 text-primary font-semibold"
                : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
            )}
          >
            <Icon className="size-[15px]" />
            {item.label}
            {active && <span className="ml-auto size-1.5 rounded-full bg-primary" />}
          </Link>
        );
      })}
    </>
  );

  const Brand = (
    <div className="px-4 pt-5 pb-4 flex items-center gap-2.5 border-b border-sidebar-border">
      <div className="size-9 rounded-[10px] gradient-primary grid place-items-center">
        <Boxes className="size-5 text-primary-foreground" />
      </div>
      <div className="leading-tight">
        <div className="font-semibold tracking-tight text-[14px]">CityStar</div>
        <div className="upper-label" style={{ fontSize: 9 }}>Inventory v3.0</div>
      </div>
    </div>
  );

  const WarehouseSwitcher = (
    <button className="mx-3 mt-3 mb-2 flex items-center gap-2 rounded-[10px] border border-sidebar-border bg-sidebar-accent/40 hover:bg-sidebar-accent px-3 py-2 text-left">
      <Warehouse className="size-4 text-primary" />
      <div className="leading-tight min-w-0 flex-1">
        <div className="upper-label" style={{ fontSize: 9 }}>Warehouse</div>
        <div className="text-[12px] font-semibold truncate">Kawaguchi · Main</div>
      </div>
      <ChevronDown className="size-3.5 text-muted-foreground" />
    </button>
  );

  const SidebarFoot = (
    <div className="p-3 border-t border-sidebar-border space-y-3">
      <div className="rounded-[10px] border border-warning/30 bg-warning/10 p-2.5">
        <div className="flex items-center gap-1.5 text-warning text-[11px] font-semibold">
          <AlertTriangle className="size-3" /> Needs attention
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5 font-mono">R03 · R05 · R07</div>
      </div>
      <div className="flex items-center gap-2 px-1">
        <div className="size-8 rounded-full grid place-items-center bg-primary/15 text-primary text-[11px] font-bold border border-primary/30 shrink-0">
          {initials || "U"}
        </div>
        <div className="leading-tight min-w-0 flex-1">
          <div className="text-[12px] font-semibold truncate">{displayName}</div>
          <div className={cn("upper-label", Meta.cls && "text-primary")} style={{ fontSize: 9 }}>{Meta.label}</div>
        </div>
        <Button onClick={() => signOut()} variant="ghost" size="icon" className="size-7" aria-label="Sign out">
          <LogOut className="size-4" />
        </Button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-background">
      <aside className="hidden md:flex flex-col w-[232px] border-r border-sidebar-border bg-sidebar text-sidebar-foreground shrink-0">
        {Brand}
        {WarehouseSwitcher}
        <nav className="flex-1 px-2 py-1 space-y-0.5 overflow-y-auto">
          <NavList />
        </nav>
        {SidebarFoot}
      </aside>

      <main className="flex-1 min-w-0 pb-20 md:pb-0 flex flex-col">
        {/* Desktop top bar — 60px */}
        <header className="hidden md:flex sticky top-0 z-20 h-[60px] items-center gap-3 px-5 border-b border-border bg-background/85 backdrop-blur-md">
          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground truncate">
            {crumb}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="relative hidden lg:block">
              <Search className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                placeholder="Search SKU, product, rack…"
                className="h-9 w-72 rounded-[10px] border border-border bg-card pl-9 pr-14 text-[12.5px] focus:outline-none focus:ring-4 focus:ring-primary/15 focus:border-primary/50"
              />
              <kbd className="absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5 bg-secondary">⌘K</kbd>
            </div>
            <span className="hidden sm:inline-flex chip chip-ok">
              <span className="size-1.5 rounded-full bg-success animate-pulse" /> Live
            </span>
            <Button onClick={() => setScanOpen(true)} variant="ghost" size="icon" className="size-9 rounded-[10px] border border-border hover:bg-secondary" aria-label="Scan">
              <ScanLine className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" className="size-9 rounded-[10px] border border-border hover:bg-secondary relative" aria-label="Notifications">
              <Bell className="size-4" />
              <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-destructive" />
            </Button>
            <Button onClick={() => setDark(d => !d)} variant="ghost" size="icon" className="size-9 rounded-[10px] border border-border hover:bg-secondary" aria-label="Toggle theme">
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
          </div>
        </header>

        {/* Mobile header */}
        <div className="md:hidden sticky top-0 z-30 flex items-center justify-between px-4 h-14 border-b border-border bg-sidebar/90 backdrop-blur">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Menu"><Menu className="size-5" /></Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0 bg-sidebar border-sidebar-border flex flex-col">
              {Brand}
              {WarehouseSwitcher}
              <nav className="flex-1 px-2 py-1 space-y-0.5 overflow-y-auto">
                <NavList onClick={() => setMobileOpen(false)} />
              </nav>
              {SidebarFoot}
            </SheetContent>
          </Sheet>
          <div className="flex items-center gap-2">
            <div className="size-7 rounded-[8px] gradient-primary grid place-items-center"><Boxes className="size-4 text-primary-foreground" /></div>
            <span className="font-semibold text-sm tracking-tight">CityStar</span>
          </div>
          <div className="flex items-center gap-1">
            <Button onClick={() => setScanOpen(true)} variant="ghost" size="icon" className="size-8" aria-label="Scan"><ScanLine className="size-4" /></Button>
            <Button onClick={() => setDark(d => !d)} variant="ghost" size="icon" className="size-8" aria-label="Theme">
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <Outlet />
        </div>

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
      <ScannerFAB />
      <UniversalScanner open={scanOpen} onClose={() => setScanOpen(false)} />
    </div>
  );
}
