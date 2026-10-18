"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, Row, sections, Section } from "@/lib/api";
import ProfileIdentity from "./profile-identity";
import { useAuthentication } from "./authentication";
import { pathPermitted } from "@/lib/access";
import { supportSections } from "@/lib/access";
import { newIdentity, type Concept } from "@/lib/keyboard";
import { relationWords, type MemoryRelation } from "@/lib/memory";
import { memoryDate } from "./memory-evidence";
import { ProfileNavigation } from "./profile-navigation";

const historyLabels: Record<string, string> = {
  sequence_started: "Message commencé",
  sequence_completed: "Message terminé",
  sequence_cancelled: "Message annulé",
  selection_added: "Touche choisie",
  concept_created: "Sens personnel ajouté",
  concept_updated: "Sens personnel modifié",
  block_proposed: "Touche proposée",
  block_confirm: "Touche confirmée",
  block_correct: "Touche corrigée",
  block_reject: "Touche refusée",
  block_visual_changed: "Dessin de la touche modifié",
  representation_proposed: "Dessin ou photo proposé",
  representation_updated: "Dessin ou photo modifié",
  representation_archived: "Dessin ou photo archivé",
  interpretation_proposed: "Phrase proposée",
  interpretation_confirm: "Phrase confirmée",
  interpretation_correct: "Phrase corrigée",
  interpretation_reject: "Phrase refusée",
  relation_confirm: "Lien confirmé",
  relation_correct: "Lien corrigé",
  relation_reject: "Lien refusé",
  semantic_gap_detected: "Besoin de vocabulaire repéré",
  semantic_gap_resolved: "Besoin de vocabulaire pris en compte",
  keyboard_group_created: "Page du clavier créée",
  keyboard_group_updated: "Page du clavier modifiée",
  photo_removed: "Photo retirée",
};
function historyTitle(row: Row): string {
  return (
    historyLabels[String(row.event_type)] ??
    (
      {
        concept: "Évolution d’un sens personnel",
        representation: "Évolution d’un dessin ou d’une photo",
        communication_block: "Évolution d’une touche",
        communication_sequence: "Évolution d’un message",
        interpretation: "Évolution d’une proposition de phrase",
        semantic_relation: "Évolution d’un lien entre les mots",
      } as Record<string, string>
    )[String(row.target_type)] ??
    "Évolution du profil"
  );
}

export default function ProfileSection({
  profileId,
  section,
  support = false,
}: {
  profileId: string;
  section: Exclude<Section, "memory" | "ai-quality">;
  support?: boolean;
}) {
  const session = useAuthentication();
  const [data, setData] = useState<unknown>(null);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
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
      const [response, meanings] = await Promise.all([
        api(`${base}/${endpoint}`, { signal: controller.signal }),
        support && ["semantic-space", "representations"].includes(section)
          ? api<Concept[]>(`${base}/concepts`, { signal: controller.signal })
          : Promise.resolve([] as Concept[]),
      ]);
      if (!controller.signal.aborted) {
        setData(response);
        setConcepts(meanings.filter((value) => value.profile_id === profileId));
      }
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Chargement impossible.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [base, section, support, profileId]);
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
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action impossible.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  const rows = Array.isArray(data) ? (data as Row[]) : [];
  const title = support
    ? Object.values(supportSections).find((value) => value.section === section)
        ?.title
    : sections[section];
  return (
    <>
      {support ? (
        <ProfileNavigation profileId={profileId} section={section} />
      ) : (
        <header className="topbar">
          <Link href="/admin/profiles">Profils</Link>
          <ProfileIdentity profileId={profileId} />
        </header>
      )}
      <section className="page">
        <div className="eyebrow">ESPACE PERSONNEL</div>
        <h1>{title}</h1>
        {!support && (
          <>
            <p className="identifier">{profileId}</p>
            <nav className="tabs" aria-label="Sections du profil">
              {Object.entries(sections)
                .filter(
                  ([value]) =>
                    !!session &&
                    pathPermitted(
                      session,
                      `/admin/profiles/${profileId}/${value}`,
                    ),
                )
                .map(([value, title]) => (
                  <Link
                    key={value}
                    aria-current={value === section ? "page" : undefined}
                    href={`/admin/profiles/${profileId}/${value}`}
                  >
                    {title}
                  </Link>
                ))}
            </nav>
          </>
        )}
        {section === "concepts" && (
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              const actualKey = support
                ? key || `personal-${newIdentity()}`
                : key;
              if (support) setKey(actualKey);
              void action("concepts", { canonical_key: actualKey, label }).then(
                (saved) => {
                  if (support && saved) {
                    setKey("");
                    setLabel("");
                  }
                },
              );
            }}
          >
            {!support && (
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
            )}
            <label>
              {support ? "Mot ou sens personnel" : "Libellé"}
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                required
                maxLength={256}
                placeholder="Boire"
              />
            </label>
            <button disabled={busy}>
              {support ? "Ajouter au vocabulaire" : "Ajouter un concept"}
            </button>
          </form>
        )}
        {section === "suggestions" && (
          <button onClick={() => action("suggestions/detect")} disabled={busy}>
            Rechercher les intentions répétées
          </button>
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
            {support && rows.length ? (
              <div className="space-cards">
                {rows
                  .filter((row) => row.profile_id === profileId)
                  .map((row, index) => (
                    <article className="panel" key={String(row.id ?? index)}>
                      <h2>
                        {section === "semantic-space"
                          ? relationWords(
                              profileId,
                              row as unknown as MemoryRelation,
                              concepts,
                            )?.join(" ")
                          : section === "representations"
                            ? (concepts.find(
                                (value) => value.id === row.concept_id,
                              )?.label ?? "Dessin personnel")
                            : section === "audit"
                              ? historyTitle(row)
                              : String(
                                  row.label ??
                                    row.validated_intent ??
                                    "Besoin de vocabulaire à examiner",
                                )}
                      </h2>
                      {typeof row.status === "string" && (
                        <p>
                          {(
                            {
                              active: "Actif",
                              proposed: "Proposition à vérifier",
                              validated: "Validé",
                              confirmed: "Confirmé",
                              corrected: "Corrigé",
                              rejected: "Refusé",
                              archived: "Archivé",
                            } as Record<string, string>
                          )[row.status] ?? "État enregistré"}
                        </p>
                      )}
                      {typeof row.created_at === "string" && (
                        <time dateTime={row.created_at}>
                          {memoryDate(row.created_at)}
                        </time>
                      )}
                      {section === "representations" && (
                        <p>
                          {row.type === "photo"
                            ? "Photo personnelle"
                            : "Représentation du mot"}
                        </p>
                      )}
                      {section === "audit" && (
                        <p>
                          L’historique est conservé. Les décisions détaillées
                          sont consultables avec chaque message, touche ou lien
                          dans la mémoire.
                        </p>
                      )}
                    </article>
                  ))}
              </div>
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
