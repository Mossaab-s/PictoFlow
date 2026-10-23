"use client";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { findCommunicationTouches } from "@/lib/communication-search";
import { beginSelectionFocus } from "@/lib/selection-focus";
import { touchLocation } from "@/lib/keyboard-organization";
import { displays, type DisplaySize } from "@/lib/display";
import type { KeyboardGroup, Tile } from "@/lib/keyboard";
import { TouchContent } from "./pictogram";

type SearchProps = {
  profileId: string;
  tiles: Tile[];
  groups: KeyboardGroup[];
  displaySize: DisplaySize;
  disabled: boolean;
  purpose?: "replace" | "insert";
  onSelect: (tile: Tile) => void | Promise<void>;
};

export default function CommunicationTouchSearch(props: SearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const opener = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const panelId = useId();
  const headingId = useId();
  const inputId = useId();
  const matches = findCommunicationTouches(
    props.profileId,
    props.tiles,
    props.groups,
    query,
  );
  function close() {
    const origin = document.activeElement;
    setOpen(false);
    setQuery("");
    requestAnimationFrame(() => {
      if (
        opener.current?.isConnected &&
        (document.activeElement === origin ||
          document.activeElement === document.body)
      )
        opener.current.focus();
    });
  }
  return (
    <div className="communication-touch-search">
      <button
        ref={opener}
        type="button"
        className="secondary"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={(event) => {
          if (open) close();
          else {
            const origin = event.currentTarget;
            setOpen(true);
            requestAnimationFrame(() => {
              if (
                input.current?.isConnected &&
                (document.activeElement === origin ||
                  document.activeElement === document.body)
              )
                input.current.focus();
            });
          }
        }}
      >
        Retrouver une touche
      </button>
      {open && (
        <section
          className="touch-search-panel"
          id={panelId}
          aria-labelledby={headingId}
          onKeyDown={(event) => {
            // Communication's capture handler consumes Escape first when speech is active.
            if (event.key === "Escape" && !event.defaultPrevented) {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
          }}
        >
          <div className="touch-search-heading">
            <h2 id={headingId}>Retrouver une touche</h2>
            <button type="button" className="secondary" onClick={close}>
              Fermer la recherche
            </button>
          </div>
          <label htmlFor={inputId}>Chercher le mot de ma touche</label>
          <input
            ref={input}
            id={inputId}
            type="search"
            maxLength={256}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button
              type="button"
              className="secondary touch-search-clear"
              onClick={() => {
                setQuery("");
                input.current?.focus();
              }}
            >
              Effacer la recherche
            </button>
          )}
          <p className="helper">
            Cherchez parmi vos touches validées, sur toutes vos pages.
            {props.purpose === "replace"
              ? "Choisissez une touche pour vérifier le remplacement."
              : props.purpose === "insert"
                ? "Choisissez une touche pour vérifier son ajout à cet endroit."
                : "Choisissez une touche pour l’ajouter à votre message."}
          </p>
          {!query.trim() ? (
            <p>Écrivez le mot affiché sur votre touche.</p>
          ) : (
            <SearchResults
              key={`${query}:${props.displaySize}`}
              {...props}
              matches={matches}
            />
          )}
        </section>
      )}
    </div>
  );
}

function SearchResults({
  profileId,
  groups,
  displaySize,
  disabled,
  onSelect,
  purpose,
  matches,
}: SearchProps & { matches: Tile[] }) {
  const [page, setPage] = useState(0);
  const previous = useRef<HTMLButtonElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const locationId = useId();
  const display = displays[displaySize];
  const pages = Math.max(1, Math.ceil(matches.length / display.size));
  const current = Math.min(page, pages - 1);
  const offset = current * display.size;
  const selectionFocus = useRef<ReturnType<typeof beginSelectionFocus> | null>(
    null,
  );
  const scope = `${profileId}:${purpose ?? "append"}:${displaySize}:${current}:${matches.map((tile) => tile.block_id).join(",")}`;
  useLayoutEffect(
    () => () => {
      selectionFocus.current?.cancel();
      selectionFocus.current = null;
    },
    [scope],
  );
  function browse(target: number, button: HTMLButtonElement) {
    setPage(target);
    requestAnimationFrame(() => {
      if (
        button.isConnected &&
        button.disabled &&
        (document.activeElement === button ||
          document.activeElement === document.body)
      )
        (target === 0 ? next : previous).current?.focus();
    });
  }
  return (
    <div className="touch-search-results">
      <p role="status">
        {matches.length
          ? `${matches.length} touche${matches.length > 1 ? "s trouvées" : " trouvée"}`
          : "Aucune touche trouvée."}
      </p>
      {!matches.length ? (
        <p>
          Essayez un autre mot. La recherche utilise les mots de votre clavier,
          sans ajouter de vocabulaire.
        </p>
      ) : (
        <>
          <div
            className={`keyboard-grid grid-columns-${display.columns}`}
            role="group"
            aria-label="Touches trouvées"
          >
            {matches.slice(offset, offset + display.size).map((tile) => (
              <button
                key={tile.block_id}
                type="button"
                className="communication-tile"
                aria-label={
                  purpose === "insert"
                    ? `Choisir « ${tile.block.label} » pour l’insertion`
                    : purpose === "replace"
                      ? `Choisir « ${tile.block.label} » pour le remplacement`
                      : `Ajouter « ${tile.block.label} » au message`
                }
                aria-describedby={`${locationId}-${tile.block_id}`}
                disabled={disabled}
                onClick={async (event) => {
                  selectionFocus.current?.cancel();
                  const attempt = beginSelectionFocus(event.currentTarget);
                  selectionFocus.current = attempt;
                  try {
                    await onSelect(tile);
                  } finally {
                    attempt.settled();
                  }
                }}
              >
                <TouchContent
                  label={tile.block.label}
                  representation={tile.representation}
                />
                <span
                  className="touch-search-location"
                  id={`${locationId}-${tile.block_id}`}
                >
                  {touchLocation(profileId, tile.block_id, [tile], groups)}
                </span>
              </button>
            ))}
          </div>
          {pages > 1 && (
            <div className="pagination">
              <button
                ref={previous}
                type="button"
                className="secondary"
                disabled={current === 0}
                onClick={(event) => browse(current - 1, event.currentTarget)}
              >
                Résultats précédents
              </button>
              <span aria-live="polite">
                Résultats {offset + 1} à{" "}
                {Math.min(offset + display.size, matches.length)} sur{" "}
                {matches.length}
              </span>
              <button
                ref={next}
                type="button"
                className="secondary"
                disabled={current + 1 >= pages}
                onClick={(event) => browse(current + 1, event.currentTarget)}
              >
                Résultats suivants
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
