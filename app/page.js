import { getDashboard } from "../lib/ponto";
import PontoApp from "../components/PontoApp";

export const dynamic = "force-dynamic";

export default function Page() {
  return <PontoApp initialData={getDashboard("2026-08")} />;
}
