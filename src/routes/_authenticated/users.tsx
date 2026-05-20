import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listManagedUsers, createManagedUser, resetUserPin,
  setUserRole, deleteManagedUser, inviteManagedUser,
} from "@/lib/users.functions";
import { useAuth, type Role } from "@/lib/auth";
import { PageHeader } from "@/components/app/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { UserPlus, KeyRound, Trash2, Loader2, Mail, Copy, ShieldAlert } from "lucide-react";
import { useEffect, useState as useReactState } from "react";

function ServerHealthBanner({ errorMessage }: { errorMessage: string }) {
  const [health, setHealth] = useReactState<
    { ok: boolean; missing: string[]; present: Record<string, boolean> } | null
  >(null);
  const [loading, setLoading] = useReactState(true);

  useEffect(() => {
    let alive = true;
    fetch("/api/public/server-health", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => alive && setHealth(j))
      .catch(() => alive && setHealth({ ok: false, missing: ["unreachable"], present: {} }))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  return (
    <Card className="border-destructive/40 bg-destructive/5 p-4 space-y-2">
      <div className="flex items-center gap-2 font-semibold text-destructive">
        <ShieldAlert className="size-4" /> Couldn't load users
      </div>
      <p className="text-xs text-muted-foreground font-mono break-all">{errorMessage}</p>
      {loading ? (
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          <Loader2 className="size-3 animate-spin" /> Checking server configuration…
        </div>
      ) : health?.ok ? (
        <p className="text-xs text-muted-foreground">
          Server secrets look fine. The error is likely from the database query itself — check server logs.
        </p>
      ) : (
        <div className="text-xs space-y-1">
          <p className="font-medium">Missing Worker secrets:</p>
          <ul className="list-disc list-inside font-mono">
            {(health?.missing ?? []).map((k) => <li key={k}>{k}</li>)}
          </ul>
          <p className="text-muted-foreground pt-1">
            Set them on your Cloudflare Worker (see deploy docs) and redeploy.
          </p>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        For self-hosted Cloudflare, the users page can load with normal signed-in access, but creating, deleting, resetting PINs, and mirror sync still need the admin backend key configured on that deployment.
      </p>
    </Card>
  );
}

export const Route = createFileRoute("/_authenticated/users")({ component: UsersPage });

function UsersPage() {
  const { role } = useAuth();
  const qc = useQueryClient();
  const list = useServerFn(listManagedUsers);
  const create = useServerFn(createManagedUser);
  const invite = useServerFn(inviteManagedUser);
  const reset = useServerFn(resetUserPin);
  const setRole = useServerFn(setUserRole);
  const del = useServerFn(deleteManagedUser);

  const { data, isLoading, error } = useQuery({
    queryKey: ["managed-users"],
    queryFn: () => list(),
    enabled: role === "admin" || role === "owner",
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["managed-users"] });

  const createMut = useMutation({
    mutationFn: (input: { fullName: string; username: string; pin: string; role: Role }) =>
      create({ data: input }),
    onSuccess: (r) => { toast.success(`Created ${r.username}`); refresh(); },
    onError: (e: any) => toast.error(e.message),
  });
  const [invited, setInvited] = useState<{ username: string; tempPin: string; phone: string; sms: any } | null>(null);
  const inviteMut = useMutation({
    mutationFn: (input: { fullName: string; username: string; role: Role; phone: string }) =>
      invite({ data: input }),
    onSuccess: (r) => {
      if (r.sms?.sent) toast.success(`Invited @${r.username} — SMS sent to ${r.phone}`);
      else toast.warning(`Invited @${r.username} — SMS failed (${r.sms?.reason ?? "unknown"})`);
      setInvited({ username: r.username, tempPin: r.tempPin, phone: r.phone, sms: r.sms });
      refresh();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const resetMut = useMutation({
    mutationFn: (input: { userId: string; pin: string }) => reset({ data: input }),
    onSuccess: () => toast.success("PIN reset"),
    onError: (e: any) => toast.error(e.message),
  });
  const roleMut = useMutation({
    mutationFn: (input: { userId: string; role: Role }) => setRole({ data: input }),
    onSuccess: () => { toast.success("Role updated"); refresh(); },
    onError: (e: any) => toast.error(e.message),
  });
  const delMut = useMutation({
    mutationFn: (userId: string) => del({ data: { userId } }),
    onSuccess: () => { toast.success("User deleted"); refresh(); },
    onError: (e: any) => toast.error(e.message),
  });

  if (role && role !== "admin" && role !== "owner") return <Navigate to="/dashboard" />;

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto space-y-6">
      <PageHeader
        title="Users"
        subtitle="Issue username + PIN logins. Everyone defaults to Operator."
        actions={
          <div className="flex flex-wrap gap-2">
            <InviteUserDialog onSubmit={(v) => inviteMut.mutateAsync(v)} busy={inviteMut.isPending} />
            <CreateUserDialog onSubmit={(v) => createMut.mutateAsync(v)} busy={createMut.isPending} />
          </div>
        }
      />

      <InviteResultDialog invited={invited} onClose={() => setInvited(null)} />

      {error && <ServerHealthBanner errorMessage={(error as any)?.message ?? String(error)} />}

      <Card className="card-elevated p-0 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" /> Loading users…
          </div>
        ) : (data?.length ?? 0) === 0 ? (
          <div className="p-8 text-sm text-muted-foreground">No users yet. Create one above.</div>
        ) : (
          <div className="divide-y">
            {data!.map((u) => (
              <div key={u.id} className="p-4 flex flex-wrap items-center gap-3">
                <div className="size-10 rounded-full overflow-hidden border border-border bg-muted grid place-items-center shrink-0">
                  {(u as any).avatar_url ? (
                    <img src={(u as any).avatar_url} alt={u.full_name ?? u.username} className="size-full object-cover" />
                  ) : (
                    <span className="text-xs font-semibold text-muted-foreground">
                      {(u.full_name ?? u.username).slice(0, 2).toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate flex items-center gap-2">
                    {u.full_name ?? u.username}
                    {(u as any).must_change_pin && (
                      <Badge variant="outline" className="text-[9px] gap-1 border-warning/40 text-warning">
                        <ShieldAlert className="size-3" /> Temp PIN
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono truncate">@{u.username}</div>
                </div>
                <Select
                  value={(u.roles[0] ?? "operator") as Role}
                  onValueChange={(v) => roleMut.mutate({ userId: u.id, role: v as Role })}
                >
                  <SelectTrigger className="w-32 h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="operator">Operator</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="owner">Owner</SelectItem>
                  </SelectContent>
                </Select>
                <Badge variant="secondary" className="text-[10px]">
                  {u.roles[0] ?? "operator"}
                </Badge>
                <ResetPinDialog onSubmit={(pin) => resetMut.mutateAsync({ userId: u.id, pin })} busy={resetMut.isPending} />
                <Button
                  variant="ghost" size="icon"
                  onClick={() => {
                    if (confirm(`Delete @${u.username}?`)) delMut.mutate(u.id);
                  }}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function CreateUserDialog({
  onSubmit, busy,
}: { onSubmit: (v: { fullName: string; username: string; pin: string; role: Role }) => Promise<any>; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [role, setRole] = useState<Role>("operator");

  // Auto-suggest username from name
  function onName(v: string) {
    setFullName(v);
    if (!username || username === slugify(fullName)) setUsername(slugify(v));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await onSubmit({ fullName, username, pin, role });
    setOpen(false);
    setFullName(""); setUsername(""); setPin(""); setRole("operator");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gradient-primary text-primary-foreground border-0">
          <UserPlus className="size-4" /> New user
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Create user</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label>Full name</Label>
            <Input required value={fullName} onChange={(e) => onName(e.target.value)} placeholder="Jane Doe" />
          </div>
          <div>
            <Label>Username (login)</Label>
            <Input
              required value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              pattern="[a-z0-9._-]+"
              placeholder="jane.doe"
            />
            <p className="text-[10px] text-muted-foreground mt-1">Lowercase letters, digits, . _ -</p>
          </div>
          <div>
            <Label>PIN (4–12 digits)</Label>
            <Input
              required value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              minLength={4} maxLength={12} inputMode="numeric"
              placeholder="1234"
            />
          </div>
          <div>
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="operator">Operator (default)</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="owner">Owner</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy} className="gradient-primary text-primary-foreground border-0">
              {busy && <Loader2 className="size-4 animate-spin" />} Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPinDialog({ onSubmit, busy }: { onSubmit: (pin: string) => Promise<any>; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm"><KeyRound className="size-4" /> PIN</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Reset PIN</DialogTitle></DialogHeader>
        <form
          onSubmit={async (e) => { e.preventDefault(); await onSubmit(pin); setOpen(false); setPin(""); }}
          className="space-y-4"
        >
          <div>
            <Label>New PIN</Label>
            <Input
              required value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              minLength={4} maxLength={12} inputMode="numeric" placeholder="1234"
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy} className="gradient-primary text-primary-foreground border-0">
              {busy && <Loader2 className="size-4 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");
}

function InviteUserDialog({
  onSubmit, busy,
}: { onSubmit: (v: { fullName: string; username: string; role: Role; phone: string }) => Promise<any>; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<Role>("operator");
  const [phone, setPhone] = useState("");

  function onName(v: string) {
    setFullName(v);
    if (!username || username === slugify(fullName)) setUsername(slugify(v));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await onSubmit({ fullName, username, role, phone });
    setOpen(false);
    setFullName(""); setUsername(""); setRole("operator"); setPhone("");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Mail className="size-4" /> Invite
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Invite user</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2">
          We'll text the login link and a temporary PIN of <span className="font-mono">0000</span> to the phone below. The user must change the PIN on first sign-in.
        </p>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label>Full name</Label>
            <Input required value={fullName} onChange={(e) => onName(e.target.value)} placeholder="Jane Doe" />
          </div>
          <div>
            <Label>Username (login)</Label>
            <Input
              required value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              pattern="[a-z0-9._-]+"
              placeholder="jane.doe"
            />
          </div>
          <div>
            <Label>Mobile phone (E.164)</Label>
            <Input
              required value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/[^\d+]/g, ""))}
              placeholder="+15558675310"
              inputMode="tel"
            />
            <p className="text-[10px] text-muted-foreground mt-1">Include country code, e.g. +63 for PH, +1 for US.</p>
          </div>
          <div>
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="operator">Operator (default)</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="owner">Owner</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy} className="gradient-primary text-primary-foreground border-0">
              {busy && <Loader2 className="size-4 animate-spin" />} Send SMS invite
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function InviteResultDialog({
  invited, onClose,
}: { invited: { username: string; tempPin: string; phone: string; sms: any } | null; onClose: () => void }) {
  const open = invited !== null;
  const loginUrl = typeof window !== "undefined" ? `${window.location.origin}/login` : "/login";
  const shareText = invited
    ? `Sign in at ${loginUrl}\nUsername: ${invited.username}\nTemporary PIN: ${invited.tempPin}\n(You will be asked to change the PIN on first sign-in.)`
    : "";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Invite ready</DialogTitle></DialogHeader>
        {invited && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {invited.sms?.sent
                ? <>SMS sent to <span className="font-mono">{invited.phone}</span>. Share again below if needed.</>
                : <>SMS delivery failed (<span className="font-mono">{invited.sms?.reason ?? "unknown"}</span>). Share these credentials manually.</>}
            </p>
            <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Login URL</span><span className="font-mono text-xs">{loginUrl}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Username</span><span className="font-mono">{invited.username}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Phone</span><span className="font-mono">{invited.phone}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Temporary PIN</span><span className="font-mono text-base font-semibold tracking-wider">{invited.tempPin}</span></div>
            </div>
            <div className="flex gap-2">
              <Button
                type="button" variant="outline" className="flex-1"
                onClick={() => { navigator.clipboard.writeText(shareText); toast.success("Copied to clipboard"); }}
              >
                <Copy className="size-4" /> Copy invite
              </Button>
              <Button type="button" className="flex-1 gradient-primary text-primary-foreground border-0" onClick={onClose}>
                Done
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground text-center">
              This PIN won't be shown again. Reset it from the user list if lost.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}