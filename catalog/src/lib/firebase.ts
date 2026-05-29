// Firebase sync layer — syncs catalog data + AI images to the user's Firebase project.
// Realtime Database stores overrides/barcodes/custom + image URL map.
// Storage hosts the generated AI images (so they're shared across devices + your live site).
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getDatabase, ref as dbRef, onValue, set as dbSet, update as dbUpdate } from "firebase/database";
import { getStorage, ref as stRef, uploadString, getDownloadURL } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyBF02Uctly222wJh42zOzx4CFq0BfE3LTE",
  authDomain: "migrate-86fa4.firebaseapp.com",
  databaseURL: "https://migrate-86fa4-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "migrate-86fa4",
  storageBucket: "migrate-86fa4.firebasestorage.app",
  messagingSenderId: "185038751234",
  appId: "1:185038751234:web:51eaf7763c02a9aa97091b",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
const db = getDatabase(app);
const storage = getStorage(app);

const ROOT = "catalog";
type AnyMap = Record<string, unknown>;

export const fb = {
  enabled: true,
  async pushMap(name: "overrides" | "images" | "barcodes" | "custom", value: AnyMap) {
    try { await dbSet(dbRef(db, `${ROOT}/${name}`), value || {}); } catch (e) { console.warn("fb push", name, e); }
  },
  async patchMap(name: "overrides" | "images" | "barcodes" | "custom", key: string, value: unknown) {
    try { await dbUpdate(dbRef(db, `${ROOT}/${name}`), { [key]: value ?? null }); } catch (e) { console.warn("fb patch", name, e); }
  },
  subscribeAll(cb: (snap: { overrides: AnyMap; images: AnyMap; barcodes: AnyMap; custom: AnyMap }) => void) {
    return onValue(dbRef(db, ROOT), s => {
      const val = (s.val() || {}) as Partial<{ overrides: AnyMap; images: AnyMap; barcodes: AnyMap; custom: AnyMap }>;
      cb({
        overrides: val.overrides || {},
        images: val.images || {},
        barcodes: val.barcodes || {},
        custom: val.custom || {},
      });
    });
  },
  async uploadImage(no: number, dataUrl: string): Promise<string> {
    // dataUrl is "data:image/png;base64,...." or already an https URL
    if (/^https?:/i.test(dataUrl)) return dataUrl;
    const m = dataUrl.match(/^data:(image\/[a-z+]+);base64,/i);
    const ext = m && m[1].includes("png") ? "png" : m && m[1].includes("webp") ? "webp" : "jpg";
    const path = `products/product_${String(no).padStart(3, "0")}.${ext}`;
    const r = stRef(storage, path);
    await uploadString(r, dataUrl, "data_url");
    return await getDownloadURL(r);
  },
};
