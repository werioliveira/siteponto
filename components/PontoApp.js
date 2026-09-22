"use client";

import { useState, useTransition } from "react";

const monthFormatter = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" });
const dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });

function labelMonth(value) {
  const [year, month] = value.split("-").map(Number);
  const title = monthFormatter.format(new Date(year, month - 1, 1));
  return title[0].toUpperCase() + title.slice(1);
}

function formatDate(value) {
  return dateFormatter.format(new Date(`${value}T12:00:00`));
}

function Report({ report }) {
  const { totals, months } = report;
  const netNegative = totals.net.startsWith("-");
  const scale = Math.max(1, ...months.map((item) => Math.max(item.positivePercent, item.negativePercent)));
  return <section className="report" id="relatorio">
    <div className="report-heading">
      <h2>Acumulado de março a agosto</h2>
      <p className="report-sub">Somatório das diferenças diárias. Abonos e dias sem jornada ficam fora do cálculo.</p>
      <div className={`net-total ${netNegative ? "negative" : ""}`}>
        <span>Saldo líquido do período</span>
        <b>{totals.net}</b>
      </div>
    </div>
    <div className="report-chart" role="img" aria-label={`Horas positivas ${totals.positive}, horas negativas ${totals.negative}, saldo ${totals.net} no período`}>
      <div className="report-scale" aria-hidden="true">
        {months.map((item) => <div className="report-month" key={item.month}>
          <div className="report-bars" style={{ ["--scale"]: scale }}>
            {item.positivePercent > 0 && <i className="credit" style={{ width: `${(item.positivePercent / scale) * 100}%` }} />}
            {item.negativePercent > 0 && <i className="debit" style={{ width: `${(item.negativePercent / scale) * 100}%` }} />}
          </div>
          <div className="report-meta">
            <b>{labelMonth(item.month).slice(0, 3)}</b>
            <span className="credit-text">+{item.positive}</span>
            <span className="debit-text">−{item.negative}</span>
            <strong className={item.net.startsWith("-") ? "negative" : ""}>{item.net}</strong>
          </div>
        </div>)}
      </div>
      <div className="report-axis" aria-hidden="true"><i /><i /><i /><i /><i /></div>
      <div className="report-legend">
        <span><i className="credit-dot" /> Horas positivas</span>
        <span><i className="debit-dot" /> Horas negativas</span>
        <small>Saldo = positivas − negativas</small>
      </div>
    </div>
  </section>;
}

