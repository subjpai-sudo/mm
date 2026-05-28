import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { Card } from "@/components/ui/card";
import { format, startOfWeek, endOfWeek } from "date-fns";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight, Store, Truck, Receipt } from "lucide-react";

export const Route = createFileRoute("/_authenticated/billing-history")({ component: BillingHistoryPage });

interface BillingStore { id: string; name: string; sub: string | null; }
interface BillingCustomer { id: string; name: string; company: string | null; }
interface SavedInvoice {
  id: string; store_id: string | null; bill_to_type: string;
  bill_to_store_id: string | null; customer_id: string | null;
  invoice_no: string | null; date: string; items: any[];
  tax_rate: number; discount: number; subtotal: number; tax: number; total: number;
  created_at: string;
}

const db = () => supabase as any;

function groupByMonthWeek(invs: SavedInvoice[]) {
  const sorted = [...invs].sort((a, b) => b.date.localeCompare(a.date));
  const byMonth = new Map<string, Map<string, SavedInvoice[]>>();
  sorted.forEach(inv => {
    const d = new Date(inv.date + "T00:00:00");
    const monthKey = format(d, "yyyy-MM");
    const ws = startOfWeek(d, { weekStartsOn: 1 });
    const we = endOfWeek(d, { weekStartsOn: 1 });
    const weekKey = `${format(ws, "MMM d")}–${format(we, "MMM d")}`;
    if (!byMonth.has(monthKey)) byMonth.set(monthKey, new Map());
    const m = byMonth.get(monthKey)!;
    if (!m.has(weekKey)) m.set(weekKey, []);
    m.get(weekKey)!.push(inv);
  });
  return byMonth;
}

interface EntityCardProps {
  entityKey: string; invs: SavedInvoice[]; label: string; isShop: boolean;
  expandedEntity: string | null; setExpandedEntity: (k: string | null) => void;
  expandedGroup: string | null; setExpandedGroup: (k: string | null) => void;
}

