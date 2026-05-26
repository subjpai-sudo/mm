import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/app/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, Clock, X, PackageCheck, Container, Plus, Search, FolderTree, ChevronRight, RotateCcw } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { decideOrderRequest, markShipmentArrived, logContainer, updateShipment } from "@/lib/shipments.functions";

export const Route = createFileRoute("/_authenticated/shipments")({ component: ShipmentsPage });

type Row = {
  id: string;
  product_name: string;
  quantity: number;
  type: "restock" | "new_order";
  status: "pending" | "approved" | "backordered" | "declined";
  notes: string | null;
  created_at: string;
  product_id: string | null;
  category_id: string | null;
  container_date: string | null;
  expected_arrival_date: string | null;
  arrived_at: string | null;
};

type Cat = { id: string; name: string; parent_id: string | null };

/**
 * One-dropdown cascading category picker.
 * Shows current path as breadcrumb chips. The single Select shows children
 * of the deepest selected node (or roots if none). Picking an item drills
 * deeper. "Use this" confirms current selection. Always optional.
 */
function CategoryCascadePicker({
  categories, value, onChange, placeholder = "Pick category (optional)",
}: {
  categories: Cat[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
}) {
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const childrenOf = useMemo(() => {
    const m = new Map<string | null, Cat[]>();
    for (const c of categories) {
      const k = c.parent_id;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(c);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.name.localeCompare(b.name));
    return m;
  }, [categories]);

  // Build the selected path from the value (for chips)
  const path = useMemo(() => {
    const out: Cat[] = [];
    let cur = value ? byId.get(value) : undefined;
    while (cur) { out.unshift(cur); cur = cur.parent_id ? byId.get(cur.parent_id) : undefined; }
    return out;
  }, [value, byId]);

  // The "current level" we're browsing — children of the deepest selection,
  // or roots if nothing selected.
  const [browseParent, setBrowseParent] = useState<string | null>(value ?? null);
  // Sync browseParent when value changes externally.
  const browseKey = value ?? null;
  if (browseParent !== browseKey && browseParent === null && value) setBrowseParent(value);

  const currentChildren = childrenOf.get(browseParent) ?? [];

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5 min-h-[28px]">
        {path.length === 0 && <span className="text-xs text-muted-foreground">No category selected</span>}
        {path.map((c, i) => (
          <span key={c.id} className="inline-flex items-center gap-1">
            {i > 0 && <ChevronRight className="size-3 text-muted-foreground" />}
            <button
              type="button"
              onClick={() => { onChange(c.id); setBrowseParent(c.id); }}
              className="px-2 py-0.5 rounded-full bg-secondary text-xs hover:bg-secondary/80"
            >
              {c.name}
            </button>
          </span>
        ))}
        {(path.length > 0 || browseParent) && (
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs"
            onClick={() => { onChange(null); setBrowseParent(null); }}>
            <RotateCcw className="size-3" />Reset
          </Button>
        )}
      </div>
      <Select
        value=""
        onValueChange={(v) => {
          if (!v) return;
          onChange(v);
          // If the picked item has children, drill into it; otherwise stay.
          const hasKids = (childrenOf.get(v) ?? []).length > 0;
          setBrowseParent(hasKids ? v : v);
        }}
      >
        <SelectTrigger className="h-9">
          <SelectValue placeholder={
            browseParent
              ? `Pick under "${byId.get(browseParent)?.name ?? "…"}"…`
              : placeholder
          } />
        </SelectTrigger>
        <SelectContent>
          {currentChildren.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              {browseParent ? "No further sub-categories" : "No categories yet"}
            </div>
          )}
          {currentChildren.map((c) => {
            const hasKids = (childrenOf.get(c.id) ?? []).length > 0;
            return (
              <SelectItem key={c.id} value={c.id}>
                <span className="flex items-center gap-2">
                  <span>{c.name}</span>
                  {hasKids && <span className="text-[10px] text-muted-foreground">({(childrenOf.get(c.id) ?? []).length})</span>}
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Returns set of category ids matching the picked category and all descendants.
 * Used by the filter bar so picking "Myanmar" matches its sub-categories too.
 */
function descendantIds(rootId: string, cats: Cat[]): Set<string> {
  const set = new Set<string>([rootId]);
  let added = true;
  while (added) {
    added = false;
    for (const c of cats) {
      if (c.parent_id && set.has(c.parent_id) && !set.has(c.id)) {
        set.add(c.id);
        added = true;
      }
    }
  }
  return set;
}

function StatusBadge({ status, arrived }: { status: string; arrived: boolean }) {
  if (arrived) return <Badge className="bg-primary/15 text-primary border-primary/30 hover:bg-primary/15"><PackageCheck className="size-3 mr-1" />Arrived</Badge>;
  if (status === "approved") return <Badge className="bg-success/15 text-success border-success/30 hover:bg-success/15"><Check className="size-3 mr-1" />Accepted</Badge>;
  if (status === "backordered") return <Badge className="bg-warning/15 text-warning border-warning/30 hover:bg-warning/15"><Clock className="size-3 mr-1" />Backordered</Badge>;
  if (status === "declined") return <Badge className="bg-destructive/15 text-destructive border-destructive/30 hover:bg-destructive/15"><X className="size-3 mr-1" />Declined</Badge>;
  return <Badge variant="outline"><Clock className="size-3 mr-1" />Pending</Badge>;
}

function ShipmentsPage() {
  const { role } = useAuth();
  const qc = useQueryClient();
  const isAdmin = role === "admin";
  const isOwner = role === "owner";
  const canDecide = isAdmin || isOwner;

  const { data: rows = [] } = useQuery({
    queryKey: ["shipments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("order_requests")
        .select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });
  const { data: products = [] } = useQuery({
    queryKey: ["products-min"],
    queryFn: async () => (await supabase.from("products").select("id, name, category_id")).data ?? [],
  });
  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () =>
      ((await supabase.from("categories").select("id, name, parent_id").order("name")).data ?? []) as Cat[],
  });

  const decideFn = useServerFn(decideOrderRequest);
  const arriveFn = useServerFn(markShipmentArrived);
  const logFn = useServerFn(logContainer);
  const updateFn = useServerFn(updateShipment);

  const decide = useMutation({
    mutationFn: (vars: any) => decideFn({ data: vars }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["shipments"] }); toast.success("Decision saved"); },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });
  const arrive = useMutation({
    mutationFn: (vars: any) => arriveFn({ data: vars }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["shipments"] }); qc.invalidateQueries({ queryKey: ["products"] }); toast.success("Marked as arrived – stock updated"); },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });
  const log = useMutation({
    mutationFn: (vars: any) => logFn({ data: vars }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["shipments"] }); toast.success("Container logged"); },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });
  const update = useMutation({
    mutationFn: (vars: any) => updateFn({ data: vars }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["shipments"] }); toast.success("Updated"); },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  // ---- Filters ----
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "approved" | "backordered" | "declined" | "arrived">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filterCategoryId, setFilterCategoryId] = useState<string | null>(null);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const catSet = filterCategoryId ? descendantIds(filterCategoryId, categories) : null;
    const fromTs = dateFrom ? new Date(dateFrom).getTime() : null;
    const toTs = dateTo ? new Date(dateTo).getTime() + 86_400_000 : null; // inclusive end of day
    return rows.filter((r) => {
      if (q && !r.product_name.toLowerCase().includes(q)) return false;
      if (catSet && (!r.category_id || !catSet.has(r.category_id))) return false;
      if (fromTs && new Date(r.created_at).getTime() < fromTs) return false;
      if (toTs && new Date(r.created_at).getTime() > toTs) return false;
      if (statusFilter === "arrived" && !r.arrived_at) return false;
      if (statusFilter !== "all" && statusFilter !== "arrived" && r.status !== statusFilter) return false;
      return true;
    });
  }, [rows, search, statusFilter, dateFrom, dateTo, filterCategoryId, categories]);

  const pendingDecision = filteredRows.filter(r => r.status === "pending");
  const pendingShipment = filteredRows.filter(r => !r.arrived_at && (r.status === "approved" || r.status === "backordered"));
  const arrived = filteredRows.filter(r => r.arrived_at);
  const declined = filteredRows.filter(r => r.status === "declined");

  const activeFilterCount =
    (search ? 1 : 0) + (statusFilter !== "all" ? 1 : 0) + (dateFrom ? 1 : 0) + (dateTo ? 1 : 0) + (filterCategoryId ? 1 : 0);

  const catMap = new Map(categories.map((c: any) => [c.id, c.name]));

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <PageHeader
        title="Shipments & Containers"
        subtitle="Approve requests, track containers, mark arrivals."
        actions={canDecide ? <LogContainerDialog onSubmit={(v) => log.mutate(v)} categories={categories} products={products} /> : undefined}
      />

      <Card className="card-elevated p-3 md:p-4 mb-4">
        <div className="grid gap-3 md:grid-cols-12">
          <div className="md:col-span-4">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Search product</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Search by product name…"
                value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="md:col-span-2">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Status</Label>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Accepted</SelectItem>
                <SelectItem value="backordered">Backordered</SelectItem>
                <SelectItem value="declined">Declined</SelectItem>
                <SelectItem value="arrived">Arrived</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">From</Label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">To</Label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <div className="md:col-span-2 flex items-end">
            <Button variant="ghost" className="w-full" disabled={activeFilterCount === 0}
              onClick={() => { setSearch(""); setStatusFilter("all"); setDateFrom(""); setDateTo(""); setFilterCategoryId(null); }}>
              <RotateCcw className="size-4" />Clear ({activeFilterCount})
            </Button>
          </div>
          <div className="md:col-span-12">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <FolderTree className="size-3" />Category (cascading)
            </Label>
            <CategoryCascadePicker
              categories={categories}
              value={filterCategoryId}
              onChange={setFilterCategoryId}
              placeholder="Pick top-level category (e.g. Myanmar, Rice…)"
            />
          </div>
        </div>
      </Card>

      <Tabs defaultValue="pending-shipment">
        <TabsList>
          <TabsTrigger value="awaiting">Awaiting Decision ({pendingDecision.length})</TabsTrigger>
          <TabsTrigger value="pending-shipment">Pending Shipment ({pendingShipment.length})</TabsTrigger>
          <TabsTrigger value="arrived">Arrived ({arrived.length})</TabsTrigger>
          <TabsTrigger value="declined">Declined ({declined.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="awaiting">
          <ShipmentTable
            rows={pendingDecision}
            categories={categories}
            products={products}
            catMap={catMap}
            renderActions={(r) => canDecide ? (
              <div className="flex items-center gap-1">
                <Button size="sm" className="bg-success text-success-foreground hover:bg-success/90 h-8"
                  onClick={() => decide.mutate({ id: r.id, decision: "approved" })}>
                  <Check className="size-3.5" />Accept
                </Button>
                <Button size="sm" className="bg-warning text-warning-foreground hover:bg-warning/90 h-8"
                  onClick={() => decide.mutate({ id: r.id, decision: "backordered" })}>
                  <Clock className="size-3.5" />Backorder
                </Button>
                <Button size="sm" variant="destructive" className="h-8"
                  onClick={() => decide.mutate({ id: r.id, decision: "declined" })}>
                  <X className="size-3.5" />Decline
                </Button>
                <DecideRow row={r} categories={categories} products={products} onDecide={(decision, extras) => decide.mutate({ id: r.id, decision, ...extras })} />
              </div>
            ) : <span className="text-xs text-muted-foreground">Owner / Admin only</span>}
          />
        </TabsContent>

        <TabsContent value="pending-shipment">
          <ShipmentTable
            rows={pendingShipment}
            categories={categories}
            products={products}
            catMap={catMap}
            editable={canDecide}
            onUpdate={(vars) => update.mutate(vars)}
            renderActions={(r) => isAdmin ? (
              <ArrivedDialog row={r} products={products} onConfirm={(vars) => arrive.mutate(vars)} />
            ) : <span className="text-xs text-muted-foreground">Admin marks arrival</span>}
          />
        </TabsContent>

        <TabsContent value="arrived">
          <ShipmentTable rows={arrived} categories={categories} products={products} catMap={catMap} />
        </TabsContent>

        <TabsContent value="declined">
          <ShipmentTable rows={declined} categories={categories} products={products} catMap={catMap} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ShipmentTable({
  rows, catMap, editable, onUpdate, renderActions,
}: {
  rows: Row[];
  categories: any[];
  products: any[];
  catMap: Map<string, string>;
  editable?: boolean;
  onUpdate?: (vars: any) => void;
  renderActions?: (r: Row) => React.ReactNode;
}) {
  return (
    <Card className="card-elevated p-0 overflow-hidden mt-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Status</TableHead>
            <TableHead>Product</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Qty</TableHead>
            <TableHead>Container date</TableHead>
            <TableHead>Expected arrival</TableHead>
            <TableHead>Created</TableHead>
            {renderActions && <TableHead className="w-[260px]">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow><TableCell colSpan={renderActions ? 8 : 7} className="text-center text-muted-foreground py-12">Nothing here</TableCell></TableRow>
          )}
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell><StatusBadge status={r.status} arrived={!!r.arrived_at} /></TableCell>
              <TableCell className="font-medium">{r.product_name}</TableCell>
              <TableCell className="text-muted-foreground">{r.category_id ? (catMap.get(r.category_id) ?? "—") : "—"}</TableCell>
              <TableCell>{r.quantity}</TableCell>
              <TableCell>
                {editable && onUpdate ? (
                  <Input type="date" defaultValue={r.container_date ?? ""} className="h-8 w-[150px]"
                    onBlur={(e) => { if (e.target.value !== (r.container_date ?? "")) onUpdate({ id: r.id, container_date: e.target.value || null }); }} />
                ) : (r.container_date ? format(new Date(r.container_date), "PP") : "—")}
              </TableCell>
              <TableCell>
                {editable && onUpdate ? (
                  <Input type="date" defaultValue={r.expected_arrival_date ?? ""} className="h-8 w-[150px]"
                    onBlur={(e) => { if (e.target.value !== (r.expected_arrival_date ?? "")) onUpdate({ id: r.id, expected_arrival_date: e.target.value || null }); }} />
                ) : (r.expected_arrival_date ? format(new Date(r.expected_arrival_date), "PP") : "—")}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">{format(new Date(r.created_at), "PP")}</TableCell>
              {renderActions && <TableCell>{renderActions(r)}</TableCell>}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function DecideRow({ row, categories, products, onDecide }: {
  row: Row; categories: Cat[]; products: any[];
  onDecide: (decision: "approved" | "backordered" | "declined", extras: any) => void;
}) {
  const [containerDate, setContainerDate] = useState(row.container_date ?? "");
  const [arrivalDate, setArrivalDate] = useState(row.expected_arrival_date ?? "");
  const [productId, setProductId] = useState<string | "">(row.product_id ?? "");
  const [categoryId, setCategoryId] = useState<string | "">(row.category_id ?? "");

  const extras = useMemo(() => ({
    container_date: containerDate || null,
    expected_arrival_date: arrivalDate || null,
    product_id: productId || null,
    category_id: categoryId || null,
  }), [containerDate, arrivalDate, productId, categoryId]);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">Review</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Review request</DialogTitle>
          <DialogDescription>{row.product_name} · {row.quantity} units</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Container date</Label>
              <Input type="date" value={containerDate} onChange={(e) => setContainerDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Expected arrival</Label>
              <Input type="date" value={arrivalDate} onChange={(e) => setArrivalDate(e.target.value)} />
            </div>
          </div>
          <div>
            <Label className="text-xs">Link to product (for stock-in on arrival)</Label>
            <Select value={productId} onValueChange={(v) => setProductId(v === "__none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Select product (optional)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">— None —</SelectItem>
                {products.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Category (optional)</Label>
            <CategoryCascadePicker
              categories={categories}
              value={categoryId || null}
              onChange={(id) => setCategoryId(id ?? "")}
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="destructive" onClick={() => onDecide("declined", extras)}><X className="size-4" />Decline</Button>
          <Button className="bg-warning text-warning-foreground hover:bg-warning/90" onClick={() => onDecide("backordered", extras)}><Clock className="size-4" />Backorder</Button>
          <Button className="bg-success text-success-foreground hover:bg-success/90" onClick={() => onDecide("approved", extras)}><Check className="size-4" />Accept</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ArrivedDialog({ row, products, onConfirm }: {
  row: Row; products: any[]; onConfirm: (vars: any) => void;
}) {
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState<string | "">(row.product_id ?? "");
  const [qty, setQty] = useState<number>(row.quantity);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="bg-primary"><PackageCheck className="size-4" />Arrived</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Mark shipment as arrived</DialogTitle>
          <DialogDescription>Stock will be added to the linked product.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Product</Label>
            <Select value={productId} onValueChange={(v) => setProductId(v === "__none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">— No stock change —</SelectItem>
                {products.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Quantity received</Label>
            <Input type="number" min={1} value={qty} onChange={(e) => setQty(parseInt(e.target.value || "0", 10))} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => { onConfirm({ id: row.id, product_id: productId || null, quantity: qty }); setOpen(false); }}>
            Confirm arrival
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LogContainerDialog({ onSubmit, categories, products }: {
  onSubmit: (vars: any) => void; categories: Cat[]; products: any[];
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [qty, setQty] = useState<number>(1);
  const [productId, setProductId] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [containerDate, setContainerDate] = useState("");
  const [arrivalDate, setArrivalDate] = useState("");
  const [notes, setNotes] = useState("");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="size-4" />Log container</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle><Container className="inline size-4 mr-1" />Log a new container</DialogTitle>
          <DialogDescription>Record an inbound shipment with container & arrival dates.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label className="text-xs">Product name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Box of widgets" />
            </div>
            <div>
              <Label className="text-xs">Quantity</Label>
              <Input type="number" min={1} value={qty} onChange={(e) => setQty(parseInt(e.target.value || "0", 10))} />
            </div>
            <div>
              <Label className="text-xs">Link product (optional)</Label>
              <Select value={productId} onValueChange={(v) => setProductId(v === "__none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— None —</SelectItem>
                  {products.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Category (optional)</Label>
              <CategoryCascadePicker
                categories={categories}
                value={categoryId || null}
                onChange={(id) => setCategoryId(id ?? "")}
              />
            </div>
            <div>
              <Label className="text-xs">Container date</Label>
              <Input type="date" value={containerDate} onChange={(e) => setContainerDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Expected arrival</Label>
              <Input type="date" value={arrivalDate} onChange={(e) => setArrivalDate(e.target.value)} />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button disabled={!name || qty < 1} onClick={() => {
            onSubmit({
              product_name: name,
              quantity: qty,
              product_id: productId || null,
              category_id: categoryId || null,
              container_date: containerDate || null,
              expected_arrival_date: arrivalDate || null,
              notes: notes || null,
            });
            setOpen(false);
            setName(""); setQty(1); setProductId(""); setCategoryId(""); setContainerDate(""); setArrivalDate(""); setNotes("");
          }}>Save container</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}