import { useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { ScanLine } from "lucide-react";
import { UniversalScanner } from "./UniversalScanner";
import { cn } from "@/lib/utils";
import { useHidScanner } from "@/hooks/use-hid-scanner";
import { toast } from "sonner";

/**
 * Floating Action Button — always visible on authenticated pages.
 * Opens the universal QR + barcode scanner.
 */
export function ScannerFAB() {
  const [open, setOpen] = useState(false);
  const [hidCode, setHidCode] = useState<string | null>(null);
  const location = useLocation();

  // Listen for USB/Bluetooth wedge barcode scanners on every authenticated page.
  // The scan opens the universal scanner pre-filled with the code, which then
  // looks it up, opens the product card, or offers to register an unknown barcode.
  useHidScanner((code) => {
    if (location.pathname === "/change-pin") return;
    setHidCode(code);
    setOpen(true);
    toast.message("Scanner input", { description: code, duration: 1500 });
  });

  // Hide on the change-pin gate
  if (location.pathname === "/change-pin") return null;
  return (
    <>
      <button
        type="button"
        aria-label="Open universal scanner"
        onClick={() => setOpen(true)}
        className={cn(
          "fixed z-40 bottom-20 right-4 md:bottom-6 md:right-6",
          "size-14 md:size-16 rounded-full gradient-primary text-primary-foreground",
          "shadow-[0_10px_30px_-8px_rgba(0,0,0,0.45)] grid place-items-center",
          "ring-4 ring-primary/15 hover:scale-105 active:scale-95 transition-transform",
        )}
      >
        <ScanLine className="size-6 md:size-7" />
        <span className="absolute -top-1 -right-1 size-3 rounded-full bg-success border-2 border-background animate-pulse" />
      </button>
      <UniversalScanner
        open={open}
        onClose={() => {
          setOpen(false);
          setHidCode(null);
        }}
        prefillCode={hidCode}
        onPrefillConsumed={() => setHidCode(null)}
      />
    </>
  );
}