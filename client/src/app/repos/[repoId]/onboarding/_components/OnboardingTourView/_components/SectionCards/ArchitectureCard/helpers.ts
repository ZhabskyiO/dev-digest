/**
 * Strips every markdown-syntax link out of a model-written architecture
 * body, keeping only its visible text.
 *
 * The feature's stated guarantee is that `CriticalPathsCard`'s
 * `githubBlobUrl()` control is the ONLY `href` produced anywhere on this
 * page. The shared `Markdown` primitive (`@devdigest/ui`, vendored — not
 * ours to edit) renders its `a` node as a bare `<a href={href}>` with no
 * `rel`/target policy, so any link syntax surviving into a model-written
 * body would become a live, un-guarded outbound anchor (e.g. a prompt-
 * injected `[click me](https://attacker.example)`). Handling this at the
 * render boundary — mangling the markdown source before it ever reaches
 * `Markdown` — sidesteps needing to fork or wrap react-markdown's renderer.
 *
 * Neutralizes every link-producing markdown form remark-gfm recognizes:
 *  - inline links `[text](url "title")`      -> `text`
 *  - reference-style usage `[text][ref]`      -> `text`
 *  - reference-style definitions `[ref]: url` -> removed entirely
 *  - explicit autolinks `<https://…>`         -> backtick-wrapped literal
 *  - bare GFM autolink literals (raw `https://…` / `www.…` text, which
 *    remark-gfm autolinks even with no bracket syntax at all) ->
 *    backtick-wrapped literal
 */
export function stripMarkdownLinks(markdown: string): string {
  let out = markdown;

  // Inline links: [text](url "title") -> text
  out = out.replace(/\[([^\]]*)\]\(([^)]*)\)/g, "$1");

  // Reference-style link definitions: [ref]: url "title" -> removed
  out = out.replace(/^[ \t]*\[[^\]]+\]:[ \t]*\S+.*$/gm, "");

  // Reference-style link usage: [text][ref] -> text
  out = out.replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1");

  // Explicit autolinks: <https://…> -> `https://…` (inert code text)
  out = out.replace(/<(https?:\/\/[^>\s]+)>/g, "`$1`");

  // Bare GFM autolink literals — raw URLs with no bracket syntax at all —
  // wrapped in backticks so they render as inert code text instead of an
  // autolinked <a>. The negative lookbehind skips URLs already
  // backtick-wrapped by the step above.
  out = out.replace(/(?<!`)\bhttps?:\/\/[^\s`)]+/g, (match) => `\`${match}\``);
  out = out.replace(/(?<!`)\bwww\.[^\s`)]+/g, (match) => `\`${match}\``);

  return out;
}
