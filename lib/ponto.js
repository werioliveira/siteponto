import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const dbPath = process.env.PONTO_DB_PATH || path.join(process.cwd(), "ponto.sqlite");
const sourcePath = path.join(process.cwd(), "ponto.json");
let db;

const SATURDAY_MINUTES = 240;
const FIRST_RULE_DATE = "0000-01-01";

export function database() {
  if (db) return db;
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      badge TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT '',
      company TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS schedule_rules (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      effective_from TEXT NOT NULL,
      weekly_minutes INTEGER NOT NULL,
      saturday_minutes INTEGER NOT NULL DEFAULT 0,
      UNIQUE(user_id, effective_from)
    );
    CREATE TABLE IF NOT EXISTS employee (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT NOT NULL, badge TEXT NOT NULL, role TEXT NOT NULL, company TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS records (
      id INTEGER PRIMARY KEY,
      user_id INTEGER,
      date TEXT NOT NULL,
      weekday TEXT NOT NULL,
      punches TEXT NOT NULL DEFAULT '[]',
      worked TEXT NOT NULL DEFAULT '00:00',
      note TEXT NOT NULL DEFAULT '',
      allowance TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, date)
    );
  `);
  migrateRecords(db);
  seed(db);
  return db;
}

function migrateRecords(connection) {
  const columns = connection.prepare("PRAGMA table_info(records)").all().map((column) => column.name);
  if (!columns.length || columns.includes("user_id")) return;
  connection.exec(`
    CREATE TABLE records_migrated (
      id INTEGER PRIMARY KEY,
      user_id INTEGER,
      date TEXT NOT NULL,
      weekday TEXT NOT NULL,
      punches TEXT NOT NULL DEFAULT '[]',
      worked TEXT NOT NULL DEFAULT '00:00',
      note TEXT NOT NULL DEFAULT '',
      allowance TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, date)
    );
    INSERT INTO records_migrated (id, user_id, date, weekday, punches, worked, note, allowance, updated_at)
      SELECT id, NULL, date, weekday, punches, worked, note, allowance, updated_at FROM records;
    DROP TABLE records;
    ALTER TABLE records_migrated RENAME TO records;
  `);
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

function rulesFor(connection, userId) {
  return connection.prepare(`SELECT effective_from AS effectiveFrom, weekly_minutes AS weeklyMinutes,
    saturday_minutes AS saturdayMinutes FROM schedule_rules WHERE user_id = ? ORDER BY effective_from`).all(userId);
}

function currentRuleFor(rules) {
  const today = new Date().toISOString().slice(0, 10);
  return [...rules].reverse().find((rule) => rule.effectiveFrom <= today) || rules.at(-1) || null;
}

export function targetForUser(rules, date, hasSaturdayWork = false) {
  const day = dayOfWeek(date);
  if (day === 0) return 0;
  const rule = [...rules].reverse().find((item) => item.effectiveFrom <= date);
  if (!rule) return 0;
  if (day === 6) return hasSaturdayWork ? rule.saturdayMinutes : 0;
  const weekly = hasSaturdayWork ? rule.weeklyMinutes - rule.saturdayMinutes : rule.weeklyMinutes;
  return Math.round(weekly / 5);
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

function decorate(row, rules, hasSaturdayWork = false) {
  const punches = JSON.parse(row.punches);
  const worked = calculateWorked(punches) ?? (punches.length ? row.worked : "00:00");
  const workedMinutes = toMinutes(worked);
  const allowanceMinutes = toMinutes(row.allowance);
  const target = targetForUser(rules, row.date, hasSaturdayWork);
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

function decorateRows(rows, rules) {
  const saturdayWorkWeeks = new Set(rows
    .filter((row) => dayOfWeek(row.date) === 6 && JSON.parse(row.punches).length > 0)
    .map((row) => weekKey(row.date)));
  return rows.map((row) => decorate(row, rules, saturdayWorkWeeks.has(weekKey(row.date))));
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

function reportFor(connection, userId) {
  const groups = new Map();
  for (const row of decorateRows(connection.prepare("SELECT * FROM records WHERE user_id = ? ORDER BY date").all(userId), rulesFor(connection, userId))) {
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

export function getDashboard(userId, month) {
  const connection = database();
  const rules = rulesFor(connection, userId);
  const latest = connection.prepare("SELECT MAX(substr(date, 1, 7)) AS value FROM records WHERE user_id = ?").get(userId).value;
  const activeMonth = month || latest || new Date().toISOString().slice(0, 7);
  const records = decorateRows(connection.prepare("SELECT * FROM records WHERE user_id = ? AND date LIKE ? ORDER BY date").all(userId, `${activeMonth}%`), rules);
  const allMonths = connection.prepare("SELECT DISTINCT substr(date, 1, 7) AS value FROM records WHERE user_id = ? ORDER BY value").all(userId).map((r) => r.value);
  const user = connection.prepare("SELECT id, email, name, badge, role, company FROM users WHERE id = ?").get(userId);
  const workdays = records.filter((row) => row.status !== "off" && row.status !== "justified");
  const balance = workdays.reduce((sum, row) => sum + toMinutes(row.balance.replace("−", "-")), 0);
  return { user, records, months: allMonths, activeMonth, rules, report: reportFor(connection, userId), summary: { balance: displayTime(balance), days: workdays.length, pending: workdays.filter((row) => row.status === "pending").length } };
}

export function saveRecord({ userId, date, punches, note = "", allowance = "" }) {
  const connection = database();
  const safePunches = (punches || []).filter(Boolean).sort();
  const worked = calculateWorked(safePunches) || "00:00";
  const existing = connection.prepare("SELECT weekday FROM records WHERE user_id = ? AND date = ?").get(userId, date);
  const weekday = existing?.weekday || ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SAB"][new Date(`${date}T12:00:00`).getDay()];
  connection.prepare(`INSERT INTO records (user_id, date, weekday, punches, worked, note, allowance, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, date) DO UPDATE SET punches = excluded.punches, worked = excluded.worked, note = excluded.note, allowance = excluded.allowance, updated_at = CURRENT_TIMESTAMP`)
    .run(userId, date, weekday, JSON.stringify(safePunches), worked, note, allowance);
  return decorateRows(connection.prepare("SELECT * FROM records WHERE user_id = ? AND date LIKE ? ORDER BY date").all(userId, `${date.slice(0, 7)}%`), rulesFor(connection, userId)).find((row) => row.date === date);
}

export function getProfile(userId) {
  const connection = database();
  const user = connection.prepare("SELECT id, email, name, badge, role, company, created_at AS createdAt FROM users WHERE id = ?").get(userId);
  const rules = rulesFor(connection, userId);
  return { user, rules, current: currentRuleFor(rules) };
}

function parseHours(value) {
  const hours = Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(hours) || hours <= 0 || hours > 99) return null;
  return Math.round(hours * 60);
}

function upsertRule(connection, userId, effectiveFrom, weeklyMinutes, saturdayMinutes) {
  connection.prepare(`INSERT INTO schedule_rules (user_id, effective_from, weekly_minutes, saturday_minutes)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, effective_from) DO UPDATE SET weekly_minutes = excluded.weekly_minutes, saturday_minutes = excluded.saturday_minutes`)
    .run(userId, effectiveFrom, weeklyMinutes, saturdayMinutes);
}

export function updateProfile(userId, profile = {}) {
  const connection = database();
  const updates = {};
  if (profile.name !== undefined) updates.name = String(profile.name).trim().slice(0, 120);
  if (profile.badge !== undefined) updates.badge = String(profile.badge).trim().slice(0, 60);
  if (Object.keys(updates).length) {
    const assignments = Object.keys(updates).map((key) => `${key} = @${key}`).join(", ");
    connection.prepare(`UPDATE users SET ${assignments} WHERE id = @id`).run({ id: userId, ...updates });
  }
  const changeDate = String(profile.scheduleChangedAt || "").trim();
  if (changeDate && !/^\d{4}-\d{2}-\d{2}$/.test(changeDate)) throw new Error("Data de vigência inválida.");
  const weeklyMinutes = parseHours(profile.weeklyHours);
  if (changeDate && weeklyMinutes === null) throw new Error("Informe a nova carga horária semanal em horas.");
  if (weeklyMinutes !== null) {
    const saturdayMinutes = profile.saturdayWork ? SATURDAY_MINUTES : 0;
    if (changeDate) {
      upsertRule(connection, userId, changeDate, weeklyMinutes, saturdayMinutes);
    } else {
      const current = currentRuleFor(rulesFor(connection, userId));
      if (current) {
        connection.prepare("UPDATE schedule_rules SET weekly_minutes = ?, saturday_minutes = ? WHERE user_id = ? AND effective_from = ?")
          .run(weeklyMinutes, saturdayMinutes, userId, current.effectiveFrom);
      } else {
        upsertRule(connection, userId, FIRST_RULE_DATE, weeklyMinutes, saturdayMinutes);
      }
    }
  }
  return getProfile(userId);
}

export function adoptLegacy(userId) {
  const connection = database();
  const pending = connection.prepare("SELECT COUNT(*) AS count FROM records WHERE user_id IS NULL").get().count;
  const employee = connection.prepare("SELECT * FROM employee WHERE id = 1").get();
  return connection.transaction(() => {
    if (!pending) return { adopted: 0, employee: null };
    connection.prepare("UPDATE records SET user_id = ? WHERE user_id IS NULL").run(userId);
    if (!connection.prepare("SELECT COUNT(*) AS count FROM schedule_rules WHERE user_id = ?").get(userId).count) {
      const insert = connection.prepare("INSERT INTO schedule_rules (user_id, effective_from, weekly_minutes, saturday_minutes) VALUES (?, ?, ?, ?)");
      insert.run(userId, FIRST_RULE_DATE, 1400, 0);
      insert.run(userId, "2026-04-16", 2640, SATURDAY_MINUTES);
    }
    if (employee) {
      connection.prepare(`UPDATE users SET
        name = CASE WHEN name = '' THEN @name ELSE name END,
        badge = CASE WHEN badge = '' THEN @badge ELSE badge END,
        role = CASE WHEN role = '' THEN @role ELSE role END,
        company = CASE WHEN company = '' THEN @company ELSE company END
        WHERE id = @id`).run({ id: userId, name: employee.name, badge: employee.badge, role: employee.role, company: employee.company });
    }
    return { adopted: pending, employee: employee || null };
  })();
}

export function setInitialRule(userId, weeklyHours, saturdayWork = false) {
  const connection = database();
  if (connection.prepare("SELECT COUNT(*) AS count FROM schedule_rules WHERE user_id = ?").get(userId).count) return;
  const weeklyMinutes = parseHours(weeklyHours) ?? 2640;
  upsertRule(connection, userId, FIRST_RULE_DATE, weeklyMinutes, saturdayWork ? SATURDAY_MINUTES : 0);
}
