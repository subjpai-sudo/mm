import { useState } from "react";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas-pro";
import { format } from "date-fns";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FileText, Copy, Send, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { sendReportLinkSms } from "@/lib/notifications.functions";
import { categoryPalette } from "@/lib/category-colors";
import { KNOWN_ORIGINS } from "@/lib/origin-colors";

type Product = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  brand: string | null;
  stock: number;
  low_stock_threshold: number;
  price?: number | null;
  rack?: string | null;
  shelf?: string | null;
  origin?: string | null;
  size?: string | null;
  unit?: string | null;
  pcs_per_case?: number | null;
  categories?: { name: string | null } | null;
};

type Movements = { inQty: number; outQty: number; total: number };
type RawMovement = {
  id: string;
  type: "in" | "out";
  quantity: number;
  destination: string | null;
  created_at: string;
  products?: { name: string | null } | null;
};

type SectionId = "summary" | "low" | "out" | "all" | "insights" | "destinations";
const SECTIONS: { id: SectionId; label: string; desc: string }[] = [
  { id: "summary", label: "Summary", desc: "Totals and key metrics" },
  { id: "low", label: "Low stock products", desc: "At or below threshold" },
  { id: "out", label: "Out of stock products", desc: "Zero stock items" },
  { id: "all", label: "All products + stock counts", desc: "Full catalog with status" },
  { id: "insights", label: "Insights", desc: "Top movers, stock health, alerts" },
  { id: "destinations", label: "Movement destinations", desc: "Where stock is going" },
];

// ────────────────────────────────────────────────────────────────────────────
// HTML report builder — mirrors the supplied template, threshold column removed.
// ────────────────────────────────────────────────────────────────────────────

