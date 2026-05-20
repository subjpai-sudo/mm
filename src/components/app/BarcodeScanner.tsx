import { useEffect, useRef, useState } from "react";
import {
  BrowserMultiFormatReader,
  type IScannerControls,
} from "@zxing/browser";
import {
  BarcodeFormat,
  DecodeHintType,
  ChecksumException,
  FormatException,
  NotFoundException,
} from "@zxing/library";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScanLine, X, Camera } from "lucide-react";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onClose: () => void;
  onDetected: (code: string) => void;
  keepOpenOnDetect?: boolean;
  onDetectedLabel?: (code: string) => string | null | undefined;
};

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string | null }>>;
};

type BarcodeDetectorCtor = new (options?: {
  formats?: string[];
}) => BarcodeDetectorLike;

type ExtendedMediaTrackCapabilities = MediaTrackCapabilities & {
  focusMode?: string[];
  exposureMode?: string[];
  whiteBalanceMode?: string[];
};

declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorCtor;
    webkitAudioContext?: typeof AudioContext;
  }
}

const CAMERA_PERMISSION_KEY = "barcode-camera-granted";
const NATIVE_SCAN_INTERVAL_MS = 180;
const ZXING_FALLBACK_DELAY_MS = 650;
const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
  audio: false,
};

const ZXING_HINTS = new Map([
  [
    DecodeHintType.POSSIBLE_FORMATS,
    [
      BarcodeFormat.QR_CODE,
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.ITF,
    ],
  ],
]);

function markCameraGranted() {
  try {
    window.localStorage.setItem(CAMERA_PERMISSION_KEY, "1");
  } catch {
    return;
  }
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
    const AudioContextCtor = window.AudioContext ?? window.webkitAudioContext;
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
      ctx.close().catch(() => undefined);
    };
  } catch {
    return;
  }
}

