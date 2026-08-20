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
  /** Clone-relative path — the row's key and part of its accessible name. */
  path: string;
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

interface RowProps {
  item: AttachmentListItem;
  sortable: boolean;
  onToggle: (path: string) => void;
  onPreview?: (path: string) => void;
}

function Row({ item, sortable, onToggle, onPreview }: RowProps) {
  const t = useTranslations("context");
  const { name, dir } = splitPath(item.path);
  const tokensLabel = t("tokens.approx", { count: item.tokens });
  const rowLabel = t("tokens.rowLabel", { path: item.path, count: item.tokens });

  // `useSortable` is a hook, so it always runs — a non-sortable list simply
  // never renders the handle that would activate it.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.path,
    disabled: !sortable,
  });

  const style: React.CSSProperties = {
    ...s.row,
    // Transform string built by hand rather than pulling in
    // `@dnd-kit/utilities` — that package is only a transitive dep here, and
    // SkillsTab (this repo's other sortable list) does the same.
    ...(sortable
      ? {
          transform: transform
            ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)`
            : undefined,
          transition,
          opacity: isDragging ? 0.5 : 1,
        }
      : {}),
  };

  return (
    <div ref={sortable ? setNodeRef : undefined} role="listitem" style={style}>
      {sortable && (
        <button
          type="button"
          style={s.grip}
          aria-label={t("attachments.dragHandle", { name })}
          {...attributes}
          {...listeners}
        >
          <Icon.GripVertical size={14} />
        </button>
      )}
      <button
        type="button"
        role="checkbox"
        aria-checked={item.checked}
        aria-label={rowLabel}
        onClick={() => onToggle(item.path)}
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
        <IconBtn icon="Eye" label={t("attachments.preview")} onClick={() => onPreview(item.path)} />
      )}
    </div>
  );
}

export function AttachmentList({
  items,
  onToggle,
  onReorder,
  onPreview,
}: {
  items: AttachmentListItem[];
  onToggle: (path: string) => void;
  /** Present only when the list's order is meaningful (agent/skill attachment
   *  sets, AC-14). Receives the FULL reordered path list, not a delta — the
   *  callers persist the whole ordered set on every change. Omit it for a
   *  plain browse list, which then renders no drag handles. */
  onReorder?: (paths: string[]) => void;
  onPreview?: (path: string) => void;
}) {
  const t = useTranslations("context");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (items.length === 0) {
    return <div style={s.empty}>{t("attachments.empty")}</div>;
  }

  const paths = items.map((i) => i.path);

  const rows = items.map((item) => (
    <Row
      key={item.path}
      item={item}
      sortable={onReorder != null}
      onToggle={onToggle}
      onPreview={onPreview}
    />
  ));

  if (!onReorder) {
    return (
      <div style={s.list} role="list">
        {rows}
      </div>
    );
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = paths.indexOf(String(active.id));
    const to = paths.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    onReorder(arrayMove(paths, from, to));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={paths} strategy={verticalListSortingStrategy}>
        <div style={s.list} role="list">
          {rows}
        </div>
      </SortableContext>
    </DndContext>
  );
}
