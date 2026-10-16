import type { ReactNode } from "react";
import type { DailyPictogramKey } from "@/lib/daily-pictograms";

// Original, bundled vectors. One main object/action, no text, gradients or external assets.
// All drawings share the existing 120 x 120 frame, dark outline and soft colour palette.
function Person({
  children,
  shirt = "#86b8da",
}: {
  children?: ReactNode;
  shirt?: string;
}) {
  return (
    <>
      <path d="M20 110c0-39 80-39 80 0Z" fill={shirt} />
      <path d="M49 72v13q11 10 22 0V72" fill="#f4cfa8" />
      <circle cx="60" cy="43" r="29" fill="#f4cfa8" />
      <path d="M48 40h1M71 40h1M49 56q11 12 22 0" />
      {children}
    </>
  );
}
function Face({
  children,
  colour = "#ffe5be",
}: {
  children: ReactNode;
  colour?: string;
}) {
  return (
    <>
      <circle cx="60" cy="60" r="45" fill={colour} />
      {children}
    </>
  );
}
function Clock({ children }: { children: ReactNode }) {
  return (
    <>
      <circle cx="60" cy="60" r="43" fill="#fff" />
      <path d="M60 24v5M60 91v5M24 60h5M91 60h5" />
      {children}
    </>
  );
}
function Calendar({ children }: { children: ReactNode }) {
  return (
    <>
      <rect x="17" y="24" width="86" height="83" rx="7" fill="#fff" />
      <path d="M17 46h86V31q0-7-7-7H24q-7 0-7 7Z" fill="#86b8da" />
      <path d="M36 13v22M84 13v22" />
      {children}
    </>
  );
}
function Bowl({
  children,
  colour = "#e2f2f5",
}: {
  children?: ReactNode;
  colour?: string;
}) {
  return (
    <>
      <path d="M17 62h86c-3 29-18 41-43 41S20 91 17 62Z" fill={colour} />
      <path d="M43 106h34" />
      {children}
    </>
  );
}
function Hand() {
  return (
    <path
      d="m37 108-16-26-10-21c-4-9 7-14 13-5l12 14V29c0-11 13-11 13 0v26-36c0-11 13-11 13 0v35-30c0-11 13-11 13 0v34-22c0-11 13-11 13 0v44c0 13-5 22-14 28Z"
      fill="#f4cfa8"
    />
  );
}

