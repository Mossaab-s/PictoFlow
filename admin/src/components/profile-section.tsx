"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, Row, sections, Section } from "@/lib/api";
import ProfileIdentity from "./profile-identity";

export default function ProfileSection({
  profileId,
  section,
}: {
  profileId: string;
  section: Section;
}) {
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [validated, setValidated] = useState(true);
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const base = `profiles/${profileId}`;
  const load = useCallback(async () => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setError("");
    const endpoint = section === "semantic-space" ? "relations" : section;
    try {
      const response = await api(
        `${base}/${endpoint}${section === "memory" ? `?validated=${validated}` : ""}`,
        { signal: controller.signal },
      );
      if (!controller.signal.aborted) setData(response);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Chargement impossible.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [base, section, validated]);
  useEffect(() => {
    setData(null);
    void load();
    return () => pending.current?.abort();
  }, [load]);
  async function action(path: string, body?: unknown) {
    setBusy(true);
    setError("");
    try {
      await api(`${base}/${path}`, {
        method: "POST",
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action impossible.");
    } finally {
      setBusy(false);
    }
  }
  const rows = Array.isArray(data) ? (data as Row[]) : [];
  return (
    <>
      <header className="topbar">
        <Link href="/admin/profiles">Profils</Link>
        <ProfileIdentity profileId={profileId} />
      </header>
      <section className="page">
        <div className="eyebrow">ESPACE PERSONNEL</div>
        <h1>{sections[section]}</h1>
        <p className="identifier">{profileId}</p>
        <nav className="tabs" aria-label="Sections du profil">
          {Object.entries(sections).map(([value, title]) => (
            <Link
              key={value}
              aria-current={value === section ? "page" : undefined}
              href={`/admin/profiles/${profileId}/${value}`}
            >
              {title}
            </Link>
          ))}
        </nav>
        {section === "concepts" && (
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              void action("concepts", { canonical_key: key, label });
            }}
          >
            <label>
              Clé du concept
              <input
                value={key}
                onChange={(e) => setKey(e.target.value)}
                required
                maxLength={128}
                placeholder="DRINK"
              />
            </label>
            <label>
              Libellé
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                required
                maxLength={256}
                placeholder="Boire"
              />
            </label>
            <button disabled={busy}>Ajouter un concept</button>
          </form>
        )}
        {section === "suggestions" && (
          <button onClick={() => action("suggestions/detect")} disabled={busy}>
            Rechercher les intentions répétées
          </button>
        )}
        {section === "memory" && (
          <div className="tabs">
            <button
              className={validated ? "" : "secondary"}
              onClick={() => setValidated(true)}
            >
              Mémoire validée
            </button>
            <button
              className={!validated ? "" : "secondary"}
              onClick={() => setValidated(false)}
            >
              Propositions
            </button>
          </div>
        )}
        {error && (
          <div className="error" role="alert">
            {error}{" "}
            <button className="secondary" onClick={load}>
              Réessayer
            </button>
          </div>
        )}
        {loading ? (
          <p role="status">Chargement…</p>
        ) : (
          <div className="data-panel">
            {section === "memory" ? (
              <pre>{JSON.stringify(data, null, 2)}</pre>
            ) : rows.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Élément</th>
                      <th>État / type</th>
                      <th>Détails</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => (
                      <tr key={String(row.id ?? row.block_id ?? index)}>
                        <td>
                          <strong>
                            {String(
                              row.label ??
                                row.validated_intent ??
                                row.event_type ??
                                row.block_id ??
                                row.id,
                            )}
                          </strong>
                          <small>{String(row.id ?? "")}</small>
                        </td>
                        <td>
                          <span className="tag">
                            {String(
                              row.status ??
                                row.zone ??
                                row.type ??
                                row.relation_type ??
                                row.target_type ??
                                "",
                            )}
                          </span>
                        </td>
                        <td>
                          <details>
                            <summary>Voir les détails</summary>
                            <pre>{JSON.stringify(row, null, 2)}</pre>
                          </details>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty">
                <h2>Aucun élément pour le moment</h2>
                <p>
                  Les données de ce profil apparaîtront ici après leur création
                  dans le PCL.
                </p>
              </div>
            )}
          </div>
        )}
      </section>
    </>
  );
}
