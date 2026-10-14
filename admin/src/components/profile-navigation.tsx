import Link from "next/link";
import { sections, type Section } from "@/lib/api";
import type { HumanRole } from "@/lib/keyboard";
import ProfileIdentity from "./profile-identity";

export function ProfileNavigation({
  profileId,
  section,
}: {
  profileId: string;
  section: Section;
}) {
  return (
    <>
      <header className="topbar">
        <Link href="/admin/profiles">Profils</Link>
        <ProfileIdentity profileId={profileId} />
      </header>
      <nav className="tabs profile-tabs" aria-label="Sections du profil">
        {Object.entries(sections).map(([value, title]) => (
          <Link
            key={value}
            aria-current={value === section ? "page" : undefined}
            href={`/admin/profiles/${profileId}/${value}`}
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
