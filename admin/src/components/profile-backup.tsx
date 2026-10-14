"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { APIError } from "@/lib/api";
import { ProfileNavigation } from "./profile-navigation";

export default function ProfileBackup({ profileId }: { profileId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const gate = useRef(false);
  async function download() {
    if (gate.current) return;
    gate.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/pictoflow/profiles/${profileId}/backup`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new APIError(response.status);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `pictoflow-profile-${profileId}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setNotice("Le fichier de sauvegarde est prêt à être enregistré.");
    } catch (error) {
      setError(
        error instanceof APIError && error.status === 413
          ? "Ce profil dépasse la limite de sauvegarde de 32 Mo."
          : error instanceof Error
            ? error.message
            : "Sauvegarde impossible.",
      );
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <ProfileNavigation profileId={profileId} section="backup" />
      <section className="page backup-page">
        <div className="eyebrow">CONSERVER SON ESPACE PERSONNEL</div>
        <h1>Sauvegarder ce profil</h1>
        <p>
          Emportez le clavier, ses pages, ses photos et sa mémoire dans un seul
          fichier.
        </p>
        <section className="panel">
          <h2>Une copie complète du profil</h2>
          <p>
            Le fichier contient les mots et leurs significations personnelles,
            les messages, les validations, les corrections et l’historique. Les
            propositions restent des propositions.
          </p>
          <p>
            Conservez ce fichier dans un emplacement personnel : il contient les
            photos et les messages du profil.
          </p>
          <p>
            Les préférences d’affichage de cet appareil restent sur cet
            appareil. La limite du fichier est de 32 Mo.
          </p>
          <button onClick={download} disabled={busy}>
            {busy ? "Préparation…" : "Télécharger la sauvegarde"}
          </button>
        </section>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        <section className="panel">
          <h2>Retrouver un profil sauvegardé</h2>
          <p>
            La restauration crée un nouveau profil. Vous pourrez vérifier son
            clavier avant de l’utiliser.
          </p>
          <Link className="button-link" href="/admin/restore-profile">
            Restaurer une sauvegarde
          </Link>
        </section>
      </section>
    </>
  );
}
