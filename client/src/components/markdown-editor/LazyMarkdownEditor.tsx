/* LazyMarkdownEditor — the entry point callers should use.

   CodeMirror is browser-only (it builds an EditorView against the DOM), so
   `ssr: false` is the point of this wrapper: it keeps the editor out of the
   server render entirely instead of relying on effects to paper over it.
   Splitting it also defers parse/execute until the Config tab actually mounts.

   It does NOT shrink the route's reported First Load JS — CodeMirror is ~215 kB
   and Config is the default tab, so that cost lands on /skills either way. If
   that ever matters more than the line numbers, swap this module for the plain
   textarea composite; no caller changes. */
"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@devdigest/ui";
import type { MarkdownEditorProps } from "./MarkdownEditor";

export const LazyMarkdownEditor = dynamic<MarkdownEditorProps>(
  () => import("./MarkdownEditor").then((m) => m.MarkdownEditor),
  {
    ssr: false,
    // Reserves the editor's height so the form doesn't jump when it lands.
    loading: () => <Skeleton height={320} />,
  },
);
