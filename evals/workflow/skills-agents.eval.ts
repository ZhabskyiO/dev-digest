import { describeWorkflow, runWorkflowCases } from "../src/index.js";
import { cases } from "./skills-agents.cases.js";

describeWorkflow("skills-agents", () => runWorkflowCases(cases));
