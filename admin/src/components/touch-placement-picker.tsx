"use client";
import { useRef, useState } from "react";
import {
  blockRepresentation,
  zones,
  type Block,
  type KeyboardGroup,
  type Position,
  type Representation,
  type Zone,
} from "@/lib/keyboard";
import { placementWindow, placementLimit } from "@/lib/keyboard-placement";
import { orderedGroups } from "@/lib/keyboard-organization";
import { zoneDisplay } from "@/lib/display";
import { useDisplaySettings } from "./use-display-settings";
import { TouchContent } from "./pictogram";

export default function TouchPlacementPicker({
  profileId,
  block,
  blocks,
  positions,
  visuals,
  groups,
  zone,
  groupId,
  value,
  disabled,
  onChange,
}: {
  profileId: string;
  block: Block;
  blocks: Block[];
  positions: Position[];
  visuals: Representation[];
  groups: KeyboardGroup[];
  zone: Zone;
  groupId: string | null;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const display = useDisplaySettings(profileId);
  const grid = zoneDisplay(zone, display.size);
  const [range, setRange] = useState<{ selected: number; page: number } | null>(
    null,
  );
  const previous = useRef<HTMLButtonElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const slots = useRef<HTMLDivElement>(null);
  const layout = placementWindow(
    profileId,
    block.id,
    blocks,
    positions,
    zone,
    groupId,
    value,
    range?.selected === value ? range.page : null,
    grid.size,
  );
  const destination =
    zone === "stable" || groupId === null
      ? null
      : orderedGroups(profileId, groups).find((g) => g.id === groupId);
  const available =
    block.profile_id === profileId &&
    (zone === "stable" || groupId === null || !!destination);
  const pageName =
    zone === "stable" ? "Toutes les pages" : (destination?.label ?? "Accueil");
  function browse(page: number, button: HTMLButtonElement) {
    setRange({ selected: value, page });
    requestAnimationFrame(() => {
      if (button.isConnected && button.disabled)
        (page === 0 ? next : previous).current?.focus();
    });
  }
  function returnToSelection() {
    setRange(null);
    requestAnimationFrame(() => {
      const grid = slots.current;
      if (!grid) return;
      const selected = grid.querySelector<HTMLButtonElement>(
        'button[aria-pressed="true"]:not(:disabled)',
      );
      const free = grid.querySelector<HTMLButtonElement>(
        "button:not(:disabled)",
      );
      (
        selected ??
        free ??
        (next.current?.disabled ? previous.current : next.current)
      )?.focus();
    });
  }
  if (!available)
    return (
      <p role="alert">
        Cette page n’est plus disponible. Choisissez une autre page.
      </p>
    );
  return (
    <section
      className="placement-picker"
      aria-label="Choisir une place visuellement"
    >
      <h4>Choisir une case libre</h4>
      <p>
        {pageName} · {zones[zone]}
      </p>
      <p className="helper">
        Cliquez sur une case libre. Ce choix prépare la destination sans
        déplacer la touche. Les autres touches gardent leurs places.
      </p>
      {!display.ready ? (
        <p>Chargement de l’affichage…</p>
      ) : (
        <>
          <div
            className="placement-slots"
            ref={slots}
            data-columns={grid.columns}
            role="group"
            aria-label={`Cases de ${pageName} · ${zones[zone]}`}
          >
            {layout.slots.map((slot) => {
              const selected = slot.selected && !slot.occupied;
              const label = slot.occupied
                ? `Place ${slot.position + 1} occupée${slot.occupant ? ` par ${slot.occupant.label}` : ", indisponible"}`
                : slot.current
                  ? `Place ${slot.position + 1}, place actuelle de ${block.label}`
                  : `Choisir la place libre ${slot.position + 1}`;
              const shown = slot.occupant ?? (selected ? block : null);
              return (
                <button
                  key={slot.position}
                  type="button"
                  className="placement-slot secondary"
                  disabled={disabled || slot.occupied}
                  aria-label={label}
                  aria-pressed={selected}
                  onClick={() => onChange(slot.position + 1)}
                >
                  <span>Place {slot.position + 1}</span>
                  {shown ? (
                    <TouchContent
                      label={shown.label}
                      representation={blockRepresentation(
                        profileId,
                        shown,
                        visuals,
                      )}
                    />
                  ) : (
                    <span className="placement-empty">
                      {slot.occupied ? "Indisponible" : "Libre"}
                    </span>
                  )}
                  <small>
                    {slot.occupied
                      ? "Occupée"
                      : slot.current
                        ? "Place actuelle"
                        : selected
                          ? "Choisie"
                          : "Choisir"}
                  </small>
                </button>
              );
            })}
          </div>
          <div className="placement-pagination">
            <button
              ref={previous}
              type="button"
              className="secondary"
              disabled={disabled || layout.page === 0}
              onClick={(event) => browse(layout.page - 1, event.currentTarget)}
            >
              Places précédentes
            </button>
            <span>
              Places {layout.offset + 1} à {layout.offset + layout.slots.length}
            </span>
            <button
              ref={next}
              type="button"
              className="secondary"
              disabled={disabled || layout.page + 1 >= layout.pages}
              onClick={(event) => browse(layout.page + 1, event.currentTarget)}
            >
              Places suivantes
            </button>
          </div>
          <p aria-live="polite" aria-atomic="true">
            {!layout.validSelection
              ? `Choisissez une place entre 1 et ${placementLimit}.`
              : layout.selectedOccupied
                ? "Cette place est occupée. Choisissez une case libre."
                : `Destination choisie : ${pageName} · place ${value}. Elle sera enregistrée uniquement après votre validation.`}
          </p>
          {layout.validSelection && !layout.selectedVisible && (
            <button
              type="button"
              className="secondary"
              disabled={disabled}
              onClick={returnToSelection}
            >
              Revenir à la place choisie
            </button>
          )}
        </>
      )}
    </section>
  );
}
