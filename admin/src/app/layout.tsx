import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PictoFlow · Administration",
  description: "Espace de communication personnel",
};

export default function Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
