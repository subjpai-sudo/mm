import { useEffect, useRef } from "react";

/**
 * Global HID / USB / Bluetooth barcode scanner listener.
 *
 * Most wedge-style barcode and QR scanners emulate a keyboard: they type the
 * decoded value extremely fast and end with Enter. We detect that pattern by
 * tracking inter-key timing — if characters arrive in a tight burst (default
 * 35ms apart) and the burst ends in Enter (or a short idle pause), we treat
 * the buffer as a scan and fire `onScan`.
 *
 * The listener stays out of the way of normal typing:
 *  - Single keystrokes from human typing never reach `onScan`.
 *  - When focus is in an editable text field, scans are still captured but we
 *    swallow the Enter so the form doesn't submit unexpectedly.
 */
export function useHidScanner(
  onScan: (code: string) => void,
  options: {
    enabled?: boolean;
    /** Max milliseconds between keystrokes to still be considered the same scan. */
    maxKeyDelta?: number;
    /** Minimum length to treat the buffer as a real scan (avoids false positives). */
    minLength?: number;
    /** Idle timeout (ms) after the last key before flushing if no Enter came. */
    idleTimeout?: number;
  } = {},
) {
  const { enabled = true, maxKeyDelta = 35, minLength = 4, idleTimeout = 80 } = options;
  const cbRef = useRef(onScan);
  cbRef.current = onScan;

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    let buffer = "";
    let lastTs = 0;
    let timer: number | null = null;

    const flush = (terminator?: KeyboardEvent) => {
      if (timer) {
        window.clearTimeout(timer);
        timer = null;
      }
      const code = buffer;
      buffer = "";
      lastTs = 0;
      if (code.length >= minLength) {
        // Swallow the Enter if it came from the scanner — prevents the active
        // form from submitting just because a scan ended.
        if (terminator) {
          terminator.preventDefault();
          terminator.stopPropagation();
        }
        try {
          cbRef.current(code);
        } catch {
          /* noop */
        }
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore modifier-only key presses and the modifier-as-prefix combos.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const now = performance.now();
      const delta = lastTs ? now - lastTs : 0;

      if (e.key === "Enter") {
        // If the buffer was filled rapidly, treat as scan terminator.
        if (buffer.length >= minLength && (delta === 0 || delta <= maxKeyDelta * 4)) {
          flush(e);
        } else {
          buffer = "";
          lastTs = 0;
        }
        return;
      }

      // Only single printable characters belong in a barcode payload.
      if (e.key.length !== 1) return;

      // A gap larger than maxKeyDelta means a human is typing — reset.
      if (lastTs && delta > maxKeyDelta) {
        buffer = "";
      }

      buffer += e.key;
      lastTs = now;

      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => flush(), idleTimeout);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      if (timer) window.clearTimeout(timer);
    };
  }, [enabled, maxKeyDelta, minLength, idleTimeout]);
}