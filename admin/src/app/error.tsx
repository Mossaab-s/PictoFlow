"use client";
export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="page">
      <h1>Cette page est indisponible.</h1>
      <p>Vous pouvez réessayer de la charger.</p>
      <button onClick={reset}>Réessayer</button>
    </section>
  );
}
