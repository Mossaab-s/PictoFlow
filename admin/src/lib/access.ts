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
      /^\/(?:communication|admin\/profiles|accompagnement\/personnes)\/([0-9a-f-]{36})(?:\/|$)/i,
    )?.[1] ?? null
  );
}

export const supportSections = {
  "a-verifier": {
    section: "review",
    title: "Phrases à vérifier",
    capabilities: ["review_meanings"],
  },
  clavier: {
    section: "keyboard",
    title: "Clavier",
    capabilities: ["prepare_keyboard"],
  },
  phrases: {
    section: "memory",
    title: "Phrases et mémoire",
    capabilities: [
      "communicate",
      "prepare_keyboard",
      "review_meanings",
      "view_history",
    ],
  },
  vocabulaire: {
    section: "concepts",
    title: "Vocabulaire personnel",
    capabilities: ["manage_meanings"],
  },
  dessins: {
    section: "representations",
    title: "Dessins et photos",
    capabilities: ["prepare_keyboard", "manage_meanings"],
  },
  liens: {
    section: "semantic-space",
    title: "Liens entre les mots",
    capabilities: ["manage_meanings", "view_history"],
  },
  propositions: {
    section: "suggestions",
    title: "Besoins de vocabulaire",
    capabilities: ["prepare_keyboard", "manage_meanings"],
  },
  historique: {
    section: "audit",
    title: "Historique",
    capabilities: ["view_history"],
  },
  sauvegarde: {
    section: "backup",
    title: "Sauvegarde",
    capabilities: ["export_profile"],
  },
} as const;

export function canSupport(
  session: AuthSession | null,
  profileId: string,
): boolean {
  if (isAdministrator(session)) return true;
  const values = session?.account
    ? profileCapabilities(session.account, profileId)
    : [];
  return (
    values.some((value) =>
      [
        "prepare_keyboard",
        "manage_meanings",
        "view_history",
        "export_profile",
      ].includes(value),
    ) ||
    (values.includes("review_meanings") && !values.includes("communicate"))
  );
}

export function assignedProfiles(
  session: AuthSession,
  mode: "communication" | "support",
): string[] {
  if (!session.account) return [];
  const ids = Object.keys(
    session.account.profile_capabilities ?? session.account.profile_access,
  );
  return ids.filter(
    (id) =>
      /^[0-9a-f-]{36}$/i.test(id) &&
      (mode === "communication"
        ? canProfile(session, id, "communicate")
        : canSupport(session, id)),
  );
}

export function landingPath(session: AuthSession): string {
  if (isAdministrator(session)) return "/admin";
  if (assignedProfiles(session, "support").length) return "/accompagnement";
  const ids = assignedProfiles(session, "communication");
  return ids.length === 1 ? `/communication/${ids[0]}` : "/communication";
}

export function profileToolPath(
  session: AuthSession | null,
  profileId: string,
  section: string,
): string {
  if (section === "communication") return `/communication/${profileId}`;
  if (isAdministrator(session))
    return `/admin/profiles/${profileId}/${section}`;
  if (section === "memory" && !canSupport(session, profileId))
    return `/communication/${profileId}/memoire`;
  const slug = Object.entries(supportSections).find(
    ([, value]) => value.section === section,
  )?.[0];
  return slug ? `/accompagnement/personnes/${profileId}/${slug}` : "/";
}

// Only known internal paths are constructed here. Query strings never choose a destination.
export function entryRedirect(
  session: AuthSession,
  path: string,
): string | null {
  if (path === "/") return landingPath(session);
  if (path === "/communication" && !isAdministrator(session)) {
    const ids = assignedProfiles(session, "communication");
    if (ids.length === 1) return `/communication/${ids[0]}`;
  }
  if (["/admin", "/admin/profiles"].includes(path) && !isAdministrator(session))
    return landingPath(session);
  const match = path.match(/^\/admin\/profiles\/([0-9a-f-]{36})\/([^/]+)$/i);
  if (!match || (isAdministrator(session) && match[2] !== "communication"))
    return null;
  const target = profileToolPath(session, match[1], match[2]);
  return target !== "/" && pathPermitted(session, target) ? target : null;
}

export function pathPermitted(session: AuthSession, path: string): boolean {
  if (!session.enabled || session.account?.is_admin) return true;
  const account = session.account;
  if (!account) return false;
  if (["/", "/communication", "/accompagnement"].includes(path)) return true;
  const profile = profileInPath(path);
  if (!profile) return false;
  const capabilities = profileCapabilities(account, profile);
  if (path === `/communication/${profile}`)
    return capabilities.includes("communicate");
  if (path === `/communication/${profile}/memoire`)
    return capabilities.includes("communicate");
  if (!canSupport(session, profile)) return false;
  const root = `/accompagnement/personnes/${profile}`;
  if (path === root) return true;
  const slug = path.startsWith(root + "/") ? path.slice(root.length + 1) : "";
  const tool = Object.hasOwn(supportSections, slug)
    ? supportSections[slug as keyof typeof supportSections]
    : null;
  return (
    !!tool && tool.capabilities.some((value) => capabilities.includes(value))
  );
}
