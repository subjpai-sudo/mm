import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Save, MessageSquare, Send, Eye, EyeOff, ScanLine, Sparkles, Bell, Flame } from "lucide-react";
import { sendViberTest } from "@/lib/notifications.functions";
import { FB_CONFIG_OVERRIDE_KEY } from "@/integrations/firebase/billing";

export const Route = createFileRoute("/_authenticated/settings")({ component: Settings });

// Current Firebase web config (public values) — shown as the active config when
// app_settings has no override yet, so the admin can see and edit it.
const FB_DEFAULTS = {
  apiKey: "AIzaSyBF02Uctly222wJh42zOzx4CFq0BfE3LTE",
  authDomain: "mm-mart-live.firebaseapp.com",
  databaseURL: "https://mm-mart-live-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "mm-mart-live",
  storageBucket: "mm-mart-live.firebasestorage.app",
  messagingSenderId: "185038751234",
  appId: "1:185038751234:web:51eaf7763c02a9aa97091b",
};

/** Masked text input with a reveal toggle (admin-only page). */
function SecretInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <Label>{label}</Label>
      <div className="relative">
        <Input type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="pr-10 font-mono text-sm" />
        <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label={show ? "Hide" : "Show"}>
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    </div>
  );
}

function Toggle({ label, desc, checked, onChange, icon }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void; icon: ReactNode }) {
  return (
    <label className="flex items-center gap-3 p-3 rounded-xl border border-border cursor-pointer hover:bg-secondary/40">
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex-1">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-xs text-muted-foreground">{desc}</span>
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-5 accent-primary" />
    </label>
  );
}

