/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Camera, ScanLine, Keyboard } from "lucide-react";
import { toast } from "sonner";
import { getStrichLicense } from "@/lib/strich.functions";

type Props = {
  open: boolean;
  onClose: () => void;
  onDetected: (code: string) => void;
  keepOpenOnDetect?: boolean;
  onDetectedLabel?: (code: string) => string | null | undefined;
};

let sdkReadyPromise: Promise<{ ok: boolean; error?: string }> | null = null;

async function ensureSdk(
  fetchKey: () => Promise<{ key: string }>,
): Promise<{ ok: boolean; error?: string }> {
  if (sdkReadyPromise) return sdkReadyPromise;
  sdkReadyPromise = (async () => {
    try {
      const mod: any = await import("@pixelverse/strichjs-sdk");
      const SDK = mod.StrichSDK;
      if (SDK.isInitialized?.()) return { ok: true };
      const { key } = await fetchKey();
      if (!key) {
        console.warn("[STRICH] no license key configured");
        return { ok: false, error: "No STRICH license key configured" };
      }
      await SDK.initialize(key);
      return { ok: true };
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      console.error("[STRICH] init failed", e, "hostname=", window.location.hostname);
      sdkReadyPromise = null;
      return { ok: false, error: `${msg} (host: ${window.location.hostname})` };
    }
  })();
  return sdkReadyPromise;
}

function beep() {
  try {
    const Ctx = (window as any).AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = 1046;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.14);
    o.onended = () => ctx.close().catch(() => undefined);
  } catch {
    /* noop */
  }
}

export function StrichScanner({
  open,
  onClose,
  onDetected,
  keepOpenOnDetect = false,
  onDetectedLabel,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const readerRef = useRef<any>(null);
  const lockRef = useRef(false);
  const lastRef = useRef<{ code: string; ts: number }>({ code: "", ts: 0 });
  const [status, setStatus] = useState("Starting camera…");
  const [errored, setErrored] = useState(false);
  const [manual, setManual] = useState("");
  const fetchKey = useServerFn(getStrichLicense);

  function emit(code: string) {
    if (!code || lockRef.current) return;
    const trimmed = code.trim();
    const now = Date.now();
    if (lastRef.current.code === trimmed && now - lastRef.current.ts < 1200) return;
    lockRef.current = true;
    lastRef.current = { code: trimmed, ts: now };
    beep();
    if (navigator.vibrate) navigator.vibrate(60);
    const label = onDetectedLabel?.(trimmed);
    setStatus(label ? `✓ ${label}` : `✓ ${trimmed}`);
    window.setTimeout(
      () => {
        onDetected(trimmed);
        if (keepOpenOnDetect) {
          lockRef.current = false;
          setStatus("Ready for next scan");
        } else {
          onClose();
        }
      },
      keepOpenOnDetect ? 180 : 220,
    );
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    lockRef.current = false;
    setErrored(false);
    setStatus("Starting camera…");

    (async () => {
      const result = await ensureSdk(fetchKey as any);
      if (cancelled) return;
      if (!result.ok) {
        setErrored(true);
        setStatus(result.error ?? "Scanner unavailable — type the code below");
        toast.error("Scanner SDK failed to initialize", { description: result.error });
        return;
      }
      try {
        const mod: any = await import("@pixelverse/strichjs-sdk");
        const { BarcodeReader, CodeDetection } = mod;
        void CodeDetection;
        if (!hostRef.current || cancelled) return;
        const reader = new BarcodeReader({
          selector: hostRef.current,
          engine: {
            symbologies: [
              "ean13",
              "ean8",
              "upca",
              "upce",
              "code128",
              "code39",
              "itf",
              "qr",
              "datamatrix",
            ],
          },
          locator: { regionOfInterest: { left: 0.05, right: 0.05, top: 0.25, bottom: 0.25 } },
          frameSource: { resolution: "hd" },
          feedback: { audio: false, vibration: false },
        });
        await reader.initialize();
        if (cancelled) {
          await reader.destroy?.();
          return;
        }
        reader.detected = (detections: any[]) => {
          const first = detections?.[0];
          const value = first?.data ?? first?.rawValue;
          if (typeof value === "string") emit(value);
        };
        readerRef.current = reader;
        await reader.start();
        if (!cancelled) setStatus("Point the camera at a barcode or QR");
      } catch (e: any) {
        console.error("[STRICH] reader failed", e);
        if (!cancelled) {
          setErrored(true);
          setStatus(e?.message ?? "Camera unavailable");
          toast.error("Camera unavailable", { description: e?.message });
        }
      }
    })();

    return () => {
      cancelled = true;
      const r = readerRef.current;
      readerRef.current = null;
      if (r) {
        r.stop?.()
          .catch(() => undefined)
          .finally(() => r.destroy?.().catch(() => undefined));
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl gap-0 overflow-hidden border-border bg-card p-0">
        <DialogTitle className="sr-only">Scan barcode</DialogTitle>
        <DialogDescription className="sr-only">
          Scan product barcodes or rack QR codes with the camera.
        </DialogDescription>

        <div className="relative aspect-[16/10] w-full overflow-hidden bg-black">
          <div ref={hostRef} className="absolute inset-0 h-full w-full" />

          {errored && (
            <div className="absolute inset-0 grid place-items-center bg-black/75 p-6 text-center backdrop-blur-sm">
              <div className="space-y-3">
                <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-warning/20">
                  <Camera className="size-7 text-warning" />
                </div>
                <p className="mx-auto max-w-[340px] text-sm text-white">{status}</p>
              </div>
            </div>
          )}

          {!errored && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="relative h-44 w-[86%] rounded-2xl border-2 border-primary/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)] sm:h-52">
                <div className="glow absolute left-0 right-0 top-1/2 h-0.5 animate-pulse bg-primary" />
                <ScanLine className="absolute -top-7 left-1/2 size-5 -translate-x-1/2 text-primary" />
              </div>
            </div>
          )}

          <button
            onClick={onClose}
            className="absolute right-3 top-3 grid size-9 place-items-center rounded-full bg-black/60 text-white backdrop-blur"
            aria-label="Close"
          >
            <X className="size-5" />
          </button>

          <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-xs text-white backdrop-blur">
            <Camera className="size-3.5" /> STRICH scanner
          </div>

          {!errored && (
            <div className="absolute bottom-3 left-3 right-3 rounded-lg bg-black/60 px-3 py-2 text-center text-xs text-white/90 backdrop-blur">
              {status}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-border p-3">
          <Keyboard className="size-4 text-muted-foreground shrink-0" />
          <Input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="Or type the barcode and press Enter"
            onKeyDown={(e) => {
              if (e.key === "Enter" && manual.trim()) {
                emit(manual.trim());
                setManual("");
              }
            }}
          />
          <Button
            onClick={() => {
              if (manual.trim()) {
                emit(manual.trim());
                setManual("");
              }
            }}
            disabled={!manual.trim()}
            className="gradient-primary border-0 text-primary-foreground"
          >
            Submit
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}