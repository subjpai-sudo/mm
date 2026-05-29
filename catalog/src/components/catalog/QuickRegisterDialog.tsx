import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export type QuickRegisterValues = {
  category: string;
  subCategory: string;
  name: string;
  size: string;
};

export function QuickRegisterDialog({
  open,
  barcode,
  no,
  initialCategory,
  initialSubCategory,
  initialName = "",
  initialSize = "",
  isExisting = false,
  categories,
  subCategoriesByCategory,
  onClose,
  onSave,
}: {
  open: boolean;
  barcode: string;
  no: number;
  initialCategory: string;
  initialSubCategory: string;
  initialName?: string;
  initialSize?: string;
  isExisting?: boolean;
  categories: string[];
  subCategoriesByCategory: Record<string, string[]>;
  onClose: () => void;
  onSave: (v: QuickRegisterValues, scanNext: boolean) => void;
}) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [category, setCategory] = useState(initialCategory);
  const [subCategory, setSubCategory] = useState(initialSubCategory);
  const [name, setName] = useState(initialName);
  const [size, setSize] = useState(initialSize);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setStep(0);
      setCategory(initialCategory);
      setSubCategory(initialSubCategory);
      setName(initialName);
      setSize(initialSize);
    }
  }, [open, initialCategory, initialSubCategory, initialName, initialSize, barcode]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open, step]);

  if (!open) return null;

  const subOptions = subCategoriesByCategory[category] ?? [];

  const next = () => {
    if (step === 0) {
      if (!category.trim()) return toast.error("Pick a category");
      setStep(1);
    } else if (step === 1) {
      if (!subCategory.trim()) return toast.error("Pick a sub-category");
      setStep(2);
    }
  };

  const finish = (scanNext: boolean) => {
    if (!name.trim()) return toast.error("Add the product name");
    onSave({ category: category.trim(), subCategory: subCategory.trim(), name: name.trim(), size: size.trim() }, scanNext);
  };

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="fixed inset-0 z-[9200] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-md p-3"
    >
      <div className="bg-card border border-border rounded-3xl shadow-lifted w-full max-w-md overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
              {isExisting ? "Update categories" : "Quick register"} · Step {step + 1}/3
            </div>
            <div className="font-display text-xl mt-0.5">
              #{no} · <span className="font-mono text-sm text-muted-foreground">{barcode}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-accent text-muted-foreground"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-5 space-y-4">
          {step === 0 && (
            <>
              <Label>Country (Origin)</Label>
              <input
                ref={inputRef}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && next()}
                list="qr-cat-list"
                placeholder="e.g. Myanmar, Thailand, Japan"
                className={inp}
              />
              <datalist id="qr-cat-list">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              {categories.length > 0 && (
                <ChipRow
                  items={categories}
                  active={category}
                  onPick={(c) => {
                    setCategory(c);
                  }}
                />
              )}
            </>
          )}

          {step === 1 && (
            <>
              <div className="text-xs text-muted-foreground">
                Country: <span className="text-foreground font-medium">{category}</span>
              </div>
              <Label>Brand (Vendor)</Label>
              <input
                ref={inputRef}
                value={subCategory}
                onChange={(e) => setSubCategory(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && next()}
                list="qr-sub-list"
                placeholder="e.g. MTG, HMWE, City Star"
                className={inp}
              />
              <datalist id="qr-sub-list">
                {subOptions.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
              {subOptions.length > 0 && (
                <ChipRow items={subOptions} active={subCategory} onPick={setSubCategory} />
              )}
            </>
          )}

          {step === 2 && (
            <>
              <div className="text-xs text-muted-foreground">
                {category} <span className="opacity-50">›</span> {subCategory}
              </div>
              <Label>Product name</Label>
              <input
                ref={inputRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full product name"
                className={inp}
              />
              <Label>Size / Unit</Label>
              <input
                value={size}
                onChange={(e) => setSize(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && finish(true)}
                placeholder="e.g. 160g, 730ml, 12pcs"
                className={inp}
              />
            </>
          )}
        </div>

        <div className="px-5 pb-5 flex gap-2">
          {step > 0 && (
            <button
              onClick={() => setStep((s) => (s - 1) as 0 | 1 | 2)}
              className="rounded-xl border border-border bg-card px-4 py-3 font-medium hover:bg-secondary"
            >
              ‹ Back
            </button>
          )}
          {step < 2 ? (
            <button
              onClick={next}
              className="flex-1 rounded-xl bg-primary text-primary-foreground px-4 py-3 font-semibold hover:brightness-110"
            >
              Next ›
            </button>
          ) : (
            <>
              <button
                onClick={() => finish(false)}
                className="flex-1 rounded-xl border border-border bg-card px-4 py-3 font-medium hover:bg-secondary"
              >
                Save
              </button>
              <button
                onClick={() => finish(true)}
                className="flex-1 rounded-xl bg-primary text-primary-foreground px-4 py-3 font-semibold hover:brightness-110"
              >
                Save & scan next
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const inp =
  "w-full bg-background border border-border rounded-lg px-3 py-3 text-base outline-none focus:border-primary focus:ring-4 focus:ring-primary/15 transition";

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">
      {children}
    </div>
  );
}

function ChipRow({
  items,
  active,
  onPick,
}: {
  items: string[];
  active: string;
  onPick: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((it) => (
        <button
          key={it}
          type="button"
          onClick={() => onPick(it)}
          className={`text-xs px-2.5 py-1.5 rounded-full border transition ${
            active === it
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-secondary border-border text-muted-foreground hover:border-primary hover:text-primary"
          }`}
        >
          {it}
        </button>
      ))}
    </div>
  );
}
