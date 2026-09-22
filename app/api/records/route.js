import { getDashboard, saveRecord } from "../../../lib/ponto";

export const runtime = "nodejs";

export async function GET(request) {
  const month = new URL(request.url).searchParams.get("month");
  return Response.json(getDashboard(month));
}

export async function POST(request) {
  const body = await request.json();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date || "")) return Response.json({ error: "Data inválida." }, { status: 400 });
  const punches = Array.isArray(body.punches) ? body.punches : [];
  const allowance = String(body.allowance || "");
  if (allowance && !/^([01]\d|2[0-3]):[0-5]\d$/.test(allowance)) return Response.json({ error: "Abono invalido." }, { status: 400 });
  if (punches.some((item) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(item))) return Response.json({ error: "Use horários no formato HH:MM." }, { status: 400 });
  return Response.json(saveRecord({ date: body.date, punches, note: String(body.note || "").trim(), allowance }));
}
