// Regenerate Myanmar catalog images using OLD catalog images as visual reference,
// so the new AI photos preserve the actual packaging, branding, and label design.
import { initializeApp } from "firebase/app";
import { getDatabase, ref as dbRef, update } from "firebase/database";
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
const OLD_HOST = "https://catalog-58ec8.web.app";

const src = fs.readFileSync("src/data/products.ts", "utf8");
const PRODUCTS = [];
const re = /\{\s*no:(\d+),\s*name:"([^"]+)",\s*brand:"([^"]+)",\s*code:"([^"]*)",\s*origin:"([^"]+)",\s*size:"([^"]+)"/g;
let m; while ((m = re.exec(src))) PRODUCTS.push({ no: +m[1], name: m[2], brand: m[3], code: m[4], origin: m[5], size: m[6] });

const targets = PRODUCTS.filter(p => p.origin === "Myanmar");
console.log("Myanmar targets:", targets.length);

// Fetch old image as data URL (so we can pass to image-input models)
async function fetchOldRef(no) {
  const padded = String(no).padStart(3, "0");
  for (const ext of ["jpg", "png", "webp"]) {
    const url = `${OLD_HOST}/images/product_${padded}.${ext}`;
    const r = await fetch(url);
    if (!r.ok) continue;
    const ct = r.headers.get("content-type") || "";
    if (!ct.startsWith("image/")) continue;
    const buf = Buffer.from(await r.arrayBuffer());
    return `data:${ct};base64,${buf.toString("base64")}`;
  }
  return null;
}

function prompt(p) {
  return `Recreate this exact product as a professional e-commerce catalog photograph. Keep the SAME packaging design, brand logos, label artwork, colors, typography, product shape and size exactly as shown in the reference image — do not invent new branding. Place the product on a pure white seamless background with soft even studio lighting, sharp focus, centered composition. Product: "${p.name}" by ${p.brand} (${p.size}). No text overlays, no extra props, no shadows behind, no watermark.`;
}

async function genLovable(p, refDataUrl) {
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-image",
      messages: [{ role: "user", content: [
        { type: "text", text: prompt(p) },
        { type: "image_url", image_url: { url: refDataUrl } },
      ] }],
      modalities: ["image", "text"],
    }),
  });
  const d = await r.json().catch(() => ({}));
  const url = d?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  return { ok: r.ok && !!url, status: r.status, url, err: d?.error?.message };
}

async function genGoogle(p, refDataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(refDataUrl);
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GEMINI_API_KEY}`,
    { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [
          { text: prompt(p) },
          { inline_data: { mime_type: m[1], data: m[2] } },
        ] }],
        generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
      }) },
  );
  const d = await r.json().catch(() => ({}));
  for (const part of d?.candidates?.[0]?.content?.parts || []) {
    const inline = part?.inline_data || part?.inlineData;
    if (inline?.data) return { ok: true, url: `data:${inline.mime_type || inline.mimeType || "image/png"};base64,${inline.data}` };
  }
  return { ok: false, err: d?.error?.message || `HTTP ${r.status}` };
}

async function uploadDataUrl(no, dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  const mime = m[1]; const bytes = Buffer.from(m[2], "base64");
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
  const path = `products/product_${String(no).padStart(3, "0")}.${ext}`;
  const r = stRef(storage, path);
  await uploadBytes(r, bytes, { contentType: mime });
  return await getDownloadURL(r);
}

const CONC = 6;
let i = 0, done = 0, fail = 0, noref = 0;
const failed = [];
async function worker(id) {
  while (i < targets.length) {
    const p = targets[i++];
    const t0 = Date.now();
    try {
      const ref = await fetchOldRef(p.no);
      if (!ref) { noref++; console.warn(`[w${id}] · #${p.no} no old ref, skip`); continue; }
      let g = null;
      if (LOVABLE_API_KEY) {
        g = await genLovable(p, ref);
        if (!g.ok) console.warn(`  lovable ${g.status} ${g.err || ""} — fallback google`);
      }
      if (!g || !g.ok) g = await genGoogle(p, ref);
      if (!g.ok) throw new Error(g.err || "gen failed");
      const url = await uploadDataUrl(p.no, g.url);
      await update(dbRef(db, "catalog/images"), { [String(p.no)]: url });
      done++;
      console.log(`[w${id}] ✓ #${p.no} ${p.name.slice(0,38)} (${Date.now()-t0}ms) ${done}/${targets.length}`);
    } catch (e) {
      fail++; failed.push({ no: p.no, err: e.message });
      console.warn(`[w${id}] ✗ #${p.no}: ${e.message}`);
    }
  }
}
await Promise.all(Array.from({ length: CONC }, (_, n) => worker(n + 1)));
console.log(`\nDONE done=${done} fail=${fail} noref=${noref}`);
if (failed.length) console.log("failed:", failed.slice(0, 30));
process.exit(0);
