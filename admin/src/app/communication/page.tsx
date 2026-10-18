import type { Metadata } from "next";
import SpaceProfiles from "@/components/space-profiles";
export const metadata: Metadata = { title: "PictoFlow · Mon clavier" };
export default function Page() {
  return (
    <main>
      <SpaceProfiles mode="communication" />
    </main>
  );
}
