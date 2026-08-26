import type { SkillCase } from "../../src/index.js";

const ROUTE = `// server/src/routes/preview.ts
import jwt from "jsonwebtoken";
router.get("/preview", async (req, res) => {
  const user = jwt.decode(req.headers.authorization.split(" ")[1]);
  const target = req.query.url;
  const upstream = await fetch(target);
  const html = await upstream.text();
  const meta = await fetch(process.env.METADATA_SERVICE_URL + "/lookup");
  res.send("<div>" + html + "</div>");
});
router.delete("/posts/:id", auth, async (req, res) => {
  await Post.findByIdAndDelete(req.params.id);
  res.sendStatus(204);
});`;

export const cases: SkillCase[] = [
  {
    name: "confidence-based review: reports SSRF, jwt.decode, reflected XSS and IDOR; does not flag the env-var fetch",
    kind: "quality",
    prompt: `Security review of this Express code. Report only what you are confident about and give fixes.\n\n${ROUTE}`,
    practices: [
      "reports fetch(req.query.url) as SSRF with HIGH confidence because the URL is attacker-controlled, with a fix (allowlist of hosts / URL validation), and explicitly does NOT flag fetch(process.env.METADATA_SERVICE_URL + ...) because the value is server-controlled",
      "reports jwt.decode() as an authentication failure (A07): it does not verify the signature, fix is jwt.verify(token, secret)",
      "reports sending the fetched html back unescaped as XSS (A05) with a fix (sanitize with DOMPurify or do not reflect remote HTML; set CSP)",
      "reports the DELETE /posts/:id handler as broken access control / IDOR (A01): authenticated but no ownership check — fix compares the post author to req.user (with an admin escape hatch)",
      "each reported finding carries a confidence level and references the OWASP category, and the answer does not pad the list with LOW-confidence theoretical items",
    ],
    threshold: 0.6,
    maxTurns: 8,
  },
];
