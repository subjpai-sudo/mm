import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  getDatabase, ref, set, push, remove,
  onValue, get, off, type Database, type Unsubscribe,
} from "firebase/database";
import { getAuth, signInAnonymously } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBF02Uctly222wJh42zOzx4CFq0BfE3LTE",
  authDomain: "migrate-86fa4.firebaseapp.com",
  databaseURL: "https://migrate-86fa4-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "migrate-86fa4",
  storageBucket: "migrate-86fa4.firebasestorage.app",
  messagingSenderId: "185038751234",
  appId: "1:185038751234:web:51eaf7763c02a9aa97091b",
};

const ROOT = "billing";

// ── Lazy client-side init ──────────────────────────────────────────────────────
// All Firebase code is deferred until first use so SSR (Cloudflare Worker)
// never touches browser-only APIs (localStorage, indexedDB, etc.)
let _app: FirebaseApp | null = null;
let _db: Database | null = null;
let _authReady = false;

function getDB(): Database {
  if (_db) return _db;
  if (typeof window === "undefined") throw new Error("Firebase not available during SSR");
  _app = getApps().find(a => a.name === "billing") ?? initializeApp(firebaseConfig, "billing");
  _db  = getDatabase(_app);
  if (!_authReady) {
    _authReady = true;
    signInAnonymously(getAuth(_app)).catch(() => {});
  }
  return _db;
}

// ── Default stores (seed on first use) ────────────────────────────────────────
const DEFAULT_STORES: BillingStore[] = [
  { id: "mm_kita_otsuka",  name: "MM-MART", sub: "Kita Otsuka",   address: "東京都豊島区北大塚3-32-3(201)",           tel: "03-6903-6174", zip: "170-0004" },
  { id: "mm_takadano",     name: "MM-MART", sub: "Takadano Baba", address: "東京都新宿区高田馬場4丁目9-14 岩ビル1階", tel: "03-6768-0683", zip: "169-0075" },
  { id: "mm_minami",       name: "MM-MART", sub: "Minami Otsuka", address: "東京都豊島区南大塚",                       tel: "",             zip: "170-0005" },
  { id: "mm_higashi_jujo", name: "MM-MART", sub: "Higashi Jujo",  address: "東京都北区東十条",                         tel: "",             zip: "114-0003" },
  { id: "mm_sugamo",       name: "MM-MART", sub: "Sugamo",        address: "東京都豊島区巣鴨",                         tel: "",             zip: "170-0002" },
  { id: "mm_kawaguchi",    name: "MM-MART", sub: "Kawaguchi",     address: "埼玉県川口市",                             tel: "",             zip: "332-0000" },
  { id: "mm_komagome",     name: "MM-MART", sub: "Komagome",      address: "東京都豊島区駒込",                         tel: "",             zip: "170-0003" },
];

// ── Types ─────────────────────────────────────────────────────────────────────
export interface BillingStore {
  id: string; name: string; sub: string | null;
  address: string | null; tel: string | null; zip: string | null;
  email?: string | null;
}
export interface BillingCustomer {
  id: string; name: string; company: string | null;
  address: string | null; tel: string | null; email?: string | null; notes?: string | null;
}
export interface BillingInvoice {
  id: string; store_id: string | null; bill_to_type: string;
  bill_to_store_id: string | null; customer_id: string | null;
  invoice_no: string | null; date: string; items: any[];
  tax_rate: number; discount: number; subtotal: number; tax: number; total: number;
  created_at: string; created_by?: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function rpath(...parts: string[]) { return ref(getDB(), [ROOT, ...parts].join("/")); }

function snapToArray<T extends { id: string }>(snap: any): T[] {
  const val = snap.val();
  if (!val) return [];
  return Object.entries(val).map(([id, v]: any) => ({ id, ...v })) as T[];
}

/** Strip undefined values — Firebase RTDB rejects them */
function clean(obj: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

// ── Stores ────────────────────────────────────────────────────────────────────
export async function fbGetStores(): Promise<BillingStore[]> {
  const snap = await get(rpath("stores"));
  if (!snap.exists()) {
    const obj: Record<string, any> = {};
    DEFAULT_STORES.forEach(s => { const { id, ...rest } = s; obj[id] = rest; });
    await set(rpath("stores"), obj);
    return DEFAULT_STORES;
  }
  return snapToArray<BillingStore>(snap);
}

export async function fbSaveStore(store: BillingStore): Promise<void> {
  const { id, ...rest } = store;
  await set(rpath("stores", id), clean(rest));
}

export async function fbDeleteStore(id: string): Promise<void> {
  await remove(rpath("stores", id));
}

// ── Customers ─────────────────────────────────────────────────────────────────
export async function fbGetCustomers(): Promise<BillingCustomer[]> {
  const snap = await get(rpath("customers"));
  return snapToArray<BillingCustomer>(snap);
}

export function fbSubscribeCustomers(cb: (list: BillingCustomer[]) => void): Unsubscribe {
  const r = rpath("customers");
  onValue(r, snap => cb(snapToArray<BillingCustomer>(snap)));
  return () => off(r);
}

export async function fbSaveCustomer(customer: BillingCustomer): Promise<BillingCustomer> {
  if (customer.id) {
    const { id, ...rest } = customer;
    await set(rpath("customers", id), clean(rest));
    return customer;
  }
  const newRef = push(rpath("customers"));
  const id     = newRef.key!;
  const { id: _discarded, ...rest } = customer;
  await set(newRef, clean(rest));
  return { ...customer, id };
}

export async function fbDeleteCustomer(id: string): Promise<void> {
  await remove(rpath("customers", id));
}

// ── Invoices ──────────────────────────────────────────────────────────────────
export async function fbSaveInvoice(
  inv: Omit<BillingInvoice, "id" | "created_at"> & { id?: string; created_at?: string }
): Promise<BillingInvoice> {
  const { id: existingId, ...fields } = inv as any;
  const data = clean(fields);

  if (existingId) {
    await set(rpath("invoices", existingId), { ...data, updated_at: new Date().toISOString() });
    return { id: existingId, ...data } as BillingInvoice;
  }

  const newRef  = push(rpath("invoices"));
  const id      = newRef.key!;
  const payload = { ...data, created_at: new Date().toISOString() };
  await set(newRef, payload);
  return { id, ...payload } as BillingInvoice;
}

export async function fbGetInvoices(): Promise<BillingInvoice[]> {
  const snap = await get(rpath("invoices"));
  return snapToArray<BillingInvoice>(snap).sort((a, b) => b.date.localeCompare(a.date));
}

export function fbSubscribeInvoices(cb: (list: BillingInvoice[]) => void): Unsubscribe {
  const r = rpath("invoices");
  onValue(r, snap => cb(snapToArray<BillingInvoice>(snap).sort((a, b) => b.date.localeCompare(a.date))));
  return () => off(r);
}

export async function fbDeleteInvoice(id: string): Promise<void> {
  await remove(rpath("invoices", id));
}
