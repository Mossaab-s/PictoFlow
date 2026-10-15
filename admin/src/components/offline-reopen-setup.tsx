"use client";
import { useState } from "react";
import { createVault } from "@/lib/offline-vault";
import { prepareOfflineShell } from "@/lib/offline-shell";
import type { OfflineRecord } from "@/lib/offline";
import { useAuthentication } from "./authentication";

export default function OfflineReopenSetup({
  record,
  disabled,
}: {
  record: OfflineRecord;
  disabled: boolean;
}) {
  const session = useAuthentication();
  const [passphrase, setPassphrase] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  async function prepare(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !session || !record.snapshot) return;
    const owner = session.enabled ? session.account?.id : "development";
    if (!owner) return;
    setBusy(true);
    setError("");
    setReady(false);
    try {
      await prepareOfflineShell();
      await createVault(record, owner, passphrase);
      setPassphrase("");
      setRepeat("");
      setReady(true);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Préparation impossible.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel" aria-label="Réouverture sans réseau">
      <h3>Réouvrir sans réseau</h3>
      <p>
        Préparez un écran local et une copie protégée de ce clavier et de son
        brouillon. Une phrase secrète distincte sera demandée à chaque
        réouverture. Elle reste dans votre appareil et ne peut pas être
        récupérée si vous l’oubliez.
      </p>
      <p>
        Cette copie est indépendante de celle de l’écran ouvert. Une copie
        existante n’est jamais remplacée ici : ouvrez-la pour terminer son
        brouillon ou l’effacer.
      </p>
      <form onSubmit={(event) => void prepare(event)}>
        <label>
          Phrase secrète de la copie hors connexion
          <input
            type="password"
            autoComplete="new-password"
            minLength={15}
            maxLength={256}
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            required
            disabled={disabled || busy}
          />
        </label>
        <label>
          Confirmer la phrase secrète
          <input
            type="password"
            autoComplete="new-password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            required
            disabled={disabled || busy}
          />
        </label>
        <button
          disabled={
            disabled || busy || passphrase.length < 15 || passphrase !== repeat
          }
        >
          {busy
            ? "Préparation de la copie protégée…"
            : "Préparer la réouverture protégée"}
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {ready && (
        <p role="status">
          L’écran et la copie protégée sont prêts. Ouvrez le lien dans un nouvel
          onglet et vérifiez-les avant de couper le réseau.
        </p>
      )}
      <a
        className="button-link secondary"
        href="/offline"
        target="_blank"
        rel="noopener"
      >
        Ouvrir mon écran hors connexion
      </a>
    </section>
  );
}
