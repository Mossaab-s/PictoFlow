"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { api, APIError } from "@/lib/api";
import {
  joinKeyboard,
  blockRepresentation,
  newIdentity,
  occupied,
  zones,
  type Block,
  type Concept,
  type HumanRole,
  type Position,
  type Representation,
  type Zone,
} from "@/lib/keyboard";
import KeyboardGrid from "./keyboard-grid";
import { HumanRoleSelector, ProfileNavigation } from "./profile-navigation";
import { useProfileKeyboard } from "./use-profile-keyboard";
import { Pictogram, TouchContent } from "./pictogram";
import PictogramPicker from "./pictogram-picker";
import {
  pictogramFromReference,
  pictogramSource,
  type PictogramKey,
} from "@/lib/pictograms";

export default function KeyboardEditor({ profileId }: { profileId: string }) {
  const data = useProfileKeyboard(profileId);
  const [role, setRole] = useState<HumanRole>("user");
  const [conceptId, setConceptId] = useState("");
  const [conceptLabel, setConceptLabel] = useState("");
  const [label, setLabel] = useState("");
  const [pictogramKey, setPictogramKey] = useState<PictogramKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const gate = useRef(false);
  const base = `profiles/${profileId}`;
  async function perform(task: () => Promise<void>) {
    if (gate.current) return;
    gate.current = true;
    setBusy(true);
    data.setError("");
    setNotice("");
    try {
      await task();
      await data.reload();
    } catch (error) {
      data.setError(
        error instanceof APIError && error.status === 409
          ? "Cette place ou ce sens est déjà utilisé. Choisissez une autre place ou rechargez le clavier."
          : error instanceof Error
            ? error.message
            : "Action impossible.",
      );
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  async function createConcept() {
    const concept = await api<Concept>(`${base}/concepts`, {
      method: "POST",
      body: JSON.stringify({
        canonical_key: `USER_${newIdentity().replaceAll("-", "")}`,
        label: conceptLabel.trim(),
      }),
    });
    setConceptId(concept.id);
    setLabel(concept.label);
    setConceptLabel("");
    setNotice(
      "Le sens personnel a été créé. Vous pouvez maintenant créer sa touche.",
    );
  }
  async function createBlock() {
    await api<Block>(`${base}/blocks`, {
      method: "POST",
      body: JSON.stringify({
        concept_id: conceptId,
        label: label.trim(),
        pictogram_key: pictogramKey,
      }),
    });
    setPictogramKey(null);
    setNotice(
      "La touche est prête à être vérifiée. Validez-la ci-dessous pour l'afficher dans le clavier.",
    );
  }
  async function feedback(
    blockId: string,
    action: "confirm" | "correct" | "reject",
    corrected?: string,
    confirmRepresentation = false,
  ) {
    await api(`${base}/blocks/${blockId}/feedback`, {
      method: "POST",
      body: JSON.stringify({
        action,
        actor_role: role,
        ...(action === "correct" ? { corrected_value: corrected?.trim() } : {}),
        ...(confirmRepresentation ? { confirm_representation: true } : {}),
      }),
    });
    setNotice(
      action === "reject"
        ? "La touche a été écartée. Son historique est conservé."
        : "La touche a été validée et le clavier a été actualisé.",
    );
  }
  async function selectPictogram(block: Block, key: PictogramKey) {
    await api(`${base}/blocks/${block.id}/pictogram`, {
      method: "PUT",
      body: JSON.stringify({ pictogram_key: key, actor_role: role }),
    });
    setNotice(
      "Le dessin a été validé et enregistré. Le mot et le sens de la touche sont conservés.",
    );
  }
  async function place(block: Block, zone: Zone, position: number) {
    if (occupied(data.positions, block.id, zone, position))
      throw new Error("Cette place est occupée par une autre touche.");
    await api(`${base}/keyboard/${block.id}`, {
      method: "PUT",
      body: JSON.stringify({ zone, position, actor_role: role }),
    });
    setNotice("La position de la touche a été enregistrée.");
  }
  const proposed = data.blocks.filter((block) => block.status === "proposed");
  const validated = data.blocks.filter((block) => block.status === "validated");
  return (
    <>
      <ProfileNavigation profileId={profileId} section="keyboard" />
      <section className="page">
        <div className="page-heading">
          <div>
            <div className="eyebrow">MON VOCABULAIRE, MES REPÈRES</div>
            <h1>Créer mon clavier</h1>
            <p>
              Un grand dessin, un mot en dessous. Choisissez les deux et
              vérifiez leur sens avant d'ajouter la touche au clavier.
            </p>
          </div>
          <Link
            className="button-link"
            href={`/admin/profiles/${profileId}/communication`}
          >
            Ouvrir la communication →
          </Link>
        </div>
        <HumanRoleSelector value={role} onChange={setRole} disabled={busy} />
        {data.error && (
          <div className="error" role="alert">
            {data.error}{" "}
            <button
              className="secondary"
              onClick={() => {
                data.setError("");
                void data.reload();
              }}
              disabled={busy}
            >
              Recharger
            </button>
          </div>
        )}
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {data.loading ? (
          <p role="status">Chargement du clavier…</p>
        ) : (
          <>
            <div className="editor-forms">
              <section className="panel">
                <h2>1. Choisir le sens</h2>
                <p>
                  Utilisez un sens existant ou ajoutez votre vocabulaire
                  personnel.
                </p>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void perform(createConcept);
                  }}
                >
                  <label>
                    Nouveau sens personnel
                    <input
                      value={conceptLabel}
                      onChange={(event) => setConceptLabel(event.target.value)}
                      placeholder="Par exemple : boire"
                      required
                      maxLength={256}
                      disabled={busy}
                    />
                  </label>
                  <button
                    className="secondary"
                    disabled={busy || !conceptLabel.trim()}
                  >
                    Ajouter ce sens
                  </button>
                </form>
              </section>
              <section className="panel">
                <h2>2. Préparer le dessin et le mot</h2>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void perform(createBlock);
                  }}
                >
                  <label>
                    Sens de la touche
                    <select
                      value={conceptId}
                      onChange={(event) => {
                        setConceptId(event.target.value);
                        setLabel(
                          data.concepts.find(
                            (concept) => concept.id === event.target.value,
                          )?.label ?? "",
                        );
                      }}
                      required
                      disabled={busy}
                    >
                      <option value="">Choisir un sens</option>
                      {data.concepts.map((concept) => (
                        <option key={concept.id} value={concept.id}>
                          {concept.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Texte affiché sur la touche
                    <input
                      value={label}
                      onChange={(event) => setLabel(event.target.value)}
                      required
                      maxLength={256}
                      placeholder="Boire"
                      disabled={busy}
                    />
                  </label>
                  <PictogramPicker
                    value={pictogramKey}
                    onChange={setPictogramKey}
                    disabled={busy}
                  />
                  <div
                    className="touch-sample"
                    aria-label="Aperçu de la nouvelle touche"
                  >
                    {pictogramKey ? (
                      <Pictogram pictogramKey={pictogramKey} />
                    ) : (
                      <span className="pictogram-missing" aria-hidden="true">
                        ?
                      </span>
                    )}
                    <strong className="touch-word">
                      {label.trim() || "Votre mot"}
                    </strong>
                  </div>
                  <button
                    disabled={
                      busy || !conceptId || !label.trim() || !pictogramKey
                    }
                  >
                    Créer la touche à vérifier
                  </button>
                </form>
              </section>
            </div>
            {proposed.length > 0 && (
              <section className="review-section">
                <h2>3. Vérifier les nouvelles touches</h2>
                <p>
                  Vérifiez le dessin et le mot. Votre validation les rend
                  disponibles pour communiquer.
                </p>
                <div className="block-list">
                  {proposed.map((block) => {
                    const representation = blockRepresentation(
                      profileId,
                      block,
                      data.representations,
                      true,
                    );
                    const supported =
                      representation?.source === pictogramSource &&
                      !!pictogramFromReference(representation.asset_reference);
                    return (
                      <section className="panel" key={block.id}>
                        <h3>{block.label}</h3>
                        <div className="touch-sample">
                          <TouchContent
                            label={block.label}
                            representation={representation}
                          />
                        </div>
                        {block.representation_id && !supported && (
                          <p role="alert">
                            Ce dessin n'est pas disponible dans cet éditeur.
                          </p>
                        )}
                        <p>
                          Sens :{" "}
                          {data.concepts.find(
                            (concept) => concept.id === block.concept_id,
                          )?.label ?? block.canonical_intent}
                        </p>
                        <div className="actions">
                          <button
                            onClick={() =>
                              void perform(() =>
                                feedback(
                                  block.id,
                                  "confirm",
                                  undefined,
                                  supported,
                                ),
                              )
                            }
                            disabled={
                              busy || (!!block.representation_id && !supported)
                            }
                          >
                            {block.representation_id
                              ? "Valider le dessin et le mot"
                              : `Valider la touche « ${block.label} »`}
                          </button>
                          <button
                            className="secondary"
                            onClick={() =>
                              void perform(() => feedback(block.id, "reject"))
                            }
                            disabled={busy}
                          >
                            Écarter cette touche
                          </button>
                        </div>
                      </section>
                    );
                  })}
                </div>
              </section>
            )}
            <section className="review-section">
              <h2>Aperçu du clavier</h2>
              {validated.length ? (
                <KeyboardGrid
                  tiles={joinKeyboard(
                    profileId,
                    data.blocks,
                    data.positions,
                    data.representations,
                  )}
                />
              ) : (
                <div className="empty">
                  <h3>Votre clavier attend ses premières touches</h3>
                  <p>Créez une touche puis validez-la pour la retrouver ici.</p>
                </div>
              )}
            </section>
            {validated.length > 0 && (
              <section className="review-section">
                <h2>Modifier les touches et leurs places</h2>
                <p>
                  Les repères stables gardent leur place. Chaque déplacement est
                  une décision explicite.
                </p>
                <div className="block-list">
                  {validated.map((block) => (
                    <BlockControls
                      key={block.id}
                      block={block}
                      representation={blockRepresentation(
                        profileId,
                        block,
                        data.representations,
                      )}
                      concept={
                        data.concepts.find(
                          (concept) => concept.id === block.concept_id,
                        )?.label ??
                        block.canonical_intent ??
                        ""
                      }
                      position={data.positions.find(
                        (position) => position.block_id === block.id,
                      )}
                      busy={busy}
                      place={(zone, position) =>
                        perform(() => place(block, zone, position))
                      }
                      correct={(value) =>
                        perform(() => feedback(block.id, "correct", value))
                      }
                      selectPictogram={(key) =>
                        perform(() => selectPictogram(block, key))
                      }
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </section>
    </>
  );
}

function BlockControls({
  block,
  concept,
  position,
  busy,
  place,
  correct,
  representation,
  selectPictogram,
}: {
  block: Block;
  concept: string;
  position?: Position;
  busy: boolean;
  place: (zone: Zone, position: number) => Promise<void>;
  correct: (label: string) => Promise<void>;
  representation?: Representation;
  selectPictogram: (key: PictogramKey) => Promise<void>;
}) {
  const [zone, setZone] = useState<Zone | null>(null);
  const [slot, setSlot] = useState<number | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<PictogramKey | null>(null);
  const currentDrawing =
    representation?.source === pictogramSource
      ? pictogramFromReference(representation.asset_reference)?.key
      : undefined;
  return (
    <section className="panel">
      <h3>{block.label}</h3>
      <div className="touch-sample">
        <TouchContent label={block.label} representation={representation} />
      </div>
      <p>Sens : {concept}</p>
      {block.concept_id && (
        <details>
          <summary>
            {currentDrawing ? "Modifier le dessin" : "Ajouter un dessin"} de «{" "}
            {block.label} »
          </summary>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (drawing) void selectPictogram(drawing);
            }}
          >
            <PictogramPicker
              value={drawing ?? currentDrawing ?? null}
              onChange={setDrawing}
              disabled={busy}
            />
            {drawing && (
              <div
                className="touch-sample"
                aria-label="Aperçu du dessin choisi"
              >
                <Pictogram pictogramKey={drawing} />
                <strong className="touch-word">{block.label}</strong>
              </div>
            )}
            <button
              className="secondary"
              disabled={busy || !drawing || drawing === currentDrawing}
            >
              Valider le nouveau dessin de « {block.label} »
            </button>
          </form>
          <p>Le mot, le sens et la place de la touche sont conservés.</p>
        </details>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void place(
            zone ?? position?.zone ?? "personal",
            (slot ?? (position?.position ?? 0) + 1) - 1,
          );
        }}
      >
        <div className="field-row">
          <label>
            Zone
            <select
              value={zone ?? position?.zone ?? "personal"}
              onChange={(event) => setZone(event.target.value as Zone)}
              disabled={busy}
            >
              {(Object.keys(zones) as Zone[]).map((value) => (
                <option
                  value={value}
                  key={value}
                  disabled={
                    value === "stable" && block.origin === "pcl_suggestion"
                  }
                >
                  {zones[value]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Place
            <input
              type="number"
              min={1}
              max={1000}
              required
              value={slot ?? (position?.position ?? 0) + 1}
              onChange={(event) => setSlot(Number(event.target.value))}
              disabled={busy}
            />
          </label>
        </div>
        <button className="secondary" disabled={busy}>
          Enregistrer la place de « {block.label} »
        </button>
      </form>
      <details>
        <summary>Modifier le texte de « {block.label} »</summary>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void correct(label ?? block.label);
          }}
        >
          <label>
            Texte de la touche
            <input
              value={label ?? block.label}
              onChange={(event) => setLabel(event.target.value)}
              maxLength={256}
              required
              disabled={busy}
            />
          </label>
          <button
            className="secondary"
            disabled={busy || !(label ?? block.label).trim()}
          >
            Confirmer le nouveau texte
          </button>
        </form>
        <p>Le sens personnel de la touche est conservé.</p>
      </details>
    </section>
  );
}
