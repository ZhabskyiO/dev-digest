/* Onboarding Tour — /repos/:repoId/onboarding. Thin route entry; the page
   states (not_indexed, empty, ready, generating, failed) and the composed
   six-section tour live in the colocated OnboardingTourView. */
"use client";

import { useParams } from "next/navigation";
import { OnboardingTourView } from "./_components/OnboardingTourView";

export default function OnboardingTourPage() {
  const params = useParams<{ repoId: string }>();
  return <OnboardingTourView repoId={params.repoId} />;
}
