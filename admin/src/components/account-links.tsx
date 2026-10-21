"use client";

import { useEffect, useState } from "react";
import { api, APIError } from "@/lib/api";
import {
  type Account,
  type ProfileCapability,
  accountTypeLabels,
  capabilityLabels,
  creatableAccountTypes,
  profileCapabilities,
} from "@/lib/access";

export type ManagementLink = {
  manager_id: string;
  dependent_id: string;
  capabilities: ProfileCapability[] | null;
};

const allCapabilities = Object.keys(capabilityLabels) as ProfileCapability[];

export default function AccountLinks({
  viewer,
  users,
  links,
  onChange,
}: {
  viewer: Account;
  users: Account[];
  links: ManagementLink[];
  onChange: () => void;
}) {
  const [managerId, setManagerId] = useState("");
  const [dependentId, setDependentId] = useState("");
  const [capabilities, setCapabilities] = useState<ProfileCapability[]>([]);
  const [loadedSelection, setLoadedSelection] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const managers = viewer.is_admin
    ? users.filter((user) =>
        ["practitioner", "parent"].includes(user.account_type ?? ""),
      )
    : [
        viewer,
        ...users.filter(
          (user) =>
            viewer.account_type === "practitioner" &&
            user.account_type === "parent",
        ),
      ];
  const manager = managers.find((user) => user.id === managerId) ?? managers[0];
  const allowedTypes = creatableAccountTypes(manager);
  const dependents = users.filter(
    (user) =>
      user.id !== manager?.id &&
      !!user.account_type &&
      user.account_type !== "administrator" &&
      allowedTypes.includes(user.account_type),
  );
  const dependent =
    dependents.find((user) => user.id === dependentId) ?? dependents[0];
  const current = links.find(
    (link) =>
      link.manager_id === manager?.id && link.dependent_id === dependent?.id,
  );
  const selection = `${manager?.id ?? ""}:${dependent?.id ?? ""}`;
  const ceiling = viewer.is_admin
    ? allCapabilities
    : dependent?.patient_profile_id
      ? [...profileCapabilities(viewer, dependent.patient_profile_id)]
      : [];
  const ceilingKey = ceiling.join(",");
  const currentKey = current?.capabilities?.join(",") ?? "";
  const currentExists = !!current;
  useEffect(() => {
    setCapabilities(
      currentExists
        ? (currentKey.split(",").filter(Boolean) as ProfileCapability[])
        : (ceilingKey.split(",").filter(Boolean) as ProfileCapability[]),
    );
    setConfirm(false);
    setLoadedSelection(selection);
  }, [selection, currentExists, currentKey, ceilingKey]);
  useEffect(() => {
    setError("");
    setNotice("");
  }, [selection]);

  async function save(linked: boolean) {
    if (busy || !manager || !dependent || loadedSelection !== selection) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(`auth/users/${manager.id}/links/${dependent.id}`, {
        method: "PUT",
        body: JSON.stringify({
          linked,
          expected_linked: !!current,
          capabilities:
            linked && dependent.account_type === "patient"
              ? capabilities
              : null,
          expected_capabilities: current?.capabilities ?? null,
        }),
      });
      setConfirm(false);
      setNotice(
        linked
          ? "Rattachement enregistré. Les droits s’appliquent dès la prochaine requête."
          : "Rattachement retiré. La mémoire personnelle est conservée.",
      );
      onChange();
    } catch (failure) {
      setError(
        failure instanceof APIError && failure.status === 403
          ? "Ce rattachement ou ces droits dépassent votre périmètre. L’administrateur peut les vérifier."
          : failure instanceof Error
            ? failure.message
            : "Enregistrement impossible.",
      );
    } finally {
      setBusy(false);
    }
  }

  const ready = !!manager && !!dependent && loadedSelection === selection;
  return (
    <section
      className="panel account-links"
      aria-label="Rattachements et droits"
    >
      <h2>Rattachements et droits</h2>
      <p>
        Choisissez qui accompagne quelle personne. Un praticien doit être
        rattaché directement à chaque patient dont il prépare le clavier.
      </p>
      <form
        className="account-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save(true);
        }}
      >
        <label>
          Compte qui gère
          <select
            value={manager?.id ?? ""}
            disabled={busy || !managers.length}
            onChange={(event) => {
              setManagerId(event.target.value);
              setDependentId("");
            }}
          >
            {!managers.length && (
              <option value="">Créez un compte praticien ou parent</option>
            )}
            {managers.map((user) => (
              <option key={user.id} value={user.id}>
                {user.display_name} ·{" "}
                {
                  accountTypeLabels[
                    user.account_type as "parent" | "practitioner"
                  ]
                }
              </option>
            ))}
          </select>
        </label>
        <label>
          Personne rattachée
          <select
            value={dependent?.id ?? ""}
            disabled={busy || !dependents.length}
            onChange={(event) => setDependentId(event.target.value)}
          >
            {!dependents.length && (
              <option value="">
                Aucun compte compatible dans votre périmètre
              </option>
            )}
            {dependents.map((user) => (
              <option key={user.id} value={user.id}>
                {user.display_name} · {accountTypeLabels[user.account_type!]}
              </option>
            ))}
          </select>
        </label>
        {dependent?.account_type === "patient" ? (
          <fieldset className="profile-capabilities" disabled={busy || !ready}>
            <legend>Droits sur le clavier personnel du patient</legend>
            {allCapabilities.map((capability) => (
              <label key={capability}>
                <input
                  type="checkbox"
                  checked={capabilities.includes(capability)}
                  disabled={!ceiling.includes(capability)}
                  onChange={(event) =>
                    setCapabilities((values) =>
                      event.target.checked
                        ? [...values, capability]
                        : values.filter((value) => value !== capability),
                    )
                  }
                />
                {capabilityLabels[capability]}
              </label>
            ))}
          </fieldset>
        ) : (
          dependent && (
            <p>
              Ce lien permet de gérer le compte parent. Choisissez ensuite
              chaque patient et ses droits sur le clavier séparément.
            </p>
          )
        )}
        <button
          disabled={
            busy ||
            !ready ||
            (dependent?.account_type === "patient" && !capabilities.length)
          }
        >
          Enregistrer le rattachement
        </button>
        {current && (
          <>
            <label>
              <input
                type="checkbox"
                checked={confirm}
                disabled={busy}
                onChange={(event) => setConfirm(event.target.checked)}
              />
              Confirmer le retrait de ce rattachement
            </label>
            <button
              type="button"
              className="secondary"
              disabled={busy || !ready || !confirm}
              onClick={() => void save(false)}
            >
              Retirer le rattachement
            </button>
          </>
        )}
      </form>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <h3>Rattachements visibles</h3>
      {links.length ? (
        <ul>
          {links.map((link) => {
            const owner = [viewer, ...users].find(
              (user) => user.id === link.manager_id,
            );
            const target = users.find((user) => user.id === link.dependent_id);
            if (!owner || !target) return null;
            return (
              <li key={`${link.manager_id}:${link.dependent_id}`}>
                <strong>{owner.display_name}</strong> →{" "}
                <strong>{target.display_name}</strong>
                {link.capabilities
                  ? ` · ${link.capabilities.map((capability) => capabilityLabels[capability]).join(", ")}`
                  : " · gestion du compte parent"}
              </li>
            );
          })}
        </ul>
      ) : (
        <p>Aucun rattachement pour le moment.</p>
      )}
    </section>
  );
}
