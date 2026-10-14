import type { Metadata } from "next";
import { notFound } from "next/navigation";
import CommunicationScreen from "@/components/communication-screen";
import { phraseId } from "@/lib/phrases";

export const metadata: Metadata = { title: "PictoFlow · Je communique" };

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ profileId: string }>;
  searchParams: Promise<{ phrase?: string | string[] }>;
}) {
  const { profileId } = await params;
  const initialPhraseId = phraseId((await searchParams).phrase);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      profileId,
    )
  )
    notFound();
  return (
    <main>
      <CommunicationScreen
        key={profileId}
        profileId={profileId}
        standalone
        initialPhraseId={initialPhraseId}
      />
    </main>
  );
}
