/* MarkdownEditor — the ONLY place CodeMirror is touched.
   Keeping it behind these props means the editor can be swapped (or dropped back
   to a plain textarea) by rewriting this file alone; no CodeMirror type ever
   reaches a caller.

   Why a real editor rather than a textarea plus a gutter: line numbers have to
   stay aligned with soft-wrapped lines, and markdown bodies wrap constantly. A
   separate gutter div drifts the moment a line wraps; CodeMirror's gutter is
   wired to its own line layout, so it can't. */
"use client";

import React from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as tk } from "@lezer/highlight";

/**
 * Token colours.
 *
 * This has to be a real `HighlightStyle`, not CSS selectors on `.tok-*`:
 * `basicSetup` registers CodeMirror's `defaultHighlightStyle`, which emits its
 * own generated class names, so hand-written `.tok-heading` rules never match
 * and you inherit the defaults instead — including `textDecoration: underline`
 * on every heading. Registering a non-fallback `syntaxHighlighting` overrides
 * that (which is exactly what the default's `{fallback: true}` registration
 * means), and `textDecoration: "none"` unsets the underline explicitly.
 */
const highlightStyle = HighlightStyle.define([
  { tag: tk.heading, color: "var(--accent-text)", fontWeight: "600", textDecoration: "none" },
  { tag: tk.strong, color: "var(--text-primary)", fontWeight: "700" },
  { tag: tk.emphasis, fontStyle: "italic" },
  { tag: tk.monospace, color: "var(--ok)" },
  { tag: [tk.link, tk.url], color: "var(--accent-text)", textDecoration: "none" },
  { tag: tk.quote, color: "var(--text-secondary)" },
  { tag: tk.list, color: "var(--text-primary)" },
  // Markers: the `#`, `-`, backticks. Muted so the prose stands out, not the
  // punctuation.
  { tag: [tk.processingInstruction, tk.meta], color: "var(--text-muted)" },
]);

/**
 * Surface + chrome, mapped onto the app's CSS custom properties so the editor
 * follows the light/dark toggle. `background: transparent` lets the surrounding
 * filename-strip container own the surface colour.
 */
const theme = EditorView.theme({
  "&": { backgroundColor: "transparent", fontSize: "13px" },
  ".cm-content": {
    fontFamily: "var(--font-mono)",
    padding: "10px 0",
    // Plain prose carries no highlight tag, so it inherits from here. Without
    // this it falls back to the browser default and reads washed out.
    color: "var(--text-primary)",
    caretColor: "var(--text-primary)",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--text-muted)",
    border: "none",
    fontFamily: "var(--font-mono)",
    fontSize: "12px",
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 12px", minWidth: "28px" },
  ".cm-activeLine": { backgroundColor: "var(--bg-hover)" },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
    color: "var(--text-secondary)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text-primary)" },
  // Both selectors are needed: CodeMirror draws its own selection layer when
  // focused and falls back to the native one when not.
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "var(--accent-bg)",
  },
  ".cm-selectionMatch": { backgroundColor: "transparent" },
});

/** A skill body is prose. Browser spellcheck underlines every identifier and
 *  file path in it, which reads as errors the editor is reporting. */
const contentAttributes = EditorView.contentAttributes.of({
  spellcheck: "false",
  autocorrect: "off",
  autocapitalize: "off",
});

const extensions = [
  markdown(),
  syntaxHighlighting(highlightStyle),
  EditorView.lineWrapping,
  contentAttributes,
  theme,
];

export interface MarkdownEditorProps {
  value: string;
  onChange?: (value: string) => void;
  /** Minimum editor height in px. Grows with content beyond this. */
  minHeight?: number;
  readOnly?: boolean;
  ariaLabel?: string;
}

export function MarkdownEditor({
  value,
  onChange,
  minHeight = 320,
  readOnly = false,
  ariaLabel,
}: MarkdownEditorProps) {
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      readOnly={readOnly}
      extensions={extensions}
      minHeight={`${minHeight}px`}
      // Without this, @uiw applies its own LIGHT theme by default and the
      // editor renders light-on-light inside the dark app.
      theme="none"
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLine: !readOnly,
        highlightActiveLineGutter: !readOnly,
        // Prose, not code — bracket/autocomplete assistance fights the author,
        // and match highlighting flashes on ordinary repeated words.
        bracketMatching: false,
        closeBrackets: false,
        autocompletion: false,
        highlightSelectionMatches: false,
        searchKeymap: false,
      }}
      aria-label={ariaLabel}
    />
  );
}
