import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { changeOwnPin } from "@/lib/users.functions";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldAlert, Loader2, KeyRound } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/change-pin")({ component: ChangePinPage });

function ChangePinPage() {
  const { mustChangePin, refreshProfile } = useAuth();
  const nav = useNavigate();
  const change = useServerFn(changeOwnPin);

  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");

  const mut = useMutation({
    mutationFn: (input: { currentPin: string; newPin: string }) => change({ data: input }),
    onSuccess: async () => {
      toast.success("PIN updated");
      await refreshProfile();
      nav({ to: "/dashboard" });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to update PIN"),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (newPin !== confirmPin) { toast.error("PINs do not match"); return; }
    if (newPin.length < 6) { toast.error("New PIN must be at least 6 digits"); return; }
    mut.mutate({ currentPin, newPin });
  }

  return (
    <div className="min-h-screen grid place-items-center p-6">
      <Card className="card-elevated w-full max-w-md p-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="size-10 rounded-lg gradient-primary grid place-items-center">
            <KeyRound className="size-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Change your PIN</h1>
            <p className="text-xs text-muted-foreground">
              {mustChangePin
                ? "You must update your PIN before accessing the app."
                : "Set a new PIN for your account."}
            </p>
          </div>
        </div>

        {mustChangePin && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning-foreground mb-4">
            <ShieldAlert className="size-4 mt-0.5 text-warning" />
            <span>
              This account is using a default or temporary PIN. Choose a private 6–12 digit PIN to continue.
            </span>
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label>Current PIN</Label>
            <Input
              required type="password" inputMode="numeric"
              value={currentPin} minLength={4} maxLength={12}
              onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ""))}
              placeholder="Current PIN"
            />
          </div>
          <div>
            <Label>New PIN (6–12 digits)</Label>
            <Input
              required type="password" inputMode="numeric"
              value={newPin} minLength={6} maxLength={12}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
              placeholder="••••••"
            />
          </div>
          <div>
            <Label>Confirm new PIN</Label>
            <Input
              required type="password" inputMode="numeric"
              value={confirmPin} minLength={6} maxLength={12}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
              placeholder="••••••"
            />
          </div>
          <Button
            type="submit" disabled={mut.isPending}
            className="w-full gradient-primary text-primary-foreground border-0"
          >
            {mut.isPending && <Loader2 className="size-4 animate-spin mr-2" />}
            Update PIN
          </Button>
        </form>
      </Card>
    </div>
  );
}