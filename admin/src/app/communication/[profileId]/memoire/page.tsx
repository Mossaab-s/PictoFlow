import { notFound } from "next/navigation";
import ProfileMemory from "@/components/profile-memory";
export default async function Page({
  params,
}: {
  params: Promise<{ profileId: string }>;
}) {
  const { profileId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(profileId)) notFound();
  return (
    <main>
      <ProfileMemory key={profileId} profileId={profileId} />
    </main>
  );
}
