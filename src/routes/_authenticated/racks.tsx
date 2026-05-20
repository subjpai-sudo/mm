import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { Card } from "@/components/ui/card";
import { Warehouse, Package, AlertTriangle, PackageX, Printer, Plus, PencilLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { DEFAULT_RACK_CODES, formatRackLabel } from "@/lib/racks";

export const Route = createFileRoute("/_authenticated/racks")({ component: RacksIndex });

export const RACK_IDS = DEFAULT_RACK_CODES;

function RacksIndex() {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [renameRack, setRenameRack] = useState<{ id: string; code: string; name: string | null } | null>(null);
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await supabase.from("products").select("*").order("name")).data ?? [],
  });
  const { data: racks = [] } = useQuery({
    queryKey: ["racks"],
    queryFn: async () => (await supabase.from("racks").select("id, code, name").order("code")).data ?? [],
  });

  const createRack = useMutation({
    mutationFn: async ({ code, name }: { code: string; name: string }) => {
      const rackCode = code.trim().toUpperCase();
      if (!rackCode) throw new Error("Rack code is required");
      const { error } = await supabase.from("racks").insert({ code: rackCode, name: name.trim() || rackCode });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["racks"] });
      setCreateOpen(false);
      toast.success("Rack added");
    },
    onError: (error: any) => toast.error(error.message),
  });

  const renameMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const nextName = name.trim();
      if (!nextName) throw new Error("Rack name is required");
      const { error } = await supabase.from("racks").update({ name: nextName }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["racks"] });
      setRenameRack(null);
      toast.success("Rack renamed");
    },
    onError: (error: any) => toast.error(error.message),
  });

  const rackMeta = useMemo(() => {
    const map = new Map<string, { id: string; code: string; name: string | null }>();
    for (const rack of racks as any[]) map.set((rack.code ?? "").trim().toUpperCase(), rack);
    return map;
  }, [racks]);

  const byRack = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const p of products as any[]) {
      const key = (p.rack ?? "").trim();
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return map;
  }, [products]);

  const extraRacks = useMemo(
    () => Array.from(byRack.keys()).filter((r) => !RACK_IDS.includes(r)).sort(),
    [byRack],
  );

  const rackCodes = useMemo(() => {
    const combined = new Set<string>([...RACK_IDS, ...extraRacks, ...(racks as any[]).map((rack) => (rack.code ?? "").trim().toUpperCase()).filter(Boolean)]);
    return Array.from(combined).sort((a, b) => {
      const aNum = Number.parseInt(a.replace(/^R/i, ""), 10);
      const bNum = Number.parseInt(b.replace(/^R/i, ""), 10);
      if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;
      return a.localeCompare(b);
    });
  }, [extraRacks, racks]);

  const unassigned = (products as any[]).filter((p) => !(p.rack ?? "").trim());

  return (
    <div className="p-3 sm:p-6 md:p-10 max-w-7xl mx-auto">
      <PageHeader
        title="Racks"
        subtitle="Pick a rack to manage its shelves."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" className="gap-2" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> Add rack
            </Button>
            <Link to="/racks/print">
              <Button variant="outline" className="gap-2">
                <Printer className="size-4" /> Print all QR labels
              </Button>
            </Link>
          </div>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
        {rackCodes.map((id) => {
          const items = byRack.get(id) ?? [];
          const meta = rackMeta.get(id);
          const out = items.filter((p) => p.stock <= 0).length;
          const low = items.filter((p) => p.stock > 0 && p.stock <= (p.low_stock_threshold ?? 5)).length;
          const ok = items.length - out - low;
          const tone =
            items.length === 0 ? "border-border bg-secondary/30"
            : out > 0 ? "border-destructive/50 bg-destructive/5"
            : low > 0 ? "border-warning/50 bg-warning/5"
            : "border-success/50 bg-success/5";
          return (
            <div
              key={id}
              className={cn(
                "group relative rounded-2xl border-2 p-4 transition hover:shadow-lg hover:-translate-y-0.5",
                tone,
              )}
            >
              <div className="absolute right-3 top-3 z-10">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-8 rounded-full bg-background/80 border border-border hover:bg-background"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setRenameRack(meta ?? { id: "", code: id, name: id });
                  }}
                >
                  <PencilLine className="size-4" />
                </Button>
              </div>
              <Link
                to="/racks/$rackId"
                params={{ rackId: id }}
                className="block active:scale-[0.98]"
              >
              <div className="flex items-start justify-between mb-3">
                <div className="size-10 rounded-xl gradient-primary grid place-items-center">
                  <Warehouse className="size-5 text-primary-foreground" />
                </div>
                <span className="text-xs font-mono text-muted-foreground">{items.length} item{items.length === 1 ? "" : "s"}</span>
              </div>
              <div className="font-bold text-lg tracking-tight">{formatRackLabel(id, meta?.name)}</div>
              <div className="mt-2 flex items-center gap-2 text-[11px]">
                <span className="inline-flex items-center gap-1 text-success"><span className="size-1.5 rounded-full bg-success" />{ok}</span>
                <span className="inline-flex items-center gap-1 text-warning"><AlertTriangle className="size-3" />{low}</span>
                <span className="inline-flex items-center gap-1 text-destructive"><PackageX className="size-3" />{out}</span>
              </div>
              </Link>
            </div>
          );
        })}
      </div>

      <Card className="card-elevated p-4 mt-6">
        <div className="flex items-center gap-2 text-sm font-semibold mb-1">
          <Package className="size-4 text-muted-foreground" /> Unassigned products
          <span className="ml-auto text-xs font-normal text-muted-foreground">{unassigned.length}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Open any rack above, pick a shelf, then add products from this pool.
        </p>
      </Card>

      <RackEditorDialog
        open={createOpen}
        title="Add rack"
        description="Create a new rack code and optional name."
        submitLabel={createRack.isPending ? "Adding…" : "Add rack"}
        initialCode=""
        initialName=""
        onClose={() => setCreateOpen(false)}
        onSubmit={({ code, name }) => createRack.mutate({ code, name })}
      />

      <RackEditorDialog
        open={!!renameRack}
        title={`Rename ${renameRack?.code ?? "rack"}`}
        description="Update how this rack appears in the app and on QR labels."
        submitLabel={renameMutation.isPending ? "Saving…" : "Save"}
        initialCode={renameRack?.code ?? ""}
        initialName={renameRack?.name ?? renameRack?.code ?? ""}
        codeDisabled
        onClose={() => setRenameRack(null)}
        onSubmit={({ name }) => {
          if (!renameRack?.id) {
            toast.error("This rack record is missing. Refresh and try again.");
            return;
          }
          renameMutation.mutate({ id: renameRack.id, name });
        }}
      />
    </div>
  );
}

function RackEditorDialog({
  open,
  title,
  description,
  submitLabel,
  initialCode,
  initialName,
  codeDisabled = false,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  description: string;
  submitLabel: string;
  initialCode: string;
  initialName: string;
  codeDisabled?: boolean;
  onClose: () => void;
  onSubmit: (values: { code: string; name: string }) => void;
}) {
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState(initialName);

  useState(() => {
    setCode(initialCode);
    setName(initialName);
  });

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <p className="text-sm text-muted-foreground">{description}</p>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Rack code</Label>
            <Input
              value={code}
              disabled={codeDisabled}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="R21"
            />
          </div>
          <div className="space-y-2">
            <Label>Rack name</Label>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Cold storage side" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSubmit({ code, name })} className="gradient-primary text-primary-foreground border-0">
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
