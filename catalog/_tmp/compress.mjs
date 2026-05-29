import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, update } from "firebase/database";
import sharp from "sharp";

const app = initializeApp({
  apiKey: "AIzaSyCamvdagAyxxmWVO3kOhRKO01tNyi4XCa4",
  databaseURL: "https://catalog-58ec8-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "catalog-58ec8",
});
const db = getDatabase(app);

const snap = await get(ref(db, "catalog/images"));
const v = snap.val() || {};
const entries = Object.entries(v).filter(([, val]) => typeof val === "string" && val.startsWith("data:"));
console.log("to compress:", entries.length);

const CONC = 8;
let i = 0, done = 0, saved = 0, before = 0, after = 0, fail = 0;

async function worker() {
  while (i < entries.length) {
    const idx = i++;
    const [k, dataUrl] = entries[idx];
    try {
      const m = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(dataUrl);
      if (!m) { fail++; continue; }
      const buf = Buffer.from(m[2], "base64");
      before += buf.length;
      // skip if already small
      if (buf.length < 60_000) { after += buf.length; done++; continue; }
      const out = await sharp(buf)
        .resize(640, 640, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 78, mozjpeg: true })
        .toBuffer();
      after += out.length;
      const newUrl = `data:image/jpeg;base64,${out.toString("base64")}`;
      await update(ref(db, "catalog/images"), { [k]: newUrl });
      saved++;
      done++;
      if (done % 20 === 0) console.log(`${done}/${entries.length}  saved=${saved}  before=${(before/1024/1024).toFixed(1)}MB  after=${(after/1024/1024).toFixed(1)}MB`);
    } catch (e) {
      fail++;
      console.warn("fail", k, e.message);
    }
  }
}
await Promise.all(Array.from({ length: CONC }, () => worker()));
console.log("DONE", { done, saved, fail, beforeMB: (before/1024/1024).toFixed(1), afterMB: (after/1024/1024).toFixed(1) });
process.exit(0);
