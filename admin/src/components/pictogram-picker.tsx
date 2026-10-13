"use client";
import { pictograms, type PictogramKey } from "@/lib/pictograms";
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
  return (
    <fieldset className="pictogram-picker" disabled={disabled}>
      <legend>Choisir le dessin</legend>
      <div className="pictogram-options">
        {pictograms.map((drawing) => (
          <label
            className={`pictogram-option${value === drawing.key ? " selected" : ""}`}
            key={drawing.key}
          >
            <input
              type="radio"
              name="pictogram"
              value={drawing.key}
              checked={value === drawing.key}
              onChange={() => onChange(drawing.key)}
              required
            />
            <Pictogram pictogramKey={drawing.key} />
            <span>{drawing.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
