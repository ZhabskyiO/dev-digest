/* BlastCard — the PR's potential impact map, rendered on the Overview tab.

   Unlike IntentCard next to it, NOTHING here is a model claim: every symbol,
   caller, endpoint and cron comes out of the repo-intel index, so each row is a
   fact a reviewer can open and check. That is why callers are rendered as
   clickable file:line links rather than prose.

   The one thing this card must never do is make a thin map look like a small
   blast radius. Two guards: `caller_count` is shown whenever the list was
   truncated, and any index short of `ready` gets a banner above the tree. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Skeleton, Icon, Button, MonoLink } from "@devdigest/ui";
import type { BlastSymbol } from "@devdigest/shared";
import { useBlastRadius } from "@/lib/hooks/blast";
import { githubPrUrl } from "@/lib/github-urls";
import { callerHref, layoutGraph } from "./helpers";
import { s } from "./styles";

interface BlastCardProps {
  prId: string | null;
  repoFullName: string | null;
  defaultBranch: string | null;
}

type View = "tree" | "graph";

export function BlastCard({ prId, repoFullName, defaultBranch }: BlastCardProps) {
  const t = useTranslations("blast");
  const tBrief = useTranslations("brief");
  const tCommon = useTranslations("common");
  const [view, setView] = React.useState<View>("tree");
  const { data, isLoading, isError, refetch } = useBlastRadius(prId);

  const title = tBrief("block.blast");

  if (isLoading) {
    return (
      <section style={s.section}>
        <SectionLabel icon="Workflow">{title}</SectionLabel>
        <div style={s.skeletonWrap}>
          <Skeleton height={16} width="55%" />
          <Skeleton height={48} />
        </div>
      </section>
    );
  }

  if (isError || data == null) {
    return (
      <section style={s.section}>
        <SectionLabel icon="Workflow">{title}</SectionLabel>
        <div role="alert" style={s.errorBox}>
          <div style={s.errorLeft}>
            <Icon.AlertTriangle size={15} style={{ color: "var(--warn)", flexShrink: 0 }} />
            <span>{t("error")}</span>
          </div>
          <Button kind="ghost" size="sm" icon="RefreshCw" onClick={() => refetch()}>
            {tCommon("actions.retry")}
          </Button>
        </div>
      </section>
    );
  }

  // Degraded AND empty is the one case with nothing to show — say why rather
  // than rendering a zeroed stat row, which would read as "no impact".
  if (data.status === "degraded" && data.symbols.length === 0) {
    return (
      <section style={s.section}>
        <SectionLabel icon="Workflow">{title}</SectionLabel>
        <div style={s.unavailableBox}>
          <div style={s.unavailableTitle}>{t("unavailable")}</div>
          <div style={s.unavailableHint}>{data.reason ?? t("unavailableHint")}</div>
        </div>
      </section>
    );
  }

  const viewToggle = (
    <div style={s.viewToggle} role="group">
      {(["tree", "graph"] as const).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={view === v}
          onClick={() => setView(v)}
          style={s.viewBtn(view === v)}
        >
          {t(`view.${v}`)}
        </button>
      ))}
    </div>
  );

  return (
    <section style={s.section}>
      <SectionLabel icon="Workflow" right={viewToggle}>
        {title}
      </SectionLabel>

      <div style={s.box}>
        <div style={s.statRow}>
          <Stat icon="Code" n={data.totals.symbols} label={t("stat.symbols")} />
          <Stat icon="CornerDownRight" n={data.totals.callers} label={t("stat.callers")} />
          <Stat icon="Globe" n={data.totals.endpoints} label={t("stat.endpoints")} />
          <Stat icon="Clock" n={data.totals.crons} label={t("stat.crons")} />
        </div>

        {data.status !== "ready" && (
          <div role="status" style={s.banner(data.status === "degraded" ? "warn" : "muted")}>
            <Icon.AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
            <span>
              <span style={s.bannerTitle}>
                {data.status === "degraded" ? t("degraded") : t("partial")}
              </span>
              {data.reason ? ` — ${data.reason}` : null}
            </span>
          </div>
        )}

        {data.symbols.length === 0 ? (
          <div style={s.emptyBox}>{t("noDownstream", { count: 0 })}</div>
        ) : view === "tree" ? (
          <ul style={s.symbolList}>
            {data.symbols.map((sym) => (
              <SymbolRow
                key={`${sym.file}:${sym.name}`}
                symbol={sym}
                repoFullName={repoFullName}
                indexedSha={data.indexed_sha}
                defaultBranch={defaultBranch}
              />
            ))}
          </ul>
        ) : (
          <GraphView symbols={data.symbols} />
        )}

        {data.prior_prs.length > 0 && (
          <PriorPrs
            prs={data.prior_prs}
            repoFullName={repoFullName}
          />
        )}
      </div>
    </section>
  );
}

function Stat({ icon, n, label }: { icon: keyof typeof Icon; n: number; label: string }) {
  const Glyph = Icon[icon];
  return (
    <span style={s.stat}>
      <Glyph size={13} style={{ color: "var(--text-muted)" }} aria-hidden="true" />
      <span className="tnum" style={s.statNum}>
        {n}
      </span>
      {label}
    </span>
  );
}

function SymbolRow({
  symbol,
  repoFullName,
  indexedSha,
  defaultBranch,
}: {
  symbol: BlastSymbol;
  repoFullName: string | null;
  /** The revision the line numbers below belong to — see `callerHref`. */
  indexedSha: string | null;
  defaultBranch: string | null;
}) {
  const t = useTranslations("blast");
  // The widest-reach symbol is first (the server sorts by caller_count), so
  // opening it by default puts the most useful rows on screen without a click.
  const [open, setOpen] = React.useState(symbol.callers.length > 0);
  const truncated = symbol.caller_count > symbol.callers.length;

  return (
    <li style={s.symbolItem}>
      <button
        type="button"
        style={s.symbolHeader}
        aria-expanded={open}
        aria-label={open ? t("collapseSymbol", { name: symbol.name }) : t("expandSymbol", { name: symbol.name })}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <Icon.ChevronDown size={14} style={{ color: "var(--text-muted)" }} aria-hidden="true" />
        ) : (
          <Icon.ChevronRight size={14} style={{ color: "var(--text-muted)" }} aria-hidden="true" />
        )}
        <Icon.Code size={13} style={{ color: "var(--text-muted)" }} aria-hidden="true" />
        <span className="mono" style={s.symbolName}>
          {symbol.name}()
        </span>
        <span className="tnum" style={s.symbolCount}>
          {truncated
            ? t("callerCountCapped", { shown: symbol.callers.length, count: symbol.caller_count })
            : t("callerCount", { count: symbol.caller_count })}
        </span>
      </button>

      {open && (
        <>
          <ul style={s.callerList}>
            {symbol.callers.map((c) => (
              <li key={`${c.file}:${c.line}`} style={s.callerItem}>
                <Icon.CornerDownRight size={12} aria-hidden="true" />
                <MonoLink href={callerHref(repoFullName, indexedSha, defaultBranch, c.file, c.line)}>
                  {c.file}:{c.line}
                </MonoLink>
              </li>
            ))}
          </ul>

          {(symbol.endpoints.length > 0 || symbol.crons.length > 0) && (
            <ul style={s.chipRow}>
              {symbol.endpoints.map((e) => (
                <li key={`${e.method} ${e.path}`} style={s.chip("endpoint")}>
                  <Icon.Globe size={12} aria-hidden="true" />
                  <span style={s.chipMethod}>{e.method}</span>
                  {e.path}
                </li>
              ))}
              {symbol.crons.map((c) => (
                <li key={c} style={s.chip("cron")}>
                  <Icon.Clock size={12} aria-hidden="true" />
                  {c}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </li>
  );
}

/* A plain SVG rather than a graph library: the layout is three fixed columns
   computed in helpers.ts, so there is nothing for a physics engine to solve and
   the picture stays identical between renders. */
function GraphView({ symbols }: { symbols: BlastSymbol[] }) {
  const t = useTranslations("blast");
  const { nodes, edges, width, height } = React.useMemo(() => layoutGraph(symbols), [symbols]);

  if (nodes.length === 0) return <div style={s.emptyBox}>{t("graph.empty")}</div>;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const tone = ["var(--accent)", "var(--text-secondary)", "var(--ok)"] as const;

  return (
    <div style={s.graphWrap}>
      <svg width={width} height={height} role="img" aria-label={t("graph.ariaLabel")}>
        {edges.map((e) => {
          const from = byId.get(e.from);
          const to = byId.get(e.to);
          if (!from || !to) return null;
          return (
            <line
              key={`${e.from}->${e.to}`}
              x1={from.x + 6}
              y1={from.y}
              x2={to.x - 6}
              y2={to.y}
              stroke="var(--border-strong)"
              strokeWidth={1}
            />
          );
        })}
        {nodes.map((n) => (
          <g key={n.id}>
            <circle cx={n.x} cy={n.y} r={3.5} fill={tone[n.column]} />
            <text
              x={n.x + 9}
              y={n.y + 4}
              fontSize={11}
              fill="var(--text-secondary)"
              fontFamily="var(--font-mono, monospace)"
            >
              {n.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function PriorPrs({
  prs,
  repoFullName,
}: {
  prs: { id: string; number: number; title: string; overlapping_files: number }[];
  repoFullName: string | null;
}) {
  const t = useTranslations("blast");
  const [open, setOpen] = React.useState(false);

  return (
    <div style={s.priorSection}>
      <button type="button" style={s.priorHeader} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon.History size={14} style={{ color: "var(--text-muted)" }} aria-hidden="true" />
        {t("priorPrs")}
        <span className="tnum" style={s.priorOverlap}>
          {prs.length}
        </span>
      </button>

      {open && (
        <ul style={s.priorList}>
          {prs.map((p) => (
            <li key={p.id} style={s.priorItem}>
              <span className="mono tnum" style={s.priorNumber}>
                #{p.number}
              </span>
              {repoFullName ? (
                <MonoLink href={githubPrUrl(repoFullName, p.number)}>{p.title}</MonoLink>
              ) : (
                <span>{p.title}</span>
              )}
              <span className="tnum" style={s.priorOverlap}>
                {t("priorPrOverlap", { count: p.overlapping_files })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
