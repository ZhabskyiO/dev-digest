import type { SkillCase } from "../../src/index.js";

const COMPONENT = `function FindingsPanel({ findings, filter }) {
  const [visible, setVisible] = useState([]);
  const [count, setCount] = useState(0);
  useEffect(() => {
    const v = findings.filter(f => filter === "all" || f.severity === filter);
    setVisible(v);
  }, [findings, filter]);
  useEffect(() => { setCount(visible.length); }, [visible]);

  const renderRow = (f) => <li key={Math.random()}>{f.title}</li>;

  return (
    <div>
      <h2>{count} findings</h2>
      <ul>{visible.map(renderRow)}</ul>
      <FilterBar options={["all", "high", "low"]} onChange={(v) => setFilter(v)} />
    </div>
  );
}`;

export const cases: SkillCase[] = [
  {
    name: "review catches derived state in useState+useEffect, chained effects, render factory, random keys, inline array prop",
    kind: "quality",
    prompt: `Review this React component and rewrite it.\n\n${COMPONENT}`,
    practices: [
      "flags visible and count as derived state that must be computed during render (const visible = findings.filter(...); const count = visible.length), removing both useEffects — and labels it CRITICAL / 'derive, don't store'",
      "flags the chained useEffects (one effect setting state that triggers another) as a sign of derived state",
      "flags renderRow as a render factory (camelCase function returning JSX) and replaces it with a PascalCase component or inline JSX in the map",
      "flags key={Math.random()} and replaces it with a stable id from the finding",
      "flags the inline options array literal passed to FilterBar and hoists it to a module-level constant",
    ],
    threshold: 0.6,
    maxTurns: 8,
  },
];
