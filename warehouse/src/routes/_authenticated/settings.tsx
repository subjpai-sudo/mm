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
  const [twilioFrom, setTwilioFrom] = useState("");
  const [phone, setPhone] = useState("");
  useEffect(() => {
    setTwilioFrom((data as any)?.twilio_from ?? "");
    setPhone((data as any)?.owner_phone ?? "");
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("app_settings").update({
        twilio_from: twilioFrom || null,
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
      if (r?.sent) toast.success("Test SMS sent ✓");
      else if (r?.reason === "twilio-not-configured") toast.error("Save Twilio sender and owner phone first");
      else if (r?.reason === "twilio-key-missing") toast.error("Twilio connection is not linked");
      else toast.error(`Twilio error: ${r?.reason ?? "unknown"}${r?.detail ? ` — ${typeof r.detail === "string" ? r.detail : JSON.stringify(r.detail)}` : ""}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (role && role !== "admin") return <Navigate to="/dashboard" />;

  return (
    <div className="p-6 md:p-10 max-w-3xl mx-auto">
      <PageHeader title="Settings" subtitle="Configure SMS alerts." />
      <Card className="card-elevated p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="size-10 rounded-xl gradient-primary grid place-items-center"><MessageSquare className="size-5 text-primary-foreground" /></div>
          <div>
            <div className="font-semibold">Twilio SMS</div>
            <div className="text-xs text-muted-foreground">Send owner alerts via Twilio SMS.</div>
          </div>
        </div>
        <div className="space-y-4">
          <div><Label>Twilio sender (From)</Label><Input value={twilioFrom} onChange={e => setTwilioFrom(e.target.value)} placeholder="+15017122661" /></div>
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
            <p className="font-medium text-foreground">How to set up (Twilio):</p>
            <p>1. In <span className="font-mono">console.twilio.com</span>, buy or use an SMS-capable number.</p>
            <p>2. Paste that number above as the <b>Twilio sender</b> in E.164 format (e.g. <span className="font-mono">+15017122661</span>).</p>
            <p>3. Enter the owner's phone in E.164 format. Trial accounts can only SMS verified numbers.</p>
            <p>4. Save, then <b>Send test message</b>.</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
