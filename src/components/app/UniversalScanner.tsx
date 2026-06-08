/* eslint-disable @typescript-eslint/no-explicit-any */
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { supabase, getCachedStorageUrl } from "@/integrations/supabase/client";
import { StrichScanner } from "./StrichScanner";
import { toast } from "sonner";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@/lib/use-server-fn";
import { scanProductImage } from "@/lib/ai-scan.functions";
import { Label } from "@/components/ui/label";
import { extractSizeFromName } from "@/lib/product-format";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Package,
  ImageIcon,
  Warehouse,
  ArrowUpRight,
  ArrowDownRight,
  Hash,
  Barcode as BarcodeIcon,
  Tag,
  Boxes,
  Clock,
  AlertTriangle,
  PackageX,
  PackagePlus,
  MapPin,
  Search,
  Camera,
  Loader2,
  Sparkles,
  RotateCcw,
  X,
  ChevronRight,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

type ProductHit = {
  kind: "product";
  product: any;
  lastMovement: any | null;
  rackMeta: { code: string; name: string | null } | null;
};
type RackHit = {
  kind: "rack";
  code: string;
  name: string | null;
  items: any[];
};
type Hit = ProductHit | RackHit | { kind: "unknown"; code: string };

/**
 * Universal scanner — handles both QR (rack labels) and product barcodes.
 * Shows a rich result dialog with image, stock, price, last movement, etc.
 */
