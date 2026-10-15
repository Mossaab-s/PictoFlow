import type { HumanRole, Representation } from "./keyboard";

export type SuggestionMode = "off" | "words" | "phrases";
export type MemoryReference = {
  interpretation_id: string;
  revision: string;
  index: number | null;
};
export type SuggestedPhrase = { reference: MemoryReference; text: string };
export type SuggestedWord = SuggestedPhrase & {
  source_text: string;
  representation: Representation | null;
};
export type MemorySuggestionPage = {
  profile_id: string;
  mode: "words" | "phrases";
  words: SuggestedWord[];
  phrases: SuggestedPhrase[];
  total: number;
  offset: number;
  limit: number;
};
export type MemoryProposalBody = {
  request_id: string;
  references: MemoryReference[];
  actor_role: HumanRole;
};

export function suggestionMode(value: string | null): SuggestionMode {
  return value === "words" || value === "phrases" ? value : "off";
}

export function suggestionKey(profileId: string) {
  return `pictoflow:memory-suggestions:${profileId}`;
}

export function joinMemoryWords(words: { text: string }[]) {
  return words
    .map((word) => word.text)
    .join(" ")
    .replace(/(['’]) /g, "$1");
}

export function wordKey(text: string) {
  return text.normalize("NFC").toLocaleLowerCase("fr").replaceAll("’", "'");
}
