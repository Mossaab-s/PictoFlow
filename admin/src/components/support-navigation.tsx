"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { isAdministrator } from "@/lib/access";
import { useAuthentication } from "./authentication";
export default function SupportNavigation() {
  const path = usePathname();
  const session = useAuthentication();
  return (
    <nav aria-label="Navigation d’accompagnement">
      <Link
        href="/accompagnement"
        aria-current={path === "/accompagnement" ? "page" : undefined}
      >
        Personnes accompagnées
      </Link>
      <Link href="/communication">Mes claviers de communication</Link>
      {isAdministrator(session) && <Link href="/admin">Administration</Link>}
    </nav>
  );
}
