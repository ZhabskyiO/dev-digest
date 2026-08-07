/* Conventions — /repos/:repoId/conventions. Thin route entry; the review flow
   lives in the colocated ConventionsView. */
"use client";

import { useParams } from "next/navigation";
import { ConventionsView } from "./_components/ConventionsView";

export default function ConventionsPage() {
  const params = useParams<{ repoId: string }>();
  return <ConventionsView repoId={params.repoId} />;
}
