"use client";
import { useEffect, useRef, useState } from "react";
import { api, APIError } from "@/lib/api";
import { joinKeyboard, newIdentity, type Sequence } from "@/lib/keyboard";
import {
  checkedSnapshot,
  editOffline,
  emptyOffline,
  offlineWords,
  type OfflineRecord,
  type OfflineSnapshot,
} from "@/lib/offline";
import {
  LocalDraftConflict,
  InvalidOfflineCopy,
  readOffline,
  removeOffline,
  writeOffline,
} from "@/lib/offline-store";
import KeyboardGrid from "./keyboard-grid";
import { TouchContent } from "./pictogram";
import { HumanRoleSelector } from "./profile-navigation";
import type { DisplaySize } from "@/lib/display";
import type { useLocalSpeech } from "./use-local-speech";
import OfflineReopenSetup from "./offline-reopen-setup";

export default function OfflineCommunication({
  profileId,
  speech,
  size,
  canOpen,
  onOpen,
}: {
  profileId: string;
  speech: ReturnType<typeof useLocalSpeech>;
  size: DisplaySize;
  canOpen: boolean;
  onOpen: (sequence: Sequence) => void;
}) {
  const [record, setRecord] = useState<OfflineRecord>(emptyOffline(profileId));
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [temporary, setTemporary] = useState(false);
  const [corrupt, setCorrupt] = useState(false);
  const [error, setError] = useState("");
  const [role, setRole] = useState<"user" | "caregiver" | "professional">(
    "user",
  );
  const [confirm, setConfirm] = useState(false);
  const [forget, setForget] = useState(false);
  const [online, setOnline] = useState(true);
  const gate = useRef(false);
  const alive = useRef(true);
  const current = useRef(record);
  useEffect(() => {
    let cancelled = false;
    alive.current = true;
    void readOffline(profileId)
      .then((value) => {
        if (alive.current && !cancelled) {
          current.current = value;
          setRecord(value);
        }
      })
      .catch((failure) => {
        if (alive.current && !cancelled) {
          if (failure instanceof InvalidOfflineCopy) setCorrupt(true);
          else setTemporary(true);
          setError(
            failure instanceof Error
              ? failure.message
              : "Stockage local indisponible.",
          );
        }
      })
      .finally(() => {
        if (alive.current && !cancelled) setReady(true);
      });
    const connection = () => setOnline(navigator.onLine);
    connection();
    window.addEventListener("online", connection);
    window.addEventListener("offline", connection);
    return () => {
      cancelled = true;
      alive.current = false;
      window.removeEventListener("online", connection);
      window.removeEventListener("offline", connection);
    };
  }, [profileId]);
  async function persist(next: OfflineRecord) {
    let saved = next;
    if (!temporary) {
      try {
        saved = await writeOffline(next, current.current.serial);
      } catch (failure) {
        if (failure instanceof LocalDraftConflict) throw failure;
        setTemporary(true);
      }
    }
    if (alive.current) {
      current.current = saved;
      setRecord(saved);
      setConfirm(false);
      setForget(false);
    }
    return saved;
  }
  async function perform(task: () => Promise<void>) {
    if (gate.current) return;
    gate.current = true;
    setBusy(true);
    setError("");
    const origin =
      document.activeElement instanceof HTMLButtonElement
        ? document.activeElement
        : null;
    try {
      await task();
    } catch (failure) {
      if (alive.current)
        setError(
          failure instanceof Error ? failure.message : "Action impossible.",
        );
    } finally {
      gate.current = false;
      if (alive.current) {
        setBusy(false);
        requestAnimationFrame(() => {
          if (
            origin?.isConnected &&
            !origin.disabled &&
            (document.activeElement === document.body ||
              document.activeElement === origin)
          )
            origin.focus();
        });
      }
    }
  }
  async function prepare() {
    const value = await api<OfflineSnapshot>(
      `profiles/${profileId}/communication-snapshot`,
    );
    const snapshot = checkedSnapshot(profileId, value);
    if (!snapshot) throw new Error("Le clavier reçu est invalide.");
    await persist({
      ...current.current,
      snapshot,
      block_ids: [],
      submission: null,
      imported: null,
      conflict: false,
    });
  }
  async function submit() {
    let value = current.current;
    if (!value.snapshot || !value.block_ids.length || value.conflict) return;
    if (!value.submission)
      value = await persist({
        ...value,
        submission: {
          request_id: newIdentity(),
          expected_revision: value.snapshot.revision,
          block_ids: [...value.block_ids],
          actor_role: role,
          confirm: true,
        },
      });
    try {
      const imported = await api<Sequence>(
        `profiles/${profileId}/offline-drafts`,
        { method: "POST", body: JSON.stringify(value.submission) },
      );
      if (
        imported.profile_id !== profileId ||
        imported.id !== value.submission?.request_id ||
        imported.status !== "completed" ||
        JSON.stringify(imported.block_ids) !== JSON.stringify(value.block_ids)
      )
        throw new Error(
          "La réponse ne correspond pas à ce brouillon. Vérifiez son envoi.",
        );
      await persist({ ...value, imported });
    } catch (failure) {
      if (failure instanceof APIError && failure.status === 409) {
        await persist({ ...value, conflict: true });
        throw new Error(
          "Le clavier a changé ou l’envoi est en conflit. Le brouillon est conservé. Copiez vos mots avant de l’effacer et de préparer le clavier actuel.",
        );
      }
      throw new Error(
        "L’envoi n’a pas pu être confirmé. Le brouillon est conservé ; utilisez Vérifier l’envoi à la reconnexion.",
      );
    }
  }
  const snapshot = record.snapshot;
  const words = offlineWords(record);
  const frozen = Boolean(record.submission && !record.conflict);
  const disabled = busy || !ready;
  const tiles = snapshot
    ? joinKeyboard(
        profileId,
        snapshot.blocks,
        snapshot.positions,
        snapshot.representations,
      )
    : [];
  return (
    <details className="panel offline-communication">
      <summary>Mon clavier pour les coupures</summary>
      <p>
        Préparez une copie des touches validées, de leurs dessins et photos dans
        ce navigateur. Le brouillon local reste séparé du message en cours sur
        le serveur.
      </p>
      <p className="helper">
        Cette copie sert dans l’écran ouvert. Pour réouvrir sans réseau,
        préparez aussi une copie protégée ci-dessous.
      </p>
      <p role="status">
        {online
          ? "La connexion réseau est présente. L’accès au serveur reste à vérifier lors d’une action."
          : "Hors connexion : composez avec la copie préparée, sans envoi au serveur."}
      </p>
      {temporary && (
        <p className="notice" role="status">
          Le stockage local ne fonctionne pas. Cette copie et ce brouillon
          restent uniquement dans l’écran ouvert ; ils seront perdus à son
          départ.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button
          className="secondary"
          disabled={
            disabled ||
            corrupt ||
            !online ||
            record.block_ids.length > 0 ||
            frozen
          }
          onClick={() => void perform(prepare)}
        >
          {snapshot ? "Actualiser la copie du clavier" : "Préparer mon clavier"}
        </button>
        <button
          className="secondary"
          disabled={disabled || temporary}
          onClick={() =>
            void perform(async () => {
              const value = await readOffline(profileId);
              current.current = value;
              setRecord(value);
              setCorrupt(false);
              setConfirm(false);
              setForget(false);
            })
          }
        >
          Relire le brouillon local
        </button>
      </div>
      {snapshot && (
        <>
          {!temporary && (
            <OfflineReopenSetup
              record={record}
              disabled={disabled || !online}
            />
          )}
          <p>
            Copie préparée le{" "}
            {new Date(snapshot.captured_at).toLocaleString("fr-FR")}. Elle peut
            différer du clavier actuel sur le serveur.
          </p>
          <section aria-label="Brouillon local" className="message-panel">
            <h2>Mon message local · {record.block_ids.length} / 32 touches</h2>
            <div
              className="message-tokens"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {record.block_ids.length ? (
                record.block_ids.map((id, index) => {
                  const block = snapshot.blocks.find((b) => b.id === id)!;
                  const visual = snapshot.representations.find(
                    (v) => v.id === block.representation_id,
                  );
                  return (
                    <span className="message-touch" key={index}>
                      <TouchContent
                        label={block.label}
                        representation={visual}
                        localPhoto={
                          visual ? snapshot.photos[visual.id] : undefined
                        }
                      />
                    </span>
                  );
                })
              ) : (
                <p>Choisissez vos touches dans cette copie du clavier.</p>
              )}
            </div>
            <div className="actions">
              <button
                className="secondary"
                disabled={
                  disabled ||
                  frozen ||
                  record.conflict ||
                  !record.block_ids.length
                }
                onClick={() =>
                  void perform(async () => {
                    await persist(editOffline(current.current, "undo"));
                  })
                }
              >
                Annuler la dernière touche locale
              </button>
              <button
                className="secondary"
                disabled={
                  disabled ||
                  (frozen && !record.imported) ||
                  !record.block_ids.length
                }
                onClick={() =>
                  void perform(async () => {
                    speech.stop();
                    await persist(editOffline(current.current, "clear"));
                  })
                }
              >
                {record.imported
                  ? "Nouveau brouillon local"
                  : "Effacer le brouillon local"}
              </button>
              <button
                className="secondary"
                disabled={disabled || !words || !speech.available}
                onClick={() => speech.read(words)}
              >
                Lire mes mots locaux
              </button>
              <button
                className="secondary"
                disabled={disabled || !words}
                onClick={() =>
                  void perform(async () => {
                    const blob = new Blob([words + "\n"], {
                      type: "text/plain;charset=utf-8",
                    });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "pictoflow-message-local.txt";
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  })
                }
              >
                Enregistrer mes mots en texte
              </button>
            </div>
            {!record.imported && (
              <>
                <HumanRoleSelector
                  label="J’enregistre en tant que"
                  value={record.submission?.actor_role ?? role}
                  onChange={setRole}
                  disabled={disabled || frozen}
                />
                <label className="offline-confirm">
                  <input
                    type="checkbox"
                    checked={confirm}
                    disabled={disabled || frozen || !record.block_ids.length}
                    onChange={(e) => setConfirm(e.target.checked)}
                  />
                  Je souhaite terminer et enregistrer ce message sur le serveur.
                </label>
                <button
                  disabled={
                    disabled ||
                    !online ||
                    record.conflict ||
                    !record.block_ids.length ||
                    (!record.submission && !confirm)
                  }
                  onClick={() => void perform(submit)}
                >
                  {record.submission
                    ? "Vérifier l’envoi"
                    : "Enregistrer le message local"}
                </button>
                {record.submission && !record.conflict && (
                  <p role="status">
                    Le contenu de cet envoi est conservé. Vérifier l’envoi
                    reprend la même demande, sans ajouter de message en double.
                  </p>
                )}
              </>
            )}
            {record.imported && (
              <>
                <p className="notice" role="status">
                  Ce message est enregistré et terminé. Son enregistrement ne
                  valide aucun sens et ne demande pas de formulation IA.
                </p>
                <button
                  className="secondary"
                  disabled={disabled || !canOpen || !online}
                  onClick={() =>
                    void perform(async () => {
                      const value = await api<Sequence>(
                        `profiles/${profileId}/sequences/${record.imported!.id}`,
                      );
                      if (
                        value.profile_id !== profileId ||
                        value.status !== "completed"
                      )
                        throw new Error("Ce message n’est plus disponible.");
                      onOpen(value);
                    })
                  }
                >
                  Ouvrir le message enregistré
                </button>
                {!canOpen && (
                  <p>
                    Fermez d’abord votre message serveur avec Nouveau message
                    pour ouvrir celui-ci.
                  </p>
                )}
              </>
            )}
          </section>
          <KeyboardGrid
            profileId={profileId}
            tiles={tiles}
            groups={snapshot.groups}
            displaySize={size}
            localPhotos={snapshot.photos}
            disabled={
              disabled ||
              frozen ||
              record.conflict ||
              record.block_ids.length >= 32
            }
            onSelect={(tile) =>
              perform(async () => {
                await persist(
                  editOffline(current.current, "append", tile.block_id),
                );
              })
            }
          />
        </>
      )}
      <label className="offline-confirm">
        <input
          type="checkbox"
          checked={forget}
          disabled={
            disabled ||
            Boolean(record.submission && !record.imported && !record.conflict)
          }
          onChange={(e) => setForget(e.target.checked)}
        />
        J’efface la copie locale et son brouillon de ce profil dans ce
        navigateur.
      </label>
      <button
        className="secondary"
        disabled={
          disabled ||
          !forget ||
          Boolean(record.submission && !record.imported && !record.conflict)
        }
        onClick={() =>
          void perform(async () => {
            const value = temporary
              ? emptyOffline(profileId)
              : await removeOffline(profileId, current.current.serial, corrupt);
            speech.stop();
            current.current = value;
            setRecord(value);
            setCorrupt(false);
            setForget(false);
            setConfirm(false);
          })
        }
      >
        Effacer la copie locale
      </button>
    </details>
  );
}
