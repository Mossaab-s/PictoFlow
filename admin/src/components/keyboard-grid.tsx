"use client";
import { useState } from "react";
import { keyboardPage, zones, type Tile, type Zone } from "@/lib/keyboard";

export default function KeyboardGrid({
  tiles,
  onSelect,
  disabled = false,
}: {
  tiles: Tile[];
  onSelect?: (tile: Tile) => void | Promise<void>;
  disabled?: boolean;
}) {
  return (
    <div className="keyboard-zones">
      {(Object.keys(zones) as Zone[]).map((zone) => (
        <ZoneGrid
          key={zone}
          zone={zone}
          tiles={tiles.filter((tile) => tile.zone === zone)}
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
                <strong>{tile.block.label}</strong>
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
                <strong>{tile.block.label}</strong>
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
