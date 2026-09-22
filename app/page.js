import { redirect } from "next/navigation";
import { getSessionUser } from "../lib/auth";
import { getDashboard } from "../lib/ponto";
import PontoApp from "../components/PontoApp";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await getSessionUser();
  if (!user) redirect("/signin");
  return <PontoApp initialData={getDashboard(user.id)} />;
}
