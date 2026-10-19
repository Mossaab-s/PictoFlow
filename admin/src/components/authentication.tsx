"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { api, APIError, setCSRFToken } from "@/lib/api";
import {
  type AuthSession,
  entryRedirect,
  landingPath,
  pathPermitted,
} from "@/lib/access";
import { vaultDatabase } from "@/lib/offline-vault";
import { shellPrefix } from "@/lib/offline-shell";
import {
  accessEpoch,
  accessEpochKey,
  accompaniedKey,
  accompaniedMarker,
  markAccompanied,
  publishAccessChange,
} from "@/lib/access-transition";

const AuthContext = createContext<AuthSession | null>(null);
const AccompaniedContext = createContext<{
  busy: boolean;
  start: (profileId: string) => Promise<void>;
}>({ busy: false, start: async () => {} });
const lockKey = "pictoflow:explicit-logout";
export function useAuthentication() {
  return useContext(AuthContext);
}
export function useAccompaniedAccess() {
  return useContext(AccompaniedContext);
}

function forgetMessageReferences() {
  for (let i = sessionStorage.length - 1; i >= 0; i--) {
    const key = sessionStorage.key(i);
    if (key?.startsWith("pictoflow:sequence:")) sessionStorage.removeItem(key);
  }
}

function syncMessageReferences() {
  const epoch = accessEpoch() ?? "";
  const marker = accompaniedMarker();
  if (
    marker &&
    (sessionStorage.getItem("pictoflow:session-epoch") !== epoch ||
      ["pending", "locked"].includes(marker))
  )
    forgetMessageReferences();
  sessionStorage.setItem("pictoflow:session-epoch", epoch);
}

