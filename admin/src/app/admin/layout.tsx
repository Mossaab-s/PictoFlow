import Link from "next/link";
import type { Metadata } from "next";
import AdminNavigation from "@/components/admin-navigation";
export const metadata: Metadata = { title: "PictoFlow · Administration" };

export default function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="app-shell">
      <a className="admin-skip-link" href="#admin-content">
        Aller au contenu de la console
      </a>
      <aside>
        <Link href="/admin" className="brand">
          <span className="brand-mark">P</span>PictoFlow
        </Link>
        <div className="sidebar-caption">ADMINISTRATION</div>
        <AdminNavigation />
        <div className="sidebar-note">
          Le sens appartient à la personne.
          <br />
          Chaque évolution passe par une validation.
        </div>
        <div className="dev-label">Prototype local · V1</div>
      </aside>
      <main id="admin-content" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
