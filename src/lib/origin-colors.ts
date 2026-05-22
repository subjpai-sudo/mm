/**
 * Map a product's origin (or vendor) to a printable header color band.
 * Myanmar → solid yellow. Other countries use a flag-inspired stripe.
 * Unknown / international falls back to a neutral red so cards still print well.
 */
export type OriginPalette = {
  label: string;
  /** CSS background for the header band — solid color or gradient. */
  background: string;
  /** Foreground text color that reads well on the band. */
  foreground: string;
};

const PALETTES: Record<string, OriginPalette> = {
  myanmar: {
    label: "Myanmar",
    background: "#FFD400",
    foreground: "#1a1a1a",
  },
  india: {
    label: "India",
    background:
      "linear-gradient(180deg, #FF9933 0 33%, #FFFFFF 33% 66%, #138808 66% 100%)",
    foreground: "#1a1a1a",
  },
  pakistan: {
    label: "Pakistan",
    background: "linear-gradient(90deg, #FFFFFF 0 25%, #01411C 25% 100%)",
    foreground: "#FFFFFF",
  },
  bangladesh: {
    label: "Bangladesh",
    background: "#006A4E",
    foreground: "#FFFFFF",
  },
  thailand: {
    label: "Thailand",
    background:
      "linear-gradient(180deg, #ED1C24 0 20%, #FFFFFF 20% 40%, #241D4F 40% 60%, #FFFFFF 60% 80%, #ED1C24 80% 100%)",
    foreground: "#1a1a1a",
  },
  china: {
    label: "China",
    background: "#DE2910",
    foreground: "#FFDE00",
  },
  international: {
    label: "International",
    background: "#C8102E",
    foreground: "#FFFFFF",
  },
};

export function originPalette(origin?: string | null): OriginPalette {
  const key = (origin ?? "").trim().toLowerCase();
  return PALETTES[key] ?? PALETTES.international;
}

export const KNOWN_ORIGINS = Object.values(PALETTES).map((p) => p.label);