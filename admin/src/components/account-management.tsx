"use client";

import { useEffect, useState } from "react";
import { api, type Profile } from "@/lib/api";
import Link from "next/link";
import {
  type Account,
  type ProfileCapability,
  capabilityLabels,
  capabilityPresets,
  profileCapabilities,
  accountTypeLabels,
  canManageAccounts,
  creatableAccountTypes,
  canPrepare,
  profileToolPath,
  type AccountType,
  type AuthSession,
} from "@/lib/access";
import { profileTitle } from "@/lib/profiles";
import { useAuthentication } from "@/components/authentication";
import AccountLinks, { type ManagementLink } from "@/components/account-links";

export default function AccountManagement() {
  const session = useAuthentication();
  const [users, setUsers] = useState<Account[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [links, setLinks] = useState<ManagementLink[]>([]);
  const [viewer, setViewer] = useState<Account | null>(null);
  const [accountType, setAccountType] =
    useState<Exclude<AccountType, "administrator">>("patient");
  const [existingProfile, setExistingProfile] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [login, setLogin] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!canManageAccounts(session)) return;
    const controller = new AbortController();
    Promise.all([
      api<Account[]>("auth/users", { signal: controller.signal }),
      api<Profile[]>("profiles", { signal: controller.signal }),
      api<ManagementLink[]>("auth/management-links", {
        signal: controller.signal,
      }),
      api<AuthSession>("auth/session", { signal: controller.signal }),
    ])
      .then(([users, profiles, links, current]) => {
        if (!controller.signal.aborted) {
          setUsers(users);
          setProfiles(profiles);
          setLinks(links);
          setViewer(current.account);
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
  if (!canManageAccounts(session))
    return (
      <section className="page">
        <h1>Accès réservé à la gestion des comptes</h1>
      </section>
    );
  const allowedTypes = creatableAccountTypes(session.account);
  const selectedType = allowedTypes.includes(accountType)
    ? accountType
    : allowedTypes[0];
  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("auth/users", {
        method: "POST",
        body: JSON.stringify({
          username: login,
          display_name: name,
          password,
          account_type: selectedType,
          profile_id:
            session?.account?.is_admin &&
            selectedType === "patient" &&
            existingProfile
              ? existingProfile
              : null,
        }),
      });
      setLogin("");
      setName("");
      setReload((value) => value + 1);
      setExistingProfile("");
      setNotice(
        selectedType === "patient"
          ? "Compte patient créé avec son clavier personnel. Préparez ses touches avant sa première utilisation."
          : "Compte créé. Vous pouvez maintenant choisir ses rattachements.",
      );
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
        {session.account?.is_admin
          ? "Vous gérez tous les comptes. Les praticiens et les parents accèdent uniquement aux personnes qui leur sont rattachées."
          : "Vous gérez uniquement les personnes qui vous sont rattachées. Chaque patient garde son clavier personnel et le choix de ses phrases."}
      </p>
      <section className="panel">
        <h2>Créer un compte personnel</h2>
        <form className="account-form" onSubmit={create}>
          <label>
            Type de compte
            <select
              value={selectedType}
              onChange={(event) => {
                setAccountType(event.target.value as typeof accountType);
                setExistingProfile("");
              }}
            >
              {allowedTypes.map((type) => (
                <option key={type} value={type}>
                  {accountTypeLabels[type]}
                </option>
              ))}
            </select>
          </label>
          {session.account?.is_admin && selectedType === "patient" && (
            <label>
              Clavier du patient
              <select
                value={existingProfile}
                onChange={(event) => setExistingProfile(event.target.value)}
              >
                <option value="">Créer un nouveau clavier personnel</option>
                {profiles
                  .filter(
                    (profile) =>
                      !users.some(
                        (user) => user.patient_profile_id === profile.id,
                      ),
                  )
                  .map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profileTitle(profile)}
                    </option>
                  ))}
              </select>
            </label>
          )}
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
            viewer={viewer ?? session.account!}
            onChange={() => setReload((value) => value + 1)}
          />
        ))}
      </div>
      {session.account && (
        <AccountLinks
          viewer={viewer ?? session.account}
          users={users}
          links={links}
          onChange={() => setReload((value) => value + 1)}
        />
      )}
    </section>
  );
}

function AccountCard({
  user,
  profiles,
  currentId,
  viewer,
  onChange,
}: {
  user: Account;
  profiles: Profile[];
  currentId: string;
  viewer: Account;
  onChange: () => void;
}) {
  const session = useAuthentication();
  const currentSession = session ? { ...session, account: viewer } : null;
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
        {user.account_type
          ? accountTypeLabels[user.account_type]
          : user.is_admin
            ? "Administrateur"
            : "Compte existant · droits par profil"}{" "}
        · {user.active ? "Actif" : "Désactivé"}
      </p>
      {user.patient_profile_id &&
        canPrepare(currentSession, user.patient_profile_id) && (
          <p>
            <Link
              className="button-link"
              href={profileToolPath(
                currentSession,
                user.patient_profile_id,
                "keyboard",
              )}
            >
              Préparer le clavier
            </Link>
          </p>
        )}
      {user.account_type && !user.is_admin && (
        <p>
          {user.account_type === "patient"
            ? "Ce compte peut communiquer et choisir ses phrases sur son clavier personnel."
            : "Les accès aux claviers dépendent des rattachements directs aux patients, définis ci-dessous."}
        </p>
      )}
      {!user.is_admin && !user.account_type && (
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
      {user.can_manage_credentials !== false ? (
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
      ) : (
        <p>
          Ce compte possède des droits hors de votre périmètre. L’administrateur
          peut changer son mot de passe ou son état.
        </p>
      )}
      {user.id !== currentId && user.can_manage_credentials !== false && (
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
