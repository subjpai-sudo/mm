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
  const [token, setToken] = useState(""); const [owner, setOwner] = useState(""); const [hook, setHook] = useState("");
  useEffect(() => {
    setToken(data?.viber_bot_token ?? ""); setOwner(data?.viber_owner_id ?? ""); setHook(data?.viber_webhook_url ?? "");
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("app_settings").update({
        viber_bot_token: token || null, viber_owner_id: owner || null, viber_webhook_url: hook || null, updated_at: new Date().toISOString(),
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
      else if (r?.reason === "viber-not-configured") toast.error("Save Bot token and Owner ID first");
      else toast.error(`Viber error: ${r?.reason ?? "unknown"}${r?.detail ? ` — ${typeof r.detail === "string" ? r.detail : JSON.stringify(r.detail)}` : ""}`);
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
            <div className="font-semibold">Viber Bot</div>
            <div className="text-xs text-muted-foreground">Used to deliver order requests.</div>
          </div>
        </div>
        <div className="space-y-4">
          <div><Label>Bot token</Label><Input value={token} onChange={e => setToken(e.target.value)} placeholder="X-Viber-Auth-Token" /></div>
          <div><Label>Owner ID</Label><Input value={owner} onChange={e => setOwner(e.target.value)} placeholder="01a2b3c4d5…" /></div>
          <div><Label>Webhook URL</Label><Input value={hook} onChange={e => setHook(e.target.value)} placeholder="https://yourdomain.com/api/viber" /></div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => save.mutate()} disabled={save.isPending} className="gradient-primary text-primary-foreground border-0">
              <Save className="size-4" /> Save settings
            </Button>
            <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending}>
              <Send className="size-4" /> Send test message
            </Button>
          </div>
          <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t border-border">
            <p className="font-medium text-foreground">How to set up:</p>
            <p>1. Create a Viber bot at <span className="font-mono">partners.viber.com</span> → copy the auth token into <b>Bot token</b>.</p>
            <p>2. Open the bot in Viber and tap <b>Subscribe</b> / send any message — that registers the owner.</p>
            <p>3. Get the owner's Viber user ID (from the bot's webhook payload, or via <span className="font-mono">get_account_info</span>) and paste into <b>Owner ID</b>.</p>
            <p>4. Save, then click <b>Send test message</b> — you should receive a Viber message instantly.</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
