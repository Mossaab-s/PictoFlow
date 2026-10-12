"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Health = { provider_id: string; status: string; capabilities: string[] };
export default function Providers() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  async function load() {
    setLoading(true);
    setError("");
    try {
      setHealth(await api<Health>("providers"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <>
      <header className="topbar">Administration / Providers</header>
      <section className="page">
        <div className="eyebrow">ASSISTANCE OPTIONNELLE</div>
        <h1>Providers IA</h1>
        <p>
          Le provider propose. La personne valide. La mémoire reste dans le PCL.
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
