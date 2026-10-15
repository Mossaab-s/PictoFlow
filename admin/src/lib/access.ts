export type ProfileRole = "communicator" | "editor";
export type Account = {
  id: string;
  username: string;
  display_name: string;
  is_admin: boolean;
  active: boolean;
  profile_access: Record<string, ProfileRole>;
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
  return (
    !!session &&
    (!session.enabled ||
      !!session.account?.is_admin ||
      session.account?.profile_access[profileId] === "editor")
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
  const role = account.profile_access[profile];
  if (role === "editor") return true;
  return (
    role === "communicator" &&
    (path === `/communication/${profile}` ||
      path === `/admin/profiles/${profile}/communication` ||
      path === `/admin/profiles/${profile}/memory`)
  );
}
