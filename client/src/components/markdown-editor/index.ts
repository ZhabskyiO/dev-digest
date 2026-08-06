/* Import `MarkdownEditor` from here — it resolves to the code-split, client-only
   wrapper. The eager component is exported as `EagerMarkdownEditor` for tests or
   any caller that must render it synchronously. */
export { LazyMarkdownEditor as MarkdownEditor } from "./LazyMarkdownEditor";
export { MarkdownEditor as EagerMarkdownEditor } from "./MarkdownEditor";
export type { MarkdownEditorProps } from "./MarkdownEditor";