function Settings() {
  const { role } = useAuth();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => (await supabase.from("app_settings").select("*").eq("id", 1).maybeSingle()).data,
  });

  // Twilio
  const [twilioSid, setTwilioSid] = useState("");
  const [twilioToken, setTwilioToken] = useState("");
  const [twilioFrom, setTwilioFrom] = useState("");
  const [phone, setPhone] = useState("");
  // Keys
  const [strichKey, setStrichKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  // Firebase config
  const [fb, setFb] = useState({ ...FB_DEFAULTS });
  // Notification prefs
  const [notifyLow, setNotifyLow] = useState(true);
  const [notifyOut, setNotifyOut] = useState(true);
  const [notifyOrder, setNotifyOrder] = useState(true);
  const [enableAiInsights, setEnableAiInsights] = useState(true);

  useEffect(() => {
    const d = data as any;
    if (!d) return;
    setTwilioSid(d.twilio_sid ?? "");
    setTwilioToken(d.twilio_token ?? "");
    setTwilioFrom(d.twilio_from ?? "");
    setPhone(d.owner_phone ?? "");
    setStrichKey(d.strich_license_key ?? "");
    setGeminiKey(d.gemini_api_key ?? "");
    setAnthropicKey(d.anthropic_api_key ?? "");
    setFb({ ...FB_DEFAULTS, ...(d.firebase_config ?? {}) });
    setNotifyLow(d.notify_low_stock !== false);
    setNotifyOut(d.notify_out_of_stock !== false);
    setNotifyOrder(d.notify_new_order !== false);
    setEnableAiInsights(d.enable_ai_insights !== false);
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      const firebase_config = { ...FB_DEFAULTS, ...fb };
      const { error } = await supabase.from("app_settings").update({
        twilio_sid: twilioSid || null,
        twilio_token: twilioToken || null,
        twilio_from: twilioFrom || null,
        owner_phone: phone || null,
        strich_license_key: strichKey || null,
        gemini_api_key: geminiKey || null,
        anthropic_api_key: anthropicKey || null,
        firebase_config,
        notify_low_stock: notifyLow,
        notify_out_of_stock: notifyOut,
        notify_new_order: notifyOrder,
        enable_ai_insights: enableAiInsights,
        updated_at: new Date().toISOString(),
      } as any).eq("id", 1);
      if (error) throw error;
      // Mirror Firebase config so the billing client picks it up on next load.
      try { localStorage.setItem(FB_CONFIG_OVERRIDE_KEY, JSON.stringify(firebase_config)); } catch { /* ignore */ }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["settings"] }); toast.success("Settings saved"); },
    onError: (e: any) => toast.error(e.message),
  });

  const test = useMutation({
    mutationFn: async () => sendViberTest(),
    onSuccess: (r: any) => {
      if (r?.sent) toast.success("Test SMS sent ✓");
      else if (r?.reason === "twilio-not-configured") toast.error("Save Twilio sender and owner phone first");
      else if (r?.reason === "twilio-key-missing") toast.error("Save Account SID and Auth Token first");
      else toast.error(`Twilio error: ${r?.reason ?? "unknown"}${r?.detail ? ` — ${typeof r.detail === "string" ? r.detail : JSON.stringify(r.detail)}` : ""}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (role && role !== "admin" && role !== "owner") return <Navigate to="/dashboard" />;

  const fbField = (k: keyof typeof FB_DEFAULTS, val: string) => setFb((p) => ({ ...p, [k]: val }));

  return (
    <div className="p-6 md:p-10 max-w-3xl mx-auto space-y-6">
      <PageHeader title="Settings" subtitle="Keys & notifications — admin only. Keys are hidden; tap the eye to reveal." />

      {/* Notifications */}
      <Card className="card-elevated p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="size-10 rounded-xl gradient-primary grid place-items-center"><Bell className="size-5 text-primary-foreground" /></div>
          <div><div className="font-semibold">Notifications</div><div className="text-xs text-muted-foreground">Choose what gets an owner alert.</div></div>
        </div>
        <div className="space-y-2">
          <Toggle label="Low stock" desc="Alert when a product drops to/below its threshold." checked={notifyLow} onChange={setNotifyLow} icon={<Bell className="size-4" />} />
          <Toggle label="Out of stock" desc="Alert when a product hits zero." checked={notifyOut} onChange={setNotifyOut} icon={<Flame className="size-4" />} />
          <Toggle label="New order request" desc="Alert when staff submit an order request." checked={notifyOrder} onChange={setNotifyOrder} icon={<Send className="size-4" />} />
        </div>
      </Card>

      {/* Dashboard Features */}
      <Card className="card-elevated p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="size-10 rounded-xl gradient-primary grid place-items-center"><Sparkles className="size-5 text-primary-foreground" /></div>
          <div><div className="font-semibold">Dashboard Features</div><div className="text-xs text-muted-foreground">Customize components shown on your dashboard.</div></div>
        </div>
        <div className="space-y-2">
          <Toggle label="AI Insights Panel" desc="Show or hide the AI insights panel on the main admin dashboard." checked={enableAiInsights} onChange={setEnableAiInsights} icon={<Sparkles className="size-4" />} />
        </div>
      </Card>

      {/* Twilio SMS */}
      <Card className="card-elevated p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="size-10 rounded-xl gradient-primary grid place-items-center"><MessageSquare className="size-5 text-primary-foreground" /></div>
          <div><div className="font-semibold">Twilio SMS</div><div className="text-xs text-muted-foreground">Channel used to send owner alerts.</div></div>
        </div>
        <div className="space-y-4">
          <SecretInput label="Account SID" value={twilioSid} onChange={setTwilioSid} placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
          <SecretInput label="Auth Token" value={twilioToken} onChange={setTwilioToken} placeholder="Your Twilio Auth Token" />
          <div><Label>Twilio sender (From)</Label><Input value={twilioFrom} onChange={(e) => setTwilioFrom(e.target.value)} placeholder="+15017122661" /></div>
          <div><Label>Owner phone (E.164)</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+817084293602" /></div>
          <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending}><Send className="size-4" /> Send test message</Button>
        </div>
      </Card>

      {/* Scanner */}
      <Card className="card-elevated p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="size-10 rounded-xl gradient-primary grid place-items-center"><ScanLine className="size-5 text-primary-foreground" /></div>
          <div><div className="font-semibold">Barcode scanner (STRICH)</div><div className="text-xs text-muted-foreground">License key for the camera scanner.</div></div>
        </div>
        <SecretInput label="STRICH license key" value={strichKey} onChange={setStrichKey} placeholder="Leave blank to use the server secret" />
      </Card>

      {/* AI keys */}
      <Card className="card-elevated p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="size-10 rounded-xl gradient-primary grid place-items-center"><Sparkles className="size-5 text-primary-foreground" /></div>
          <div><div className="font-semibold">AI keys</div><div className="text-xs text-muted-foreground">Used by AI scan & photo cleanup. Blank = use server secret.</div></div>
        </div>
        <div className="space-y-4">
          <SecretInput label="Gemini API key" value={geminiKey} onChange={setGeminiKey} placeholder="Leave blank to use GEMINI_API_KEY secret" />
          <SecretInput label="Anthropic API key" value={anthropicKey} onChange={setAnthropicKey} placeholder="Leave blank to use ANTHROPIC_API_KEY secret" />
        </div>
      </Card>

      {/* Firebase */}
      <Card className="card-elevated p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="size-10 rounded-xl gradient-primary grid place-items-center"><Bell className="size-5 text-primary-foreground" /></div>
          <div><div className="font-semibold">Firebase (billing / notifications)</div><div className="text-xs text-muted-foreground">Web config for the billing realtime database.</div></div>
        </div>
        <div className="space-y-4">
          <SecretInput label="API key" value={fb.apiKey} onChange={(v) => fbField("apiKey", v)} />
          <div><Label>Database URL</Label><Input className="font-mono text-sm" value={fb.databaseURL} onChange={(e) => fbField("databaseURL", e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Project ID</Label><Input className="font-mono text-sm" value={fb.projectId} onChange={(e) => fbField("projectId", e.target.value)} /></div>
            <div><Label>Auth domain</Label><Input className="font-mono text-sm" value={fb.authDomain} onChange={(e) => fbField("authDomain", e.target.value)} /></div>
            <div><Label>Storage bucket</Label><Input className="font-mono text-sm" value={fb.storageBucket} onChange={(e) => fbField("storageBucket", e.target.value)} /></div>
            <div><Label>Messaging sender ID</Label><Input className="font-mono text-sm" value={fb.messagingSenderId} onChange={(e) => fbField("messagingSenderId", e.target.value)} /></div>
            <div className="col-span-2"><Label>App ID</Label><Input className="font-mono text-sm" value={fb.appId} onChange={(e) => fbField("appId", e.target.value)} /></div>
          </div>
        </div>
      </Card>

      <div className="sticky bottom-4 flex justify-end">
        <Button onClick={() => save.mutate()} disabled={save.isPending} className="gradient-primary text-primary-foreground border-0 shadow-lg">
          <Save className="size-4" /> Save all settings
        </Button>
      </div>
    </div>
  );
}
