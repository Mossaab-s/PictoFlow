"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, type Profile } from "@/lib/api";
import { matchingProfiles, profileTitle } from "@/lib/profiles";

export default function Audit() {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const request = useRef<AbortController | null>(null);
  async function load() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setProfiles(null);
    setError("");
    try {
      const values = await api<Profile[]>("profiles", {
        signal: controller.signal,
      });
      if (!controller.signal.aborted) setProfiles(values);
    } catch {
      if (!controller.signal.aborted)
        setError(
          "Les profils ne peuvent pas être chargés. Actualisez pour réessayer.",
        );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    return () => request.current?.abort();
  }, []);
  const visible = matchingProfiles(profiles ?? [], query);
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(visible.length / 10) - 1),
  );
  return (
    <>
      <header className="topbar">Administration / Audit et diagnostics</header>
      <section className="page admin-audit-page">
        <div className="eyebrow">TRACES PERSONNELLES</div>
        <h1>Audit et diagnostics</h1>
        <p>
          Choisissez un profil pour consulter ses traces PCL ou les diagnostics
          de ses propositions IA. Chaque journal conserve le périmètre de cette
          personne.
        </p>
        <button
          className="secondary"
          disabled={loading}
          onClick={() => void load()}
        >
          Actualiser les profils d’audit
        </button>
        <label className="profile-search">
          Rechercher un profil pour l’audit
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            maxLength={256}
          />
        </label>
        {loading && <p role="status">Chargement des profils…</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {profiles && (
          <>
            <div className="space-cards">
              {visible
                .slice(currentPage * 10, currentPage * 10 + 10)
                .map((profile) => (
                  <article
                    className="panel admin-audit-profile"
                    key={profile.id}
                    aria-label={profileTitle(profile)}
                  >
                    <h2>{profileTitle(profile)}</h2>
                    <p className="identifier">{profile.id}</p>
                    <div className="actions">
                      <Link
                        className="button-link"
                        href={`/admin/profiles/${profile.id}/audit`}
                      >
                        Ouvrir l’audit PCL
                      </Link>
                      <Link
                        className="button-link secondary"
                        href={`/admin/profiles/${profile.id}/ai-quality`}
                      >
                        Voir la qualité IA
                      </Link>
                    </div>
                  </article>
                ))}
            </div>
            {!visible.length && (
              <div className="empty">
                <h2>
                  {profiles.length
                    ? "Aucun profil ne correspond"
                    : "Aucun profil à inspecter"}
                </h2>
                <p>
                  Les journaux deviennent accessibles ici après la création d’un
                  profil.
                </p>
              </div>
            )}
            {visible.length > 10 && (
              <div className="pagination">
                <button
                  className="secondary"
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Précédent
                </button>
                <span>
                  Page {currentPage + 1} sur {Math.ceil(visible.length / 10)}
                </span>
                <button
                  className="secondary"
                  disabled={(currentPage + 1) * 10 >= visible.length}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Suivant
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}
