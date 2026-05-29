// Migrates Realtime DB + images from OLD firebase project to NEW project.
// - Copies catalog/overrides, catalog/barcodes, catalog/custom verbatim.
// - For catalog/images: uploads each image (base64 data URL OR https URL) to
//   NEW project's Storage as a real file (no resize, no recompress, original
//   bytes), then writes the new https URL into NEW project's catalog/images.
//
// Requirements:
//   - NEW project Realtime DB rules: { ".read": true, ".write": true }
//   - NEW project Storage rules: allow read, write: if true (temporary)
//   - OLD project Realtime DB rules: at least ".read": true
//
// Run:  node _tmp/migrate-firebase.mjs

import { initializeApp } from "firebase/app";
import { getDatabase, ref as dbRef, get, update, set as dbSet } from "firebase/database";
import { getStorage, ref as stRef, uploadBytes, getDownloadURL } from "firebase/storage";

const OLD = {
  apiKey: "AIzaSyCamvdagAyxxmWVO3kOhRKO01tNyi4XCa4",
  authDomain: "catalog-58ec8.firebaseapp.com",
  databaseURL: "https://catalog-58ec8-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "catalog-58ec8",
  storageBucket: "catalog-58ec8.firebasestorage.app",
  messagingSenderId: "1055844775598",
  appId: "1:1055844775598:web:4a7d14594fc5498c2a1f3f",
};

const NEW = {
  apiKey: "AIzaSyBF02Uctly222wJh42zOzx4CFq0BfE3LTE",
  authDomain: "migrate-86fa4.firebaseapp.com",
  databaseURL: "https://migrate-86fa4-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "migrate-86fa4",
  storageBucket: "migrate-86fa4.firebasestorage.app",
  messagingSenderId: "185038751234",
  appId: "1:185038751234:web:51eaf7763c02a9aa97091b",
};

const oldApp = initializeApp(OLD, "old");
const newApp = initializeApp(NEW, "new");
const oldDb = getDatabase(oldApp);
const newDb = getDatabase(newApp);
const newStorage = getStorage(newApp);

function extFromMime(mime) {
  if (!mime) return "jpg";
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "jpg";
}

function parseDataUrl(s) {
  const m = /^data:([a-z]+\/[a-z0-9+.-]+);base64,(.+)$/i.exec(s);
  if (!m) return null;
  return { mime: m[1], bytes: Buffer.from(m[2], "base64") };
}

async function fetchUrlBytes(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${r.status}`);
  const mime = r.headers.get("content-type") || "image/jpeg";
  const buf = Buffer.from(await r.arrayBuffer());
  return { mime, bytes: buf };
}

async function uploadOriginal(no, mime, bytes) {
  const ext = extFromMime(mime);
  const path = `products/product_${String(no).padStart(3, "0")}.${ext}`;
  const r = stRef(newStorage, path);
  await uploadBytes(r, bytes, { contentType: mime });
  return await getDownloadURL(r);
}

console.log("== Step 1: copy overrides / barcodes / custom ==");
for (const node of ["overrides", "barcodes", "custom"]) {
  const snap = await get(dbRef(oldDb, `catalog/${node}`));
  const val = snap.val();
  if (val == null) {
    console.log(`  ${node}: empty, skipping`);
    continue;
  }
  await dbSet(dbRef(newDb, `catalog/${node}`), val);
  const count = Array.isArray(val) ? val.length : Object.keys(val).length;
  console.log(`  ${node}: copied (${count} entries)`);
}

console.log("\n== Step 2: list OLD catalog/images keys (shallow) ==");
const shallowUrl = `${OLD.databaseURL}/catalog/images.json?shallow=true`;
const shallowRes = await fetch(shallowUrl);
if (!shallowRes.ok) throw new Error(`shallow fetch ${shallowRes.status}`);
const shallow = await shallowRes.json();
const keys = shallow ? Object.keys(shallow) : [];
console.log(`  found ${keys.length} image keys`);

async function fetchOldImage(k) {
  const r = await fetch(`${OLD.databaseURL}/catalog/images/${encodeURIComponent(k)}.json`);
  if (!r.ok) throw new Error(`old img fetch ${r.status}`);
  return await r.json();
}

const entries = keys.map(k => [k, null]); // value loaded lazily per worker

// Check what's already in NEW so we can resume (shallow keys only)
const newShallowRes = await fetch(`${NEW.databaseURL}/catalog/images.json?shallow=true`);
const newShallow = newShallowRes.ok ? (await newShallowRes.json()) || {} : {};
const todo = entries.filter(([k]) => !newShallow[k]);
console.log(`  already migrated: ${entries.length - todo.length}, to do: ${todo.length}`);

console.log("\n== Step 3: upload to NEW storage + update NEW db ==");
const CONC = 6;
let i = 0, done = 0, fail = 0, bytesIn = 0;
const failed = [];

async function worker(id) {
  while (i < todo.length) {
    const idx = i++;
    const [k] = todo[idx];
    try {
      const v = await fetchOldImage(k);
      let mime, bytes;
      if (typeof v === "string" && v.startsWith("data:")) {
        const p = parseDataUrl(v);
        if (!p) throw new Error("bad data url");
        mime = p.mime; bytes = p.bytes;
      } else if (typeof v === "string" && (/^https?:/i.test(v) || v.startsWith("/"))) {
        const url = v.startsWith("/") ? `https://catalog-58ec8.web.app${v}` : v;
        const f = await fetchUrlBytes(url);
        mime = f.mime; bytes = f.bytes;
      } else {
        throw new Error("unknown image value type: " + typeof v);
      }
      bytesIn += bytes.length;
      const url = await uploadOriginal(Number(k), mime, bytes);
      await update(dbRef(newDb, "catalog/images"), { [k]: url });
      done++;
      if (done % 10 === 0 || done === todo.length) {
        console.log(`  [w${id}] ${done}/${todo.length}  (${(bytesIn/1024/1024).toFixed(1)} MB read)`);
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
if (failed.length) console.log("failed keys:", failed.slice(0, 50));
process.exit(0);
