import { useState } from "react";
import { useAuth, type AllowedUser } from "@/contexts/AuthContext";

export function UsersPanel({ onClose }: { onClose: () => void }) {
  const { users, addUser, removeUser, user: me } = useAuth();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState("");

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    const cleaned = phone.trim();
    if (!cleaned.startsWith("+") || cleaned.length < 8) {
      setErr("Phone must include country code, e.g. +81 90 1234 5678");
      return;
    }
    if (!name.trim()) { setErr("Name is required"); return; }
    setAdding(true);
    try {
      await addUser(cleaned, name.trim(), isAdmin);
      setPhone(""); setName(""); setIsAdmin(false);
    } catch {
      setErr("Failed to add user");
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (u: AllowedUser) => {
    if (!confirm(`Remove access for ${u.name} (${u.phone})?`)) return;
    if (u.phone === me?.phone) { alert("You cannot remove yourself."); return; }
    await removeUser(u.phone);
  };

  return (
    <div
      className="fixed inset-0 z-[8000] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-card border border-border rounded-3xl shadow-lifted w-full max-w-md max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="font-semibold text-foreground">Authorized Users</h2>
            <p className="text-xs text-muted-foreground">{users.length} user{users.length !== 1 ? "s" : ""}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground">×</button>
        </div>

        {/* User list */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {users.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">No users yet. Add one below.</p>
          )}
          {users.map(u => (
            <div key={u.phone} className="flex items-center gap-3 bg-secondary/50 rounded-xl px-4 py-3">
              <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-sm shrink-0">
                {u.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground truncate">{u.name}</span>
                  {u.admin && <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded font-medium">Admin</span>}
                  {u.phone === me?.phone && <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded">You</span>}
                </div>
                <div className="text-xs text-muted-foreground font-mono mt-0.5">{u.phone}</div>
              </div>
              {u.phone !== me?.phone && (
                <button
                  onClick={() => handleRemove(u)}
                  className="text-xs text-muted-foreground hover:text-destructive transition shrink-0 px-2 py-1 rounded-lg hover:bg-destructive/10"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Add user form */}
        <div className="border-t border-border px-4 py-4">
          <p className="text-xs font-medium text-foreground mb-3">Add authorized user</p>
          <form onSubmit={handleAdd} className="space-y-2">
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Full name"
              className="w-full bg-secondary border border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="+81 90 1234 5678 (include country code)"
              className="w-full bg-secondary border border-border rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isAdmin}
                onChange={e => setIsAdmin(e.target.checked)}
                className="w-4 h-4 rounded"
              />
              <span className="text-xs text-muted-foreground">Grant admin access (can manage users)</span>
            </label>
            {err && <p className="text-xs text-destructive">{err}</p>}
            <button
              type="submit"
              disabled={adding}
              className="w-full bg-primary text-primary-foreground font-semibold rounded-xl py-2.5 text-sm hover:brightness-110 transition disabled:opacity-60"
            >
              {adding ? "Adding…" : "Add User"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
