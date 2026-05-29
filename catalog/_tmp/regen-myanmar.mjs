// Regenerate AI catalog images for all Myanmar products and upload to NEW
// Firebase Storage, then update catalog/images with the storage URL.
import { initializeApp } from "firebase/app";
import { getDatabase, ref as dbRef, get, update } from "firebase/database";
import { getStorage, ref as stRef, uploadBytes, getDownloadURL } from "firebase/storage";
import fs from "node:fs";

const NEW = {
  apiKey: "AIzaSyBF02Uctly222wJh42zOzx4CFq0BfE3LTE",
  authDomain: "migrate-86fa4.firebaseapp.com",
  databaseURL: "https://migrate-86fa4-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "migrate-86fa4",
  storageBucket: "migrate-86fa4.firebasestorage.app",
  messagingSenderId: "185038751234",
  appId: "1:185038751234:web:51eaf7763c02a9aa97091b",
};
const app = initializeApp(NEW);
const db = getDatabase(app);
const storage = getStorage(app);

const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Parse static products
const src = fs.readFileSync("src/data/products.ts", "utf8");
const PRODUCTS = [];
const re = /\{\s*no:(\d+),\s*name:"([^"]+)",\s*brand:"([^"]+)",\s*code:"([^"]*)",\s*origin:"([^"]+)",\s*size:"([^"]+)"/g;
let m;
while ((m = re.exec(src))) {
  PRODUCTS.push({ no: +m[1], name: m[2], brand: m[3], code: m[4], origin: m[5], size: m[6] });
}

const [ovSnap, custSnap] = await Promise.all([
  get(dbRef(db, "catalog/overrides")),
  get(dbRef(db, "catalog/custom")),
]);
const overrides = ovSnap.val() || {};
const custom = custSnap.val() || {};
const customList = Object.entries(custom).map(([k, v]) => ({ ...v, no: +k }));
const all = [...PRODUCTS, ...customList].map((p) => ({ ...p, ...(overrides[p.no] || overrides[String(p.no)] || {}) }));

const targets = all.filter((p) => p.origin === "Myanmar" && p.name && p.name.trim());
console.log("Myanmar targets:", targets.length);

async function genLovable(prompt) {
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-image",
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
      modalities: ["image", "text"],
    }),
  });
  const d = await r.json().catch(() => ({}));
  const url = d?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  return { ok: r.ok && !!url, status: r.status, url, err: d?.error?.message };
}
async function genGoogle(prompt) {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GEMINI_API_KEY}`,
    { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["IMAGE", "TEXT"] } }) },
  );
  const d = await r.json().catch(() => ({}));
  for (const p of d?.candidates?.[0]?.content?.parts || []) {
    const inline = p?.inline_data || p?.inlineData;
    if (inline?.data) {
      const mime = inline.mime_type || inline.mimeType || "image/png";
      return { ok: true, url: `data:${mime};base64,${inline.data}` };
    }
  }
  return { ok: false, err: d?.error?.message || `HTTP ${r.status}` };
}

function promptFor(p) {
  const brand = p.brand || "(unbranded)";
  const size = p.size ? `, package size ${p.size}` : "";
  return `Professional product catalog photograph of "${p.name}" by ${brand} from Myanmar${size}. Pure white seamless background, soft studio lighting, sharp focus, centered composition, commercial e-commerce quality, no text overlay, no extra props.`;
}

async function generate(p) {
  if (LOVABLE_API_KEY) {
    const g = await genLovable(promptFor(p));
    if (g.ok) return g.url;
    console.warn(`  lovable ${g.status} ${g.err || ""} — fallback google`);
  }
  if (GEMINI_API_KEY) {
    const g = await genGoogle(promptFor(p));
    if (g.ok) return g.url;
    throw new Error(`google: ${g.err}`);
  }
  throw new Error("no provider");
}

async function uploadDataUrl(no, dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error("bad data url");
  const mime = m[1];
  const bytes = Buffer.from(m[2], "base64");
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
  const path = `products/product_${String(no).padStart(3, "0")}.${ext}`;
  const r = stRef(storage, path);
  await uploadBytes(r, bytes, { contentType: mime });
  return await getDownloadURL(r);
}

const CONC = 6;
let i = 0, done = 0, fail = 0;
const failed = [];
async function worker(id) {
  while (i < targets.length) {
    const p = targets[i++];
    const t0 = Date.now();
    try {
      const dataUrl = await generate(p);
      const url = await uploadDataUrl(p.no, dataUrl);
      await update(dbRef(db, "catalog/images"), { [String(p.no)]: url });
      done++;
      console.log(`[w${id}] ✓ #${p.no} ${p.name.slice(0,40)} (${Date.now()-t0}ms) ${done}/${targets.length}`);
    } catch (e) {
      fail++; failed.push({ no: p.no, err: e.message });
      console.warn(`[w${id}] ✗ #${p.no}: ${e.message}`);
    }
  }
}
await Promise.all(Array.from({ length: CONC }, (_, n) => worker(n + 1)));
console.log(`\nDONE done=${done} fail=${fail}`);
if (failed.length) console.log("failed:", failed);
process.exit(0);
