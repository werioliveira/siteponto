"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";

export default function SignIn() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/signin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: form.get("email"), password: form.get("password") }) });
    const result = await response.json();
    if (!response.ok) {
      setLoading(false);
      return setError(result.error || "Não foi possível entrar.");
    }
    router.replace("/");
    router.refresh();
  }

  return <main className="auth">
    <div className="auth-card">
      <div className="brand"><span className="brand-mark">p</span><b>Ponto</b></div>
      <h1>Entrar</h1>
      <p className="auth-sub">Acesse seu espelho de jornada com email e senha.</p>
      <form onSubmit={submit}>
        <label>Email<input name="email" type="email" required autoComplete="email" placeholder="voce@empresa.com" /></label>
        <label>Senha<input name="password" type="password" required autoComplete="current-password" /></label>
        {error && <p className="notice" role="status">{error}</p>}
        <button className="save" type="submit" disabled={loading}>{loading ? "Entrando…" : "Entrar"}</button>
      </form>
      <p className="auth-switch">Não tem conta? <Link href="/signup">Criar conta</Link></p>
    </div>
  </main>;
}