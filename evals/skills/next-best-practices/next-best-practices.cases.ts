import type { SkillCase } from "../../src/index.js";

const PAGE = `// client/src/app/reviews/[id]/page.tsx
"use client";
import { useEffect, useState } from "react";
import { cookies } from "next/headers";

export default async function ReviewPage({ params }: { params: { id: string } }) {
  const [review, setReview] = useState(null);
  const session = cookies().get("session");
  useEffect(() => {
    fetch("/api/reviews/" + params.id).then(r => r.json()).then(setReview);
  }, [params.id]);
  return <img src={review?.avatarUrl} width="48" />;
}`;

export const cases: SkillCase[] = [
  {
    name: "review catches async client component, sync params, cookies() in a client component, raw img",
    kind: "quality",
    prompt: `Review this Next.js 15 page for framework mistakes and show the corrected version.\n\n${PAGE}`,
    practices: [
      "flags that an async function component cannot be a client component ('use client' + async is invalid) and resolves it by making it a server component or moving the data fetch",
      "flags that in Next.js 15 params is a Promise and must be awaited (const { id } = await params), and notes the same applies to searchParams",
      "flags that cookies() from next/headers is a server-only API and cannot run inside a client component, and that it must be awaited in Next 15",
      "replaces the raw <img> with next/image (Image) with width and height",
      "the corrected version fetches data in a Server Component (or server action / route handler) instead of useEffect + fetch in a client component",
    ],
    threshold: 0.6,
    maxTurns: 8,
  },
];
