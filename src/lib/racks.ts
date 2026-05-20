export const DEFAULT_RACK_CODES = Array.from({ length: 20 }, (_, index) => `R${index + 1}`);

export function formatRackLabel(code: string, name?: string | null) {
  const trimmedName = name?.trim();
  if (!trimmedName || trimmedName.toUpperCase() === code.toUpperCase()) return code;
  return `${code} · ${trimmedName}`;
}