export default function PontoApp({ initialData }) {
  const [data, setData] = useState(initialData);
  const [selected, setSelected] = useState(null);
  const [notice, setNotice] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileNotice, setProfileNotice] = useState("");
  const [isPending, startTransition] = useTransition();
  const user = data.user || { name: "Usuário", badge: "", role: "" };

  function changeMonth(month) {
    startTransition(async () => {
      const response = await fetch(`/api/records?month=${month}`);
      if (response.status === 401) return window.location.assign("/signin");
      setData(await response.json());
      setSelected(null);
    });
  }

  function loadProfile() {
    setProfileOpen(true);
    setProfileNotice("");
  }

  async function saveProfile(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.get("name"), badge: form.get("badge"), weeklyHours: form.get("weeklyHours"), saturdayWork: form.get("saturdayWork") === "on", scheduleChangedAt: form.get("scheduleChangedAt") }) });
    const result = await response.json();
    if (!response.ok) return setProfileNotice(result.error || "Não foi possível salvar o perfil.");
    setProfileOpen(false);
    changeMonth(data.activeMonth);
  }

  async function signOut() {
    await fetch("/api/auth/signout", { method: "POST" });
    window.location.assign("/signin");
  }

  async function save(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const punches = [form.get("in1"), form.get("out1"), form.get("in2"), form.get("out2")].filter(Boolean);
    const response = await fetch("/api/records", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: form.get("date"), punches, note: form.get("note"), allowance: form.get("allowance") }) });
    const result = await response.json();
    if (!response.ok) return setNotice(result.error || "Não foi possível salvar.");
    setNotice(`Registro de ${formatDate(result.date)} salvo em SQLite.`);
    changeMonth(result.date.slice(0, 7));
  }

  const formRecord = selected || { date: data.activeMonth + "-01", punches: [], note: "" };
  const punches = [...formRecord.punches, "", "", "", ""].slice(0, 4);

  const firstName = user.name ? user.name.split(" ")[0].toLowerCase() : "usuário";
  const initials = user.name ? user.name.split(" ").map((word) => word[0]).slice(0, 2).join("") : "?";
  const currentRule = data.rules?.length ? [...data.rules].at(-1) : null;
  const weeklyHoursLabel = currentRule ? `${Math.floor(currentRule.weeklyMinutes / 60)}h${String(currentRule.weeklyMinutes % 60).padStart(2, "0")}` : "44h";
  const dailyTarget = currentRule ? Math.round((currentRule.weeklyMinutes - currentRule.saturdayMinutes) / 5) : 528;
  const dailyLabel = `${Math.floor(dailyTarget / 60)}h${String(dailyTarget % 60).padStart(2, "0")}`;
  const saturdayLabel = currentRule?.saturdayMinutes ? `${Math.floor(currentRule.saturdayMinutes / 60)}h` : null;
  const today = new Date().toISOString().slice(0, 10);

  return <main className="shell">
    <aside className="rail">
      <div className="brand"><span className="brand-mark">p</span><b>Ponto</b></div>
      <p className="rail-note">Controle pessoal de jornada</p>
      <nav aria-label="Seções">
        <a className="current" href="#espelho">Espelho mensal</a>
        <a href="#registro">Registrar batida</a>
        <a href="#regras">Regras de jornada</a>
      </nav>
      <div className="contract" id="regras">
        <h2>Vigência atual</h2>
        <p className="contract-rule">{weeklyHoursLabel} semanais</p>
        <p className="contract-detail">{dailyLabel} por dia{saturdayLabel ? <> · {saturdayLabel} no sábado</> : null}<br />
          {currentRule?.effectiveFrom && currentRule.effectiveFrom !== "0000-01-01" ? <>vigente desde {currentRule.effectiveFrom.split("-").reverse().join("/")}</> : "desde o primeiro registro"}</p>
      </div>
      <footer>Dados locais · SQLite ativo</footer>
    </aside>

    <section className="workspace">
      <header className="topline">
        <h1>Olá, {firstName}.</h1>
        <div className="identity">
          <button className="ghost-btn" onClick={loadProfile}>Meu perfil</button>
          <button className="ghost-btn" onClick={signOut}>Sair</button>
          <span className="identity-badge" aria-hidden="true">{initials}</span>
          <div className="identity-info"><b>{user.role || "Colaborador"}</b><small>{user.badge ? `Chapa ${user.badge}` : user.email}</small></div>
        </div>
      </header>

      <section className="period-bar">
        <label className="period-field">
          Competência
          <select value={data.activeMonth} onChange={(e) => changeMonth(e.target.value)} aria-label="Selecionar competência">
            {data.months.map((month) => <option key={month} value={month}>{labelMonth(month)}</option>)}
          </select>
        </label>
        <div className="period-note" aria-live="polite">{isPending ? "Atualizando…" : "Jornada calculada pela vigência contratual"}</div>
      </section>

      <section className="balance-instrument" aria-label="Saldo do mês">
        <div className={`balance-hero ${data.summary.balance.startsWith("−") ? "negative" : ""}`}>
          <span className="balance-label">Saldo do mês</span>
          <b className="balance-value">{data.summary.balance}</b>
          <span className="balance-hint">considerando {data.summary.days} dias úteis registrados</span>
        </div>
        <div className={`balance-side ${data.summary.pending ? "warn" : "ok"}`}>
          <span className="balance-label">Ajustes necessários</span>
          <b>{String(data.summary.pending).padStart(2, "0")}</b>
          <span className="balance-hint">{data.summary.pending ? "dias abaixo da meta diária" : "tudo dentro da meta"}</span>
        </div>
      </section>

      <Report report={data.report} />

      <section className="content-grid" id="espelho">
        <div className="ledger">
          <div className="section-title">
            <h2>Jornada de {labelMonth(data.activeMonth)}</h2>
            <button className="ghost-btn" onClick={() => setSelected({ date: data.activeMonth + "-01", punches: [], note: "" })}>Novo registro</button>
          </div>
          <div className="table-head" aria-hidden="true"><span>Data</span><span>Batidas</span><span>Trabalhado</span><span>Meta</span><span>Saldo</span><span /></div>
          <div className="rows">
            {data.records.map((record, index) => <button className="record" key={record.date} style={{ ["--stagger"]: Math.min(index, 12) }} onClick={() => setSelected(record)}>
              <span className="date"><b>{formatDate(record.date)}</b><small>{record.weekday}</small></span>
              <span className="punches">{record.punches.length ? record.punches.map((time) => <i key={time}>{time}</i>) : <em>{record.note || "—"}</em>}</span>
              <span className="num">{record.worked}</span>
              <span className="num">{record.status === "off" ? "—" : record.target}</span>
              <span className={`balance ${record.status}`}>{record.status === "off" ? "Folga" : record.status === "justified" ? "Abonado" : record.balance}</span>
              <span className="edit" aria-hidden="true">Editar</span>
            </button>)}
          </div>
        </div>

        <aside className="editor" id="registro">
          <div className="editor-top">
            <h2>{selected ? "Corrigir registro" : "Registrar batida"}</h2>
            {selected && <button className="close" onClick={() => setSelected(null)} aria-label="Fechar edição">×</button>}
          </div>
          <p className="editor-sub">{selected ? formatDate(formRecord.date) : "As horas são recalculadas automaticamente ao salvar."}</p>
          <form onSubmit={save}>
            <label>Data<input name="date" type="date" required defaultValue={formRecord.date} key={`date-${formRecord.date}`} /></label>
            <div className="punch-grid">
              <label>Entrada<input name="in1" type="time" defaultValue={punches[0]} key={`in1-${formRecord.date}-${punches[0]}`} /></label>
              <label>Saída intervalo<input name="out1" type="time" defaultValue={punches[1]} key={`out1-${formRecord.date}-${punches[1]}`} /></label>
              <label>Retorno<input name="in2" type="time" defaultValue={punches[2]} key={`in2-${formRecord.date}-${punches[2]}`} /></label>
              <label>Saída<input name="out2" type="time" defaultValue={punches[3]} key={`out2-${formRecord.date}-${punches[3]}`} /></label>
            </div>
            <label>Abono (HH:MM)
              <input name="allowance" type="time" defaultValue={formRecord.allowance || ""} key={`allowance-${formRecord.date}-${formRecord.allowance || ""}`} />
              <small className="field-hint">Compensa somente a diferença de horas deste dia.</small>
            </label>
            <label>Observação
              <textarea name="note" defaultValue={formRecord.note} key={`note-${formRecord.date}-${formRecord.note}`} placeholder="Ex.: ajuste autorizado pelo gestor" rows="3" />
            </label>
            <button className="save" type="submit">Salvar no espelho</button>
          </form>
          {notice && <p className="notice" role="status">{notice}</p>}
          <div className="rule-callout">
            <b>Regra aplicada</b>
            <p>{data.rules?.length ? "As metas seguem a vigência do seu perfil; alterações de horário valem a partir da data informada." : "Nenhuma vigência configurada — defina a carga horária em Meu perfil."}</p>
          </div>
        </aside>
      </section>

      {profileOpen && <div className="modal-backdrop" onClick={() => setProfileOpen(false)}>
        <div className="modal profile" role="dialog" aria-modal="true" aria-label="Meu perfil" onClick={(e) => e.stopPropagation()}>
          <div className="editor-top">
            <h2>Meu perfil</h2>
            <button className="close" onClick={() => setProfileOpen(false)} aria-label="Fechar perfil">×</button>
          </div>
          <p className="editor-sub">Dados da conta e vigências usadas no cálculo das metas.</p>
          <form onSubmit={saveProfile}>
            <label>Nome completo<input name="name" type="text" defaultValue={user.name} placeholder="Seu nome completo" /></label>
            <label>Número de cadastro (chapa)<input name="badge" type="text" defaultValue={user.badge} placeholder="Ex.: 005638" /></label>
            <label>Carga horária semanal (h)
              <input name="weeklyHours" type="number" step="0.5" min="1" max="60" defaultValue={currentRule ? currentRule.weeklyMinutes / 60 : 44} />
              <small className="field-hint">Atual: {weeklyHoursLabel} · {dailyLabel} por dia útil{saturdayLabel ? ` · ${saturdayLabel} no sábado` : ""}.</small>
            </label>
            <label className="auth-check">
              <input name="saturdayWork" type="checkbox" defaultChecked={Boolean(currentRule?.saturdayMinutes)} />
              Trabalho sábados alternados (4h)
            </label>
            <label>Houve alteração de horário? Vigente a partir de
              <input name="scheduleChangedAt" type="date" max={today} />
              <small className="field-hint">Informe para criar uma nova vigência a partir desta data; deixe vazio para manter a atual.</small>
            </label>
            <button className="save" type="submit">Salvar perfil</button>
          </form>
          {profileNotice && <p className="notice" role="status">{profileNotice}</p>}
        </div>
      </div>}
    </section>
  </main>;
}
