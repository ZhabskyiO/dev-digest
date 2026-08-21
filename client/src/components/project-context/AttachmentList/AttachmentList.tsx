/* AttachmentList — the keyboard-operable checkbox list reused by the agent
   Context tab and the skill's "Project context to use" section.
   Presentational only: the screen tasks own data, filtering, and persistence —
   this component just renders `items` in the given order and reports
   toggle/reorder/preview intents.

   Accessibility (AC's WCAG note): every row is a real `<button
   role="checkbox">` or `<button>`, so Tab reaches it and Space/Enter activates
   it for free — no manual key handling needed. Each checkbox's accessible name
   carries both the document's path and its token estimate
   (`t("tokens.rowLabel")`), so a screen reader announces enough to decide
   without seeing the row.

   Reordering is drag-and-drop (dnd-kit), matching SkillsTab's attached-skill
   list. It is NOT pointer-only: the drag handle is a real focusable button
   wired to dnd-kit's `KeyboardSensor`, so Tab reaches it, Space picks the row
   up, Arrow Up/Down move it, and Space drops it. That keyboard path is the
   reason the explicit Move up / Move down button pair could be removed — do
   not replace the handle with a non-focusable glyph.

   Drift and budget state are never carried by colour alone: `DriftBadge`
   pairs an icon with text, and the row itself never disables an action
   because of it. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  sortableKeyboardCoordinates,
  arrayMove,
} from "@dnd-kit/sortable";
import { Icon, IconBtn } from "@devdigest/ui";
import type { ProjectContextDocType } from "@devdigest/shared";
import { DriftBadge } from "../DriftBadge";
import { s } from "./styles";

export interface AttachmentListItem {
  /** Clone-relative path — part of the row's key and its accessible name. */
  path: string;
  /** Which repository this document was discovered in. Combined with `path`
   *  to form the row's React key (`${repo_id}:${path}`) — two different
   *  repositories can each hold a document at the same clone-relative path
   *  (e.g. an agent's direct attachments span every repo it has ever
   *  attached from, not just the currently active one), and keying on
   *  `path` alone would collide those rows. Optional because some callers
   *  render a single-repo list where `path` alone is already unique; the
   *  key then falls back to `path`. */
  repo_id?: string;
  type: ProjectContextDocType;
  /** Token estimate (AC-9) — always rendered as an approximation. */
  tokens: number;
  checked: boolean;
  /** Set when the document's current content differs from what was recorded
   *  at attach time (AC-36). */
  drift?: boolean;
  /** How many agents currently have this document attached (AC-11). */
  usedByAgents?: number;
}

const TYPE_COLOR: Record<ProjectContextDocType, string> = {
  specs: "var(--accent-text)",
  docs: "var(--ok)",
  insights: "var(--warn)",
};

/** Splits a clone-relative path into its trailing filename and leading
 *  directory (empty for a root-level file), matching the screenshots'
 *  "public-api.md  specs/" two-part row label. */
function splitPath(path: string): { name: string; dir: string } {
  const idx = path.lastIndexOf("/");
  if (idx === -1) return { name: path, dir: "" };
  return { name: path.slice(idx + 1), dir: path.slice(0, idx + 1) };
}

/** The single source of truth for "what uniquely identifies a row" — the
 *  React `key`, the dnd-kit sortable `id`, and the drag-end id→item lookup
 *  all derive from this SAME function so they cannot drift apart. Two
 *  different repositories can each hold a document at the same clone-
 *  relative path (an agent's direct attachments span every repo it has ever
 *  attached from, not just the currently active one) — `path` alone is not
 *  a safe identity for either React reconciliation or dnd-kit's
 *  `SortableContext`, which requires unique ids to resolve the right drag
 *  target. */
function itemKey(item: AttachmentListItem): string {
  return `${item.repo_id ?? ""}:${item.path}`;
}

