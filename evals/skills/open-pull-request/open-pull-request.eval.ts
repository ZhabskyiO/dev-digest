import { describeSkill, runSkillCases } from "../../src/index.js";
import { cases } from "./open-pull-request.cases.js";

describeSkill("open-pull-request", () => runSkillCases("open-pull-request", cases));
