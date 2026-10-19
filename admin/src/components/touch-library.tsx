"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Block, Concept, KeyboardGroup, Position } from "@/lib/keyboard";
import {
  findKeyboardTouches,
  orderedGroups,
  touchLocation,
} from "@/lib/keyboard-organization";

export default function TouchLibrary({
  profileId,
  blocks,
  concepts,
  positions,
  groups,
  busy,
  renderBlock,
}: {
  profileId: string;
  blocks: Block[];
  concepts: Concept[];
  positions: Position[];
  groups: KeyboardGroup[];
  busy: boolean;
  renderBlock: (block: Block, hidden: boolean, location: string) => ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState("all");
  const pageId = useId();
  const root = useRef<HTMLElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const focusedCard = useRef<HTMLElement | null>(null);
  const active = orderedGroups(profileId, groups);
  const scoped = blocks.filter(
    (block) => block.profile_id === profileId && block.status === "validated",
  );
  // A removed page must not leave an invisible, no-longer-selectable filter.
  const currentPage =
    page.startsWith("group:") && !active.some((g) => page === `group:${g.id}`)
      ? "all"
      : page;
  const visible = new Set(
    findKeyboardTouches(
      profileId,
      scoped,
      concepts,
      positions,
      query,
      currentPage,
    ).map((block) => block.id),
  );
  useEffect(() => {
    let frame: number | undefined;
    function reveal(id = window.location.hash.slice(1)) {
      if (!id.startsWith("touch-")) return;
      const target = document.getElementById(id);
      if (!target || !root.current?.contains(target)) return;
      setQuery("");
      setPage("all");
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const details = target.querySelector("details");
        if (details) details.open = true;
        target.focus();
        target.scrollIntoView({ block: "start" });
      });
    }
    const onHash = () => reveal();
    function onPlacementLink(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link =
        event.target instanceof Element
          ? event.target.closest('a[href^="#touch-"]')
          : null;
      const href = link?.getAttribute("href");
      if (href) reveal(href.slice(1));
    }
    reveal();
    window.addEventListener("hashchange", onHash);
    // Clicking the same fragment again does not emit hashchange.
    document.addEventListener("click", onPlacementLink);
    return () => {
      window.removeEventListener("hashchange", onHash);
      document.removeEventListener("click", onPlacementLink);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [profileId]);
  useEffect(() => {
    const focused = document.activeElement;
    if (
      !busy &&
      focusedCard.current?.hidden &&
      (focused === document.body ||
        (focused instanceof HTMLElement && root.current?.contains(focused)))
    )
      search.current?.focus();
  });

  return (
    <section
      className="review-section touch-library"
      ref={root}
      onFocusCapture={(event) => {
        focusedCard.current = event.target.closest<HTMLElement>(
          ".touch-library-card",
        );
      }}
      aria-label="Mes touches à modifier"
    >
      <h2>Modifier les touches et leurs places</h2>
      <p>
        Retrouvez une touche par son mot, son sens ou sa page. Ouvrez sa carte
        pour choisir ce que vous voulez modifier.
      </p>
      <div className="touch-library-filters">
        <label>
          Rechercher une touche ou son sens
          <input
            ref={search}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            disabled={busy}
          />
        </label>
        <div>
          <label htmlFor={pageId}>Afficher les touches</label>
          <select
            id={pageId}
            value={currentPage}
            onChange={(event) => setPage(event.target.value)}
            disabled={busy}
          >
            <option value="all">Toutes les touches</option>
            <option value="home">Accueil</option>
            <option value="stable">Repères stables — toutes les pages</option>
            {active.map((group) => (
              <option key={group.id} value={`group:${group.id}`}>
                {group.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p role="status">
        {visible.size} sur {scoped.length} touches
      </p>
      {(query || currentPage !== "all") && (
        <button
          className="secondary"
          disabled={busy}
          onClick={() => {
            setQuery("");
            setPage("all");
            search.current?.focus();
          }}
        >
          Afficher toutes les touches
        </button>
      )}
      {!visible.size && (
        <p>
          Aucune touche ne correspond. Essayez un autre mot ou affichez toutes
          les touches.
        </p>
      )}
      <p className="helper">
        Les repères stables sont communs à toutes les pages. Rechercher et
        ouvrir une carte ne déplace aucune touche. Les changements demandent
        votre validation.
      </p>
      <div className="block-list touch-library-list">
        {scoped.map((block) =>
          renderBlock(
            block,
            !visible.has(block.id),
            touchLocation(profileId, block.id, positions, groups),
          ),
        )}
      </div>
    </section>
  );
}
