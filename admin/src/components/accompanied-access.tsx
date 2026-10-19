"use client";
import { canProfile } from "@/lib/access";
import { useAuthentication, useAccompaniedAccess } from "./authentication";

export default function AccompaniedAccess({
  profileId,
}: {
  profileId: string;
}) {
  const session = useAuthentication();
  const actions = useAccompaniedAccess();
  if (
    !session?.enabled ||
    session.account?.assisted_profile_id ||
    !canProfile(session, profileId, "communicate")
  )
    return null;
  return (
    <details className="panel accompanied-access">
      <summary>Confier le clavier à cette personne</summary>
      <p>
        Son clavier sera le seul espace accessible dans tous les onglets de ce
        navigateur. Pour retrouver les outils d’adulte, il faudra se
        reconnecter.
      </p>
      <p>
        Cette session nécessite une connexion et dure au maximum une heure. Les
        copies hors connexion et les références de message locales seront
        effacées. Les messages enregistrés dans PictoFlow sont conservés.
      </p>
      <button
        disabled={actions.busy}
        onClick={() => void actions.start(profileId)}
      >
        {actions.busy
          ? "Préparation du clavier…"
          : "Démarrer la session accompagnée"}
      </button>
    </details>
  );
}