/** Pure drag-end resolution, factored out of the component so a reorder can
 *  be proven without simulating dnd-kit's pointer sensors — jsdom reports
 *  `getBoundingClientRect` as all-zero, so no real drag ever resolves a drop
 *  target in tests (see `AttachmentList.test.tsx`'s note on this). `activeId`
 *  / `overId` are `itemKey(item)` values, matching what `useSortable` and
 *  `SortableContext` are given below — NOT `item.path`, which would
 *  reintroduce the exact id collision the composite key exists to avoid.
 *  Returns the new PATH list `onReorder` expects (its contract predates and
 *  is unrelated to the composite id), or `null` when the ids don't resolve
 *  to two distinct rows. */
export function resolveDragReorder(
  items: AttachmentListItem[],
  activeId: string,
  overId: string,
): string[] | null {
  if (activeId === overId) return null;
  const keys = items.map(itemKey);
  const from = keys.indexOf(activeId);
  const to = keys.indexOf(overId);
  if (from === -1 || to === -1) return null;
  return arrayMove(items, from, to).map((item) => item.path);
}

/** The drag-handle props `useSortable` hands back — pulled out as a type so
 *  `RowContent` can accept them without itself calling the hook. */
type DragHandleProps = Pick<ReturnType<typeof useSortable>, "attributes" | "listeners">;

interface RowContentProps {
  item: AttachmentListItem;
  style: React.CSSProperties;
  /** Present only for the sortable variant — attaches dnd-kit's drag node
   *  ref. Omitted entirely for the static variant, which mounts no dnd-kit
   *  hook at all. */
  setNodeRef?: (node: HTMLElement | null) => void;
  /** Present only for the sortable variant — renders the grip handle. */
  dragHandle?: DragHandleProps;
  /** Reports the FULL row (`repo_id` + `path`, plus whatever else the caller
   *  finds useful), not just `path` — see the note on `AttachmentList`'s own
   *  `onToggle`/`onPreview` props below for why a bare path is not enough for
   *  a caller to know WHICH row was clicked. */
  onToggle: (item: AttachmentListItem) => void;
  onPreview?: (item: AttachmentListItem) => void;
}

/** Shared row markup for both the sortable and static variants — kept as one
 *  function so the two never drift visually. Neither variant calls
 *  `useSortable` here; that hook (when needed) is called by the caller
 *  (`SortableRow`) and its output is passed in as plain props. */
function RowContent({ item, style, setNodeRef, dragHandle, onToggle, onPreview }: RowContentProps) {
  const t = useTranslations("context");
  const { name, dir } = splitPath(item.path);
  const tokensLabel = t("tokens.approx", { count: item.tokens });
  const rowLabel = t("tokens.rowLabel", { path: item.path, count: item.tokens });

  return (
    <div ref={setNodeRef} role="listitem" style={style}>
      {dragHandle && (
        <button
          type="button"
          style={s.grip}
          aria-label={t("attachments.dragHandle", { name })}
          {...dragHandle.attributes}
          {...dragHandle.listeners}
        >
          <Icon.GripVertical size={14} />
        </button>
      )}
      <button
        type="button"
        role="checkbox"
        aria-checked={item.checked}
        aria-label={rowLabel}
        onClick={() => onToggle(item)}
        style={s.checkbox(item.checked)}
      >
        {item.checked && <Icon.Check size={11} style={{ color: "#fff" }} />}
      </button>
      <span style={s.name}>{name}</span>
      {dir && <span style={s.dir}>{dir}</span>}
      {item.drift && <DriftBadge />}
      <span style={{ color: TYPE_COLOR[item.type], fontSize: 12, fontWeight: 600 }}>
        {t(`docType.${item.type}`)}
      </span>
      {item.usedByAgents != null && (
        <span style={s.tokens}>{t("attachments.usedByAgents", { count: item.usedByAgents })}</span>
      )}
      <span style={s.spacer} />
      <span className="tnum" style={s.tokens}>
        {tokensLabel}
      </span>
      {onPreview && (
        <IconBtn icon="Eye" label={t("attachments.preview")} onClick={() => onPreview(item)} />
      )}
    </div>
  );
}

interface RowProps {
  item: AttachmentListItem;
  onToggle: (item: AttachmentListItem) => void;
  onPreview?: (item: AttachmentListItem) => void;
}

