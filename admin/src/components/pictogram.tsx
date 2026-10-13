import type { ReactNode } from "react";
import {
  pictogramFromReference,
  pictogramSource,
  type PictogramKey,
} from "@/lib/pictograms";
import type { Representation } from "@/lib/keyboard";
import { photoUrl } from "@/lib/photos";
import { PhotoImage } from "./photo-picker";

// Original bundled SVG drawings. No external image request or platform emoji font.
const drawings: Record<PictogramKey, ReactNode> = {
  toilets: (
    <>
      <rect x="22" y="14" width="45" height="40" rx="7" fill="#e2f2f5" />
      <path
        d="M30 25h16M22 54h77c0 25-17 35-37 35H36c-8-8-12-18-14-35Z"
        fill="#fff"
      />
      <path d="M48 89v17h40V91M36 54V38M95 54v-8" fill="#c2e7ed" />
    </>
  ),
  toy: (
    <>
      <circle cx="29" cy="26" r="16" fill="#c39162" />
      <circle cx="91" cy="26" r="16" fill="#c39162" />
      <ellipse cx="60" cy="79" rx="30" ry="29" fill="#d8a573" />
      <ellipse cx="28" cy="79" rx="14" ry="20" fill="#d8a573" />
      <ellipse cx="92" cy="79" rx="14" ry="20" fill="#d8a573" />
      <circle cx="60" cy="40" r="30" fill="#d8a573" />
      <ellipse cx="60" cy="49" rx="17" ry="12" fill="#ffe5be" />
      <circle cx="49" cy="34" r="3" fill="#283d38" stroke="none" />
      <circle cx="71" cy="34" r="3" fill="#283d38" stroke="none" />
      <path d="m54 45 6 5 6-5M60 50v6" />
      <ellipse cx="43" cy="104" rx="17" ry="10" fill="#c39162" />
      <ellipse cx="77" cy="104" rx="17" ry="10" fill="#c39162" />
    </>
  ),
  book: (
    <>
      <path
        d="M60 26C44 14 23 14 10 21v76c18-6 35-3 50 9 15-12 32-15 50-9V21c-13-7-34-7-50 5Z"
        fill="#e8f2ff"
      />
      <path
        d="M60 26v80M22 37c10-2 17 0 25 4M22 52c10-2 17 0 25 4M22 67c10-2 17 0 25 4M73 41c8-4 15-6 25-4M73 56c8-4 15-6 25-4M73 71c8-4 15-6 25-4"
        stroke="#4b7296"
      />
    </>
  ),
  mother: (
    <>
      <path d="M27 83V45c0-43 66-43 66 0v38Z" fill="#725445" />
      <path d="M17 108c3-38 83-38 86 0" fill="#f4a8b5" />
      <path d="M48 73v16c7 9 17 9 24 0V73" fill="#f4cfa8" />
      <path
        d="M32 44c16-1 21-14 22-24 10 19 22 19 34 23v13c0 40-56 40-56 0Z"
        fill="#f4cfa8"
      />
      <path d="M43 48h1M76 48h1M50 64q10 10 20 0" />
    </>
  ),
  father: (
    <>
      <path d="M17 108c3-38 83-38 86 0" fill="#86b8da" />
      <path d="M48 73v16c7 9 17 9 24 0V73" fill="#f4cfa8" />
      <path d="M31 34c0-24 58-24 58 0v23c0 40-58 40-58 0Z" fill="#f4cfa8" />
      <path
        d="M31 38V28c2-25 54-27 58 0v12c-17 0-23-8-27-16-7 10-20 14-31 14Z"
        fill="#725445"
      />
      <path d="M43 48h1M76 48h1M50 64q10 10 20 0" />
    </>
  ),
  stop: (
    <>
      <path
        d="M37 109 22 83 9 61c-5-10 7-15 13-7l13 17V25c0-13 15-13 15 0v29-38c0-13 15-13 15 0v38-31c0-13 15-13 15 0v35-22c0-13 15-13 15 0v43c0 15-6 24-16 30Z"
        fill="#f0ba91"
      />
      <path d="M50 75c13-7 27-3 31 8M39 109h41" />
    </>
  ),
  yes: (
    <>
      <circle cx="60" cy="60" r="46" fill="#57a87c" stroke="#2d6546" />
      <path d="m32 60 19 20 38-41" fill="none" stroke="#fff" strokeWidth="11" />
    </>
  ),
  no: (
    <>
      <circle cx="60" cy="60" r="46" fill="#e57c79" stroke="#9c4546" />
      <path d="m40 40 40 40M80 40 40 80" stroke="#fff" strokeWidth="11" />
    </>
  ),
  love: (
    <>
      <path
        d="M60 104 18 65C-8 36 27 1 60 31 93 1 128 36 102 65Z"
        fill="#e98198"
        stroke="#9b405d"
      />
      <path d="M27 33q9-9 19-2" stroke="#ffe1e8" strokeWidth="7" />
    </>
  ),
  car: (
    <>
      <path d="m22 52 13-28h49l15 28" fill="#b8dfe8" />
      <path
        d="M61 25v27M15 52h90c5 0 8 7 8 14v24H7V66c0-7 3-14 8-14Z"
        fill="#7bada5"
      />
      <circle cx="29" cy="88" r="14" fill="#4d5b59" />
      <circle cx="91" cy="88" r="14" fill="#4d5b59" />
      <path d="M16 65h11M93 65h11" stroke="#fff3b6" strokeWidth="7" />
    </>
  ),
  cat: (
    <>
      <path d="M22 53V15l28 19h20l28-19v38c21 51-97 65-76 0Z" fill="#e7b578" />
      <path d="m29 27 13 10M91 27 78 37" stroke="#c4826c" />
      <path d="M40 61h1M79 61h1" strokeWidth="8" />
      <path d="m53 73 7 5 7-5M60 78v8m0 0q-9 8-15 0m15 0q9 8 15 0M27 75 5 70M28 85 5 88M93 75l22-5M92 85l23 3" />
    </>
  ),
  sun: (
    <>
      <path
        d="M60 6v12M60 102v12M6 60h12M102 60h12M22 22l9 9M89 89l9 9M22 98l9-9M89 31l9-9"
        stroke="#b78424"
        strokeWidth="6"
      />
      <circle cx="60" cy="60" r="31" fill="#f5d25e" stroke="#b78424" />
    </>
  ),
  drink: (
    <>
      <path d="m32 33 7 73h42l7-73Z" fill="#e4f4fa" />
      <path d="m36 62 4 39h40l4-39Z" fill="#79c5e0" stroke="none" />
      <path d="m65 65 13-48 18-7M32 33h56" />
    </>
  ),
  sleep: (
    <>
      <path
        d="M76 13C11 1-6 98 63 107c20 2 33-6 43-20-51 4-63-41-30-74Z"
        fill="#85b1d4"
      />
      <path
        d="m93 14 4 10 11 1-9 7 2 11-8-6-9 6 2-11-9-7 11-1Z"
        fill="#f5d25e"
        stroke="#b78424"
        strokeWidth="3"
      />
      <path d="M43 60q6 7 12 0M66 79q8 6 15 0" />
    </>
  ),
  phone: (
    <>
      <rect x="32" y="8" width="56" height="104" rx="11" fill="#6f918a" />
      <rect x="39" y="23" width="42" height="65" rx="3" fill="#e2f2f5" />
      <path d="M52 16h16" stroke="#fff" />
      <circle cx="60" cy="100" r="5" fill="#fff" />
    </>
  ),
  eat: (
    <>
      <circle cx="60" cy="60" r="32" fill="#e2f2f5" />
      <circle cx="60" cy="60" r="22" stroke="#7bada5" />
      <path d="M13 14v24q0 13 8 13t8-13V14M21 14v91M105 105V14c-14 13-15 37 0 39" />
    </>
  ),
  water: (
    <>
      <path
        d="M60 10C48 31 22 56 22 76c0 45 76 45 76 0 0-20-26-45-38-66Z"
        fill="#79c5e0"
      />
      <path d="M38 74q-2 16 13 21" stroke="#e2f2f5" strokeWidth="7" />
    </>
  ),
  help: (
    <>
      <circle cx="60" cy="60" r="45" fill="#fff" />
      <circle
        cx="60"
        cy="60"
        r="31"
        stroke="#e57c79"
        strokeWidth="24"
        strokeDasharray="24 25"
        transform="rotate(-22 60 60)"
      />
      <circle cx="60" cy="60" r="18" fill="#e2f2f5" />
    </>
  ),
  home: (
    <>
      <path d="M24 53v54h72V53" fill="#ffe5be" />
      <path d="m10 55 50-42 50 42Z" fill="#e57c79" />
      <path d="M49 107V72h22v35" fill="#7bada5" />
      <rect x="31" y="67" width="12" height="14" fill="#e2f2f5" />
    </>
  ),
  school: (
    <>
      <path d="M14 48h92v60H14Z" fill="#ffe5be" />
      <path d="m9 48 51-31 51 31Z" fill="#86b8da" />
      <path d="M60 18V5h21v13Z" fill="#e57c79" />
      <path d="M49 108V76h22v32" fill="#7bada5" />
      <path
        d="M25 63h10M25 85h10M85 63h10M85 85h10"
        stroke="#4b7296"
        strokeWidth="8"
      />
    </>
  ),
  outside: (
    <>
      <path d="M20 107V14h54v93" fill="#ffe5be" />
      <path d="m28 23 27 7v66l-27 7Z" fill="#7bada5" />
      <path d="M64 60h43M95 47l13 13-13 13" stroke="#4b7296" strokeWidth="6" />
      <path d="M10 108h100" />
      <circle cx="47" cy="63" r="2" fill="#283d38" />
    </>
  ),
  walk: (
    <>
      <circle cx="67" cy="18" r="11" fill="#f4cfa8" />
      <path
        d="m60 35-8 34 22 16 9 25M53 68l-17 37M58 41 38 55l-15-5M62 41l17 19 17-2"
        stroke="#4b7296"
        strokeWidth="9"
      />
      <path d="M12 113h96" stroke="#7bada5" />
    </>
  ),
  dog: (
    <>
      <path
        d="M31 36c-24-21-28 30-12 44l21-21M89 36c24-21 28 30 12 44L80 59"
        fill="#725445"
      />
      <path d="M33 29c12-10 42-10 54 0l9 48c-1 38-71 38-72 0Z" fill="#d8a573" />
      <ellipse cx="60" cy="80" rx="25" ry="18" fill="#ffe5be" />
      <path d="M43 54h1M76 54h1" strokeWidth="7" />
      <path d="m51 74 9 7 9-7ZM60 81v9m0 0q-9 8-16 0m16 0q9 8 16 0" />
    </>
  ),
  music: (
    <>
      <path
        d="M43 89V26l55-14v63M43 43l55-14"
        stroke="#4b7296"
        strokeWidth="8"
      />
      <ellipse cx="28" cy="94" rx="17" ry="12" fill="#86b8da" />
      <ellipse cx="83" cy="80" rx="17" ry="12" fill="#86b8da" />
    </>
  ),
  happy: (
    <>
      <circle cx="60" cy="60" r="46" fill="#f5d25e" />
      <path d="M40 47h1M79 47h1" strokeWidth="8" />
      <path d="M34 70q26 34 52 0" strokeWidth="5" />
    </>
  ),
  sad: (
    <>
      <circle cx="60" cy="60" r="46" fill="#b8dfe8" />
      <path d="M40 47h1M79 47h1" strokeWidth="8" />
      <path d="M39 87q21-26 42 0" />
      <path d="M32 57c-16 20 16 20 0 0Z" fill="#79c5e0" stroke="#4b7296" />
    </>
  ),
  pain: (
    <>
      <path
        d="m15 48 33-33c7-7 17-7 24 0l33 33c7 7 7 17 0 24l-33 33c-7 7-17 7-24 0L15 72c-7-7-7-17 0-24Z"
        fill="#ffe5be"
      />
      <rect x="43" y="43" width="34" height="34" rx="5" fill="#e57c79" />
      <path d="M29 49v1M29 66v1M91 49v1M91 66v1" strokeWidth="5" />
    </>
  ),
  shower: (
    <>
      <path d="M21 107V29c0-22 44-24 46 0" stroke="#4b7296" strokeWidth="7" />
      <path d="M45 42c0-22 44-22 44 0Z" fill="#b8dfe8" />
      <path
        d="M49 56v7M67 56v7M85 56v7M49 80v7M67 80v7M85 80v7M49 104v7M67 104v7M85 104v7"
        stroke="#79c5e0"
        strokeWidth="5"
      />
    </>
  ),
};

export function Pictogram({ pictogramKey }: { pictogramKey: PictogramKey }) {
  return (
    <svg
      className="pictogram"
      viewBox="0 0 120 120"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="#283d38"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {drawings[pictogramKey]}
    </svg>
  );
}

export function TouchContent({
  label,
  representation,
}: {
  label: string;
  representation?: Representation;
}) {
  const drawing =
    representation?.source === pictogramSource &&
    representation.type === "pictogram"
      ? pictogramFromReference(representation.asset_reference)
      : undefined;
  const photo = photoUrl(representation);
  return (
    <>
      {photo ? (
        <PhotoImage key={photo} src={photo} />
      ) : drawing ? (
        <Pictogram pictogramKey={drawing.key} />
      ) : (
        <span className="pictogram-missing" aria-hidden="true">
          ?
        </span>
      )}
      <strong className="touch-word">{label}</strong>
    </>
  );
}
