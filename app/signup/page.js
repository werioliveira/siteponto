"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";

export default function SignUp() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [scheduleChanged, setScheduleChanged] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const body = {
      email: form.get("email"),
      password: form.get("password"),
      name: form.get("name"),
      badge: form.get("badge"),
      saturdayWork: form.get("saturdayWork") === "on",
      weeklyHours: (scheduleChanged ? form.get("scheduleWeeklyHours") : form.get("weeklyHours")) || form.get("weeklyHours") || undefined,
    };
    if (scheduleChanged) body.scheduleChangedAt = form.get("scheduleChangedAt");
    const response = await fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) {
      setLoading(false);
      return setError(result.error || "Não foi possível criar a conta.");
    }
    router.replace("/");
    router.refresh();
  }

  return <main className="auth">
    <div className="auth-card">
      <div className="brand"><span className="brand-mark">p</span><b>Ponto</b></div>
      <h1>Criar conta</h1>
      <p className="auth-sub">Registre-se para controlar seu espelho de jornada. Email e senha são obrigatórios; o restante pode ser ajustado depois no perfil.</p>
      <form onSubmit={submit}>
        <label>Email<input name="email" type="email" required autoComplete="email" placeholder="voce@empresa.com" /></label>
        <label>Senha<input name="password" type="password" required minLength={6} autoComplete="new-password" placeholder="mínimo de 6 caracteres" /></label>
        <label>Nome completo<input name="name" type="text" autoComplete="name" placeholder="Como no registro" /></label>
        <label>Número de cadastro (chapa)<input name="badge" type="text" placeholder="Ex.: 005638" /></label>
        <label>Carga horária semanal (h)<input name="weeklyHours" type="number" step="0.5" min="1" max="60" placeholder="Ex.: 44" /></label>
        <label className="auth-check">
          <input name="saturdayWork" type="checkbox" />
          Trabalho sábados alternados
        </label>
        <label className="auth-check">
          <input type="checkbox" checked={scheduleChanged} onChange={(e) => setScheduleChanged(e.target.checked)} />
          Houve alteração de horário
        </label>
        {scheduleChanged && <>
          <label>Nova carga horária semanal (h)<input name="scheduleWeeklyHours" type="number" step="0.5" min="1" max="60" placeholder="Nova jornada em horas" /></label>
          <label>Vigente a partir de<input name="scheduleChangedAt" type="date" /></label>
        </>}
        {error && <p className="notice" role="status">{error}</p>}
        <button className="save" type="submit" disabled={loading}>{loading ? "Criando…" : "Criar conta"}</button>
      </form>
      <p className="auth-switch">Já tem conta? <Link href="/signin">Entrar</Link></p>
    </div>
  </main>;
}