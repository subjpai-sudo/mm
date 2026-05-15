import { useState } from "react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { format } from "date-fns";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FileText, Copy, Send, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { sendReportLinkSms } from "@/lib/notifications.functions";

type Product = {
  id: string;
  name: string;
  sku: string | null;
  stock: number;
  low_stock_threshold: number;
  categories?: { name: string | null } | null;
};

type Movements = { inQty: number; outQty: number; total: number };

export function ReportPdfDialog({
  products, lowList, outList, movements,
}: {
  products: Product[];
  lowList: Product[];
  outList: Product[];
  movements: Movements;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);
  const sendSms = useServerFn(sendReportLinkSms);

  const today = format(new Date(), "yyyy-MM-dd");

  function buildPdf(): Blob {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const generatedAt = format(new Date(), "PPpp");
    const totalStockUnits = products.reduce((a, p) => a + (p.stock ?? 0), 0);

    // ---- Page 1: Summary ----
    doc.setFontSize(20); doc.text("Stock Report", 40, 60);
    doc.setFontSize(10); doc.setTextColor(120);
    doc.text(`Generated: ${generatedAt}`, 40, 80);
    doc.setTextColor(0);

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

    // ---- Page 2: Low stock ----
    doc.addPage();
    doc.setFontSize(16); doc.text("Low Stock", 40, 50);
    doc.setFontSize(10); doc.setTextColor(120);
    doc.text(`${lowList.length} item(s) at or below threshold`, 40, 68);
    doc.setTextColor(0);
    autoTable(doc, {
      startY: 90,
      head: [["Product", "SKU", "Category", "Stock", "Threshold"]],
      body: lowList.length
        ? lowList.map((p) => [
            p.name, p.sku ?? "—", p.categories?.name ?? "—",
            String(p.stock), String(p.low_stock_threshold),
          ])
        : [["—", "—", "—", "—", "—"]],
      headStyles: { fillColor: [202, 138, 4] },
    });

    // ---- Page 3: Out of stock ----
    doc.addPage();
    doc.setFontSize(16); doc.text("Out of Stock", 40, 50);
    doc.setFontSize(10); doc.setTextColor(120);
    doc.text(`${outList.length} item(s) with zero stock`, 40, 68);
    doc.setTextColor(0);
    autoTable(doc, {
      startY: 90,
      head: [["Product", "SKU", "Category", "Threshold"]],
      body: outList.length
        ? outList.map((p) => [p.name, p.sku ?? "—", p.categories?.name ?? "—", String(p.low_stock_threshold)])
        : [["—", "—", "—", "—"]],
      headStyles: { fillColor: [220, 38, 38] },
    });

    // ---- Page 4: All products with stock ----
    doc.addPage();
    doc.setFontSize(16); doc.text("All Products – Stock Counts", 40, 50);
    doc.setFontSize(10); doc.setTextColor(120);
    doc.text(`${products.length} product(s), total ${totalStockUnits} units`, 40, 68);
    doc.setTextColor(0);
    autoTable(doc, {
      startY: 90,
      head: [["Product", "SKU", "Category", "Stock", "Threshold", "Status"]],
      body: products.map((p) => [
        p.name, p.sku ?? "—", p.categories?.name ?? "—",
        String(p.stock), String(p.low_stock_threshold),
        p.stock <= 0 ? "Out" : p.stock <= p.low_stock_threshold ? "Low" : "OK",
      ]),
      headStyles: { fillColor: [37, 99, 235] },
      styles: { fontSize: 9 },
    });

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
      const { data } = supabase.storage.from("reports").getPublicUrl(path);
      setUrl(data.publicUrl);
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
        <Button className="gradient-primary text-primary-foreground border-0">
          <FileText className="size-4" />Generate PDF report
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Stock report (PDF)</DialogTitle>
          <DialogDescription>
            Multi-page PDF: summary, low stock, out of stock, and full product list with stock counts.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex gap-2">
            <Button onClick={generateAndUpload} disabled={busy} className="flex-1">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
              {url ? "Regenerate & upload" : "Generate & get link"}
            </Button>
            <Button variant="secondary" onClick={downloadLocal}>
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