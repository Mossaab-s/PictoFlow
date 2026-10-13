export const pictograms = [
  { key: "toilets", label: "Toilettes" },
  { key: "toy", label: "Jouet" },
  { key: "book", label: "Livre" },
  { key: "mother", label: "Maman" },
  { key: "father", label: "Papa" },
  { key: "stop", label: "Stop" },
  { key: "yes", label: "Oui" },
  { key: "no", label: "Non" },
  { key: "love", label: "Aimer" },
  { key: "car", label: "Voiture" },
  { key: "cat", label: "Chat" },
  { key: "sun", label: "Soleil" },
  { key: "drink", label: "Boire" },
  { key: "sleep", label: "Dormir" },
] as const;
export type PictogramKey = (typeof pictograms)[number]["key"];
export const pictogramSource = "pictoflow-builtin-v1";
export function pictogramReference(key: PictogramKey) {
  return `pictoflow:pictogram:v1:${key}`;
}
export function pictogramFromReference(reference: string | null | undefined) {
  return pictograms.find((item) => pictogramReference(item.key) === reference);
}
