import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { BarcodeScanner } from "./BarcodeScanner";
import { toast } from "sonner";

/**
 * Universal scanner that handles both QR codes and barcodes.
 *
 * Recognized payload formats:
 *   - `RACK:R12`         → navigate to /racks/R12 (rack QR label)
 *   - any other string   → look up product by barcode → navigate to /products
 */
export function UniversalScanner({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const qc = useQueryClient();

  async function handle(code: string) {
    const trimmed = code.trim();
    // Rack QR
    const rackMatch = trimmed.match(/^RACK:([A-Za-z0-9_-]+)$/i);
    if (rackMatch) {
      const rackId = rackMatch[1].toUpperCase();
      toast.success(`Opening rack ${rackId}`);
      onClose();
      nav({ to: "/racks/$rackId", params: { rackId } });
      return;
    }
    // Otherwise treat as product barcode
    const { data: product } = await supabase
      .from("products")
      .select("id, name")
      .eq("barcode", trimmed)
      .maybeSingle();
    if (product) {
      toast.success(`Found ${product.name}`);
      onClose();
      qc.invalidateQueries({ queryKey: ["products"] });
      nav({ to: "/products", search: { q: trimmed } as any });
    } else {
      toast.message(`Unknown code: ${trimmed}`, { description: "No product matches this barcode." });
    }
  }

  return (
    <BarcodeScanner
      open={open}
      onClose={onClose}
      onDetected={handle}
      onDetectedLabel={(c) => (c.startsWith("RACK:") ? `Rack ${c.slice(5)}` : c)}
    />
  );
}