import { describeAgent, runAgentCases } from "../../src/index.js";
import { cases } from "./architecture-reviewer-lite.cases.js";

describeAgent("architecture-reviewer-lite", () => runAgentCases("architecture-reviewer-lite", cases));
