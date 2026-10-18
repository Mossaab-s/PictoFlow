export type ProfileRole = "communicator" | "editor";
export const capabilityLabels = {
  communicate: "Communiquer et lire les phrases",
  review_meanings: "Confirmer, corriger ou refuser les phrases",
  prepare_keyboard: "Préparer le clavier et les raccourcis",
  manage_meanings: "Gérer les sens et les propositions de vocabulaire",
  view_history: "Consulter l’historique du profil",
  export_profile: "Exporter une sauvegarde du profil",
} as const;
export type ProfileCapability = keyof typeof capabilityLabels;
export const capabilityPresets: Record<
  ProfileRole,
  readonly ProfileCapability[]
> = {
  communicator: ["communicate", "review_meanings"],
  editor: Object.keys(capabilityLabels) as ProfileCapability[],
};
export type Account = {
  id: string;
  username: string;
  display_name: string;
  is_admin: boolean;
  active: boolean;
  profile_access: Record<string, ProfileRole>;
  profile_capabilities?: Record<string, ProfileCapability[]>;
};
export type AuthSession = {
  enabled: boolean;
  account: Account | null;
  csrf_token: string | null;
};

export function canPrepare(
  session: AuthSession | null,
  profileId: string,
): boolean {
  return canProfile(session, profileId, "prepare_keyboard");
}

export function profileCapabilities(
  account: Account,
  profileId: string,
): readonly ProfileCapability[] {
  // Compatibility with older session payloads only. An explicit map is authoritative.
  if (account.profile_capabilities !== undefined)
    return account.profile_capabilities[profileId] ?? [];
  return capabilityPresets[account.profile_access[profileId]] ?? [];
}

export function canProfile(
  session: AuthSession | null,
  profileId: string,
  capability: ProfileCapability,
): boolean {
  return (
    !!session &&
    (!session.enabled ||
      !!session.account?.is_admin ||
      (!!session.account &&
        profileCapabilities(session.account, profileId).includes(capability)))
  );
}
export function isAdministrator(session: AuthSession | null): boolean {
  return !!session && (!session.enabled || !!session.account?.is_admin);
}

export function profileInPath(path: string): string | null {
  return (
    path.match(
      /^\/(?:communication|admin\/profiles)\/([0-9a-f-]{36})(?:\/|$)/i,
    )?.[1] ?? null
  );
}

export function pathPermitted(session: AuthSession, path: string): boolean {
  if (!session.enabled || session.account?.is_admin) return true;
  const account = session.account;
  if (!account) return false;
  if (["/", "/admin", "/admin/profiles"].includes(path)) return true;
  const profile = profileInPath(path);
  if (!profile) return false;
  const capabilities = profileCapabilities(account, profile);
  if (path === `/communication/${profile}`)
    return capabilities.includes("communicate");
  const section = path.slice(`/admin/profiles/${profile}/`.length);
  const sections: Record<string, readonly ProfileCapability[]> = {
    communication: ["communicate"],
    keyboard: ["prepare_keyboard"],
    memory: [
      "communicate",
      "prepare_keyboard",
      "review_meanings",
      "view_history",
    ],
    concepts: ["manage_meanings"],
    representations: ["prepare_keyboard", "manage_meanings"],
    "semantic-space": ["manage_meanings", "view_history"],
    suggestions: ["prepare_keyboard", "manage_meanings"],
    audit: ["view_history"],
    backup: ["export_profile"],
  };
  return (sections[section] ?? []).some((capability) =>
    capabilities.includes(capability),
  );
}
