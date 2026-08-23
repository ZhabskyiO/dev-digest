import { describeWorkflow, runWorkflowCases } from "../src/index.js";
import { cases } from "./package-routing.cases.js";

describeWorkflow("package-routing", () => runWorkflowCases(cases));
