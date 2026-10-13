"use client";
import { useEffect, useRef, useState } from "react";
import { api, type Profile } from "@/lib/api";
import { matchingProfiles, profileTitle } from "@/lib/profiles";
import ProfileCard from "@/components/profile-card";

export default function Profiles() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [healthy, setHealthy] = useState(false);
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const gate = useRef(false);
  const pending = useRef<AbortController | null>(null);
  async function load() {
    pending.current?.abort();
    const request = new AbortController();
    pending.current = request;
    setLoading(true);
    setError("");
    try {
      const [, values] = await Promise.all([
        api("health", { signal: request.signal }),
        api<Profile[]>("profiles", { signal: request.signal }),
      ]);
      if (!request.signal.aborted) {
        setHealthy(true);
        setProfiles(values);
      }
    } catch (error) {
      if (!request.signal.aborted) {
        setHealthy(false);
        setError(
          error instanceof Error ? error.message : "Chargement impossible.",
        );
      }
    } finally {
      if (!request.signal.aborted) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    return () => pending.current?.abort();
  }, []);
  async function create() {
    if (gate.current) return;
    gate.current = true;
    setCreating(true);
    setError("");
    setNotice("");
    try {
      const profile = await api<Profile>("profiles", {
        method: "POST",
        body: JSON.stringify({ display_name: name.trim() || null }),
      });
      setProfiles((previous) => [...previous, profile]);
      setName("");
      setQuery("");
      setNotice(`${profileTitle(profile)} a été créé.`);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Création impossible.");
    } finally {
      gate.current = false;
      setCreating(false);
    }
  }
  function update(profile: Profile) {
    setQuery("");
    setProfiles((previous) =>
      previous.map((item) => (item.id === profile.id ? profile : item)),
    );
  }
  const visible = matchingProfiles(profiles, query);
  return (
    <>
      <header className="topbar">
        <span>Administration / Profils</span>
        <span className="status">
          {healthy ? "● API disponible" : "○ Vérification API"}
        </span>
      </header>
      <section className="page">
        <div className="page-heading">
          <div>
            <div className="eyebrow">COMMUNICATION PERSONNELLE</div>
            <h1>Un espace pour chaque personne.</h1>
            <p>
              Retrouvez chaque personne par son nom, puis préparez son clavier
              ou ouvrez sa communication.
            </p>
          </div>
        </div>
        <section className="panel profile-create">
          <h2>Créer un profil</h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <label>
              Nom du profil, facultatif
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={80}
                disabled={creating || loading}
                placeholder="Un prénom ou un surnom"
                autoComplete="off"
              />
            </label>
            <button disabled={creating || loading}>
              {creating ? "Création…" : "+ Nouveau profil"}
            </button>
          </form>
        </section>
        {error && (
          <div className="error" role="alert">
            {error}{" "}
            <button className="secondary" onClick={load} disabled={creating}>
              Recharger les profils
            </button>
          </div>
        )}
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {loading ? (
          <p role="status">Chargement des profils…</p>
        ) : (
          <>
            {profiles.length > 0 && (
              <label className="profile-search">
                Rechercher un profil
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Nom ou identifiant"
                  autoComplete="off"
                />
              </label>
            )}
            <div className="section-label" role="status">
              PROFILS{" "}
              <span>
                {visible.length} / {profiles.length}
              </span>
            </div>
            <div className="profile-grid">
              {visible.map((profile) => (
                <ProfileCard
                  key={profile.id}
                  profile={profile}
                  onUpdate={update}
                />
              ))}
            </div>
            {profiles.length > 0 && !visible.length && (
              <div className="empty">
                <h2>Aucun profil ne correspond</h2>
                <button className="secondary" onClick={() => setQuery("")}>
                  Afficher tous les profils
                </button>
              </div>
            )}
            {!profiles.length && !error && (
              <div className="empty">
                <h2>Votre premier espace de communication</h2>
                <p>
                  Créez un profil pour commencer à construire son vocabulaire
                  personnel.
                </p>
              </div>
            )}
          </>
        )}
        <div className="principles">
          <div>
            <span>01</span>
            <h3>Un sens personnel</h3>
            <p>Les associations restent propres à chaque profil.</p>
          </div>
          <div>
            <span>02</span>
            <h3>Une validation explicite</h3>
            <p>Les propositions et la mémoire validée sont séparées.</p>
          </div>
          <div>
            <span>03</span>
            <h3>Une IA optionnelle</h3>
            <p>Le parcours reste disponible sans provider externe.</p>
          </div>
        </div>
      </section>
    </>
  );
}
