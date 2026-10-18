import type { Metadata } from "next";
import "./globals.css";
import Authentication from "@/components/authentication";

export const metadata: Metadata = {
  title: "PictoFlow",
  description: "Espace de communication personnel",
};

export default function Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body>
        <Authentication>{children}</Authentication>
      </body>
    </html>
  );
}
