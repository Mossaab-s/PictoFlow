import { notFound } from "next/navigation";
import { sections, Section } from "@/lib/api";
import ProfileSection from "@/components/profile-section";
import KeyboardEditor from "@/components/keyboard-editor";
import CommunicationScreen from "@/components/communication-screen";
import ProfileBackup from "@/components/profile-backup";
import ProfileMemory from "@/components/profile-memory";

export default async function Page({
  params,
}: {
  params: Promise<{ profileId: string; section: string }>;
}) {
  const { profileId, section } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(profileId) || !Object.hasOwn(sections, section))
    notFound();
  if (section === "keyboard")
    return <KeyboardEditor key={profileId} profileId={profileId} />;
  if (section === "communication")
    return <CommunicationScreen key={profileId} profileId={profileId} />;
  if (section === "backup")
    return <ProfileBackup key={profileId} profileId={profileId} />;
  if (section === "memory")
    return <ProfileMemory key={profileId} profileId={profileId} />;
  return (
    <ProfileSection
      profileId={profileId}
      section={section as Exclude<Section, "memory">}
    />
  );
}
