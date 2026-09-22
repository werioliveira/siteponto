import { AuthError, createUser, startSession } from "../../../../lib/auth";
import { getProfile } from "../../../../lib/ponto";

export const runtime = "nodejs";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Payload inválido." }, { status: 400 });
  }
  try {
    const userId = createUser(body);
    await startSession(userId);
    return Response.json({ ok: true, profile: getProfile(userId) }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) return Response.json({ error: error.message }, { status: 400 });
    console.error("signup failed:", error);
    return Response.json({ error: "Não foi possível criar a conta." }, { status: 500 });
  }
}
