import Link from "next/link";

const docs = "https://github.com/Mossaab-s/PictoFlow/blob/main/docs/";
export default function Maintenance() {
  return (
    <>
      <header className="topbar">
        Administration / Sauvegarde et maintenance
      </header>
      <section className="page admin-maintenance-page">
        <div className="eyebrow">EXPLOITATION</div>
        <h1>Sauvegarde et maintenance</h1>
        <h2>Actions disponibles dans l’interface</h2>
        <div className="space-cards">
          <article className="panel">
            <h3>Exporter un profil</h3>
            <p>
              Ouvrez le profil, puis sa rubrique Sauvegarde pour exporter sa
              mémoire personnelle. Cet export ne constitue pas une sauvegarde
              complète du serveur.
            </p>
            <Link className="button-link" href="/admin/profiles">
              Choisir un profil à sauvegarder
            </Link>
          </article>
          <article className="panel">
            <h3>Restaurer un export de profil</h3>
            <p>
              Vérifiez un fichier d’export, puis confirmez la création d’un
              nouveau profil dans l’outil de restauration.
            </p>
            <Link className="button-link" href="/admin/restore-profile">
              Ouvrir la restauration de profil
            </Link>
          </article>
        </div>
        <h2>Opérations à effectuer sur le serveur</h2>
        <p>
          Ces liens ouvrent les procédures publiques sur GitHub. Les opérations
          demandent un accès opérateur au serveur.
        </p>
        <div className="space-cards">
          <article className="panel">
            <h3>Sauvegarde complète et récupération</h3>
            <p>
              PostgreSQL, comptes, photos et configuration privée relèvent de la
              procédure de sauvegarde chiffrée. La date et la réussite de la
              dernière sauvegarde serveur ne sont pas connues de cette console.
            </p>
            <a href={docs + "SERVER_BACKUPS.md"}>
              Lire la procédure de sauvegarde serveur
            </a>
          </article>
          <article className="panel">
            <h3>Livraison et services</h3>
            <p>
              La mise à jour, les migrations et le redémarrage des services se
              font avec la procédure de déploiement.
            </p>
            <a href={docs + "SERVER_DEPLOYMENT.md"}>
              Lire la procédure de déploiement
            </a>
          </article>
          <article className="panel">
            <h3>HTTPS local</h3>
            <p>
              Les certificats et leur installation sur les appareils se gèrent
              avec la procédure HTTPS locale.
            </p>
            <a href={docs + "LOCAL_HTTPS.md"}>Lire la procédure HTTPS</a>
          </article>
        </div>
        <p>
          <Link href="/admin">Consulter l’état déclaré des services</Link>
        </p>
      </section>
    </>
  );
}
