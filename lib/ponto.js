import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const dbPath = path.join(process.cwd(), "ponto.sqlite");
const sourcePath = path.join(process.cwd(), "ponto.json");
let db;

function database() {
  if (db) return db;
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS records (
      id INTEGER PRIMARY KEY,
      date TEXT NOT NULL UNIQUE,
      weekday TEXT NOT NULL,
      punches TEXT NOT NULL DEFAULT '[]',
      worked TEXT NOT NULL DEFAULT '00:00',
      note TEXT NOT NULL DEFAULT '',
      allowance TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS employee (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT NOT NULL, badge TEXT NOT NULL, role TEXT NOT NULL, company TEXT NOT NULL
    );
  `);
  seed(db);
  return db;
}

function cleanText(value = "") {
  return String(value).includes("Ã")
    ? Buffer.from(String(value), "latin1").toString("utf8")
    : String(value);
}

function seed(connection) {
  if (connection.prepare("SELECT COUNT(*) AS count FROM records").get().count) return;
  const raw = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  const employee = raw.funcionario;
  connection.prepare("INSERT OR REPLACE INTO employee (id, name, badge, role, company) VALUES (1, ?, ?, ?, ?)")
    .run(cleanText(employee.nome), employee.chapa, cleanText(employee.funcao), cleanText(employee.empresa));
  const insert = connection.prepare(`INSERT INTO records (date, weekday, punches, worked, note, allowance)
    VALUES (@date, @weekday, @punches, @worked, @note, @allowance)`);
  const insertAll = connection.transaction((cards) => {
    for (const card of cards) for (const item of card.registros) {
      const [day, month, year] = item.data.split("/");
      insert.run({
        date: `${year}-${month}-${day}`,
        weekday: item.dia,
        punches: JSON.stringify(item.marcacoes ?? []),
        worked: item.trabalhado ?? "00:00",
        note: cleanText(item.observacao ?? ""),
        allowance: item.abono ?? "",
      });
    }
  });
  insertAll(raw.cartoes_ponto);
}

function toMinutes(time) {
  const [hours, minutes] = String(time || "00:00").split(":").map(Number);
  return hours * 60 + minutes;
}

function displayTime(minutes) {
  const sign = minutes < 0 ? "−" : "";
  const value = Math.abs(minutes);
  return `${sign}${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function dayOfWeek(date) {
  return new Date(`${date}T12:00:00`).getDay();
}

function weekKey(date) {
  const reference = new Date(`${date}T12:00:00`);
  const offset = reference.getDay() === 0 ? 6 : reference.getDay() - 1;
  reference.setDate(reference.getDate() - offset);
  return `${reference.getFullYear()}-${String(reference.getMonth() + 1).padStart(2, "0")}-${String(reference.getDate()).padStart(2, "0")}`;
}

export function targetFor(date, hasSaturdayWork = false) {
  const day = dayOfWeek(date);
  if (date <= "2026-04-15") return day === 0 || day === 6 ? 0 : 280;
  if (day === 0) return 0;
  if (day === 6) return hasSaturdayWork ? 240 : 0;
  return hasSaturdayWork ? 480 : 528;
}

const PAID_SHORT_BREAK_MINUTES = 15;

export function calculateWorked(punches) {
  if (punches.length < 2 || punches.length % 2 !== 0) return null;
  let total = toMinutes(punches.at(-1)) - toMinutes(punches[0]);
  for (let i = 1; i < punches.length - 1; i += 2) {
    const breakMinutes = toMinutes(punches[i + 1]) - toMinutes(punches[i]);
    if (breakMinutes > PAID_SHORT_BREAK_MINUTES) total -= breakMinutes;
  }
  return total >= 0 ? displayTime(total) : null;
}

function decorate(row, hasSaturdayWork = false) {
  const punches = JSON.parse(row.punches);
  const worked = calculateWorked(punches) ?? (punches.length ? row.worked : "00:00");
  const workedMinutes = toMinutes(worked);
  const allowanceMinutes = toMinutes(row.allowance);
  const target = targetFor(row.date, hasSaturdayWork);
  const scheduled = target > 0;
  const creditedMinutes = workedMinutes + allowanceMinutes;
  return {
    ...row,
    punches,
    worked,
    target: displayTime(target),
    balance: row.note && !punches.length && !allowanceMinutes ? "00:00" : displayTime(creditedMinutes - target),
    status: row.note && !punches.length && !allowanceMinutes ? "justified" : punches.length || allowanceMinutes ? (creditedMinutes >= target ? "ok" : "pending") : scheduled ? "pending" : "off",
  };
}

function decorateRows(rows) {
  const saturdayWorkWeeks = new Set(rows
    .filter((row) => dayOfWeek(row.date) === 6 && JSON.parse(row.punches).length > 0)
    .map((row) => weekKey(row.date)));
  return rows.map((row) => decorate(row, saturdayWorkWeeks.has(weekKey(row.date))));
}

function summarizePeriod(rows) {
  let positive = 0;
  let negative = 0;
  for (const row of rows) {
    if (row.status === "off" || row.status === "justified") continue;
    const difference = toMinutes(row.worked) + toMinutes(row.allowance) - toMinutes(row.target);
    if (difference >= 0) positive += difference;
    else negative += Math.abs(difference);
  }
  return { positive, negative, net: positive - negative };
}

function reportTime(minutes) {
  const value = Math.abs(minutes);
  return `${minutes < 0 ? "-" : ""}${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function reportFor(connection) {
  const groups = new Map();
  for (const row of decorateRows(connection.prepare("SELECT * FROM records ORDER BY date").all())) {
    const month = row.date.slice(0, 7);
    groups.set(month, [...(groups.get(month) || []), row]);
  }
  const months = [...groups].map(([month, rows]) => ({ month, ...summarizePeriod(rows) }));
  const rawTotals = months.reduce((total, month) => ({ positive: total.positive + month.positive, negative: total.negative + month.negative, net: total.net + month.net }), { positive: 0, negative: 0, net: 0 });
  const scale = Math.max(1, ...months.flatMap((month) => [month.positive, month.negative]));
  return {
    months: months.map((month) => ({ ...month, positive: reportTime(month.positive), negative: reportTime(month.negative), net: reportTime(month.net), positivePercent: Math.round((month.positive / scale) * 100), negativePercent: Math.round((month.negative / scale) * 100) })),
    totals: { positive: reportTime(rawTotals.positive), negative: reportTime(rawTotals.negative), net: reportTime(rawTotals.net) },
  };
}

export function getDashboard(month) {
  const connection = database();
  const activeMonth = month || "2026-08";
  const records = decorateRows(connection.prepare("SELECT * FROM records WHERE date LIKE ? ORDER BY date").all(`${activeMonth}%`));
  const allMonths = connection.prepare("SELECT DISTINCT substr(date, 1, 7) AS value FROM records ORDER BY value").all().map((r) => r.value);
  const employee = connection.prepare("SELECT * FROM employee WHERE id = 1").get();
  const workdays = records.filter((row) => row.status !== "off" && row.status !== "justified");
  const balance = workdays.reduce((sum, row) => sum + toMinutes(row.balance.replace("−", "-")), 0);
  return { employee, records, months: allMonths, activeMonth, report: reportFor(connection), summary: { balance: displayTime(balance), days: workdays.length, pending: workdays.filter((row) => row.status === "pending").length } };
}

export function saveRecord({ date, punches, note = "", allowance = "" }) {
  const connection = database();
  const safePunches = (punches || []).filter(Boolean).sort();
  const worked = calculateWorked(safePunches) || "00:00";
  const existing = connection.prepare("SELECT weekday FROM records WHERE date = ?").get(date);
  const weekday = existing?.weekday || ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SAB"][new Date(`${date}T12:00:00`).getDay()];
  connection.prepare(`INSERT INTO records (date, weekday, punches, worked, note, allowance, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(date) DO UPDATE SET punches = excluded.punches, worked = excluded.worked, note = excluded.note, allowance = excluded.allowance, updated_at = CURRENT_TIMESTAMP`)
    .run(date, weekday, JSON.stringify(safePunches), worked, note, allowance);
  return decorateRows(connection.prepare("SELECT * FROM records WHERE date LIKE ? ORDER BY date").all(`${date.slice(0, 7)}%`)).find((row) => row.date === date);
}
