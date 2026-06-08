import { useState } from "react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { format } from "date-fns";
import { useServerFn } from "@/lib/use-server-fn";
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
  price?: number | null;
  rack?: string | null;
  shelf?: string | null;
  origin?: string | null;
  size?: string | null;
  unit?: string | null;
  pcs_per_case?: number | null;
  categories?: { name: string | null } | null;
  category_id?: string | null;
  main_category?: string | null;
  report_category?: string | null;
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

const fmtNum = (n: number) => n.toLocaleString("en-US");
const fmtYen = (n: number) => {
  if (!isFinite(n) || n <= 0) return "¥0";
  if (n >= 1000) return `¥${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return `¥${Math.round(n)}`;
};

function categoryOf(p: Product): string {
  return p.report_category || p.categories?.name || "Uncategorized";
}

function displaySize(p: Product): string {
  const size = (p.size ?? "").trim();
  const unit = (p.unit ?? "").trim();
  if (!size && !unit) return "";
  if (!size) return unit;
  return /[a-zA-Z]$/.test(size) ? size : `${size}${unit ? unit : ""}`;
}

function rackLabel(p: Product) {
  const rack = (p.rack ?? "").trim();
  const shelf = (p.shelf ?? "").trim().toUpperCase();
  if (!rack && !shelf) return "";
  if (!rack) return shelf;
  if (!shelf) return rack;
  return `${rack}/${shelf}`;
}

function addLiteHeader(pdf: jsPDF, title: string, reference: string) {
  pdf.setFillColor(14, 124, 112);
  pdf.rect(0, 0, 210, 22, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(15);
  pdf.text(title, 12, 14);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.text(reference, 158, 14);
  pdf.setTextColor(10, 19, 32);
}

function addLiteFooter(pdf: jsPDF, reference: string) {
  const pageCount = pdf.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    pdf.setPage(i);
    pdf.setTextColor(138, 153, 171);
    pdf.setFontSize(7);
    pdf.text(`CITYSTAR INVENTORY · ${reference}`, 12, 289);
    pdf.text(`Page ${i} / ${pageCount}`, 184, 289);
  }
}

function statusText(p: Product): string {
  if (p.stock <= 0) return "OUT";
  if (p.stock <= p.low_stock_threshold) return "LOW";
  return "OK";
}

function compactProductRows(list: Product[]) {
  return list.map((p) => [
    p.name,
    p.sku ?? "",
    (p.brand ?? "").toUpperCase(),
    displaySize(p) || "",
    rackLabel(p),
    fmtNum(p.stock ?? 0),
    statusText(p),
  ]);
}

function buildLiteReportPdf(opts: {
  selected: Record<SectionId, boolean>;
  products: Product[];
  lowList: Product[];
  outList: Product[];
  movements: Movements;
  rawMovements: RawMovement[];
  reference: string;
  dateLabel: string;
  timeLabel: string;
}): Blob {
  const { selected, products, lowList, outList, movements, rawMovements, reference, dateLabel, timeLabel } = opts;
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const totalUnits = products.reduce((a, p) => a + (p.stock ?? 0), 0);
  const totalValue = products.reduce((a, p) => a + (p.stock ?? 0) * Number(p.price ?? 0), 0);
  let y = 32;

  addLiteHeader(pdf, "Stock Report", reference);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.text(`Generated: ${dateLabel} ${timeLabel}`, 12, y);
  y += 8;

  if (selected.summary) {
    autoTable(pdf, {
      startY: y,
      theme: "grid",
      head: [["Metric", "Value"]],
      body: [
        ["Products", fmtNum(products.length)],
        ["Total stock units", fmtNum(totalUnits)],
        ["Low stock", fmtNum(lowList.length)],
        ["Out of stock", fmtNum(outList.length)],
        ["Estimated stock value", fmtYen(totalValue)],
        ["Stock in", fmtNum(movements.inQty)],
        ["Stock out", fmtNum(movements.outQty)],
      ],
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [14, 124, 112] },
      margin: { left: 12, right: 12 },
    });
    y = ((pdf as any).lastAutoTable?.finalY ?? y) + 8;
  }

  const addProductTable = (title: string, list: Product[]) => {
    if (y > 240) {
      pdf.addPage();
      addLiteHeader(pdf, title, reference);
      y = 32;
    }
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(12);
    pdf.text(title, 12, y);
    y += 5;
    autoTable(pdf, {
      startY: y,
      theme: "striped",
      head: [["Product", "SKU", "Brand", "Size", "Rack", "Stock", "Status"]],
      body: compactProductRows(list),
      styles: { fontSize: 6.7, cellPadding: 1.5, overflow: "linebreak" },
      headStyles: { fillColor: [14, 124, 112], fontSize: 6.5 },
      columnStyles: {
        0: { cellWidth: 70 },
        1: { cellWidth: 24 },
        2: { cellWidth: 32 },
        3: { cellWidth: 18 },
        4: { cellWidth: 18 },
        5: { cellWidth: 18, halign: "right" },
        6: { cellWidth: 18 },
      },
      margin: { left: 8, right: 8 },
    });
    y = ((pdf as any).lastAutoTable?.finalY ?? y) + 8;
  };

  if (selected.low) addProductTable("Low Stock Products", lowList);
  if (selected.out) addProductTable("Out Of Stock Products", outList);
  if (selected.all) addProductTable("All Products", products);

  if (selected.destinations && rawMovements.length > 0) {
    if (y > 225) {
      pdf.addPage();
      addLiteHeader(pdf, "Movement Destinations", reference);
      y = 32;
    }
    autoTable(pdf, {
      startY: y,
      theme: "striped",
      head: [["Date", "Type", "Product", "Qty", "Destination"]],
      body: rawMovements.slice(0, 150).map((m) => [
        format(new Date(m.created_at), "yyyy-MM-dd HH:mm"),
        m.type.toUpperCase(),
        m.products?.name ?? "",
        fmtNum(m.quantity),
        m.destination ?? "",
      ]),
      styles: { fontSize: 7, cellPadding: 1.5, overflow: "linebreak" },
      headStyles: { fillColor: [14, 124, 112] },
      margin: { left: 10, right: 10 },
    });
  }

  addLiteFooter(pdf, reference);
  return pdf.output("blob");
}

export function ReportPdfDialog({
  products, lowList, outList, movements, rawMovements = [],
  triggerLabel = "PDF report",
  triggerClassName,
  triggerDisabled = false,
  defaultSelected,
}: {
  products: Product[];
  lowList: Product[];
  outList: Product[];
  movements: Movements;
  rawMovements?: RawMovement[];
  triggerLabel?: string;
  triggerClassName?: string;
  triggerDisabled?: boolean;
  defaultSelected?: Partial<Record<SectionId, boolean>>;
}) {
  const initialSelected: Record<SectionId, boolean> = {
    summary: true, low: true, out: true, all: true, insights: true, destinations: true,
    ...defaultSelected,
  };
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);
  const [selected, setSelected] = useState<Record<SectionId, boolean>>(initialSelected);
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

    return buildLiteReportPdf({
      selected, products, lowList, outList,
      movements, rawMovements,
      reference, dateLabel, timeLabel,
    });
  }

  async function generateAndUpload() {
    setBusy(true); setUrl(null);
    try {
      const blob = await buildPdf();
      const path = `${today}/stock-report-${Date.now()}.pdf`;
      const { error } = await supabase.storage.from("reports").upload(path, blob, {
        contentType: "application/pdf", upsert: false,
      });
      if (error) {
        if (error.message?.toLowerCase().includes("bucket") || error.message?.toLowerCase().includes("not found")) {
          toast.error('Storage bucket "reports" not found. Create it in Supabase → Storage, then retry. For now use Download instead.');
        } else {
          toast.error(`Upload failed: ${error.message}`);
        }
        return;
      }
      const { data, error: signErr } = await supabase
        .storage.from("reports")
        .createSignedUrl(path, 60 * 60 * 24 * 7);
      if (signErr) throw signErr;
      setUrl(data.signedUrl);
      toast.success("Report generated — link valid for 7 days");
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
        <Button variant="ghost" disabled={triggerDisabled} className={triggerClassName ?? "rounded-xl h-9 px-3 text-sm font-medium"}>
          <Download className="size-4" />{triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[92dvh] overflow-hidden p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border">
          <DialogTitle>Generate report (PDF)</DialogTitle>
          <DialogDescription>
            Lite PDF mode creates faster table reports with only selected sections.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 overflow-y-auto px-5 py-4 max-h-[calc(92dvh-168px)]">
          <div className="rounded-lg border border-border divide-y divide-border">
            <div className="sticky top-0 z-10 flex items-center justify-between px-3 py-2 bg-muted">
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

        <DialogFooter className="sticky bottom-0 border-t border-border bg-background px-5 py-3 gap-2 sm:space-x-0">
          <Button onClick={generateAndUpload} disabled={busy || !anySelected} className="flex-1">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
            {url ? "Regenerate link" : "Get link"}
          </Button>
          <Button variant="secondary" onClick={downloadLocal} disabled={busy || !anySelected}>
            <Download className="size-4" />Download PDF
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
