"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

type Health = { status: string };
type Readiness = { application: string; database: string; redis: string };
type Snapshot = {
  health: Health | null;
  readiness: Readiness | null;
  checked: string;
};

export default function AdminServiceStatus() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const request = useRef<AbortController | null>(null);
  async function load() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setSnapshot(null);
    const [health, readiness] = await Promise.allSettled([
      api<Health>("health", { signal: controller.signal }),
      api<Readiness>("readiness", { signal: controller.signal }),
    ]);
    if (!controller.signal.aborted) {
      setSnapshot({
        health: health.status === "fulfilled" ? health.value : null,
        readiness: readiness.status === "fulfilled" ? readiness.value : null,
        checked: new Date().toISOString(),
      });
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    return () => request.current?.abort();
  }, []);
  return (
    <section
      className="admin-services"
      aria-labelledby="admin-services-title"
      aria-busy={loading}
    >
      <h2 id="admin-services-title">État déclaré des services</h2>
      <p>
        Lecture ponctuelle de l’API. La configuration déclarée de PostgreSQL ne
        constitue pas un test de lecture ou de restauration de la mémoire.
      </p>
      <button
        className="secondary"
        disabled={loading}
        onClick={() => void load()}
      >
        Actualiser les services
      </button>
      {loading && <p role="status">Vérification des services…</p>}
      {snapshot && (
        <>
          {(!snapshot.health || !snapshot.readiness) && (
            <p className="error" role="alert">
              Certaines vérifications sont indisponibles. Aucun état antérieur
              n’est conservé ; actualisez pour réessayer.
            </p>
          )}
          <dl className="admin-service-grid">
            <div className="panel">
              <dt>API</dt>
              <dd>
                {snapshot.health?.status === "healthy"
                  ? "Répond aux requêtes"
                  : "État non vérifié"}
              </dd>
            </div>
            <div className="panel">
              <dt>PostgreSQL</dt>
              <dd>
                {snapshot.readiness?.database === "configured"
                  ? "Configuration déclarée"
                  : snapshot.readiness?.database === "disabled"
                    ? "Non configuré"
                    : "État non vérifié"}
              </dd>
            </div>
            <div className="panel">
              <dt>Redis</dt>
              <dd>
                {snapshot.readiness?.redis === "available"
                  ? "Disponible"
                  : snapshot.readiness?.redis === "disabled"
                    ? "Désactivé"
                    : snapshot.readiness?.redis === "unavailable"
                      ? "Indisponible"
                      : "État non vérifié"}
              </dd>
            </div>
          </dl>
          <p className="helper">
            Dernière lecture :{" "}
            <time dateTime={snapshot.checked}>
              {new Date(snapshot.checked).toLocaleString("fr-FR")}
            </time>
            . L’état n’est pas actualisé en continu.
          </p>
        </>
      )}
    </section>
  );
}