export function UniversalScanner({
  open,
  onClose,
  prefillCode,
  onPrefillConsumed,
}: {
  open: boolean;
  onClose: () => void;
  /** Optional code from an external (HID/Bluetooth) scanner. When set, the
   *  camera step is skipped and the code is looked up directly. */
  prefillCode?: string | null;
  onPrefillConsumed?: () => void;
}) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [hit, setHit] = useState<Hit | null>(null);
  const [loading, setLoading] = useState(false);
  const [rackSelectedItem, setRackSelectedItem] = useState<ProductHit | null>(null);
  const [rackItemLoading, setRackItemLoading] = useState(false);

  function parseRackCode(raw: string) {
    const normalized = raw
      .trim()
      .replace(/^https?:\/\/[^/]+\//i, "")
      .replace(/^#/, "");
    const compact = normalized.replace(/\s+/g, "");
    const prefixed = compact.match(/^RACK:([A-Za-z0-9_-]+)$/i);
    if (prefixed) return prefixed[1].toUpperCase();
    const plain = compact.match(/^(R\d+[A-Za-z0-9_-]*)$/i);
    if (plain) return plain[1].toUpperCase();
    const route = compact.match(/racks\/?(?:print\?ids=)?(R\d+[A-Za-z0-9_-]*)/i);
    if (route) return route[1].toUpperCase();
    return null;
  }

  async function handle(code: string) {
    const trimmed = code.trim();
    setLoading(true);
    try {
      const rackId = parseRackCode(trimmed);
      if (rackId) {
        const [{ data: rack }, { data: items }] = await Promise.all([
          supabase.from("racks").select("code, name").eq("code", rackId).maybeSingle(),
          supabase.from("products").select("*").eq("rack", rackId).order("name"),
        ]);
        setHit({ kind: "rack", code: rackId, name: rack?.name ?? null, items: items ?? [] });
        return;
      }
      // Build a small set of barcode variants so UPC-A (12) and EAN-13 (13)
      // both resolve, regardless of which one is stored on the product.
      const variants = new Set<string>([trimmed]);
      const digitsOnly = trimmed.replace(/\D+/g, "");
      if (digitsOnly) variants.add(digitsOnly);
      if (/^\d{12}$/.test(digitsOnly)) variants.add("0" + digitsOnly); // UPC-A → EAN-13
      if (/^0\d{12}$/.test(digitsOnly)) variants.add(digitsOnly.slice(1)); // EAN-13 → UPC-A
      const variantList = Array.from(variants);

      // Try barcode match first, then fall back to SKU.
      const { data: byBarcode } = await supabase
        .from("products")
        .select("*")
        .in("barcode", variantList)
        .limit(1);
      let product = byBarcode?.[0] ?? null;
      if (!product) {
        const { data: bySku } = await supabase
          .from("products")
          .select("*")
          .in("sku", variantList)
          .limit(1);
        product = bySku?.[0] ?? null;
      }
      if (!product) {
        setHit({ kind: "unknown", code: trimmed });
        return;
      }
      const [{ data: movements }, { data: rackRow }] = await Promise.all([
        supabase
          .from("stock_movements")
          .select("*")
          .eq("product_id", product.id)
          .order("created_at", { ascending: false })
          .limit(1),
        product.rack
          ? supabase.from("racks").select("code, name").eq("code", product.rack).maybeSingle()
          : (Promise.resolve({ data: null }) as any),
      ]);
      setHit({
        kind: "product",
        product,
        lastMovement: movements?.[0] ?? null,
        rackMeta: rackRow ?? null,
      });
      qc.invalidateQueries({ queryKey: ["products"] });
    } catch (e: any) {
      toast.error("Scan lookup failed", { description: e?.message });
    } finally {
      setLoading(false);
    }
  }

  function closeAll() {
    setHit(null);
    setRackSelectedItem(null);
    onClose();
  }

  async function handleRackItemClick(item: any) {
    setRackItemLoading(true);
    try {
      const [{ data: movements }, { data: rackRow }] = await Promise.all([
        supabase
          .from("stock_movements")
          .select("*")
          .eq("product_id", item.id)
          .order("created_at", { ascending: false })
          .limit(1),
        item.rack
          ? supabase.from("racks").select("code, name").eq("code", item.rack).maybeSingle()
          : (Promise.resolve({ data: null }) as any),
      ]);
      setRackSelectedItem({
        kind: "product",
        product: item,
        lastMovement: movements?.[0] ?? null,
        rackMeta: rackRow ?? null,
      });
    } catch (e: any) {
      toast.error("Could not load product", { description: e?.message });
    } finally {
      setRackItemLoading(false);
    }
  }

  async function refreshAsProduct(barcode: string) {
    const { data: product } = await supabase
      .from("products")
      .select("*")
      .eq("barcode", barcode)
      .maybeSingle();
    if (!product) return;
    const [{ data: movements }, { data: rackRow }] = await Promise.all([
      supabase
        .from("stock_movements")
        .select("*")
        .eq("product_id", product.id)
        .order("created_at", { ascending: false })
        .limit(1),
      product.rack
        ? supabase.from("racks").select("code, name").eq("code", product.rack).maybeSingle()
        : (Promise.resolve({ data: null }) as any),
    ]);
    setHit({
      kind: "product",
      product,
      lastMovement: movements?.[0] ?? null,
      rackMeta: rackRow ?? null,
    });
    qc.invalidateQueries({ queryKey: ["products"] });
  }

  // Process codes coming from an external HID/Bluetooth barcode scanner.
  useEffect(() => {
    if (!open || !prefillCode) return;
    void handle(prefillCode);
    onPrefillConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefillCode]);

  return (
    <>
      <StrichScanner
        open={open && !hit}
        onClose={onClose}
        onDetected={handle}
        keepOpenOnDetect={false}
        onDetectedLabel={(c) => {
          const rackId = parseRackCode(c);
          return rackId ? `Rack ${rackId}` : c;
        }}
      />

      <Dialog open={!!hit} onOpenChange={(v) => !v && closeAll()}>
        <DialogContent className="p-0 gap-0 border-border overflow-hidden w-[100vw] sm:w-auto sm:max-w-lg h-[100dvh] sm:h-auto sm:max-h-[90vh] max-w-none rounded-none sm:rounded-lg flex flex-col [&>button:last-child]:hidden">
          <DialogHeader className="sr-only">
            <DialogTitle>Scan result</DialogTitle>
          </DialogHeader>
          {/* Always-visible close button — top-right overlay */}
          <button
            onClick={closeAll}
            aria-label="Close"
            className="absolute top-3 right-3 z-50 size-8 rounded-full bg-black/55 text-white grid place-items-center backdrop-blur hover:bg-black/75 transition"
          >
            <X className="size-4" />
          </button>
          {loading && <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>}

          {hit?.kind === "product" && (
            <ProductCard
              hit={hit}
              onClose={closeAll}
              onOpenStockIn={() => {
                const bc = hit.product.barcode;
                closeAll();
                nav({ to: "/stock-in", search: bc ? ({ barcode: bc } as any) : {} });
              }}
              onOpenStockOut={() => {
                const bc = hit.product.barcode;
                closeAll();
                nav({ to: "/stock-out", search: bc ? ({ barcode: bc } as any) : {} });
              }}
              onOpenProducts={() => {
                closeAll();
                nav({ to: "/products" });
              }}
              onScanAgain={() => setHit(null)}
            />
          )}

          {hit?.kind === "rack" && rackItemLoading && (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading product…</div>
          )}

          {hit?.kind === "rack" && !rackItemLoading && rackSelectedItem && (
            <ProductCard
              hit={rackSelectedItem}
              onClose={closeAll}
              onOpenStockIn={() => {
                const bc = rackSelectedItem.product.barcode;
                closeAll();
                nav({ to: "/stock-in", search: bc ? ({ barcode: bc } as any) : {} });
              }}
              onOpenStockOut={() => {
                const bc = rackSelectedItem.product.barcode;
                closeAll();
                nav({ to: "/stock-out", search: bc ? ({ barcode: bc } as any) : {} });
              }}
              onOpenProducts={() => {
                closeAll();
                nav({ to: "/products" });
              }}
              onScanAgain={() => setRackSelectedItem(null)}
              scanAgainLabel="← Back to rack"
            />
          )}

          {hit?.kind === "rack" && !rackItemLoading && !rackSelectedItem && (
            <RackCard
              hit={hit}
              onClose={closeAll}
              onOpenRack={() => {
                closeAll();
                nav({ to: "/racks/$rackId", params: { rackId: hit.code } });
              }}
              onScanAgain={() => setHit(null)}
              onItemClick={handleRackItemClick}
            />
          )}

          {hit?.kind === "unknown" && (
            <UnknownCard
              code={hit.code}
              onScanAgain={() => setHit(null)}
              onClose={closeAll}
              onRegistered={() => refreshAsProduct(hit.code)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function UnknownCard({
  code,
  onScanAgain,
  onClose,
  onRegistered,
}: {
  code: string;
  onScanAgain: () => void;
  onClose: () => void;
  onRegistered: () => void;
}) {
  const [q, setQ] = useState("");
  const [picking, setPicking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newProdImgs, setNewProdImgs] = useState<string[]>([]);
  const [aiScanning, setAiScanning] = useState(false);
  const [newProdFields, setNewProdFields] = useState({
    name: "", brand: "", sku: "", size: "", unit: "", origin: "", pcs_per_case: "",
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const callScanProduct = useServerFn(scanProductImage);
  const MAX_PHOTOS = 4;
  const qc = useQueryClient();

  const { data: products = [] } = useQuery({
    queryKey: ["products-pick"],
    queryFn: async () =>
      (
        await supabase
          .from("products")
          .select("id, name, sku, barcode, image_url, stock")
          .order("name")
      ).data ?? [],
    enabled: picking,
  });
  const filtered = (products as any[])
    .filter(
      (p) =>
        !q || `${p.name} ${p.sku ?? ""} ${p.barcode ?? ""}`.toLowerCase().includes(q.toLowerCase()),
    )
    .slice(0, 30);

  const assign = useMutation({
    mutationFn: async (productId: string) => {
      const { error } = await supabase
        .from("products")
        .update({ barcode: code, barcode_registered_at: new Date().toISOString() })
        .eq("id", productId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["products-pick"] });
      toast.success("Barcode registered");
      onRegistered();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not register"),
  });

  function resizeImage(file: File, maxPx = 1024): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const ratio = Math.min(1, maxPx / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * ratio);
        canvas.height = Math.round(img.height * ratio);
        canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = url;
    });
  }

  async function handlePhotoSelected(file: File) {
    const dataUrl = await resizeImage(file);
    const allImgs = [...newProdImgs, dataUrl];
    setNewProdImgs(allImgs);
    setAiScanning(true);
    try {
      const json = await callScanProduct({ data: { images: allImgs } });
      if (json.ok && json.product) {
        const p = json.product as any;
        const nm = p.name ?? "";
        let size = p.size ?? "";
        let unit = p.unit ?? "";
        if (!size) {
          const parsed = extractSizeFromName(nm);
          if (parsed) { size = parsed.size; if (!unit) unit = parsed.unit; }
        }
        setNewProdFields((prev) => ({
          name: nm || prev.name,
          brand: p.brand ?? prev.brand,
          sku: (p.sku ?? prev.sku) || code,
          size: size || prev.size,
          unit: unit || prev.unit,
          origin: p.origin ?? prev.origin,
          pcs_per_case: p.pcs_per_case != null ? String(p.pcs_per_case) : prev.pcs_per_case,
        }));
      } else {
        toast.error("AI couldn't read — fill in manually.");
        setNewProdFields((f) => ({ ...f, sku: f.sku || code }));
      }
    } catch {
      toast.error("AI scan failed — fill in manually.");
      setNewProdFields((f) => ({ ...f, sku: f.sku || code }));
    } finally {
      setAiScanning(false);
    }
  }

  const createProduct = useMutation({
    mutationFn: async () => {
      const trimmed = newProdFields.name.trim();
      if (!trimmed) throw new Error("Name is required");
      let finalSize = newProdFields.size.trim();
      let finalUnit = newProdFields.unit.trim();
      if (!finalSize) {
        const parsed = extractSizeFromName(trimmed);
        if (parsed) { finalSize = parsed.size; if (!finalUnit) finalUnit = parsed.unit; }
      }
      const { error } = await supabase.from("products").insert({
        name: trimmed,
        brand: newProdFields.brand.trim() || null,
        sku: newProdFields.sku.trim() || null,
        size: finalSize || null,
        unit: finalUnit || null,
        origin: newProdFields.origin.trim() || null,
        pcs_per_case: newProdFields.pcs_per_case ? Number(newProdFields.pcs_per_case) : null,
        barcode: code,
        stock: 0,
        barcode_registered_at: new Date().toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["products-pick"] });
      toast.success("Product created");
      onRegistered();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not create"),
  });

  function resetCreate() {
    setCreating(false);
    setNewProdImgs([]);
    setNewProdFields({ name: "", brand: "", sku: "", size: "", unit: "", origin: "", pcs_per_case: "" });
  }

  if (creating) {
    return (
      <div className="flex flex-col min-h-0 flex-1 overflow-hidden">
        <div className="p-4 border-b border-border shrink-0">
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">New product</div>
          <div className="font-mono text-sm break-all">{code}</div>
        </div>
        <div className="p-4 space-y-4 overflow-y-auto flex-1 min-h-0">
          {/* Multi-photo grid */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Photos · front, back, side…
              </span>
              {aiScanning && (
                <span className="inline-flex items-center gap-1 text-[11px] text-primary font-medium">
                  <Loader2 className="size-3 animate-spin" />
                  AI reading {newProdImgs.length} photo{newProdImgs.length !== 1 ? "s" : ""}…
                </span>
              )}
            </div>
            <div className="grid grid-cols-4 gap-2">
              {newProdImgs.map((img, idx) => (
                <div key={idx} className="relative aspect-square rounded-xl overflow-hidden border border-border bg-secondary">
                  <img src={img} alt={`Photo ${idx + 1}`} className="size-full object-cover" />
                  {aiScanning && (
                    <div className="absolute inset-0 bg-background/60 grid place-items-center">
                      <Sparkles className="size-4 text-primary animate-pulse" />
                    </div>
                  )}
                  {!aiScanning && (
                    <button
                      onClick={() => {
                        const updated = newProdImgs.filter((_, i) => i !== idx);
                        setNewProdImgs(updated);
                      }}
                      className="absolute top-1 right-1 size-5 rounded-full bg-black/60 text-white grid place-items-center hover:bg-black/80 transition"
                      aria-label="Remove photo"
                    >
                      <X className="size-3" />
                    </button>
                  )}
                  <div className="absolute bottom-1 left-1 text-[9px] font-bold text-white/80 bg-black/40 rounded px-1">
                    {idx === 0 ? "front" : idx === 1 ? "back" : idx === 2 ? "side" : `#${idx + 1}`}
                  </div>
                </div>
              ))}
              {newProdImgs.length < MAX_PHOTOS && !aiScanning && (
                <button
                  onClick={() => fileRef.current?.click()}
                  className="aspect-square rounded-xl border-2 border-dashed border-primary/40 hover:border-primary bg-primary/5 hover:bg-primary/10 grid place-items-center transition-colors"
                  aria-label="Add photo"
                >
                  <div className="flex flex-col items-center gap-1">
                    <Camera className="size-5 text-primary" />
                    <span className="text-[9px] font-medium text-primary">
                      {newProdImgs.length === 0 ? "Add photo" : "Add more"}
                    </span>
                  </div>
                </button>
              )}
            </div>
            {newProdImgs.length === 0 && (
              <p className="text-[11px] text-muted-foreground text-center pt-1">
                Add up to 4 photos — AI reads all of them together
              </p>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={async (e) => { const f = e.target.files?.[0]; if (f) await handlePhotoSelected(f); e.target.value = ""; }}
          />

          {/* Form fields */}
          <div className="space-y-3">
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Product Name <span className="text-destructive">*</span></Label>
              <Input
                autoFocus
                className="mt-1"
                value={newProdFields.name}
                onChange={(e) => setNewProdFields((p) => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Fish Sauce 700ml"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Brand</Label>
                <Input className="mt-1" value={newProdFields.brand} onChange={(e) => setNewProdFields((p) => ({ ...p, brand: e.target.value }))} placeholder="e.g. Tiparos" />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">SKU</Label>
                <Input className="mt-1 font-mono" value={newProdFields.sku} onChange={(e) => setNewProdFields((p) => ({ ...p, sku: e.target.value }))} placeholder="auto" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Size</Label>
                <Input className="mt-1" value={newProdFields.size} onChange={(e) => setNewProdFields((p) => ({ ...p, size: e.target.value }))} placeholder="e.g. 700ml" />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Unit</Label>
                <select value={newProdFields.unit} onChange={(e) => setNewProdFields((p) => ({ ...p, unit: e.target.value }))} className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">—</option>
                  {["bottle", "bag", "can", "box", "pack", "jar", "sachet", "pcs"].map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Origin</Label>
                <Input className="mt-1" value={newProdFields.origin} onChange={(e) => setNewProdFields((p) => ({ ...p, origin: e.target.value }))} placeholder="e.g. Thailand" />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Pcs / Case</Label>
                <Input className="mt-1" type="number" inputMode="numeric" value={newProdFields.pcs_per_case} onChange={(e) => setNewProdFields((p) => ({ ...p, pcs_per_case: e.target.value }))} placeholder="e.g. 12" />
              </div>
            </div>
          </div>
        </div>
        <div className="p-3 border-t border-border grid grid-cols-2 gap-2 shrink-0">
          <Button variant="outline" onClick={resetCreate}>Back</Button>
          <Button
            disabled={!newProdFields.name.trim() || createProduct.isPending || aiScanning}
            className="gradient-primary text-primary-foreground border-0 gap-1"
            onClick={() => createProduct.mutate()}
          >
            {createProduct.isPending ? <Loader2 className="size-4 animate-spin" /> : <PackagePlus className="size-4" />}
            Save product
          </Button>
        </div>
      </div>
    );
  }

  if (!picking) {
    return (
      <div className="p-6 text-center space-y-4">
        <div className="size-14 mx-auto rounded-2xl bg-warning/15 grid place-items-center">
          <AlertTriangle className="size-7 text-warning" />
        </div>
        <div>
          <div className="font-semibold text-lg">Unknown code</div>
          <div className="text-xs text-muted-foreground font-mono mt-1 break-all">{code}</div>
          <p className="text-sm text-muted-foreground mt-2">
            No product matches this barcode and it isn't a rack label.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 pt-2">
          <Button
            className="gradient-primary text-primary-foreground border-0"
            onClick={() => setPicking(true)}
          >
            Assign to product
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setCreating(true);
            }}
          >
            Create new product
          </Button>
        </div>
        <button
          onClick={onScanAgain}
          className="block w-full text-xs text-muted-foreground hover:text-foreground"
        >
          Scan again
        </button>
      </div>
    );
  }

  return (
    <div className="p-5 space-y-3">
      <div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Register barcode
        </div>
        <div className="font-mono text-sm break-all">{code}</div>
        <p className="text-xs text-muted-foreground mt-1">
          Pick the product this barcode belongs to.
        </p>
      </div>
      <div className="relative">
        <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search products…"
          className="pl-9"
        />
      </div>
      <div className="max-h-[45vh] overflow-y-auto -mx-1 px-1 space-y-1">
        {filtered.map((p) => (
          <button
            key={p.id}
            disabled={assign.isPending}
            onClick={() => assign.mutate(p.id)}
            className="w-full flex items-center gap-3 p-2 rounded-xl border border-transparent hover:border-border hover:bg-secondary/60 text-left disabled:opacity-50"
          >
            <div className="size-10 rounded-lg bg-secondary overflow-hidden grid place-items-center shrink-0">
              {p.image_url ? (
                <img src={getCachedStorageUrl(p.image_url)} alt={p.name} className="size-full object-cover" />
              ) : (
                <ImageIcon className="size-4 text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-sm truncate">{p.name}</div>
              <div className="text-[11px] text-muted-foreground font-mono truncate">
                {p.sku ?? "—"} · {p.barcode ?? "no barcode"}
              </div>
            </div>
            <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
              stock {p.stock}
            </span>
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground p-6 text-center">No products match.</p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 pt-1">
        <Button variant="outline" onClick={() => setPicking(false)}>
          Back
        </Button>
        <Button variant="ghost" onClick={onScanAgain}>
          Scan another
        </Button>
      </div>
    </div>
  );
}

function ProductCard({
  hit,
  onClose,
  onOpenStockIn,
  onOpenStockOut,
  onOpenProducts,
  onScanAgain,
  scanAgainLabel = "Scan next",
}: {
  hit: ProductHit;
  onClose: () => void;
  onOpenStockIn: () => void;
  onOpenStockOut: () => void;
  onOpenProducts: () => void;
  onScanAgain: () => void;
  scanAgainLabel?: string;
}) {
  const p = hit.product;
  const threshold = p.low_stock_threshold ?? 5;
  const status =
    p.stock <= 0
      ? { label: "Out of stock", tone: "bg-destructive/15 text-destructive", Icon: PackageX }
      : p.stock <= threshold
        ? { label: "Low stock", tone: "bg-warning/15 text-warning", Icon: AlertTriangle }
        : { label: "In stock", tone: "bg-success/15 text-success", Icon: Boxes };
  const StatusIcon = status.Icon;
  return (
    <div className="flex flex-col min-h-0 flex-1 overflow-hidden">
      <div className="relative aspect-[16/9] bg-gradient-to-br from-primary/15 via-primary/5 to-transparent shrink-0">
        {p.image_url ? (
          <img src={getCachedStorageUrl(p.image_url)} alt={p.name} className="absolute inset-0 size-full object-cover" />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-muted-foreground">
            <ImageIcon className="size-12 opacity-50" />
          </div>
        )}
        <div
          className={cn(
            "absolute top-3 left-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold backdrop-blur-md",
            status.tone,
          )}
        >
          <StatusIcon className="size-3.5" /> {status.label}
        </div>
      </div>
      <div className="p-5 space-y-4 overflow-y-auto flex-1 min-h-0">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Product
          </div>
          <h3 className="text-xl font-bold tracking-tight leading-tight">{p.name}</h3>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Metric label="In stock" value={String(p.stock)} sub={`min ${threshold}`} Icon={Boxes} />
          <Metric label="Price" value={`¥${Number(p.price ?? 0).toLocaleString()}`} Icon={Tag} />
          <Metric label="Barcode" value={p.barcode ?? "—"} mono Icon={BarcodeIcon} />
          <Metric label="SKU" value={p.sku ?? "—"} mono Icon={Hash} />
        </div>

        <div className="rounded-xl border border-border bg-secondary/40 p-3 flex items-center gap-3">
          <div className="size-9 rounded-lg gradient-primary grid place-items-center shrink-0">
            <MapPin className="size-4 text-primary-foreground" />
          </div>
          <div className="min-w-0 text-sm">
            <div className="font-semibold truncate">
              {p.rack
                ? hit.rackMeta?.name && hit.rackMeta.name.toUpperCase() !== p.rack.toUpperCase()
                  ? `${p.rack} · ${hit.rackMeta.name}`
                  : p.rack
                : "Unassigned"}
            </div>
            <div className="text-xs text-muted-foreground">
              {p.shelf ? `Shelf: ${p.shelf}` : "No shelf set"}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border p-3 flex items-center gap-3">
          <div
            className={cn(
              "size-9 rounded-lg grid place-items-center shrink-0",
              hit.lastMovement?.type === "in"
                ? "bg-success/15 text-success"
                : "bg-destructive/15 text-destructive",
            )}
          >
            {hit.lastMovement?.type === "in" ? (
              <ArrowUpRight className="size-4" />
            ) : (
              <ArrowDownRight className="size-4" />
            )}
          </div>
          <div className="min-w-0 text-sm flex-1">
            <div className="font-semibold">
              {hit.lastMovement
                ? `${hit.lastMovement.type === "in" ? "Stock in" : "Stock out"} · ${hit.lastMovement.quantity}`
                : "No movements yet"}
            </div>
            <div className="text-xs text-muted-foreground inline-flex items-center gap-1">
              <Clock className="size-3" />
              {hit.lastMovement
                ? `${formatDistanceToNow(new Date(hit.lastMovement.created_at), { addSuffix: true })}${hit.lastMovement.destination ? ` · ${hit.lastMovement.destination}` : ""}`
                : "—"}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 pt-1">
          <Button
            onClick={onOpenStockIn}
            className="bg-success/15 text-success border-0 hover:bg-success/25"
          >
            <ArrowUpRight className="size-4 mr-1" /> In
          </Button>
          <Button
            onClick={onOpenStockOut}
            className="bg-destructive/15 text-destructive border-0 hover:bg-destructive/25"
          >
            <ArrowDownRight className="size-4 mr-1" /> Out
          </Button>
          <Button variant="outline" onClick={onScanAgain}>
            {scanAgainLabel}
          </Button>
        </div>
        <button
          onClick={onOpenProducts}
          className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
        >
          Open product list →
        </button>
      </div>
    </div>
  );
}

function RackCard({
  hit,
  onClose,
  onOpenRack,
  onScanAgain,
  onItemClick,
}: {
  hit: RackHit;
  onClose: () => void;
  onOpenRack: () => void;
  onScanAgain: () => void;
  onItemClick?: (item: any) => void;
}) {
  const out = hit.items.filter((i) => i.stock <= 0).length;
  const low = hit.items.filter(
    (i) => i.stock > 0 && i.stock <= (i.low_stock_threshold ?? 5),
  ).length;
  const ok = hit.items.length - out - low;
  return (
    <div className="flex flex-col min-h-0 flex-1 overflow-hidden">
      <div className="p-5 gradient-primary text-primary-foreground shrink-0">
        <div className="flex items-center gap-3">
          <div className="size-12 rounded-2xl bg-primary-foreground/15 grid place-items-center">
            <Warehouse className="size-6" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.2em] opacity-80">Rack</div>
            <h3 className="text-2xl font-bold leading-none">
              {hit.code}
              {hit.name && hit.name.toUpperCase() !== hit.code ? (
                <span className="opacity-80 font-normal"> · {hit.name}</span>
              ) : null}
            </h3>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-4 text-center text-xs">
          <div className="rounded-xl bg-primary-foreground/15 py-2">
            <div className="text-lg font-bold">{ok}</div>ok
          </div>
          <div className="rounded-xl bg-primary-foreground/15 py-2">
            <div className="text-lg font-bold">{low}</div>low
          </div>
          <div className="rounded-xl bg-primary-foreground/15 py-2">
            <div className="text-lg font-bold">{out}</div>out
          </div>
        </div>
      </div>
      <div className="p-4 space-y-3 overflow-y-auto flex-1 min-h-0">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Items in rack <span className="opacity-60">· tap for details</span></span>
          <Badge variant="secondary">{hit.items.length}</Badge>
        </div>
        {hit.items.length === 0 && (
          <div className="text-center py-6 text-sm text-muted-foreground">
            <Package className="size-8 mx-auto mb-2 opacity-50" /> Empty rack
          </div>
        )}
        <ul className="space-y-2">
          {hit.items.map((it) => {
            const dot =
              it.stock <= 0
                ? "bg-destructive"
                : it.stock <= (it.low_stock_threshold ?? 5)
                  ? "bg-warning"
                  : "bg-success";
            const stockTone =
              it.stock <= 0
                ? "text-destructive"
                : it.stock <= (it.low_stock_threshold ?? 5)
                  ? "text-warning"
                  : "text-success";
            return (
              <li key={it.id}>
                <button
                  onClick={() => onItemClick?.(it)}
                  className="w-full flex items-center gap-3 p-2.5 rounded-xl border border-border hover:bg-secondary/60 hover:border-primary/30 active:scale-[0.98] transition text-left group"
                >
                  <div className="size-10 rounded-lg bg-secondary overflow-hidden shrink-0 grid place-items-center">
                    {it.image_url ? (
                      <img src={getCachedStorageUrl(it.image_url)} alt={it.name} className="size-full object-cover" />
                    ) : (
                      <ImageIcon className="size-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm truncate group-hover:text-primary transition-colors">{it.name}</div>
                    <div className="text-[11px] text-muted-foreground font-mono truncate">
                      {it.sku ?? it.barcode ?? "—"}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={cn("inline-flex items-center gap-1.5 text-sm font-bold", stockTone)}>
                      <span className={cn("size-1.5 rounded-full", dot)} />
                      {it.stock}
                    </div>
                    {it.shelf && (
                      <div className="text-[10px] text-muted-foreground capitalize">{it.shelf}</div>
                    )}
                  </div>
                  <ChevronRight className="size-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="p-3 border-t border-border grid grid-cols-2 gap-2 shrink-0">
        <Button variant="outline" onClick={onScanAgain}>
          Scan next
        </Button>
        <Button onClick={onOpenRack} className="gradient-primary text-primary-foreground border-0">
          Open rack
        </Button>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  mono,
  Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  mono?: boolean;
  Icon: any;
}) {
  return (
    <div className="rounded-xl border border-border p-3">
      <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground inline-flex items-center gap-1">
        <Icon className="size-3" /> {label}
      </div>
      <div className={cn("font-semibold text-sm mt-0.5 truncate", mono && "font-mono")}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
