import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType, ChecksumException, FormatException, NotFoundException } from "@zxing/library";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScanLine, X, Camera } from "lucide-react";
import { toast } from "sonner";

declare global {
  interface Window {
    BarcodeDetector?: any;
  }
}

type Props = {
  open: boolean;
  onClose: () => void;
  onDetected: (code: string) => void;
  keepOpenOnDetect?: boolean;
  onDetectedLabel?: (code: string) => string | null | undefined;
};

const CAMERA_PERMISSION_KEY = "barcode-camera-granted";

function markCameraGranted() {
  try {
    window.localStorage.setItem(CAMERA_PERMISSION_KEY, "1");
  } catch {}
}

function wasCameraGranted() {
  try {
    return window.localStorage.getItem(CAMERA_PERMISSION_KEY) === "1";
  } catch {
    return false;
  }
}

function playDetectedBeep() {
  try {
    const AudioContextCtor = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AudioContextCtor) return;
    const ctx = new AudioContextCtor();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 1046;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.14);
    oscillator.onended = () => {
      ctx.close().catch(() => {});
    };
  } catch {}
}

const ZXING_HINTS = new Map([
  [DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.QR_CODE,
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.ITF,
  ]],
]);

export function BarcodeScanner({ open, onClose, onDetected, keepOpenOnDetect = false, onDetectedLabel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lockRef = useRef(false);
  const zxingControlsRef = useRef<IScannerControls | null>(null);
  const zxingReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const lastDetectedRef = useRef<string | null>(null);
  const lastDetectedAtRef = useRef(0);
  const [status, setStatus] = useState("Tap “Start camera” to scan");
  const [manual, setManual] = useState("");
  const [running, setRunning] = useState(false);
  const [errored, setErrored] = useState(false);
  const [hasPermissionMemory, setHasPermissionMemory] = useState(false);

  useEffect(() => {
    if (!open || !navigator.permissions?.query) return;
    let alive = true;
    navigator.permissions
      .query({ name: "camera" as PermissionName })
      .then((permission) => {
        if (!alive) return;
        setHasPermissionMemory(permission.state === "granted" || wasCameraGranted());
      })
      .catch(() => {
        if (alive) setHasPermissionMemory(wasCameraGranted());
      });
    return () => {
      alive = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    lockRef.current = false;
    lastDetectedRef.current = null;
    lastDetectedAtRef.current = 0;
    setStatus("Tap “Start camera” to scan");
    setManual("");
    setRunning(false);
    setErrored(false);
    setHasPermissionMemory(wasCameraGranted());
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Auto-start the camera as soon as the dialog opens if we previously
  // got permission — keeps the scanner "always on" for the logged-in user.
  useEffect(() => {
    if (!open) return;
    if (running) return;
    if (!wasCameraGranted()) return;
    const t = setTimeout(() => { start().catch(() => {}); }, 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function emit(code: string) {
    if (lockRef.current || !code) return;
    const trimmed = code.trim();
    const now = Date.now();
    if (lastDetectedRef.current === trimmed && now - lastDetectedAtRef.current < 1200) return;
    lockRef.current = true;
    lastDetectedRef.current = trimmed;
    lastDetectedAtRef.current = now;
    playDetectedBeep();
    if (navigator.vibrate) navigator.vibrate(60);
    const label = onDetectedLabel?.(trimmed);
    setStatus(label ? `✓ ${label}` : `✓ ${trimmed}`);
    setTimeout(() => {
      onDetected(trimmed);
      if (keepOpenOnDetect) {
        lockRef.current = false;
        setManual("");
        setStatus("Ready for next barcode");
      } else {
        onClose();
      }
    }, keepOpenOnDetect ? 180 : 250);
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
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      markCameraGranted();
      setHasPermissionMemory(true);
      v.srcObject = streamRef.current;
      v.setAttribute("playsinline", "");
      v.setAttribute("muted", "");
      await v.play().catch(() => {});
      setRunning(true);
      setStatus("Point at a barcode or QR — hold steady");
    } catch (e: any) {
      const msg =
        e?.name === "NotAllowedError" || e?.name === "PermissionDeniedError"
          ? "Camera permission denied — allow it once in your browser settings"
          : e?.name === "NotFoundError"
          ? "No camera found"
          : e?.name === "NotReadableError"
          ? "Camera is already in use by another app"
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
        setStatus("Scanning live — hold the barcode or QR inside the frame");
        rafRef.current = requestAnimationFrame(tick);
        return;
      } catch {}
    }

    setStatus("Switching to universal scanner…");
    try {
      const reader = new BrowserMultiFormatReader(ZXING_HINTS);
      zxingReaderRef.current = reader;
      zxingControlsRef.current = await reader.decodeFromStream(streamRef.current!, videoRef.current, (result, error) => {
        if (lockRef.current) return;
        if (result?.getText()) {
          emit(result.getText());
          return;
        }
        if (
          error &&
          !(error instanceof NotFoundException) &&
          !(error instanceof ChecksumException) &&
          !(error instanceof FormatException)
        ) {
          setStatus("Scanner error — try a clearer angle or type the code below");
        }
      });
      setStatus("Scanning live — QR and barcodes are enabled");
    } catch {
      setStatus("Scanner unavailable — type below");
      setErrored(true);
    }
  }

  function stop() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (zxingControlsRef.current) {
      try {
        zxingControlsRef.current.stop();
      } catch {}
      zxingControlsRef.current = null;
    }
    zxingReaderRef.current = null;
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
      <DialogContent className="p-0 max-w-3xl gap-0 overflow-hidden border-border bg-card">
        <DialogTitle className="sr-only">Scan barcode</DialogTitle>
        <div ref={containerRef} className="relative aspect-[16/10] bg-black w-full overflow-hidden">
          <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover" />
          {/* Pre-start / error overlay */}
          {(!running || errored) && (
            <div className="absolute inset-0 grid place-items-center bg-black/70 backdrop-blur-sm p-6 text-center">
              <div className="space-y-4">
                <div className="size-16 mx-auto rounded-2xl bg-primary/20 grid place-items-center">
                  <Camera className="size-7 text-primary" />
                </div>
                <p className="text-white text-sm max-w-[340px] mx-auto">{status}</p>
                <Button onClick={start} className="gradient-primary text-primary-foreground border-0 gap-2">
                  <Camera className="size-4" /> {running ? "Resume camera" : errored ? "Retry camera" : "Start camera"}
                </Button>
                <p className="text-[10px] text-white/60">
                  {hasPermissionMemory ? "Camera access is remembered by your browser while this tab stays open." : "Allow camera once, then keep scanning continuously."}
                </p>
              </div>
            </div>
          )}
          {/* Reticle */}
          {running && !errored && <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="relative w-[86%] h-44 sm:h-52 rounded-2xl border-2 border-primary/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]">
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
            <Camera className="size-3.5" /> Live scanner
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
