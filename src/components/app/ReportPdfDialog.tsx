import { useState } from "react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
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

type Product = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  brand: string | null;
  stock: number;
  low_stock_threshold: number;
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

function renderGroupedByBrand(
  doc: jsPDF,
  list: Product[],
  startY: number,
  fillColor: [number, number, number],
  mode: "low" | "out" | "all",
) {
  if (!list.length) {
    autoTable(doc, {
      startY,
      head: [["Product", "SKU", "Barcode", "Category", "Stock", ...(mode === "out" ? [] : ["Status"])]],
      body: [["—", "—", "—", "—", "—", ...(mode === "out" ? [] : ["—"])]],
      headStyles: { fillColor },
      styles: { fontSize: 9 },
    });
    return;
  }
  const groups = new Map<string, Product[]>();
  for (const p of list) {
    const key = (p.brand ?? "").trim() || "Unbranded";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }
  const sortedBrands = [...groups.keys()].sort((a, b) => a.localeCompare(b));
  let y = startY;
  for (const brand of sortedBrands) {
    const items = groups.get(brand)!.sort((a, b) => a.name.localeCompare(b.name));
    const totalStock = items.reduce((a, p) => a + (p.stock ?? 0), 0);
    const head =
      mode === "out"
        ? [["Product", "SKU", "Barcode", "Category", "Stock"]]
        : [["Product", "SKU", "Barcode", "Category", "Stock", "Status"]];
    const body = items.map((p) => {
      const row = [
        p.name,
        p.sku ?? "—",
        p.barcode ?? "—",
        p.categories?.name ?? "—",
        String(p.stock),
      ];
      if (mode !== "out") {
        row.push(p.stock <= 0 ? "Out" : p.stock <= p.low_stock_threshold ? "Low" : "OK");
      }
      return row;
    });
    autoTable(doc, {
      startY: y,
      head: [[{ content: `${brand}  (${items.length} item${items.length === 1 ? "" : "s"}, ${totalStock} units)`, colSpan: head[0].length, styles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: "bold", halign: "left" } }]],
      body: [],
      styles: { fontSize: 10 },
      margin: { left: 40, right: 40 },
    });
    autoTable(doc, {
      head,
      body,
      headStyles: { fillColor },
      styles: { fontSize: 9 },
      margin: { left: 40, right: 40 },
    });
    y = (doc as any).lastAutoTable.finalY + 12;
  }
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

  function buildPdf(): Blob {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const generatedAt = format(new Date(), "PPpp");
    const totalStockUnits = products.reduce((a, p) => a + (p.stock ?? 0), 0);
    let firstPage = true;
    const newSection = (title: string, sub?: string) => {
      if (!firstPage) doc.addPage();
      firstPage = false;
      doc.setFontSize(20); doc.setTextColor(0); doc.text(title, 40, 60);
      if (sub) {
        doc.setFontSize(10); doc.setTextColor(120); doc.text(sub, 40, 80); doc.setTextColor(0);
      }
    };

    if (selected.summary) {
      newSection("Stock Report — Summary", `Generated: ${generatedAt}`);
      autoTable(doc, {
        startY: 110,
        head: [["Metric", "Value"]],
        body: [
          ["Total products", String(products.length)],
          ["Total stock units on hand", String(totalStockUnits)],
          ["Low stock items", String(lowList.length)],
          ["Out of stock items", String(outList.length)],
          ["Total stock-in (last 500 movements)", String(movements.inQty)],
          ["Total stock-out (last 500 movements)", String(movements.outQty)],
          ["Net movement", String(movements.inQty - movements.outQty)],
        ],
        headStyles: { fillColor: [37, 99, 235] },
        styles: { fontSize: 11 },
      });
    }

    if (selected.low) {
      newSection("Low Stock", `${lowList.length} item(s) at or below threshold`);
      renderGroupedByBrand(doc, lowList, 100, [202, 138, 4], "low");
    }

    if (selected.out) {
      newSection("Out of Stock", `${outList.length} item(s) with zero stock`);
      renderGroupedByBrand(doc, outList, 100, [220, 38, 38], "out");
    }

    if (selected.all) {
      newSection("All Products — Stock Counts", `${products.length} product(s), total ${totalStockUnits} units`);
      renderGroupedByBrand(doc, products, 100, [37, 99, 235], "all");
    }

    if (selected.insights) {
      // Top moved products by quantity
      const moveByProduct = new Map<string, { name: string; in: number; out: number }>();
      for (const m of rawMovements) {
        const name = m.products?.name ?? "—";
        const cur = moveByProduct.get(name) ?? { name, in: 0, out: 0 };
        if (m.type === "in") cur.in += m.quantity; else cur.out += m.quantity;
        moveByProduct.set(name, cur);
      }
      const topOut = [...moveByProduct.values()].sort((a, b) => b.out - a.out).slice(0, 10);
      const topIn = [...moveByProduct.values()].sort((a, b) => b.in - a.in).slice(0, 10);
      const healthy = products.length - lowList.length - outList.length;
      const stockHealthPct = products.length ? Math.round((healthy / products.length) * 100) : 0;

      newSection("Insights", `Stock health: ${stockHealthPct}% healthy · ${lowList.length} low · ${outList.length} out`);
      autoTable(doc, {
        startY: 100,
        head: [["Indicator", "Value"]],
        body: [
          ["Healthy products", `${healthy} (${stockHealthPct}%)`],
          ["Low stock products", String(lowList.length)],
          ["Out of stock products", String(outList.length)],
          ["Total movements analysed", String(rawMovements.length)],
          ["Net stock change", String(movements.inQty - movements.outQty)],
          ["Avg stock per product", products.length ? (totalStockUnits / products.length).toFixed(1) : "0"],
        ],
        headStyles: { fillColor: [99, 102, 241] },
        styles: { fontSize: 11 },
      });
      autoTable(doc, {
        head: [["Top 10 — Most Stock OUT", "Qty"]],
        body: topOut.length ? topOut.map((p) => [p.name, String(p.out)]) : [["—", "—"]],
        headStyles: { fillColor: [220, 38, 38] },
        styles: { fontSize: 10 },
      });
      autoTable(doc, {
        head: [["Top 10 — Most Stock IN", "Qty"]],
        body: topIn.length ? topIn.map((p) => [p.name, String(p.in)]) : [["—", "—"]],
        headStyles: { fillColor: [22, 163, 74] },
        styles: { fontSize: 10 },
      });
    }

    if (selected.destinations) {
      const byDest = new Map<string, { qty: number; count: number; products: Set<string> }>();
      for (const m of rawMovements) {
        if (m.type !== "out") continue;
        const dest = (m.destination ?? "").trim() || "Unspecified";
        const cur = byDest.get(dest) ?? { qty: 0, count: 0, products: new Set() };
        cur.qty += m.quantity;
        cur.count += 1;
        if (m.products?.name) cur.products.add(m.products.name);
        byDest.set(dest, cur);
      }
      const rows = [...byDest.entries()]
        .map(([dest, v]) => ({ dest, qty: v.qty, count: v.count, products: v.products.size }))
        .sort((a, b) => b.qty - a.qty);
      const totalOut = rows.reduce((a, r) => a + r.qty, 0);

      newSection("Movement Destinations", `Where ${totalOut} unit(s) of stock-out went (last ${rawMovements.length} movements)`);
      autoTable(doc, {
        startY: 100,
        head: [["Destination", "Total qty out", "Movements", "Distinct products", "Share"]],
        body: rows.length
          ? rows.map((r) => [
              r.dest, String(r.qty), String(r.count), String(r.products),
              totalOut ? `${((r.qty / totalOut) * 100).toFixed(1)}%` : "—",
            ])
          : [["—", "—", "—", "—", "—"]],
        headStyles: { fillColor: [37, 99, 235] },
        styles: { fontSize: 10 },
      });
    }

    if (firstPage) {
      // Nothing was added (shouldn't happen because button is disabled)
      newSection("Stock Report", "No sections selected.");
    }

    // Footer page numbers
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(9); doc.setTextColor(150);
      doc.text(`Page ${i} / ${pageCount}`, pageW - 70, doc.internal.pageSize.getHeight() - 20);
    }

    return doc.output("blob");
  }

  async function generateAndUpload() {
    setBusy(true); setUrl(null);
    try {
      const blob = buildPdf();
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

  function downloadLocal() {
    const blob = buildPdf();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `stock-report-${today}.pdf`;
    a.click();
    URL.revokeObjectURL(a.href);
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