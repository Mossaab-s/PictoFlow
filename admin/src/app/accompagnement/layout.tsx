import type { Metadata } from "next";
import Link from "next/link";
import SupportNavigation from "@/components/support-navigation";
export const metadata: Metadata = { title: "PictoFlow · Accompagnement" };
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="support-shell">
      <header className="support-header">
        <Link className="brand" href="/accompagnement">
          <span className="brand-mark">P</span>PictoFlow{" "}
          <small>Accompagnement</small>
        </Link>
        <SupportNavigation />
      </header>
      <main>{children}</main>
    </div>
  );
}