async function forgetLocalCommunication() {
  let referencesBlocked = false;
  try {
    forgetMessageReferences();
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
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [checkedPath, setCheckedPath] = useState("");
  const [error, setError] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const gate = useRef(false);
  const usernameField = useRef<HTMLInputElement>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const locked = useRef(false);
  const handingOff = useRef(false);
  const [transitioning, setTransitioning] = useState(false);
  const [offlineBlocked, setOfflineBlocked] = useState(true);
  const [pendingHandoff, setPendingHandoff] = useState(false);
  const observedEpoch = useRef<string | null>(null);
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
    try {
      syncMessageReferences();
    } catch {
      /* Unavailable storage cannot restore a reference. */
    }
    observedEpoch.current = accessEpoch();
    setOfflineBlocked(!!accompaniedMarker());
    setPendingHandoff(accompaniedMarker() === "pending");
    if (path === "/offline") return;
    if (handingOff.current || accompaniedMarker() === "pending") return;
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
          const marker = accompaniedMarker();
          if (
            marker &&
            value.enabled &&
            value.account &&
            marker !== value.account.assisted_profile_id
          )
            value = { ...value, account: null, csrf_token: null };
          if (value.enabled && locked.current)
            value = { ...value, account: null, csrf_token: null };
          setCSRFToken(value.csrf_token);
          setSession(value);
          setCheckedPath(path);
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
  const destination =
    session && (!session.enabled || session.account) && checkedPath === path
      ? entryRedirect(session, path)
      : null;
  useEffect(() => {
    if (destination) {
      // Preserve message recovery and phrase links on known legacy aliases only.
      const query = path.startsWith("/admin/profiles/")
        ? window.location.search
        : "";
      router.replace(destination + query);
    }
  }, [destination, path, router]);
  useEffect(() => {
    function expired() {
      setCSRFToken(null);
      setSession((current) =>
        current ? { ...current, account: null, csrf_token: null } : null,
      );
    }
    function changed(event?: MessageEvent | StorageEvent | Event) {
      observedEpoch.current = accessEpoch();
      setOfflineBlocked(!!accompaniedMarker());
      setPendingHandoff(accompaniedMarker() === "pending");
      try {
        syncMessageReferences();
      } catch {
        /* Unavailable storage cannot restore a reference. */
      }
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
      else document.body.style.visibility = "";
    }
    function pageHidden() {
      // BFCache must not paint an adult screen before a fresh session check.
      document.body.style.visibility = "hidden";
      expired();
      setCheckedPath("");
    }
    function focused() {
      if (observedEpoch.current !== accessEpoch()) changed();
    }
    function storageChanged(event: StorageEvent) {
      if ([lockKey, accessEpochKey, accompaniedKey].includes(event.key ?? ""))
        changed(event);
    }
    if (typeof BroadcastChannel !== "undefined") {
      channel.current = new BroadcastChannel("pictoflow-access");
      channel.current.onmessage = changed;
    }
    window.addEventListener("pictoflow:session-expired", expired);
    window.addEventListener("pictoflow:access-changed", changed);
    window.addEventListener("pageshow", pageShown);
    window.addEventListener("pagehide", pageHidden);
    window.addEventListener("focus", focused);
    window.addEventListener("storage", storageChanged);
    return () => {
      channel.current?.close();
      window.removeEventListener("pictoflow:session-expired", expired);
      window.removeEventListener("pictoflow:access-changed", changed);
      window.removeEventListener("pageshow", pageShown);
      window.removeEventListener("pagehide", pageHidden);
      window.removeEventListener("focus", focused);
      window.removeEventListener("storage", storageChanged);
    };
  }, []);
  useEffect(() => {
    if ((session && checkedPath === path) || path === "/offline")
      document.body.style.visibility = "";
  }, [session, checkedPath, path]);

  async function startAccompanied(profileId: string) {
    if (gate.current || !session?.csrf_token) return;
    gate.current = true;
    handingOff.current = true;
    const previousCSRF = session.csrf_token;
    setBusy(true);
    setTransitioning(true);
    setError("");
    try {
      // A durable marker is required before local copies can be cleared or the browser handed over.
      markAccompanied("pending");
      // Also close offline portals running a previous application build.
      localLock(true);
      publishAccessChange();
      channel.current?.postMessage("changed");
      await forgetLocalCommunication();
      try {
        const response = await fetch("/api/pictoflow/auth/accompanied", {
          method: "POST",
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": previousCSRF,
          },
          body: JSON.stringify({ profile_id: profileId }),
        });
        if (!response.ok) throw new APIError(response.status);
      } catch {
        // A lost response may have committed. Read the cookie's current scope; never resend.
      }
      const response = await fetch("/api/pictoflow/auth/session", {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error("Passage de relais non confirmé.");
      const value = (await response.json()) as AuthSession;
      if (
        !value.enabled ||
        value.account?.assisted_profile_id !== profileId ||
        !value.csrf_token
      )
        throw new Error(
          "Passage de relais non confirmé. Reconnectez-vous avant de réessayer.",
        );
      markAccompanied(profileId);
      localLock(false);
      setCSRFToken(value.csrf_token);
      setSession(value);
      setCheckedPath("");
      router.replace(`/communication/${profileId}`);
      channel.current?.postMessage("changed");
    } catch (failure) {
      localLock(true);
      try {
        markAccompanied("locked");
      } catch {
        /* Retain the local login gate. */
      }
      setCSRFToken(null);
      setSession({ enabled: true, account: null, csrf_token: null });
      setCheckedPath(path);
      setError(
        failure instanceof Error
          ? failure.message
          : "Passage de relais impossible. Reconnectez-vous.",
      );
      channel.current?.postMessage("logout");
    } finally {
      handingOff.current = false;
      gate.current = false;
      setTransitioning(false);
      setBusy(false);
      publishAccessChange();
    }
  }
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
      const returningFromHandoff = !!accompaniedMarker();
      if (returningFromHandoff) {
        await forgetLocalCommunication();
        localStorage.removeItem(accompaniedKey);
      }
      setCSRFToken(result.csrf_token);
      localLock(false);
      setSession({ enabled: true, ...result });
      setCheckedPath(path);
      setRetry((value) => value + 1);
      setPassword("");
      if (returningFromHandoff)
        router.replace(landingPath({ enabled: true, ...result }));
      channel.current?.postMessage("changed");
      publishAccessChange();
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
    if (accompaniedMarker() === "pending") {
      try {
        markAccompanied("locked");
      } catch {
        /* Keep the local gate. */
      }
    }
    try {
      const results = Promise.allSettled([
        (async () => {
          // This boundary deliberately invalidates the ordinary API response fence.
          // Recover CSRF after an interrupted handoff without restoring any tools.
          let token = session?.csrf_token;
          if (!token) {
            const current = await fetch("/api/pictoflow/auth/session", {
              cache: "no-store",
            });
            if (!current.ok) throw new Error("Session inaccessible.");
            token = ((await current.json()) as AuthSession).csrf_token;
          }
          const response = await fetch("/api/pictoflow/auth/logout", {
            method: "POST",
            cache: "no-store",
            headers: token ? { "X-CSRF-Token": token } : {},
          });
          if (!response.ok) throw new APIError(response.status);
        })(),
        forgetLocalCommunication(),
      ]);
      setSession((current) =>
        current ? { ...current, account: null, csrf_token: null } : null,
      );
      channel.current?.postMessage("logout");
      publishAccessChange();
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
  if (transitioning || pendingHandoff)
    return (
      <main className="page auth-page">
        <h1>Préparation du clavier</h1>
        <p role="status">
          Le passage de relais est en cours. Ne confiez pas encore cet appareil.
        </p>
        <button disabled={busy} onClick={() => void disconnect()}>
          Fermer l’accès et se reconnecter
        </button>
      </main>
    );
  if (path === "/offline")
    return offlineBlocked ? (
      <main className="page auth-page">
        <h1>Session accompagnée en ligne</h1>
        <p>
          Les copies hors connexion sont fermées pendant le passage de relais.
          Reconnectez-vous pour les préparer à nouveau.
        </p>
        <Link className="button-link" href="/">
          Revenir à PictoFlow
        </Link>
      </main>
    ) : (
      <>{children}</>
    );
  if (!session || checkedPath !== path || destination)
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
  const accountControls = (
    <>
      <span>{session.account?.display_name}</span>
      <button
        className="secondary"
        disabled={busy}
        onClick={() => void disconnect()}
      >
        Se déconnecter et effacer les copies locales
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
  const assisted = !!session.account?.assisted_profile_id;
  return (
    <AuthContext.Provider value={session}>
      <AccompaniedContext.Provider value={{ busy, start: startAccompanied }}>
        {session.enabled &&
          (assisted ? (
            <div className="account-bar accompanied-bar">
              <span>Session accompagnée · en ligne</span>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void disconnect()}
              >
                Revenir à l’accompagnement — se reconnecter
              </button>
            </div>
          ) : path.startsWith("/communication") ? (
            <details className="account-bar communication-account">
              <summary>Mon compte</summary>
              <div className="account-controls">{accountControls}</div>
            </details>
          ) : (
            <div className="account-bar">{accountControls}</div>
          ))}
        {pathPermitted(session, path) ? (
          children
        ) : (
          <main className="page">
            <h1>Ce profil ou cet écran ne vous est pas accessible.</h1>
            <Link className="button-link" href={landingPath(session)}>
              Retrouver mon espace
            </Link>
          </main>
        )}
      </AccompaniedContext.Provider>
    </AuthContext.Provider>
  );
}
