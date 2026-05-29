#!/usr/bin/env node
// ============================================================
// MIGRATION SCRIPT — imports all data into new Supabase project
// Run: node 02_migrate.js
// Requires: npm install @supabase/supabase-js (already in project)
// ============================================================

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { parse } from "path";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const NEW_URL = "https://zibglqqauuaqwthceqcq.supabase.co";
const NEW_SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InppYmdscXFhdXVhcXd0aGNlcWNxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDAwMDQ2NSwiZXhwIjoyMDk1NTc2NDY1fQ.FOX533Jja5L-bl5E8r1xVADmZ7Zvxd5FUyIqixY4j-0";

const supabase = createClient(NEW_URL, NEW_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

// ── CSV parser ────────────────────────────────────────────────
function parseCSV(filename) {
  const content = readFileSync(path.join(__dirname, filename), "utf8");
  const lines = content.trim().split("\n");
  const headers = lines[0].split(",").map(h => h.trim());
  return lines.slice(1).map(line => {
    const values = [];
    let cur = "", inQuotes = false;
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; }
      else if (ch === "," && !inQuotes) { values.push(cur); cur = ""; }
      else { cur += ch; }
    }
    values.push(cur);
    const row = {};
    headers.forEach((h, i) => {
      const v = (values[i] ?? "").trim();
      row[h] = v === "" ? null : v;
    });
    return row;
  });
}

// ── helpers ───────────────────────────────────────────────────
function bool(v) { return v === "t" || v === "true" || v === "1"; }
function num(v)  { return v === null ? null : Number(v); }

async function insert(table, rows) {
  if (!rows.length) { console.log(`  ⚪ ${table}: 0 rows`); return; }
  const { error } = await supabase.from(table).insert(rows);
  if (error) {
    console.error(`  ❌ ${table}: ${error.message}`);
    console.error("     First row:", JSON.stringify(rows[0]));
  } else {
    console.log(`  ✅ ${table}: ${rows.length} rows`);
  }
}

// ── Step 1: Create auth users with matching UUIDs ─────────────
async function createUsers() {
  console.log("\n── Creating auth users ──────────────────────────────");

  const users = [
    // Real users — temp PIN "111111" (tell them to change after login)
    { id: "9d1a103f-daec-4618-88c0-6145edaab6c3", email: "anique@stockflow.local",   password: "111111", name: "Anique" },
    { id: "25e44eab-d85e-44d7-b43c-5e0aef8c8b4d", email: "owner@stockflow.local",    password: "111111", name: "Owner" },
    { id: "4c03df48-4e59-4534-88c9-7ca90090df40", email: "admin@stockflow.local",    password: "111111", name: "Admin" },
    { id: "5aa7f9a7-b67d-45f1-9d33-0b274216cbdc", email: "aniq@stockflow.local",     password: "111111", name: "Aniq" },
    // Demo users — keep original demo password
    { id: "7badd226-0090-4ff2-b8c7-52e2f16f1e52", email: "admin@demo.app",    password: "demo12345", name: "Demo Admin" },
    { id: "1fdad356-66fc-4fc3-81a8-d4665b2ba439", email: "operator@demo.app", password: "demo12345", name: "Demo Operator" },
    { id: "92ddf09d-df8d-4489-9b26-cd8bf6133274", email: "owner@demo.app",    password: "demo12345", name: "Demo Owner" },
  ];

  for (const u of users) {
    const { error } = await supabase.auth.admin.createUser({
      user_metadata: { full_name: u.name },
      email:         u.email,
      password:      u.password,
      id:            u.id,
      email_confirm: true,   // skip email verification
    });
    if (error && !error.message.includes("already been registered")) {
      console.error(`  ❌ ${u.email}: ${error.message}`);
    } else {
      console.log(`  ✅ ${u.email} (${u.id.slice(0,8)}…)`);
    }
  }
}

