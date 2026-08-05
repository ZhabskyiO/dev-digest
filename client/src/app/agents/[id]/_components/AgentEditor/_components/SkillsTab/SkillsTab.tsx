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
import { TextInput, Checkbox, Badge, Icon, Skeleton } from "@devdigest/ui";
import type { Agent, Skill } from "@devdigest/shared";
import { useSkills, useAgentSkills, useSetAgentSkills } from "../../../../../../../lib/hooks/skills";
import { filterSkillsByName, reinsertOrder } from "./helpers";
import { s } from "./styles";

/**
 * Skills tab — attach/detach skills from the full catalog and drag-reorder
 * the attached ones. Every change (checkbox toggle or drag-drop) POSTs the
 * whole ordered set of attached skill ids via useSetAgentSkills (the single
 * dual-mode set-and-reorder endpoint — no separate attach/detach/reorder
 * calls). UX: two sections — attached skills are the reorderable
 * (SortableContext) list up top; unattached skills are plain checkable rows
 * below, not part of the drag order.
 */
export function SkillsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const tSkills = useTranslations("skills");
  const { data: catalog, isLoading: catalogLoading } = useSkills();
  const { data: links, isLoading: linksLoading } = useAgentSkills(agent.id);
  const setAgentSkills = useSetAgentSkills();
  const [filter, setFilter] = React.useState("");

  const linkedIds = React.useMemo(
    () =>
      (links ?? [])
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((l) => l.skill_id),
    [links],
  );
  const skillById = React.useMemo(() => new Map((catalog ?? []).map((sk) => [sk.id, sk])), [catalog]);

  const attached = linkedIds.map((id) => skillById.get(id)).filter((sk): sk is Skill => !!sk);
  const linkedIdSet = new Set(linkedIds);
  const unattached = (catalog ?? []).filter((sk) => !linkedIdSet.has(sk.id));

  const visibleAttached = filterSkillsByName(attached, filter);
  const visibleUnattached = filterSkillsByName(unattached, filter);
  const visibleAttachedIds = visibleAttached.map((sk) => sk.id);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const attach = (skillId: string) => {
    setAgentSkills.mutate({ agentId: agent.id, skillIds: [...linkedIds, skillId] });
  };
  const detach = (skillId: string) => {
    setAgentSkills.mutate({ agentId: agent.id, skillIds: linkedIds.filter((id) => id !== skillId) });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = visibleAttachedIds.indexOf(String(active.id));
    const newIndex = visibleAttachedIds.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    const newVisibleOrder = arrayMove(visibleAttachedIds, oldIndex, newIndex);
    const newOrder = reinsertOrder(linkedIds, visibleAttachedIds, newVisibleOrder);
    setAgentSkills.mutate({ agentId: agent.id, skillIds: newOrder });
  };

  if (catalogLoading || linksLoading) {
    return (
      <div style={s.wrap}>
        <Skeleton height={24} width={200} />
        <div style={{ marginTop: 16 }}>
          <Skeleton height={160} />
        </div>
      </div>
    );
  }

  const total = catalog?.length ?? 0;
  const linked = linkedIds.length;

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("skills.title")}</h2>
        <span style={s.countLabel}>{t("skills.enabledCount", { linked, total })}</span>
      </div>
      <div style={s.filterRow}>
        <TextInput value={filter} onChange={setFilter} placeholder={t("skills.filterPlaceholder")} />
      </div>
      <p style={s.hint}>{t("skills.orderHint")}</p>

      {visibleAttached.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={visibleAttachedIds} strategy={verticalListSortingStrategy}>
            <div style={s.list}>
              {visibleAttached.map((skill) => (
                <AttachedRow
                  key={skill.id}
                  skill={skill}
                  typeLabel={tSkills(`listItem.type.${skill.type}`)}
                  dragLabel={t("skills.dragHandleLabel")}
                  onToggle={() => detach(skill.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {visibleUnattached.length > 0 && (
        <>
          <div style={s.sectionLabel}>{t("skills.moreSkillsLabel")}</div>
          <div style={s.list}>
            {visibleUnattached.map((skill) => (
              <UnattachedRow
                key={skill.id}
                skill={skill}
                typeLabel={tSkills(`listItem.type.${skill.type}`)}
                onToggle={() => attach(skill.id)}
              />
            ))}
          </div>
        </>
      )}

      {visibleAttached.length === 0 && visibleUnattached.length === 0 && (
        <p style={s.empty}>{t("skills.noMatch")}</p>
      )}
    </div>
  );
}

/** Attached row — draggable via a dnd-kit sortable handle, checked, detachable. */
function AttachedRow({
  skill,
  typeLabel,
  dragLabel,
  onToggle,
}: {
  skill: Skill;
  typeLabel: string;
  dragLabel: string;
  onToggle: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: skill.id });
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)` : undefined,
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <div ref={setNodeRef} style={{ ...s.row, ...style }}>
      <button type="button" aria-label={dragLabel} style={s.dragHandle} {...attributes} {...listeners}>
        <Icon.GripVertical size={14} />
      </button>
      <Checkbox checked onChange={onToggle} />
      <span style={s.name}>{skill.name}</span>
      <Badge color="var(--text-secondary)">{typeLabel}</Badge>
    </div>
  );
}

/** Unattached row — plain checkable, not part of the drag order. */
function UnattachedRow({ skill, typeLabel, onToggle }: { skill: Skill; typeLabel: string; onToggle: () => void }) {
  return (
    <div style={s.row}>
      <span style={s.dragHandleSpacer} />
      <Checkbox checked={false} onChange={onToggle} />
      <span style={s.name}>{skill.name}</span>
      <Badge color="var(--text-secondary)">{typeLabel}</Badge>
    </div>
  );
}
