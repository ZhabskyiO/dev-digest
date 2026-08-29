/* AgentColumns — Columns mode of the Multi-Agent Review results view. One
   column per agent in the multi-run (T12). The parent owns:
   - the single `useRunEvents` subscription (this component never opens its
     own EventSource, it only reads the `liveEvents` it's handed and filters
     by `event.runId`, AC-34);
   - the refetch of `columns` itself (a status flip to a terminal state is
     just a normal prop update — this component makes no requests of its
     own);
   - mounting `RunTraceDrawer` for whichever `run_id` `onOpenTrace` reports
     (AC-35).
   Horizontal scroll, no column cap (Q7). */
"use client";

import React from "react";
import type { AgentColumn, RunEvent } from "@devdigest/shared";
import { AgentColumnCard } from "./AgentColumnCard";
import { s } from "./styles";

export interface AgentColumnsProps {
  /** One entry per agent in the multi-run. Re-rendering with an updated
   *  `status` (e.g. after the parent's poll picks up completion) is what
   *  drives the running → terminal transition — no action from this
   *  component. */
  columns: AgentColumn[];
  /** The parent's shared SSE event stream, covering every currently-running
   *  run in this multi-run. */
  liveEvents: RunEvent[];
  /** Opens the parent's `RunTraceDrawer` for this specific run id. */
  onOpenTrace: (runId: string) => void;
}

export function AgentColumns({ columns, liveEvents, onOpenTrace }: AgentColumnsProps) {
  return (
    <div style={s.scroller}>
      {columns.map((column) => (
        <AgentColumnCard
          key={column.run_id}
          column={column}
          liveEvents={liveEvents}
          onOpenTrace={onOpenTrace}
        />
      ))}
    </div>
  );
}
