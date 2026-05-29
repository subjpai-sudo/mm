// Mass image generator. Uses Lovable AI gateway + Firebase web SDK (same config as the app).
import { initializeApp } from "firebase/app";
import { getDatabase, ref as dbRef, get, update } from "firebase/database";
import { getStorage, ref as stRef, uploadString, getDownloadURL } from "firebase/storage";
import fs from "node:fs";

const firebaseConfig = {
  apiKey: "AIzaSyCamvdagAyxxmWVO3kOhRKO01tNyi4XCa4",
  authDomain: "catalog-58ec8.firebaseapp.com",
  databaseURL: "https://catalog-58ec8-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "catalog-58ec8",
  storageBucket: "catalog-58ec8.firebasestorage.app",
  messagingSenderId: "1055844775598",
  appId: "1:1055844775598:web:4a7d14594fc5498c2a1f3f",
};
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const storage = getStorage(app);

// Parse products from src/data/products.ts
const src = fs.readFileSync("src/data/products.ts", "utf8");
const PRODUCTS = [];
const re = /\{\s*no:(\d+),\s*name:"([^"]+)",\s*brand:"([^"]+)",\s*code:"([^"]*)",\s*origin:"([^"]+)",\s*size:"([^"]+)"/g;
let m; while ((m = re.exec(src))) PRODUCTS.push({ no:+m[1], name:m[2], brand:m[3], code:m[4], origin:m[5], size:m[6] });
console.log("Parsed products:", PRODUCTS.length);

// Existing images
const snap = await get(dbRef(db, "catalog/images"));
const existing = snap.val() || {};
const haveSet = new Set();
if (Array.isArray(existing)) existing.forEach((v,i)=>{ if(v) haveSet.add(i); });
else Object.entries(existing).forEach(([k,v])=>{ if(v) haveSet.add(+k); });
console.log("Already have:", haveSet.size);

const targets = PRODUCTS.filter(p => !haveSet.has(p.no));
console.log("To generate:", targets.length);

const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

async function fetchRefDataUrl(no) {
  const url = `https://catalog-58ec8.web.app/images/product_${String(no).padStart(3,"0")}.jpg`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const ct = r.headers.get("content-type") || "image/jpeg";
  if (!ct.startsWith("image/")) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  return `data:${ct};base64,${buf.toString("base64")}`;
}

async function genLovable(prompt, refDataUrl) {
  const content = [{ type: "text", text: prompt }];
  if (refDataUrl) content.push({ type: "image_url", image_url: { url: refDataUrl } });
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-image",
      messages: [{ role: "user", content }],
      modalities: ["image", "text"],
    }),
  });
  const d = await r.json().catch(()=>({}));
  const url = d?.choices?.[0]?.message?.images?.[0]?.image_url?.url
           || d?.choices?.[0]?.message?.images?.[0]?.url;
  return { ok: r.ok && !!url, status: r.status, url, err: d?.error?.message };
}

async function genGoogleDirect(prompt, refDataUrl) {
  const parts = [{ text: prompt }];
  if (refDataUrl) {
    const m = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(refDataUrl);
    if (m) parts.push({ inline_data: { mime_type: m[1], data: m[2] } });
  }
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent?key=${GEMINI_API_KEY}`,
    { method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ contents:[{role:"user",parts}], generationConfig:{responseModalities:["IMAGE","TEXT"]}}) }
  );
  const d = await r.json().catch(()=>({}));
  const cand = d?.candidates?.[0]?.content?.parts || [];
  for (const p of cand) {
    const inline = p?.inline_data || p?.inlineData;
    if (inline?.data) {
      const mime = inline.mime_type || inline.mimeType || "image/png";
      return { ok:true, status:r.status, url:`data:${mime};base64,${inline.data}` };
    }
  }
  return { ok:false, status:r.status, err:d?.error?.message };
}

async function uploadToStorage(no, dataUrl) {
  const ext = dataUrl.includes("image/png") ? "png" : dataUrl.includes("image/webp") ? "webp" : "jpg";
  const path = `products/product_${String(no).padStart(3,"0")}.${ext}`;
  const r = stRef(storage, path);
  await uploadString(r, dataUrl, "data_url");
  return await getDownloadURL(r);
}

async function processOne(p) {
  const prompt = `Using the provided reference photo of the actual product packaging, recreate it as a clean professional catalog product photograph. Preserve EXACTLY the brand name, label design, colors, typography, logos and packaging shape shown in the reference. Do not invent or change any text. Product: "${p.name}" by ${p.brand}, ${p.size}. Pure white seamless background, soft studio lighting, sharp focus, centered composition, commercial e-commerce quality.`;
  const ref = await fetchRefDataUrl(p.no);
  let g = await genLovable(prompt, ref);
  if (!g.ok) {
    console.warn(`  #${p.no} lovable fail (${g.status}): ${g.err || "?"} — try google direct`);
    g = await genGoogleDirect(prompt, ref);
  }
  if (!g.ok) throw new Error(`gen fail: ${g.status} ${g.err || ""}`);
  const finalUrl = await uploadToStorage(p.no, g.url);
  await update(dbRef(db, "catalog/images"), { [String(p.no)]: finalUrl });
  return finalUrl;
}

// concurrency
const CONC = 4;
let idx = 0, done = 0, failed = [];
async function worker(id) {
  while (idx < targets.length) {
    const p = targets[idx++];
    const t0 = Date.now();
    try {
      await processOne(p);
      done++;
      console.log(`[w${id}] ✓ #${p.no} ${p.name.slice(0,40)} (${Date.now()-t0}ms)  done=${done}/${targets.length}`);
    } catch (e) {
      failed.push(p.no);
      console.warn(`[w${id}] ✗ #${p.no}: ${e.message}`);
    }
  }
}
await Promise.all(Array.from({length:CONC}, (_,i)=>worker(i+1)));
console.log("\nFINISHED. done=", done, " failed=", failed.length, failed.slice(0,30));
process.exit(0);
