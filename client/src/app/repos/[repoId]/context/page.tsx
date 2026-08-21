/* Project Context — /repos/:repoId/context. Thin route entry; the browse/
   preview/rescan flow lives in the colocated ProjectContextView. */
"use client";

import { useParams } from "next/navigation";
import { ProjectContextView } from "./_components/ProjectContextView";

export default function ProjectContextPage() {
  const params = useParams<{ repoId: string }>();
  return <ProjectContextView repoId={params.repoId} />;
}
