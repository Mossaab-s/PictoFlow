import type { Metadata } from "next";
import { notFound } from "next/navigation";
import CommunicationScreen from "@/components/communication-screen";

export const metadata: Metadata = { title: "PictoFlow · Je communique" };

export default async function Page({
  params,
}: {
  params: Promise<{ profileId: string }>;
}) {
  const { profileId } = await params;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      profileId,
    )
  )
    notFound();
  return (
    <main>
      <CommunicationScreen key={profileId} profileId={profileId} standalone />
    </main>
  );
}
