import type { WorkflowCase } from "../src/index.js";

/**
 * Per-package CLAUDE.md routing. The root CLAUDE.md says: "Each dir has its own CLAUDE.md; read it
 * before working in that dir." Every case below frames a task INSIDE one package and asserts the
 * session opened that package's CLAUDE.md (or the doc it links to) before acting.
 *
 * Rules of thumb (learned from review-workflow.cases.ts):
 *   - One anchor doc per session — asserting two docs in one trace is inherently flaky.
 *   - Phrase the prompt toward CONSULTING the rules, not exploring source, or the model dives
 *     straight into code and never opens the routed doc.
 *   - The session is read-only (WORKFLOW_ALLOWED_TOOLS), so "I'm about to change X" is safe.
 *
 * Budget: 8 sessions (8 × trace).
 */
export const cases: WorkflowCase[] = [
  // --- server ---------------------------------------------------------------------------------
  {
    kind: "trace",
    // server/CLAUDE.md: "Validation is schema-first ... Never hand-roll Schema.parse(req.body)".
    name: "server task reads server/CLAUDE.md before touching a route",
    prompt:
      "Я додаю новий роут у server/src/modules/reviews. Як у цьому репо прийнято валідувати body " +
      "запиту? Перш ніж щось пропонувати, звірся з правилами пакета server.",
    expectFilesRead: ["server/CLAUDE.md"],
    maxTurns: 6,
  },
  {
    kind: "trace",
    // server/CLAUDE.md "Docs": "Request/DI flow, API map, full env table: README.md".
    name: "server API-map question follows server/CLAUDE.md to server/README.md",
    prompt:
      "Мені потрібна карта всіх HTTP-ендпоінтів API та схема request/DI flow пакета server. " +
      "За настановами пакета — в якому документі це описано? Прочитай саме його.",
    expectFilesRead: ["server/README.md"],
    maxTurns: 6,
  },

  // --- client ---------------------------------------------------------------------------------
  {
    kind: "trace",
    // client/CLAUDE.md: "All server data goes through a hook in src/lib/hooks/* → src/lib/api.ts.
    // Do not call fetch directly from a component."
    name: "client task reads client/CLAUDE.md before adding data fetching",
    prompt:
      "Роблю в client новий компонент, який показує список pull request-ів репозиторію. " +
      "Де за правилами цього пакета має жити завантаження даних із API? Спершу звірся з правилами пакета client.",
    expectFilesRead: ["client/CLAUDE.md"],
    maxTurns: 6,
  },

  // --- reviewer-core --------------------------------------------------------------------------
  {
    kind: "trace",
    // reviewer-core/CLAUDE.md "The one hard rule": pure — no fs, no DB, no network of its own.
    name: "reviewer-core task reads reviewer-core/CLAUDE.md before adding a side effect",
    prompt:
      "Хочу кешувати ембединги на диск прямо всередині reviewer-core, щоб не перераховувати їх. " +
      "Перевір за правилами цього пакета, чи це взагалі дозволено, перш ніж відповідати.",
    expectFilesRead: ["reviewer-core/CLAUDE.md"],
    maxTurns: 6,
  },

  // --- e2e ------------------------------------------------------------------------------------
  {
    kind: "trace",
    // e2e/CLAUDE.md: flows are specs/NN-name.flow.json, deterministic locators, read-only seeded data.
    name: "e2e task reads e2e/CLAUDE.md before writing a flow",
    prompt:
      "Додаю новий browser-flow для сторінки /agents у пакеті e2e. " +
      "Звірся з правилами пакета e2e щодо того, як пишуться flows і що в них заборонено.",
    expectFilesRead: ["e2e/CLAUDE.md"],
    maxTurns: 6,
  },
  {
    kind: "trace",
    // e2e/CLAUDE.md "Docs": "Flow anatomy, env knobs, coverage table: README.md".
    name: "e2e coverage question follows e2e/CLAUDE.md to e2e/README.md",
    // Demands the TABLE's contents, not facts about e2e: e2e/CLAUDE.md carries env knobs and
    // conventions itself, and a cheaper model answered from there without opening the README
    // (CI, gemini-2.5-flash 0/2). Only the README holds the coverage table.
    prompt:
      "Мені потрібна сама таблиця покриття browser-flows пакета e2e — які flows існують і що кожен " +
      "покриває. За настановами пакета знайди, в якому документі ця таблиця, відкрий його і перекажи її рядки.",
    expectFilesRead: ["e2e/README.md"],
    maxTurns: 6,
  },

  // --- cross-package --------------------------------------------------------------------------
  // A change to the shared contract touches two packages. Both CLAUDE.md files carry the rule
  // (canonical copy = server/src/vendor/shared); we assert one per session, not both at once.
  {
    kind: "trace",
    name: "shared-contract change reads server/CLAUDE.md (canonical vendor copy rule)",
    prompt:
      "Хочу додати поле `summary` до контракту Review у @devdigest/shared. Контракт є і в server, і в client. " +
      "За правилами пакета server (його CLAUDE.md) — де канонічна копія і як її правильно змінювати? " +
      "Спершу прочитай правила пакета, а не сам контракт.",
    expectFilesRead: ["server/CLAUDE.md"],
    maxTurns: 6,
  },
  {
    kind: "trace",
    name: "shared-contract change reads client/CLAUDE.md (vendored copy is not a fork)",
    prompt:
      "Хочу додати поле `summary` до контракту Review у @devdigest/shared і показати його в UI. " +
      "За правилами пакета client — чи можна правити копію в client/src/vendor/shared напряму? Звірся з правилами пакета.",
    expectFilesRead: ["client/CLAUDE.md"],
    maxTurns: 6,
  },
];
