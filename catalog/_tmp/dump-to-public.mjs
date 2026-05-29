import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, set } from "firebase/database";
import fs from "node:fs";
import path from "node:path";

const app = initializeApp({
  apiKey: "AIzaSyCamvdagAyxxmWVO3kOhRKO01tNyi4XCa4",
  databaseURL: "https://catalog-58ec8-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "catalog-58ec8",
});
const db = getDatabase(app);
const snap = await get(ref(db, "catalog/images"));
const v = snap.val() || {};
const outDir = "public/products";
fs.mkdirSync(outDir, { recursive: true });

const newMap = {};
let wrote = 0, kept = 0;
for (const [k, val] of Object.entries(v)) {
  if (typeof val !== "string") continue;
  if (val.startsWith("data:")) {
    const m = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(val);
    if (!m) { newMap[k] = val; continue; }
    const ext = m[1].includes("png") ? "png" : m[1].includes("webp") ? "webp" : "jpg";
    const file = `product_${String(k).padStart(3,"0")}.${ext}`;
    fs.writeFileSync(path.join(outDir, file), Buffer.from(m[2], "base64"));
    newMap[k] = `/products/${file}`;
    wrote++;
  } else {
    newMap[k] = val;
    kept++;
  }
}
console.log("wrote", wrote, "kept", kept);
fs.writeFileSync("_tmp/new-image-map.json", JSON.stringify(newMap, null, 2));
console.log("DB write pending — run with APPLY=1 to push");
if (process.env.APPLY === "1") {
  await set(ref(db, "catalog/images"), newMap);
  console.log("DB updated");
}
process.exit(0);
