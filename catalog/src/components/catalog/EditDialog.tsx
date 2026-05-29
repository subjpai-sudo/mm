import { useState, useEffect } from "react";
import { type Product } from "@/data/products";
import { toast } from "sonner";
import { BarcodeScanner } from "./BarcodeScanner";

export type EditValues = {
  name: string;
  brand: string;
  origin: string;
  size: string;
  pcs: string;
  code: string;
  p1: string;
  p10: string;
  pcase: string;
  barcode: string;
  category: string;
  subCategory: string;
};

export function EditDialog({
  open,
  product,
  image,
  barcode,
  categories,
  subCategoriesByCategory,
  onClose,
  onSave,
  onGenerateImage,
  generating,
  onDelete,
}: {
  open: boolean;
  product: Product | null;
  image: string | null;
  barcode: string;
  categories: string[];
  subCategoriesByCategory: Record<string, string[]>;
  onClose: () => void;
  onSave: (v: EditValues) => void;
  onGenerateImage: (references?: string[] | null) => Promise<void>;
  generating: boolean;
  onDelete?: () => void;
}) {
  const [v, setV] = useState<EditValues | null>(null);
  const [refs, setRefs] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scannerStream, setScannerStream] = useState<MediaStream | null>(null);
  const [catMode, setCatMode] = useState<"pick" | "new">("pick");
  const [subMode, setSubMode] = useState<"pick" | "new">("pick");

  useEffect(() => {
    if (open && product) {
      const cat = product.origin ?? "";
      const sub = product.brand ?? "";
      setV({
        name: product.name,
        brand: product.brand,
        origin: product.origin,
        size: product.size,
        pcs: String(product.pcs ?? ""),
        code: product.code === "none" ? "" : product.code,
        p1: product.p1 === "--" ? "" : String(product.p1),
        p10: product.p10 === "--" ? "" : String(product.p10),
        pcase: product.pcase === "--" ? "" : String(product.pcase),
        barcode,
        category: cat,
        subCategory: sub,
      });
      setRefs([]);
      setCatMode(cat && !categories.includes(cat) ? "new" : "pick");
      setSubMode(sub && !(subCategoriesByCategory[cat] ?? []).includes(sub) ? "new" : "pick");
    }
  }, [open, product, barcode, categories, subCategoriesByCategory]);

  if (!open || !product || !v) return null;

  const upd = (k: keyof EditValues) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setV((s) => (s ? { ...s, [k]: e.target.value } : s));

  const onPickRefs = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const remaining = 6 - refs.length;
    const toRead = files.slice(0, remaining);
    if (files.length > remaining) toast.message(`Only added ${remaining} (max 6 references)`);
    toRead.forEach((f) => {
      if (f.size > 8 * 1024 * 1024) {
        toast.error(`${f.name} too large (max 8MB)`);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const url = typeof reader.result === "string" ? reader.result : null;
        if (url) setRefs((prev) => (prev.length >= 6 ? prev : [...prev, url]));
      };
      reader.readAsDataURL(f);
    });
    e.target.value = "";
  };

  const removeRef = (i: number) => setRefs((prev) => prev.filter((_, idx) => idx !== i));

  const openScanner = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      setScannerStream(stream);
      setScanning(true);
    } catch (e) {
      console.error("Camera permission failed", e);
      toast.error("Camera unavailable. Check browser camera permission.");
      setScanning(true);
    }
  };

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="fixed inset-0 z-[9000] flex items-center justify-center bg-black/40 backdrop-blur-md p-4 overflow-y-auto"
    >
      <div className="bg-card border border-border rounded-3xl shadow-lifted w-full max-w-2xl my-8 max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-card/95 backdrop-blur border-b border-border px-5 py-4 flex justify-between items-center">
          <h3 className="font-display text-2xl">Edit #{product.no}</h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-accent text-muted-foreground"
          >
            ✕
          </button>
        </div>
        <div className="p-5 space-y-5">
          <div className="flex gap-4">
            <div className="w-40 h-40 rounded-2xl bg-secondary border border-border overflow-hidden flex items-center justify-center shrink-0">
              {image ? (
                <img src={image} alt={product.name} className="w-full h-full object-cover" />
              ) : (
                <span className="text-xs text-muted-foreground">No image</span>
              )}
            </div>
            <div className="flex-1 flex flex-col gap-2">
              <button
                onClick={() => onGenerateImage(refs)}
                disabled={generating}
                className="rounded-2xl border-2 border-dashed border-primary/60 bg-accent/40 hover:bg-accent text-primary font-medium px-4 py-3 transition disabled:opacity-60"
              >
                {generating
                  ? "Generating…"
                  : refs.length > 0
                    ? `✨ Generate from ${refs.length} reference${refs.length > 1 ? "s" : ""}`
                    : "✨ Generate AI Image"}
                <div className="text-xs text-muted-foreground mt-1">
                  {refs.length > 0
                    ? "Gemini Nano Banana (preserves packaging)"
                    : "Pure AI — Gemini"}
                </div>
              </button>
              <label className="rounded-xl border border-border bg-card hover:bg-secondary px-4 py-2.5 text-sm font-medium text-center cursor-pointer transition">
                📷 Add reference photos (up to 6)
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  capture="environment"
                  className="hidden"
                  onChange={onPickRefs}
                />
              </label>
            </div>
          </div>

          {refs.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground font-semibold mb-2">
                References ({refs.length})
              </div>
              <div className="grid grid-cols-6 gap-2">
                {refs.map((r, i) => (
                  <div
                    key={i}
                    className="relative aspect-square rounded-lg overflow-hidden border border-border bg-secondary group"
                  >
                    <img src={r} alt={`ref ${i + 1}`} className="w-full h-full object-cover" />
                    <button
                      onClick={() => removeRef(i)}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 text-white text-[10px] opacity-0 group-hover:opacity-100 transition"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Section title="Product info">
            <Field label="Product name">
              <input className={inp} value={v.name} onChange={upd("name")} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Country (Origin)">
                {catMode === "pick" ? (
                  <select
                    className={inp}
                    value={
                      !v.category || categories.includes(v.category) ? v.category : "__missing__"
                    }
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === "__new__") {
                        setCatMode("new");
                        setV((s) => (s ? { ...s, category: "", origin: "", subCategory: "", brand: "" } : s));
                      } else if (val !== "__missing__") {
                        setV((s) => (s ? { ...s, category: val, origin: val, subCategory: "", brand: "" } : s));
                      }
                    }}
                  >
                    <option value="">— Select country —</option>
                    {v.category && !categories.includes(v.category) && (
                      <option value="__missing__">{v.category} (current)</option>
                    )}
                    {categories.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                    <option value="__new__">＋ Add new country…</option>
                  </select>
                ) : (
                  <div className="flex gap-1.5">
                    <input
                      className={inp}
                      value={v.category}
                      onChange={(e) =>
                        setV((s) => (s ? { ...s, category: e.target.value, origin: e.target.value } : s))
                      }
                      placeholder="New country / origin"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => setCatMode("pick")}
                      className="px-2 rounded-lg border border-border text-xs text-muted-foreground hover:bg-secondary"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </Field>
              <Field label="Brand (Vendor)">
                {(() => {
                  const subs = subCategoriesByCategory[v.category] ?? [];
                  const allSubs = Array.from(
                    new Set(Object.values(subCategoriesByCategory).flat()),
                  ).sort((a, b) => a.localeCompare(b));
                  const otherSubs = allSubs.filter((s) => !subs.includes(s));
                  if (subMode === "new") {
                    return (
                      <div className="flex gap-1.5">
                        <input
                          className={inp}
                          value={v.subCategory}
                          onChange={(e) =>
                            setV((s) => (s ? { ...s, subCategory: e.target.value, brand: e.target.value } : s))
                          }
                          placeholder="New brand / vendor"
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => setSubMode("pick")}
                          className="px-2 rounded-lg border border-border text-xs text-muted-foreground hover:bg-secondary"
                        >
                          ✕
                        </button>
                      </div>
                    );
                  }
                  const currentInList =
                    !v.subCategory || allSubs.includes(v.subCategory);
                  return (
                    <select
                      className={inp}
                      value={currentInList ? v.subCategory : "__missing__"}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === "__new__") {
                          setSubMode("new");
                          setV((s) => (s ? { ...s, subCategory: "", brand: "" } : s));
                        } else if (val !== "__missing__") {
                          setV((s) => (s ? { ...s, subCategory: val, brand: val } : s));
                        }
                      }}
                    >
                      <option value="">— Select brand —</option>
                      {!currentInList && (
                        <option value="__missing__">{v.subCategory} (current)</option>
                      )}
                      {subs.length > 0 && (
                        <optgroup label={v.category ? `${v.category} vendors` : "Vendors"}>
                          {subs.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </optgroup>
                      )}
                      {otherSubs.length > 0 && (
                        <optgroup label={subs.length > 0 ? "Other vendors" : "All vendors"}>
                          {otherSubs.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </optgroup>
                      )}
                      <option value="__new__">＋ Add new brand…</option>
                    </select>
                  );
                })()}
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Size / Unit">
                <input className={inp} value={v.size} onChange={upd("size")} />
              </Field>
              <Field label="Pcs / Boxes per case">
                <input className={inp} value={v.pcs} onChange={upd("pcs")} />
              </Field>
            </div>
            <Field label="Product code">
              <input className={`${inp} font-mono`} value={v.code} onChange={upd("code")} />
            </Field>
          </Section>

          <Section title="Prices (¥)">
            <div className="grid grid-cols-3 gap-3">
              <Field label="x1">
                <input className={`${inp} font-mono`} value={v.p1} onChange={upd("p1")} />
              </Field>
              <Field label="x10">
                <input className={`${inp} font-mono`} value={v.p10} onChange={upd("p10")} />
              </Field>
              <Field label="Case">
                <input className={`${inp} font-mono`} value={v.pcase} onChange={upd("pcase")} />
              </Field>
            </div>
          </Section>

          <Section title="Barcode">
            <Field label="Barcode number">
              <div className="flex gap-2">
                <input
                  className={`${inp} font-mono flex-1`}
                  value={v.barcode}
                  onChange={upd("barcode")}
                  placeholder="Scan or type"
                />
                <button
                  type="button"
                  onClick={openScanner}
                  className="rounded-lg border border-border bg-card hover:bg-secondary px-3 text-sm font-medium whitespace-nowrap"
                >
                  📷 Scan
                </button>
              </div>
            </Field>
          </Section>
          {scanning && (
            <BarcodeScanner
              initialStream={scannerStream}
              onClose={() => {
                setScanning(false);
                setScannerStream(null);
              }}
              initialValue={v.barcode}
              onDetected={(txt) => {
                setV((s) => (s ? { ...s, barcode: txt } : s));
                setScanning(false);
                setScannerStream(null);
                toast.success(`Scanned: ${txt}`);
              }}
            />
          )}

          <div className="flex gap-2 pt-2">
            {onDelete && (
              <button
                onClick={onDelete}
                className="rounded-xl border border-destructive/40 text-destructive bg-card px-4 py-3 font-medium hover:bg-destructive/10"
              >
                🗑 Delete
              </button>
            )}
            <button
              onClick={onClose}
              className="flex-1 rounded-xl border border-border bg-card px-4 py-3 font-medium hover:bg-secondary"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                onSave(v);
                toast.success("Saved");
              }}
              className="flex-1 rounded-xl bg-primary text-primary-foreground px-4 py-3 font-semibold hover:brightness-110"
            >
              Save changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const inp =
  "w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/15 transition";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">
        {title}
      </div>
      {children}
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs text-muted-foreground mb-1.5 font-medium">{label}</div>
      {children}
    </label>
  );
}
