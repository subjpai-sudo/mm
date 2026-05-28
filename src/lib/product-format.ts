export const SIZE_UNITS = ["g", "kg", "ml", "L", "pcs"] as const;
export type SizeUnit = (typeof SIZE_UNITS)[number];

/** Pull the numeric value and unit out of stored product fields.
 * Handles legacy values like "160g" stored in `size` with no separate unit. */
export function parseSize(size?: string | null, unit?: string | null): { num: string; unit: string } {
  const sz = (size ?? "").trim();
  const u = (unit ?? "").trim();
  if (!sz) return { num: "", unit: u };
  const m = sz.match(/^([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z]*)$/);
  if (m) return { num: m[1], unit: (m[2] || u).trim() };
  return { num: sz, unit: u };
}

/** Compose a human-readable size string like "400 g". */
export function displaySize(p: { size?: string | null; unit?: string | null }): string {
  const { num, unit } = parseSize(p.size, p.unit);
  if (!num && !unit) return "";
  if (!num) return unit;
  return `${num}${unit ? ` ${unit}` : ""}`;
}

/** Format current stock as "X boxes + Y pcs" when pcs_per_case is set.
 *  Returns plain number string when no pcs_per_case. */
export function displayStock(p: { stock?: number | null; pcs_per_case?: number | null }): string {
  const stock = p.stock ?? 0;
  const ppc = p.pcs_per_case;
  if (!ppc || ppc < 2) return String(stock);
  if (stock <= 0) return "0";
  const boxes = Math.floor(stock / ppc);
  const rem = stock % ppc;
  if (boxes === 0) return `${rem} pcs`;
  if (rem === 0) return `${boxes} box${boxes !== 1 ? "es" : ""}`;
  return `${boxes} box${boxes !== 1 ? "es" : ""} + ${rem} pcs`;
}

/** Try to extract a size + unit token from a free-form product name.
 *  Examples: "Fish Sauce 700ml" → { size: "700", unit: "ml" }
 *            "Coconut Milk 1L"  → { size: "1",   unit: "L"  }
 *            "Rice 5 kg Bag"    → { size: "5",   unit: "kg" }
 *  Returns null when no size-like token is found. */
export function extractSizeFromName(
  name?: string | null
): { size: string; unit: string } | null {
  const n = (name ?? "").trim();
  if (!n) return null;
  // Match number (optionally decimal) followed by an optional space and a unit.
  const re = /(\d+(?:\.\d+)?)\s*(kg|g|mg|ml|cl|l|oz|lbs?|pcs|pc|ct)\b/i;
  const m = n.match(re);
  if (!m) return null;
  const raw = m[2].toLowerCase();
  // Normalize unit casing: liters as "L", everything else lowercase.
  const unit = raw === "l" ? "L" : raw === "lbs" ? "lb" : raw === "pc" ? "pcs" : raw;
  return { size: m[1], unit };
}