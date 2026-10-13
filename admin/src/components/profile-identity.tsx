"use client";
import { useEffect, useState } from "react";
import { api, type Profile } from "@/lib/api";
import { profileTitle } from "@/lib/profiles";

export default function ProfileIdentity({ profileId }: { profileId: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    const request = new AbortController();
    void api<Profile>(`profiles/${profileId}`, { signal: request.signal })
      .then((value) => {
        if (!request.signal.aborted && value.id === profileId)
          setProfile(value);
      })
      .catch(() => {
        // The identifier remains visible when the optional name cannot be read.
      });
    return () => request.abort();
  }, [profileId]);
  return (
    <span className="profile-identity" title={`Identifiant : ${profileId}`}>
      {profileTitle(profile?.id === profileId ? profile : { id: profileId })}
    </span>
  );
}
