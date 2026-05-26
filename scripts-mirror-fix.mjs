import postgres from "postgres";
const sql = postgres(process.env.MIRROR_DB_URL, { ssl: "require", max: 1, prepare: false });
try {
  await sql.unsafe("ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;");
  console.log("ok: avatar_url added");
} catch (e) { console.error("fail:", e.message); process.exit(1); }
finally { await sql.end({ timeout: 5 }); }
