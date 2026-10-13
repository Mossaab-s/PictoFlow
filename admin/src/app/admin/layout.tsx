import Link from "next/link";

export default function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="app-shell">
      <aside>
        <Link href="/admin/profiles" className="brand">
          <span className="brand-mark">P</span>PictoFlow
        </Link>
        <div className="sidebar-caption">ESPACE DE TRAVAIL</div>
        <nav aria-label="Navigation principale">
          <Link href="/admin/profiles">◌ Profils</Link>
          <Link href="/admin/providers">↗ Providers IA</Link>
        </nav>
        <div className="sidebar-note">
          Le sens appartient à la personne.
          <br />
          Chaque évolution passe par une validation.
        </div>
        <div className="dev-label">Prototype local · V1</div>
      </aside>
      <main>{children}</main>
    </div>
  );
}
