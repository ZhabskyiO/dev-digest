/* Multi-Agent Review — results page. Thin route entry: all feature logic
   lives in `_components/MultiAgentResults` (it reads the route params
   itself via `useParams`). Wrapped in Suspense because that component reads
   `useSearchParams` (the `?view=` mode), which otherwise bails the whole
   route to client-side rendering. */
import { Suspense } from "react";
import { MultiAgentResults } from "./_components/MultiAgentResults";

export default function MultiAgentResultsPage() {
  return (
    <Suspense fallback={null}>
      <MultiAgentResults />
    </Suspense>
  );
}
