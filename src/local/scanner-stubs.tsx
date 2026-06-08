import { Download } from "lucide-react";

export function ScannerFAB() {
  return null;
}

export function UniversalScanner() {
  return null;
}

export function StrichScanner() {
  return null;
}

export function ReportPdfDialog({ triggerLabel }: { triggerLabel?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl border border-border bg-secondary/30 text-sm font-medium hover:bg-secondary hover:text-foreground transition-colors cursor-pointer"
    >
      <Download className="size-4" />
      {triggerLabel ?? "Print report"}
    </button>
  );
}
