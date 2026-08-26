import { defineConfig } from "vitest/config";
import TrendReporter from "./src/trend-reporter.js";

export default defineConfig({
  test: {
    // *.eval.ts = model-backed evals; src/**/*.test.ts = the pure stats unit tests.
    include: ["**/*.eval.ts", "src/**/*.test.ts"],
    // Real Claude sessions (and a subagent dispatch) are slow — give them room.
    testTimeout: 240_000,
    hookTimeout: 240_000,
    // Model-backed cases are probabilistic: one retry (= at most TWO sessions per case) absorbs a
    // single flaky run without letting a broken case burn the budget. EVAL_RETRY=0 disables it
    // (use that for eval:repeat / eval:benchmark style measurements, where every run must count).
    retry: Number(process.env.EVAL_RETRY ?? "1"),
    // One session per test; a few files can run concurrently. Keep it modest to stay cheap.
    fileParallelism: true,
    reporters: ["default", new TrendReporter()],
  },
});
