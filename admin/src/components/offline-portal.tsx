"use client";
import { useEffect, useRef, useState } from "react";
import { api, APIError, setCSRFToken } from "@/lib/api";
import type { AuthSession } from "@/lib/access";
import {
  joinKeyboard,
  newIdentity,
  type HumanRole,
  type Sequence,
} from "@/lib/keyboard";
import { editOffline, offlineWords, type OfflineRecord } from "@/lib/offline";
import {
  deleteVault,
  listVaults,
  saveVault,
  unlockVault,
  type VaultRow,
  type VaultSession,
} from "@/lib/offline-vault";
import KeyboardGrid from "./keyboard-grid";
import { HumanRoleSelector } from "./profile-navigation";
import { useLocalSpeech } from "./use-local-speech";
import SpeechSettings from "./speech-settings";

export default function OfflinePortal() {
  const [rows, setRows] = useState<VaultRow[]>([]);
  const [selected, setSelected] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [session, setSession] = useState<VaultSession | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [forget, setForget] = useState(false);
  const generation = useRef(0);
  const gate = useRef(false);
  function lock() {
    generation.current++;
    setSession(null);
    setPassphrase("");
    setForget(false);
  }
  async function load() {
    try {
      setRows(await listVaults());
    } catch {
      setError(
        "Les copies protégées ne sont pas accessibles dans ce navigateur.",
      );
    }
  }
  useEffect(() => {
    void load();
    const changed = () => {
      lock();
      setBusy(false);
      setRows([]);
      setError(
        "Les accès ont changé. Fermez cet écran et reconnectez-vous avant de préparer une copie.",
      );
    };
    const storage = (event: StorageEvent) => {
      if (event.key === "pictoflow:explicit-logout" && event.newValue === "1")
        changed();
    };
    const channel =
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel("pictoflow-access")
        : null;
    if (channel) channel.onmessage = changed;
    window.addEventListener("storage", storage);
    const pageShown = (event: PageTransitionEvent) => {
      if (event.persisted) lock();
    };
    window.addEventListener("pagehide", lock);
    window.addEventListener("pageshow", pageShown);
    return () => {
      generation.current++;
      channel?.close();
      window.removeEventListener("storage", storage);
      window.removeEventListener("pagehide", lock);
      window.removeEventListener("pageshow", pageShown);
    };
  }, []);
  async function open(event: React.FormEvent) {
    event.preventDefault();
    if (gate.current) return;
    gate.current = true;
    const version = generation.current;
    setBusy(true);
    setError("");
    try {
      const row = rows.find((r) => r.id === selected);
      if (!row) throw new Error("Choisissez une copie protégée.");
      const value = await unlockVault(row, passphrase);
      if (version === generation.current) {
        setSession(value);
        setPassphrase("");
      }
    } catch (failure) {
      if (version === generation.current)
        setError(
          failure instanceof Error ? failure.message : "Ouverture impossible.",
        );
    } finally {
      gate.current = false;
      if (version === generation.current) setBusy(false);
    }
  }
  return (
    <main className="page">
      <h1>Mon clavier hors connexion</h1>
      <p>
        Cet écran utilise uniquement la copie protégée préparée sur cet
        appareil. Les messages restent locaux jusqu’à votre demande explicite
        d’enregistrement et à la vérification de vos accès sur le serveur.
      </p>
      <a className="button-link secondary" href="/admin/profiles">
        Revenir à PictoFlow en ligne
      </a>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {session ? (
        <UnlockedVault
          key={session.row.id}
          initial={session}
          onLock={() => {
            lock();
            setBusy(false);
            void load();
          }}
        />
      ) : (
        <section className="panel">
          <h2>Ouvrir ma copie protégée</h2>
          <form onSubmit={(event) => void open(event)}>
            <label>
              Copie enregistrée
              <select
                value={selected}
                onChange={(event) => {
                  setSelected(event.target.value);
                  setForget(false);
                }}
                required
                disabled={busy}
              >
                <option value="">Choisir ma copie</option>
                {rows.map((row) => (
                  <option key={row.id} value={row.id}>
                    Profil {row.profile_id.slice(-8)} ·{" "}
                    {new Date(row.saved_at).toLocaleString("fr-FR")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Ma phrase secrète
              <input
                type="password"
                autoComplete="current-password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                required
                disabled={busy}
              />
            </label>
            <button disabled={busy || !selected || !passphrase}>
              Déverrouiller ma copie
            </button>
          </form>
          {!rows.length && (
            <p>
              Aucune copie protégée disponible. Préparez-la depuis la
              communication lorsque le réseau est disponible.
            </p>
          )}
          <button
            className="secondary"
            disabled={busy || !selected}
            onClick={() => setForget(true)}
          >
            Effacer cette copie protégée
          </button>
          {forget && (
            <div>
              <p>
                Le clavier et le brouillon de cette copie seront effacés
                uniquement de cet appareil. Le PCL du serveur est conservé.
              </p>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  void deleteVault(selected)
                    .then(() => {
                      setSelected("");
                      setForget(false);
                      return load();
                    })
                    .catch(() => setError("Effacement impossible. Réessayez."));
                }}
              >
                Confirmer l’effacement local
              </button>
              <button className="secondary" onClick={() => setForget(false)}>
                Garder cette copie
              </button>
            </div>
          )}
        </section>
      )}
    </main>
  );
}

function UnlockedVault({
  initial,
  onLock,
}: {
  initial: VaultSession;
  onLock: () => void;
}) {
  const [session, setSession] = useState(initial);
  const current = useRef(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [role, setRole] = useState<HumanRole>("user");
  const gate = useRef(false);
  const alive = useRef(true);
  const profileId = initial.row.profile_id;
  const speech = useLocalSpeech(profileId);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  async function persist(record: OfflineRecord) {
    if (!alive.current) throw new Error("La copie est verrouillée.");
    const value = await saveVault(current.current, record);
    if (!alive.current) throw new Error("La copie est verrouillée.");
    current.current = value;
    setSession(value);
    setConfirm(false);
    return value.record;
  }
  async function perform(task: () => Promise<unknown>) {
    if (gate.current) return;
    gate.current = true;
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (failure) {
      if (alive.current)
        setError(
          failure instanceof Error ? failure.message : "Action impossible.",
        );
    } finally {
      gate.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function submit() {
    const auth = await api<AuthSession>("auth/session");
    const owner = auth.enabled ? auth.account?.id : "development";
    if (
      owner !== current.current.row.owner ||
      (auth.enabled &&
        (!auth.account?.active ||
          (!auth.account.is_admin && !auth.account.profile_access[profileId])))
    )
      throw new Error(
        "Reconnectez-vous en ligne avec le compte qui a préparé cette copie et vérifiez ses accès à ce profil.",
      );
    if (!alive.current) return;
    setCSRFToken(auth.csrf_token);
    let record = current.current.record;
    if (
      !record.snapshot ||
      !record.block_ids.length ||
      record.conflict ||
      record.imported
    )
      return;
    if (!record.submission)
      record = await persist({
        ...record,
        submission: {
          request_id: newIdentity(),
          expected_revision: record.snapshot.revision,
          block_ids: [...record.block_ids],
          actor_role: role,
          confirm: true,
        },
      });
    try {
      const imported = await api<Sequence>(
        `profiles/${profileId}/offline-drafts`,
        { method: "POST", body: JSON.stringify(record.submission) },
      );
      if (
        imported.profile_id !== profileId ||
        imported.id !== record.submission?.request_id ||
        imported.status !== "completed" ||
        JSON.stringify(imported.block_ids) !== JSON.stringify(record.block_ids)
      )
        throw new Error("Réponse inattendue. Vérifiez l’enregistrement.");
      await persist({ ...record, imported });
    } catch (failure) {
      if (failure instanceof APIError && failure.status === 409) {
        await persist({ ...record, conflict: true });
        throw new Error(
          "Le clavier a changé ou ce brouillon est en conflit. Gardez vos mots, puis préparez une nouvelle copie en ligne.",
        );
      }
      throw new Error(
        "L’enregistrement n’a pas été confirmé. Le brouillon est conservé ; réessayez pour vérifier le même envoi.",
      );
    }
  }
  const record = session.record;
  const snapshot = record.snapshot!;
  const words = offlineWords(record);
  const frozen = Boolean(record.submission && !record.conflict);
  return (
    <section aria-label="Ma copie déverrouillée" className="panel">
      <h2>
        Mon message local protégé · {record.block_ids.length} / 32 touches
      </h2>
      <button
        className="secondary"
        disabled={busy}
        onClick={() => {
          speech.stop();
          onLock();
        }}
      >
        Verrouiller ma copie
      </button>
      <p>
        Copie du {new Date(snapshot.captured_at).toLocaleString("fr-FR")}. Elle
        peut différer du clavier actuel du serveur.
      </p>
      <p className="memory-phrase" role="status">
        {words || "Choisissez les touches de votre copie."}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {record.imported && (
        <p role="status">
          Le message est enregistré sur le serveur. Aucun sens n’a été validé
          automatiquement.
        </p>
      )}
      {record.conflict && (
        <p role="alert">
          Copie en conflit : le brouillon reste lisible et ne peut pas être
          renvoyé tel quel.
        </p>
      )}
      <div className="actions">
        <button
          className="secondary"
          disabled={
            busy || frozen || record.conflict || !record.block_ids.length
          }
          onClick={() =>
            void perform(() =>
              persist(editOffline(current.current.record, "undo")),
            )
          }
        >
          Annuler la dernière touche protégée
        </button>
        <button
          className="secondary"
          disabled={
            busy || (frozen && !record.imported) || !record.block_ids.length
          }
          onClick={() =>
            void perform(() =>
              persist(editOffline(current.current.record, "clear")),
            )
          }
        >
          {record.imported
            ? "Nouveau message local protégé"
            : "Effacer le message local protégé"}
        </button>
        <button
          className="secondary"
          disabled={busy || !words || !speech.available}
          onClick={() => speech.read(words)}
        >
          Lire mes mots protégés
        </button>
      </div>
      <KeyboardGrid
        profileId={profileId}
        groups={snapshot.groups}
        tiles={joinKeyboard(
          profileId,
          snapshot.blocks,
          snapshot.positions,
          snapshot.representations,
        )}
        localPhotos={snapshot.photos}
        disabled={
          busy || frozen || record.conflict || record.block_ids.length >= 32
        }
        onSelect={(tile) =>
          perform(() =>
            persist(
              editOffline(current.current.record, "append", tile.block_id),
            ),
          )
        }
      />
      <SpeechSettings speech={speech} disabled={busy} />
      <HumanRoleSelector
        value={role}
        onChange={setRole}
        disabled={busy || frozen}
      />
      {!record.imported && !record.conflict && (
        <>
          <label>
            <input
              type="checkbox"
              checked={confirm}
              onChange={(e) => setConfirm(e.target.checked)}
              disabled={busy || !record.block_ids.length}
            />
            Je souhaite enregistrer ce message au retour du réseau, après
            vérification de mes accès.
          </label>
          <button
            disabled={busy || !confirm || !record.block_ids.length}
            onClick={() => void perform(submit)}
          >
            {record.submission
              ? "Vérifier le même enregistrement"
              : "Vérifier mes accès et enregistrer"}
          </button>
        </>
      )}
    </section>
  );
}
