import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScanLine, X, Camera } from "lucide-react";
import { toast } from "sonner";

declare global {
  interface Window {
    Quagga?: any;
    BarcodeDetector?: any;
  }
}

type Props = {
  open: boolean;
  onClose: () => void;
  onDetected: (code: string) => void;
};

function loadQuagga(): Promise<boolean> {
  return new Promise((res) => {
    if (window.Quagga) return res(true);
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/quagga@0.12.1/dist/quagga.min.js";
    s.onload = () => res(true);
    s.onerror = () => res(false);
    document.head.appendChild(s);
  });
}

export function BarcodeScanner({ open, onClose, onDetected }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lockRef = useRef(false);
  const quaggaRunningRef = useRef(false);
  const [status, setStatus] = useState("Tap “Start camera” to scan");
  const [manual, setManual] = useState("");
  const [running, setRunning] = useState(false);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    if (!open) return;
    lockRef.current = false;
    setStatus("Tap “Start camera” to scan");
    setManual("");
    setRunning(false);
    setErrored(false);
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function emit(code: string) {
    if (lockRef.current || !code) return;
    lockRef.current = true;
    if (navigator.vibrate) navigator.vibrate(60);
    setStatus(`✓ ${code}`);
    setTimeout(() => {
      onDetected(code);
      onClose();
    }, 250);
  }

  async function start() {
    const v = videoRef.current;
    if (!v) return;
    setStatus("Requesting camera…");
    setErrored(false);
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      v.srcObject = streamRef.current;
      v.setAttribute("playsinline", "");
      v.setAttribute("muted", "");
      await v.play().catch(() => {});
      setRunning(true);
      setStatus("Point at a barcode — hold steady");
    } catch (e: any) {
      const msg =
        e?.name === "NotAllowedError" || e?.name === "PermissionDeniedError"
          ? "Camera permission denied"
          : e?.name === "NotFoundError"
          ? "No camera found"
          : "Camera unavailable — type barcode below";
      toast.error(msg);
      setStatus(msg);
      setErrored(true);
      return;
    }

    // Native BarcodeDetector
    if ("BarcodeDetector" in window) {
      try {
        const det = new window.BarcodeDetector({
          formats: ["ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e", "itf", "qr_code"],
        });
        const tick = async () => {
          if (lockRef.current || !videoRef.current) return;
          try {
            const codes = await det.detect(videoRef.current);
            if (codes?.length) {
              emit(codes[0].rawValue);
              return;
            }
          } catch {}
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
        return;
      } catch {}
    }

    // Fallback to Quagga
    setStatus("Loading scanner…");
    const ok = await loadQuagga();
    if (!ok) {
      setStatus("Scanner unavailable — type below");
      return;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;

    setStatus("Point at a barcode — hold steady");
    window.Quagga.init(
      {
        inputStream: {
          type: "LiveStream",
          target: containerRef.current,
          constraints: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        },
        decoder: {
          readers: ["ean_reader", "ean_8_reader", "code_128_reader", "code_39_reader", "upc_reader", "upc_e_reader"],
          multiple: false,
        },
        locate: true,
        numOfWorkers: 0,
        frequency: 8,
      },
      (err: any) => {
        if (err) {
          setStatus("Scanner error — type below");
          return;
        }
        window.Quagga.start();
        quaggaRunningRef.current = true;
        window.Quagga.onDetected((data: any) => {
          if (lockRef.current || !quaggaRunningRef.current) return;
          emit(data?.codeResult?.code);
        });
      }
    );
  }

  function stop() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (quaggaRunningRef.current && window.Quagga) {
      try {
        window.Quagga.stop();
      } catch {}
      quaggaRunningRef.current = false;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      try {
        videoRef.current.srcObject = null;
      } catch {}
    }
    if (containerRef.current) {
      const injected = containerRef.current.querySelector("video");
      if (injected && injected !== videoRef.current) injected.remove();
      const cv = containerRef.current.querySelector("canvas");
      if (cv) cv.remove();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="p-0 max-w-md gap-0 overflow-hidden border-border bg-card">
        <DialogTitle className="sr-only">Scan barcode</DialogTitle>
        <div ref={containerRef} className="relative aspect-[3/4] bg-black w-full overflow-hidden">
          <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover" />
          {/* Pre-start / error overlay */}
          {(!running || errored) && (
            <div className="absolute inset-0 grid place-items-center bg-black/70 backdrop-blur-sm p-6 text-center">
              <div className="space-y-4">
                <div className="size-16 mx-auto rounded-2xl bg-primary/20 grid place-items-center">
                  <Camera className="size-7 text-primary" />
                </div>
                <p className="text-white text-sm max-w-[260px] mx-auto">{status}</p>
                <Button onClick={start} className="gradient-primary text-primary-foreground border-0 gap-2">
                  <Camera className="size-4" /> {errored ? "Retry camera" : "Start camera"}
                </Button>
                <p className="text-[10px] text-white/60">Or type the barcode manually below</p>
              </div>
            </div>
          )}
          {/* Reticle */}
          {running && !errored && <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="relative w-[78%] h-32 rounded-xl border-2 border-primary/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]">
              <div className="absolute left-0 right-0 top-1/2 h-0.5 bg-primary glow animate-pulse" />
              <ScanLine className="absolute -top-7 left-1/2 -translate-x-1/2 size-5 text-primary" />
            </div>
          </div>}
          <button
            onClick={onClose}
            className="absolute top-3 right-3 size-9 rounded-full bg-black/60 text-white grid place-items-center backdrop-blur"
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
          {running && <div className="absolute top-3 left-3 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/60 text-white text-xs backdrop-blur">
            <Camera className="size-3.5" /> Scanner
          </div>}
          {running && !errored && <div className="absolute bottom-3 left-3 right-3 text-center text-xs text-white/90 px-3 py-2 rounded-lg bg-black/60 backdrop-blur">
            {status}
          </div>}
        </div>
        <div className="p-3 flex gap-2 border-t border-border">
          <Input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && manual.trim() && emit(manual.trim())}
            placeholder="Or type barcode manually…"
            className="font-mono"
          />
          <Button onClick={() => manual.trim() && emit(manual.trim())} className="gradient-primary text-primary-foreground border-0">
            Use
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
