import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import {
  fbGetStores, fbGetCustomers, fbGetInvoices, fbDeleteInvoice,
  type BillingStore, type BillingCustomer, type BillingInvoice,
} from "@/integrations/firebase/billing";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { format, startOfWeek, endOfWeek } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ChevronDown, ChevronRight, Store, Truck, Receipt,
  Eye, Printer, ArrowRight, Search, FileText,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/billing-history")({ component: BillingHistoryPage });

// ── Types ─────────────────────────────────────────────────────────────────────
type SavedInvoice = BillingInvoice;

const fmt = (n: number) => n.toLocaleString("ja-JP");

function groupByMonthWeek(invs: SavedInvoice[]) {
  const sorted = [...invs].sort((a, b) => b.date.localeCompare(a.date));
  const byMonth = new Map<string, Map<string, SavedInvoice[]>>();
  sorted.forEach(inv => {
    const d = new Date(inv.date + "T00:00:00");
    const monthKey = format(d, "yyyy-MM");
    const ws  = startOfWeek(d, { weekStartsOn: 1 });
    const we  = endOfWeek(d, { weekStartsOn: 1 });
    const wk  = `${format(ws, "MMM d")}–${format(we, "MMM d")}`;
    if (!byMonth.has(monthKey)) byMonth.set(monthKey, new Map());
    const m = byMonth.get(monthKey)!;
    if (!m.has(wk)) m.set(wk, []);
    m.get(wk)!.push(inv);
  });
  return byMonth;
}

