// Re-upload images using the correct /images/ path on old hosting.
// Old DB values are "/products/product_NNN.jpg" but real files live at "/images/product_NNN.jpg".
// Previous migration uploaded the SPA HTML fallback as image bytes. Fix: re-fetch + overwrite.

import { initializeApp } from "firebase/app";
import { getDatabase, ref as dbRef, update } from "firebase/database";
import { getStorage, ref as stRef, uploadBytes, getDownloadURL } from "firebase/storage";

const NEW = {
  apiKey: "AIzaSyBF02Uctly222wJh42zOzx4CFq0BfE3LTE",
  authDomain: "migrate-86fa4.firebaseapp.com",
  databaseURL: "https://migrate-86fa4-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "migrate-86fa4",
  storageBucket: "migrate-86fa4.firebasestorage.app",
  messagingSenderId: "185038751234",
  appId: "1:185038751234:web:51eaf7763c02a9aa97091b",
};
const app = initializeApp(NEW, "new");
const db = getDatabase(app);
const storage = getStorage(app);

const OLD_DB = "https://catalog-58ec8-default-rtdb.asia-southeast1.firebasedatabase.app";
const OLD_HOST = "https://catalog-58ec8.web.app";

console.log("Listing image keys from OLD db (shallow)...");
const sh = await (await fetch(`${OLD_DB}/catalog/images.json?shallow=true`)).json();
const keys = Object.keys(sh || {});
console.log("keys:", keys.length);

async function fetchImage(no) {
  const padded = String(no).padStart(3, "0");
  // Try .jpg then .png then .webp
  for (const ext of ["jpg", "png", "webp"]) {
    const url = `${OLD_HOST}/images/product_${padded}.${ext}`;
    const r = await fetch(url);
    if (!r.ok) continue;
    const ct = r.headers.get("content-type") || "";
    if (!ct.startsWith("image/")) continue;
    return { mime: ct, bytes: Buffer.from(await r.arrayBuffer()), ext };
  }
  // Fallback: maybe old DB stored a data URL or absolute URL
  const v = await (await fetch(`${OLD_DB}/catalog/images/${no}.json`)).json();
  if (typeof v === "string" && v.startsWith("data:")) {
    const m = /^data:([^;]+);base64,(.+)$/.exec(v);
    if (m) {
      const ext = m[1].includes("png") ? "png" : m[1].includes("webp") ? "webp" : "jpg";
      return { mime: m[1], bytes: Buffer.from(m[2], "base64"), ext };
    }
  }
  if (typeof v === "string" && /^https?:/i.test(v)) {
    const r = await fetch(v);
    if (r.ok) {
      const ct = r.headers.get("content-type") || "image/jpeg";
      const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
      return { mime: ct, bytes: Buffer.from(await r.arrayBuffer()), ext };
    }
  }
  throw new Error("no image source found");
}

const CONC = 8;
let i = 0, done = 0, fail = 0, bytesIn = 0;
const failed = [];

async function worker(id) {
  while (i < keys.length) {
    const k = keys[i++];
    try {
      const img = await fetchImage(k);
      bytesIn += img.bytes.length;
      const path = `products/product_${String(k).padStart(3, "0")}.${img.ext}`;
      const r = stRef(storage, path);
      await uploadBytes(r, img.bytes, { contentType: img.mime });
      const url = await getDownloadURL(r);
      await update(dbRef(db, "catalog/images"), { [k]: url });
      done++;
      if (done % 20 === 0 || done === keys.length) {
        console.log(`  [w${id}] ${done}/${keys.length}  ${(bytesIn / 1024 / 1024).toFixed(1)} MB`);
      }
    } catch (e) {
      fail++;
      failed.push(k);
      console.warn(`  [w${id}] ✗ #${k}: ${e.message}`);
    }
  }
}

await Promise.all(Array.from({ length: CONC }, (_, n) => worker(n + 1)));
console.log(`\nDONE. uploaded=${done}  failed=${fail}`);
if (failed.length) console.log("failed:", failed.slice(0, 50));
process.exit(0);
