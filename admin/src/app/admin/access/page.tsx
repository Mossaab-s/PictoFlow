"use client";

import { useEffect, useState } from "react";
import { api, type Profile } from "@/lib/api";
import {
  type Account,
  type ProfileCapability,
  capabilityLabels,
  capabilityPresets,
  profileCapabilities,
} from "@/lib/access";
import { profileTitle } from "@/lib/profiles";
import { useAuthentication } from "@/components/authentication";

export default function Access() {
  const session = useAuthentication();
  const [users, setUsers] = useState<Account[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [login, setLogin] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!session?.enabled || !session.account?.is_admin) return;
    const controller = new AbortController();
    Promise.all([
      api<Account[]>("auth/users", { signal: controller.signal }),
      api<Profile[]>("profiles", { signal: controller.signal }),
    ])
      .then(([users, profiles]) => {
        if (!controller.signal.aborted) {
          setUsers(users);
          setProfiles(profiles);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error ? error.message : "Chargement impossible.",
          );
      });
    return () => controller.abort();
  }, [session, reload]);
  if (!session?.enabled)
    return (
      <section className="page">
        <h1>Comptes et accès</h1>
        <p>
          La connexion sera activée lors de la préparation du serveur avec
          HTTPS.
        </p>
      </section>
    );
  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("auth/users", {
        method: "POST",
        body: JSON.stringify({ username: login, display_name: name, password }),
      });
      setLogin("");
      setName("");
      setReload((value) => value + 1);
      setNotice("Compte créé. Choisissez maintenant ses accès aux profils.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Création impossible.");
    } finally {
      setBusy(false);
      setPassword("");
    }
  }
  return (
    <section className="page access-page">
      <h1>Comptes et accès</h1>
      <p>
        Chaque personne dispose de son compte. Un administrateur gère les
        comptes et tous les profils ; les autres personnes accèdent seulement
        aux profils choisis ici.
      </p>
      <section className="panel">
        <h2>Créer un compte personnel</h2>
        <form className="account-form" onSubmit={create}>
          <label>
            Nom affiché
            <input
              required
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Identifiant
            <input
              required
              minLength={3}
              maxLength={80}
              pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{2,79}"
              autoComplete="off"
              value={login}
              onChange={(event) => setLogin(event.target.value)}
            />
          </label>
          <label>
            Mot de passe initial
            <input
              type="password"
              required
              minLength={15}
              maxLength={256}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <p>
            Utilisez une phrase de 15 à 256 caractères. Transmettez-la
            directement à la personne.
          </p>
          <button disabled={busy}>Créer le compte</button>
        </form>
      </section>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <button
        className="secondary"
        onClick={() => {
          setError("");
          setReload((value) => value + 1);
        }}
      >
        Actualiser les comptes
      </button>
      <div className="access-accounts">
        {users.map((user) => (
          <AccountCard
            key={user.id}
            user={user}
            profiles={profiles}
            currentId={session.account!.id}
            onChange={() => setReload((value) => value + 1)}
          />
        ))}
      </div>
    </section>
  );
}

