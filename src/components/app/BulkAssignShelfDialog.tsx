import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Search, Warehouse, Package, ImageIcon, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const RACK_IDS = Array.from({ length: 20 }, (_, i) => `R${i + 1}`);
const SHELVES = ["upper", "mid", "down"] as const;
type Shelf = (typeof SHELVES)[number];

type Props = { products: any[]; onClose: () => void };

export function BulkAssignShelfDialog({ products, onClose }: Props) {
  const [rack, setRack] = useState<string>(RACK_IDS[0]);
  const [shelf, setShelf] = useState<Shelf>("upper");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const v = q.toLowerCase();
    return (products as any[]).filter((p) =>
      !v || `${p.name} ${p.sku ?? ""} ${p.barcode ?? ""}`.toLowerCase().includes(v),
    );
  }, [products, q]);

  function toggle(id: string) {
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const apply = useMutation({
    mutationFn: async () => {
      if (picked.size === 0) throw new Error("Pick at least one product");
      const ids = Array.from(picked);
      const { error } = await supabase.from("products")
        .update({ rack, shelf })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`Assigned ${picked.size} to Rack ${rack} · ${shelf}`);
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Warehouse className="size-5 text-primary" />
            Bulk assign to shelf
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Rack</Label>
            <div className="mt-1.5 flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
              {RACK_IDS.map((r) => (
                <button key={r} type="button" onClick={() => setRack(r)}
                  className={cn(
                    "h-8 px-3 rounded-lg border text-xs font-bold transition",
                    rack === r ? "bg-primary text-primary-foreground border-primary" : "bg-secondary/40 border-border hover:bg-secondary",
                  )}>
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Shelf</Label>
            <div className="mt-1.5 grid grid-cols-3 gap-2">
              {SHELVES.map((s) => (
                <button key={s} type="button" onClick={() => setShelf(s)}
                  className={cn(
                    "h-11 rounded-xl border text-sm font-semibold capitalize transition active:scale-[0.98]",
                    shelf === s ? "bg-primary text-primary-foreground border-primary" : "bg-secondary/40 border-border hover:bg-secondary",
                  )}>
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className="relative">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products…" className="pl-9" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto border border-border rounded-lg divide-y divide-border max-h-[45vh] min-h-[200px]">
          {filtered.length === 0 && <p className="text-center text-sm text-muted-foreground py-8">No matching products</p>}
          {filtered.slice(0, 200).map((p) => {
            const on = picked.has(p.id);
            return (
              <button key={p.id} type="button" onClick={() => toggle(p.id)}
                className={cn("w-full flex items-center gap-3 p-2 text-left transition",
                  on ? "bg-primary/10" : "hover:bg-secondary/40")}>
                <div className={cn("size-5 rounded border-2 grid place-items-center shrink-0",
                  on ? "bg-primary border-primary text-primary-foreground" : "border-border")}>
                  {on && <Check className="size-3.5" />}
                </div>
                {p.image_url ? (
                  <img src={p.image_url} alt="" className="size-10 rounded-lg object-cover border border-border shrink-0" />
                ) : (
                  <div className="size-10 rounded-lg bg-secondary grid place-items-center text-muted-foreground border border-border shrink-0"><ImageIcon className="size-4" /></div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate flex items-center gap-2">
                    {p.name}
                    {(p.rack ?? "").trim() && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-secondary border border-border text-muted-foreground">
                        {p.rack}/{p.shelf ?? "—"}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground font-mono truncate">
                    {p.barcode ?? p.sku ?? "—"}
                  </div>
                </div>
                <span className="text-[10px] tabular-nums font-bold text-muted-foreground shrink-0">
                  <Package className="size-3 inline" /> {p.stock}
                </span>
              </button>
            );
          })}
        </div>

        <DialogFooter className="gap-2">
          <div className="flex-1 text-xs text-muted-foreground self-center">
            {picked.size} selected → Rack <span className="font-bold text-foreground">{rack}</span> · <span className="capitalize font-bold text-foreground">{shelf}</span>
          </div>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => apply.mutate()} disabled={apply.isPending || picked.size === 0}
            className="gradient-primary text-primary-foreground border-0">
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}