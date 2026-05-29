// Mass-generate AI catalog images for products missing a photo.
// Uses Lovable AI Gateway (Nano Banana) primarily; falls back to Google
// Gemini direct if Lovable returns non-OK (e.g. credit exhausted).
// Pulls from Firebase to know which products already have images, and
// merges custom products into the catalog. Saves results back to
// catalog/images as data URLs (matches existing pattern in massgen.mjs).
import { initializeApp } from "firebase/app";
import { getDatabase, ref as dbRef, get, update } from "firebase/database";
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

const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!LOVABLE_API_KEY && !GEMINI_API_KEY) {
  console.error("No LOVABLE_API_KEY or GEMINI_API_KEY available");
  process.exit(1);
}

// ---- parse static PRODUCTS from src/data/products.ts ----
const src = fs.readFileSync("src/data/products.ts", "utf8");
const PRODUCTS = [];
const re = /\{\s*no:(\d+),\s*name:"([^"]+)",\s*brand:"([^"]+)",\s*code:"([^"]*)",\s*origin:"([^"]+)",\s*size:"([^"]+)"/g;
let m;
while ((m = re.exec(src))) {
  PRODUCTS.push({ no: +m[1], name: m[2], brand: m[3], code: m[4], origin: m[5], size: m[6] });
}
console.log("Static products parsed:", PRODUCTS.length);

// ---- pull Firebase state ----
const [imgsSnap, ovSnap, custSnap] = await Promise.all([
  get(dbRef(db, "catalog/images")),
  get(dbRef(db, "catalog/overrides")),
  get(dbRef(db, "catalog/custom")),
]);
const images = imgsSnap.val() || {};
const overrides = ovSnap.val() || {};
const custom = custSnap.val() || {};

const haveSet = new Set();
const recordHave = (v, k) => { if (v && String(v).length > 10) haveSet.add(+k); };
if (Array.isArray(images)) images.forEach((v, i) => recordHave(v, i));
else Object.entries(images).forEach(([k, v]) => recordHave(v, k));
console.log("Already have images:", haveSet.size);

// Merge in custom products
const customList = Object.entries(custom).map(([k, v]) => ({ ...v, no: +k }));
const all = [...PRODUCTS, ...customList];

// Apply overrides (so latest name/brand/size wins)
const final = all.map((p) => {
  const ov = overrides[p.no] || overrides[String(p.no)] || {};
  return { ...p, ...ov };
});

// Skip ones with empty name (placeholder rows)
const targets = final.filter((p) => !haveSet.has(p.no) && p.name && p.name.trim() && p.name !== "New Product");
console.log("To generate:", targets.length);
if (targets.length === 0) { console.log("Nothing to do."); process.exit(0); }

// ---- generators ----
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
  const url = d?.choices?.[0]?.message?.images?.[0]?.image_url?.url
           || d?.choices?.[0]?.message?.images?.[0]?.url;
  return { ok: r.ok && !!url, status: r.status, url, err: d?.error?.message };
}

async function genGoogleDirect(prompt) {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
      }),
    },
  );
  const d = await r.json().catch(() => ({}));
  const cand = d?.candidates?.[0]?.content?.parts || [];
  for (const p of cand) {
    const inline = p?.inline_data || p?.inlineData;
    if (inline?.data) {
      const mime = inline.mime_type || inline.mimeType || "image/png";
      return { ok: true, status: r.status, url: `data:${mime};base64,${inline.data}` };
    }
  }
  return { ok: false, status: r.status, err: d?.error?.message || `HTTP ${r.status}` };
}

function promptFor(p) {
  const brand = p.brand || "(unbranded)";
  const origin = p.origin ? ` from ${p.origin}` : "";
  const size = p.size ? `, package size ${p.size}` : "";
  return `Professional product catalog photograph of "${p.name}" by ${brand}${origin}${size}. Pure white seamless background, soft studio lighting, sharp focus, centered composition, commercial e-commerce quality, no text overlay, no extra props.`;
}

async function processOne(p) {
  const prompt = promptFor(p);
  if (LOVABLE_API_KEY) {
    const g = await genLovable(prompt);
    if (g.ok && g.url) return g.url;
    if (g.status !== 402 && g.status !== 429) {
      // non-credit error — try google fallback anyway
    }
    console.warn(`  lovable failed #${p.no} (${g.status} ${g.err || ""}), trying google direct`);
  }
  if (GEMINI_API_KEY) {
    const g = await genGoogleDirect(prompt);
    if (g.ok && g.url) return g.url;
    throw new Error(`google fail: ${g.status} ${g.err || ""}`);
  }
  throw new Error("no provider succeeded");
}

// ---- worker pool ----
const CONC = 6;
let idx = 0, done = 0;
const failed = [];
async function worker(id) {
  while (idx < targets.length) {
    const p = targets[idx++];
    const t0 = Date.now();
    try {
      const url = await processOne(p);
      await update(dbRef(db, "catalog/images"), { [String(p.no)]: url });
      done++;
      console.log(`[w${id}] ✓ #${p.no} ${(p.brand || "").slice(0, 14).padEnd(14)} ${p.name.slice(0, 40)} (${Date.now() - t0}ms) done=${done}/${targets.length}`);
    } catch (e) {
      failed.push({ no: p.no, name: p.name, err: e.message });
      console.warn(`[w${id}] ✗ #${p.no} ${p.name}: ${e.message}`);
    }
  }
}
await Promise.all(Array.from({ length: CONC }, (_, i) => worker(i + 1)));
console.log(`\nFINISHED  done=${done}  failed=${failed.length}`);
if (failed.length) console.log("Failed:", failed.slice(0, 20));
process.exit(0);
