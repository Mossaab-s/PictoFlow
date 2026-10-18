"use client";
import { useAuthentication } from "./authentication";
import { canProfile } from "@/lib/access";
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
  type HumanRole,
  type Position,
  type Representation,
  type Zone,
  type KeyboardGroup,
} from "@/lib/keyboard";
import KeyboardPreparationPreview from "./keyboard-preparation-preview";
import { HumanRoleSelector, ProfileNavigation } from "./profile-navigation";
import { useProfileKeyboard } from "./use-profile-keyboard";
import { Pictogram, TouchContent } from "./pictogram";
import PictogramPicker from "./pictogram-picker";
import PhotoPicker from "./photo-picker";
import KeyboardPageManager from "./keyboard-page-manager";
import KeyboardChangeReview from "./keyboard-change-review";
import KeyboardUsage from "./keyboard-usage";
import {
  scopedPreview,
  type KeyboardChangePreview,
} from "@/lib/keyboard-organization";
import { photoBase64, photoUrl, photoSource } from "@/lib/photos";
import {
  pictogramFromReference,
  pictograms,
  pictogramSource,
  type PictogramKey,
} from "@/lib/pictograms";

export default function KeyboardEditor({
  profileId,
  resume = false,
}: {
  profileId: string;
  resume?: boolean;
}) {
  const canCommunicate = canProfile(
    useAuthentication(),
    profileId,
    "communicate",
  );
  const data = useProfileKeyboard(profileId);
  const [role, setRole] = useState<HumanRole>("user");
  const [conceptId, setConceptId] = useState("");
  const [label, setLabel] = useState("");
  const [meaning, setMeaning] = useState("");
  const [pictogramKey, setPictogramKey] = useState<PictogramKey | null>(null);
  const [visualMode, setVisualMode] = useState<"drawing" | "photo">("drawing");
  const [photo, setPhoto] = useState<File | null>(null);
  const [groupLabel, setGroupLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const gate = useRef(false);
  const creation = useRef<{ signature: string; id: string } | null>(null);
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
          ? "Ce choix n’est plus disponible ou le clavier a changé. Vérifiez le clavier actualisé puis préparez un nouvel aperçu."
          : error instanceof Error
            ? error.message
            : "Action impossible.",
      );
      // Read committed state after an uncertain response; never replay a write automatically.
      await data.reload();
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  async function createBlock() {
    const signature = JSON.stringify([
      label.trim(),
      visualMode,
      pictogramKey,
      conceptId,
      conceptId ? null : meaning.trim(),
      photo ? [photo.name, photo.size, photo.lastModified] : null,
    ]);
    if (creation.current?.signature !== signature) {
      creation.current = { signature, id: newIdentity() };
    }
    if (visualMode === "photo") {
      if (!photo) throw new Error("Choisissez une photo.");
      await sendPhoto(`${base}/blocks/photo`, "POST", {
        request_id: creation.current.id,
        actor_role: role,
        label: label.trim(),
        ...(conceptId ? { concept_id: conceptId } : {}),
        ...(!conceptId && meaning.trim() ? { meaning: meaning.trim() } : {}),
        photo_base64: await photoBase64(photo),
      });
    } else
      await api<Block>(`${base}/blocks${conceptId ? "" : "/personal"}`, {
        method: "POST",
        body: JSON.stringify({
          ...(conceptId
            ? { concept_id: conceptId }
            : {
                request_id: creation.current.id,
                actor_role: role,
                ...(meaning.trim() ? { meaning: meaning.trim() } : {}),
              }),
          label: label.trim(),
          pictogram_key: pictogramKey,
        }),
      });
    creation.current = null;
    setLabel("");
    setMeaning("");
    setConceptId("");
    setPictogramKey(null);
    setPhoto(null);
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
  async function selectPhoto(block: Block, file: File, requestId: string) {
    await sendPhoto(`${base}/blocks/${block.id}/photo`, "PUT", {
      request_id: requestId,
      actor_role: role,
      photo_base64: await photoBase64(file),
    });
    setNotice(
      "La photo a été validée. Le mot, le sens et la place de la touche sont conservés.",
    );
  }
  async function removePhoto(visual: Representation) {
    await api(`${base}/representations/${visual.id}/photo?actor_role=${role}`, {
      method: "DELETE",
    });
    setNotice("La photo a été supprimée. L’historique du choix est conservé.");
  }
  async function place(
    block: Block,
    zone: Zone,
    position: number,
    groupId: string | null,
  ) {
    if (occupied(data.positions, block.id, zone, position, groupId))
      throw new Error("Cette place est occupée par une autre touche.");
    await api(`${base}/keyboard/${block.id}`, {
      method: "PUT",
      body: JSON.stringify({
        zone,
        position,
        group_id: groupId,
        actor_role: role,
      }),
    });
    setNotice("La position de la touche a été enregistrée.");
  }
  async function createGroup() {
    if (groupLabel.trim().toLowerCase() === "accueil")
      throw new Error(
        "Accueil est déjà la page des touches sans groupe. Choisissez un autre nom.",
      );
    await api(`${base}/keyboard-groups`, {
      method: "POST",
      body: JSON.stringify({ label: groupLabel.trim(), actor_role: role }),
    });
    setGroupLabel("");
    setNotice(
      "La page a été créée. Choisissez-la dans la place des touches à y ajouter.",
    );
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
            <h1>Préparer mon clavier</h1>
            <p>
              Un grand dessin, un mot en dessous. Choisissez les deux et
              vérifiez leur sens avant d'ajouter la touche au clavier.
            </p>
          </div>
          {canCommunicate && (
            <Link className="button-link" href={`/communication/${profileId}`}>
              Ouvrir la communication →
            </Link>
          )}
        </div>
        <nav className="preparation-steps" aria-label="Étapes de préparation">
          <a href="#keyboard-create">1. Préparer une touche</a>
          {proposed.length > 0 && (
            <a href="#keyboard-review">2. Vérifier ({proposed.length})</a>
          )}
          <a href="#keyboard-organize">3. Organiser</a>
          <a href="#keyboard-preview">Voir l’aperçu</a>
        </nav>
        <HumanRoleSelector value={role} onChange={setRole} disabled={busy} />
        {resume && (
          <section className="panel" aria-label="Préparer un mot manquant">
            <h2>Ajouter le mot qui me manque</h2>
            <p>
              Préparez son mot, son sens et son dessin ou sa photo, puis validez
              la touche ci-dessous. Revenez ensuite à la communication pour la
              choisir vous-même.
            </p>
            <p>
              Votre message en cours reste sur le serveur. Dans ce même onglet,
              son repère de reprise est conservé ; aucune nouvelle touche n’y
              est ajoutée automatiquement.
            </p>
            {canCommunicate && (
              <Link
                className="button-link"
                href={`/communication/${profileId}`}
              >
                Reprendre mon message
              </Link>
            )}
          </section>
        )}
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
            <div className="touch-creator" id="keyboard-create">
              <section className="panel">
                <h2>1. Préparer une touche</h2>
                <p>
                  Choisissez un dessin et écrivez votre mot. Vous vérifierez la
                  touche avant de l'utiliser.
                </p>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void perform(createBlock);
                  }}
                >
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
                  {!conceptId && (
                    <label>
                      Ce que cette touche signifie pour moi, facultatif
                      <input
                        value={meaning}
                        onChange={(event) => setMeaning(event.target.value)}
                        maxLength={256}
                        disabled={busy}
                        placeholder="Par exemple : mon ours pour me rassurer"
                      />
                      <span className="helper">
                        Sans précision, le mot de la touche sert de sens. Ce
                        sens sera vérifié avec le dessin avant utilisation.
                      </span>
                    </label>
                  )}
                  <details>
                    <summary>
                      Utiliser un sens déjà présent{" "}
                      {conceptId ? "(sélectionné)" : "(facultatif)"}
                    </summary>
                    <p>
                      Choisissez-le si cette touche exprime un sens personnel
                      que vous avez déjà créé.
                    </p>
                    <label>
                      Sens existant
                      <select
                        value={conceptId}
                        onChange={(event) => {
                          setConceptId(event.target.value);
                          setLabel(
                            data.concepts.find(
                              (concept) => concept.id === event.target.value,
                            )?.label ?? label,
                          );
                        }}
                        disabled={busy}
                      >
                        <option value="">
                          Créer un nouveau sens avec mon mot
                        </option>
                        {data.concepts.map((concept) => (
                          <option key={concept.id} value={concept.id}>
                            {concept.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </details>
                  <div
                    className="actions"
                    role="group"
                    aria-label="Image de la touche"
                  >
                    <button
                      type="button"
                      className="secondary"
                      aria-pressed={visualMode === "drawing"}
                      disabled={busy}
                      onClick={() => setVisualMode("drawing")}
                    >
                      Dessin
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      aria-pressed={visualMode === "photo"}
                      disabled={busy}
                      onClick={() => setVisualMode("photo")}
                    >
                      Photo personnelle
                    </button>
                  </div>
                  {visualMode === "photo" ? (
                    <PhotoPicker
                      file={photo}
                      label={label.trim() || "Votre mot"}
                      disabled={busy}
                      onChange={(value) => {
                        setPhoto(value);
                        creation.current = null;
                      }}
                    />
                  ) : (
                    <PictogramPicker
                      value={pictogramKey}
                      onChange={(key) => {
                        setPictogramKey(key);
                        if (!label.trim() && !conceptId)
                          setLabel(
                            pictograms.find((drawing) => drawing.key === key)
                              ?.label ?? "",
                          );
                      }}
                      disabled={busy}
                    />
                  )}
                  {visualMode === "drawing" && (
                    <div
                      className="touch-sample"
                      aria-label="Aperçu de la nouvelle touche"
                    >
                      {visualMode === "drawing" && pictogramKey ? (
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
                  )}
                  <button
                    disabled={
                      busy ||
                      !label.trim() ||
                      (visualMode === "photo" ? !photo : !pictogramKey)
                    }
                  >
                    Créer la touche à vérifier
                  </button>
                </form>
              </section>
            </div>
            {proposed.length > 0 && (
              <section className="review-section">
                <h2 id="keyboard-review" tabIndex={-1}>
                  2. Vérifier les nouvelles touches
                </h2>
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
                      !!photoUrl(representation) ||
                      (representation?.source === pictogramSource &&
                        !!pictogramFromReference(
                          representation.asset_reference,
                        ));
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
              <h2 id="keyboard-organize" tabIndex={-1}>
                3. Organiser les pages de mon clavier
              </h2>
              <p>
                Créez vos pages, par exemple Personnes ou Besoins. Les repères
                stables restent visibles sur chaque page. Les touches sans page
                sont dans Accueil.
              </p>
              <form
                className="inline-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void perform(createGroup);
                }}
              >
                <label>
                  Nom de la nouvelle page
                  <input
                    value={groupLabel}
                    onChange={(event) => setGroupLabel(event.target.value)}
                    maxLength={80}
                    required
                    disabled={busy}
                    placeholder="Personnes"
                  />
                </label>
                <button disabled={busy || !groupLabel.trim()}>
                  Créer la page
                </button>
              </form>
              <KeyboardPageManager
                profileId={profileId}
                groups={data.groups}
                visuals={data.representations}
                role={role}
                busy={busy}
                perform={perform}
                notice={setNotice}
              />
            </section>
            <KeyboardUsage
              key={`usage:${profileId}`}
              profileId={profileId}
              blocks={data.blocks}
              positions={data.positions}
              visuals={data.representations}
            />
            <KeyboardPreparationPreview
              profileId={profileId}
              groups={data.groups}
              tiles={joinKeyboard(
                profileId,
                data.blocks,
                data.positions,
                data.representations,
              )}
            />
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
                      profileId={profileId}
                      role={role}
                      visuals={data.representations}
                      perform={perform}
                      notice={setNotice}
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
                      groups={data.groups}
                      busy={busy}
                      place={(zone, position, groupId) =>
                        perform(() => place(block, zone, position, groupId))
                      }
                      correct={(value) =>
                        perform(() => feedback(block.id, "correct", value))
                      }
                      selectPictogram={(key) =>
                        perform(() => selectPictogram(block, key))
                      }
                      selectPhoto={(file, requestId) =>
                        perform(() => selectPhoto(block, file, requestId))
                      }
                    />
                  ))}
                </div>
              </section>
            )}
            {data.representations.some(
              (visual) =>
                visual.source === photoSource && visual.status !== "archived",
            ) && (
              <section className="review-section">
                <h2>Photos conservées</h2>
                <p>
                  Pour supprimer une photo utilisée, choisissez d’abord un autre
                  dessin ou une autre photo pour sa touche.
                </p>
                <div className="block-list">
                  {data.representations
                    .filter(
                      (visual) =>
                        visual.source === photoSource &&
                        visual.status !== "archived",
                    )
                    .map((visual) => {
                      const linked = data.blocks.find(
                        (block) => block.representation_id === visual.id,
                      );
                      const used = data.blocks.some(
                        (block) =>
                          block.representation_id === visual.id &&
                          block.status === "validated",
                      );
                      return (
                        <section className="panel" key={visual.id}>
                          <div className="touch-sample">
                            <TouchContent
                              label={
                                linked?.label ??
                                data.concepts.find(
                                  (concept) => concept.id === visual.concept_id,
                                )?.label ??
                                "Photo personnelle"
                              }
                              representation={visual}
                            />
                          </div>
                          <button
                            className="secondary"
                            disabled={busy || used}
                            onClick={() =>
                              void perform(() => removePhoto(visual))
                            }
                          >
                            Supprimer cette photo
                          </button>
                          {used && (
                            <p>Cette photo est utilisée dans le clavier.</p>
                          )}
                        </section>
                      );
                    })}
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
  profileId,
  role,
  visuals,
  perform,
  notice,
  block,
  concept,
  position,
  busy,
  place,
  correct,
  representation,
  selectPictogram,
  selectPhoto,
  groups,
}: {
  profileId: string;
  role: HumanRole;
  visuals: Representation[];
  perform: (task: () => Promise<void>) => Promise<void>;
  notice: (value: string) => void;
  block: Block;
  concept: string;
  position?: Position;
  busy: boolean;
  place: (
    zone: Zone,
    position: number,
    groupId: string | null,
  ) => Promise<void>;
  correct: (label: string) => Promise<void>;
  representation?: Representation;
  selectPictogram: (key: PictogramKey) => Promise<void>;
  selectPhoto: (file: File, requestId: string) => Promise<void>;
  groups: KeyboardGroup[];
}) {
  const [zone, setZone] = useState<Zone | null>(null);
  const [slot, setSlot] = useState<number | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<PictogramKey | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [preview, setPreview] = useState<KeyboardChangePreview | null>(null);
  async function prepareMove(
    targetPosition: number,
    destination: string | null,
  ) {
    setPreview(null);
    const result = scopedPreview(
      profileId,
      await api<KeyboardChangePreview>(
        `profiles/${profileId}/keyboard/${block.id}/move-preview`,
        {
          method: "POST",
          body: JSON.stringify({
            destination_group_id: destination,
            position: targetPosition,
          }),
        },
      ),
    );
    if (
      !result ||
      result.moves.length !== 1 ||
      result.moves[0].block.id !== block.id
    )
      throw new Error("Aperçu indisponible. Actualisez le clavier.");
    setPreview(result);
  }
  async function applyMove() {
    if (!preview) return;
    try {
      await api(`profiles/${profileId}/keyboard/${block.id}/move`, {
        method: "POST",
        body: JSON.stringify({
          destination_group_id: preview.destination_page?.id ?? null,
          position: preview.moves[0].after.position,
          preview_token: preview.preview_token,
          actor_role: role,
        }),
      });
      setPreview(null);
      notice(
        "La touche est déplacée. Son mot, son image et son sens sont conservés.",
      );
    } catch (error) {
      setPreview(null);
      throw error;
    }
  }
  const photoRequest = useRef(newIdentity());
  const currentDrawing =
    representation?.source === pictogramSource
      ? pictogramFromReference(representation.asset_reference)?.key
      : undefined;
  return (
    <section className="panel" id={`touch-${block.id}`} tabIndex={-1}>
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
      {block.concept_id && (
        <details>
          <summary>Choisir une photo pour « {block.label} »</summary>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (photo) void selectPhoto(photo, photoRequest.current);
            }}
          >
            <PhotoPicker
              file={photo}
              label={block.label}
              disabled={busy}
              onChange={(file) => {
                setPhoto(file);
                photoRequest.current = newIdentity();
              }}
            />
            <button className="secondary" disabled={busy || !photo}>
              Valider la photo de « {block.label} »
            </button>
          </form>
          <p>
            Le mot, le sens et la place sont conservés. L’ancien choix reste
            dans l’historique.
          </p>
        </details>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const targetZone = zone ?? position?.zone ?? "personal";
          const targetPosition = (slot ?? (position?.position ?? 0) + 1) - 1;
          const destination =
            targetZone === "stable"
              ? null
              : (groupId ?? position?.group_id ?? "") || null;
          if (targetZone === position?.zone && targetZone !== "stable")
            void perform(() => prepareMove(targetPosition, destination));
          else {
            setPreview(null);
            void place(targetZone, targetPosition, destination);
          }
        }}
      >
        <div className="field-row">
          <label>
            Zone
            <select
              value={zone ?? position?.zone ?? "personal"}
              onChange={(event) => {
                setZone(event.target.value as Zone);
                setPreview(null);
              }}
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
            Page
            <select
              value={
                (zone ?? position?.zone) === "stable"
                  ? ""
                  : (groupId ?? position?.group_id ?? "")
              }
              disabled={busy || (zone ?? position?.zone) === "stable"}
              onChange={(event) => {
                setGroupId(event.target.value);
                setPreview(null);
              }}
            >
              <option value="">
                {(zone ?? position?.zone) === "stable"
                  ? "Toutes les pages (repère stable)"
                  : "Accueil"}
              </option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.label}
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
              onChange={(event) => {
                setSlot(Number(event.target.value));
                setPreview(null);
              }}
              disabled={busy}
            />
          </label>
        </div>
        <button className="secondary" disabled={busy}>
          {(zone ?? position?.zone) === position?.zone &&
          position?.zone !== "stable"
            ? `Prévisualiser le déplacement de « ${block.label} »`
            : `Enregistrer la place de « ${block.label} »`}
        </button>
      </form>
      {preview && (
        <KeyboardChangeReview
          key={preview.preview_token}
          profileId={profileId}
          preview={preview}
          visuals={visuals}
          busy={busy}
          apply={() => perform(applyMove)}
          cancel={() => setPreview(null)}
        />
      )}
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

async function sendPhoto(
  path: string,
  method: "POST" | "PUT",
  body: Record<string, unknown>,
) {
  try {
    return await api<Block>(path, { method, body: JSON.stringify(body) });
  } catch (error) {
    if (error instanceof APIError && [413, 415, 422].includes(error.status))
      throw new Error(
        "La photo n’est pas acceptée. Choisissez une image fixe JPEG, PNG ou WebP de 5 Mo maximum.",
      );
    throw error;
  }
}