/** The reorderable variant — the only one that calls `useSortable`. Used
 *  exclusively by lists that pass `onReorder` (AC-14). */
function SortableRow({ item, onToggle, onPreview }: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: itemKey(item),
  });

  const style: React.CSSProperties = {
    ...s.row,
    // Transform string built by hand rather than pulling in
    // `@dnd-kit/utilities` — that package is only a transitive dep here, and
    // SkillsTab (this repo's other sortable list) does the same.
    transform: transform
      ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)`
      : undefined,
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <RowContent
      item={item}
      style={style}
      setNodeRef={setNodeRef}
      dragHandle={{ attributes, listeners }}
      onToggle={onToggle}
      onPreview={onPreview}
    />
  );
}

/** The plain browse-list variant — mounts no dnd-kit hook at all. A browse
 *  pane can list up to `PROJECT_CONTEXT_MAX_DOCS` rows; subscribing every one
 *  of them to `useSortable` for a drag that can never activate (`onReorder`
 *  is absent) wastes work on every dnd-kit context update for nothing this
 *  variant ever uses. */
function StaticRow({ item, onToggle, onPreview }: RowProps) {
  return <RowContent item={item} style={s.row} onToggle={onToggle} onPreview={onPreview} />;
}

export function AttachmentList({
  items,
  onToggle,
  onReorder,
  onPreview,
}: {
  items: AttachmentListItem[];
  /** Reports the row's full identity (`repo_id` + `path`, via the whole
   *  `AttachmentListItem`), not just `path`. Two rows can legitimately share
   *  a `path` when they come from different repos (see `itemKey`'s doc
   *  comment) — a caller told only "path" clicked cannot tell WHICH of the
   *  two was actually acted on and has no honest way to resolve it (picking
   *  "the first match" is a silent wrong-row action, worse than an obvious
   *  double-removal). Callers that don't need `repo_id` can simply read
   *  `item.path` off what they're handed. */
  onToggle: (item: AttachmentListItem) => void;
  /** Present only when the list's order is meaningful (agent/skill attachment
   *  sets, AC-14). Receives the FULL reordered path list, not a delta — the
   *  callers persist the whole ordered set on every change. Omit it for a
   *  plain browse list, which then renders no drag handles. */
  onReorder?: (paths: string[]) => void;
  /** Same identity contract as `onToggle` above. */
  onPreview?: (item: AttachmentListItem) => void;
}) {
  const t = useTranslations("context");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (items.length === 0) {
    return <div style={s.empty}>{t("attachments.empty")}</div>;
  }

  const sortable = onReorder != null;

  // Keyed on the composite `repo_id:path` (via `itemKey`), not `path` alone
  // — two different repositories can each discover a document at the same
  // clone-relative path (an agent's direct attachments span every repo it
  // has ever attached from), and a bare `path` key would collide those
  // rows, causing React to reuse one row's DOM/hook state for the other on
  // re-render.
  const rows = items.map((item) =>
    sortable ? (
      <SortableRow key={itemKey(item)} item={item} onToggle={onToggle} onPreview={onPreview} />
    ) : (
      <StaticRow key={itemKey(item)} item={item} onToggle={onToggle} onPreview={onPreview} />
    ),
  );

  if (!onReorder) {
    return (
      <div style={s.list} role="list">
        {rows}
      </div>
    );
  }

  // dnd-kit's `SortableContext`/`useSortable` need the SAME composite id
  // `itemKey` gives the React key — a bare `path` id has the identical
  // collision as the React key, but one layer down: two attached docs from
  // different repos sharing a path would register as duplicate ids, and
  // `active.id`/`over.id` would then resolve to whichever of the two
  // `indexOf` found first, silently dragging or dropping the wrong item.
  const keys = items.map(itemKey);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const next = resolveDragReorder(items, String(active.id), String(over.id));
    if (next) onReorder(next);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={keys} strategy={verticalListSortingStrategy}>
        <div style={s.list} role="list">
          {rows}
        </div>
      </SortableContext>
    </DndContext>
  );
}
