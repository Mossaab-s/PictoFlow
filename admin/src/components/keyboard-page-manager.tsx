"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import {
  orderedGroups,
  scopedPreview,
  shiftedPages,
  type KeyboardChangePreview,
} from "@/lib/keyboard-organization";
import type { HumanRole, KeyboardGroup, Representation } from "@/lib/keyboard";
import KeyboardChangeReview from "./keyboard-change-review";

export default function KeyboardPageManager({
  profileId,
  groups,
  visuals,
  role,
  busy,
  perform,
  notice,
}: {
  profileId: string;
  groups: KeyboardGroup[];
  visuals: Representation[];
  role: HumanRole;
  busy: boolean;
  perform: (task: () => Promise<void>) => Promise<void>;
  notice: (value: string) => void;
}) {
  const active = orderedGroups(profileId, groups);
  const base = `profiles/${profileId}/keyboard-groups`;
  async function reorder(id: string, step: -1 | 1) {
    const order = shiftedPages(profileId, active, id, step);
    if (!order) return;
    await api(base + "/order", {
      method: "PUT",
      body: JSON.stringify({ ...order, actor_role: role }),
    });
    notice(
      "L’ordre des pages est enregistré. Les touches restent à leurs places.",
    );
  }
  return (
    <div className="keyboard-page-list">
      {active.map((group, index) => (
        <PageControls
          key={group.id}
          profileId={profileId}
          group={group}
          groups={active}
          visuals={visuals}
          role={role}
          busy={busy}
          perform={perform}
          notice={notice}
          up={index > 0 ? () => perform(() => reorder(group.id, -1)) : null}
          down={
            index < active.length - 1
              ? () => perform(() => reorder(group.id, 1))
              : null
          }
        />
      ))}
    </div>
  );
}

function PageControls({
  profileId,
  group,
  groups,
  visuals,
  role,
  busy,
  perform,
  notice,
  up,
  down,
}: {
  profileId: string;
  group: KeyboardGroup;
  groups: KeyboardGroup[];
  visuals: Representation[];
  role: HumanRole;
  busy: boolean;
  perform: (task: () => Promise<void>) => Promise<void>;
  notice: (value: string) => void;
  up: (() => Promise<void>) | null;
  down: (() => Promise<void>) | null;
}) {
  const [label, setLabel] = useState<string | null>(null);
  const [destination, setDestination] = useState("");
  const [preview, setPreview] = useState<KeyboardChangePreview | null>(null);
  const base = `profiles/${profileId}/keyboard-groups/${group.id}`;
  async function prepare() {
    setPreview(null);
    const value = scopedPreview(
      profileId,
      await api<KeyboardChangePreview>(base + "/removal-preview", {
        method: "POST",
        body: JSON.stringify({ destination_group_id: destination || null }),
      }),
    );
    if (!value || value.source_page?.id !== group.id)
      throw new Error("Aperçu indisponible. Actualisez le clavier.");
    setPreview(value);
  }
  async function remove() {
    if (!preview) return;
    try {
      await api(base + "/remove", {
        method: "POST",
        body: JSON.stringify({
          destination_group_id: preview.destination_page?.id ?? null,
          preview_token: preview.preview_token,
          actor_role: role,
          confirm: true,
        }),
      });
      setPreview(null);
      notice(
        "La page a été retirée. Ses touches et son historique sont conservés.",
      );
    } catch (error) {
      setPreview(null);
      throw error;
    }
  }
  return (
    <article
      className="panel keyboard-page-card"
      aria-label={`Page ${group.label}`}
    >
      <h3>{group.label}</h3>
      <div className="actions">
        <button
          className="secondary"
          aria-label={`Monter la page ${group.label}`}
          disabled={busy || !up}
          onClick={() => up && void up()}
        >
          Monter
        </button>
        <button
          className="secondary"
          aria-label={`Descendre la page ${group.label}`}
          disabled={busy || !down}
          onClick={() => down && void down()}
        >
          Descendre
        </button>
      </div>
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          void perform(async () => {
            await api(base, {
              method: "PATCH",
              body: JSON.stringify({
                label: (label ?? group.label).trim(),
                expected_label: group.label,
                actor_role: role,
              }),
            });
            setLabel(null);
            setPreview(null);
            notice("Le nom de la page est enregistré.");
          });
        }}
      >
        <label>
          Nom de la page « {group.label} »
          <input
            value={label ?? group.label}
            onChange={(e) => {
              setLabel(e.target.value);
              setPreview(null);
            }}
            required
            maxLength={80}
            disabled={busy}
          />
        </label>
        <button
          className="secondary"
          disabled={
            busy ||
            !(label ?? group.label).trim() ||
            (label ?? group.label).trim() === group.label
          }
        >
          Renommer cette page
        </button>
      </form>
      <details>
        <summary>Retirer la page « {group.label} »</summary>
        <label>
          Destination des touches de « {group.label} »
          <select
            value={destination}
            disabled={busy}
            onChange={(e) => {
              setDestination(e.target.value);
              setPreview(null);
            }}
          >
            <option value="">Accueil</option>
            {groups
              .filter((g) => g.id !== group.id)
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
          </select>
        </label>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void perform(prepare)}
        >
          Prévisualiser le retrait de « {group.label} »
        </button>
        {preview && (
          <KeyboardChangeReview
            key={preview.preview_token}
            profileId={profileId}
            preview={preview}
            visuals={visuals}
            removing
            busy={busy}
            apply={() => perform(remove)}
            cancel={() => setPreview(null)}
          />
        )}
      </details>
    </article>
  );
}
