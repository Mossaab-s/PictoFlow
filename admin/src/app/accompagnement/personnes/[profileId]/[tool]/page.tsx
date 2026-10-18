import { notFound } from "next/navigation";
import { supportSections } from "@/lib/access";
import KeyboardEditor from "@/components/keyboard-editor";
import ProfileMemory from "@/components/profile-memory";
import ProfileBackup from "@/components/profile-backup";
import ProfileSection from "@/components/profile-section";
import PhraseReview from "@/components/phrase-review";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ profileId: string; tool: string }>;
  searchParams: Promise<{ resume?: string | string[] }>;
}) {
  const { profileId, tool } = await params;
  if (
    !/^[0-9a-f-]{36}$/i.test(profileId) ||
    !Object.hasOwn(supportSections, tool)
  )
    notFound();
  const section = supportSections[tool as keyof typeof supportSections].section;
  if (section === "review")
    return <PhraseReview key={profileId} profileId={profileId} />;
  if (section === "keyboard")
    return (
      <KeyboardEditor
        key={profileId}
        profileId={profileId}
        resume={(await searchParams).resume === "1"}
      />
    );
  if (section === "memory")
    return <ProfileMemory key={profileId} profileId={profileId} />;
  if (section === "backup")
    return <ProfileBackup key={profileId} profileId={profileId} />;
  return (
    <ProfileSection
      key={`${profileId}:${section}`}
      profileId={profileId}
      section={section}
      support
    />
  );
}
