import type { WorkflowCase } from "../src/index.js";

/**
 * Systemic ("workflow") tier — asserts the real on-disk harness (CLAUDE.md + skills + subagents,
 * loaded via settingSources:["project"]) behaves as documented. Organized by scenario, not by a
 * single artifact, because these behaviors are cross-cutting.
 *
 * Budget: 7 Claude sessions total.
 *   - 3 × trace     → 1 session each                      = 3
 *   - 2 × dispatch                                        = 2
 *   - 1 × activation pair (positive + near-miss negative) = 2
 *
 * `trace` folds several assertions into ONE session (cheaper, coarser) and stops early once its
 * evidence is in — so a dispatch-bearing trace never waits out the nested subagent's full run.
 */
export const cases: WorkflowCase[] = [
  // --- trace (1 session): CLAUDE.md "Read When" routing + subagent dispatch, together -----------
  {
    kind: "trace",
    // Endpoint must NOT already exist, or the model reviews the existing code inline instead of
    // planning-then-dispatching. GET /reviews/:id/export is genuinely absent from routes.ts.
    // The API conventions (schema-first Zod validation, plugin order, DI adapters) live in
    // server/CLAUDE.md — this repo has no server/docs/api-contracts.md (server/docs/ is empty).
    //
    // Two reviewers exist. Their descriptions pin the split: a request that names
    // "architecture-reviewer" explicitly ALWAYS goes to the full reviewer (the -lite description
    // says NEVER substitute when named); an unnamed PR-sized request prefers -lite (next case);
    // multi-module audits go to the full one (dispatch case below). Before the descriptions were
    // sharpened (2026-08-23) Haiku's pick for this prompt flipped between consecutive runs.
    name: "API-route task reads server/CLAUDE.md AND pulls the architecture-reviewer by name",
    prompt:
      "Я планую додати НОВИЙ, ще не реалізований ендпоінт GET /reviews/:id/export (віддає ревʼю як " +
      "markdown). Спершу звірся з конвенціями пакета server у цьому репо. Потім ОБОВʼЯЗКОВО запусти " +
      "сабагента architecture-reviewer, щоб він оцінив мій план на відповідність onion-шарам — не рецензуй сам.",
    expectFilesRead: ["server/CLAUDE.md"],
    expectSubagents: ["architecture-reviewer"],
    maxTurns: 8,
  },
  {
    kind: "dispatch",
    // Same PR-sized change, agent NOT named → the harness should route to the cheap lite reviewer.
    name: "unnamed PR-sized review request dispatches architecture-reviewer-lite",
    prompt:
      "Я додаю один новий ендпоінт GET /reviews/:id/export у server/src/modules/reviews — невелика " +
      "зміна в одному модулі, 2–3 файли. Запусти відповідного сабагента-рецензента архітектури, щоб " +
      "швидко перевірити план на onion-шари — не рецензуй сам.",
    expectSubagent: "architecture-reviewer-lite",
    maxTurns: 6,
  },
  {
    kind: "dispatch",
    // The other side of the split: a multi-module audit must go to the FULL architecture-reviewer.
    name: "multi-module audit dispatches the full architecture-reviewer",
    prompt:
      "Проведи повний архітектурний аудит усіх трьох пакетів одразу — server, reviewer-core і client — " +
      "на відповідність onion-шарам, DI-дисципліні та ізоляції reviewer-core. Це великий мультимодульний " +
      "аудит, не PR-розміру. Запусти відповідного сабагента-рецензента архітектури — не аудитуй сам.",
    expectSubagent: "architecture-reviewer",
    maxTurns: 6,
  },

  // --- trace (1 session): two "Read When" rows at once -----------------------------------------
  {
    kind: "trace",
    // Tests the CLAUDE.md "Read When" routing, so the prompt must push toward CONSULTING the docs,
    // not exploring source. Earlier phrasing ("розберись, як усе влаштовано") sent the model straight
    // into schema.ts / pipeline.run.ts and it never opened the routed doc. One anchor doc keeps this a
    // deterministic routing check — asserting two docs in one session is inherently flaky.
    // reviewer-core/CLAUDE.md routes "Pipeline diagram + public API" to reviewer-core/README.md;
    // this repo has no reviewer-core/docs/pipeline.md (reviewer-core/docs/ is empty).
    name: "pipeline task follows CLAUDE.md routing to the reviewer-core README",
    // Asks for the mermaid DIAGRAM specifically: reviewer-core/CLAUDE.md has a text "Pipeline"
    // section of its own, and a cheaper model stops there unless the diagram is what's wanted.
    prompt:
      "Я збираюся змінити review pipeline у reviewer-core. Перш ніж торкатися коду, мені потрібна " +
      "mermaid-діаграма pipeline. Звірся з настановами пакета (його CLAUDE.md), у якому документі " +
      "лежить ця діаграма, і прочитай саме той документ.",
    expectFilesRead: ["reviewer-core/README.md"],
    maxTurns: 8,
  },

  // --- trace (1 session): CLAUDE.md "Hit unexpected behavior" routing -> gotchas ----------------
  // Was a contrast case, but the control run (empty tmpdir) could still reach the real repo by
  // absolute path and read gotchas.md, making the negative flaky. As a single-session trace it
  // reliably checks the same routing rule: in the real repo, the discovery prompt reads gotchas.md.
  {
    kind: "trace",
    name: "CLAUDE.md routes a gotchas lookup to reviewer-core/insights",
    prompt:
      "У reviewer-core я стикнувся з несподіваною поведінкою — щось працює не так, як я очікував. " +
      "За настановами цього репо, де це вже могло бути задокументовано? Прочитай той файл.",
    expectFilesRead: ["reviewer-core/insights/gotchas.md"],
    maxTurns: 5,
  },

  // --- activation pair (2 sessions): positive + near-miss negative ------------------------------
  {
    kind: "activation",
    name: "engineering-insights activates on a genuine discovery",
    prompt:
      "Щойно з'ясував, чому pgvector-запит повертав нуль рядків — розмірність колонки не збіглася " +
      "після зміни моделі ембедингів. Хочу це зафіксувати, щоб більше не наступати.",
    skill: "engineering-insights",
    shouldActivate: true,
    maxTurns: 4,
  },
  {
    kind: "activation",
    name: "near-miss negative — explaining the same topic must NOT record an insight",
    prompt:
      "Поясни, як у pgvector працюють розмірності колонок і чому невідповідність повертає нуль рядків.",
    skill: "engineering-insights",
    shouldActivate: false,
    maxTurns: 4,
  },
];
