"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

type Health = { provider_id: string; status: string; capabilities: string[] };
export default function Providers() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const pending = useRef<AbortController | null>(null);
  async function load() {
    pending.current?.abort();
    const request = new AbortController();
    pending.current = request;
    setLoading(true);
    setError("");
    setHealth(null);
    try {
      const value = await api<Health>("providers", { signal: request.signal });
      if (!request.signal.aborted) setHealth(value);
    } catch (e) {
      if (!request.signal.aborted)
        setError(e instanceof Error ? e.message : "Chargement impossible.");
    } finally {
      if (!request.signal.aborted) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    return () => pending.current?.abort();
  }, []);
  return (
    <>
      <header className="topbar">Administration / Fournisseur IA</header>
      <section className="page">
        <div className="eyebrow">ASSISTANCE OPTIONNELLE</div>
        <h1>Fournisseur IA</h1>
        <p>
          Le provider propose. La personne valide. La mémoire reste dans le PCL.
        </p>
        <p>
          Cette lecture consulte les métadonnées du fournisseur configuré. Elle
          ne teste pas la qualité des phrases. La configuration et la clé d’API
          se gèrent sur le serveur.
        </p>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {loading ? (
          <p role="status">Vérification…</p>
        ) : (
          health && (
            <div className="provider-card">
              <span className="tag">{health.status}</span>
              <h2>{health.provider_id}</h2>
              <p>
                Capacités :{" "}
                {health.capabilities.join(", ") || "Aucune — mode sans IA"}
              </p>
            </div>
          )
        )}
        <button className="secondary" onClick={load} disabled={loading}>
          Actualiser l’état
        </button>
      </section>
    </>
  );
}
