import { useEffect, useRef } from "react";
import QRCode from "qrcode";

/**
 * Self-contained printable rack QR label.
 * Encodes a short rack payload for reliable camera reads while also printing
 * the rack code visibly for manual fallback.
 */
export function RackQRLabel({ rackId, size = 220 }: { rackId: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const normalizedRackId = rackId.trim().toUpperCase();
  const payload = `RACK:${normalizedRackId}`;
  useEffect(() => {
    if (!ref.current) return;
    QRCode.toCanvas(ref.current, payload, {
      width: size,
      margin: 2,
      errorCorrectionLevel: "H",
      color: { dark: "#0a0f0d", light: "#ffffff" },
    }).catch(() => {});
  }, [payload, size]);

  return (
    <div className="rack-label border-2 border-black rounded-2xl p-3 bg-white text-black flex flex-col items-center gap-2 break-inside-avoid w-full max-w-full overflow-hidden">
      <div className="text-xs uppercase tracking-[0.2em] font-semibold text-neutral-500">
        Warehouse rack
      </div>
      <div className="text-4xl font-black tracking-tight leading-none">{normalizedRackId}</div>
      <canvas ref={ref} className="rounded-lg [image-rendering:pixelated] max-w-full h-auto" />
      <div className="text-[10px] text-neutral-500 font-mono">{payload}</div>
      <div className="text-[10px] text-neutral-400">
        Scan with the warehouse app or use the rack code above
      </div>
    </div>
  );
}
