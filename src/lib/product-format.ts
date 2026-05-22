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