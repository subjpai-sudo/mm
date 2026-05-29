import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useCallback } from "react";
import { Toaster, toast } from "sonner";
import jsPDF from "jspdf";
import JsBarcode from "jsbarcode";
import { PRODUCTS, type Product } from "@/data/products";
import {
  store,
  getProduct,
  getBarcode,
  themeStore,
  type Override,
} from "@/lib/catalog-storage";
import { fb } from "@/lib/firebase";
import { ProductCard } from "@/components/catalog/ProductCard";
import { EditDialog, type EditValues } from "@/components/catalog/EditDialog";
import { BarcodeScanner } from "@/components/catalog/BarcodeScanner";
import { QuickRegisterDialog, type QuickRegisterValues } from "@/components/catalog/QuickRegisterDialog";
export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Catalog — Catalog & Barcode Register" },
      {
        name: "description",
        content: "Editable product catalog with AI-generated images and barcode register.",
      },
    ],
  }),
  component: CatalogPage,
});

function CatalogPage() {
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [images, setImages] = useState<Record<string, string>>({});
  const [barcodes, setBarcodes] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<Record<string, Product>>({});
  const [theme, setTheme] = useState<"light" | "dark">("light");

  const [search, setSearch] = useState("");
  const [brand, setBrand] = useState("");
  const [origin, setOrigin] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");

  const [editNo, setEditNo] = useState<number | null>(null);
  const [registerScanOpen, setRegisterScanOpen] = useState(false);
  const [scannerStream, setScannerStream] = useState<MediaStream | null>(null);
  const [scanForNo, setScanForNo] = useState<number | null>(null);
  const [quickReg, setQuickReg] = useState<{
    no: number;
    barcode: string;
    existing: boolean;
    name: string;
    size: string;
    category: string;
    subCategory: string;
  } | null>(null);
  const [lastCategory, setLastCategory] = useState("");
  const [lastSubCategory, setLastSubCategory] = useState("");
  const [generating, setGenerating] = useState(false);
  const [flashNo, setFlashNo] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [lightbox, setLightbox] = useState<{ src: string; name: string } | null>(null);
  const [syncing, setSyncing] = useState(false);

  const scannerBusy = scanLoading || registerScanOpen || scanForNo != null;

  useEffect(() => {
    setOverrides(store.loadOverrides());
    setImages(store.loadImages());
    setBarcodes(store.loadBarcodes());
    setCustom(store.loadCustom());
    const t = themeStore.get();
    setTheme(t);
    document.documentElement.classList.toggle("dark", t === "dark");
    // Firebase: pull remote and merge (remote wins for keys present remotely)
    const unsub = fb.subscribeAll((snap) => {
      const ov = snap.overrides as Record<string, Override>;
      setOverrides(ov);
      store.saveOverrides(ov);
      const im = snap.images as Record<string, string>;
      setImages(im);
      store.saveImages(im);
      const bc = snap.barcodes as Record<string, string>;
      setBarcodes(bc);
      store.saveBarcodes(bc);
      const cu = snap.custom as Record<string, Product>;
      setCustom(cu);
      store.saveCustom(cu);
    });
    return () => unsub();
  }, []);

  const saveOverrides = (v: Record<string, Override>) => {
    setOverrides(v);
    store.saveOverrides(v);
    fb.pushMap("overrides", v);
  };
  const saveBarcodes = (v: Record<string, string>) => {
    setBarcodes(v);
    store.saveBarcodes(v);
    fb.pushMap("barcodes", v);
  };
  const saveImages = (v: Record<string, string>) => {
    setImages(v);
    store.saveImages(v);
    fb.pushMap("images", v);
  };
  const saveCustom = (v: Record<string, Product>) => {
    setCustom(v);
    store.saveCustom(v);
    fb.pushMap("custom", v);
  };

  const allProducts = useMemo<Product[]>(() => {
    const customList = Object.values(custom).sort((a, b) => a.no - b.no);
    return [...PRODUCTS, ...customList];
  }, [custom]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allProducts.filter((p) => {
      const cur = getProduct(p.no, overrides, custom) ?? p;
      if (brand && cur.brand !== brand) return false;
      if (origin && cur.origin !== origin) return false;
      if (q) {
        const bc = getBarcode(p.no, barcodes, custom);
        const hay =
          `${cur.no} ${cur.name} ${cur.brand} ${cur.origin} ${cur.size} ${bc}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [search, brand, origin, overrides, barcodes, custom, allProducts]);

  const openEdit = (no: number) => setEditNo(no);
  const requestScannerStream = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) return null;
      return await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    } catch (e) {
      console.error("Camera permission failed", e);
      toast.error("Camera unavailable. Check browser camera permission.");
      return null;
    }
  };
  const openRegisterScan = () => {
    if (scannerBusy) return;
    setScanLoading(true);
    void requestScannerStream().then((stream) => {
      setScannerStream(stream);
      setRegisterScanOpen(true);
      setScanLoading(false);
    });
  };
  const openProductScan = (no: number) => {
    if (scannerBusy) return;
    setScanLoading(true);
    void requestScannerStream().then((stream) => {
      setScannerStream(stream);
      setScanForNo(no);
      setScanLoading(false);
    });
  };

  const handleAddProduct = () => {
    const maxNo = allProducts.reduce((m, p) => Math.max(m, p.no), 0);
    const newNo = maxNo + 1;
    const blank: Product = {
      no: newNo,
      name: "New Product",
      brand: "",
      code: "",
      origin: "",
      size: "",
      pcs: "",
      p1: "",
      p10: "",
      pcase: "",
    };
    const next = { ...custom, [newNo]: blank };
    saveCustom(next);
    setEditNo(newNo);
    toast.success(`Added #${newNo} — fill in details`);
  };

  const handleDeleteCustom = (no: number) => {
    if (!confirm(`Delete custom product #${no}?`)) return;
      const key = String(no);
      const nc = { ...custom };
      delete nc[no];
      setCustom(nc);
      store.saveCustom(nc);
      const ni = { ...images };
      delete ni[no];
      setImages(ni);
      store.saveImages(ni);
      const nb = { ...barcodes };
      delete nb[no];
      setBarcodes(nb);
      store.saveBarcodes(nb);
      const no2 = { ...overrides };
      delete no2[no];
      setOverrides(no2);
      store.saveOverrides(no2);
      // propagate single-key removals so other devices see the delete instantly
      fb.patchMap("custom", key, null);
      fb.patchMap("images", key, null);
      fb.patchMap("barcodes", key, null);
      fb.patchMap("overrides", key, null);
      setEditNo(null);
      toast.success("Deleted");
  };

  const editing = editNo != null ? getProduct(editNo, overrides, custom) : null;
  const editingBarcode = editNo != null ? getBarcode(editNo, barcodes, custom) : "";
  const editingImage = editNo != null ? images[editNo] || null : null;
  const editingIsCustom = editNo != null && custom[editNo] != null;

  const handleSaveEdit = (v: EditValues) => {
    if (editNo == null) return;
    const baseFromCatalog = PRODUCTS.find((p) => p.no === editNo);
    if (!baseFromCatalog && custom[editNo]) {
      const num = (s: string, fb: number | string) => (s ? (isNaN(+s) ? s : +s) : fb);
      const full: Product = {
        no: editNo,
        name: v.name || "Untitled",
        brand: v.brand,
        origin: v.origin,
        size: v.size,
        pcs: num(v.pcs, ""),
        code: v.code || "",
        p1: num(v.p1, "--"),
        p10: num(v.p10, "--"),
        pcase: num(v.pcase, "--"),
        category: v.category || "",
        subCategory: v.subCategory || "",
      };
      const nc = { ...custom, [editNo]: full };
      saveCustom(nc);
      if (v.barcode !== editingBarcode) {
        const nb = { ...barcodes, [editNo]: v.barcode };
        saveBarcodes(nb);
      }
      setEditNo(null);
      return;
    }
    const base = baseFromCatalog!;
    const ov: Override = {};
    const set = <K extends keyof Override>(k: K, val: string, baseVal: Product[K]) => {
      const parsed =
        (k === "p1" || k === "p10" || k === "pcase") && val
          ? isNaN(+val)
            ? val
            : +val
          : val || (k === "p1" || k === "p10" || k === "pcase" ? "--" : "");
      if (parsed !== baseVal && parsed !== "") (ov as Record<string, unknown>)[k] = parsed;
    };
    set("name", v.name, base.name);
    set("brand", v.brand, base.brand);
    set("origin", v.origin, base.origin);
    set("size", v.size, base.size);
    set("pcs", v.pcs, String(base.pcs));
    set("code", v.code, base.code);
    set("p1", v.p1, base.p1);
    set("p10", v.p10, base.p10);
    set("pcase", v.pcase, base.pcase);
    set("category", v.category, base.category ?? "");
    set("subCategory", v.subCategory, base.subCategory ?? "");
    const next = { ...overrides, [editNo]: ov };
    saveOverrides(next);
    if (v.barcode !== editingBarcode) {
      const nb = { ...barcodes, [editNo]: v.barcode };
      saveBarcodes(nb);
    }
    setEditNo(null);
  };

  const handleGenerate = async (references?: string[] | null) => {
    if (editNo == null || !editing) return;
    setGenerating(true);
    try {
      const refs =
        references && references.length > 0 ? references : images[editNo] ? [images[editNo]] : [];
      const hasRefs = refs.length > 0;
      const prompt = hasRefs
        ? `Using the provided reference photo(s) of the actual product packaging, recreate it as a clean professional catalog product photograph. Preserve EXACTLY the brand name, label design, colors, typography, logos and packaging shape shown in the reference. Do not invent or change any text or label. Product: "${editing.name}" by ${editing.brand}, ${editing.size}. Pure white seamless background, soft studio lighting, sharp focus, centered composition, commercial e-commerce quality, no shadows on background.`
        : `Professional product catalog photograph of "${editing.name}" by ${editing.brand} from ${editing.origin}, package size ${editing.size}. Pure white background, studio soft-box lighting, sharp focus, commercial quality, centered composition, no text overlay.`;
      const r = await fetch("/api/public/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, references: refs, provider: "gemini" }),
      });
      const data = await r.json();
      if (!r.ok || !data.url) throw new Error(data.error || "Failed");
      let finalUrl = data.url as string;
      try {
        finalUrl = await fb.uploadImage(editNo, finalUrl);
      } catch (e) {
        console.warn("Firebase upload failed, using inline", e);
      }
      const ni = { ...images, [editNo]: finalUrl };
      saveImages(ni);
      toast.success(`${hasRefs ? "Regenerated" : "Generated"} via ${data.provider || "AI"}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const handleRegisterBarcode = (txt: string) => {
    setRegisterScanOpen(false);
    const code = txt.trim();
    if (!code) return;
    // Find existing product by saved barcode or original code field
    const existing = allProducts.find((p) => {
      const bc = getBarcode(p.no, barcodes, custom);
      return bc === code || p.code === code;
    });
    if (existing) {
      // Save barcode link, then open Quick Register prefilled so the user can confirm/assign category
      const nb = { ...barcodes, [existing.no]: code };
      saveBarcodes(nb);
      setFlashNo(existing.no);
      setTimeout(() => setFlashNo(null), 2400);
      const cur = getProduct(existing.no, overrides, custom) ?? existing;
      setQuickReg({
        no: existing.no,
        barcode: code,
        existing: true,
        name: cur.name,
        size: cur.size,
        category: cur.category || lastCategory,
        subCategory: cur.subCategory || lastSubCategory,
      });
      return;
    }
    // Create new product, open Quick Register (barcode -> category -> sub -> name/unit)
    const maxNo = allProducts.reduce((m, p) => Math.max(m, p.no), 0);
    const newNo = maxNo + 1;
    const blank: Product = {
      no: newNo, name: "", brand: "", code: code, origin: "", size: "",
      pcs: "", p1: "", p10: "", pcase: "",
      category: lastCategory, subCategory: lastSubCategory,
    };
    saveCustom({ ...custom, [newNo]: blank });
    saveBarcodes({ ...barcodes, [newNo]: code });
    setQuickReg({
      no: newNo,
      barcode: code,
      existing: false,
      name: "",
      size: "",
      category: lastCategory,
      subCategory: lastSubCategory,
    });
  };

  // Category = Country (origin). Sub-category = Brand (vendor).
  // Derived from every product's origin/brand so importing new items
  // automatically extends the dropdowns.
  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    allProducts.forEach((p) => {
      const cur = getProduct(p.no, overrides, custom) ?? p;
      if (cur.origin) set.add(cur.origin);
    });
    return Array.from(set).sort();
  }, [allProducts, overrides, custom]);

  const subCategoriesByCategory = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    allProducts.forEach((p) => {
      const cur = getProduct(p.no, overrides, custom) ?? p;
      if (cur.origin && cur.brand) {
        (map[cur.origin] ||= new Set()).add(cur.brand);
      }
    });
    const out: Record<string, string[]> = {};
    Object.entries(map).forEach(([k, v]) => (out[k] = Array.from(v).sort()));
    return out;
  }, [allProducts, overrides, custom]);

  const handleQuickRegSave = (v: QuickRegisterValues, scanNext: boolean) => {
    if (!quickReg) return;
    const { no, barcode: bc, existing } = quickReg;
    // category = Country (origin), subCategory = Brand (vendor)
    if (existing) {
      const base = PRODUCTS.find((p) => p.no === no);
      if (base) {
        const ov: Override = { ...(overrides[no] || {}) };
        if (v.name && v.name !== base.name) ov.name = v.name;
        if (v.size && v.size !== base.size) ov.size = v.size;
        if (v.category) { ov.origin = v.category; ov.category = v.category; }
        if (v.subCategory) { ov.brand = v.subCategory; ov.subCategory = v.subCategory; }
        saveOverrides({ ...overrides, [no]: ov });
      } else if (custom[no]) {
        const cur = custom[no];
        saveCustom({
          ...custom,
          [no]: {
            ...cur,
            name: v.name || cur.name,
            size: v.size || cur.size,
            origin: v.category || cur.origin,
            brand: v.subCategory || cur.brand,
            category: v.category,
            subCategory: v.subCategory,
          },
        });
      }
    } else {
      const full: Product = {
        no, name: v.name, brand: v.subCategory, code: bc, origin: v.category, size: v.size,
        pcs: "", p1: "", p10: "", pcase: "",
        category: v.category, subCategory: v.subCategory,
      };
      saveCustom({ ...custom, [no]: full });
    }
    setLastCategory(v.category);
    setLastSubCategory(v.subCategory);
    setQuickReg(null);
    toast.success(`${existing ? "Updated" : "Registered"} #${no} — ${v.name}`);
    if (scanNext) setTimeout(() => setRegisterScanOpen(true), 150);
  };

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    themeStore.set(next);
    document.documentElement.classList.toggle("dark", next === "dark");
  };

  const withBc = allProducts.filter((p) => getBarcode(p.no, barcodes, custom)).length;
  


  const urlToDataUrl = async (url: string): Promise<string | null> => {
    if (url.startsWith("data:")) return url;
    try {
      const r = await fetch(url, { mode: "cors" });
      if (!r.ok) return null;
      const blob = await r.blob();
      return await new Promise<string>((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result as string);
        fr.onerror = rej;
        fr.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  };

  const fmtYen = (v: number | string) => (v === "--" || v === "" || v === "none" ? "—" : `¥${v}`);

  const barcodeDataUrl = (code: string): string | null => {
    try {
      const canvas = document.createElement("canvas");
      JsBarcode(canvas, code, {
        format: "CODE128",
        displayValue: false,
        margin: 0,
        height: 60,
        width: 2,
        background: "#ffffff",
        lineColor: "#000000",
      });
      return canvas.toDataURL("image/png");
    } catch {
      return null;
    }
  };

  const exportPdf = async () => {
    setExporting(true);
    const tId = toast.loading("Building PDF…");
    try {
      const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const margin = 10;
      // 2 x 2 = 4 per page so each image is large + crisp
      const cols = 2,
        rows = 2;
      const gap = 8;
      const headerH = 10;
      const cardW = (pageW - margin * 2 - gap * (cols - 1)) / cols;
      const cardH = (pageH - margin * 2 - headerH - gap * (rows - 1)) / rows;

      // Cover
      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, pageW, pageH, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(42);
      doc.text("Catalog", pageW / 2, pageH / 2 - 10, { align: "center" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(14);
      doc.text("Product Catalog", pageW / 2, pageH / 2 + 2, { align: "center" });
      doc.setFontSize(10);
      doc.setTextColor(180, 180, 200);
      doc.text(
        `${filtered.length} products · ${new Date().toLocaleDateString()}`,
        pageW / 2,
        pageH / 2 + 12,
        { align: "center" },
      );


      doc.addPage();
      let pos = 0;

      for (let i = 0; i < filtered.length; i++) {
        const p = filtered[i];
        const cur = getProduct(p.no, overrides, custom) ?? p;
        const bc = getBarcode(p.no, barcodes, custom);
        toast.loading(`Building PDF… ${i + 1}/${filtered.length}`, { id: tId });

        if (pos > 0 && pos % (cols * rows) === 0) doc.addPage();
        const slot = pos % (cols * rows);
        const c = slot % cols;
        const r = Math.floor(slot / cols);
        const x = margin + c * (cardW + gap);
        const y = margin + headerH + r * (cardH + gap);

        doc.setDrawColor(220);
        doc.setFillColor(252, 252, 254);
        doc.roundedRect(x, y, cardW, cardH, 3, 3, "FD");

        const imgUrl =
          images[p.no] ||
          `https://catalog-58ec8.web.app/images/product_${String(p.no).padStart(3, "0")}.jpg`;
        const dataUrl = await urlToDataUrl(imgUrl);
        const imgH = cardH * 0.55; // leave room for barcode
        if (dataUrl) {
          try {
            const fmt = dataUrl.includes("image/png") ? "PNG" : "JPEG";
            // SLOW = better quality (less downscaling). Pad 5mm.
            doc.addImage(dataUrl, fmt, x + 5, y + 5, cardW - 10, imgH - 4, undefined, "SLOW");
          } catch {
            /* skip */
          }
        }

        const tx = x + 5;
        let ty = y + imgH + 8;
        doc.setTextColor(20);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        const name = doc.splitTextToSize(cur.name, cardW - 10);
        doc.text(name.slice(0, 2), tx, ty);
        ty += name.length > 1 ? 9 : 4.5;

        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(95);
        doc.text(`${cur.brand} · ${cur.origin} · ${cur.size} · ${cur.pcs}/case`, tx, ty);
        ty += 4;
        doc.text(`#${cur.no}  Code: ${cur.code || "—"}${bc ? `  BC: ${bc}` : ""}`, tx, ty);
        ty += 5;

        // Price row — yen, clear labels
        const priceY = ty;
        const cellW = (cardW - 10) / 3;
        const labels = [
          { l: "x1", v: fmtYen(cur.p1), accent: true },
          { l: "x10", v: fmtYen(cur.p10), accent: false },
          { l: "Case", v: fmtYen(cur.pcase), accent: false },
        ];
        labels.forEach((cell, idx) => {
          const cx = tx + idx * cellW;
          if (cell.accent) {
            doc.setFillColor(239, 246, 255);
            doc.rect(cx, priceY, cellW - 1, 11, "F");
          }
          doc.setDrawColor(225);
          doc.rect(cx, priceY, cellW - 1, 11);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(6.5);
          doc.setTextColor(120);
          doc.text(cell.l.toUpperCase(), cx + cellW / 2 - 0.5, priceY + 3.5, { align: "center" });
          doc.setFont("helvetica", "bold");
          doc.setFontSize(10);
          doc.setTextColor(cell.accent ? 37 : 30, cell.accent ? 99 : 30, cell.accent ? 235 : 30);
          doc.text(cell.v, cx + cellW / 2 - 0.5, priceY + 8.8, { align: "center" });
        });

        // Barcode under price row
        if (bc) {
          const barH = 10;
          const barY = priceY + 11 + 1.5;
          const barW = cardW - 10;
          const barDataUrl = barcodeDataUrl(bc);
          if (barDataUrl && barY + barH + 3 <= y + cardH - 1) {
            try {
              doc.addImage(barDataUrl, "PNG", tx, barY, barW, barH);
              doc.setFont("courier", "normal");
              doc.setFontSize(7);
              doc.setTextColor(40);
              doc.text(bc, tx + barW / 2, barY + barH + 2.8, { align: "center" });
            } catch {
              /* skip */
            }
          }
        }

        pos++;
      }

      doc.save(`city-star-catalog-${new Date().toISOString().slice(0, 10)}.pdf`);
      toast.success("PDF exported", { id: tId });
    } catch (e) {
      toast.error(`PDF failed: ${(e as Error).message}`, { id: tId });
    } finally {
      setExporting(false);
    }
  };

  // Backend-ready export: one JSON file with the fully merged catalog.
  // Shape matches what an inventory project's import script expects:
  //   { exported_at, source, count, products: [...] }
  // Each product = full fields incl. computed price in yen + image URL + barcode.
  const exportData = () => {
    const rows = allProducts.map((p) => {
      const cur = getProduct(p.no, overrides, custom) ?? p;
      const bc = getBarcode(p.no, barcodes, custom) || "";
      const img =
        images[p.no] ||
        `https://catalog-58ec8.web.app/images/product_${String(p.no).padStart(3, "0")}.jpg`;
      const num = (v: number | string) =>
        v === "--" || v === "" || v === "none"
          ? null
          : typeof v === "number"
            ? v
            : isNaN(+v)
              ? null
              : +v;
      return {
        no: cur.no,
        sku: cur.code || `SKU-${String(cur.no).padStart(4, "0")}`,
        name: cur.name,
        brand: cur.brand,
        origin: cur.origin,
        size: cur.size,
        pcs_per_case: num(cur.pcs),
        price_unit_jpy: num(cur.p1),
        price_10_jpy: num(cur.p10),
        price_case_jpy: num(cur.pcase),
        currency: "JPY",
        barcode: bc,
        image_url: img,
        stock_qty: 0,
        is_custom: !!custom[cur.no],
        updated_at: new Date().toISOString(),
      };
    });
    const payload = {
      exported_at: new Date().toISOString(),
      source: "city-star-catalog",
      count: rows.length,
      products: rows,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `city-star-inventory-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length} products as JSON`);
  };

  const syncBilling = async () => {
    setSyncing(true);
    const tId = toast.loading("Syncing from billing server…");
    try {
      const r = await fetch("http://localhost:8080/api/push/firebase", { method: "POST" });
      const d = await r.json();
      if (d.ok) {
        toast.success(`Synced ${d.pushed ?? 0} products from billing`, { id: tId });
      } else {
        toast.error(d.error || "Sync failed", { id: tId });
      }
    } catch {
      toast.error("Cannot reach billing server (localhost:8080)", { id: tId });
    } finally {
      setSyncing(false);
    }
  };

  // Compact barcode-only export — drop into another Lovable project to seed barcode→product mapping.
  const exportBarcodes = () => {
    const rows = allProducts
      .map((p) => {
        const cur = getProduct(p.no, overrides, custom) ?? p;
        const bc = getBarcode(p.no, barcodes, custom);
        if (!bc) return null;
        return {
          barcode: bc,
          no: cur.no,
          sku: cur.code || `SKU-${String(cur.no).padStart(4, "0")}`,
          name: cur.name,
          brand: cur.brand,
          size: cur.size,
          category: cur.category || "",
          subCategory: cur.subCategory || "",
        };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);
    if (rows.length === 0) {
      toast.error("No barcodes to export yet");
      return;
    }
    const payload = {
      exported_at: new Date().toISOString(),
      source: "city-star-catalog",
      schema: "barcode-map@1",
      count: rows.length,
      barcodes: rows,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `city-star-barcodes-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length} barcodes`);
  };

  // Import: accepts either the full Data export ({ products: [...] }) or the
  // Barcodes export ({ barcodes: [...] }). Merges into the custom catalog,
  // re-using `no` when free, otherwise reassigning to the next available no.
  const importProducts = (file: File) => {
    const reader = new FileReader();
      reader.onload = () => {
        try {
          const raw = JSON.parse(String(reader.result || "{}"));
          const items: Array<Record<string, unknown>> = Array.isArray(raw)
            ? raw
            : Array.isArray(raw.products)
              ? raw.products
              : Array.isArray(raw.barcodes)
                ? raw.barcodes
                : [];
          if (items.length === 0) {
            toast.error("No products found in file");
            return;
          }
          const takenNos = new Set<number>(allProducts.map((p) => p.no));
          let nextNo = allProducts.reduce((m, p) => Math.max(m, p.no), 0) + 1;
          const nc = { ...custom };
          const nb = { ...barcodes };
          const ni = { ...images };
          let added = 0;
          let skipped = 0;
          for (const row of items) {
            const name = String(row.name ?? "").trim();
            if (!name) { skipped++; continue; }
            let no = typeof row.no === "number" ? row.no : NaN;
            if (!Number.isFinite(no) || takenNos.has(no)) {
              no = nextNo++;
            }
            takenNos.add(no);
            const numOrDash = (v: unknown): number | string =>
              v == null || v === "" ? "--" : typeof v === "number" ? v : isNaN(+String(v)) ? "--" : +String(v);
            const product: Product = {
              no,
              name,
              brand: String(row.brand ?? ""),
              code: String(row.sku ?? row.code ?? ""),
              origin: String(row.origin ?? ""),
              size: String(row.size ?? ""),
              pcs: row.pcs_per_case == null ? "" : (row.pcs_per_case as number | string),
              p1: numOrDash(row.price_unit_jpy ?? row.p1),
              p10: numOrDash(row.price_10_jpy ?? row.p10),
              pcase: numOrDash(row.price_case_jpy ?? row.pcase),
              category: row.category ? String(row.category) : "",
              subCategory: row.subCategory ? String(row.subCategory) : "",
            };
            nc[no] = product;
            const bc = row.barcode ? String(row.barcode) : "";
            if (bc) nb[no] = bc;
            const img = row.image_url ? String(row.image_url) : "";
            if (img && !img.includes("catalog-58ec8.web.app")) ni[no] = img;
            added++;
          }
          saveCustom(nc);
          saveBarcodes(nb);
          saveImages(ni);
          toast.success(`Imported ${added} product${added === 1 ? "" : "s"}${skipped ? ` (${skipped} skipped)` : ""}`);
        } catch (e) {
          toast.error(`Import failed: ${(e as Error).message}`);
        }
      };
      reader.readAsText(file);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Toaster position="top-center" theme={theme} />

      <header className="border-b border-border px-6 md:px-8 py-5">
        <div className="flex items-center gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-3xl md:text-4xl leading-none">
              Cata<span className="text-primary">log</span>
            </h1>
            <p className="text-[11px] text-muted-foreground mt-1.5 tracking-wide">
              Catalog & Barcode Register
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <Pill>{allProducts.length} items</Pill>
            {withBc > 0 && <Pill className="text-[var(--gn)]">{withBc} barcoded</Pill>}
            
            <button
              onClick={toggleTheme}
              className="w-9 h-9 rounded-full bg-card border border-border grid place-items-center hover:bg-secondary transition"
              aria-label="Toggle theme"
            >
              {theme === "dark" ? "☀" : "☾"}
            </button>
          </div>
        </div>
      </header>

      <div className="px-6 md:px-8 pt-5">
        <button
          onClick={openRegisterScan}
          disabled={scannerBusy}
          className="w-full flex items-center justify-center gap-3 bg-primary text-primary-foreground rounded-2xl px-6 py-5 text-lg md:text-xl font-bold shadow-lifted hover:brightness-110 active:scale-[.99] transition disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100"
        >
          <span className="text-2xl">{scanLoading ? "⏳" : "📷"}</span>
          {scanLoading ? "Opening camera…" : scannerBusy ? "Scanner active…" : "Register Barcode"}
          {!scannerBusy && (
            <span className="text-xs font-medium opacity-80 hidden sm:inline">
              · scan to add or match a product
            </span>
          )}
        </button>
      </div>

      <div className="sticky top-0 z-40 backdrop-blur bg-background/85 border-b border-border px-6 md:px-8 py-3 flex gap-2 items-center flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, brand, code, barcode…"
            className="w-full bg-card border border-border rounded-full px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/15 transition"
          />
        </div>
        <select
          value={origin}
          onChange={(e) => {
            const v = e.target.value;
            setOrigin(v);
            // reset vendor if it doesn't belong to the newly chosen country
            if (v && brand && !(subCategoriesByCategory[v] ?? []).includes(brand)) {
              setBrand("");
            }
          }}
          className={sel}
        >
          <option value="">All countries</option>
          {categoryOptions.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
        <select value={brand} onChange={(e) => setBrand(e.target.value)} className={sel}>
          <option value="">{origin ? `All vendors in ${origin}` : "All vendors"}</option>
          {(origin
            ? subCategoriesByCategory[origin] ?? []
            : Array.from(
                new Set(
                  Object.values(subCategoriesByCategory).flat(),
                ),
              ).sort()
          ).map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>

        <div className="ml-auto flex gap-1 bg-secondary rounded-xl p-1 border border-border">
          <button
            onClick={() => setView("grid")}
            className={`px-2.5 py-1.5 rounded-lg text-sm ${view === "grid" ? "bg-card shadow-soft" : "text-muted-foreground"}`}
            aria-label="Grid view"
          >
            ▦
          </button>
          <button
            onClick={() => setView("list")}
            className={`px-2.5 py-1.5 rounded-lg text-sm ${view === "list" ? "bg-card shadow-soft" : "text-muted-foreground"}`}
            aria-label="List view"
          >
            ≡
          </button>
        </div>

        <button
          onClick={handleAddProduct}
          className="flex items-center gap-1.5 bg-[var(--gn)] text-white rounded-xl px-3 py-2 text-sm font-semibold hover:brightness-110 transition"
        >
          ＋ Add
        </button>
        <button
          onClick={exportPdf}
          disabled={exporting}
          className="flex items-center gap-1.5 bg-card border border-border rounded-xl px-3 py-2 text-sm hover:border-primary hover:text-primary transition disabled:opacity-50"
        >
          {exporting ? "⏳ PDF…" : "📄 PDF"}
        </button>
        <button
          onClick={exportData}
          className="flex items-center gap-1.5 bg-card border border-border rounded-xl px-3 py-2 text-sm hover:border-primary hover:text-primary transition"
          title="Export full catalog (products, prices, images, barcodes) as JSON for import into your inventory app"
        >
          ⬇ Data
        </button>
        <button
          onClick={exportBarcodes}
          className="flex items-center gap-1.5 bg-card border border-border rounded-xl px-3 py-2 text-sm hover:border-primary hover:text-primary transition"
          title="Export just barcode→product mapping as JSON to import into another Lovable project"
        >
          ▌▌ Barcodes
        </button>
        <label
          className="flex items-center gap-1.5 bg-card border border-border rounded-xl px-3 py-2 text-sm hover:border-primary hover:text-primary transition cursor-pointer"
          title="Import products from a JSON file (exported from this app's Data or Barcodes button)"
        >
          ⬆ Import
          <input
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importProducts(f);
              e.target.value = "";
            }}
          />
        </label>
        <button
          onClick={syncBilling}
          disabled={syncing}
          className="flex items-center gap-1.5 bg-card border border-border rounded-xl px-3 py-2 text-sm hover:border-primary hover:text-primary transition disabled:opacity-50"
          title="Pull latest products, barcodes, and images from the local billing server and push to Firebase"
        >
          {syncing ? "⏳ Syncing…" : "↻ Sync Billing"}
        </button>
        <button
          onClick={() => window.print()}
          className="hidden md:flex items-center gap-1.5 bg-card border border-border rounded-xl px-3 py-2 text-sm text-muted-foreground hover:border-primary hover:text-primary hover:bg-accent transition"
        >
          🖨 Print
        </button>
      </div>

      <main className="px-6 md:px-8 py-6 pb-20">
        <div
          className={
            view === "grid"
              ? "grid gap-4 grid-cols-[repeat(auto-fill,minmax(245px,1fr))]"
              : "flex flex-col gap-2"
          }
        >
          {filtered.map((p) => {
            const cur = getProduct(p.no, overrides, custom) ?? p;
            return (
              <ProductCard
                key={p.no}
                product={cur}
                image={images[p.no] || null}
                barcode={getBarcode(p.no, barcodes, custom)}
                view={view}
                flash={flashNo === p.no}
                onEdit={() => openEdit(p.no)}
                onScan={() => openProductScan(p.no)}
                onImageClick={() =>
                  images[p.no] && setLightbox({ src: images[p.no], name: cur.name })
                }
              />
            );
          })}
        </div>
        {filtered.length === 0 && (
          <div className="text-center py-20 text-muted-foreground">
            No products match your filters.
          </div>
        )}
      </main>

      <EditDialog
        open={editNo != null}
        product={editing}
        image={editingImage}
        barcode={editingBarcode}
        categories={categoryOptions}
        subCategoriesByCategory={subCategoriesByCategory}
        onClose={() => setEditNo(null)}
        onSave={handleSaveEdit}
        onGenerateImage={handleGenerate}
        generating={generating}
        onDelete={editingIsCustom && editNo != null ? () => handleDeleteCustom(editNo) : undefined}
      />

      {registerScanOpen && (
        <BarcodeScanner
          onDetected={handleRegisterBarcode}
          initialStream={scannerStream}
          onClose={() => {
            setRegisterScanOpen(false);
            setScannerStream(null);
          }}
        />
      )}

      {scanForNo != null && (
        <BarcodeScanner
          onDetected={(txt) => {
            const code = txt.trim();
            const no = scanForNo;
            setScanForNo(null);
            setScannerStream(null);
            if (!code || no == null) return;
            const nb = { ...barcodes, [no]: code };
            saveBarcodes(nb);
            setFlashNo(no);
            setTimeout(() => setFlashNo(null), 2400);
            toast.success(`Barcode ${code} saved`);
          }}
          initialStream={scannerStream}
          onClose={() => {
            setScanForNo(null);
            setScannerStream(null);
          }}
        />
      )}

      {quickReg && (
        <QuickRegisterDialog
          open={!!quickReg}
          no={quickReg.no}
          barcode={quickReg.barcode}
          isExisting={quickReg.existing}
          initialCategory={quickReg.category}
          initialSubCategory={quickReg.subCategory}
          initialName={quickReg.name}
          initialSize={quickReg.size}
          categories={categoryOptions}
          subCategoriesByCategory={subCategoriesByCategory}
          onClose={() => setQuickReg(null)}
          onSave={handleQuickRegSave}
        />
      )}



      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          className="fixed inset-0 z-[9500] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 cursor-zoom-out"
        >
          <button
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white text-lg grid place-items-center"
          >
            ✕
          </button>
          <figure
            className="max-w-[95vw] max-h-[92vh] flex flex-col items-center gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={lightbox.src}
              alt={lightbox.name}
              className="max-w-full max-h-[85vh] object-contain rounded-xl shadow-2xl bg-white"
            />
            <figcaption className="text-white/90 text-sm font-medium text-center">
              {lightbox.name}
            </figcaption>
          </figure>
        </div>
      )}
    </div>
  );
}

const sel =
  "bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary transition";

function Pill({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={`px-2.5 py-1 rounded-full bg-secondary border border-border text-[11px] font-medium ${className}`}
    >
      {children}
    </span>
  );
}
