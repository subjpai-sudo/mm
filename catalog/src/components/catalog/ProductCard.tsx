import type { Product } from "@/data/products";

const Y = "¥";
const fmt = (v: number | string) => (v === "--" || v === "none" || v === "" ? "—" : `${Y}${v}`);

export function ProductCard({
  product,
  image,
  barcode,
  view,
  onEdit,
  onScan,
  onImageClick,
  flash,
}: {
  product: Product;
  image: string | null;
  barcode: string;
  view: "grid" | "list";
  onEdit: () => void;
  onScan?: () => void;
  onImageClick?: () => void;
  flash?: boolean;
}) {
  const isList = view === "list";
  const cat = [product.category, product.subCategory].filter(Boolean).join(" › ");
  // Auto-extract a size token (e.g. 420g, 700ml, 1.5L, 12oz) embedded in the
  // product name so it can be shown in the dedicated size badge and removed
  // from the displayed name. Pure display-side — does not mutate stored data.
  const SIZE_RE = /(\d+(?:[.,]\d+)?\s?(?:kg|g|mg|ml|cl|cc|l|oz|lbs?|pcs?))/i;
  const m = !product.size ? product.name.match(SIZE_RE) : null;
  const displaySize = product.size || (m ? m[1].replace(/\s+/g, "") : "");
  const displayName = m
    ? product.name.replace(SIZE_RE, "").replace(/\s{2,}/g, " ").replace(/[·•\-,\s]+$/g, "").trim()
    : product.name;
  return (
    <div
      onClick={onEdit}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onEdit()}
      className={`relative bg-card border border-border rounded-2xl shadow-soft overflow-hidden transition hover:-translate-y-0.5 hover:shadow-lifted hover:border-primary cursor-pointer ${flash ? "flash-success" : ""} ${isList ? "flex" : "flex flex-col"}`}
    >
      {onScan && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onScan();
          }}
          aria-label="Scan barcode for this product"
          title="Scan barcode"
          className="absolute top-2 right-2 z-20 w-8 h-8 rounded-full bg-card/95 text-foreground shadow-soft border border-border flex items-center justify-center hover:bg-primary hover:text-primary-foreground hover:scale-110 transition"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7V5a2 2 0 0 1 2-2h2" />
            <path d="M17 3h2a2 2 0 0 1 2 2v2" />
            <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
            <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (image && onImageClick) onImageClick();
        }}
        className={`group relative bg-[var(--surface-2)] flex items-center justify-center ${isList ? "w-32 min-w-32 h-32 border-r border-border" : "h-52 border-b border-border"} ${image ? "cursor-zoom-in" : "cursor-default"}`}
      >
        {image ? (
          <>
            <img
              src={image}
              alt={product.name}
              loading="lazy"
              className="w-full h-full object-cover transition group-hover:scale-105"
            />
            <span className="absolute bottom-1.5 right-1.5 bg-black/55 text-white text-[10px] rounded-md px-1.5 py-0.5 opacity-0 group-hover:opacity-100 transition">
              🔍 Zoom
            </span>
          </>
        ) : (
          <div className="text-[10px] text-muted-foreground uppercase tracking-widest">
            No image
          </div>
        )}
        <span className="absolute top-2 left-2 bg-primary text-primary-foreground font-mono text-[10px] font-bold rounded px-1.5 py-0.5">
          #{product.no}
        </span>
        <span className="absolute bottom-2 left-2 bg-card/90 border border-border text-muted-foreground text-[10px] font-semibold rounded px-1.5 py-0.5">
          {product.origin}
        </span>
      </button>

      <div className={`p-3.5 flex-1 flex flex-col ${isList ? "gap-1.5" : ""}`}>
        <div className="text-[10px] font-semibold uppercase tracking-widest text-primary">
          {product.brand}
        </div>
        <div className="text-sm font-semibold leading-snug text-foreground mt-0.5 break-words">
          {displayName}
          {displaySize && (
            <span className="ml-1.5 font-mono text-[12px] font-bold text-primary whitespace-nowrap">
              · {displaySize}
            </span>
          )}
        </div>

        {cat && (
          <div className="text-[10px] text-muted-foreground mt-1 truncate" title={cat}>
            {cat}
          </div>
        )}

        <div className="flex gap-1.5 mt-2 flex-wrap">
          <span className="text-[10px] bg-secondary border border-border rounded px-1.5 py-0.5 text-muted-foreground">
            {product.pcs}/case
          </span>
        </div>

        <div className="grid grid-cols-3 gap-px bg-border border border-border rounded-xl overflow-hidden mt-2.5">
          {[
            { label: "x1", val: product.p1, accent: true },
            { label: "x10", val: product.p10, accent: false },
            { label: "Case", val: product.pcase, accent: false },
          ].map(({ label, val, accent }) => (
            <div key={label} className={`text-center py-1.5 ${accent ? "bg-accent" : "bg-card"}`}>
              <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold">
                {label}
              </div>
              <div
                className={`font-mono text-[13px] ${val === "--" ? "text-[var(--ink-3)] font-normal" : accent ? "text-primary font-bold" : "text-foreground font-medium"}`}
              >
                {fmt(val)}
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className="mt-2.5 w-full rounded-lg bg-primary text-primary-foreground font-semibold text-[12px] py-2 flex items-center justify-center gap-1.5 shadow-soft hover:brightness-110 transition"
        >
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
          </svg>
          Edit
        </button>

        {barcode && (
          <div className="flex items-center gap-2 mt-2 px-2 py-1.5 bg-secondary border border-border rounded-lg min-h-8">
            <svg
              className="w-3.5 h-3.5 text-muted-foreground"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <rect x="2" y="4" width="2" height="16" />
              <rect x="6" y="4" width="1" height="16" />
              <rect x="9" y="4" width="3" height="16" />
              <rect x="14" y="4" width="1" height="16" />
              <rect x="17" y="4" width="2" height="16" />
            </svg>
            <span className="flex-1 font-mono text-[10.5px] truncate text-foreground">
              {barcode}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
