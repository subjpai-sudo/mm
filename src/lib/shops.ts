export const SHOPS = [
  "Kitaotsuka",
  "Baba",
  "Minamiotsuka",
  "Higashi Jujo",
  "Sugamo",
  "Kawaguchi",
  "Komagome",
] as const;

export type Shop = (typeof SHOPS)[number];

export function isShop(destination: string | null | undefined): destination is Shop {
  return !!destination && (SHOPS as readonly string[]).includes(destination);
}