export const dailyDrawings: Record<DailyPictogramKey, ReactNode> = {
  bread: (
    <>
      <path
        d="M18 66c-18-22 13-53 42-44 29-9 60 22 42 44v35H18Z"
        fill="#e7b578"
      />
      <path
        d="M28 66c-10-15 10-33 32-26 22-7 42 11 32 26v24H28Z"
        fill="#ffe5be"
        stroke="none"
      />
    </>
  ),
  milk: (
    <>
      <path d="m33 11 39 0 17 20v76H31V30Z" fill="#fff" />
      <path d="M33 11v20h56M72 11v20" />
      <path d="M31 55h58v37H31Z" fill="#86b8da" />
      <path d="M51 67h18M51 79h18" stroke="#fff" />
    </>
  ),
  juice: (
    <>
      <path d="m31 25 8 81h42l8-81Z" fill="#fff" />
      <path d="m35 49 5 51h40l5-51Z" fill="#efb54e" stroke="none" />
      <path d="m67 61 9-50h20" />
      <circle cx="64" cy="80" r="14" fill="#ffe5be" />
      <path d="m64 67 0 26M51 80h26" stroke="#d19537" />
    </>
  ),
  apple: (
    <>
      <path
        d="M60 34c-42-22-61 26-31 65 12 18 24 2 31 5 8-3 20 13 31-5 30-39 11-87-31-65Z"
        fill="#e57c79"
      />
      <path
        d="M60 34V15M63 23c2-15 19-18 29-15-4 15-15 20-29 15Z"
        fill="#83b78b"
      />
      <path d="M30 58q-6 12 0 24" stroke="#fff" />
    </>
  ),
  banana: (
    <>
      <path
        d="M23 20c-8 53 31 79 78 45-18 56-86 55-94 5-3-18 2-36 9-50Z"
        fill="#f5d25e"
      />
      <path d="M20 30c-1 53 35 71 70 48M16 20l-1-9 10-1 1 13" />
    </>
  ),
  yogurt: (
    <>
      <path d="m26 40 10 63h48l10-63Z" fill="#fff" />
      <ellipse cx="60" cy="36" rx="40" ry="10" fill="#e98198" />
      <path d="M31 67h58l-5 27H36Z" fill="#f4a8b5" />
      <path d="m85 29 11-18" stroke="#4b7296" strokeWidth="7" />
    </>
  ),
  cheese: (
    <>
      <path d="m15 58 61-39 30 39v43H15Z" fill="#f5d25e" />
      <path d="M15 58h91M76 19v39" />
      <circle cx="37" cy="79" r="8" fill="#ffe5be" />
      <circle cx="71" cy="86" r="6" fill="#ffe5be" />
      <circle cx="92" cy="72" r="5" fill="#ffe5be" />
    </>
  ),
  egg: (
    <>
      <ellipse cx="60" cy="62" rx="36" ry="47" fill="#fff" />
      <circle cx="60" cy="74" r="20" fill="#f5d25e" />
      <path d="M40 42q-6 10-5 20" stroke="#b8dfe8" />
    </>
  ),
  pasta: (
    <Bowl colour="#ffe5be">
      <path
        d="M30 60c-5-26 15-34 18-15s-4 15-3 2c1-28 25-30 22-4s-8 14-6 0c4-24 29-21 26 15M34 71q26 11 52 0"
        stroke="#b78424"
      />
    </Bowl>
  ),
  rice: (
    <Bowl>
      <path d="M23 62c8-44 66-44 74 0Z" fill="#fff" />
      <path
        d="m39 41 5 3m13-10 5 2m12 9 5 3m-48 4 6 2m16-2 5 2m18 0 5 2"
        stroke="#9baba4"
      />
    </Bowl>
  ),
  soup: (
    <Bowl>
      <ellipse cx="60" cy="62" rx="43" ry="10" fill="#e7b578" />
      <path
        d="M38 46c-13-12 11-16-1-29M61 45c-13-12 11-16-1-29M84 46c-13-12 11-16-1-29"
        stroke="#7bada5"
      />
    </Bowl>
  ),
  cake: (
    <>
      <path d="m17 64 58-36 30 36v40H17Z" fill="#ffe5be" />
      <path d="M17 64h88v15H17Z" fill="#f4a8b5" />
      <path d="M75 28v-8M75 9v1" stroke="#b78424" strokeWidth="7" />
      <path d="M17 92h88" stroke="#fff" strokeWidth="7" />
    </>
  ),
  biscuit: (
    <>
      <circle cx="60" cy="60" r="45" fill="#d8a573" />
      <path d="M40 25q-17 9-20 28" stroke="#ffe5be" />
      <g fill="#725445" stroke="none">
        <circle cx="45" cy="47" r="6" />
        <circle cx="75" cy="36" r="5" />
        <circle cx="82" cy="70" r="6" />
        <circle cx="49" cy="83" r="5" />
        <circle cx="60" cy="62" r="5" />
      </g>
    </>
  ),
  vegetables: (
    <>
      <path d="m89 35-57 70c-10 10-18 2-12-9l39-80Z" fill="#e7a456" />
      <path
        d="M71 21 75 8M81 24l20-12M88 33l23-2"
        stroke="#5f9666"
        strokeWidth="8"
      />
      <path d="m52 40 14 9M41 61l12 8M30 82l9 6" />
    </>
  ),
  meat: (
    <>
      <path
        d="M20 43C32 8 98 9 107 47c11 44-15 63-49 57C20 111 5 79 20 43Z"
        fill="#c9827c"
      />
      <path d="M30 46c5-19 44-22 57-3" stroke="#ffe5be" />
      <path d="M66 48v27M54 76h24" stroke="#fff" strokeWidth="10" />
    </>
  ),
  fish: (
    <>
      <path
        d="M28 59c23-43 65-41 82 0-17 41-59 43-82 0L8 35v48Z"
        fill="#86b8da"
      />
      <path d="M80 27q-15 33 0 66M52 58l14 14-23 4" />
      <circle cx="94" cy="51" r="4" fill="#283d38" stroke="none" />
    </>
  ),
  potato: (
    <>
      <path
        d="M21 36c28-34 82-20 84 14 16 38-16 61-54 55C11 110 2 64 21 36Z"
        fill="#d8b789"
      />
      <path
        d="M38 40h1M73 34h1M84 67h1M49 79h1M27 65h1M72 91h1"
        stroke="#8f704e"
        strokeWidth="6"
      />
    </>
  ),
  orange: (
    <>
      <circle cx="60" cy="67" r="40" fill="#efb54e" />
      <path
        d="M60 27V14M62 22c13-20 32-9 32-9-6 17-21 18-32 9Z"
        fill="#83b78b"
      />
      <path d="M34 48q-10 12-7 26" stroke="#ffe5be" strokeWidth="6" />
    </>
  ),
  strawberry: (
    <>
      <path
        d="M24 35c-18 30 16 70 36 77 20-7 54-47 36-77-16-18-56-18-72 0Z"
        fill="#e57c79"
      />
      <path d="m60 31-27 8 12-19-3-13 18 13L78 7l-3 13 12 19Z" fill="#83b78b" />
      <path
        d="M41 54v2M66 52v2M82 65v2M52 75v2M67 90v2"
        stroke="#ffe5be"
        strokeWidth="5"
      />
    </>
  ),
  chocolate: (
    <>
      <rect x="27" y="10" width="66" height="99" rx="5" fill="#725445" />
      <path d="M27 40h66M27 70h66M60 10v60" stroke="#d8a573" />
      <path d="M18 74h84v35H18Z" fill="#e98198" />
      <path d="m18 74 42 17 42-17" />
    </>
  ),
  wash_hands: (
    <>
      <path d="M16 32h34V18h29v14H64v15" stroke="#4b7296" strokeWidth="7" />
      <path d="M62 57v5M77 54v5" stroke="#79c5e0" strokeWidth="5" />
      <path d="M10 83 31 67h29l24 8q12 7 0 13l-25-3-18 15H10Z" fill="#f4cfa8" />
      <path
        d="M110 108H86L62 96H43q-13-4-6-12l9-6 19 6 24 10h21Z"
        fill="#f4cfa8"
      />
      <path d="m48 88 16 7M56 84l17 7" />
      <circle cx="87" cy="70" r="7" fill="#e2f2f5" />
    </>
  ),
  brush_teeth: (
    <>
      <path d="M23 31c19-25 57-25 76 0v36c-11 31-63 31-76 0Z" fill="#f4cfa8" />
      <path d="M36 49h48v19H36Z" fill="#fff" />
      <path d="M48 49v19M60 49v19M72 49v19" />
      <path d="M22 101h72V84H67" stroke="#4b7296" strokeWidth="8" />
      <path d="M68 83v-9M78 83v-9M88 83v-9" stroke="#7bada5" />
    </>
  ),
  toothbrush: (
    <>
      <path d="M54 53h15v54H54Z" fill="#86b8da" />
      <rect x="43" y="17" width="36" height="43" rx="9" fill="#fff" />
      <path d="M51 26v25M61 26v25M71 26v25" stroke="#7bada5" />
    </>
  ),
  soap: (
    <>
      <rect x="18" y="48" width="84" height="54" rx="21" fill="#f4a8b5" />
      <path d="M37 65h46" stroke="#fff" strokeWidth="7" />
      <circle cx="42" cy="31" r="11" fill="#e2f2f5" />
      <circle cx="79" cy="18" r="9" fill="#e2f2f5" />
      <circle cx="97" cy="36" r="6" fill="#e2f2f5" />
    </>
  ),
  towel: (
    <>
      <path d="M10 26h100" stroke="#7bada5" strokeWidth="7" />
      <path d="M27 25h66v85H27Z" fill="#b8dfe8" />
      <path d="M36 27v71M27 89h66M27 101h66" stroke="#4b7296" />
    </>
  ),
  bath: (
    <>
      <path d="M10 56h100v18c0 31-100 31-100 0Z" fill="#b8dfe8" />
      <path d="M25 55V27q0-20 23-12v13M27 100v10M94 100v10" />
      <circle cx="67" cy="42" r="12" fill="#fff" />
      <circle cx="90" cy="36" r="8" fill="#fff" />
    </>
  ),
  tissue: (
    <>
      <path d="m20 57 30-15h48l15 15v49H20Z" fill="#b8dfe8" />
      <path d="M20 57h93M70 59l9 47" />
      <path d="m43 47-6-28 22 8 18-16 12 31-19 11Z" fill="#fff" />
      <path d="m61 28 7 23" stroke="#9baba4" />
    </>
  ),
  diaper: (
    <>
      <path d="M17 31h86l-9 61c-5 26-63 26-68 0Z" fill="#fff" />
      <path d="M17 31h86v19H17Z" fill="#b8dfe8" />
      <path d="M22 64q24 4 23 43M98 64q-24 4-23 43M34 40h11M75 40h11" />
    </>
  ),
  hairbrush: (
    <>
      <rect x="35" y="12" width="50" height="61" rx="22" fill="#d8a573" />
      <path d="M52 73v37h16V73" fill="#e7b578" />
      <path d="M47 29v26M59 26v31M71 29v26" />
    </>
  ),
  wash_face: (
    <>
      <circle cx="60" cy="49" r="33" fill="#f4cfa8" />
      <path d="M47 44h1M72 44h1M49 59q11 9 22 0" />
      <path
        d="M9 101 22 62q9-12 16 1l9 31M111 101 98 62q-9-12-16 1l-9 31"
        fill="#f4cfa8"
      />
      <path d="M54 89v14M67 85v14" stroke="#79c5e0" strokeWidth="5" />
    </>
  ),
  tshirt: (
    <>
      <path
        d="m40 17-29 19 15 28 14-8v51h40V56l14 8 15-28-29-19q-20 16-40 0Z"
        fill="#86b8da"
      />
      <path d="M40 17q20 35 40 0" />
    </>
  ),
  trousers: (
    <>
      <path d="M28 13h64l6 95H68L60 59l-8 49H22Z" fill="#86b8da" />
      <path d="M28 27h64M60 27v25M35 27v15M85 27v15" />
    </>
  ),
  dress: (
    <>
      <path
        d="m40 14-15 27 15 9 4 18-22 40h76L76 68l4-18 15-9-15-27q-20 17-40 0Z"
        fill="#e98198"
      />
      <path d="M44 68h32M40 15q20 31 40 0" />
    </>
  ),
  coat: (
    <>
      <path
        d="m40 15-28 26 9 35 15-8-5 41h58l-5-41 15 8 9-35-28-26Z"
        fill="#7bada5"
      />
      <path d="m40 15 20 24 20-24M60 39v70M43 72h-8M77 72h8" />
      <path d="M68 57h1M68 78h1M68 98h1" strokeWidth="5" />
    </>
  ),
  shoes: (
    <>
      <path d="M14 35h25l6 30 29 12q9 6 8 21H9V51Z" fill="#86b8da" />
      <path d="M9 90h73M41 60l-12 4M46 72l-13 5" />
      <path d="m67 24 22-3 4 24 17 11v18H91M89 45l-10 3" fill="#b8dfe8" />
    </>
  ),
  socks: (
    <>
      <path
        d="M15 14h29v53h20c28 5 18 37-4 37H31c-9 0-16-7-16-17Z"
        fill="#f4a8b5"
      />
      <path d="M15 28h29M15 74h15v29" />
      <path d="M66 14h26v45h9q23 3 9 23H88V14M66 28h26" fill="#b8dfe8" />
    </>
  ),
  hat: (
    <>
      <path d="M26 78V57c0-58 68-58 68 0v21Z" fill="#e98198" />
      <rect x="18" y="76" width="84" height="27" rx="8" fill="#f4a8b5" />
      <circle cx="60" cy="16" r="10" fill="#f4a8b5" />
      <path d="M34 52v17M60 40v29M86 52v17" stroke="#9b405d" />
    </>
  ),
  pyjamas: (
    <>
      <path
        d="m25 13-18 15 8 24 12-7v28h43V45l12 7 8-24-18-15-23 10Z"
        fill="#b8dfe8"
      />
      <path d="M49 23v50M35 75h37l8 36H59l-5-20-4 20H29Z" fill="#86b8da" />
      <path d="M56 39h1M56 55h1" strokeWidth="5" />
    </>
  ),
  bed: (
    <>
      <path d="M11 107V31M109 107V60M11 66h98v27H11Z" fill="#86b8da" />
      <rect x="18" y="44" width="31" height="20" rx="5" fill="#fff" />
      <path d="M51 48h44q14 0 14 18H51Z" fill="#b8dfe8" />
    </>
  ),
  chair: (
    <>
      <rect x="31" y="13" width="58" height="48" rx="7" fill="#d8a573" />
      <path
        d="M29 68h63v16H29ZM36 84v26M85 84v26M37 61v7M83 61v7"
        fill="#e7b578"
      />
    </>
  ),
  table: (
    <>
      <path d="m20 31 81 0 10 25H10Z" fill="#e7b578" />
      <path
        d="M20 56v52M100 56v52M30 57v33M90 57v33"
        stroke="#8f704e"
        strokeWidth="8"
      />
    </>
  ),
  sofa: (
    <>
      <rect x="23" y="29" width="74" height="58" rx="13" fill="#7bada5" />
      <path d="M60 30v42" />
      <path
        d="M13 57q-10 0-10 13v30h114V70q0-13-10-13T97 72H23q0-15-10-15Z"
        fill="#a3c9b8"
      />
      <path d="M18 101v9M102 101v9" />
    </>
  ),
  door: (
    <>
      <path d="M23 110V12h74v98" fill="#ffe5be" />
      <path d="M32 110V22h56v88" fill="#d8a573" />
      <circle cx="77" cy="69" r="4" fill="#283d38" />
      <path d="M14 110h93" />
    </>
  ),
  light: (
    <>
      <path
        d="M39 61c-31-39 38-75 47-31 3 15-8 23-11 31l-3 17H48l-3-17Z"
        fill="#f5d25e"
      />
      <path d="M48 79h24v22H48ZM52 110h16M60 5v5M15 21l8 6M7 53h11M105 21l-8 6M113 53h-11M55 76 50 53h20l-5 23" />
    </>
  ),
  blanket: (
    <>
      <path d="M23 14h65l12 15v79H23Z" fill="#b8dfe8" />
      <path
        d="M88 14v15h12M23 45h77M23 76h77M47 14v94M75 14v94"
        stroke="#7bada5"
      />
      <path d="M30 108v7M44 108v7M58 108v7M72 108v7M86 108v7" />
    </>
  ),
  bag: (
    <>
      <rect x="25" y="28" width="70" height="80" rx="15" fill="#e7a456" />
      <path d="M44 28v-8q16-18 32 0v8M25 47H15v45h10M95 47h10v45H95" />
      <rect x="38" y="67" width="44" height="28" rx="5" fill="#ffe5be" />
      <path d="M45 76h30" />
    </>
  ),
  me: (
    <Person>
      <path d="M26 91h26M41 81l11 10-11 10" stroke="#9b405d" strokeWidth="5" />
      <circle cx="63" cy="94" r="5" fill="#e98198" />
    </Person>
  ),
  you: (
    <Person>
      <path d="M64 92h39M93 81l11 11-11 11" stroke="#4b7296" strokeWidth="5" />
    </Person>
  ),
  friend: (
    <>
      <circle cx="32" cy="35" r="19" fill="#f4cfa8" />
      <circle cx="87" cy="35" r="19" fill="#d8a573" />
      <path
        d="M7 102V82c0-37 49-37 49 0v20ZM64 102V82c0-37 49-37 49 0v20Z"
        fill="#a3c9b8"
      />
      <path d="m43 73 17 16 17-16M26 35h1M38 35h1M81 35h1M93 35h1" />
    </>
  ),
  grandmother: (
    <Person shirt="#e98198">
      <path d="M31 39C15 9 72-1 89 20l6 25-17-17-12 8-17-10Z" fill="#d8dedd" />
      <path d="M39 42h19v14H39ZM63 42h19v14H63ZM58 47h5" />
    </Person>
  ),
  grandfather: (
    <Person shirt="#7bada5">
      <path
        d="M31 35q-1-23 17-21M89 35q1-23-17-21"
        stroke="#9baba4"
        strokeWidth="10"
      />
      <path d="M39 42h19v14H39ZM63 42h19v14H63ZM58 47h5M49 62q11-9 22 0" />
    </Person>
  ),
  teacher: (
    <>
      <rect x="8" y="19" width="69" height="60" rx="4" fill="#7bada5" />
      <path d="M20 34h36M20 48h24M20 62h30" stroke="#fff" />
      <circle cx="91" cy="30" r="15" fill="#f4cfa8" />
      <path d="M73 110V68q18-24 36 0v42" fill="#86b8da" />
      <path d="m78 62-29-7M88 83v27M101 83v27" />
    </>
  ),
  play: (
    <>
      <rect x="16" y="15" width="57" height="57" rx="9" fill="#ffe5be" />
      <path d="M31 30h1M57 57h1M31 57h1M57 30h1" strokeWidth="8" />
      <circle cx="81" cy="82" r="29" fill="#86b8da" />
      <path d="M53 82h56M81 54c-18 18-18 39 0 56M81 54c18 18 18 39 0 56" />
    </>
  ),
  draw: (
    <>
      <path d="M15 18h69v90H15Z" fill="#fff" />
      <path d="m49 83 39-66 17 10-39 66-21 12Z" fill="#f5d25e" />
      <path d="m88 17 5-9q3-5 8-2l7 4q5 3 2 8l-5 9Z" fill="#e98198" />
      <path d="m49 83 17 10M45 105l8-5" />
    </>
  ),
  watch_tv: (
    <>
      <rect x="12" y="29" width="96" height="70" rx="9" fill="#7bada5" />
      <rect x="22" y="39" width="76" height="49" rx="4" fill="#e2f2f5" />
      <path d="m38 12 22 17 22-17M37 109h46" />
      <path d="m52 49 20 14-20 14Z" fill="#86b8da" />
    </>
  ),
  computer: (
    <>
      <rect x="18" y="13" width="84" height="65" rx="7" fill="#7bada5" />
      <rect x="26" y="21" width="68" height="48" rx="3" fill="#e2f2f5" />
      <path d="m18 86-9 22h102l-9-22Z" fill="#b8dfe8" />
      <path d="M35 96h50" />
    </>
  ),
  ball: (
    <>
      <circle cx="60" cy="60" r="46" fill="#fff" />
      <path
        d="m60 39 20 14-8 25H48l-8-25ZM60 39V15M40 53l-24-8M48 78l-15 22M72 78l15 22M80 53l24-8"
        fill="#7bada5"
      />
    </>
  ),
  puzzle: (
    <>
      <path
        d="M16 16h35q-11 28 12 24t10-24h31v35q-28-11-24 12t24 10v31H69q11-28-12-24t-10 24H16V69q28 11 24-12T16 47Z"
        fill="#86b8da"
      />
    </>
  ),
  swim: (
    <>
      <circle cx="78" cy="37" r="13" fill="#f4cfa8" />
      <path
        d="m20 67 26-24 28 19M47 43l8-19 16-8"
        stroke="#4b7296"
        strokeWidth="9"
      />
      <path
        d="M8 81q13-13 26 0t26 0 26 0 26 0M8 101q13-13 26 0t26 0 26 0 26 0"
        stroke="#79c5e0"
        strokeWidth="5"
      />
    </>
  ),
  ride_bike: (
    <>
      <circle cx="28" cy="83" r="22" fill="#fff" />
      <circle cx="95" cy="83" r="22" fill="#fff" />
      <path
        d="m28 83 20-35 22 35H28M48 48h34l-12 35M95 83 80 29h15M39 42h17"
        stroke="#4b7296"
        strokeWidth="5"
      />
    </>
  ),
  tired: (
    <Face>
      <path d="M33 47q10 10 20 0M67 47q10 10 20 0" />
      <ellipse cx="60" cy="81" rx="12" ry="17" fill="#fff" />
    </Face>
  ),
  angry: (
    <Face colour="#f4a8b5">
      <path d="m33 36 19 10M87 36 68 46M42 55h1M77 55h1" strokeWidth="6" />
      <path d="M39 87q21-24 42 0" />
    </Face>
  ),
  scared: (
    <Face colour="#e2f2f5">
      <path d="M32 36q9-10 19-2M69 34q10-8 19 2" />
      <circle cx="43" cy="51" r="6" fill="#fff" />
      <circle cx="77" cy="51" r="6" fill="#fff" />
      <ellipse cx="60" cy="82" rx="11" ry="15" fill="#fff" />
    </Face>
  ),
  calm: (
    <Face colour="#d9eddf">
      <path d="M33 48q10 9 20 0M67 48q10 9 20 0M43 76q17 13 34 0" />
    </Face>
  ),
  cold: (
    <>
      <path d="M49 75V24c0-25 24-25 24 0v51a23 23 0 1 1-24 0Z" fill="#fff" />
      <path d="M61 61v27" stroke="#79c5e0" strokeWidth="9" />
      <circle cx="61" cy="93" r="11" fill="#79c5e0" />
      <path
        d="M18 27v32M5 35l26 16M31 35 5 51M80 30h10M80 47h10M80 64h10"
        stroke="#4b7296"
      />
    </>
  ),
  hot: (
    <>
      <path d="M40 75V24c0-25 24-25 24 0v51a23 23 0 1 1-24 0Z" fill="#fff" />
      <path d="M52 29v59" stroke="#e57c79" strokeWidth="9" />
      <circle cx="52" cy="93" r="11" fill="#e57c79" />
      <path
        d="M84 68c-13-15 12-22 0-38M100 68c-13-15 12-22 0-38"
        stroke="#b78424"
      />
    </>
  ),
  want: (
    <>
      <circle cx="39" cy="25" r="13" fill="#f4cfa8" />
      <path d="M24 108V65q0-25 28-25v68" fill="#86b8da" />
      <circle cx="93" cy="52" r="16" fill="#f5d25e" />
      <path d="M89 81H55M67 70 55 81l12 11" stroke="#4b7296" strokeWidth="5" />
    </>
  ),
  more: (
    <>
      <rect x="18" y="18" width="84" height="84" rx="18" fill="#d9eddf" />
      <path d="M60 36v48M36 60h48" stroke="#2d6546" strokeWidth="12" />
    </>
  ),
  finished: (
    <>
      <path d="M26 110V12h77v61H26" fill="#fff" />
      <path
        d="M27 13h25v20H27ZM77 13h25v20H77ZM52 33h25v20H52ZM27 53h25v20H27ZM77 53h25v20H77Z"
        fill="#4b7296"
        stroke="none"
      />
      <path d="M15 110h23" />
    </>
  ),
  wait: (
    <>
      <path
        d="M31 14h58v18c0 14-18 23-18 28s18 14 18 28v18H31V88c0-14 18-23 18-28S31 46 31 32Z"
        fill="#fff"
      />
      <path d="m39 36 21 17 21-17ZM39 99l21-23 21 23Z" fill="#f5d25e" />
      <path d="M23 14h74M23 106h74" strokeWidth="7" />
    </>
  ),
  again: (
    <>
      <path d="M99 45a43 43 0 1 0 0 36" stroke="#4b7296" strokeWidth="10" />
      <path d="m101 16 0 31-30-1" stroke="#4b7296" strokeWidth="10" />
    </>
  ),
  choose: (
    <>
      <rect x="11" y="19" width="44" height="61" rx="7" fill="#d9eddf" />
      <rect x="65" y="19" width="44" height="61" rx="7" fill="#fff" />
      <path d="m21 46 9 11 16-23" stroke="#2d6546" strokeWidth="6" />
      <path d="M33 109V88M23 98l10-11 10 11" stroke="#4b7296" strokeWidth="6" />
    </>
  ),
  look: (
    <>
      <path
        d="M7 53q22-35 44 0-22 35-44 0ZM69 53q22-35 44 0-22 35-44 0Z"
        fill="#fff"
      />
      <circle cx="29" cy="53" r="9" fill="#86b8da" />
      <circle cx="91" cy="53" r="9" fill="#86b8da" />
      <path d="M35 96h52M75 85l12 11-12 11" stroke="#4b7296" strokeWidth="6" />
    </>
  ),
  listen: (
    <>
      <path
        d="M60 90c-4-17 5-20 15-28 20-26-20-54-37-29-12 19 6 25-6 39M60 90c-2 22-29 23-30 1M47 43c8-13 27-1 17 9l-11 9"
        fill="#f4cfa8"
      />
      <path d="M90 35q16 23 0 46M105 24q21 34 0 67" stroke="#4b7296" />
    </>
  ),
  park: (
    <>
      <path d="M9 109h102M27 68v39" stroke="#7bada5" />
      <circle cx="27" cy="46" r="22" fill="#83b78b" />
      <path
        d="M56 58h48v18H56ZM52 85h55M61 85v22M99 85v22M61 76v9M99 76v9"
        fill="#d8a573"
      />
    </>
  ),
  shop: (
    <>
      <path d="M18 42h84v65H18Z" fill="#ffe5be" />
      <path d="m20 14-11 29h102L100 14Z" fill="#fff" />
      <path
        d="m32 14-6 29h17l2-29M65 14l2 29h17l-6-29M95 14l8 29h8l-11-29"
        fill="#e98198"
        stroke="none"
      />
      <path d="M19 43h82M66 107V66h23v41" />
      <rect x="29" y="62" width="25" height="25" fill="#e2f2f5" />
    </>
  ),
  hospital: (
    <>
      <rect x="24" y="14" width="72" height="94" rx="4" fill="#fff" />
      <path
        d="M52 25h16v14h14v16H68v14H52V55H38V39h14Z"
        fill="#e57c79"
        stroke="none"
      />
      <path d="M46 108V84h28v24M60 84v24" fill="#b8dfe8" />
    </>
  ),
  kitchen: (
    <>
      <path d="M11 106V37h98v69Z" fill="#ffe5be" />
      <path d="M11 37h98M70 37v69" />
      <rect x="22" y="56" width="37" height="37" rx="3" fill="#86b8da" />
      <path d="M85 54v20M30 26h18M78 21h18" strokeWidth="7" />
      <path d="M20 9h38v28H20ZM69 9h34v28H69Z" />
    </>
  ),
  bedroom: (
    <>
      <path d="M13 108V14h94v94" fill="#fff" />
      <path d="M22 108V55M98 108V72M22 75h76v21H22Z" fill="#b8dfe8" />
      <rect x="28" y="60" width="24" height="14" rx="4" fill="#fff" />
      <path d="M73 26a15 15 0 1 0 17 19c-15 2-23-7-17-19Z" fill="#f5d25e" />
    </>
  ),
  bathroom: (
    <>
      <path d="M14 108V13h93v95" fill="#fff" />
      <rect x="41" y="24" width="38" height="34" rx="5" fill="#e2f2f5" />
      <path
        d="M23 75h75c-2 27-73 27-75 0ZM55 96v13h14V96M60 74V60h11"
        fill="#b8dfe8"
      />
    </>
  ),
  now: (
    <Clock>
      <path d="M60 34v26l17 15" stroke="#4b7296" strokeWidth="6" />
      <circle cx="60" cy="60" r="7" fill="#e57c79" />
    </Clock>
  ),
  later: (
    <>
      <circle cx="47" cy="52" r="34" fill="#fff" />
      <path d="M47 28v24l17 10" stroke="#4b7296" strokeWidth="6" />
      <path d="M51 97h56M94 84l14 13-14 13" stroke="#4b7296" strokeWidth="6" />
    </>
  ),
  today: (
    <Calendar>
      <path d="M33 63h9M57 63h9M81 63h9M33 88h9M81 88h9" stroke="#9baba4" />
      <circle cx="61" cy="87" r="12" fill="#e57c79" />
    </Calendar>
  ),
  tomorrow: (
    <Calendar>
      <path d="M30 63h12M55 63h12M80 63h12" stroke="#9baba4" />
      <path d="M30 88h52M72 78l11 10-11 10" stroke="#4b7296" strokeWidth="6" />
    </Calendar>
  ),
  morning: (
    <>
      <path d="M27 81a33 33 0 0 1 66 0Z" fill="#f5d25e" />
      <path
        d="M9 82h102M60 13v16M18 37l12 12M102 37 90 49M35 101h50"
        stroke="#b78424"
        strokeWidth="5"
      />
    </>
  ),
  night: (
    <>
      <path
        d="M72 13C9 7-4 96 58 107c24 4 42-8 49-22-48 7-68-34-35-72Z"
        fill="#85b1d4"
      />
      <path
        d="m96 16 4 10 11 1-9 7 2 11-8-6-9 6 2-11-9-7 11-1Z"
        fill="#f5d25e"
      />
    </>
  ),
  head: (
    <>
      <path d="M46 86v23h28V86" fill="#f4cfa8" />
      <ellipse cx="60" cy="50" rx="35" ry="40" fill="#f4cfa8" />
      <path
        d="M25 40q-1-40 35-30 35-10 35 30L76 26 60 30 44 26Z"
        fill="#725445"
      />
      <path d="M46 50h1M73 50h1M47 70q13 11 26 0" />
    </>
  ),
  mouth: (
    <>
      <path d="M12 61q25-37 48-19 23-18 48 19-48 52-96 0Z" fill="#e98198" />
      <path d="M12 61q48-12 96 0-48 16-96 0Z" fill="#fff" />
    </>
  ),
  ear: (
    <>
      <path
        d="M59 94c-5-18 10-23 20-35 22-41-36-69-54-30-13 26 8 31-5 53M59 94c-4 25-35 22-34-2M39 42c8-23 36-3 21 12L45 67"
        fill="#f4cfa8"
      />
    </>
  ),
  eye: (
    <>
      <path d="M8 60q52-66 104 0-52 66-104 0Z" fill="#fff" />
      <circle cx="60" cy="60" r="23" fill="#86b8da" />
      <circle cx="60" cy="60" r="10" fill="#283d38" />
      <circle cx="66" cy="53" r="4" fill="#fff" stroke="none" />
    </>
  ),
  hand: (
    <>
      <Hand />
      <path d="M48 75q20-8 27 8M37 108h37" />
    </>
  ),
  foot: (
    <>
      <path
        d="M38 14h31v44c0 12 18 14 25 25 20 29-18 33-41 19L28 88c-10-8-5-28 3-36Z"
        fill="#f4cfa8"
      />
      <path d="M72 83v10M82 86v10M91 91v9" />
    </>
  ),
  stomach: (
    <>
      <path d="M40 12v14L22 43l8 64h60l8-64-18-17V12" fill="#f4cfa8" />
      <path d="M27 46h66M34 92h52" stroke="#d8a573" />
      <ellipse cx="60" cy="71" rx="23" ry="20" fill="#ffe5be" />
      <circle cx="60" cy="74" r="3" fill="#283d38" stroke="none" />
    </>
  ),
  back: (
    <>
      <circle cx="60" cy="20" r="12" fill="#f4cfa8" />
      <path d="M44 36 20 50l11 57h58l11-57-24-14" fill="#f4cfa8" />
      <path
        d="M60 43v56M44 52l-6 12M76 52l6 12"
        stroke="#4b7296"
        strokeWidth="5"
      />
      <path d="M55 55h10M55 70h10M55 85h10" stroke="#4b7296" />
    </>
  ),
  open: (
    <>
      <path d="M30 110V15h64v95" fill="#fff" />
      <path d="m30 15 32 16v64l-32 15Z" fill="#d8a573" />
      <path d="M65 62h43M97 51l12 11-12 11" stroke="#4b7296" strokeWidth="5" />
      <circle cx="51" cy="65" r="3" fill="#283d38" />
    </>
  ),
  close: (
    <>
      <path d="M30 110V15h64v95" fill="#d8a573" />
      <path d="M38 23h48v79H38" stroke="#ffe5be" />
      <path d="M108 62H65M76 51 64 62l12 11" stroke="#4b7296" strokeWidth="5" />
      <circle cx="78" cy="77" r="3" fill="#283d38" />
    </>
  ),
  sit: (
    <>
      <circle cx="46" cy="23" r="12" fill="#f4cfa8" />
      <path
        d="M16 47v35h53M23 82v27M65 82v27"
        stroke="#7bada5"
        strokeWidth="6"
      />
      <path
        d="M45 43v29h43v35M45 47l20 13h20"
        stroke="#4b7296"
        strokeWidth="9"
      />
    </>
  ),
  stand_up: (
    <>
      <circle cx="43" cy="20" r="11" fill="#f4cfa8" />
      <path
        d="M43 40v29m0-25L25 59m18-15 18 15M43 69l-14 38M43 69l14 38"
        stroke="#4b7296"
        strokeWidth="8"
      />
      <path d="M88 97V28M76 40l12-13 12 13" stroke="#7bada5" strokeWidth="6" />
    </>
  ),
  come: (
    <>
      <circle cx="32" cy="25" r="12" fill="#f4cfa8" />
      <path
        d="M32 43v33m0-26L15 67m17-17 16 17M32 76l-12 32M32 76l12 32"
        stroke="#4b7296"
        strokeWidth="8"
      />
      <path d="M109 63H62M74 51 61 63l13 12" stroke="#7bada5" strokeWidth="6" />
    </>
  ),
  leave: (
    <>
      <circle cx="32" cy="25" r="12" fill="#f4cfa8" />
      <path
        d="M32 43v33m0-26L15 67m17-17 16 17M32 76l-12 32M32 76l12 32"
        stroke="#4b7296"
        strokeWidth="8"
      />
      <path d="M62 63h47M97 51l13 12-13 12" stroke="#7bada5" strokeWidth="6" />
    </>
  ),
  give: (
    <>
      <path d="M10 85h30l18-9h37q14 4 0 14l-35 14H10" fill="#f4cfa8" />
      <circle cx="65" cy="56" r="13" fill="#86b8da" />
      <path d="M20 22h76M84 11l13 11-13 11" stroke="#4b7296" strokeWidth="6" />
    </>
  ),
  take: (
    <>
      <path d="M110 85H80l-18-9H25q-14 4 0 14l35 14h50" fill="#f4cfa8" />
      <circle cx="55" cy="56" r="13" fill="#86b8da" />
      <path d="M100 22H24M36 11 23 22l13 11" stroke="#4b7296" strokeWidth="6" />
    </>
  ),
  tree: (
    <>
      <path d="M48 62h24v49H48Z" fill="#d8a573" />
      <path
        d="M38 75c-37 2-39-42-15-46 3-33 51-36 61-9 38-2 45 51 8 55Z"
        fill="#83b78b"
      />
      <path d="M60 109V69l-17-14M60 76l15-16" />
    </>
  ),
  flower: (
    <>
      <path
        d="M60 61v50M60 94c-22 1-29-13-29-22 22-1 29 10 29 22ZM60 104c20 1 29-13 29-22-20-1-29 10-29 22Z"
        fill="#83b78b"
      />
      <g fill="#f4a8b5">
        <circle cx="60" cy="22" r="16" />
        <circle cx="81" cy="39" r="16" />
        <circle cx="73" cy="62" r="16" />
        <circle cx="46" cy="62" r="16" />
        <circle cx="38" cy="39" r="16" />
      </g>
      <circle cx="60" cy="44" r="14" fill="#f5d25e" />
    </>
  ),
  rain: (
    <>
      <path
        d="M26 65C0 65 5 31 28 32c10-33 58-33 67 0 27-1 31 33 5 33Z"
        fill="#b8dfe8"
      />
      <path
        d="m31 79-8 21M60 79l-8 21M89 79l-8 21"
        stroke="#4b7296"
        strokeWidth="7"
      />
    </>
  ),
  cloud: (
    <>
      <path
        d="M24 89C-4 88 3 45 29 46c9-43 66-43 73 2 25 5 22 42-4 41Z"
        fill="#e2f2f5"
      />
    </>
  ),
  bird: (
    <>
      <path
        d="M22 65 8 47l28 4c7-17 36-30 55-8l18 6-13 11c-5 50-70 47-74 5Z"
        fill="#86b8da"
      />
      <path d="M34 66q18-21 38 0-19 23-38 0ZM50 98v12M67 98v12" />
      <circle cx="83" cy="47" r="3" fill="#283d38" />
      <path d="m96 49 17 1-17 11Z" fill="#efb54e" />
    </>
  ),
  snow: (
    <>
      <path
        d="M60 8v104M15 34l90 52M15 86l90-52M48 17l12 12 12-12M48 103l12-12 12 12M18 47l15-5-2-16M89 94l-2-16 15-5M18 73l15 5-2 16M89 26l-2 16 15 5"
        stroke="#4b7296"
        strokeWidth="6"
      />
    </>
  ),
  bus: (
    <>
      <rect x="9" y="27" width="103" height="65" rx="9" fill="#efb54e" />
      <path d="M9 70h103" />
      <path
        d="M20 39h18v22H20ZM45 39h18v22H45ZM72 39h27v45H72Z"
        fill="#e2f2f5"
      />
      <circle cx="30" cy="94" r="13" fill="#4d5b59" />
      <circle cx="93" cy="94" r="13" fill="#4d5b59" />
    </>
  ),
  train: (
    <>
      <rect x="26" y="11" width="68" height="82" rx="17" fill="#86b8da" />
      <rect x="36" y="28" width="48" height="31" rx="5" fill="#e2f2f5" />
      <path d="M45 12V5h30v7M40 93l-15 19M80 93l15 19M30 103h60" />
      <circle cx="43" cy="75" r="6" fill="#f5d25e" />
      <circle cx="77" cy="75" r="6" fill="#f5d25e" />
    </>
  ),
  plane: (
    <>
      <path
        d="M51 43V16c0-17 18-17 18 0v27l42 28v13L69 68v26l17 12v7l-26-7-26 7v-7l17-12V68L9 84V71Z"
        fill="#b8dfe8"
      />
    </>
  ),
  boat: (
    <>
      <path d="M9 78h102l-18 29H30Z" fill="#86b8da" />
      <path d="M61 77V9L22 65h33M68 22v44h32Z" fill="#fff" />
      <path d="M7 112q12-8 24 0t24 0 24 0 24 0" stroke="#4b7296" />
    </>
  ),
};
