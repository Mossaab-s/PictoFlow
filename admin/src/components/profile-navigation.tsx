"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { sections, type Section } from "@/lib/api";
import type { HumanRole } from "@/lib/keyboard";
import ProfileIdentity from "./profile-identity";
import { useAuthentication } from "./authentication";
import { pathPermitted, profileToolPath, supportSections } from "@/lib/access";

export function ProfileNavigation({
  profileId,
  section,
}: {
  profileId: string;
  section?: Section | "review";
}) {
  const session = useAuthentication();
  const path = usePathname();
  if (path.startsWith("/communication/"))
    return (
      <header className="topbar">
        <Link href={`/communication/${profileId}`}>Revenir à mon clavier</Link>
        <ProfileIdentity profileId={profileId} />
      </header>
    );
  if (path.startsWith("/accompagnement"))
    return (
      <>
        <header className="topbar">
          <Link href="/accompagnement">Personnes accompagnées</Link>
          <ProfileIdentity profileId={profileId} />
        </header>
        <nav
          className="tabs profile-tabs"
          aria-label="Activités de la personne"
        >
          <Link
            href={`/accompagnement/personnes/${profileId}`}
            aria-current={!section ? "page" : undefined}
          >
            Vue d’ensemble
          </Link>
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
                key={slug}
                href={`/accompagnement/personnes/${profileId}/${slug}`}
                aria-current={tool.section === section ? "page" : undefined}
              >
                {tool.title}
              </Link>
            ))}
        </nav>
      </>
    );
  return (
    <>
      <header className="topbar">
        <Link href="/admin/profiles">Profils</Link>
        <ProfileIdentity profileId={profileId} />
      </header>
      <nav className="tabs profile-tabs" aria-label="Sections du profil">
        {Object.entries(sections)
          .filter(
            ([value]) =>
              !!session &&
              pathPermitted(session, `/admin/profiles/${profileId}/${value}`),
          )
          .map(([value, title]) => (
            <Link
              key={value}
              aria-current={value === section ? "page" : undefined}
              href={profileToolPath(session, profileId, value)}
            >
              {title}
            </Link>
          ))}
      </nav>
    </>
  );
}

export function HumanRoleSelector({
  value,
  onChange,
  disabled,
  label = "Je valide en tant que",
}: {
  value: HumanRole;
  onChange: (value: HumanRole) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <label className="role-selector">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as HumanRole)}
        disabled={disabled}
      >
        <option value="user">Personne utilisatrice</option>
        <option value="caregiver">Aidant ou proche</option>
        <option value="professional">Professionnel</option>
      </select>
    </label>
  );
}
