"use client";
import Link from "next/link";
import { useAuthentication } from "@/components/authentication";
import AdminServiceStatus from "@/components/admin-service-status";
export default function Page() {
  const session = useAuthentication();
  return (
    <section className="page">
      <div className="eyebrow">ADMINISTRATION</div>
      <h1>Piloter PictoFlow</h1>
      <p>
        Gérez les comptes et les profils, puis ouvrez l’espace adapté à votre
        activité.
      </p>
      <div className="space-cards">
        <Link className="panel space-card" href="/admin/profiles">
          <h2>Profils</h2>
          <p>Créer, attribuer et inspecter les espaces personnels.</p>
        </Link>
        {session?.enabled && (
          <Link className="panel space-card" href="/admin/access">
            <h2>Comptes et accès</h2>
            <p>Choisir les autorisations de chaque personne.</p>
          </Link>
        )}
        <Link className="panel space-card" href="/admin/providers">
          <h2>État de l’IA</h2>
          <p>
            Consulter la disponibilité du fournisseur configuré sur le serveur.
          </p>
        </Link>
        <Link className="panel space-card" href="/admin/audit">
          <h2>Audit et diagnostics</h2>
          <p>
            Inspecter les traces PCL et la qualité des propositions pour un
            profil.
          </p>
        </Link>
        <Link className="panel space-card" href="/admin/maintenance">
          <h2>Sauvegarde et maintenance</h2>
          <p>
            Retrouver les exports, la restauration de profils et les procédures
            serveur.
          </p>
        </Link>
      </div>
      <AdminServiceStatus />
      <h2>Ouvrir un autre espace</h2>
      <p>Préparer les outils d’une personne ou communiquer avec son clavier.</p>
      <div className="space-cards">
        <Link className="panel space-card" href="/accompagnement">
          <h2>Accompagnement</h2>
          <p>Préparer un clavier et consulter les évolutions personnelles.</p>
        </Link>
        <Link className="panel space-card" href="/communication">
          <h2>Communication</h2>
          <p>Ouvrir un clavier personnel.</p>
        </Link>
      </div>
    </section>
  );
}
