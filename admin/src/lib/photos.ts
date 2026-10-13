import type { Representation } from "./keyboard";

export const photoSource = "personal-photo";
export const maxPhotoBytes = 5 * 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function photoUrl(visual?: Representation): string | undefined {
  if (
    !visual ||
    visual.source !== photoSource ||
    visual.type !== "photo" ||
    !["proposed", "validated"].includes(visual.status) ||
    !uuid.test(visual.id) ||
    !uuid.test(visual.profile_id) ||
    visual.asset_reference !== `photo:${visual.id}`
  )
    return undefined;
  return `/api/pictoflow/profiles/${visual.profile_id}/representations/${visual.id}/photo`;
}

export function photoFileError(file: Pick<File, "type" | "size">): string {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    return "Choisissez une photo JPEG, PNG ou WebP.";
  if (!file.size || file.size > maxPhotoBytes)
    return "La photo doit peser au maximum 5 Mo.";
  return "";
}

export async function photoBase64(file: File): Promise<string> {
  const error = photoFileError(file);
  if (error) throw new Error(error);
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 16384)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
  return btoa(binary);
}
