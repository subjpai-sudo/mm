import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  BarcodeFormat,
  BrowserMultiFormatReader,
  type IScannerControls,
} from "@zxing/browser";
import { DecodeHintType } from "@zxing/library";

const BARCODE_FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.CODE_93,
  BarcodeFormat.ITF,
  BarcodeFormat.QR_CODE,
  BarcodeFormat.DATA_MATRIX,
  BarcodeFormat.PDF_417,
];

function createReader() {
  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, BARCODE_FORMATS);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return new BrowserMultiFormatReader(hints, {
    delayBetweenScanAttempts: 120,
    delayBetweenScanSuccess: 300,
    tryPlayVideoTimeout: 7000,
  });
}

function cameraErrorMessage(e: unknown) {
  const name = (e as { name?: string })?.name || "";
  const message = (e as { message?: string })?.message || "";
  if (name === "NotAllowedError" || message.includes("Permission")) {
    return "Camera permission blocked. Allow camera in browser settings, then retry.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No camera found on this device. Type the barcode below.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "Camera is busy. Close other camera apps or tabs, then retry.";
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return "Camera is not supported in this browser. Type the barcode below.";
  }
  return "Scanner failed to start. Type the barcode below.";
}

export type BarcodeScannerHandle = {
  start: () => Promise<void>;
};

export const BarcodeScanner = forwardRef<BarcodeScannerHandle, {
  onDetected: (text: string) => void;
  onClose: () => void;
  initialValue?: string;
  initialStream?: MediaStream | null;
}>(function BarcodeScanner({
  onDetected,
  onClose,
  initialValue = "",
  initialStream = null,
}, ref) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectedRef = useRef(false);
  const onDetectedRef = useRef(onDetected);
  const [manualCode, setManualCode] = useState(initialValue);
  const [error, setError] = useState("");
  const [state, setState] = useState<"idle" | "starting" | "running">("idle");

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  const finish = useCallback((text: string) => {
    if (detectedRef.current) return;
    detectedRef.current = true;
    onDetectedRef.current(text);
  }, []);

  const stop = useCallback(() => {
    try {
      controlsRef.current?.stop();
    } catch {}
    controlsRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setState("idle");
  }, []);

  const beginDecode = useCallback(async (stream: MediaStream) => {
    const video = videoRef.current;
    if (!video) return;
    streamRef.current = stream;
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.srcObject = stream;
    await video.play().catch(() => undefined);
    const controls = await createReader().decodeFromStream(stream, video, (result, scanError) => {
      const text = result?.getText();
      if (text) finish(text);
      if (scanError && (scanError as { name?: string })?.name !== "NotFoundException") {
        console.debug("Barcode decode retry", scanError);
      }
    });
    controlsRef.current = controls;
    setState("running");
  }, [finish]);

  const start = useCallback(async () => {
    if (state !== "idle") return;
    detectedRef.current = false;
    setError("");
    setState("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      await beginDecode(stream);
    } catch (e) {
      console.error("Camera scanner start failed", e);
      stop();
      setError(cameraErrorMessage(e));
    }
  }, [beginDecode, state, stop]);

  useImperativeHandle(ref, () => ({ start }), [start]);

  useEffect(() => {
    if (!initialStream || state !== "idle") return;
    detectedRef.current = false;
    setError("");
    setState("starting");
    beginDecode(initialStream).catch((e) => {
      console.error("Pre-opened camera scanner failed", e);
      stop();
      setError(cameraErrorMessage(e));
    });
  }, [beginDecode, initialStream, state, stop]);

  useEffect(() => stop, [stop]);

  return (
    <div className="fixed inset-0 z-[9000] flex items-center justify-center bg-black/60 backdrop-blur-md p-4">
      <div className="bg-card border border-border rounded-3xl shadow-lifted w-full max-w-md overflow-hidden">
        <div className="px-5 py-4 flex justify-between items-center border-b border-border">
          <h3 className="font-display text-xl">Scan barcode</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-accent">✕</button>
        </div>
        <div className="p-4">
          <button
            type="button"
            onClick={start}
            className="relative block w-full rounded-xl overflow-hidden bg-black aspect-[3/4] border border-border"
            aria-label="Start camera scanner"
          >
            <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" muted playsInline autoPlay />
            {state !== "running" && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-card/85 text-foreground">
                <span className="text-3xl animate-pulse">📷</span>
                <span className="font-semibold text-sm">
                  {state === "starting" ? "Opening camera…" : error ? "Camera unavailable" : "Tap to scan"}
                </span>
                {error && <span className="rounded-lg bg-primary text-primary-foreground text-xs font-semibold px-4 py-2">Retry</span>}
              </div>
            )}
          </button>
          <div className="mt-3 flex gap-2">
            <input
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              inputMode="numeric"
              placeholder="Type code"
              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-xs font-mono outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={() => manualCode.trim() && finish(manualCode.trim())}
              className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
            >
              Save
            </button>
          </div>
          <p className="text-xs text-muted-foreground text-center mt-3">
            {error ||
              (state === "running"
                ? "Hold barcode steady inside the frame — auto-scans."
                : "Tap the camera area to start scanning.")}
          </p>
        </div>
      </div>
    </div>
  );
});