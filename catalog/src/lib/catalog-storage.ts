import { PRODUCTS, type Product } from "@/data/products";

const KEY_OVERRIDES = "cs_po";
const KEY_IMAGES = "cs_imgs";
const KEY_BARCODES = "cs_bc";
const KEY_THEME = "cs_theme";
const KEY_CUSTOM = "cs_custom";

export type Override = Partial<Omit<Product, "no">>;
type Map<T> = Record<string, T>;

function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; }
  catch { return fallback; }
}
function writeJSON(key: string, val: unknown) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

export const store = {
  loadOverrides: () => readJSON<Map<Override>>(KEY_OVERRIDES, {}),
  saveOverrides: (v: Map<Override>) => writeJSON(KEY_OVERRIDES, v),
  loadImages: () => readJSON<Map<string>>(KEY_IMAGES, {}),
  saveImages: (v: Map<string>) => writeJSON(KEY_IMAGES, v),
  loadBarcodes: () => readJSON<Map<string>>(KEY_BARCODES, {}),
  saveBarcodes: (v: Map<string>) => writeJSON(KEY_BARCODES, v),
  loadCustom: () => readJSON<Map<Product>>(KEY_CUSTOM, {}),
  saveCustom: (v: Map<Product>) => writeJSON(KEY_CUSTOM, v),
};

export function getProduct(no: number, overrides: Map<Override>, custom: Map<Product> = {}): Product | null {
  const base = PRODUCTS.find(p => p.no === no) ?? custom[no];
  if (!base) return null;
  const ov = overrides[no] || {};
  return { ...base, ...ov };
}

export function getBarcode(no: number, barcodes: Map<string>, custom: Map<Product> = {}): string {
  if (barcodes[no] !== undefined) return barcodes[no] || "";
  const p = PRODUCTS.find(x => x.no === no) ?? custom[no];
  if (!p) return "";
  return (p.code && p.code !== "none" && p.code !== "--") ? p.code : "";
}

export const themeStore = {
  get: (): "light" | "dark" => {
    if (typeof window === "undefined") return "light";
    return (localStorage.getItem(KEY_THEME) as "light" | "dark") || "light";
  },
  set: (v: "light" | "dark") => { try { localStorage.setItem(KEY_THEME, v); } catch {} },
};