export function BarcodeScanner({
  open,
  onClose,
  onDetected,
  keepOpenOnDetect = false,
  onDetectedLabel,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nativeLoopTimerRef = useRef<number | null>(null);
  const zxingFallbackTimerRef = useRef<number | null>(null);
  const lockRef = useRef(false);
  const zxingControlsRef = useRef<IScannerControls | null>(null);
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
        setHasPermissionMemory(
          permission.state === "granted" || wasCameraGranted(),
        );
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

  useEffect(() => {
    if (!open || running || !wasCameraGranted()) return;

    const timer = window.setTimeout(() => {
      start().catch(() => undefined);
    }, 50);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, running]);

  function emit(code: string) {
    if (lockRef.current || !code) return;

    const trimmed = code.trim();
    const now = Date.now();

    if (
      lastDetectedRef.current === trimmed &&
      now - lastDetectedAtRef.current < 1200
    ) {
      return;
    }

    lockRef.current = true;
    lastDetectedRef.current = trimmed;
    lastDetectedAtRef.current = now;

    playDetectedBeep();
    if (navigator.vibrate) navigator.vibrate(60);

    const label = onDetectedLabel?.(trimmed);
    setStatus(label ? `✓ ${label}` : `✓ ${trimmed}`);

    window.setTimeout(() => {
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

  async function optimizeVideoTrack(track: MediaStreamTrack | undefined) {
    if (!track?.applyConstraints) return;

    try {
      const capabilities =
        track.getCapabilities?.() as ExtendedMediaTrackCapabilities | undefined;
      if (!capabilities) return;

      const advanced: Record<string, unknown> = {};

      if (
        Array.isArray(capabilities.focusMode) &&
        capabilities.focusMode.includes("continuous")
      ) {
        advanced.focusMode = "continuous";
      }

      if (
        Array.isArray(capabilities.exposureMode) &&
        capabilities.exposureMode.includes("continuous")
      ) {
        advanced.exposureMode = "continuous";
      }

      if (
        Array.isArray(capabilities.whiteBalanceMode) &&
        capabilities.whiteBalanceMode.includes("continuous")
      ) {
        advanced.whiteBalanceMode = "continuous";
      }

      if (Object.keys(advanced).length > 0) {
        await track.applyConstraints({
          advanced: [advanced as MediaTrackConstraintSet],
        });
      }
    } catch {
      return;
    }
  }

  function clearScanTimers() {
    if (nativeLoopTimerRef.current) {
      window.clearTimeout(nativeLoopTimerRef.current);
      nativeLoopTimerRef.current = null;
    }

    if (zxingFallbackTimerRef.current) {
      window.clearTimeout(zxingFallbackTimerRef.current);
      zxingFallbackTimerRef.current = null;
    }
  }

  function startNativeDetector(detector: BarcodeDetectorLike) {
    const tick = async () => {
      if (!videoRef.current || videoRef.current.readyState < 2) {
        nativeLoopTimerRef.current = window.setTimeout(
          tick,
          NATIVE_SCAN_INTERVAL_MS,
        );
        return;
      }

      if (!lockRef.current) {
        try {
          const codes = await detector.detect(videoRef.current);
          const rawValue = codes.find(
            (entry) => typeof entry.rawValue === "string" && entry.rawValue.trim(),
          )?.rawValue;

          if (rawValue) {
            emit(rawValue);
            if (keepOpenOnDetect) {
              nativeLoopTimerRef.current = window.setTimeout(tick, 380);
            }
            return;
          }
        } catch {
          return;
        }
      }

      nativeLoopTimerRef.current = window.setTimeout(
        tick,
        NATIVE_SCAN_INTERVAL_MS,
      );
    };

    nativeLoopTimerRef.current = window.setTimeout(tick, 120);
  }

  async function startZxing(stream: MediaStream) {
    if (zxingControlsRef.current || !videoRef.current) return;

    try {
      const reader = new BrowserMultiFormatReader(ZXING_HINTS);
      zxingControlsRef.current = await reader.decodeFromStream(
        stream,
        videoRef.current,
        (result, error) => {
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
            setStatus("Camera is on — move a little closer and hold steady");
          }
        },
      );

      setStatus("Scanning live — barcode and QR are enabled");
    } catch {
      if (!window.BarcodeDetector) {
        setStatus("Scanner unavailable — type below");
        setErrored(true);
      }
    }
  }

  async function start() {
    const video = videoRef.current;
    if (!video) return;

    stop();
    setStatus("Requesting camera…");
    setErrored(false);

    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia(
        CAMERA_CONSTRAINTS,
      );
      markCameraGranted();
      setHasPermissionMemory(true);

      video.srcObject = streamRef.current;
      video.setAttribute("playsinline", "");
      video.setAttribute("muted", "");
      await video.play().catch(() => undefined);
      await optimizeVideoTrack(streamRef.current.getVideoTracks()[0]);

      setRunning(true);
      setStatus("Point at a barcode or QR — hold steady");
    } catch (error: unknown) {
      const err = error as { name?: string };
      const msg =
        err?.name === "NotAllowedError" ||
        err?.name === "PermissionDeniedError"
          ? "Camera permission denied — allow it once in your browser settings"
          : err?.name === "NotFoundError"
            ? "No camera found"
            : err?.name === "NotReadableError"
              ? "Camera is already in use by another app"
              : "Camera unavailable — type barcode below";

      toast.error(msg);
      setStatus(msg);
      setErrored(true);
      return;
    }

    const liveStream = streamRef.current;
    if (!liveStream) return;

    if (window.BarcodeDetector) {
      try {
        const detector = new window.BarcodeDetector({
          formats: [
            "ean_13",
            "ean_8",
            "code_128",
            "code_39",
            "upc_a",
            "upc_e",
            "itf",
            "qr_code",
          ],
        });
        setStatus("Scanning live — hold the barcode or QR inside the frame");
        startNativeDetector(detector);
      } catch {
        return;
      }
    }

    zxingFallbackTimerRef.current = window.setTimeout(() => {
      if (streamRef.current) {
        startZxing(streamRef.current).catch(() => undefined);
      }
    }, window.BarcodeDetector ? ZXING_FALLBACK_DELAY_MS : 0);

    if (!window.BarcodeDetector) {
      setStatus("Switching to universal scanner…");
    }
  }

  function stop() {
    clearScanTimers();

    if (zxingControlsRef.current) {
      try {
        zxingControlsRef.current.stop();
      } catch {
        return;
      }
      zxingControlsRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      try {
        videoRef.current.srcObject = null;
      } catch {
        return;
      }
    }

    setRunning(false);

    if (containerRef.current) {
      const injectedVideo = containerRef.current.querySelector("video");
      if (injectedVideo && injectedVideo !== videoRef.current) injectedVideo.remove();

      const injectedCanvas = containerRef.current.querySelector("canvas");
      if (injectedCanvas) injectedCanvas.remove();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-w-3xl gap-0 overflow-hidden border-border bg-card p-0">
        <DialogTitle className="sr-only">Scan barcode</DialogTitle>
        <DialogDescription className="sr-only">
          Open the camera to scan product barcodes and rack QR codes.
        </DialogDescription>

        <div
          ref={containerRef}
          className="relative aspect-[16/10] w-full overflow-hidden bg-black"
        >
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 h-full w-full object-cover"
          />

          {(!running || errored) && (
            <div className="absolute inset-0 grid place-items-center bg-black/70 p-6 text-center backdrop-blur-sm">
              <div className="space-y-4">
                <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-primary/20">
                  <Camera className="size-7 text-primary" />
                </div>
                <p className="mx-auto max-w-[340px] text-sm text-white">{status}</p>
                <Button
                  onClick={() => start().catch(() => undefined)}
                  className="gradient-primary gap-2 border-0 text-primary-foreground"
                >
                  <Camera className="size-4" />
                  {running
                    ? "Resume camera"
                    : errored
                      ? "Retry camera"
                      : "Start camera"}
                </Button>
                <p className="text-[10px] text-white/60">
                  {hasPermissionMemory
                    ? "Camera access is remembered by your browser while this tab stays open."
                    : "Allow camera once, then keep scanning continuously."}
                </p>
              </div>
            </div>
          )}

          {running && !errored && (
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

          {running && (
            <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-xs text-white backdrop-blur">
              <Camera className="size-3.5" /> Live scanner
            </div>
          )}

          {running && !errored && (
            <div className="absolute bottom-3 left-3 right-3 rounded-lg bg-black/60 px-3 py-2 text-center text-xs text-white/90 backdrop-blur">
              {status}
            </div>
          )}
        </div>

        <div className="flex gap-2 border-t border-border p-3">
          <Input
            value={manual}
            onChange={(event) => setManual(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && manual.trim()) emit(manual.trim());
            }}
            placeholder="Or type barcode manually…"
            className="font-mono"
          />
          <Button
            onClick={() => manual.trim() && emit(manual.trim())}
            className="gradient-primary border-0 text-primary-foreground"
          >
            Use
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}