// ── Standalone print/PDF function ─────────────────────────────────────────────
function printInvoice(inv: SavedInvoice, stores: BillingStore[], customers: BillingCustomer[]) {
  const stampB64     = localStorage.getItem("billing-stamp-b64") ?? "";
  const issuingStore = stores.find(s => s.id === inv.store_id) ?? null;
  const billToStore  = stores.find(s => s.id === inv.bill_to_store_id) ?? null;
  const billToCust   = customers.find(c => c.id === inv.customer_id) ?? null;

  const coName = issuingStore
    ? `${issuingStore.name}${issuingStore.sub ? ` — ${issuingStore.sub}` : ""}`
    : "CITY STAR 株式会社";
  const coAddrLines = issuingStore
    ? [issuingStore.zip ? `〒${issuingStore.zip}` : "", issuingStore.address ?? "", issuingStore.tel ? `TELL＝${issuingStore.tel}` : "", "FAX＝03-6903-6175", "MOBIL＝080-4243-8646", "T-5120901035433"].filter(Boolean)
    : ["東京都豊島区北大塚3-32-3-201", "TELL＝03-6903-6174", "FAX＝03-6903-6175", "MOBIL＝080-4243-8646", "T-5120901035433"];

  const billToName = inv.bill_to_type === "customer"
    ? (billToCust?.company || billToCust?.name || "—")
    : (billToStore ? `${billToStore.name}${billToStore.sub ? ` — ${billToStore.sub}` : ""}` : "—");
  const billToAddr = inv.bill_to_type === "customer" ? (billToCust?.address ?? "") : (billToStore?.address ?? "");
  const billToTel  = inv.bill_to_type === "customer" ? (billToCust?.tel ?? "") : (billToStore?.tel ?? "");
  const billToZip  = inv.bill_to_type === "store" ? (billToStore?.zip ?? "") : "";
  const custAddrFull = [billToZip ? `〒${billToZip}` : "", billToAddr].filter(Boolean).join(" ");

  const discountPct = inv.discount;
  const discountAmt = Math.round(inv.subtotal * discountPct / 100);
  const items       = Array.isArray(inv.items) ? inv.items : [];
  const qtyLabel    = (it: any) => it.pcs_per_case && it.pcs_per_case > 1 ? `${it.qty} Case` : String(it.qty);
  const unitLabel   = (it: any) => it.pcs_per_case && it.pcs_per_case > 1 ? `${it.qty * it.pcs_per_case}pcs` : "PCS";
  const itemNo      = (it: any, idx: number) => it.sku || it.barcode || String(idx + 1);

  const w = window.open("", "_blank", "width=840,height=1160");
  if (!w) { alert("Popup blocked — allow popups for this site"); return; }

  const RPP = 20;
  const filled = items.filter((i: any) => i.name);
  const pages: any[][] = [];
  for (let i = 0; i < filled.length; i += RPP) pages.push(filled.slice(i, i + RPP));
  if (!pages.length) pages.push([]);

  const pagesHtml = pages.map((pg, pi) => {
    const isLast    = pi === pages.length - 1;
    const emptyRows = Math.max(0, RPP - pg.length);
    return `<div class="inv-page">
<table class="inv-top"><tr>
  <td class="co-text"><div class="co-name">${coName}</div><div class="co-addr">${coAddrLines.join("<br>")}</div></td>
  <td class="stamp-cell">${stampB64 ? `<img src="${stampB64}" style="width:80px;height:auto;max-height:80px;object-fit:contain;opacity:.92" alt="stamp">` : ""}</td>
</tr></table>
<hr class="divider">
<table class="inv-cust"><tr>
  <td class="cust-left">
    <div class="cust-name">CUSTOMER:&nbsp;&nbsp;${billToName}</div>
    <div class="cust-detail">DETAILS:&nbsp;&nbsp;${custAddrFull || "—"}</div>
    ${billToTel ? `<div class="cust-detail">${billToTel}</div>` : ""}
  </td>
  <td class="meta-right">
    <table class="meta-tbl">
      <tr><td class="mk">DATE</td><td class="mv">${inv.date}</td></tr>
      <tr><td class="mk">INVOICE NO:</td><td class="mv">${inv.invoice_no || "—"}</td></tr>
    </table>
  </td>
</tr></table>
${pi === 0 ? `<div class="grand-banner">GRAND TOTAL :&nbsp;&nbsp;¥ ${fmt(inv.total)}</div>` : ""}
<div class="inv-title">INVOICE</div>
<table class="inv-table">
  <colgroup><col style="width:34px"><col style="width:62px"><col><col style="width:58px"><col style="width:58px"><col style="width:84px"><col style="width:84px"></colgroup>
  <thead><tr><th>S.NO</th><th>ITEM NO</th><th class="tleft">PRODUCT NAME</th><th>QNT</th><th>UNIT</th><th>UNIT PRICE</th><th>AMOUNT</th></tr></thead>
  <tbody>
    ${pg.map((it: any, i: number) => `<tr>
      <td class="tc">${pi * RPP + i + 1}</td>
      <td class="tc mono">${itemNo(it, pi * RPP + i)}</td>
      <td class="tname">${it.name}</td>
      <td class="tc">${qtyLabel(it)}</td>
      <td class="tc">${unitLabel(it)}</td>
      <td class="tr2">¥${fmt(it.price)}</td>
      <td class="tr2">¥${fmt(it.qty * it.price)}</td>
    </tr>`).join("")}
    ${Array(emptyRows).fill(`<tr class="erow"><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`).join("")}
  </tbody>
</table>
${isLast ? `<table class="inv-foot"><tr>
  <td class="bank">シティスター株式会社<br>ゆうちょ銀行　11370-03843431<br>マツモト</td>
  <td class="tot-wrap"><table class="tot-tbl">
    <tr><td class="tl">TOTAL</td><td class="tv">¥${fmt(inv.subtotal)}</td></tr>
    ${discountAmt > 0 ? `<tr><td class="tl">DISCOUNT (${discountPct}%)</td><td class="tv" style="color:#e53e3e">−¥${fmt(discountAmt)}</td></tr>` : ""}
    ${inv.tax_rate > 0 ? `<tr><td class="tl">TAX (${inv.tax_rate}%)</td><td class="tv">¥${fmt(inv.tax)}</td></tr>` : ""}
    <tr><td class="tg">TOTAL</td><td class="tgv">¥${fmt(inv.total)}</td></tr>
  </table></td>
</tr></table>` : ""}
</div>`;
  }).join("");

  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invoice ${inv.invoice_no || inv.id}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
body{font-family:Arial,'Yu Gothic','游ゴシック',sans-serif;font-size:11px;color:#111;background:#fff;padding:12px 14px}
@page{size:A4;margin:10mm 12mm}
.inv-page{width:100%;page-break-after:always}.inv-page:last-child{page-break-after:avoid}
.inv-top{width:100%;border-collapse:collapse;margin-bottom:5px}
.co-text{text-align:right;vertical-align:top;padding-right:10px}
.stamp-cell{width:84px;vertical-align:top;text-align:center}
.co-name{font-size:19px;font-weight:700;line-height:1.2}
.co-addr{font-size:9.5px;line-height:1.7;margin-top:2px;color:#333}
hr.divider{border:none;border-top:2px solid #111;margin:5px 0}
.inv-cust{width:100%;border-collapse:collapse;margin-bottom:5px}
.cust-left{vertical-align:top}.meta-right{vertical-align:top;text-align:right;white-space:nowrap}
.cust-name{font-size:13px;font-weight:700;margin-bottom:2px}
.cust-detail{font-size:10px;color:#333;line-height:1.6}
.meta-tbl{border-collapse:collapse;margin-left:auto;font-size:11px}
.meta-tbl td{padding:1px 4px}.mk{font-weight:600;text-align:right;padding-right:6px}.mv{font-weight:700}
.grand-banner{background:#cc0000;color:#fff;text-align:center;padding:7px 10px;font-size:16px;font-weight:900;letter-spacing:2px;margin:4px 0}
.inv-title{text-align:center;font-size:22px;font-weight:900;letter-spacing:6px;border-top:2px solid #111;border-bottom:2px solid #111;padding:5px 0;margin:5px 0 6px}
.inv-table{width:100%;border-collapse:collapse;font-size:10px;table-layout:fixed}
.inv-table th{background:#1F4E79;color:#fff;padding:5px 4px;text-align:center;border:1px solid #1F4E79;font-weight:700;overflow:hidden}
.inv-table th.tleft{text-align:left}
.inv-table td{padding:3px 4px;border:1px solid #bbb;height:19px;vertical-align:middle;overflow:hidden}
.inv-table td.tc{text-align:center}.inv-table td.tr2{text-align:right}
.inv-table td.mono{font-family:monospace;font-size:9px;text-align:center}
.inv-table td.tname{text-align:left;word-break:break-word;overflow-wrap:break-word;white-space:normal}
.inv-table tr.erow td{height:19px}
.inv-foot{width:100%;border-collapse:collapse;margin-top:8px}
.bank{vertical-align:bottom;font-size:10px;color:#333;line-height:1.8}
.tot-wrap{vertical-align:bottom;text-align:right;width:1px;white-space:nowrap;padding-left:16px}
.tot-tbl{border-collapse:collapse;font-size:11px}
.tot-tbl td{padding:4px 12px;border:1px solid #bbb}
.tl{background:#f0f0f0!important;font-weight:600;text-align:right;white-space:nowrap}
.tv{text-align:right;min-width:110px;font-weight:600}
.tg{background:#1F4E79!important;color:#fff!important;font-weight:700;text-align:right;white-space:nowrap}
.tgv{font-weight:700;font-size:13px;text-align:right;color:#1F4E79}
</style></head><body>${pagesHtml}</body></html>`);
  w.document.close();
  const imgs = w.document.querySelectorAll("img");
  if (!imgs.length) { setTimeout(() => { w.focus(); w.print(); }, 250); return; }
  let loaded = 0;
  const tryPrint = () => { if (++loaded === imgs.length) { setTimeout(() => { w.focus(); w.print(); }, 100); } };
  imgs.forEach((img: any) => { if (img.complete) tryPrint(); else { img.onload = tryPrint; img.onerror = tryPrint; } });
}

// ── Invoice Detail Modal ───────────────────────────────────────────────────────
function InvoiceDetailModal({ inv, stores, customers, onClose }: {
  inv: SavedInvoice; stores: BillingStore[]; customers: BillingCustomer[]; onClose: () => void;
}) {
  const nav      = useNavigate();
  const stampB64 = localStorage.getItem("billing-stamp-b64") ?? "";

  const issuingStore   = stores.find(s => s.id === inv.store_id) ?? null;
  const billToStore    = stores.find(s => s.id === inv.bill_to_store_id) ?? null;
  const billToCustomer = customers.find(c => c.id === inv.customer_id) ?? null;

  const billToName = inv.bill_to_type === "customer"
    ? (billToCustomer?.company || billToCustomer?.name || "—")
    : (billToStore ? `${billToStore.name}${billToStore.sub ? ` — ${billToStore.sub}` : ""}` : "—");
  const billToAddr = inv.bill_to_type === "customer" ? (billToCustomer?.address ?? "") : (billToStore?.address ?? "");
  const billToTel  = inv.bill_to_type === "customer" ? (billToCustomer?.tel ?? "")     : (billToStore?.tel ?? "");
  const billToZip  = inv.bill_to_type === "store"    ? (billToStore?.zip ?? "")         : "";

  const coName = issuingStore
    ? `${issuingStore.name}${issuingStore.sub ? ` — ${issuingStore.sub}` : ""}`
    : "CITY STAR 株式会社";
  const coAddrLines = issuingStore
    ? [issuingStore.zip ? `〒${issuingStore.zip}` : "", issuingStore.address ?? "", issuingStore.tel ? `TELL＝${issuingStore.tel}` : "", "FAX＝03-6903-6175", "MOBIL＝080-4243-8646", "T-5120901035433"].filter(Boolean)
    : ["東京都豊島区北大塚3-32-3-201", "TELL＝03-6903-6174", "FAX＝03-6903-6175", "MOBIL＝080-4243-8646", "T-5120901035433"];

  const custAddrFull = [billToZip ? `〒${billToZip}` : "", billToAddr].filter(Boolean).join(" ");
  const discountPct  = inv.discount;
  const discountAmt  = Math.round(inv.subtotal * discountPct / 100);
  const items        = Array.isArray(inv.items) ? inv.items : [];

  const qtyLabel  = (it: any) => it.pcs_per_case && it.pcs_per_case > 1 ? `${it.qty} Case` : String(it.qty);
  const unitLabel = (it: any) => it.pcs_per_case && it.pcs_per_case > 1 ? `${it.qty * it.pcs_per_case}pcs` : "PCS";
  const itemNo    = (it: any, idx: number) => it.sku || it.barcode || String(idx + 1);

  function loadInBilling() {
    localStorage.setItem("billing-reload-inv", JSON.stringify(inv));
    nav({ to: "/billing" });
    onClose();
  }

  const thS = { background: "#1F4E79", color: "#fff", padding: "5px 4px", border: "1px solid #1F4E79", fontSize: 10, fontWeight: 700, textAlign: "center" as const };
  const tdS = { padding: "3px 4px", border: "1px solid #bbb", height: 19, verticalAlign: "middle" as const };
  const emptyPad = Math.max(0, 8 - items.length);

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            <span className="font-mono">{inv.invoice_no || "Invoice"}</span>
            <span className="ml-3 text-sm font-normal text-muted-foreground">{inv.date}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="bg-white rounded border border-border p-4 text-black text-[11px]" style={{ fontFamily: "Arial,'Yu Gothic',sans-serif" }}>
          {/* Company header */}
          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "flex-start", gap: 10, marginBottom: 5 }}>
            <div style={{ textAlign: "right", flex: 1 }}>
              <div style={{ fontSize: 19, fontWeight: 700, lineHeight: 1.2 }}>{coName}</div>
              <div style={{ fontSize: 9.5, color: "#333", lineHeight: 1.7, marginTop: 2 }}>
                {coAddrLines.map((l, i) => <span key={i}>{l}{i < coAddrLines.length - 1 && <br />}</span>)}
              </div>
            </div>
            <div style={{ width: 82, height: 74, flexShrink: 0 }}>
              {stampB64 && <img src={stampB64} style={{ width: "100%", height: "100%", objectFit: "contain", opacity: 0.92 }} alt="stamp" />}
            </div>
          </div>
          <hr style={{ border: "none", borderTop: "2px solid #111", margin: "5px 0" }} />

          {/* Customer + meta */}
          <div style={{ display: "flex", gap: 12, marginBottom: 5 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>CUSTOMER:&nbsp;&nbsp;{billToName}</div>
              <div style={{ fontSize: 10, color: "#333", lineHeight: 1.6 }}>DETAILS:&nbsp;&nbsp;{custAddrFull || "—"}</div>
              {billToTel && <div style={{ fontSize: 10, color: "#333" }}>{billToTel}</div>}
            </div>
            <table style={{ borderCollapse: "collapse", fontSize: 11, marginLeft: "auto" }}>
              <tbody>
                <tr><td style={{ fontWeight: 600, paddingRight: 6 }}>DATE</td><td style={{ fontWeight: 700 }}>{inv.date}</td></tr>
                <tr><td style={{ fontWeight: 600, paddingRight: 6 }}>INVOICE NO:</td><td style={{ fontWeight: 700 }}>{inv.invoice_no || "—"}</td></tr>
              </tbody>
            </table>
          </div>

          {/* Grand total banner */}
          <div style={{ background: "#cc0000", color: "#fff", textAlign: "center", padding: "7px 10px", fontSize: 16, fontWeight: 900, letterSpacing: 2, margin: "4px 0" }}>
            GRAND TOTAL :&nbsp;&nbsp;¥ {fmt(inv.total)}
          </div>
          <div style={{ textAlign: "center", fontSize: 22, fontWeight: 900, letterSpacing: 6, borderTop: "2px solid #111", borderBottom: "2px solid #111", padding: "5px 0", margin: "5px 0 6px" }}>
            INVOICE
          </div>

          {/* Items table */}
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: 34 }} /><col style={{ width: 62 }} /><col /><col style={{ width: 58 }} /><col style={{ width: 58 }} /><col style={{ width: 84 }} /><col style={{ width: 84 }} />
            </colgroup>
            <thead>
              <tr>
                {["S.NO","ITEM NO","PRODUCT NAME","QNT","UNIT","UNIT PRICE","AMOUNT"].map((h, i) => (
                  <th key={h} style={{ ...thS, textAlign: i === 2 ? "left" : "center" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((it: any, i: number) => (
                <tr key={i}>
                  <td style={{ ...tdS, textAlign: "center" }}>{i + 1}</td>
                  <td style={{ ...tdS, textAlign: "center", fontFamily: "monospace", fontSize: 9 }}>{itemNo(it, i)}</td>
                  <td style={{ ...tdS, wordBreak: "break-word", overflowWrap: "break-word", whiteSpace: "normal" }}>{it.name}</td>
                  <td style={{ ...tdS, textAlign: "center" }}>{qtyLabel(it)}</td>
                  <td style={{ ...tdS, textAlign: "center" }}>{unitLabel(it)}</td>
                  <td style={{ ...tdS, textAlign: "right" }}>¥{fmt(it.price)}</td>
                  <td style={{ ...tdS, textAlign: "right" }}>¥{fmt(it.qty * it.price)}</td>
                </tr>
              ))}
              {Array.from({ length: emptyPad }).map((_, i) => (
                <tr key={`e${i}`}>{Array.from({ length: 7 }).map((__, j) => <td key={j} style={tdS} />)}</tr>
              ))}
            </tbody>
          </table>

          {/* Footer */}
          <div style={{ marginTop: 8, display: "flex", alignItems: "flex-end", gap: 12 }}>
            <div style={{ flex: 1, fontSize: 10, color: "#333", lineHeight: 1.8 }}>
              シティスター株式会社<br />ゆうちょ銀行　11370-03843431<br />マツモト
            </div>
            <table style={{ borderCollapse: "collapse", fontSize: 11, marginLeft: "auto" }}>
              <tbody>
                <tr>
                  <td style={{ background: "#f0f0f0", fontWeight: 600, textAlign: "right", padding: "4px 10px", border: "1px solid #bbb", whiteSpace: "nowrap" }}>TOTAL</td>
                  <td style={{ textAlign: "right", minWidth: 92, fontWeight: 600, padding: "4px 10px", border: "1px solid #bbb" }}>¥{fmt(inv.subtotal)}</td>
                </tr>
                {discountAmt > 0 && (
                  <tr>
                    <td style={{ background: "#f0f0f0", fontWeight: 600, textAlign: "right", padding: "4px 10px", border: "1px solid #bbb", whiteSpace: "nowrap" }}>DISCOUNT ({discountPct}%)</td>
                    <td style={{ textAlign: "right", minWidth: 92, fontWeight: 600, padding: "4px 10px", border: "1px solid #bbb", color: "#e53e3e" }}>−¥{fmt(discountAmt)}</td>
                  </tr>
                )}
                {inv.tax_rate > 0 && (
                  <tr>
                    <td style={{ background: "#f0f0f0", fontWeight: 600, textAlign: "right", padding: "4px 10px", border: "1px solid #bbb", whiteSpace: "nowrap" }}>TAX ({inv.tax_rate}%)</td>
                    <td style={{ textAlign: "right", minWidth: 92, fontWeight: 600, padding: "4px 10px", border: "1px solid #bbb" }}>¥{fmt(inv.tax)}</td>
                  </tr>
                )}
                <tr>
                  <td style={{ background: "#1F4E79", color: "#fff", fontWeight: 700, textAlign: "right", padding: "4px 10px", border: "1px solid #bbb", whiteSpace: "nowrap" }}>TOTAL</td>
                  <td style={{ textAlign: "right", fontWeight: 700, fontSize: 13, padding: "4px 10px", border: "1px solid #bbb", color: "#1F4E79" }}>¥{fmt(inv.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex justify-between gap-2 mt-3">
          <Button variant="outline" onClick={loadInBilling}>
            <ArrowRight className="size-4 mr-2" /> Load in Billing
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Close</Button>
            <Button className="gradient-primary text-primary-foreground border-0" onClick={() => printInvoice(inv, stores, customers)}>
              <Printer className="size-4 mr-2" /> Print / Save PDF
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Entity Card ────────────────────────────────────────────────────────────────
interface EntityCardProps {
  entityKey: string; invs: SavedInvoice[]; label: string; isShop: boolean;
  stores: BillingStore[]; customers: BillingCustomer[];
  expandedEntity: string | null; setExpandedEntity: (k: string | null) => void;
  expandedGroup: string | null;  setExpandedGroup:  (k: string | null) => void;
  onView: (inv: SavedInvoice) => void;
  onPrint: (inv: SavedInvoice) => void;
}

function EntityCard({ entityKey, invs, label, isShop, stores, customers, expandedEntity, setExpandedEntity, expandedGroup, setExpandedGroup, onView, onPrint }: EntityCardProps) {
  const totalAmt  = invs.reduce((s, i) => s + i.total, 0);
  const lastDate  = invs[0]?.date;
  const isExpanded = expandedEntity === entityKey;
  const monthGroups = useMemo(() => groupByMonthWeek(invs), [invs]);

  return (
    <Card className="card-elevated overflow-hidden">
      {/* Entity header */}
      <button className="w-full flex items-center gap-3 p-4 hover:bg-accent/30 transition-colors text-left"
        onClick={() => setExpandedEntity(isExpanded ? null : entityKey)}>
        <div className="size-10 rounded-xl bg-primary/10 grid place-items-center shrink-0">
          {isShop ? <Store className="size-4 text-primary" /> : <Truck className="size-4 text-primary" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate">{label}</div>
          <div className="text-xs text-muted-foreground">
            {invs.length} invoice{invs.length !== 1 ? "s" : ""}{lastDate ? ` · Last: ${lastDate}` : ""}
          </div>
        </div>
        <div className="text-right shrink-0 mr-2">
          <div className="font-bold tabular-nums text-sm">¥{totalAmt.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground">total</div>
        </div>
        {isExpanded ? <ChevronDown className="size-4 text-muted-foreground shrink-0" /> : <ChevronRight className="size-4 text-muted-foreground shrink-0" />}
      </button>

      {isExpanded && (
        <div className="border-t border-border">
          {Array.from(monthGroups.entries()).map(([monthKey, weekMap]) => {
            const monthLabel = format(new Date(monthKey + "-01"), "MMMM yyyy");
            const monthInvs  = Array.from(weekMap.values()).flat();
            const monthTotal = monthInvs.reduce((s, i) => s + i.total, 0);
            const groupId    = `${entityKey}::${monthKey}`;
            const isGroupOpen = expandedGroup === groupId;

            return (
              <div key={monthKey} className="border-b border-border last:border-0">
                {/* Month header */}
                <button className="w-full flex items-center gap-2 px-4 py-2.5 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
                  onClick={() => setExpandedGroup(isGroupOpen ? null : groupId)}>
                  <div className="flex-1">
                    <span className="text-sm font-semibold">{monthLabel}</span>
                    <span className="text-xs text-muted-foreground ml-2">{monthInvs.length} invoices</span>
                  </div>
                  <span className="text-sm font-bold tabular-nums text-primary mr-1">¥{monthTotal.toLocaleString()}</span>
                  {isGroupOpen ? <ChevronDown className="size-3.5 text-muted-foreground" /> : <ChevronRight className="size-3.5 text-muted-foreground" />}
                </button>

                {isGroupOpen && (
                  <div>
                    {Array.from(weekMap.entries()).map(([weekLabel, weekInvs]) => {
                      const weekTotal = weekInvs.reduce((s, i) => s + i.total, 0);
                      return (
                        <div key={weekLabel}>
                          {/* Week sub-header */}
                          <div className="flex items-center gap-2 px-5 py-1.5 bg-muted/10 border-b border-border/40">
                            <span className="text-xs font-semibold text-muted-foreground flex-1 upper-label">{weekLabel}</span>
                            <span className="text-xs tabular-nums text-muted-foreground">{weekInvs.length} · ¥{weekTotal.toLocaleString()}</span>
                          </div>
                          {/* Invoice rows */}
                          {weekInvs.map(inv => (
                            <div key={inv.id} className="flex items-center gap-2 px-4 py-2.5 border-b border-border/20 hover:bg-accent/20 transition-colors">
                              <Receipt className="size-3.5 text-muted-foreground shrink-0" />
                              <div className="flex-1 min-w-0">
                                <span className="font-mono text-xs font-semibold">{inv.invoice_no || "—"}</span>
                                <span className="text-xs text-muted-foreground ml-2">{inv.date}</span>
                                <span className="text-xs text-muted-foreground ml-2 hidden sm:inline">
                                  {Array.isArray(inv.items) ? inv.items.length : 0} items
                                </span>
                              </div>
                              <span className="font-semibold tabular-nums text-sm shrink-0">¥{inv.total.toLocaleString()}</span>
                              <Button size="sm" variant="outline"
                                className="h-7 px-2.5 text-xs gap-1 shrink-0"
                                onClick={() => onView(inv)}>
                                <Eye className="size-3" /> View
                              </Button>
                              <Button size="sm" variant="outline"
                                className="h-7 px-2.5 text-xs gap-1 shrink-0 border-primary/40 text-primary hover:bg-primary/10"
                                onClick={() => onPrint(inv)}>
                                <Printer className="size-3" /> PDF
                              </Button>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ── History Page ───────────────────────────────────────────────────────────────
function BillingHistoryPage() {
  const [activeTab, setActiveTab]       = useState<"shops" | "customers">("shops");
  const [expandedEntity, setExpandedEntity] = useState<string | null>(null);
  const [expandedGroup,  setExpandedGroup]  = useState<string | null>(null);
  const [searchQ, setSearchQ]           = useState("");
  const [selectedInv, setSelectedInv]   = useState<SavedInvoice | null>(null);

  const { data: stores = [] } = useQuery<BillingStore[]>({
    queryKey: ["billing-stores"],
    queryFn: fbGetStores,
  });
  const { data: customers = [] } = useQuery<BillingCustomer[]>({
    queryKey: ["billing-customers"],
    queryFn: fbGetCustomers,
  });
  const { data: invoices = [], isLoading } = useQuery<SavedInvoice[]>({
    queryKey: ["billing-invoices-history"],
    queryFn: fbGetInvoices as any,
  });

  const shopInvoices     = useMemo(() => invoices.filter(i => i.bill_to_type === "store"),    [invoices]);
  const customerInvoices = useMemo(() => invoices.filter(i => i.bill_to_type === "customer"), [invoices]);
  const totalRevenue     = useMemo(() => invoices.reduce((s, i) => s + i.total, 0),           [invoices]);

  const byShop = useMemo(() => {
    const map = new Map<string, SavedInvoice[]>();
    shopInvoices.forEach(inv => {
      const k = inv.bill_to_store_id ?? "__unknown__";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(inv);
    });
    return Array.from(map.entries()).sort(([a], [b]) => {
      const la = stores.find(s => s.id === a)?.sub ?? a;
      const lb = stores.find(s => s.id === b)?.sub ?? b;
      return la.localeCompare(lb);
    });
  }, [shopInvoices, stores]);

  const byCustomer = useMemo(() => {
    const map = new Map<string, SavedInvoice[]>();
    customerInvoices.forEach(inv => {
      const k = inv.customer_id ?? "__unknown__";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(inv);
    });
    return Array.from(map.entries()).sort(([a], [b]) => {
      const ca = customers.find(c => c.id === a);
      const cb = customers.find(c => c.id === b);
      return (ca ? (ca.company ?? ca.name) : a).localeCompare(cb ? (cb.company ?? cb.name) : b);
    });
  }, [customerInvoices, customers]);

  function getShopLabel(id: string) {
    const s = stores.find(s => s.id === id);
    return s ? `${s.name}${s.sub ? ` — ${s.sub}` : ""}` : id;
  }
  function getCustomerLabel(id: string) {
    const c = customers.find(c => c.id === id);
    if (!c) return id;
    return c.company ? `${c.company} — ${c.name}` : c.name;
  }

  const currentList = activeTab === "shops" ? byShop : byCustomer;
  const getLabel    = activeTab === "shops" ? getShopLabel : getCustomerLabel;

  const filteredList = useMemo(() => {
    if (!searchQ.trim()) return currentList;
    const q = searchQ.toLowerCase();
    return currentList.filter(([key]) => getLabel(key).toLowerCase().includes(q));
  }, [currentList, searchQ, getLabel]);

  function switchTab(t: "shops" | "customers") {
    setActiveTab(t); setExpandedEntity(null); setExpandedGroup(null); setSearchQ("");
  }

  return (
    <div className="p-3 sm:p-6 md:p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <PageHeader eyebrow="Billing" title="Invoice History" subtitle="All invoices grouped by recipient." />
        <Link to="/billing">
          <Button variant="outline" size="sm"><FileText className="size-3.5 mr-1.5" /> New Invoice</Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: "Total Invoices", value: isLoading ? "…" : invoices.length.toString() },
          { label: "Total Revenue",  value: isLoading ? "…" : `¥${totalRevenue.toLocaleString()}` },
          { label: "Recipients",     value: isLoading ? "…" : (byShop.length + byCustomer.length).toString() },
        ].map(stat => (
          <Card key={stat.label} className="card-elevated p-4 text-center">
            <div className="text-2xl font-bold tabular-nums">{stat.value}</div>
            <div className="upper-label mt-0.5 text-muted-foreground" style={{ fontSize: 10 }}>{stat.label}</div>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        {(["shops", "customers"] as const).map(tab => (
          <button key={tab} onClick={() => switchTab(tab)}
            className={cn("h-10 rounded-xl border flex items-center justify-center gap-2 text-sm font-semibold transition",
              activeTab === tab
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-secondary/40 hover:bg-secondary")}>
            {tab === "shops" ? <Store className="size-4" /> : <Truck className="size-4" />}
            {tab === "shops" ? `Shops (${byShop.length})` : `Customers (${byCustomer.length})`}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          className="pl-9 h-9 text-sm"
          placeholder={`Search ${activeTab === "shops" ? "shops" : "customers"}…`}
          value={searchQ}
          onChange={e => setSearchQ(e.target.value)}
        />
      </div>

      {/* List */}
      {isLoading ? (
        <div className="text-center py-20 text-muted-foreground">Loading…</div>
      ) : filteredList.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <Receipt className="size-10 mx-auto mb-3 opacity-30" />
          <p>{searchQ ? "No results match your search" : `No ${activeTab === "shops" ? "shop" : "customer"} invoices yet`}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredList.map(([entityKey, invs]) => (
            <EntityCard
              key={entityKey}
              entityKey={entityKey} invs={invs}
              label={getLabel(entityKey)}
              isShop={activeTab === "shops"}
              stores={stores} customers={customers}
              expandedEntity={expandedEntity} setExpandedEntity={setExpandedEntity}
              expandedGroup={expandedGroup}   setExpandedGroup={setExpandedGroup}
              onView={setSelectedInv}
              onPrint={inv => printInvoice(inv, stores, customers)}
            />
          ))}
        </div>
      )}

      {/* Invoice detail modal */}
      {selectedInv && (
        <InvoiceDetailModal
          inv={selectedInv}
          stores={stores}
          customers={customers}
          onClose={() => setSelectedInv(null)}
        />
      )}
    </div>
  );
}
