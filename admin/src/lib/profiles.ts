import type { Profile } from "./api";

export function profileTitle(profile: Pick<Profile, "id" | "display_name">) {
  return profile.display_name ?? `Profil sans nom · ${profile.id.slice(0, 8)}`;
}

function searchable(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("fr")
    .trim();
}

export function matchingProfiles(profiles: Profile[], query: string) {
  const needle = searchable(query);
  return profiles.filter((profile) =>
    searchable(`${profileTitle(profile)} ${profile.id}`).includes(needle),
  );
}
