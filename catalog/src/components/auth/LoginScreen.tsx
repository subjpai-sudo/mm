import { useState, useRef } from "react";
import { type ConfirmationResult } from "firebase/auth";
import { useAuth } from "@/contexts/AuthContext";

const COUNTRIES = [
  { code: "+81", flag: "🇯🇵", name: "Japan" },
  { code: "+1",  flag: "🇺🇸", name: "USA/Canada" },
  { code: "+44", flag: "🇬🇧", name: "UK" },
  { code: "+65", flag: "🇸🇬", name: "Singapore" },
  { code: "+66", flag: "🇹🇭", name: "Thailand" },
  { code: "+62", flag: "🇮🇩", name: "Indonesia" },
  { code: "+95", flag: "🇲🇲", name: "Myanmar" },
  { code: "+91", flag: "🇮🇳", name: "India" },
  { code: "+60", flag: "🇲🇾", name: "Malaysia" },
  { code: "+82", flag: "🇰🇷", name: "South Korea" },
  { code: "+86", flag: "🇨🇳", name: "China" },
  { code: "+61", flag: "🇦🇺", name: "Australia" },
];

export function LoginScreen({ denied }: { denied: boolean }) {
  const { sendOTP, verifyOTP } = useAuth();
  const [countryCode, setCountryCode] = useState("+81");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const confirmRef = useRef<ConfirmationResult | null>(null);

  const fullPhone = `${countryCode}${phone.replace(/\D/g, "")}`;

  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!phone.trim()) { setError("Enter your phone number"); return; }
    setLoading(true);
    try {
      confirmRef.current = await sendOTP(fullPhone);
      setStep("otp");
    } catch (err: unknown) {
      const code = (err as {code?: string})?.code ?? "";
      const raw  = err instanceof Error ? err.message : String(err);
      if (code === "auth/invalid-phone-number" || raw.includes("invalid-phone-number"))
        setError("Invalid phone number. Include country code e.g. +81 90 1234 5678");
      else if (code === "auth/too-many-requests" || raw.includes("too-many-requests"))
        setError("Too many attempts. Wait a few minutes and try again.");
      else if (code === "auth/captcha-check-failed" || raw.includes("captcha"))
        setError("reCAPTCHA failed — please refresh the page and try again.");
      else if (code === "auth/operation-not-allowed")
        setError("Phone auth not enabled. Enable it in Firebase Console → Authentication → Sign-in method → Phone.");
      else if (code === "auth/network-request-failed")
        setError("Network error. Check your internet connection.");
      else
        setError(`Error (${code || "unknown"}): ${raw.slice(0, 120)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmRef.current) return;
    setError("");
    if (otp.length < 6) { setError("Enter the 6-digit code"); return; }
    setLoading(true);
    try {
      await verifyOTP(confirmRef.current, otp);
      // onAuthStateChanged will update user state — if not whitelisted, denied will be set
    } catch {
      setError("Incorrect code. Check your SMS and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="font-display text-5xl leading-none">
            Cata<span className="text-primary">log</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-2 tracking-wide">MM-MART · Product Catalog</p>
        </div>

        <div className="bg-card border border-border rounded-3xl shadow-lifted p-6">
          {denied && (
            <div className="mb-5 bg-destructive/10 border border-destructive/30 text-destructive rounded-xl px-4 py-3 text-sm text-center">
              This phone number is not authorized.<br />
              <span className="text-xs opacity-75">Contact your admin to get access.</span>
            </div>
          )}

          {step === "phone" ? (
            <form onSubmit={handleSendOTP} noValidate>
              <p className="text-sm font-medium text-foreground mb-4">Sign in with your phone number</p>

              <label className="text-xs text-muted-foreground mb-1.5 block">Phone number</label>
              <div className="flex gap-2 mb-4">
                <select
                  value={countryCode}
                  onChange={e => setCountryCode(e.target.value)}
                  className="bg-secondary border border-border rounded-xl px-3 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40 w-28"
                >
                  {COUNTRIES.map(c => (
                    <option key={c.code} value={c.code}>{c.flag} {c.code}</option>
                  ))}
                </select>
                <input
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="90 1234 5678"
                  className="flex-1 bg-secondary border border-border rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
                  autoFocus
                  autoComplete="tel-national"
                />
              </div>

              {error && <p className="text-xs text-destructive mb-3">{error}</p>}

              <div id="recaptcha-host" className="flex justify-center mb-3" />

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-primary text-primary-foreground font-semibold rounded-xl py-3 text-sm hover:brightness-110 transition disabled:opacity-60"
              >
                {loading ? "Sending…" : "Send Verification Code"}
              </button>

              <p className="text-xs text-muted-foreground text-center mt-4">
                A 6-digit code will be sent to {fullPhone || "your number"}
              </p>
            </form>
          ) : (
            <form onSubmit={handleVerify} noValidate>
              <button
                type="button"
                onClick={() => { setStep("phone"); setOtp(""); setError(""); }}
                className="text-xs text-muted-foreground hover:text-foreground mb-4 flex items-center gap-1"
              >
                ← Back
              </button>

              <p className="text-sm font-medium text-foreground mb-1">Enter verification code</p>
              <p className="text-xs text-muted-foreground mb-4">Sent to {fullPhone}</p>

              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={otp}
                onChange={e => setOtp(e.target.value.replace(/\D/g, ""))}
                placeholder="· · · · · ·"
                className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-center text-2xl font-mono tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-primary/40 mb-4"
                autoFocus
                autoComplete="one-time-code"
              />

              {error && <p className="text-xs text-destructive mb-3">{error}</p>}

              <button
                type="submit"
                disabled={loading || otp.length < 6}
                className="w-full bg-primary text-primary-foreground font-semibold rounded-xl py-3 text-sm hover:brightness-110 transition disabled:opacity-60"
              >
                {loading ? "Verifying…" : "Verify & Sign In"}
              </button>
            </form>
          )}
        </div>

        <p className="text-xs text-center text-muted-foreground mt-5 opacity-50">
          MM-MART Internal System · Authorized Users Only
        </p>
      </div>
    </div>
  );
}
