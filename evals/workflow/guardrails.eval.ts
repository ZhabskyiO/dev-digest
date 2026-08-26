import { describeWorkflow, runWorkflowCases } from "../src/index.js";
import { cases } from "./guardrails.cases.js";

describeWorkflow("guardrails", () => runWorkflowCases(cases));
