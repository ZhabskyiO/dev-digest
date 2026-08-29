import { Suspense } from "react";
import { CiRunsView } from "./_components/CiRunsView";

/* Route: /ci-runs (CI Runs page, AC-46). Thin route entry — the view, its
   styles and i18n are colocated under _components/CiRunsView.

   Suspense boundary is required here, not optional: CiRunsView reads filters
   from `useSearchParams()`, which forces a client-side render bailout in the
   App Router unless a Suspense ancestor exists — see client/insights. */
export default function CiRunsPage() {
  return (
    <Suspense fallback={null}>
      <CiRunsView />
    </Suspense>
  );
}
