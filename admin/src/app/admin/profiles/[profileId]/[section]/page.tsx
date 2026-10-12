import { notFound } from "next/navigation";
import { sections, Section } from "@/lib/api";
import ProfileSection from "@/components/profile-section";

export default async function Page({
  params,
}: {
  params: Promise<{ profileId: string; section: string }>;
}) {
  const { profileId, section } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(profileId) || !Object.hasOwn(sections, section))
    notFound();
  return <ProfileSection profileId={profileId} section={section as Section} />;
}
