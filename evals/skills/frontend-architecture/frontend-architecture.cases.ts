import type { SkillCase } from "../../src/index.js";

export const cases: SkillCase[] = [
  {
    name: "placement decision: colocate vs promote, private folders under app/, split a 300-line component",
    kind: "quality",
    prompt:
      "Next.js 15 App Router, src/ layout. I have client/src/app/reviews/[id]/page.tsx that grew to ~300 " +
      "lines: it fetches the review, holds filter state, has a 40-line formatSeverity() helper, three " +
      "SEVERITY_* constants, and renders a FindingsTable that I now also want to use on /pulls/[id]. " +
      "Where does each piece go and why?",
    practices: [
      "FindingsTable is promoted to a shared location (e.g. src/components/...) because it now has a second consumer (/pulls/[id]) — the answer applies the 'used by more than one feature?' question explicitly",
      "the constants and the helper are extracted into *.constants.ts / *.utils.ts (or equivalent) colocated with their only consumer, not moved to a global lib 'just in case'",
      "stateful filter logic is extracted into a custom hook, and the page component keeps only routing/rendering",
      "anything colocated under app/ that is not a route file goes in a private _folder (e.g. app/reviews/[id]/_components) so it cannot become a route",
      "the answer does not advise deep nesting or ../../../ relative imports — it uses the @/ alias and keeps depth shallow",
    ],
    threshold: 0.6,
    maxTurns: 8,
  },
];
