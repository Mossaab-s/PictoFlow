export const pictogramCategories = {
  needs: "Besoins quotidiens",
  people: "Personnes",
  activities: "Activités et objets",
  answers: "Réponses et demandes",
  feelings: "Émotions",
  places: "Lieux et déplacements",
  nature: "Animaux et nature",
} as const;
export type PictogramCategory = keyof typeof pictogramCategories;
type CatalogEntry = {
  key: string;
  label: string;
  category: PictogramCategory;
  keywords: string;
};
export const pictograms = [
  {
    key: "toilets",
    label: "Toilettes",
    category: "needs",
    keywords: "wc toilette",
  },
  {
    key: "toy",
    label: "Jouet",
    category: "activities",
    keywords: "ours peluche jouer",
  },
  {
    key: "book",
    label: "Livre",
    category: "activities",
    keywords: "lire lecture histoire",
  },
  {
    key: "mother",
    label: "Maman",
    category: "people",
    keywords: "mère famille",
  },
  {
    key: "father",
    label: "Papa",
    category: "people",
    keywords: "père famille",
  },
  {
    key: "stop",
    label: "Stop",
    category: "answers",
    keywords: "arrêter attendre",
  },
  {
    key: "yes",
    label: "Oui",
    category: "answers",
    keywords: "accord accepter",
  },
  { key: "no", label: "Non", category: "answers", keywords: "refuser" },
  { key: "love", label: "Aimer", category: "feelings", keywords: "amour cœur" },
  {
    key: "car",
    label: "Voiture",
    category: "places",
    keywords: "auto transport",
  },
  { key: "cat", label: "Chat", category: "nature", keywords: "animal" },
  {
    key: "sun",
    label: "Soleil",
    category: "nature",
    keywords: "météo beau temps",
  },
  { key: "drink", label: "Boire", category: "needs", keywords: "soif verre" },
  {
    key: "sleep",
    label: "Dormir",
    category: "needs",
    keywords: "sommeil nuit repos fatigue",
  },
  {
    key: "phone",
    label: "Téléphone",
    category: "activities",
    keywords: "portable mobile appeler",
  },
  {
    key: "eat",
    label: "Manger",
    category: "needs",
    keywords: "faim repas assiette",
  },
  { key: "water", label: "Eau", category: "needs", keywords: "boisson goutte" },
  {
    key: "help",
    label: "Aide",
    category: "answers",
    keywords: "aider secours",
  },
  {
    key: "home",
    label: "Maison",
    category: "places",
    keywords: "chez moi domicile",
  },
  {
    key: "school",
    label: "École",
    category: "places",
    keywords: "classe apprendre",
  },
  {
    key: "outside",
    label: "Dehors",
    category: "places",
    keywords: "sortir jardin extérieur",
  },
  {
    key: "walk",
    label: "Marcher",
    category: "activities",
    keywords: "promenade balade",
  },
  { key: "dog", label: "Chien", category: "nature", keywords: "animal" },
  {
    key: "music",
    label: "Musique",
    category: "activities",
    keywords: "chanson écouter chanter",
  },
  {
    key: "happy",
    label: "Content",
    category: "feelings",
    keywords: "heureux joie sourire",
  },
  {
    key: "sad",
    label: "Triste",
    category: "feelings",
    keywords: "pleurer chagrin",
  },
  { key: "pain", label: "Mal", category: "needs", keywords: "douleur bobo" },
  {
    key: "shower",
    label: "Douche",
    category: "needs",
    keywords: "laver toilette bain",
  },
] as const satisfies readonly CatalogEntry[];
export type PictogramKey = (typeof pictograms)[number]["key"];
export const pictogramSource = "pictoflow-builtin-v1";
export function pictogramReference(key: PictogramKey) {
  return `pictoflow:pictogram:v1:${key}`;
}
export function pictogramFromReference(reference: string | null | undefined) {
  return pictograms.find((item) => pictogramReference(item.key) === reference);
}

function searchable(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replaceAll("œ", "oe");
}

export function searchPictograms(
  query: string,
  category: PictogramCategory | "all" = "all",
) {
  const terms = searchable(query).trim().split(/\s+/).filter(Boolean);
  return pictograms.filter(
    (item) =>
      (category === "all" || item.category === category) &&
      terms.every((term) =>
        searchable(`${item.label} ${item.keywords}`).includes(term),
      ),
  );
}
