import { getSessionUser } from "../../../lib/auth";
import { getProfile, updateProfile } from "../../../lib/ponto";

export const runtime = "nodejs";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Não autenticado." }, { status: 401 });
  return Response.json(getProfile(user.id));
}

export async function PUT(request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Não autenticado." }, { status: 401 });
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Payload inválido." }, { status: 400 });
  }
  try {
    return Response.json(updateProfile(user.id, body));
  } catch (error) {
    return Response.json({ error: error.message || "Não foi possível salvar o perfil." }, { status: 400 });
  }
}