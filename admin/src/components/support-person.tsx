"use client";
import Link from "next/link";
import {
  canProfile,
  pathPermitted,
  supportSections,
  type ProfileCapability,
} from "@/lib/access";
import { joinKeyboard } from "@/lib/keyboard";
import { useAuthentication } from "./authentication";
import { ProfileNavigation } from "./profile-navigation";
import ProfileIdentity from "./profile-identity";
import KeyboardPreparationPreview from "./keyboard-preparation-preview";
import { useProfileKeyboard } from "./use-profile-keyboard";
import MemoryEvolution from "./memory-evolution";
export default function SupportPerson({ profileId }: { profileId: string }) {
  const session = useAuthentication();
  const previewRights: ProfileCapability[] = [
    "prepare_keyboard",
    "manage_meanings",
    "view_history",
    "review_meanings",
  ];
  const canPreview = previewRights.some((capability) =>
    canProfile(session, profileId, capability),
  );
  return (
    <>
      <ProfileNavigation profileId={profileId} />
      <section className="page">
        <div className="eyebrow">ACCOMPAGNER CETTE PERSONNE</div>
        <h1>
          <ProfileIdentity profileId={profileId} />
        </h1>
        <p>
          Choisissez une activité. Chaque proposition attend une décision
          humaine avant d’entrer dans la mémoire validée.
        </p>
        {canPreview && <Preview profileId={profileId} />}
        <div className="space-cards">
          {Object.entries(supportSections)
            .filter(
              ([slug]) =>
                !!session &&
                pathPermitted(
                  session,
                  `/accompagnement/personnes/${profileId}/${slug}`,
                ),
            )
            .map(([slug, tool]) => (
              <Link
                className="panel space-card"
                href={`/accompagnement/personnes/${profileId}/${slug}`}
                key={slug}
              >
                <h2>{tool.title}</h2>
                <span>Ouvrir →</span>
              </Link>
            ))}
          {canProfile(session, profileId, "communicate") && (
            <Link
              className="panel space-card"
              href={`/communication/${profileId}`}
            >
              <h2>Ouvrir le clavier de communication</h2>
              <p>Composer et lire un message.</p>
            </Link>
          )}
        </div>
        {canProfile(session, profileId, "view_history") && (
          <MemoryEvolution key={profileId} profileId={profileId} compact />
        )}
      </section>
    </>
  );
}
function Preview({ profileId }: { profileId: string }) {
  const data = useProfileKeyboard(profileId);
  if (data.loading) return <p role="status">Chargement du clavier…</p>;
  if (data.error)
    return (
      <div role="alert">
        <p>{data.error}</p>
        <button onClick={() => void data.reload()}>Réessayer</button>
      </div>
    );
  return (
    <KeyboardPreparationPreview
      profileId={profileId}
      tiles={joinKeyboard(
        profileId,
        data.blocks,
        data.positions,
        data.representations,
      )}
      groups={data.groups}
    />
  );
}
