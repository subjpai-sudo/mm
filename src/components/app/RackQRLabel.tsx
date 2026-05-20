import { useEffect, useRef } from "react";
import QRCode from "qrcode";

/**
 * Self-contained printable rack QR label.
 * Encodes `RACK:R{id}` so the universal scanner can route to the rack page.
 */
export function RackQRLabel({ rackId, size = 220 }: { rackId: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const payload = `RACK:${rackId.toUpperCase()}`;
  useEffect(() => {
    if (!ref.current) return;
    QRCode.toCanvas(ref.current, payload, {
      width: size,
      margin: 1,
      errorCorrectionLevel: "H",
      color: { dark: "#0a0f0d", light: "#ffffff" },
    }).catch(() => {});
  }, [payload, size]);

  return (
    <div className="rack-label border-2 border-black rounded-2xl p-4 bg-white text-black flex flex-col items-center gap-2 break-inside-avoid">
      <div className="text-xs uppercase tracking-[0.2em] font-semibold text-neutral-500">Warehouse rack</div>
      <div className="text-5xl font-black tracking-tight leading-none">{rackId}</div>
      <canvas ref={ref} className="rounded-lg" />
      <div className="text-[10px] text-neutral-500 font-mono">{payload}</div>
      <div className="text-[10px] text-neutral-400">Scan with the warehouse app</div>
    </div>
  );
}