function AccountCard({
  user,
  profiles,
  currentId,
  onChange,
}: {
  user: Account;
  profiles: Profile[];
  currentId: string;
  onChange: () => void;
}) {
  const [profileId, setProfileId] = useState("");
  const [capabilities, setCapabilities] = useState<ProfileCapability[]>([]);
  const [loadedProfile, setLoadedProfile] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const selected = profileId || profiles[0]?.id || "";
  useEffect(() => {
    setCapabilities([...profileCapabilities(user, selected)]);
    setLoadedProfile(selected);
  }, [selected, user.profile_access, user.profile_capabilities]);
  const preset = !capabilities.length
    ? ""
    : (Object.entries(capabilityPresets).find(
        ([, values]) =>
          values.length === capabilities.length &&
          values.every((value) => capabilities.includes(value)),
      )?.[0] ?? "custom");
  async function change(
    path: string,
    method: string,
    body: unknown,
    message: string,
  ) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(`auth/users/${user.id}/${path}`, {
        method,
        body: JSON.stringify(body),
      });
      setNotice(message);
      setConfirm(false);
      onChange();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Modification impossible.",
      );
    } finally {
      setBusy(false);
      setPassword("");
    }
  }
  return (
    <article className="panel access-account" aria-label={user.display_name}>
      <h2>{user.display_name}</h2>
      <p>
        {user.username} ·{" "}
        {user.is_admin ? "Administrateur" : "Compte personnel"} ·{" "}
        {user.active ? "Actif" : "Désactivé"}
      </p>
      {!user.is_admin && (
        <form
          className="account-form"
          onSubmit={(event) => {
            event.preventDefault();
            void change(
              `profiles/${selected}/capabilities`,
              "PUT",
              {
                capabilities: capabilities.length ? capabilities : null,
                expected_capabilities: user.profile_access[selected]
                  ? profileCapabilities(user, selected)
                  : null,
              },
              "Accès enregistré. Il s’applique dès la prochaine requête.",
            );
          }}
        >
          <label>
            Profil
            <select
              aria-label="Profil"
              value={selected}
              onChange={(event) => setProfileId(event.target.value)}
            >
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profileTitle(profile)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Choix rapide
            <select
              value={preset}
              disabled={busy}
              onChange={(event) =>
                setCapabilities(
                  event.target.value === ""
                    ? []
                    : [
                        ...capabilityPresets[
                          event.target.value as keyof typeof capabilityPresets
                        ],
                      ],
                )
              }
            >
              <option value="">Aucun accès</option>
              <option value="communicator">
                Communiquer et valider ses phrases
              </option>
              <option value="editor">Accompagnement complet</option>
              <option value="custom" disabled>
                Autorisations personnalisées
              </option>
            </select>
          </label>
          <fieldset
            className="profile-capabilities"
            disabled={busy || !selected || loadedProfile !== selected}
          >
            <legend>Autorisations de ce profil</legend>
            {(
              Object.entries(capabilityLabels) as [ProfileCapability, string][]
            ).map(([capability, label]) => (
              <label key={capability}>
                <input
                  type="checkbox"
                  checked={capabilities.includes(capability)}
                  onChange={(event) =>
                    setCapabilities((values) =>
                      event.target.checked
                        ? [...values, capability]
                        : values.filter((value) => value !== capability),
                    )
                  }
                />
                {label}
              </label>
            ))}
          </fieldset>
          <p>
            Ces droits s’appliquent uniquement à ce profil. Tout décocher retire
            son accès. L’effacement de la mémoire et les diagnostics techniques
            restent réservés à l’administrateur.
          </p>
          <button disabled={busy || !selected || loadedProfile !== selected}>
            Enregistrer l’accès
          </button>
        </form>
      )}
      <details>
        <summary>Changer le mot de passe</summary>
        <form
          className="account-form"
          onSubmit={(event) => {
            event.preventDefault();
            void change(
              "password",
              "POST",
              { password },
              "Mot de passe changé. Les sessions de ce compte sont fermées.",
            );
          }}
        >
          <label>
            Nouveau mot de passe
            <input
              type="password"
              required
              minLength={15}
              maxLength={256}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button disabled={busy}>Changer et fermer ses sessions</button>
        </form>
      </details>
      {user.id !== currentId && (
        <div className="account-state">
          {user.active && (
            <label>
              <input
                type="checkbox"
                checked={confirm}
                onChange={(event) => setConfirm(event.target.checked)}
              />
              Confirmer la désactivation de ce compte
            </label>
          )}
          <button
            className="secondary"
            disabled={busy || (user.active && !confirm)}
            onClick={() =>
              void change(
                "active",
                "PATCH",
                { active: !user.active, expected_active: user.active },
                user.active
                  ? "Compte désactivé ; ses sessions sont fermées."
                  : "Compte réactivé. La personne peut se reconnecter.",
              )
            }
          >
            {user.active ? "Désactiver le compte" : "Réactiver le compte"}
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </article>
  );
}
