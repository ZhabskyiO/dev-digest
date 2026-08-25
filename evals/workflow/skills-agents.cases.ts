import type { WorkflowCase } from "../src/index.js";

/**
 * Skills and subagents wired through the on-disk harness (.claude/skills, .claude/agents).
 *
 *   - `activation` comes in PAIRS: a positive that should trigger the skill and a near-miss
 *     negative on the same topic that must not. A lone positive proves nothing about precision.
 *   - `dispatch` has no negative — it only asserts the Agent tool was called with that type, and
 *     stops the moment it is (no waiting for the nested session).
 *
 * README caveat: `activation` asserts the Skill TOOL is invoked. A capable model on a non-Anthropic
 * backend may do the work directly and be counted as a miss — treat it as indicative there.
 *
 * Budget: 8 sessions (3 pairs = 6, 2 dispatch = 2).
 */
export const cases: WorkflowCase[] = [
  // --- pr-self-review: "run before git push / gh pr create / gh pr merge" ----------------------
  {
    kind: "activation",
    // "Check my changes before I push — do NOT open the PR yet" is pr-self-review's own trigger.
    // "open a PR" belongs to open-pull-request (which runs this gate as a step), so the prompt must
    // not ask for the PR, or the harness correctly routes to the other skill.
    name: "pr-self-review activates when the user asks to gate local changes before push",
    prompt:
      "Я закінчив зміни в гілці й збираюся пушити. Перевір мої локальні зміни за правилами цього " +
      "репо — зроби self-review перед push. PR поки НЕ відкривай.",
    skill: "pr-self-review",
    shouldActivate: true,
    // Flaky on cheap CI backends: green on run 32910822439, then on run
    // 32911433189 (gemini-2.5-flash) attempt 1 answered without invoking the
    // skill and attempt 2 timed out at 240s. Activation semantics are only
    // meaningful where the model reliably drives the Skill tool — Anthropic path.
    indicative: true,
    maxTurns: 4,
  },
  {
    kind: "activation",
    name: "near-miss negative — explaining pr-self-review must NOT run it",
    prompt: "Поясни коротко, що саме перевіряє pr-self-review у цьому репо і коли його запускають.",
    skill: "pr-self-review",
    shouldActivate: false,
    // Same pair, opposite flip on run 32911433189: gemini-2.5-flash INVOKED the
    // skill twice when merely asked to explain it (green on the previous run).
    indicative: true,
    maxTurns: 4,
  },

  // --- onion-architecture: "adding an external SDK call in server/ → adapter behind DI" ---------
  {
    kind: "activation",
    name: "onion-architecture activates on a new external SDK in server",
    // Uses the skill's own vocabulary ("onion-шари", "порт/адаптер", "DI-контейнер") — stable on
    // Haiku. The PLAIN phrasing a user would actually type ("Куди в цьому бекенді покласти виклик
    // Slack SDK і як його підключити?") measured 0/3 with only the skill description's trigger
    // terms, and 2/3 once server/CLAUDE.md's adapter rule pointed at the skill (2026-08-23). It is
    // left out of the default suite as flaky; re-measure it with `pnpm eval:repeat` after any
    // change to the description or to server/CLAUDE.md.
    prompt:
      "Додаю в server інтеграцію зі Slack SDK, щоб постити підсумок ревʼю в канал. За onion-шарами " +
      "цього бекенду — в якому шарі має жити виклик SDK, який порт/адаптер для нього завести і як " +
      "підключити через DI-контейнер? Не досліджуй код сам — застосуй правила шарування цього репо.",
    skill: "onion-architecture",
    shouldActivate: true,
    // gemini-2.5-flash answers from general knowledge (0/2) — indicative on non-Anthropic CI.
    indicative: true,
    maxTurns: 6,
  },
  {
    kind: "activation",
    // Same topic (layering, "where does X live"), but in client/ — which the skill description
    // explicitly excludes ("NOT for the client/ frontend (use frontend-architecture)"). A generic
    // "onion vs hexagonal" explainer was tried first and flipped run-to-run on Haiku.
    name: "near-miss negative — a client/ layering question must NOT load onion-architecture",
    prompt:
      "У пакеті client: де має жити бізнес-логіка сторінки /pulls/:number — у page.tsx, у колокованому " +
      "_components/, чи в хуку? Це питання про шари фронтенду, не бекенду.",
    skill: "onion-architecture",
    shouldActivate: false,
    maxTurns: 4,
  },

  // --- open-pull-request: "open / create / raise / submit a PR" --------------------------------
  {
    kind: "activation",
    // Before the two PR skills' descriptions were disambiguated (2026-08-23) this prompt sometimes
    // loaded pr-self-review first ("run before gh pr create") and ran out of turns.
    name: "open-pull-request activates on 'open a PR for this branch'",
    prompt: "Відкрий pull request для поточної гілки в main за конвенціями цього репо.",
    skill: "open-pull-request",
    shouldActivate: true,
    maxTurns: 4,
  },
  {
    kind: "activation",
    name: "near-miss negative — asking about the PR template must NOT open a PR",
    prompt: "Який шаблон опису PR використовує цей репо? Просто покажи його структуру.",
    skill: "open-pull-request",
    shouldActivate: false,
    maxTurns: 4,
  },

  // --- subagent dispatch -----------------------------------------------------------------------
  {
    kind: "dispatch",
    // .claude/agents/doc-writer.md: "Use proactively to write or update documentation".
    name: "documentation request dispatches doc-writer",
    prompt:
      "Задокументуй модуль polling з server/src/modules/polling у server/docs/ — як він працює, " +
      "які в нього інтервали й де конфіг. Використай для цього відповідного сабагента-документатора.",
    expectSubagent: "doc-writer",
    maxTurns: 6,
  },
  {
    kind: "dispatch",
    // .claude/agents/implementation-planner.md: plan before code, never writes product code.
    name: "plan request dispatches implementation-planner",
    prompt:
      "Вимога: додати ендпоінт GET /reviews/:id/export, який віддає ревʼю як markdown. " +
      "Не пиши код — склади Implementation Plan через відповідного сабагента-планувальника.",
    expectSubagent: "implementation-planner",
    maxTurns: 6,
  },
];
