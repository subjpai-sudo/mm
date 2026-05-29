import React, { createContext, useContext, useEffect, useState } from "react";
import {
  onAuthStateChanged, signOut, RecaptchaVerifier,
  signInWithPhoneNumber, initializeRecaptchaConfig,
  type User, type ConfirmationResult,
} from "firebase/auth";
import { getDatabase, ref, get, set, remove, onValue } from "firebase/database";
import { auth } from "@/lib/firebase";

const db = getDatabase();
const USERS_PATH = "auth_users";

export function phoneToKey(phone: string) {
  return phone.replace(/\D/g, "");
}

export type AuthUser = {
  uid: string;
  phone: string;
  name: string;
  admin: boolean;
};

export type AllowedUser = {
  phone: string;
  name: string;
  admin: boolean;
  allowed: boolean;
  addedAt: string;
};

type AuthContextType = {
  user: AuthUser | null;
  loading: boolean;
  denied: boolean;
  sendOTP: (phone: string) => Promise<ConfirmationResult>;
  verifyOTP: (result: ConfirmationResult, code: string) => Promise<void>;
  logout: () => Promise<void>;
  users: AllowedUser[];
  addUser: (phone: string, name: string, admin?: boolean) => Promise<void>;
  removeUser: (phone: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [users, setUsers] = useState<AllowedUser[]>([]);

  useEffect(() => {
    initializeRecaptchaConfig(auth).catch(() => {});
    const unsub = onAuthStateChanged(auth, async (fbUser: User | null) => {
      setDenied(false);
      if (!fbUser?.phoneNumber) {
        setUser(null);
        setLoading(false);
        return;
      }
      const key = phoneToKey(fbUser.phoneNumber);
      const snap = await get(ref(db, `${USERS_PATH}/${key}`));
      if (snap.exists() && snap.val()?.allowed) {
        const data = snap.val();
        setUser({ uid: fbUser.uid, phone: fbUser.phoneNumber, name: data.name || fbUser.phoneNumber, admin: !!data.admin });
      } else {
        setDenied(true);
        await signOut(auth);
        setUser(null);
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user?.admin) return;
    return onValue(ref(db, USERS_PATH), (snap) => {
      if (!snap.exists()) { setUsers([]); return; }
      setUsers(Object.values(snap.val()) as AllowedUser[]);
    });
  }, [user?.admin]);

  const sendOTP = async (phone: string): Promise<ConfirmationResult> => {
    // Destroy any previous verifier widget before creating a new one
    const old = document.getElementById("rc-widget");
    if (old) old.remove();

    const div = document.createElement("div");
    div.id = "rc-widget";
    // Must be attached to a visible part of the DOM before render()
    const host = document.getElementById("recaptcha-host") ?? document.body;
    host.appendChild(div);

    const verifier = new RecaptchaVerifier(auth, div, {
      size: "invisible",
      callback: () => {},
      "expired-callback": () => {},
    });

    await verifier.render();
    return signInWithPhoneNumber(auth, phone, verifier);
  };

  const verifyOTP = async (result: ConfirmationResult, code: string) => {
    await result.confirm(code);
  };

  const logout = async () => {
    await signOut(auth);
    setUser(null);
  };

  const addUser = async (phone: string, name: string, admin = false) => {
    const key = phoneToKey(phone);
    await set(ref(db, `${USERS_PATH}/${key}`), {
      phone, name, admin, allowed: true,
      addedAt: new Date().toISOString(),
    });
  };

  const removeUser = async (phone: string) => {
    await remove(ref(db, `${USERS_PATH}/${phoneToKey(phone)}`));
  };

  return (
    <AuthContext.Provider value={{ user, loading, denied, sendOTP, verifyOTP, logout, users, addUser, removeUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
