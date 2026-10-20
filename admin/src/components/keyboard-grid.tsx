"use client";
import { useRef, useState } from "react";
import {
  keyboardPage,
  pageTiles,
  zones,
  type Tile,
  type Zone,
  type KeyboardGroup,
} from "@/lib/keyboard";
import { TouchContent } from "./pictogram";
import { zoneDisplay, type DisplaySize } from "@/lib/display";
import { orderedGroups } from "@/lib/keyboard-organization";

export default function KeyboardGrid({
  tiles,
  onSelect,
  disabled = false,
  groups,
  profileId,
  displaySize = "standard",
  localPhotos,
}: {
  tiles: Tile[];
  onSelect?: (tile: Tile) => void | Promise<void>;
  disabled?: boolean;
  groups: KeyboardGroup[];
  profileId: string;
  displaySize?: DisplaySize;
  localPhotos?: Record<string, string>;
}) {
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const scoped = orderedGroups(profileId, groups);
  const groupId = scoped.some((group) => group.id === selectedGroup)
    ? selectedGroup
    : null;
  const visible = pageTiles(tiles, groupId);
  return (
    <div className="keyboard-zones">
      {scoped.length > 0 && (
        <nav className="keyboard-pages" aria-label="Pages du clavier">
          <button
            className="secondary"
            aria-current={groupId === null ? "page" : undefined}
            onClick={() => setSelectedGroup(null)}
            disabled={disabled}
          >
            Accueil
          </button>
          {scoped.map((group) => (
            <button
              key={group.id}
              className="secondary"
              aria-current={groupId === group.id ? "page" : undefined}
              onClick={() => setSelectedGroup(group.id)}
              disabled={disabled}
            >
              {group.label}
            </button>
          ))}
        </nav>
      )}
      {groupId && !visible.some((tile) => tile.zone !== "stable") && (
        <p role="status">
          Cette page attend ses touches. Ajoutez-les depuis l’éditeur du
          clavier.
        </p>
      )}
      {(Object.keys(zones) as Zone[]).map((zone) => (
        <ZoneGrid
          key={
            zone === "stable"
              ? zone
              : `${zone}:${groupId ?? "home"}:${displaySize}`
          }
          zone={zone}
          tiles={visible.filter((tile) => tile.zone === zone)}
          onSelect={onSelect}
          disabled={disabled}
          displaySize={displaySize}
          localPhotos={localPhotos}
        />
      ))}
    </div>
  );
}

function ZoneGrid({
  zone,
  tiles,
  onSelect,
  disabled,
  displaySize,
  localPhotos,
}: {
  zone: Zone;
  tiles: Tile[];
  onSelect?: (tile: Tile) => void | Promise<void>;
  disabled: boolean;
  displaySize: DisplaySize;
  localPhotos?: Record<string, string>;
}) {
  const [page, setPage] = useState(0);
  const previous = useRef<HTMLButtonElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const display = zoneDisplay(zone, displaySize);
  const layout = keyboardPage(tiles, page, display.size);
  if (!tiles.length) return null;
  return (
    <section className={`keyboard-zone zone-${zone}`} aria-label={zones[zone]}>
      <div className="zone-heading">
        <h2>{zones[zone]}</h2>
        <span>
          {tiles.length} touche{tiles.length > 1 ? "s" : ""}
        </span>
      </div>
      <div className={`keyboard-grid grid-columns-${display.columns}`}>
        {layout.slots.map((tile, index) =>
          tile ? (
            onSelect ? (
              <button
                key={tile.block_id}
                className="communication-tile"
                aria-label={tile.block.label}
                disabled={disabled}
                onClick={async (event) => {
                  const button = event.currentTarget;
                  await onSelect(tile);
                  requestAnimationFrame(() => {
                    if (
                      button.isConnected &&
                      !button.disabled &&
                      (document.activeElement === button ||
                        document.activeElement === document.body)
                    )
                      button.focus();
                  });
                }}
              >
                <span className="tile-position">
                  {tile.position + 1}
                  {tile.locked ? " · repère fixe" : ""}
                </span>
                <TouchContent
                  label={tile.block.label}
                  representation={tile.representation}
                  localPhoto={
                    tile.representation
                      ? localPhotos?.[tile.representation.id]
                      : undefined
                  }
                />
              </button>
            ) : (
              <div
                key={tile.block_id}
                className="communication-tile tile-preview"
              >
                <span className="tile-position">
                  {tile.position + 1}
                  {tile.locked ? " · repère fixe" : ""}
                </span>
                <TouchContent
                  label={tile.block.label}
                  representation={tile.representation}
                  localPhoto={
                    tile.representation
                      ? localPhotos?.[tile.representation.id]
                      : undefined
                  }
                />
              </div>
            )
          ) : (
            <div
              key={`empty-${layout.offset + index}`}
              className="tile-placeholder"
              aria-hidden="true"
            />
          ),
        )}
      </div>
      {layout.pages > 1 && (
        <div className="pagination">
          <button
            ref={previous}
            className="secondary"
            aria-label={`Touches précédentes : ${zones[zone]}`}
            onClick={(event) => {
              const button = event.currentTarget;
              setPage(layout.page - 1);
              requestAnimationFrame(() => {
                if (
                  button.isConnected &&
                  button.disabled &&
                  (document.activeElement === button ||
                    document.activeElement === document.body)
                )
                  next.current?.focus();
              });
            }}
            disabled={disabled || layout.page === 0}
          >
            Précédentes
          </button>
          <span role="status" aria-live="polite">
            Page {layout.page + 1} / {layout.pages}
          </span>
          <button
            ref={next}
            className="secondary"
            aria-label={`Touches suivantes : ${zones[zone]}`}
            onClick={(event) => {
              const button = event.currentTarget;
              setPage(layout.page + 1);
              requestAnimationFrame(() => {
                if (
                  button.isConnected &&
                  button.disabled &&
                  (document.activeElement === button ||
                    document.activeElement === document.body)
                )
                  previous.current?.focus();
              });
            }}
            disabled={disabled || layout.page + 1 === layout.pages}
          >
            Suivantes
          </button>
        </div>
      )}
    </section>
  );
}