function EntityCard({ entityKey, invs, label, isShop, expandedEntity, setExpandedEntity, expandedGroup, setExpandedGroup }: EntityCardProps) {
  const totalAmt = invs.reduce((s, i) => s + i.total, 0);
  const lastDate = invs[0]?.date;
  const isExpanded = expandedEntity === entityKey;
  const monthGroups = useMemo(() => groupByMonthWeek(invs), [invs]);

  return (
    <Card className="card-elevated overflow-hidden">
      <button
        className="w-full flex items-center gap-3 p-4 hover:bg-accent/30 transition-colors text-left"
        onClick={() => setExpandedEntity(isExpanded ? null : entityKey)}
      >
        <div className="size-10 rounded-xl bg-primary/10 grid place-items-center shrink-0">
          {isShop ? <Store className="size-4 text-primary" /> : <Truck className="size-4 text-primary" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate">{label}</div>
          <div className="text-xs text-muted-foreground">
            {invs.length} invoice{invs.length !== 1 ? "s" : ""}{lastDate ? ` · Last: ${lastDate}` : ""}
          </div>
        </div>
        <div className="text-right shrink-0 mr-2">
          <div className="font-bold tabular-nums">¥{totalAmt.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground">total</div>
        </div>
        {isExpanded ? <ChevronDown className="size-4 text-muted-foreground shrink-0" /> : <ChevronRight className="size-4 text-muted-foreground shrink-0" />}
      </button>

      {isExpanded && (
        <div className="border-t border-border">
          {Array.from(monthGroups.entries()).map(([monthKey, weekMap]) => {
            const monthLabel = format(new Date(monthKey + "-01"), "MMMM yyyy");
            const monthInvs = Array.from(weekMap.values()).flat();
            const monthTotal = monthInvs.reduce((s, i) => s + i.total, 0);
            const groupId = `${entityKey}::${monthKey}`;
            const isGroupOpen = expandedGroup === groupId;

            return (
              <div key={monthKey} className="border-b border-border last:border-0">
                <button
                  className="w-full flex items-center gap-2 px-4 py-2.5 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
                  onClick={() => setExpandedGroup(isGroupOpen ? null : groupId)}
                >
                  <div className="flex-1">
                    <span className="text-sm font-semibold">{monthLabel}</span>
                    <span className="text-xs text-muted-foreground ml-2">{monthInvs.length} invoices</span>
                  </div>
                  <span className="text-sm font-bold tabular-nums text-primary mr-1">¥{monthTotal.toLocaleString()}</span>
                  {isGroupOpen ? <ChevronDown className="size-3.5 text-muted-foreground" /> : <ChevronRight className="size-3.5 text-muted-foreground" />}
                </button>

                {isGroupOpen && (
                  <div>
                    {Array.from(weekMap.entries()).map(([weekLabel, weekInvs]) => {
                      const weekTotal = weekInvs.reduce((s, i) => s + i.total, 0);
                      return (
                        <div key={weekLabel}>
                          <div className="flex items-center gap-2 px-5 py-1.5 bg-muted/10 border-b border-border/40">
                            <span className="text-xs font-semibold text-muted-foreground flex-1 upper-label">
                              {weekLabel}
                            </span>
                            <span className="text-xs tabular-nums text-muted-foreground">
                              {weekInvs.length} · ¥{weekTotal.toLocaleString()}
                            </span>
                          </div>
                          {weekInvs.map(inv => (
                            <div key={inv.id} className="flex items-center gap-3 px-5 py-2.5 border-b border-border/30 hover:bg-accent/20 transition-colors">
                              <Receipt className="size-3.5 text-muted-foreground shrink-0" />
                              <div className="flex-1 min-w-0">
                                <span className="font-mono text-xs font-semibold">{inv.invoice_no || "—"}</span>
                                <span className="text-xs text-muted-foreground ml-2">{inv.date}</span>
                              </div>
                              <span className="text-xs text-muted-foreground">
                                {Array.isArray(inv.items) ? inv.items.length : 0} items
                              </span>
                              <span className="font-semibold tabular-nums text-sm">¥{inv.total.toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function BillingHistoryPage() {
  const [activeTab, setActiveTab] = useState<"shops" | "customers">("shops");
  const [expandedEntity, setExpandedEntity] = useState<string | null>(null);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  const { data: stores = [] } = useQuery<BillingStore[]>({
    queryKey: ["billing-stores"],
    queryFn: async () => (await db().from("billing_stores").select("id, name, sub")).data ?? [],
  });
  const { data: customers = [] } = useQuery<BillingCustomer[]>({
    queryKey: ["billing-customers"],
    queryFn: async () => (await db().from("billing_customers").select("id, name, company")).data ?? [],
  });
  const { data: invoices = [], isLoading } = useQuery<SavedInvoice[]>({
    queryKey: ["billing-invoices-history"],
    queryFn: async () => (await db().from("billing_invoices").select("*").order("date", { ascending: false })).data ?? [],
  });

  const shopInvoices = useMemo(() => invoices.filter(i => i.bill_to_type === "store"), [invoices]);
  const customerInvoices = useMemo(() => invoices.filter(i => i.bill_to_type === "customer"), [invoices]);
  const totalRevenue = useMemo(() => invoices.reduce((s, i) => s + i.total, 0), [invoices]);

  const byShop = useMemo(() => {
    const map = new Map<string, SavedInvoice[]>();
    shopInvoices.forEach(inv => {
      const key = inv.bill_to_store_id ?? "__unknown__";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(inv);
    });
    return Array.from(map.entries()).sort(([a], [b]) => {
      const la = stores.find(s => s.id === a)?.sub ?? a;
      const lb = stores.find(s => s.id === b)?.sub ?? b;
      return la.localeCompare(lb);
    });
  }, [shopInvoices, stores]);

  const byCustomer = useMemo(() => {
    const map = new Map<string, SavedInvoice[]>();
    customerInvoices.forEach(inv => {
      const key = inv.customer_id ?? "__unknown__";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(inv);
    });
    return Array.from(map.entries()).sort(([a], [b]) => {
      const ca = customers.find(c => c.id === a);
      const cb = customers.find(c => c.id === b);
      const la = ca ? (ca.company ?? ca.name) : a;
      const lb = cb ? (cb.company ?? cb.name) : b;
      return la.localeCompare(lb);
    });
  }, [customerInvoices, customers]);

  function getShopLabel(id: string) {
    const s = stores.find(s => s.id === id);
    return s ? `${s.name}${s.sub ? ` — ${s.sub}` : ""}` : id;
  }

  function getCustomerLabel(id: string) {
    const c = customers.find(c => c.id === id);
    if (!c) return id;
    return c.company ? `${c.company} — ${c.name}` : c.name;
  }

  const currentList = activeTab === "shops" ? byShop : byCustomer;
  const getLabel = activeTab === "shops" ? getShopLabel : getCustomerLabel;

  function switchTab(t: "shops" | "customers") {
    setActiveTab(t);
    setExpandedEntity(null);
    setExpandedGroup(null);
  }

  return (
    <div className="p-3 sm:p-6 md:p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <PageHeader eyebrow="Billing" title="Invoice History" subtitle="All invoices grouped by recipient and date." />
        <Link to="/billing" className="text-sm text-primary hover:underline font-medium">← New Invoice</Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: "Total Invoices", value: isLoading ? "…" : invoices.length.toString() },
          { label: "Total Revenue", value: isLoading ? "…" : `¥${totalRevenue.toLocaleString()}` },
          { label: "Recipients", value: isLoading ? "…" : (byShop.length + byCustomer.length).toString() },
        ].map(stat => (
          <Card key={stat.label} className="card-elevated p-4 text-center">
            <div className="text-2xl font-bold tabular-nums">{stat.value}</div>
            <div className="upper-label mt-0.5 text-muted-foreground" style={{ fontSize: 10 }}>{stat.label}</div>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <div className="grid grid-cols-2 gap-2 mb-5">
        {(["shops", "customers"] as const).map(tab => (
          <button key={tab} onClick={() => switchTab(tab)}
            className={cn("h-10 rounded-xl border flex items-center justify-center gap-2 text-sm font-semibold transition",
              activeTab === tab
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-secondary/40 hover:bg-secondary")}>
            {tab === "shops" ? <Store className="size-4" /> : <Truck className="size-4" />}
            {tab === "shops" ? `Shops (${byShop.length})` : `Customers (${byCustomer.length})`}
          </button>
        ))}
      </div>

      {/* Entity list */}
      {isLoading ? (
        <div className="text-center py-20 text-muted-foreground">Loading…</div>
      ) : currentList.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <Receipt className="size-10 mx-auto mb-3 opacity-30" />
          <p>No {activeTab === "shops" ? "shop" : "customer"} invoices yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {currentList.map(([entityKey, invs]) => (
            <EntityCard
              key={entityKey}
              entityKey={entityKey}
              invs={invs}
              label={getLabel(entityKey)}
              isShop={activeTab === "shops"}
              expandedEntity={expandedEntity}
              setExpandedEntity={setExpandedEntity}
              expandedGroup={expandedGroup}
              setExpandedGroup={setExpandedGroup}
            />
          ))}
        </div>
      )}
    </div>
  );
}
