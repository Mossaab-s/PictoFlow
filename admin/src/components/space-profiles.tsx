"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type Profile } from "@/lib/api";
import { canProfile, canSupport, isAdministrator } from "@/lib/access";
import { useAuthentication } from "./authentication";
export default function SpaceProfiles({
  mode,
}: {
  mode: "support" | "communication";
}) {
  const session = useAuthentication();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<Profile[]>("profiles", { signal: controller.signal })
      .then((values) => {
        if (!controller.signal.aborted) setProfiles(values);
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error ? error.message : "Chargement impossible.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [retry]);
  const visible = profiles.filter((profile) =>
    mode === "support"
      ? canSupport(session, profile.id)
      : canProfile(session, profile.id, "communicate"),
  );
  const otherSpace = profiles.some((profile) =>
    mode === "support"
      ? canProfile(session, profile.id, "communicate")
      : canSupport(session, profile.id),
  );
  return (
    <section className="page space-profiles">
      <div className="eyebrow">
        {mode === "support" ? "ACCOMPAGNEMENT" : "COMMUNICATION"}
      </div>
      <h1>
        {mode === "support"
          ? "Les personnes que j’accompagne"
          : "Choisir mon clavier"}
      </h1>
      <p>
        {mode === "support"
          ? "Retrouvez les personnes qui vous sont confiées et préparez leur communication."
          : "Choisissez votre prénom pour retrouver vos touches."}
      </p>
      {loading ? (
        <p role="status">Chargement…</p>
      ) : error ? (
        <div role="alert">
          <p>{error}</p>
          <button onClick={() => setRetry((value) => value + 1)}>
            Réessayer
          </button>
        </div>
      ) : (
        <>
          <div className="space-cards">
            {visible.map((profile, index) => (
              <Link
                className="panel space-card person-card"
                key={profile.id}
                href={
                  mode === "support"
                    ? `/accompagnement/personnes/${profile.id}`
                    : `/communication/${profile.id}`
                }
              >
                <span className="person-avatar" aria-hidden="true">
                  {profile.display_name
                    ?.trim()
                    .slice(0, 1)
                    .toLocaleUpperCase("fr") || "☺"}
                </span>
                <h2>
                  {profile.display_name || `Clavier personnel ${index + 1}`}
                </h2>
                <span>
                  {mode === "support"
                    ? "Accompagner cette personne"
                    : "Ouvrir mon clavier"}{" "}
                  →
                </span>
              </Link>
            ))}
          </div>
          {!visible.length && (
            <div className="empty">
              <h2>
                {mode === "support"
                  ? "Aucune personne attribuée à cet espace"
                  : "Aucun clavier attribué pour le moment"}
              </h2>
              <p>
                Une personne qui gère PictoFlow peut vous donner accès à un
                profil.
              </p>
            </div>
          )}
        </>
      )}
      {otherSpace && (
        <p>
          <Link
            className="button-link secondary"
            href={mode === "support" ? "/communication" : "/accompagnement"}
          >
            {mode === "support"
              ? "Mes claviers de communication"
              : "Mon espace d’accompagnement"}
          </Link>
        </p>
      )}
      {isAdministrator(session) && mode === "communication" && (
        <p>
          <Link href="/admin">Retour à l’administration</Link>
        </p>
      )}
    </section>
  );
}
