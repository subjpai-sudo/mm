import { ImageIcon, LayoutGrid, List, Pencil, ScanLine, Trash2 } from "lucide-react";
import { StockStatus } from "@/routes/_authenticated/dashboard";
import { displaySize, displayStock } from "@/lib/product-format";

export function ProductHeroCard({
  p,
  view = "grid",
  canEdit,
  canDelete,
  onView,
  onEdit,
  onDelete,
  onScan,
}: {
  p: any;
  view?: "grid" | "list";
  canEdit: boolean;
  canDelete: boolean;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onScan: () => void;
}) {
  const categoryName = p.categories?.name;
  const stockLabel = displayStock(p);
  const isList = view === "list";

  const imageBlock = (
    <div
      className={`group relative bg-secondary flex items-center justify-center shrink-0 overflow-hidden ${
        isList ? "w-32 min-w-32 h-32 border-r border-border" : "h-52 border-b border-border"
      }`}
    >
      {p.image_url ? (
        <img
          src={p.image_url}
          alt={p.name}
          loading="lazy"
          className="w-full h-full object-cover transition group-hover:scale-105"
        />
      ) : (
        <div className="grid place-items-center text-muted-foreground">
          <ImageIcon className={isList ? "size-8 opacity-40" : "size-10 opacity-40"} />
          {!isList && <span className="text-[10px] uppercase tracking-widest mt-2">No image</span>}
        </div>
      )}

      <div className="absolute top-2 left-2" onClick={(e) => e.stopPropagation()}>
        <StockStatus stock={p.stock} threshold={p.low_stock_threshold} />
      </div>

      {p.origin && (
        <span className="absolute bottom-2 left-2 bg-card/90 border border-border text-muted-foreground text-[10px] font-semibold rounded px-1.5 py-0.5 max-w-[70%] truncate">
          {p.origin}
        </span>
      )}
    </div>
  );

  const bodyBlock = (
    <div className={`p-3.5 flex-1 flex flex-col min-w-0 ${isList ? "gap-1.5" : ""}`}>
      {categoryName && (
        <div className="text-[10px] font-semibold uppercase tracking-widest text-primary truncate">
          {categoryName}
        </div>
      )}
      <div className="text-sm font-semibold leading-snug text-foreground mt-0.5 line-clamp-2">
        {p.name}
        {displaySize(p) && (
          <span className="ml-1.5 font-mono text-[12px] font-bold text-primary whitespace-nowrap">
            · {displaySize(p)}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        <span className="text-[10px] bg-secondary border border-border rounded px-1.5 py-0.5 text-muted-foreground">
          Stock <span className="text-foreground font-bold">{stockLabel}</span>
        </span>
        {p.sku && (
          <span className="text-[10px] font-mono bg-secondary border border-border rounded px-1.5 py-0.5 text-muted-foreground truncate max-w-full">
            {p.sku}
          </span>
        )}
      </div>

      {p.barcode && (
        <div className="flex items-center gap-2 mt-2 px-2 py-1.5 bg-secondary border border-border rounded-lg min-h-8">
          <span className="flex-1 font-mono text-[10.5px] truncate text-foreground">{p.barcode}</span>
        </div>
      )}

      {canEdit && (
        <div className={`flex gap-2 ${isList ? "mt-2" : "mt-2.5"}`} onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={onEdit}
            className="flex-1 rounded-lg bg-primary text-primary-foreground font-semibold text-[12px] py-2 flex items-center justify-center gap-1.5 shadow-sm hover:brightness-110 transition"
          >
            <Pencil className="size-3.5" />
            Edit
          </button>
          {canDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="rounded-lg border border-destructive/30 text-destructive font-semibold text-[12px] px-3 py-2 hover:bg-destructive/10 transition"
              aria-label="Delete product"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div
      onClick={onView}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onView()}
      className={`relative bg-card border border-border rounded-2xl shadow-md overflow-hidden transition hover:-translate-y-0.5 hover:shadow-lg hover:border-primary/50 cursor-pointer ${
        isList ? "flex" : "flex flex-col"
      }`}
    >
      {canEdit && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onScan();
          }}
          aria-label="Scan barcode for this product"
          title="Scan barcode"
          className="absolute top-2 right-2 z-20 size-8 rounded-full bg-card/95 text-foreground shadow-sm border border-border flex items-center justify-center hover:bg-primary hover:text-primary-foreground hover:scale-110 transition"
        >
          <ScanLine className="size-4" />
        </button>
      )}

      {imageBlock}
      {bodyBlock}
    </div>
  );
}

export function ProductViewToggle({
  view,
  onChange,
}: {
  view: "grid" | "list";
  onChange: (v: "grid" | "list") => void;
}) {
  return (
    <div className="inline-flex gap-1 p-1 rounded-xl border border-border bg-background shrink-0">
      <button
        type="button"
        onClick={() => onChange("grid")}
        aria-label="Grid view"
        className={`inline-flex items-center gap-1 px-2.5 h-8 rounded-lg text-xs font-semibold transition ${
          view === "grid" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <LayoutGrid className="size-3.5" />
        Grid
      </button>
      <button
        type="button"
        onClick={() => onChange("list")}
        aria-label="List view"
        className={`inline-flex items-center gap-1 px-2.5 h-8 rounded-lg text-xs font-semibold transition ${
          view === "list" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <List className="size-3.5" />
        List
      </button>
    </div>
  );
}
