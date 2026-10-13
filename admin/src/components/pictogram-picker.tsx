"use client";
import { useId, useState } from "react";
import {
  pictograms,
  pictogramCategories,
  searchPictograms,
  type PictogramCategory,
  type PictogramKey,
} from "@/lib/pictograms";
import { Pictogram } from "./pictogram";

export default function PictogramPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: PictogramKey | null;
  onChange: (key: PictogramKey) => void;
  disabled?: boolean;
}) {
  const name = useId();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<PictogramCategory | "all">("all");
  const results = searchPictograms(query, category);
  const selected = pictograms.find((item) => item.key === value);
  const hiddenSelection =
    selected && !results.some((item) => item.key === value);
  function option(drawing: (typeof pictograms)[number]) {
    return (
      <label
        className={`pictogram-option${value === drawing.key ? " selected" : ""}`}
        key={drawing.key}
      >
        <input
          type="radio"
          name={name}
          value={drawing.key}
          checked={value === drawing.key}
          onChange={() => onChange(drawing.key)}
          required
        />
        <Pictogram pictogramKey={drawing.key} />
        <span>{drawing.label}</span>
      </label>
    );
  }
  return (
    <fieldset className="pictogram-picker" disabled={disabled}>
      <legend>Choisir le dessin</legend>
      <div className="pictogram-filters">
        <label>
          Rechercher un dessin
          <input
            type="search"
            value={query}
            maxLength={128}
            placeholder="Téléphone, repas, joie…"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.preventDefault();
            }}
          />
        </label>
        <label>
          Catégorie
          <select
            value={category}
            onChange={(event) =>
              setCategory(event.target.value as PictogramCategory | "all")
            }
          >
            <option value="all">Tous les dessins</option>
            {(Object.keys(pictogramCategories) as PictogramCategory[]).map(
              (key) => (
                <option key={key} value={key}>
                  {pictogramCategories[key]}
                </option>
              ),
            )}
          </select>
        </label>
      </div>
      <p className="catalog-count" role="status">
        {`${results.length} dessin${results.length === 1 ? "" : "s"} trouvé${results.length === 1 ? "" : "s"}`}
      </p>
      {hiddenSelection && (
        <div className="pictogram-selection">
          <p>Dessin choisi (conservé pendant la recherche)</p>
          {option(selected)}
        </div>
      )}
      {results.length ? (
        <div
          className="pictogram-gallery"
          role="region"
          aria-label="Résultats des dessins"
          tabIndex={0}
        >
          <div className="pictogram-options">{results.map(option)}</div>
        </div>
      ) : (
        <p>Aucun dessin trouvé. Essayez un autre mot ou une autre catégorie.</p>
      )}
    </fieldset>
  );
}
