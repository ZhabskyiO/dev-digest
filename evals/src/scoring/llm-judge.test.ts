import { describe, it, expect } from "vitest";
import { parseJudgeJson } from "./llm-judge.js";

describe("parseJudgeJson", () => {
  it("parses well-formed JSON unchanged", () => {
    const obj = { results: [{ practice: "p", passed: true, evidence: 'line "a\\nb" \\u00e9 path\\\\x' }] };
    expect(parseJudgeJson(JSON.stringify(obj))).toEqual(obj);
  });

  it("repairs invalid escapes a cheap judge emits inside evidence quotes", () => {
    const raw = '{"results":[{"practice":"fs","passed":true,"evidence":"import \\_ from \\"node:fs\\" \\- bad \\. escape"}]}';
    expect(() => JSON.parse(raw)).toThrow(/escaped/i);
    const parsed = parseJudgeJson(raw) as { results: { evidence: string }[] };
    expect(parsed.results[0].evidence).toBe('import \\_ from "node:fs" \\- bad \\. escape');
  });

  it("still throws on genuinely broken JSON", () => {
    expect(() => parseJudgeJson('{"results": [')).toThrow();
  });
});
