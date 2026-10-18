import { notFound } from "next/navigation";
import SupportPerson from "@/components/support-person";
export default async function Page({
  params,
}: {
  params: Promise<{ profileId: string }>;
}) {
  const { profileId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(profileId)) notFound();
  return <SupportPerson key={profileId} profileId={profileId} />;
}
