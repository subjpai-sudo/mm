import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listManagedUsers, createManagedUser, resetUserPin,
  setUserRole, deleteManagedUser,
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
import { UserPlus, KeyRound, Trash2, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/users")({ component: UsersPage });

function UsersPage() {
  const { role } = useAuth();
  const qc = useQueryClient();
  const list = useServerFn(listManagedUsers);
  const create = useServerFn(createManagedUser);
  const reset = useServerFn(resetUserPin);
  const setRole = useServerFn(setUserRole);
  const del = useServerFn(deleteManagedUser);

  const { data, isLoading } = useQuery({
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
        action={<CreateUserDialog onSubmit={(v) => createMut.mutateAsync(v)} busy={createMut.isPending} />}
      />

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
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{u.full_name ?? u.username}</div>
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