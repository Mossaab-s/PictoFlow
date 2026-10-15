"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { api, APIError, setCSRFToken } from "@/lib/api";
import { type AuthSession, pathPermitted } from "@/lib/access";
import { vaultDatabase } from "@/lib/offline-vault";
import { shellPrefix } from "@/lib/offline-shell";

const AuthContext = createContext<AuthSession | null>(null);
const lockKey = "pictoflow:explicit-logout";
export function useAuthentication() {
  return useContext(AuthContext);
}

async function forgetLocalCommunication() {
  let referencesBlocked = false;
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key?.startsWith("pictoflow:sequence:"))
        sessionStorage.removeItem(key);
    }
  } catch {
    referencesBlocked = true;
  }
  await Promise.all(
    ["pictoflow-offline-v1", vaultDatabase].map(
      (name) =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = () => resolve();
          request.onerror = () =>
            reject(new Error("Les copies locales n’ont pas pu être effacées."));
          request.onblocked = () =>
            reject(
              new Error(
                "Fermez les autres onglets pour effacer les copies locales.",
              ),
            );
        }),
    ),
  );
  if ("caches" in globalThis)
    await Promise.all(
      (await caches.keys())
        .filter((name) => name.startsWith(shellPrefix))
        .map((name) => caches.delete(name)),
    );
  if (referencesBlocked)
    throw new Error(
      "Les claviers locaux ont été effacés, mais les références de message ne sont pas accessibles dans ce navigateur.",
    );
}

export default function Authentication({
  children,
}: {
  children: React.ReactNode;
}) {
  const path = usePathname();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [error, setError] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const gate = useRef(false);
  const usernameField = useRef<HTMLInputElement>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const locked = useRef(false);
  function localLock(value: boolean) {
    locked.current = value;
    try {
      if (value) localStorage.setItem(lockKey, "1");
      else localStorage.removeItem(lockKey);
    } catch {
      /* Server revocation still applies when local persistence is blocked. */
    }
  }
  useEffect(() => {
    if (session?.enabled && !session.account) usernameField.current?.focus();
  }, [session?.enabled, session?.account?.id]);
  useEffect(() => {
    let cancelled = false;
    if (path === "/offline") return;
    api<AuthSession>("auth/session")
      .then((value) => {
        if (!cancelled) {
          try {
            locked.current =
              locked.current || localStorage.getItem(lockKey) === "1";
          } catch {
            /* Keep the current tab's lock. */
          }
          if (!value.enabled) localLock(false);
          if (value.enabled && locked.current)
            value = { ...value, account: null, csrf_token: null };
          setCSRFToken(value.csrf_token);
          setSession(value);
        }
      })
      .catch(() => {
        if (!cancelled)
          setError(
            "Vérification de l’accès impossible. Réessayez quand le serveur est disponible.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [retry, path]);
  useEffect(() => {
    function expired() {
      setCSRFToken(null);
      setSession((current) =>
        current ? { ...current, account: null, csrf_token: null } : null,
      );
    }
    function changed(event?: MessageEvent | StorageEvent | Event) {
      if (event instanceof MessageEvent && event.data === "logout")
        localLock(true);
      else {
        try {
          locked.current = localStorage.getItem(lockKey) === "1";
        } catch {
          /* Keep the current tab's lock. */
        }
      }
      expired();
      setRetry((value) => value + 1);
    }
    function pageShown(event: PageTransitionEvent) {
      if (event.persisted) changed();
    }
    function storageChanged(event: StorageEvent) {
      if (event.key === lockKey) changed(event);
    }
    if (typeof BroadcastChannel !== "undefined") {
      channel.current = new BroadcastChannel("pictoflow-access");
      channel.current.onmessage = changed;
    }
    window.addEventListener("pictoflow:session-expired", expired);
    window.addEventListener("pictoflow:access-changed", changed);
    window.addEventListener("pageshow", pageShown);
    window.addEventListener("storage", storageChanged);
    return () => {
      channel.current?.close();
      window.removeEventListener("pictoflow:session-expired", expired);
      window.removeEventListener("pictoflow:access-changed", changed);
      window.removeEventListener("pageshow", pageShown);
      window.removeEventListener("storage", storageChanged);
    };
  }, []);
  async function connect(event: React.FormEvent) {
    event.preventDefault();
    if (gate.current) return;
    gate.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api<{
        account: NonNullable<AuthSession["account"]>;
        csrf_token: string;
      }>("auth/login", {
        method: "POST",
        body: JSON.stringify({ username: login, password }),
      });
      setCSRFToken(result.csrf_token);
      localLock(false);
      setSession({ enabled: true, ...result });
      setRetry((value) => value + 1);
      setPassword("");
      channel.current?.postMessage("changed");
    } catch (error) {
      setError(
        error instanceof APIError && error.status === 401
          ? "Identifiant ou mot de passe incorrect."
          : error instanceof Error
            ? error.message
            : "Connexion impossible.",
      );
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  async function disconnect() {
    if (gate.current) return;
    gate.current = true;
    setBusy(true);
    setError("");
    localLock(true);
    try {
      const results = Promise.allSettled([
        api("auth/logout", { method: "POST" }),
        forgetLocalCommunication(),
      ]);
      setSession((current) =>
        current ? { ...current, account: null, csrf_token: null } : null,
      );
      channel.current?.postMessage("logout");
      const [server, storage] = await results;
      if (server.status === "rejected")
        setError(
          "L’accès local est fermé. Le serveur n’a pas confirmé la déconnexion ; reconnectez-vous au retour du réseau pour remplacer cette session.",
        );
      if (storage.status === "rejected")
        setError(
          storage.reason instanceof Error
            ? storage.reason.message
            : "Effacement des copies locales impossible.",
        );
    } finally {
      setCSRFToken(null);
      gate.current = false;
      setBusy(false);
    }
  }
  if (path === "/offline") return <>{children}</>;
  if (!session)
    return (
      <main className="page auth-page">
        <h1>Accès à PictoFlow</h1>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button
              onClick={() => {
                setError("");
                setRetry((value) => value + 1);
              }}
            >
              Réessayer
            </button>
          </>
        ) : (
          <p role="status">Vérification de votre accès…</p>
        )}
      </main>
    );
  if (session.enabled && !session.account)
    return (
      <main className="page auth-page">
        <h1>Se connecter à PictoFlow</h1>
        <p>
          Utilisez votre compte personnel pour retrouver les profils qui vous
          sont confiés.
        </p>
        <form onSubmit={connect} className="account-form">
          <label>
            Identifiant
            <input
              autoComplete="username"
              ref={usernameField}
              required
              maxLength={80}
              value={login}
              onChange={(event) => setLogin(event.target.value)}
            />
          </label>
          <label>
            Mot de passe
            <input
              type="password"
              autoComplete="current-password"
              required
              maxLength={256}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button disabled={busy}>
            {busy ? "Patientez…" : "Se connecter"}
          </button>
        </form>
        {error && <p role="alert">{error}</p>}
      </main>
    );
  return (
    <AuthContext.Provider value={session}>
      {session.enabled && (
        <div className="account-bar">
          <span>{session.account?.display_name}</span>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void disconnect()}
          >
            Se déconnecter et effacer les copies locales
          </button>
          {error && <p role="alert">{error}</p>}
        </div>
      )}
      {pathPermitted(session, path) ? (
        children
      ) : (
        <main className="page">
          <h1>Ce profil ou cet écran ne vous est pas accessible.</h1>
          <Link className="button-link" href="/admin/profiles">
            Retrouver mes profils
          </Link>
        </main>
      )}
    </AuthContext.Provider>
  );
}
