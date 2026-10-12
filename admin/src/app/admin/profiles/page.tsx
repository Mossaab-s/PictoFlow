"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, Profile } from "@/lib/api";

export default function Profiles() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [healthy, setHealthy] = useState(false);
  async function load() {
    setLoading(true);
    setError("");
    try {
      await api("health");
      setHealthy(true);
      setProfiles(await api<Profile[]>("profiles"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function create() {
    setCreating(true);
    setError("");
    try {
      const profile = await api<Profile>("profiles", { method: "POST" });
      setProfiles((p) => [...p, profile]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Création impossible.");
    } finally {
      setCreating(false);
    }
  }
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
              Gérez le vocabulaire, les propositions et la mémoire validée de
              chaque profil.
            </p>
          </div>
          <button onClick={create} disabled={creating}>
            {creating ? "Création…" : "+ Nouveau profil"}
          </button>
        </div>
        {error && (
          <div className="error" role="alert">
            {error}{" "}
            <button className="secondary" onClick={load}>
              Réessayer
            </button>
          </div>
        )}
        {loading ? (
          <p role="status">Chargement des profils…</p>
        ) : (
          <>
            <div className="section-label">
              PROFILS <span>{profiles.length}</span>
            </div>
            <div className="profile-grid">
              {profiles.map((profile, index) => (
                <Link
                  className="profile-card"
                  href={`/admin/profiles/${profile.id}/concepts`}
                  key={profile.id}
                >
                  <div className="avatar">
                    {String(index + 1).padStart(2, "0")}
                  </div>
                  <span className="tag">Personnel</span>
                  <h2>Profil {index + 1}</h2>
                  <p className="identifier">{profile.id}</p>
                  <div className="card-footer">
                    <span>Version {profile.version}</span>
                    <strong>Ouvrir l’espace →</strong>
                  </div>
                </Link>
              ))}
            </div>
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