// ── Step 2: Import data tables ────────────────────────────────
async function importData() {
  console.log("\n── Importing data tables ────────────────────────────");

  // 1. app_settings
  const settings = parseCSV("app_settings.csv").map(r => ({
    id:                1,
    viber_bot_token:   r.viber_bot_token,
    viber_owner_id:    r.viber_owner_id,
    viber_webhook_url: r.viber_webhook_url,
    viber_sender:      r.viber_sender,
    infobip_base_url:  r.infobip_base_url,
    owner_phone:       r.owner_phone,
    twilio_from:       r.twilio_from,
    updated_at:        r.updated_at,
  }));
  await insert("app_settings", settings);

  // 2. categories (two-pass: parents first, then children)
  const rawCats = parseCSV("categories.csv");
  const parents  = rawCats.filter(r => !r.parent_id).map(r => ({ id: r.id, name: r.name, parent_id: null, created_at: r.created_at }));
  const children = rawCats.filter(r =>  r.parent_id).map(r => ({ id: r.id, name: r.name, parent_id: r.parent_id, created_at: r.created_at }));
  await insert("categories", parents);
  if (children.length) await insert("categories", children);

  // 3. racks
  const racks = parseCSV("racks.csv").map(r => ({
    id: r.id, code: r.code, name: r.name || r.code,
    created_at: r.created_at, updated_at: r.updated_at,
  }));
  await insert("racks", racks);

  // 4. products
  const products = parseCSV("products.csv").map(r => ({
    id:                    r.id,
    sku:                   r.sku,
    barcode:               r.barcode,
    barcode_registered_by: r.barcode_registered_by,
    barcode_registered_at: r.barcode_registered_at,
    name:                  r.name,
    brand:                 r.brand,
    origin:                r.origin,
    size:                  r.size,
    unit:                  r.unit,
    category_id:           r.category_id,
    price:                 num(r.price) ?? 0,
    price_10:              num(r.price_10),
    price_case:            num(r.price_case),
    pcs_per_case:          num(r.pcs_per_case),
    stock:                 num(r.stock) ?? 0,
    low_stock_threshold:   num(r.low_stock_threshold) ?? 5,
    last_alert_stock:      num(r.last_alert_stock),
    rack:                  r.rack,
    shelf:                 r.shelf,
    image_url:             r.image_url,
    created_at:            r.created_at,
    updated_at:            r.updated_at,
  }));
  // insert in batches of 200 to avoid payload limits
  for (let i = 0; i < products.length; i += 200) {
    const batch = products.slice(i, i + 200);
    const { error } = await supabase.from("products").insert(batch);
    if (error) { console.error(`  ❌ products batch ${i}: ${error.message}`); }
    else { console.log(`  ✅ products: rows ${i + 1}–${i + batch.length}`); }
  }

  // 5. profiles (users must exist in auth first — step 1 handles that)
  const profiles = parseCSV("profiles.csv").map(r => ({
    id:              r.id,
    email:           r.email,
    full_name:       r.full_name,
    phone:           r.phone,
    avatar_url:      r.avatar_url,
    must_change_pin: bool(r.must_change_pin),
    created_at:      r.created_at,
  }));
  await insert("profiles", profiles);

  // 6. user_roles
  const roles = parseCSV("user_roles.csv").map(r => ({
    id: r.id, user_id: r.user_id, role: r.role, created_at: r.created_at,
  }));
  await insert("user_roles", roles);

  // 7. stock_movements
  const movements = parseCSV("stock_movements.csv").map(r => ({
    id: r.id, product_id: r.product_id, type: r.type,
    quantity: num(r.quantity), reason: r.reason,
    destination: r.destination, user_id: r.user_id, created_at: r.created_at,
  }));
  await insert("stock_movements", movements);

  // 8. order_requests
  const orders = parseCSV("order_requests.csv").map(r => ({
    id:                    r.id,
    type:                  r.type,
    product_name:          r.product_name,
    quantity:              num(r.quantity),
    notes:                 r.notes,
    viber_message:         r.viber_message,
    status:                r.status || "pending",
    created_by:            r.created_by,
    decided_by:            r.decided_by,
    product_id:            r.product_id,
    category_id:           r.category_id,
    container_date:        r.container_date,
    expected_arrival_date: r.expected_arrival_date,
    arrived_at:            r.arrived_at,
    created_at:            r.created_at,
  }));
  await insert("order_requests", orders);

  // 9. audit_logs
  const audits = parseCSV("audit_logs.csv").map(r => ({
    id: r.id, action: r.action, actor_id: r.actor_id, actor_email: r.actor_email,
    target_id: r.target_id, target_label: r.target_label,
    details: r.details ? JSON.parse(r.details) : {},
    created_at: r.created_at,
  }));
  await insert("audit_logs", audits);

  // 10. backup_log
  const backups = parseCSV("backup_log.csv").map(r => ({
    id: r.id, status: r.status, triggered_by: r.triggered_by,
    file_path: r.file_path, size_bytes: num(r.size_bytes), error: r.error,
    started_at: r.started_at, finished_at: r.finished_at,
  }));
  await insert("backup_log", backups);
}

// ── Run ───────────────────────────────────────────────────────
async function main() {
  console.log("🚀 Starting migration to new Supabase project");
  console.log("   URL:", NEW_URL);
  await createUsers();
  await importData();
  console.log("\n✅ Migration complete!");
  console.log("\n📋 Temporary PINs for real users:");
  console.log("   anique / aniq / admin / owner  →  PIN: 111111");
  console.log("   demo users                     →  Password: demo12345");
  console.log("\n⚠️  Tell users to change their PIN after first login.");
}

main().catch(console.error);
