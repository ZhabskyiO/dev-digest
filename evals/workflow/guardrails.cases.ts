import type { WorkflowCase } from "../src/index.js";

/**
 * Guardrails and gotcha knowledge from the ROOT CLAUDE.md. These use the trace extensions
 * (`expectFilesNotRead`, `expectOutput`, `expectOutputNot`), which disable early stop — the session
 * runs to its final answer, so keep maxTurns tight.
 *
 * Output assertions are substring checks on prose, so they only assert things the model MUST name
 * to be correct (a command, a path). Avoid negative output checks on phrases the model would
 * naturally repeat while warning against them (e.g. "down -v").
 *
 * Budget: 5 sessions (5 × trace).
 */
export const cases: WorkflowCase[] = [
  // --- "server/clones/** — never edit, always exclude from search" ----------------------------
  {
    kind: "trace",
    // server/clones/ holds a full copy of this repo, so a naive search returns every hit twice —
    // once from the real tree and once from the clone. Positive evidence is the ANSWER naming the
    // real definition site (model-agnostic: Gemini greps without opening files, Haiku opens them);
    // the guard is that nothing under the clone was opened. (No expectOutputNot on "server/clones/":
    // a correct answer often SAYS "excluded server/clones/ per CLAUDE.md", which would trip it.)
    name: "repo-wide search never reads server/clones/",
    prompt:
      "Знайди всі місця в цьому репо, де визначається або викликається assemblePrompt, і перелічи " +
      "шляхи файлів. Дотримуйся правил CLAUDE.md щодо того, що виключати з пошуку.",
    expectOutput: ["reviewer-core/src/prompt.ts"],
    expectFilesNotRead: ["server/clones/"],
    maxTurns: 8,
  },

  // --- Gotchas: the answer must carry the documented fix -------------------------------------
  {
    kind: "trace",
    // CLAUDE.md: "Migrations never run on boot — cd server && pnpm db:migrate. The symptom of
    // forgetting is `relation ... does not exist`."
    name: "`relation does not exist` is answered with db:migrate",
    prompt:
      "Після `./scripts/dev.sh` API падає з помилкою `relation \"reviews\" does not exist`. " +
      "Що це за проблема за настановами цього репо і яка команда її виправляє? Відповідай коротко.",
    expectOutput: ["db:migrate"],
    maxTurns: 5,
  },
  {
    kind: "trace",
    // CLAUDE.md: "Port 5432 conflicts usually mean a *native* Postgres is running, not another
    // container — check /Library/LaunchDaemons/ before blaming Docker."
    name: "port 5432 conflict points at a native Postgres / LaunchDaemons",
    prompt:
      "Docker не може підняти Postgres: `bind: address already in use` на порту 5432, але " +
      "`docker ps` не показує жодного контейнера з Postgres. Що радить цей репо перевірити? Відповідай коротко.",
    expectOutput: ["LaunchDaemons"],
    maxTurns: 5,
  },
  {
    kind: "trace",
    // CLAUDE.md: "Secrets live in ~/.devdigest/secrets.json (mode 0600), not in .env or the DB."
    name: "secrets question names ~/.devdigest/secrets.json",
    prompt:
      "Куди в цьому проєкті покласти OpenRouter API-ключ, щоб сервер його підхопив? " +
      "Назви точний файл за настановами репо. Відповідай коротко.",
    expectOutput: ["secrets.json"],
    maxTurns: 5,
  },
  {
    kind: "trace",
    // CLAUDE.md: "Never docker compose down -v ... Use down without -v." The safe command must be
    // named; the dangerous one is NOT asserted absent because a correct answer warns about it.
    name: "dev-DB reset names `docker compose down` and the pgdata volume risk",
    prompt:
      "Хочу зупинити і перезапустити dev-стек Docker цього проєкту, не втративши імпортовані репозиторії " +
      "та ревʼю. Яку команду використати і чого уникати за настановами репо? Відповідай коротко.",
    expectOutput: ["docker compose down", "pgdata"],
    maxTurns: 5,
  },
];
