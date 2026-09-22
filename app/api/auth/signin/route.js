import { AuthError, authenticate, startSession } from "../../../../lib/auth";

export const runtime = "nodejs";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Payload inválido." }, { status: 400 });
  }
  try {
    const userId = authenticate(body.email, body.password);
    await startSession(userId);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) return Response.json({ error: error.message }, { status: 401 });
    console.error("signin failed:", error);
    return Response.json({ error: "Não foi possível entrar." }, { status: 500 });
  }
}
