import { describeWorkflow, runWorkflowCases } from "../src/index.js";
import { cases } from "./root-docs.cases.js";

describeWorkflow("root-docs", () => runWorkflowCases(cases));