const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const fmtNum = (n: number) => n.toLocaleString("en-US");
const fmtYen = (n: number) => {
  if (!isFinite(n) || n <= 0) return "¥0";
  if (n >= 1000) return `¥${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return `¥${Math.round(n)}`;
};

// Swatch color comes from the category palette so Myanmar = green,
// Thailand = blue, Indonesia = purple, Asian Halal = red, etc.
function swatchFor(categoryName?: string | null): string {
  return categoryPalette(categoryName).bg;
}

// If the category name matches a known origin/country (Myanmar, Thailand…),
// use it as the product's origin when none is set on the row.
const ORIGIN_LOOKUP = new Set(KNOWN_ORIGINS.map((o) => o.toLowerCase()));
function originOf(p: Product): string {
  const explicit = (p.origin ?? "").trim();
  if (explicit) return explicit;
  const cat = (p.categories?.name ?? "").trim();
  if (cat && ORIGIN_LOOKUP.has(cat.toLowerCase())) return cat;
  return "—";
}

function statusOf(p: Product) {
  if (p.stock <= 0) return { label: "OUT", color: "var(--bad)" };
  if (p.stock <= p.low_stock_threshold) return { label: "LOW", color: "var(--warn)" };
  return { label: "HEALTHY", color: "var(--ok)" };
}

function displaySize(p: Product): string {
  const sz = (p.size ?? "").trim();
  const u = (p.unit ?? "").trim();
  if (!sz && !u) return "";
  if (!sz) return u;
  return /[a-zA-Z]$/.test(sz) ? sz : `${sz}${u ? u : ""}`;
}

function rackLabel(p: Product) {
  const r = (p.rack ?? "").trim();
  const s = (p.shelf ?? "").trim().toUpperCase();
  if (!r && !s) return "—";
  if (!r) return s;
  if (!s) return r;
  return `${r}/${s}`;
}

function reorderQty(p: Product) {
  return Math.max(0, p.low_stock_threshold * 2 - p.stock);
}

const STYLE = `
  :root{
    --ink:#0a1320;--ink-2:#475569;--ink-3:#8a99ab;--line:#e2e8ed;
    --bg:#fafbfc;--surface:#fff;--surface-2:#f5f7fa;
    --primary:#0e7c70;--primary-2:#14a999;--primary-tint:#e6f4f2;
    --accent:#b07a16;--ok:#16a34a;--warn:#d97706;--bad:#dc2626;
  }
  *{box-sizing:border-box}
  .rpt{font-family:"Geist","Inter",system-ui,sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased}
  .rpt .mono{font-family:"Geist Mono",ui-monospace,monospace}
  .rpt .page{width:210mm;height:297mm;background:#fff;padding:14mm;position:relative;display:flex;flex-direction:column;overflow:hidden}
  .rpt h1,.rpt h2,.rpt h3,.rpt h4{margin:0;letter-spacing:-.02em}
  .rpt h1{font-size:22pt;font-weight:600;letter-spacing:-.025em;line-height:1.05}
  .rpt h2{font-size:13pt;font-weight:600;line-height:1.15}
  .rpt h3{font-size:9pt;font-weight:600;text-transform:uppercase;letter-spacing:.14em;color:var(--ink-3)}
  .rpt p{margin:0;line-height:1.45;font-size:9pt;color:var(--ink-2)}
  .rpt .small{font-size:7.5pt;color:var(--ink-2)}
  .rpt .upper{font-size:7pt;font-weight:600;text-transform:uppercase;letter-spacing:.14em;color:var(--ink-3)}
  .rpt .doc-head{display:flex;align-items:flex-start;gap:14px;padding-bottom:12px;border-bottom:1px solid var(--line)}
  .rpt .logo{width:32pt;height:32pt;border-radius:8pt;background:linear-gradient(135deg,var(--primary),var(--primary-2));display:grid;place-items:center;color:#fff;flex-shrink:0}
  .rpt .logo svg{width:18pt;height:18pt}
  .rpt .brand .name{font-size:12pt;font-weight:600;letter-spacing:-.01em}
  .rpt .brand .sub{font-size:7pt;color:var(--ink-3);font-family:"Geist Mono",monospace;letter-spacing:.06em}
  .rpt .meta{margin-left:auto;text-align:right;font-size:7.5pt;color:var(--ink-2);display:flex;flex-direction:column;gap:2px}
  .rpt .meta b{color:var(--ink);font-weight:600}
  .rpt .doc-foot{display:flex;justify-content:space-between;align-items:center;padding-top:8pt;border-top:1px solid var(--line);font-size:6.5pt;color:var(--ink-3);font-family:"Geist Mono",monospace;letter-spacing:.06em;margin-top:auto}
  .rpt .section{margin-top:14pt}
  .rpt .section-head{display:flex;align-items:center;gap:10pt;margin-bottom:8pt}
  .rpt .section-head .rule{flex:1;height:1px;background:var(--line)}
  .rpt .section-head .badge{padding:1.5pt 7pt;border-radius:99pt;font-size:7pt;font-weight:700;font-family:"Geist Mono",monospace;letter-spacing:.06em;background:var(--surface-2);color:var(--ink-2);border:1px solid var(--line)}
  .rpt .section-head .badge.warn{background:var(--warn);color:#fff;border-color:var(--warn)}
  .rpt .section-head .badge.bad{background:var(--bad);color:#fff;border-color:var(--bad)}
  .rpt .section-head .badge.ok{background:var(--ok);color:#fff;border-color:var(--ok)}
  .rpt .section-head .badge.pri{background:var(--primary);color:#fff;border-color:var(--primary)}
  .rpt table{width:100%;border-collapse:collapse;font-size:8pt}
  .rpt thead th{text-align:left;padding:5pt 7pt;font-size:6pt;text-transform:uppercase;letter-spacing:.1em;font-weight:600;color:var(--ink-3);background:var(--surface-2);border-bottom:1px solid var(--line)}
  .rpt tbody td{padding:5pt 7pt;border-bottom:1px solid var(--line);vertical-align:middle}
  .rpt tbody tr:nth-child(even){background:#fbfcfd}
  .rpt tbody tr:last-child td{border-bottom:none}
  .rpt td.right,.rpt th.right{text-align:right}
  .rpt td.center,.rpt th.center{text-align:center}
  .rpt .qty{font-weight:600;font-variant-numeric:tabular-nums}
  .rpt .mono-sm{font-family:"Geist Mono",monospace;font-size:7pt;color:var(--ink-3)}
  .rpt .swatch{width:12pt;height:12pt;border-radius:3pt;flex-shrink:0;display:inline-block;vertical-align:middle}
  .rpt .strip{display:grid;grid-template-columns:repeat(4,1fr);gap:10pt;margin-bottom:12pt}
  .rpt .strip .cell{padding:10pt;border-radius:5pt;background:#fff;border:1px solid var(--line)}
  .rpt .strip .cell .l{font-size:6.5pt;color:var(--ink-3);font-family:"Geist Mono",monospace;letter-spacing:.1em;text-transform:uppercase}
  .rpt .strip .cell .v{font-size:18pt;font-weight:600;letter-spacing:-.02em;margin-top:4pt;line-height:1;font-variant-numeric:tabular-nums}
  .rpt .strip .cell .s{font-size:7pt;color:var(--ink-3);font-family:"Geist Mono",monospace;margin-top:3pt}
  .rpt .strip .cell.ok .v{color:var(--ok)}
  .rpt .strip .cell.warn .v{color:var(--warn)}
  .rpt .strip .cell.bad .v{color:var(--bad)}
  .rpt .strip .cell.pri .v{color:var(--primary)}
  .rpt .bar{width:100%;height:5pt;background:#eef2f5;border-radius:99pt;overflow:hidden}
  .rpt .bar>span{display:block;height:100%;border-radius:99pt}
  .rpt .chart-row{display:grid;grid-template-columns:90pt 1fr 70pt;gap:10pt;align-items:center;margin-bottom:5pt;font-size:8pt}
  .rpt .chart-row .lbl{font-weight:600}
  .rpt .chart-row .bar2{height:14pt;background:#eef2f5;border-radius:3pt;overflow:hidden;position:relative}
  .rpt .chart-row .bar2>div{height:100%;display:flex;align-items:center;justify-content:flex-end;padding:0 6pt;color:#fff;font-weight:700;font-size:6.5pt;font-family:"Geist Mono",monospace;font-variant-numeric:tabular-nums}
  .rpt .chart-row .share{text-align:right;font-size:6.5pt;color:var(--ink-3);font-family:"Geist Mono",monospace}
  .rpt .shop-card{border:1px solid var(--line);border-radius:6pt;padding:10pt;margin-bottom:8pt;display:grid;grid-template-columns:1fr 80pt 80pt;gap:12pt;align-items:center}
  .rpt .shop-card .rank{font-family:"Geist Mono",monospace;font-weight:700;color:var(--ink-3);font-size:8pt;letter-spacing:.06em}
  .rpt .shop-card .nm{font-weight:700;font-size:11pt;letter-spacing:-.01em;margin-top:1pt;color:var(--primary)}
  .rpt .shop-card .addr{font-size:7pt;color:var(--ink-3);font-family:"Geist Mono",monospace;margin-top:2pt;letter-spacing:.04em}
  .rpt .shop-card .top-prod{font-size:7pt;color:var(--ink-2);margin-top:4pt}
  .rpt .shop-card .top-prod b{color:var(--ink);font-weight:600}
  .rpt .shop-card .num{text-align:right}
  .rpt .shop-card .num .v{font-size:16pt;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.02em;color:var(--primary)}
  .rpt .shop-card .num .l{font-size:6.5pt;color:var(--ink-3);font-family:"Geist Mono",monospace;letter-spacing:.06em}
  .rpt .shop-card .trend{text-align:right;font-family:"Geist Mono",monospace;font-size:8pt;font-weight:700}
  .rpt .shop-card .trend.up{color:var(--ok)}.rpt .shop-card .trend.down{color:var(--bad)}
`;

const LOGO_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21V9l9-5 9 5v12M3 21h18M7 21v-7h10v7M9 14v7M15 14v7"/></svg>`;

function buildReportHtml(opts: {
  selected: Record<SectionId, boolean>;
  products: Product[];
  lowList: Product[];
  outList: Product[];
  movements: Movements;
  rawMovements: RawMovement[];
  reference: string;
  dateLabel: string;
  timeLabel: string;
}): { html: string; pageCount: number } {
  const { selected, products, lowList, outList, rawMovements, reference, dateLabel, timeLabel } = opts;

  const totalUnits = products.reduce((a, p) => a + (p.stock ?? 0), 0);
  const totalValue = products.reduce((a, p) => a + (p.stock ?? 0) * Number(p.price ?? 0), 0);
  const healthy = products.length - lowList.length - outList.length;
  const reorderCost =
    [...lowList, ...outList].reduce((a, p) => a + reorderQty(p) * Number(p.price ?? 0), 0);

  const racks = new Set(products.map((p) => (p.rack ?? "").trim()).filter(Boolean));

  const pages: string[] = [];

  // ── Helper: header for sub-pages
  const subHead = (title: string, sub: string, pageNum: number) => `
    <header class="doc-head">
      <div class="logo">${LOGO_SVG}</div>
      <div class="brand">
        <div class="name">${esc(title)}</div>
        <div class="sub">${esc(sub)}</div>
      </div>
      <div class="meta">
        <div>Stock Report · <b>${esc(dateLabel)}</b></div>
        <div>${esc(reference)} · Page ${pageNum}</div>
      </div>
    </header>`;

  // ── PAGE 1: summary + all products
  if (selected.summary || selected.all) {
    const rows = (selected.all ? products : [])
      .slice()
      .sort((a, b) => (a.categories?.name ?? "").localeCompare(b.categories?.name ?? "") || a.name.localeCompare(b.name))
      .map((p) => {
        const s = statusOf(p);
        const swColor = swatchFor(p.categories?.name);
        const stockColor =
          p.stock <= 0 ? "var(--bad)" : p.stock <= p.low_stock_threshold ? "var(--warn)" : "var(--ink)";
        return `<tr>
          <td><span class="swatch" style="background:${swColor}"></span></td>
          <td>${esc(p.name)}</td>
          <td>${esc((p.brand ?? "—").toUpperCase())}</td>
          <td>${esc(p.categories?.name ?? "—")}</td>
          <td class="mono-sm">${esc(displaySize(p) || "—")}</td>
          <td class="mono-sm">${esc(rackLabel(p))}</td>
          <td class="right qty" style="color:${stockColor}">${fmtNum(p.stock ?? 0)}</td>
          <td class="right mono-sm">${p.price ? fmtNum(Number(p.price)) : "—"}</td>
          <td><span style="color:${s.color};font-weight:600;font-size:7pt">● ${s.label}</span></td>
        </tr>`;
      }).join("");

    pages.push(`<div class="page">
      <header class="doc-head">
        <div class="logo">${LOGO_SVG}</div>
        <div class="brand">
          <div class="name">CityStar Inventory</div>
          <div class="sub">STOCK REPORT · ${esc(dateLabel.toUpperCase())}</div>
        </div>
        <div class="meta">
          <div><b>Generated</b> ${esc(timeLabel)}</div>
          <div>Reference <b>${esc(reference)}</b></div>
          <div>Period <b>Live snapshot</b></div>
        </div>
      </header>

      <div style="margin-top:12pt;margin-bottom:10pt">
        <h1>All products — full inventory</h1>
        <p style="margin-top:4pt">${products.length} SKUs across ${racks.size || "—"} racks · ${fmtNum(totalUnits)} total units · ${fmtYen(totalValue)} inventory value.</p>
      </div>

      <div class="strip">
        <div class="cell ok"><div class="l">Healthy</div><div class="v">${healthy}</div><div class="s">ABOVE THRESHOLD</div></div>
        <div class="cell warn"><div class="l">Low stock</div><div class="v">${lowList.length}</div><div class="s">AT OR BELOW THRESHOLD</div></div>
        <div class="cell bad"><div class="l">Out of stock</div><div class="v">${outList.length}</div><div class="s">ZERO UNITS</div></div>
        <div class="cell pri"><div class="l">Reorder need</div><div class="v">${fmtYen(reorderCost)}</div><div class="s">EST. COST</div></div>
      </div>

      ${selected.all ? `<div class="section">
        <div class="section-head">
          <h2>All products</h2>
          <span class="badge">${products.length} ITEMS</span>
          <div class="rule"></div>
          <span class="upper">SORTED BY CATEGORY</span>
        </div>
        <table>
          <thead><tr>
            <th style="width:14pt"></th>
            <th>Product</th><th>Brand</th><th>Category</th>
            <th>Size</th><th>Rack</th>
            <th class="right">Stock</th><th class="right">¥ × 1</th>
            <th>Status</th>
          </tr></thead>
          <tbody>${rows || `<tr><td colspan="9" style="text-align:center;color:var(--ink-3);padding:14pt">No products.</td></tr>`}</tbody>
        </table>
      </div>` : ""}

      <footer class="doc-foot">
        <span>CITYSTAR INVENTORY · CONFIDENTIAL</span>
        <span>${esc(reference)}</span>
        <span>PAGE __P__</span>
      </footer>
    </div>`);
  }

  // ── PAGE 2: out of stock
  if (selected.out) {
    const outCost = outList.reduce((a, p) => a + reorderQty(p) * Number(p.price ?? 0), 0);
    const body = outList.map((p) => {
      const swColor = swatchFor(p.categories?.name);
      const reorder = reorderQty(p) || p.low_stock_threshold * 2 || 1;
      const unitPrice = Number(p.price ?? 0);
      const estCost = reorder * unitPrice;
      return `<tr>
        <td><span class="swatch" style="background:${swColor}"></span></td>
        <td><b>${esc(p.name)}</b><div class="mono-sm">${esc(p.sku ?? "—")} · ${esc(p.barcode ?? "—")}</div></td>
        <td>${esc((p.brand ?? "—").toUpperCase())}</td>
        <td>${esc(p.categories?.name ?? "—")}</td>
        <td class="mono-sm">${esc(originOf(p))}</td>
        <td class="mono-sm">${esc(rackLabel(p))}</td>
        <td class="right qty" style="color:var(--primary)">+${reorder}</td>
        <td class="right mono-sm">${unitPrice ? fmtNum(unitPrice) : "—"}</td>
        <td class="right qty" style="color:var(--accent)">${fmtNum(Math.round(estCost))}</td>
      </tr>`;
    }).join("");

    // Top stocked-out movers (from rawMovements)
    const outMoves = rawMovements.filter((m) => m.type === "out");
    const byName = new Map<string, number>();
    for (const m of outMoves) {
      const n = m.products?.name ?? "—";
      byName.set(n, (byName.get(n) ?? 0) + m.quantity);
    }
    const topMovers = [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    const maxMove = topMovers[0]?.[1] || 1;
    const totalMove = topMovers.reduce((a, [, v]) => a + v, 0);

    pages.push(`<div class="page">
      ${subHead("Out of stock", "URGENT · 0 UNITS ON HAND", pages.length + 1)}
      <div style="margin-top:10pt">
        <h1>Out of stock</h1>
        <p style="margin-top:4pt">These cannot be picked or delivered. Total replacement cost <b>${fmtYen(outCost)}</b>.</p>
      </div>
      <div class="section">
        <div class="section-head">
          <h2>Action needed today</h2>
          <span class="badge bad">${outList.length} ITEMS</span>
          <div class="rule"></div>
        </div>
        <table>
          <thead><tr>
            <th style="width:14pt"></th>
            <th>Product</th><th>Brand</th><th>Category</th>
            <th>Origin</th><th>Rack</th>
            <th class="right">Reorder</th><th class="right">¥ / case</th><th class="right">Est. cost</th>
          </tr></thead>
          <tbody>${body || `<tr><td colspan="9" style="text-align:center;color:var(--ink-3);padding:14pt">Nothing out of stock — nice.</td></tr>`}</tbody>
        </table>
      </div>
      ${topMovers.length ? `<div class="section">
        <div class="section-head"><h2>Most stocked-out this week</h2><div class="rule"></div><span class="upper">UNITS · RECENT</span></div>
        <div style="margin-top:4pt">
          ${topMovers.map(([name, qty]) => {
            const width = Math.round((qty / maxMove) * 100);
            const share = totalMove ? Math.round((qty / totalMove) * 100) : 0;
            return `<div class="chart-row"><span class="lbl">${esc(name)}</span><div class="bar2"><div style="width:${width}%;background:#dc2626">${qty}</div></div><span class="share">${share}%</span></div>`;
          }).join("")}
        </div>
      </div>` : ""}
      <footer class="doc-foot"><span>CITYSTAR INVENTORY · CONFIDENTIAL</span><span>${esc(reference)}</span><span>PAGE __P__</span></footer>
    </div>`);
  }

  // ── PAGE 3: low stock
  if (selected.low) {
    const lowCost = lowList.reduce((a, p) => a + reorderQty(p) * Number(p.price ?? 0), 0);
    const body = lowList.map((p) => {
      const swColor = swatchFor(p.categories?.name);
      const coverage = p.low_stock_threshold > 0 ? Math.min(100, Math.round((p.stock / p.low_stock_threshold) * 100)) : 0;
      const reorder = reorderQty(p);
      const unitPrice = Number(p.price ?? 0);
      return `<tr>
        <td><span class="swatch" style="background:${swColor}"></span></td>
        <td><b>${esc(p.name)}</b><div class="mono-sm">${esc(p.sku ?? "—")}</div></td>
        <td>${esc((p.brand ?? "—").toUpperCase())}</td>
        <td>${esc(p.categories?.name ?? "—")}</td>
        <td class="right qty" style="color:var(--warn)">${fmtNum(p.stock ?? 0)}</td>
        <td style="padding-right:12pt"><div class="bar"><span style="width:${coverage}%;background:var(--warn)"></span></div></td>
        <td class="right qty" style="color:var(--primary)">+${reorder}</td>
        <td class="right mono-sm">${unitPrice ? fmtNum(unitPrice) : "—"}</td>
      </tr>`;
    }).join("");

    pages.push(`<div class="page">
      ${subHead("Low stock", "AT OR BELOW THRESHOLD", pages.length + 1)}
      <div style="margin-top:10pt"><h1>Low stock</h1>
        <p style="margin-top:4pt">${lowList.length} item${lowList.length === 1 ? "" : "s"} at or below threshold · estimated combined reorder cost <b>${fmtYen(lowCost)}</b>.</p>
      </div>
      <div class="section">
        <div class="section-head"><h2>Reorder list</h2><span class="badge warn">${lowList.length} ITEMS</span><div class="rule"></div></div>
        <table>
          <thead><tr>
            <th style="width:14pt"></th>
            <th>Product</th><th>Brand</th><th>Category</th>
            <th class="right">Stock</th>
            <th>Coverage</th>
            <th class="right">Reorder</th><th class="right">¥ / case</th>
          </tr></thead>
          <tbody>${body || `<tr><td colspan="8" style="text-align:center;color:var(--ink-3);padding:14pt">No low-stock items.</td></tr>`}</tbody>
        </table>
      </div>
      ${lowList.length ? `<div style="margin-top:14pt;padding:10pt 12pt;background:var(--primary-tint);border-radius:5pt;border:1px solid #cbe6e2;display:flex;align-items:center;gap:12pt">
        <div style="width:28pt;height:28pt;border-radius:6pt;background:var(--primary);color:#fff;display:grid;place-items:center">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 12 5 5 9-11" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div style="flex:1">
          <div style="font-size:9pt;font-weight:600">Approve combined reorder</div>
          <div class="small">Routes one PO per brand to the supplier on file.</div>
        </div>
        <div style="text-align:right">
          <div class="upper">Total</div>
          <div style="font-size:13pt;font-weight:700;color:var(--accent);margin-top:2pt">${fmtYen(lowCost)}</div>
        </div>
      </div>` : ""}
      <footer class="doc-foot"><span>CITYSTAR INVENTORY · CONFIDENTIAL</span><span>${esc(reference)}</span><span>PAGE __P__</span></footer>
    </div>`);
  }

  // ── PAGE 4: category & brand distribution
  if (selected.insights) {
    const catTot = new Map<string, { units: number; skus: number }>();
    for (const p of products) {
      const k = p.categories?.name ?? "Uncategorized";
      const cur = catTot.get(k) ?? { units: 0, skus: 0 };
      cur.units += p.stock ?? 0;
      cur.skus += 1;
      catTot.set(k, cur);
    }
    const catRows = [...catTot.entries()].sort((a, b) => b[1].units - a[1].units);
    const catMax = catRows[0]?.[1].units || 1;
    const catTotal = catRows.reduce((a, [, v]) => a + v.units, 0);

    const brandTot = new Map<string, { units: number; value: number; skus: number; cat: string; statusMix: string }>();
    for (const p of products) {
      const key = (p.brand ?? "Unbranded").toUpperCase();
      const cur = brandTot.get(key) ?? { units: 0, value: 0, skus: 0, cat: p.categories?.name ?? "—", statusMix: "" };
      cur.units += p.stock ?? 0;
      cur.value += (p.stock ?? 0) * Number(p.price ?? 0);
      cur.skus += 1;
      brandTot.set(key, cur);
    }
    const brandRows = [...brandTot.entries()].sort((a, b) => b[1].value - a[1].value).slice(0, 12);

    const brandBody = brandRows.map(([brand, v]) => {
      const sw = swatchFor(brand);
      const items = products.filter((p) => (p.brand ?? "Unbranded").toUpperCase() === brand);
      const out = items.filter((p) => p.stock <= 0).length;
      const low = items.filter((p) => p.stock > 0 && p.stock <= p.low_stock_threshold).length;
      const status = out > 0 ? { c: "var(--bad)", l: "OUT" } : low > 0 ? { c: "var(--warn)", l: "LOW" } : { c: "var(--ok)", l: "HEALTHY" };
      return `<tr>
        <td><span class="swatch" style="background:${sw}"></span></td>
        <td><b>${esc(brand)}</b></td>
        <td>${esc(v.cat)}</td>
        <td class="right mono-sm">${v.skus}</td>
        <td class="right qty">${fmtNum(v.units)}</td>
        <td class="right qty" style="color:var(--accent)">${fmtYen(v.value)}</td>
        <td class="right" style="color:${status.c};font-weight:600;font-size:7pt">● ${status.l}</td>
      </tr>`;
    }).join("");

    pages.push(`<div class="page">
      ${subHead("By category & brand", "DISTRIBUTION ANALYSIS", pages.length + 1)}
      <div style="margin-top:10pt"><h1>Stock by category</h1>
        <p style="margin-top:4pt">Where your inventory weight sits across the ${catRows.length} categor${catRows.length === 1 ? "y" : "ies"} you stock.</p>
      </div>
      <div class="section"><div style="margin-top:4pt">
        ${catRows.map(([name, v]) => {
          const width = Math.round((v.units / catMax) * 100);
          const share = catTotal ? Math.round((v.units / catTotal) * 100) : 0;
          const c = swatchFor(name);
          return `<div class="chart-row"><span class="lbl">${esc(name)}</span><div class="bar2"><div style="width:${Math.max(width, 2)}%;background:${c}">${v.units}</div></div><span class="share">${v.skus} SKU · ${share}%</span></div>`;
        }).join("")}
      </div></div>
      <div class="section">
        <div class="section-head"><h2>Top brands by stock value</h2><div class="rule"></div><span class="upper">¥ × 1 retail</span></div>
        <table>
          <thead><tr>
            <th style="width:14pt"></th>
            <th>Brand</th><th>Category</th>
            <th class="right">SKUs</th><th class="right">Units</th>
            <th class="right">Stock ¥</th><th class="right">Status mix</th>
          </tr></thead>
          <tbody>${brandBody || `<tr><td colspan="7" style="text-align:center;color:var(--ink-3);padding:14pt">No brand data.</td></tr>`}</tbody>
        </table>
      </div>
      <footer class="doc-foot"><span>CITYSTAR INVENTORY · CONFIDENTIAL</span><span>${esc(reference)}</span><span>PAGE __P__</span></footer>
    </div>`);
  }

  // ── PAGE 5: shop tracker (destinations)
  if (selected.destinations) {
    const byDest = new Map<string, { qty: number; trips: number; products: Map<string, number> }>();
    for (const m of rawMovements) {
      if (m.type !== "out") continue;
      const dest = (m.destination ?? "").trim() || "Unspecified";
      const cur = byDest.get(dest) ?? { qty: 0, trips: 0, products: new Map() };
      cur.qty += m.quantity;
      cur.trips += 1;
      const n = m.products?.name ?? "—";
      cur.products.set(n, (cur.products.get(n) ?? 0) + m.quantity);
      byDest.set(dest, cur);
    }
    const ranked = [...byDest.entries()].sort((a, b) => b[1].qty - a[1].qty);
    const totalDelivered = ranked.reduce((a, [, v]) => a + v.qty, 0);
    const totalTrips = ranked.reduce((a, [, v]) => a + v.trips, 0);
    const topShop = ranked[0];
    const topShare = topShop && totalDelivered ? Math.round((topShop[1].qty / totalDelivered) * 100) : 0;

    const cardColors = ["#0ea5e9", "#a855f7", "#ec4899", "#10b981", "#f59e0b", "#ef4444", "#3b82f6", "#84cc16"];

    pages.push(`<div class="page">
      ${subHead("Shop tracker", "WHO ORDERS WHAT", pages.length + 1)}
      <div style="margin-top:10pt"><h1>Shop tracker</h1>
        <p style="margin-top:4pt">Which destination took most stock and what product they pulled most. Ranked by units delivered.</p>
      </div>
      <div class="strip">
        <div class="cell pri"><div class="l">Total units delivered</div><div class="v">${fmtNum(totalDelivered)}</div><div class="s">ALL DESTINATIONS</div></div>
        <div class="cell pri"><div class="l">Movements</div><div class="v">${fmtNum(totalTrips)}</div><div class="s">DISPATCHED</div></div>
        <div class="cell ok"><div class="l">Top destination</div><div class="v" style="font-size:14pt">${esc(topShop?.[0] ?? "—")}</div><div class="s">${topShop ? `${fmtNum(topShop[1].qty)} UNITS · ${topShare}%` : "—"}</div></div>
        <div class="cell"><div class="l">Active routes</div><div class="v">${ranked.length}</div><div class="s">RECENT</div></div>
      </div>
      <div class="section">
        <div class="section-head"><h2>Ranked by volume</h2><span class="badge pri">${ranked.length} DESTINATION${ranked.length === 1 ? "" : "S"}</span><div class="rule"></div></div>
        ${ranked.length === 0 ? `<p style="text-align:center;color:var(--ink-3);padding:14pt">No movement destinations yet.</p>` :
          ranked.map(([dest, v], idx) => {
            const top = [...v.products.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
            const topName = top[0]?.[0] ?? "—";
            const topQty = top[0]?.[1] ?? 0;
            const also = top.slice(1).map(([n]) => n).join(", ") || "—";
            const c = cardColors[idx % cardColors.length];
            return `<div class="shop-card">
              <div>
                <div class="rank">#${idx + 1}</div>
                <div class="nm" style="color:${c}">${esc(dest)}</div>
                <div class="addr">${v.trips} TRIP${v.trips === 1 ? "" : "S"} · ${v.products.size} SKU</div>
                <div class="top-prod">Top product: <b>${esc(topName)}</b> · ${fmtNum(topQty)} units · also: ${esc(also)}</div>
              </div>
              <div class="num"><div class="v">${fmtNum(v.qty)}</div><div class="l">UNITS</div></div>
              <div class="trend up">${totalDelivered ? `${Math.round((v.qty / totalDelivered) * 100)}%` : "—"}</div>
            </div>`;
          }).join("")
        }
      </div>
      <footer class="doc-foot"><span>CITYSTAR INVENTORY · CONFIDENTIAL · END OF REPORT</span><span>${esc(reference)}</span><span>PAGE __P__</span></footer>
    </div>`);
  }

  if (pages.length === 0) {
    pages.push(`<div class="page"><div style="margin:auto;text-align:center;color:var(--ink-3)">No sections selected.</div></div>`);
  }

  // Fill in page numbers
  const total = pages.length;
  const finalPages = pages.map((html, i) => html.replace("__P__", `${i + 1} / ${total}`));

  return {
    html: `<style>${STYLE}</style><div class="rpt">${finalPages.join("")}</div>`,
    pageCount: total,
  };
}

export function ReportPdfDialog({
  products, lowList, outList, movements, rawMovements = [],
}: {
  products: Product[];
  lowList: Product[];
  outList: Product[];
  movements: Movements;
  rawMovements?: RawMovement[];
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);
  const [selected, setSelected] = useState<Record<SectionId, boolean>>({
    summary: true, low: true, out: true, all: true, insights: true, destinations: true,
  });
  const sendSms = useServerFn(sendReportLinkSms);

  const today = format(new Date(), "yyyy-MM-dd");
  const anySelected = Object.values(selected).some(Boolean);
  const toggle = (id: SectionId) => setSelected((s) => ({ ...s, [id]: !s[id] }));
  const setAll = (v: boolean) =>
    setSelected({ summary: v, low: v, out: v, all: v, insights: v, destinations: v });

  async function buildPdf(): Promise<Blob> {
    const dateLabel = format(new Date(), "d MMM yyyy");
    const timeLabel = format(new Date(), "HH:mm");
    const reference = `SR-${format(new Date(), "yyyyMMdd-HHmm")}`;

    const { html } = buildReportHtml({
      selected, products, lowList, outList,
      movements, rawMovements,
      reference, dateLabel, timeLabel,
    });

    // Ensure Geist fonts are loaded (one-shot, cached by the browser)
    if (!document.getElementById("rpt-geist-fonts")) {
      const link = document.createElement("link");
      link.id = "rpt-geist-fonts";
      link.rel = "stylesheet";
      link.href = "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600;700&display=swap";
      document.head.appendChild(link);
      try { await (document as any).fonts?.ready; } catch { /* noop */ }
    }

    // Mount offscreen for capture
    const holder = document.createElement("div");
    holder.style.cssText = "position:fixed;left:-10000px;top:0;background:#fff;";
    holder.innerHTML = html;
    document.body.appendChild(holder);
    // Allow layout / fonts / paint to settle
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try { await (document as any).fonts?.ready; } catch { /* noop */ }

    const pageEls = Array.from(holder.querySelectorAll<HTMLElement>(".rpt .page"));
    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const pageWmm = 210;
    const pageHmm = 297;

    try {
      for (let i = 0; i < pageEls.length; i++) {
        const canvas = await html2canvas(pageEls[i], {
          scale: 2,
          backgroundColor: "#ffffff",
          useCORS: true,
          logging: false,
        });
        const img = canvas.toDataURL("image/jpeg", 0.92);
        if (i > 0) pdf.addPage();
        pdf.addImage(img, "JPEG", 0, 0, pageWmm, pageHmm, undefined, "FAST");
      }
    } finally {
      document.body.removeChild(holder);
    }

    return pdf.output("blob");
  }

  async function generateAndUpload() {
    setBusy(true); setUrl(null);
    try {
      const blob = await buildPdf();
      const path = `${today}/stock-report-${Date.now()}.pdf`;
      const { error } = await supabase.storage.from("reports").upload(path, blob, {
        contentType: "application/pdf", upsert: false,
      });
      if (error) throw error;
      // Reports bucket is private; issue a signed URL (valid 7 days)
      const { data, error: signErr } = await supabase
        .storage.from("reports")
        .createSignedUrl(path, 60 * 60 * 24 * 7);
      if (signErr) throw signErr;
      setUrl(data.signedUrl);
      toast.success("Report generated and uploaded");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to generate report");
    } finally {
      setBusy(false);
    }
  }

  async function downloadLocal() {
    setBusy(true);
    try {
      const blob = await buildPdf();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `stock-report-${today}.pdf`;
    a.click();
    URL.revokeObjectURL(a.href);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to render report");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    toast.success("Link copied to clipboard");
  }

  async function smsLink() {
    if (!url) return;
    if (!/^\+[1-9]\d{1,14}$/.test(phone)) {
      toast.error("Enter a phone number in E.164 format (e.g. +15551234567)");
      return;
    }
    setSending(true);
    try {
      const r: any = await sendSms({ data: { phone, url, label: `Stock Report ${today}` } });
      if (r?.sent) toast.success("SMS sent with report link");
      else toast.error(`SMS failed${r?.reason ? ` (${r.reason})` : ""}`);
    } catch (e: any) {
      toast.error(e.message ?? "SMS failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setUrl(null); setPhone(""); } }}>
      <DialogTrigger asChild>
        <Button variant="ghost" className="rounded-xl h-9 px-3 text-sm font-medium">
          <Download className="size-4" />PDF report
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Generate report (PDF)</DialogTitle>
          <DialogDescription>
            Choose which sections to include. One PDF will be generated with only the selected sections.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-lg border border-border divide-y divide-border">
            <div className="flex items-center justify-between px-3 py-2 bg-muted/30">
              <span className="text-xs font-semibold uppercase text-muted-foreground">Sections</span>
              <div className="flex gap-3 text-xs">
                <button type="button" onClick={() => setAll(true)} className="text-primary hover:underline">All</button>
                <button type="button" onClick={() => setAll(false)} className="text-muted-foreground hover:underline">None</button>
              </div>
            </div>
            {SECTIONS.map((s) => (
              <label key={s.id} className="flex items-start gap-3 px-3 py-2 cursor-pointer hover:bg-muted/30">
                <Checkbox checked={selected[s.id]} onCheckedChange={() => toggle(s.id)} className="mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{s.label}</div>
                  <div className="text-xs text-muted-foreground">{s.desc}</div>
                </div>
              </label>
            ))}
          </div>

          <div className="flex gap-2">
            <Button onClick={generateAndUpload} disabled={busy || !anySelected} className="flex-1">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
              {url ? "Regenerate & upload" : "Generate & get link"}
            </Button>
            <Button variant="secondary" onClick={downloadLocal} disabled={!anySelected}>
              <Download className="size-4" />Download
            </Button>
          </div>

          {url && (
            <>
              <div>
                <Label className="text-xs">Shareable link</Label>
                <div className="flex gap-2">
                  <Input value={url} readOnly className="font-mono text-xs" />
                  <Button variant="secondary" onClick={copyLink}><Copy className="size-4" />Copy</Button>
                </div>
              </div>
              <div>
                <Label className="text-xs">Send link via SMS</Label>
                <div className="flex gap-2">
                  <Input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+15551234567"
                    className="font-mono"
                  />
                  <Button onClick={smsLink} disabled={sending || !phone}>
                    {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                    SMS
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  E.164 format (with country code). Uses your Twilio sender configured in Settings.
                </p>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}