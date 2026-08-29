import { ConfigureRunView } from "./_components/ConfigureRunView";

/* Route: /multi-agent — the global Configure-run page. Thin route entry — the
   view, its styles and i18n are colocated under _components/ConfigureRunView. */
export default function MultiAgentPage() {
  return <ConfigureRunView />;
}
