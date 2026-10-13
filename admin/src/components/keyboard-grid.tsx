"use client";
import { useState } from "react";
import {
  keyboardPage,
  pageTiles,
  zones,
  type Tile,
  type Zone,
  type KeyboardGroup,
} from "@/lib/keyboard";
import { TouchContent } from "./pictogram";

export default function KeyboardGrid({
  tiles,
  onSelect,
  disabled = false,
  groups,
  profileId,
}: {
  tiles: Tile[];
  onSelect?: (tile: Tile) => void | Promise<void>;
  disabled?: boolean;
  groups: KeyboardGroup[];
  profileId: string;
}) {
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const scoped = groups.filter((group) => group.profile_id === profileId);
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
          key={zone === "stable" ? zone : `${zone}:${groupId ?? "home"}`}
          zone={zone}
          tiles={visible.filter((tile) => tile.zone === zone)}
          onSelect={onSelect}
          disabled={disabled}
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
}: {
  zone: Zone;
  tiles: Tile[];
  onSelect?: (tile: Tile) => void | Promise<void>;
  disabled: boolean;
}) {
  const [page, setPage] = useState(0);
  const layout = keyboardPage(tiles, page);
  if (!tiles.length) return null;
  return (
    <section className={`keyboard-zone zone-${zone}`} aria-label={zones[zone]}>
      <div className="zone-heading">
        <h2>{zones[zone]}</h2>
        <span>
          {tiles.length} touche{tiles.length > 1 ? "s" : ""}
        </span>
      </div>
      <div className="keyboard-grid">
        {layout.slots.map((tile, index) =>
          tile ? (
            onSelect ? (
              <button
                key={tile.block_id}
                className="communication-tile"
                disabled={disabled}
                onClick={async (event) => {
                  const button = event.currentTarget;
                  await onSelect(tile);
                  requestAnimationFrame(() => {
                    if (button.isConnected && !button.disabled) button.focus();
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
            className="secondary"
            onClick={() => setPage(layout.page - 1)}
            disabled={layout.page === 0}
          >
            Précédentes
          </button>
          <span>
            Page {layout.page + 1} / {layout.pages}
          </span>
          <button
            className="secondary"
            onClick={() => setPage(layout.page + 1)}
            disabled={layout.page + 1 === layout.pages}
          >
            Suivantes
          </button>
        </div>
      )}
    </section>
  );
}
