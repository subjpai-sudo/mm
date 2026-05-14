import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Save, MessageSquare, Send } from "lucide-react";
import { sendViberTest } from "@/lib/notifications.functions";

export const Route = createFileRoute("/_authenticated/settings")({ component: Settings });

function Settings() {
  const { role } = useAuth();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => (await supabase.from("app_settings").select("*").eq("id", 1).maybeSingle()).data,
  });
  const [baseUrl, setBaseUrl] = useState("");
  const [sender, setSender] = useState("");
  const [phone, setPhone] = useState("");
  useEffect(() => {
    setBaseUrl((data as any)?.infobip_base_url ?? "");
    setSender((data as any)?.viber_sender ?? "");
    setPhone((data as any)?.owner_phone ?? "");
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("app_settings").update({
        infobip_base_url: baseUrl || null,
        viber_sender: sender || null,
        owner_phone: phone || null,
        updated_at: new Date().toISOString(),
      }).eq("id", 1);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["settings"] }); toast.success("Settings saved"); },
    onError: (e: any) => toast.error(e.message),
  });

  const test = useMutation({
    mutationFn: async () => sendViberTest(),
    onSuccess: (r: any) => {
      if (r?.sent) toast.success("Test message sent to Viber ✓");
      else if (r?.reason === "infobip-not-configured") toast.error("Save Infobip base URL, sender, and owner phone first");
      else if (r?.reason === "infobip-key-missing") toast.error("INFOBIP_API_KEY is not set");
      else toast.error(`Infobip error: ${r?.reason ?? "unknown"}${r?.detail ? ` — ${typeof r.detail === "string" ? r.detail : JSON.stringify(r.detail)}` : ""}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (role && role !== "admin") return <Navigate to="/dashboard" />;

  return (
    <div className="p-6 md:p-10 max-w-3xl mx-auto">
      <PageHeader title="Settings" subtitle="Configure Viber integration." />
      <Card className="card-elevated p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="size-10 rounded-xl gradient-primary grid place-items-center"><MessageSquare className="size-5 text-primary-foreground" /></div>
          <div>
            <div className="font-semibold">Infobip Viber</div>
            <div className="text-xs text-muted-foreground">Send owner alerts via Infobip Viber Business Messages.</div>
          </div>
        </div>
        <div className="space-y-4">
          <div><Label>Infobip base URL</Label><Input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="xxxxx.api.infobip.com" /></div>
          <div><Label>Viber sender</Label><Input value={sender} onChange={e => setSender(e.target.value)} placeholder="MyShop (registered Viber sender)" /></div>
          <div><Label>Owner phone (E.164)</Label><Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+639171234567" /></div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => save.mutate()} disabled={save.isPending} className="gradient-primary text-primary-foreground border-0">
              <Save className="size-4" /> Save settings
            </Button>
            <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending}>
              <Send className="size-4" /> Send test message
            </Button>
          </div>
          <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t border-border">
            <p className="font-medium text-foreground">How to set up (Infobip portal):</p>
            <p>1. In <span className="font-mono">portal.infobip.com</span> → <b>Developers → API keys</b>, generate an API key. It was saved as <span className="font-mono">INFOBIP_API_KEY</span>.</p>
            <p>2. Find your account's <b>Base URL</b> (top-right of any API doc page, e.g. <span className="font-mono">xyz123.api.infobip.com</span>) and paste above.</p>
            <p>3. Go to <b>Channels and Numbers → Viber Business Messages</b> and register a sender. Once approved, paste the sender name above.</p>
            <p>4. Enter the owner's phone number in international E.164 format. The phone must have Viber installed.</p>
            <p>5. Save, then <b>Send test message</b>. Note: Viber Business sender approval can take days — until then test calls will return a rejected status.</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
