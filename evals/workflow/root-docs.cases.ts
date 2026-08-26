import type { WorkflowCase } from "../src/index.js";

/**
 * Root CLAUDE.md "Docs" links and the insights protocol. Each case asks a question whose answer
 * the root CLAUDE.md explicitly routes to one document, and asserts that document was opened.
 *
 * Budget: 6 sessions (6 × trace).
 */
export const cases: WorkflowCase[] = [
  {
    kind: "trace",
    // Root CLAUDE.md: "Test strategy across all suites: TESTING.md".
    name: "test-strategy question reads TESTING.md",
    prompt:
      "У який тестовий сьют цього репо має піти DB-backed тест репозиторію (з реальним Postgres) " +
      "і як такі тести відділені від hermetic? За документацією репо — прочитай документ про стратегію тестів.",
    expectFilesRead: ["TESTING.md"],
    maxTurns: 6,
  },
  {
    kind: "trace",
    // Root CLAUDE.md: "Reviewer system prompts: docs/agent-prompts/".
    name: "reviewer-prompt change reads docs/agent-prompts/",
    prompt:
      "Хочу змінити системний промпт security-рев'юера. Знайди за документацією репо, де живуть " +
      "промпти рев'юерів, і прочитай саме промпт security-рев'юера.",
    expectFilesRead: ["docs/agent-prompts/security-reviewer.md"],
    maxTurns: 6,
  },
  {
    kind: "trace",
    // Root CLAUDE.md: "Architecture and per-package diagrams: README.md". Anchored with `./` so a
    // nested README (server/README.md, client/README.md) cannot satisfy it.
    name: "architecture question reads the ROOT README.md",
    prompt:
      "Поясни, як чотири пакети цього репо (server, client, reviewer-core, e2e) залежать один від " +
      "одного. Спирайся на документ з архітектурою, на який вказує CLAUDE.md, — прочитай його.",
    expectFilesRead: ["./README.md"],
    maxTurns: 6,
  },

  // --- Insights protocol: "Before working in a module, read its insights/ folder and the root one."
  {
    kind: "trace",
    name: "starting work in client reads client/insights/INSIGHTS.md",
    prompt:
      "Починаю працювати в пакеті client. За insights-протоколом цього репо — що саме треба " +
      "прочитати перед початком роботи в модулі? Прочитай файл з тим, що працює (INSIGHTS) для client.",
    expectFilesRead: ["client/insights/INSIGHTS.md"],
    maxTurns: 6,
  },
  {
    kind: "trace",
    // The same protocol says "and the root one" — a separate session so the assertion stays single-doc.
    name: "starting work in server reads the ROOT insights/gotchas.md too",
    prompt:
      "Починаю працювати в пакеті server. За insights-протоколом цього репо треба прочитати не лише " +
      "insights модуля, а й кореневі. Прочитай кореневий файл gotchas.",
    expectFilesRead: ["./insights/gotchas.md"],
    maxTurns: 6,
  },
  {
    kind: "trace",
    // Same "unexpected behavior → gotchas" routing that review-workflow covers for reviewer-core,
    // here for server (its gotchas.md has a "Recurring Errors & Fixes" section).
    name: "server error lookup reads server/insights/gotchas.md",
    prompt:
      "У server тести падають з помилкою, якої я не очікував. За настановами цього репо, де вже " +
      "можуть бути задокументовані повторювані помилки пакета server та їх виправлення? Прочитай той файл.",
    expectFilesRead: ["server/insights/gotchas.md"],
    maxTurns: 6,
  },
];
