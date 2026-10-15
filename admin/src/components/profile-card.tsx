"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { api, APIError, type Profile } from "@/lib/api";
import { profileTitle } from "@/lib/profiles";
import { useAuthentication } from "./authentication";
import { canPrepare } from "@/lib/access";

export default function ProfileCard({
  profile,
  onUpdate,
}: {
  profile: Profile;
  onUpdate: (profile: Profile) => void;
}) {
  const canEdit = canPrepare(useAuthentication(), profile.id);
  const [name, setName] = useState(profile.display_name ?? "");
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const gate = useRef(false);
  const saveButton = useRef<HTMLButtonElement>(null);
  const base = `profiles/${profile.id}`;
  async function rename() {
    if (gate.current || blocked) return;
    gate.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const updated = await api<Profile>(base, {
        method: "PATCH",
        body: JSON.stringify({
          display_name: name.trim() || null,
          expected_version: profile.version,
        }),
      });
      onUpdate(updated);
      setName(updated.display_name ?? "");
      setNotice(
        updated.display_name ? "Nom enregistré." : "Le nom a été retiré.",
      );
    } catch (error) {
      if (error instanceof APIError && error.status === 409) {
        try {
          onUpdate(await api<Profile>(base));
          setError(
            "Le profil a évolué. Vérifiez son nom actuel avant de réessayer. Votre saisie est conservée.",
          );
        } catch {
          setBlocked(true);
          setError(
            "Le profil a évolué et ne peut pas être relu. Actualisez la page avant de réessayer.",
          );
        }
      } else {
        setError(
          error instanceof Error ? error.message : "Renommage impossible.",
        );
      }
    } finally {
      gate.current = false;
      setBusy(false);
      requestAnimationFrame(() => {
        if (saveButton.current?.isConnected && !saveButton.current.disabled)
          saveButton.current.focus();
      });
    }
  }
  return (
    <article className="profile-card" aria-label={profileTitle(profile)}>
      <div className="avatar" aria-hidden="true">
        {profile.id.slice(0, 2).toUpperCase()}
      </div>
      <span className="tag">Personnel</span>
      <h2>
        <Link
          href={
            canEdit
              ? `/admin/profiles/${profile.id}/concepts`
              : `/communication/${profile.id}`
          }
        >
          {profileTitle(profile)}
        </Link>
      </h2>
      <p className="identifier">{profile.id}</p>
      <div className="profile-actions">
        {canEdit && (
          <Link
            className="button-link secondary"
            href={`/admin/profiles/${profile.id}/keyboard`}
          >
            Préparer le clavier
          </Link>
        )}
        <Link className="button-link" href={`/communication/${profile.id}`}>
          Communiquer
        </Link>
      </div>
      {canEdit && (
        <details className="profile-name-editor">
          <summary>Renommer le profil</summary>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void rename();
            }}
          >
            <label>
              Nom de ce profil
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={80}
                disabled={busy || blocked}
                autoComplete="off"
              />
            </label>
            <p className="helper">
              Laisser le nom vide retire le nom affiché. Le clavier et les
              messages sont conservés.
            </p>
            <button ref={saveButton} disabled={busy || blocked}>
              {busy ? "Enregistrement…" : "Enregistrer le nom"}
            </button>
          </form>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {blocked && (
            <button
              className="secondary"
              onClick={() => window.location.reload()}
            >
              Actualiser les profils
            </button>
          )}
          {notice && (
            <p className="notice" role="status">
              {notice}
            </p>
          )}
        </details>
      )}
      <div className="card-footer">
        <span>Version {profile.version}</span>
      </div>
    </article>
  );
}
