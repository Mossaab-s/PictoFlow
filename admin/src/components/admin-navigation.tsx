"use client";
import Link from "next/link";
import { useAuthentication } from "./authentication";
import { isAdministrator } from "@/lib/access";

export default function AdminNavigation() {
  const session = useAuthentication();
  return (
    <nav aria-label="Navigation principale">
      <Link href="/admin/profiles">◌ Profils</Link>
      {isAdministrator(session) && (
        <Link href="/admin/providers">↗ Providers IA</Link>
      )}
      {session?.enabled && session.account?.is_admin && (
        <Link href="/admin/access">Comptes et accès</Link>
      )}
    </nav>
  );
}
