"use client";
import { useEffect, useRef, useState } from "react";
import { photoFileError } from "@/lib/photos";

export function PhotoImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <span className="pictogram-missing" aria-hidden="true">
      ?
    </span>
  ) : (
    // Scoped media and local previews cannot use an external image optimization service.
    <img
      className="touch-photo"
      src={src}
      alt=""
      width={120}
      height={120}
      onError={() => setFailed(true)}
    />
  );
}

export function PhotoPreview({
  file,
  label,
}: {
  file: File | null;
  label?: string;
}) {
  const [preview, setPreview] = useState("");
  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return preview ? (
    <div className="touch-sample" aria-label="Aperçu de la photo choisie">
      <PhotoImage key={preview} src={preview} />
      {label && <strong className="touch-word">{label}</strong>}
    </div>
  ) : null;
}

export default function PhotoPicker({
  file,
  onChange,
  disabled = false,
  label,
}: {
  file: File | null;
  onChange: (file: File | null) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!file) {
      if (input.current) input.current.value = "";
    }
  }, [file]);
  return (
    <div className="photo-picker">
      <label>
        Choisir une photo personnelle
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={disabled}
          onChange={(event) => {
            const selected = event.target.files?.[0] ?? null;
            const message = selected ? photoFileError(selected) : "";
            setError(message);
            onChange(message ? null : selected);
            if (message) event.target.value = "";
          }}
        />
      </label>
      {file && <p className="helper">Photo choisie : {file.name}</p>}
      <p>
        JPEG, PNG ou WebP, jusqu’à 5 Mo. Choisissez une image fixe que vous êtes
        autorisé à utiliser.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <PhotoPreview file={file} label={label} />
    </div>
  );
}
