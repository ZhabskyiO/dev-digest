import { describeSkill, runSkillCases } from "../../src/index.js";
import { cases } from "./frontend-architecture.cases.js";

describeSkill("frontend-architecture", () => runSkillCases("frontend-architecture", cases));
