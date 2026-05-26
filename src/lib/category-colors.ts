/**
 * Per-category color tokens used to make category chips, section headers and
 * filter buttons easy to distinguish at a glance.
 *
 * Explicit overrides exist for the four main origins the team picks the most
 * (Asian Halal red, Indonesia purple, Myanmar green, Thailand blue). Any new
 * or unknown category is auto-assigned from a deterministic palette based on
 * a hash of the name, so colors stay stable across reloads but never collide
 * with the locked overrides.
 */

export type CategoryPalette = {
  /** Background for solid chips / section header pill. */
  bg: string;
  /** Foreground text that reads on `bg`. */
  fg: string;
  /** Soft tint background for badges / count pills. */
  soft: string;
  /** Border accent + text color for outline chips. */
  border: string;
  /** Accent text (used over neutral surfaces). */
  accent: string;
};

const OVERRIDES: Record<string, CategoryPalette> = {
  "asian halal": {
    bg: "#dc2626",
    fg: "#ffffff",
    soft: "rgba(220,38,38,0.14)",
    border: "#dc2626",
    accent: "#b91c1c",
  },
  indonesia: {
    bg: "#7c3aed",
    fg: "#ffffff",
    soft: "rgba(124,58,237,0.14)",
    border: "#7c3aed",
    accent: "#6d28d9",
  },
  myanmar: {
    bg: "#16a34a",
    fg: "#ffffff",
    soft: "rgba(22,163,74,0.14)",
    border: "#16a34a",
    accent: "#15803d",
  },
  thailand: {
    bg: "#2563eb",
    fg: "#ffffff",
    soft: "rgba(37,99,235,0.16)",
    border: "#2563eb",
    accent: "#1d4ed8",
  },
};

// Auto-assignment palette — chosen to avoid clashing with the four overrides.
const AUTO_PALETTE: CategoryPalette[] = [
  { bg: "#ea580c", fg: "#ffffff", soft: "rgba(234,88,12,0.14)",  border: "#ea580c", accent: "#c2410c" }, // orange
  { bg: "#0d9488", fg: "#ffffff", soft: "rgba(13,148,136,0.14)", border: "#0d9488", accent: "#0f766e" }, // teal
  { bg: "#db2777", fg: "#ffffff", soft: "rgba(219,39,119,0.14)", border: "#db2777", accent: "#be185d" }, // pink
  { bg: "#ca8a04", fg: "#ffffff", soft: "rgba(202,138,4,0.16)",  border: "#ca8a04", accent: "#a16207" }, // amber
  { bg: "#0891b2", fg: "#ffffff", soft: "rgba(8,145,178,0.14)",  border: "#0891b2", accent: "#0e7490" }, // cyan
  { bg: "#65a30d", fg: "#ffffff", soft: "rgba(101,163,13,0.14)", border: "#65a30d", accent: "#4d7c0f" }, // lime
  { bg: "#9333ea", fg: "#ffffff", soft: "rgba(147,51,234,0.14)", border: "#9333ea", accent: "#7e22ce" }, // violet
  { bg: "#e11d48", fg: "#ffffff", soft: "rgba(225,29,72,0.14)",  border: "#e11d48", accent: "#be123c" }, // rose
  { bg: "#475569", fg: "#ffffff", soft: "rgba(71,85,105,0.16)",  border: "#475569", accent: "#334155" }, // slate
  { bg: "#0284c7", fg: "#ffffff", soft: "rgba(2,132,199,0.14)",  border: "#0284c7", accent: "#0369a1" }, // sky
];

const NEUTRAL: CategoryPalette = {
  bg: "#64748b",
  fg: "#ffffff",
  soft: "rgba(100,116,139,0.16)",
  border: "#64748b",
  accent: "#475569",
};

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function categoryPalette(name?: string | null): CategoryPalette {
  const key = (name ?? "").trim().toLowerCase();
  if (!key) return NEUTRAL;
  if (OVERRIDES[key]) return OVERRIDES[key];
  const idx = hashString(key) % AUTO_PALETTE.length;
  return AUTO_PALETTE[idx];
}

export type CategoryLite = { id: string; name: string; parent_id: string | null };

/** Walk up the parent chain to find the top-level (main) category name.
 *  Returns null if the id is missing or no matching category is found. */
export function resolveMainCategoryName(
  categoryId: string | null | undefined,
  categories: CategoryLite[] | undefined | null,
): string | null {
  if (!categoryId || !categories?.length) return null;
  const byId = new Map(categories.map((c) => [c.id, c]));
  let cur = byId.get(categoryId);
  let safety = 8;
  while (cur && cur.parent_id && safety-- > 0) {
    const parent = byId.get(cur.parent_id);
    if (!parent) break;
    cur = parent;
  }
  return cur?.name ?? null;
}