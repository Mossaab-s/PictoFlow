"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, APIError, type Profile } from "@/lib/api";
import { newIdentity, type HumanRole } from "@/lib/keyboard";
import { profileTitle } from "@/lib/profiles";
import { HumanRoleSelector } from "./profile-navigation";

type Preview = {
  version: number;
  exported_at: string;
  display_name: string | null;
  counts: Record<string, number>;
  validated_blocks: number;
  proposed_blocks: number;
  accepted_interpretations: number;
};
const limit = 32 * 1024 * 1024;
function failure(error: unknown) {
  if (error instanceof TypeError) return "Connexion interrompue. Réessayez.";
  if (error instanceof APIError) {
    if (error.status === 413) return "Ce fichier dépasse la limite de 32 Mo.";
    if (error.status === 422)
      return "Le fichier est incomplet, endommagé ou utilise une version non prise en charge. Choisissez une sauvegarde PictoFlow valide.";
    if (error.status === 409)
      return "Cette demande entre en conflit avec une restauration précédente. Choisissez à nouveau le fichier.";
  }
  return error instanceof Error ? error.message : "Restauration impossible.";
}

export default function ProfileRestore() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [fileName, setFileName] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<HumanRole>("user");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState("");
  const [restored, setRestored] = useState<Profile | null>(null);
  const content = useRef("");
  const envelope = useRef<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  const gate = useRef(false);
  useEffect(() => () => pending.current?.abort(), []);
  async function inspect(file: File | undefined) {
    if (gate.current) return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setPreview(null);
    setError("");
    setConfirmed(false);
    setAttempted(false);
    setName("");
    setFileName(file?.name ?? "");
    content.current = "";
    envelope.current = null;
    if (!file) return;
    if (!file.size || file.size > limit) {
      setError(
        file.size
          ? "Ce fichier dépasse la limite de 32 Mo."
          : "Ce fichier est vide.",
      );
      return;
    }
    setBusy(true);
    try {
      const bytes = await file.arrayBuffer();
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new Error("Le fichier n’est pas un JSON enregistré en UTF-8.");
      }
      const value = await api<Preview>("profiles/restore-preview", {
        method: "POST",
        body: text,
        signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        content.current = text;
        setPreview(value);
        setName(value.display_name ?? "");
      }
    } catch (error) {
      if (!controller.signal.aborted) setError(failure(error));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  async function restore() {
    if (gate.current || !preview || !confirmed) return;
    gate.current = true;
    setBusy(true);
    setError("");
    const controller = new AbortController();
    pending.current = controller;
    try {
      if (!envelope.current) {
        const metadata = JSON.stringify({
          request_id: newIdentity(),
          actor_role: role,
          confirm: true,
          display_name: name.trim() || null,
        });
        // Retain the exact file text and request ID across uncertain-response retries.
        envelope.current = `${metadata.slice(0, -1)},"snapshot":${content.current}}`;
      }
      setAttempted(true);
      const value = await api<Profile>("profiles/restore", {
        method: "POST",
        body: envelope.current,
        signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        setRestored(value);
        content.current = "";
        envelope.current = null;
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setError(failure(error));
        if (
          error instanceof APIError &&
          [409, 413, 422].includes(error.status)
        ) {
          envelope.current = null;
          setAttempted(false);
          setPreview(null);
        }
      }
    } finally {
      gate.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <>
      <header className="topbar">
        <Link href="/admin/profiles">Profils</Link>
        <span>Sauvegardes</span>
      </header>
      <section className="page backup-page">
        <div className="eyebrow">RETROUVER SON ESPACE PERSONNEL</div>
        <h1>Restaurer une sauvegarde</h1>
        <p>
          Choisissez un fichier PictoFlow pour créer un nouveau profil avec son
          clavier et sa mémoire.
        </p>
        {restored ? (
          <section className="panel">
            <h2 role="status">{profileTitle(restored)} a été restauré.</h2>
            <p>
              Ses pages, ses touches et ses décisions ont été conservées. Vous
              pouvez maintenant vérifier le clavier.
            </p>
            <div className="actions">
              <Link
                className="button-link"
                href={`/admin/profiles/${restored.id}/keyboard`}
              >
                Ouvrir le clavier restauré
              </Link>
              <Link className="button-link secondary" href="/admin/profiles">
                Tous les profils
              </Link>
            </div>
          </section>
        ) : (
          <>
            <section className="panel">
              <h2>1. Choisir la sauvegarde</h2>
              <label>
                Fichier JSON PictoFlow, jusqu’à 32 Mo
                <input
                  type="file"
                  accept=".json,application/json"
                  disabled={busy || attempted}
                  onClick={(event) => {
                    event.currentTarget.value = "";
                  }}
                  onChange={(event) => void inspect(event.target.files?.[0])}
                />
              </label>
              {busy && !attempted && (
                <p role="status">Vérification du fichier…</p>
              )}
            </section>
            {preview && (
              <section className="panel">
                <h2>2. Vérifier le contenu</h2>
                <p className="backup-filename">{fileName}</p>
                <p>
                  {preview.display_name || "Profil sans nom"} · Sauvegardé le{" "}
                  {new Date(preview.exported_at).toLocaleString("fr-FR")}
                </p>
                <dl className="backup-counts">
                  <div>
                    <dt>Touches validées</dt>
                    <dd>{preview.validated_blocks}</dd>
                  </div>
                  <div>
                    <dt>Touches proposées</dt>
                    <dd>{preview.proposed_blocks}</dd>
                  </div>
                  <div>
                    <dt>Pages personnelles</dt>
                    <dd>{preview.counts.groups}</dd>
                  </div>
                  <div>
                    <dt>Photos conservées</dt>
                    <dd>{preview.counts.photos}</dd>
                  </div>
                  <div>
                    <dt>Messages acceptés</dt>
                    <dd>{preview.accepted_interpretations}</dd>
                  </div>
                  <div>
                    <dt>Décisions humaines</dt>
                    <dd>{preview.counts.validations}</dd>
                  </div>
                </dl>
                <p>
                  Les validations et corrections du fichier seront conservées.
                  Les propositions et refus gardent leur état.
                </p>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void restore();
                  }}
                  className="backup-form"
                >
                  <h2>3. Créer le profil restauré</h2>
                  <label>
                    Nom du nouveau profil, facultatif
                    <input
                      value={name}
                      maxLength={80}
                      onChange={(event) => setName(event.target.value)}
                      disabled={busy || attempted}
                      autoComplete="off"
                    />
                  </label>
                  <HumanRoleSelector
                    value={role}
                    onChange={setRole}
                    disabled={busy || attempted}
                  />
                  <label className="backup-confirm">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(event) => setConfirmed(event.target.checked)}
                      disabled={busy || attempted}
                    />
                    Je confirme la restauration de ce fichier dans un nouveau
                    profil.
                  </label>
                  <button disabled={busy || !confirmed}>
                    {busy
                      ? "Restauration…"
                      : attempted
                        ? "Réessayer la même restauration"
                        : "Restaurer dans un nouveau profil"}
                  </button>
                </form>
                {attempted && !busy && (
                  <p>
                    Si la réponse a été interrompue, réessayez ici : la même
                    demande retrouve le profil créé et évite un doublon.
                  </p>
                )}
              </section>
            )}
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
    </>
  );
}
