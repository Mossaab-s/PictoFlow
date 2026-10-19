"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useAuthentication } from "./authentication";
import { isAdministrator } from "@/lib/access";

export default function AdminNavigation() {
  const session = useAuthentication();
  const path = usePathname();
  const [expanded, setExpanded] = useState(false);
  const audit =
    path === "/admin/audit" ||
    /^\/admin\/profiles\/[^/]+\/(audit|ai-quality)$/.test(path);
  const maintenance =
    path === "/admin/maintenance" || path === "/admin/restore-profile";
  const destinations: [string, string, boolean][] = [
    ["/admin", "Vue d’ensemble", path === "/admin"],
    [
      "/admin/profiles",
      "Profils",
      path.startsWith("/admin/profiles") && !audit,
    ],
    ["/admin/providers", "Fournisseur IA", path === "/admin/providers"],
    ["/admin/audit", "Audit et diagnostics", audit],
    ["/admin/maintenance", "Sauvegarde et maintenance", maintenance],
  ];
  if (session?.enabled)
    destinations.splice(2, 0, [
      "/admin/access",
      "Comptes et accès",
      path === "/admin/access",
    ]);
  if (!isAdministrator(session)) return null;
  return (
    <>
      <button
        className="secondary admin-menu-toggle"
        aria-label="Navigation administrateur"
        aria-expanded={expanded}
        aria-controls="admin-navigation"
        onClick={() => setExpanded(!expanded)}
      >
        Navigation :{" "}
        {destinations.find(([, , active]) => active)?.[1] ?? "Console"}
      </button>
      <nav
        id="admin-navigation"
        aria-label="Navigation principale"
        data-expanded={expanded}
      >
        <div className="admin-nav-group">
          {destinations.map(([href, label, active]) => (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
        </div>
        <div className="admin-nav-group admin-other-spaces">
          <p>Ouvrir un autre espace</p>
          <Link href="/accompagnement">Espace d’accompagnement</Link>
          <Link href="/communication">Espace de communication</Link>
        </div>
      </nav>
    </>
  );
}
