/* HR Lens engine: parse -> classify -> clean -> analyse -> recommend.
   Pure functions, no DOM. Runs in the browser (window.HRLens) and in Node (require). */
(function (root) {
  "use strict";

  // ------------------------------------------------------------------ fields
  // kind: id | text | cat | date | num | rating | status | gender
  const FIELDS = [
    { key: "employee_id", label: "Employee ID", kind: "id", syn: ["employee id", "emp id", "employeeid", "empid", "employee number", "employeenumber", "staff id", "id", "emp no", "employee no", "badge"] },
    { key: "name", label: "Name", kind: "text", syn: ["name", "employee name", "full name", "employee", "staff name"] },
    { key: "department", label: "Department", kind: "cat", syn: ["department", "dept", "division", "team", "business unit", "function", "unit"] },
    { key: "job_title", label: "Job title", kind: "cat", syn: ["job title", "title", "position", "role", "job role", "jobrole", "designation", "job"] },
    { key: "location", label: "Location", kind: "cat", syn: ["location", "office", "city", "site", "country", "branch", "region"] },
    { key: "manager", label: "Manager", kind: "cat", syn: ["manager", "manager id", "managerid", "reports to", "supervisor", "line manager", "manager name"] },
    { key: "gender", label: "Gender", kind: "gender", syn: ["gender", "sex"] },
    { key: "age", label: "Age", kind: "num", syn: ["age"], range: [15, 80] },
    { key: "birth_date", label: "Date of birth", kind: "date", syn: ["date of birth", "dob", "birth date", "birthdate", "birthday"] },
    { key: "hire_date", label: "Hire date", kind: "date", syn: ["hire date", "date of hire", "hiredate", "start date", "joining date", "date joined", "doj", "join date", "date of joining", "employment start"] },
    { key: "exit_date", label: "Exit date", kind: "date", syn: ["exit date", "termination date", "date of termination", "termdate", "leaving date", "end date", "separation date", "last day", "date left", "resignation date"] },
    { key: "status", label: "Employment status", kind: "status", syn: ["status", "employment status", "employee status", "attrition", "active", "left", "terminated", "employmentstatus", "termd"] },
    { key: "tenure_years", label: "Years at company", kind: "num", syn: ["years at company", "yearsatcompany", "tenure", "years of service", "service years", "tenure years", "length of service"], range: [0, 60] },
    { key: "salary", label: "Salary", kind: "num", syn: ["salary", "annual salary", "base salary", "pay", "monthly income", "monthlyincome", "income", "compensation", "ctc", "wage", "monthly salary", "gross salary"], range: [1, 1e9] },
    { key: "performance", label: "Performance rating", kind: "rating", syn: ["performance", "performance rating", "performancerating", "rating", "perf rating", "performance score", "appraisal", "review score", "performancescore"] },
    { key: "engagement", label: "Engagement / satisfaction", kind: "rating", syn: ["engagement", "engagement score", "satisfaction", "job satisfaction", "jobsatisfaction", "employee satisfaction", "enps", "engagementsurvey", "empsatisfaction", "environment satisfaction"] },
    { key: "absence_days", label: "Absence days", kind: "num", syn: ["absence", "absences", "absence days", "sick days", "days absent", "absenteeism", "leave days", "days off"], range: [0, 366] },
    { key: "overtime", label: "Overtime", kind: "status", syn: ["overtime", "over time", "overtime hours", "ot"] },
    { key: "training_hours", label: "Training hours", kind: "num", syn: ["training hours", "training", "learning hours", "training times last year", "trainingtimeslastyear", "courses completed"], range: [0, 2000] },
    { key: "years_since_promotion", label: "Years since promotion", kind: "num", syn: ["years since last promotion", "yearssincelastpromotion", "years since promotion", "last promotion years"], range: [0, 60] },
    { key: "exit_reason", label: "Exit reason", kind: "cat", syn: ["exit reason", "reason for leaving", "termination reason", "termreason", "reason", "leaving reason", "separation reason"] },
    { key: "employment_type", label: "Employment type", kind: "cat", syn: ["employment type", "contract type", "employee type", "worker type", "type", "full time part time"] },
  ];
  const FIELD = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

  // ------------------------------------------------------------------ parsing
  function parseCSV(text) {
    text = String(text || "").replace(/^﻿/, "");
    const first = text.split(/\r?\n/, 1)[0] || "";
    const counts = { ",": 0, ";": 0, "\t": 0, "|": 0 };
    for (const ch of first) if (ch in counts) counts[ch]++;
    const delim = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || ",";
    const rows = [];
    let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
        } else cell += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else cell += c;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return toTable(rows);
  }

  // rows: array of arrays, first row = header
  function toTable(rows) {
    rows = rows.filter((r) => r && r.some((v) => String(v ?? "").trim() !== ""));
    if (!rows.length) return { headers: [], rows: [] };
    const headers = rows[0].map((h, i) => String(h ?? "").trim() || `Column ${i + 1}`);
    const seen = {};
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i];
      seen[h] = (seen[h] || 0) + 1;
      if (seen[h] > 1) headers[i] = `${h} (${seen[h]})`;
    }
    const body = rows.slice(1).map((r) => headers.map((_, i) => (r[i] === undefined || r[i] === null ? "" : r[i])));
    return { headers, rows: body };
  }

  // ------------------------------------------------------------------ value helpers
  const norm = (s) => String(s ?? "").toLowerCase().replace(/[_\-./]+/g, " ").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  const isBlank = (v) => v === null || v === undefined || String(v).trim() === "" || /^(na|n\/a|null|none|nan|-|--|\?)$/i.test(String(v).trim());

  function toNumber(v) {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (isBlank(v)) return null;
    let s = String(v).trim().replace(/[\s$€£₹¥]|AED|MYR|RM|USD|EUR|GBP|INR|SGD/gi, "");
    let mult = 1;
    if (/k$/i.test(s)) { mult = 1e3; s = s.slice(0, -1); }
    else if (/m$/i.test(s)) { mult = 1e6; s = s.slice(0, -1); }
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", "."); // 1.234,5
    else s = s.replace(/,/g, "");
    if (/%$/.test(s)) s = s.slice(0, -1);
    if (!/^-?\d*\.?\d+$/.test(s)) return null;
    return parseFloat(s) * mult;
  }

  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

  // order: "dmy" | "mdy" for ambiguous numeric dates
  function toDate(v, order) {
    if (v instanceof Date) return isNaN(v) ? null : new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
    if (isBlank(v)) return null;
    if (typeof v === "number" || /^\d{5}(\.\d+)?$/.test(String(v).trim())) {
      const n = Number(v);
      if (n > 20000 && n < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 864e5); // Excel serial
      return null;
    }
    const s = String(v).trim();
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return mk(+m[1], +m[2] - 1, +m[3]);
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
    if (m) {
      let a = +m[1], b = +m[2], y = +m[3];
      if (y < 100) y += y > 50 ? 1900 : 2000;
      const dmy = a > 12 || (b <= 12 && order === "dmy");
      return dmy ? mk(y, b - 1, a) : mk(y, a - 1, b);
    }
    m = s.match(/^(\d{1,2})[\s-]+([a-z]{3,9})\.?[\s,-]+(\d{2,4})$/i);
    if (m && MONTHS[m[2].slice(0, 3).toLowerCase()] !== undefined) {
      let y = +m[3]; if (y < 100) y += y > 50 ? 1900 : 2000;
      return mk(y, MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]);
    }
    m = s.match(/^([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/i);
    if (m && MONTHS[m[1].slice(0, 3).toLowerCase()] !== undefined) return mk(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]);
    return null;
    function mk(y, mo, d) {
      if (y < 1900 || y > 2100 || mo < 0 || mo > 11 || d < 1 || d > 31) return null;
      const dt = new Date(Date.UTC(y, mo, d));
      return dt.getUTCMonth() === mo ? dt : null;
    }
  }

  function dateOrder(values) {
    for (const v of values) {
      const m = String(v ?? "").trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}$/);
      if (m) { if (+m[1] > 12) return "dmy"; if (+m[2] > 12) return "mdy"; }
    }
    return "mdy";
  }

  const GENDER = { m: "Male", male: "Male", man: "Male", men: "Male", f: "Female", female: "Female", woman: "Female", women: "Female", w: "Female" };
  const LEFT = ["left", "terminated", "termination", "resigned", "inactive", "exited", "former", "separated", "voluntarily terminated", "terminated for cause", "yes", "y", "1", "true", "quit", "dismissed", "retired"];
  const ACTIVE = ["active", "current", "employed", "no", "n", "0", "false", "working", "on leave", "leave of absence", "future start"];

  function toStatus(v) {
    if (isBlank(v)) return null;
    const s = norm(v);
    if (LEFT.includes(s) || /terminat|resign|left|exit|separat|retire/.test(s)) return "Left";
    if (ACTIVE.includes(s) || /active|current|employ/.test(s)) return "Active";
    return null;
  }
  function toYesNo(v) {
    if (isBlank(v)) return null;
    const s = norm(v);
    if (["yes", "y", "true", "1"].includes(s)) return true;
    if (["no", "n", "false", "0"].includes(s)) return false;
    const n = toNumber(v);
    return n === null ? null : n > 0;
  }

  // ------------------------------------------------------------------ classification
  function profile(values) {
    const vals = values.filter((v) => !isBlank(v)).slice(0, 400);
    const n = vals.length || 1;
    const nums = vals.map(toNumber).filter((x) => x !== null);
    const order = dateOrder(vals);
    const dates = vals.filter((v) => typeof v !== "number" || Number(v) > 20000).map((v) => toDate(v, order)).filter(Boolean);
    const distinct = new Set(vals.map((v) => norm(v))).size;
    const genders = vals.filter((v) => GENDER[norm(v)]).length;
    const statuses = vals.filter((v) => toStatus(v)).length;
    const yesno = vals.filter((v) => ["yes", "no", "y", "n", "true", "false"].includes(norm(v))).length;
    return {
      n: vals.length,
      numShare: nums.length / n,
      dateShare: dates.length / n,
      distinct,
      min: nums.length ? Math.min(...nums) : null,
      max: nums.length ? Math.max(...nums) : null,
      integer: nums.every((x) => Number.isInteger(x)),
      genderShare: genders / n,
      statusShare: statuses / n,
      yesnoShare: yesno / n,
      avgLen: vals.reduce((a, v) => a + String(v).length, 0) / n,
    };
  }

  function headerScore(header, field) {
    const h = norm(header), hc = h.replace(/ /g, "");
    let best = 0;
    field.syn.forEach((s, idx) => {
      const sc = s.replace(/ /g, "");
      if (h === s || hc === sc) best = Math.max(best, 1 - idx * 0.002); // earlier synonyms win ties
      else if (s.length > 3 && (h.includes(s) || hc.includes(sc))) best = Math.max(best, 0.75);
    });
    return best;
  }

  function valueScore(p, field) {
    if (!p.n) return 0;
    switch (field.kind) {
      case "date": return p.dateShare > 0.8 ? 0.6 : p.dateShare < 0.5 ? -0.5 : 0;
      case "gender": return p.genderShare > 0.8 ? 0.9 : p.genderShare < 0.5 ? -0.5 : 0;
      case "status": return p.statusShare > 0.8 && p.distinct <= 6 ? 0.5 : p.statusShare < 0.5 ? -0.5 : 0;
      case "rating": return p.numShare > 0.9 && p.min >= 0 && p.max <= 10 && p.distinct <= 11 ? 0.35 : p.numShare < 0.9 ? -0.5 : -0.1;
      case "num": {
        if (p.numShare < 0.9) return 0;
        const [lo, hi] = field.range || [-Infinity, Infinity];
        return p.min >= lo && p.max <= hi ? 0.25 : -0.5;
      }
      case "id": return p.distinct >= p.n * 0.95 && p.avgLen < 20 ? 0.3 : -0.3;
      case "cat": return p.numShare < 0.5 && p.distinct < Math.max(3, p.n * 0.5) ? 0.2 : -0.2;
      case "text": return p.numShare < 0.1 && p.distinct > p.n * 0.8 ? 0.2 : -0.2;
      default: return 0;
    }
  }

  // Returns [{column, field, confidence}] with each field used at most once.
  function classify(table) {
    const profiles = table.headers.map((_, i) => profile(table.rows.map((r) => r[i])));
    const cands = [];
    table.headers.forEach((h, i) => {
      for (const f of FIELDS) {
        const hs = headerScore(h, f);
        const vs = valueScore(profiles[i], f);
        if (hs > 0 && hs < 0.99 && vs < 0) continue; // partial name match but the values disagree
        let score = hs ? hs + Math.max(vs, -0.4) * 0.5 : vs >= 0.5 ? vs : 0;
        if (score > 0.45) cands.push({ i, key: f.key, score });
      }
    });
    cands.sort((a, b) => b.score - a.score);
    const usedCol = new Set(), usedField = new Set();
    const result = table.headers.map((h) => ({ column: h, field: null, confidence: 0 }));
    for (const c of cands) {
      if (usedCol.has(c.i) || usedField.has(c.key)) continue;
      usedCol.add(c.i); usedField.add(c.key);
      result[c.i] = { column: table.headers[c.i], field: c.key, confidence: Math.min(1, +c.score.toFixed(2)) };
    }
    return result;
  }

  // ------------------------------------------------------------------ cleaning
  function clean(table, mapping, opts = {}) {
    const asOf = opts.asOf ? new Date(opts.asOf) : null;
    const log = { rowsIn: table.rows.length, emptyRows: 0, duplicates: 0, duplicateIds: 0, trimmed: 0, merged: [], parsed: {}, invalid: [], missing: {} };
    const col = {};
    mapping.forEach((m, i) => { if (m.field) col[m.field] = i; });

    // trim + drop empty rows + exact duplicates
    const seen = new Set();
    let rows = [];
    for (const r of table.rows) {
      const t = r.map((v) => {
        if (typeof v !== "string") return v;
        const s = v.replace(/\s+/g, " ").trim();
        if (s !== v) log.trimmed++;
        return s;
      });
      if (t.every(isBlank)) { log.emptyRows++; continue; }
      const key = JSON.stringify(t);
      if (seen.has(key)) { log.duplicates++; continue; }
      seen.add(key);
      rows.push(t);
    }
    if (col.employee_id !== undefined) {
      const ids = new Set();
      rows = rows.filter((r) => {
        const id = norm(r[col.employee_id]);
        if (!id) return true;
        if (ids.has(id)) { log.duplicateIds++; return false; }
        ids.add(id); return true;
      });
    }

    // categorical: merge spelling/case variants onto the most common spelling
    const canon = {};
    for (const key of ["department", "job_title", "location", "employment_type", "exit_reason", "manager"]) {
      if (col[key] === undefined) continue;
      const groups = {};
      for (const r of rows) {
        const raw = r[col[key]];
        if (isBlank(raw)) continue;
        const k = norm(raw).replace(/ (dept|department|team)$/, "").replace(/s$/, "");
        (groups[k] = groups[k] || {})[raw] = (groups[k][raw] || 0) + 1;
      }
      canon[key] = {};
      for (const variants of Object.values(groups)) {
        const names = Object.keys(variants).sort((a, b) => variants[b] - variants[a] || b.length - a.length);
        let best = names[0];
        const shouting = best === best.toUpperCase() && best.replace(/[^A-Za-z]/g, "").length > 5;
        if (shouting || best === best.toLowerCase()) {
          const nicer = names.find((n) => n !== n.toUpperCase() && n !== n.toLowerCase());
          best = nicer || best.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
        }
        for (const n of names) canon[key][n] = best;
        if (names.length > 1) log.merged.push({ field: key, from: names.filter((n) => n !== best), to: best });
      }
    }

    const orders = {};
    for (const key of ["hire_date", "exit_date", "birth_date"]) if (col[key] !== undefined) orders[key] = dateOrder(rows.map((r) => r[col[key]]));

    const recs = rows.map((r, idx) => {
      const rec = { _row: idx };
      for (const f of FIELDS) {
        if (col[f.key] === undefined) continue;
        const raw = r[col[f.key]];
        let val = null;
        if (isBlank(raw)) { log.missing[f.key] = (log.missing[f.key] || 0) + 1; rec[f.key] = null; continue; }
        switch (f.kind) {
          case "date": val = toDate(raw, orders[f.key]); break;
          case "num": case "rating": val = toNumber(raw); break;
          case "gender": val = GENDER[norm(raw)] || "Other / undisclosed"; break;
          case "status": val = f.key === "overtime" ? toYesNo(raw) : toStatus(raw); break;
          case "cat": val = canon[f.key]?.[raw] ?? String(raw); break;
          default: val = String(raw);
        }
        if (val === null) {
          log.invalid.push({ field: f.key, value: String(raw).slice(0, 40), row: idx + 2 });
          log.missing[f.key] = (log.missing[f.key] || 0) + 1;
        } else if (typeof raw === "string" && (f.kind === "date" || f.kind === "num") && String(val) !== raw) {
          log.parsed[f.key] = (log.parsed[f.key] || 0) + 1;
        }
        rec[f.key] = val;
      }
      return rec;
    });

    // reference date: the latest date in the data, so old exports are analysed "as of" their own time
    let ref = asOf;
    if (!ref) {
      let max = 0;
      for (const r of recs) for (const k of ["hire_date", "exit_date"]) if (r[k] && r[k] <= new Date()) max = Math.max(max, +r[k]);
      ref = max ? new Date(max) : new Date();
    }

    for (const r of recs) {
      if (r.salary !== undefined && r.salary !== null && r.salary <= 0) { log.invalid.push({ field: "salary", value: String(r.salary), row: r._row + 2 }); r.salary = null; }
      if (r.hire_date && r.exit_date && r.exit_date < r.hire_date) { log.invalid.push({ field: "exit_date", value: "before hire date", row: r._row + 2 }); r.exit_date = null; }
      if (r.age !== undefined && r.age !== null && (r.age < 15 || r.age > 80)) { log.invalid.push({ field: "age", value: String(r.age), row: r._row + 2 }); r.age = null; }
      // status: explicit, else from exit date
      if (!r.status) r.status = r.exit_date ? (r.exit_date <= ref ? "Left" : "Active") : (col.status === undefined ? "Active" : null);
      if (r.status === "Active" && r.exit_date && r.exit_date <= ref && col.status === undefined) r.status = "Left";
      if (r.age == null && r.birth_date) r.age = Math.floor((ref - r.birth_date) / (365.25 * 864e5));
      if (r.tenure_years == null && r.hire_date) {
        const end = r.status === "Left" && r.exit_date ? r.exit_date : ref;
        r.tenure_years = Math.max(0, (end - r.hire_date) / (365.25 * 864e5));
      }
    }

    log.rowsOut = recs.length;
    log.asOf = ref;
    return { records: recs, log, fields: Object.keys(col), salaryHeader: col.salary !== undefined ? table.headers[col.salary] : "" };
  }

  // ------------------------------------------------------------------ analysis
  const has = (recs, k) => recs.some((r) => r[k] !== null && r[k] !== undefined);
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const median = (a) => {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const pick = (recs, k) => recs.map((r) => r[k]).filter((v) => v !== null && v !== undefined);
  const monthKey = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

  function groupBy(recs, key) {
    const g = {};
    for (const r of recs) { const k = r[key] ?? "Not recorded"; (g[k] = g[k] || []).push(r); }
    return g;
  }

  function attritionOf(recs, ref, useDates) {
    const leftAll = recs.filter((r) => r.status === "Left");
    if (useDates) {
      const start = new Date(ref); start.setUTCFullYear(start.getUTCFullYear() - 1);
      const leavers = leftAll.filter((r) => r.exit_date && r.exit_date > start && r.exit_date <= ref).length;
      const atStart = recs.filter((r) => (!r.hire_date || r.hire_date <= start) && (!r.exit_date || r.exit_date > start) && !(r.status === "Left" && !r.exit_date)).length;
      const atEnd = recs.filter((r) => r.status !== "Left").length;
      const avg = (atStart + atEnd) / 2;
      return { rate: avg ? leavers / avg : null, leavers, basis: "last 12 months" };
    }
    return { rate: recs.length ? leftAll.length / recs.length : null, leavers: leftAll.length, basis: "all records" };
  }

  function analyze(cleaned, filter = {}) {
    let recs = cleaned.records;
    if (filter.department) recs = recs.filter((r) => r.department === filter.department);
    const ref = cleaned.log.asOf;
    const H = (k) => has(recs, k);
    const useDates = has(cleaned.records, "exit_date");
    const active = recs.filter((r) => r.status !== "Left");
    const left = recs.filter((r) => r.status === "Left");
    const a = { ref, total: recs.length, headcount: active.length, leftCount: left.length, has: {} };
    const derived = ["age", "tenure_years"];
    for (const f of FIELDS) a.has[f.key] = cleaned.fields.includes(f.key) ? H(f.key) : derived.includes(f.key) && H(f.key);
    a.has.leavers = left.length > 0;
    a.salaryPeriod = /month/i.test(cleaned.salaryHeader || "") ? "month" : "year";

    a.attrition = a.has.status || a.has.exit_date ? attritionOf(recs, ref, useDates) : null;
    if (H("tenure_years")) a.avgTenure = mean(pick(active.length ? active : recs, "tenure_years"));
    if (H("salary")) {
      const pay = pick(active.length ? active : recs, "salary");
      a.medianSalary = median(pay);
      a.payroll = pay.reduce((x, y) => x + y, 0);
    }
    if (H("performance")) {
      const p = pick(recs, "performance");
      a.perfMax = Math.max(...p) <= 5 ? 5 : Math.max(...p) <= 10 ? 10 : Math.ceil(Math.max(...p));
      a.avgPerformance = mean(p);
      a.perfDist = countBy(p.map((x) => Math.round(x)));
    }
    if (H("engagement")) {
      const e = pick(recs, "engagement");
      a.engMax = Math.max(...e) <= 4 ? 4 : Math.max(...e) <= 5 ? 5 : 10;
      a.avgEngagement = mean(e);
      a.lowEngagementShare = e.filter((x) => x <= a.engMax * 0.4).length / e.length;
    }
    if (H("absence_days")) a.avgAbsence = mean(pick(active.length ? active : recs, "absence_days"));
    if (H("gender")) a.gender = countBy(pick(active.length ? active : recs, "gender"));
    if (H("age")) a.ageBands = bands(pick(active.length ? active : recs, "age"), [[0, 25, "Under 25"], [25, 35, "25–34"], [35, 45, "35–44"], [45, 55, "45–54"], [55, 200, "55+"]]);
    if (H("tenure_years")) a.tenureBands = bands(pick(active.length ? active : recs, "tenure_years"), [[0, 1, "< 1 yr"], [1, 3, "1–2 yrs"], [3, 5, "3–4 yrs"], [5, 10, "5–9 yrs"], [10, 100, "10+ yrs"]]);
    if (H("exit_reason") && left.length) a.exitReasons = Object.entries(countBy(pick(left, "exit_reason"))).sort((x, y) => y[1] - x[1]).slice(0, 6);

    // by department
    const statsFor = (key) => Object.entries(groupBy(recs, key)).map(([name, rs]) => {
        const act = rs.filter((r) => r.status !== "Left");
        const att = attritionOf(rs, ref, useDates);
        return {
          name, total: rs.length, headcount: act.length, leavers: att.leavers, attrition: att.rate,
          medianSalary: median(pick(act.length ? act : rs, "salary")),
          avgPerformance: mean(pick(rs, "performance")),
          avgEngagement: mean(pick(rs, "engagement")),
          avgAbsence: mean(pick(act.length ? act : rs, "absence_days")),
        };
      }).sort((x, y) => y.headcount - x.headcount);
    if (H("department")) a.departments = statsFor("department");
    if (H("job_title")) a.jobs = statsFor("job_title");

    // hires and exits by month, last 24 months
    if (H("hire_date") || H("exit_date")) {
      const months = [];
      const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1));
      for (let i = 23; i >= 0; i--) months.push(monthKey(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1))));
      const hires = Object.fromEntries(months.map((m) => [m, 0])), exits = { ...hires };
      for (const r of recs) {
        if (r.hire_date) { const k = monthKey(r.hire_date); if (k in hires) hires[k]++; }
        if (r.exit_date && r.status === "Left") { const k = monthKey(r.exit_date); if (k in exits) exits[k]++; }
      }
      a.flow = months.map((m) => ({ month: m, hires: hires[m], exits: exits[m] }));
      const last12 = a.flow.slice(12), prev12 = a.flow.slice(0, 12);
      a.hires12 = sum(last12, "hires"); a.exits12 = sum(last12, "exits");
      a.hiresPrev12 = sum(prev12, "hires"); a.exitsPrev12 = sum(prev12, "exits");
    }

    // gender pay gap (median, all and within departments)
    if (H("gender") && H("salary")) {
      const base = active.length ? active : recs;
      const gap = (rs) => {
        const m = median(pick(rs.filter((r) => r.gender === "Male"), "salary"));
        const f = median(pick(rs.filter((r) => r.gender === "Female"), "salary"));
        const nm = rs.filter((r) => r.gender === "Male" && r.salary != null).length;
        const nf = rs.filter((r) => r.gender === "Female" && r.salary != null).length;
        return m && f ? { gap: (m - f) / m, nm, nf } : null;
      };
      a.payGap = gap(base);
      if (H("department")) a.payGapByDept = Object.entries(groupBy(base, "department")).map(([n, rs]) => ({ name: n, ...gap(rs) })).filter((x) => x.gap !== undefined && x.nm >= 5 && x.nf >= 5);
    }

    // drivers: overtime, early leavers, top performers who left, promotion stagnation
    if (left.length && H("tenure_years")) a.earlyLeaverShare = left.filter((r) => r.tenure_years != null && r.tenure_years < 1).length / left.length;
    if (left.length && H("performance") && a.perfMax) {
      const top = (r) => r.performance != null && r.performance >= a.perfMax * 0.8;
      a.topLeaverShare = left.filter(top).length / left.length;
      a.topLeavers = left.filter(top).length;
    }
    if (H("overtime")) {
      const ot = recs.filter((r) => r.overtime === true), no = recs.filter((r) => r.overtime === false);
      a.overtimeShare = ot.length / (ot.length + no.length || 1);
      const rate = (rs) => (rs.length ? rs.filter((r) => r.status === "Left").length / rs.length : null);
      a.overtimeLeaveRate = rate(ot); a.noOvertimeLeaveRate = rate(no);
    }
    if (H("years_since_promotion")) {
      const y = pick(active.length ? active : recs, "years_since_promotion");
      a.stuckShare = y.filter((x) => x >= 3).length / y.length;
    }
    if (H("training_hours") && H("performance")) a.trainingPerfCorr = corr(recs, "training_hours", "performance");
    if (H("engagement") && left.length) {
      a.engLeft = mean(pick(left, "engagement")); a.engActive = mean(pick(active, "engagement"));
    }
    if (H("salary") && H("performance") && H("department") && a.perfMax) {
      const meds = Object.fromEntries((a.departments || []).map((d) => [d.name, d.medianSalary]));
      a.underpaidStars = active.filter((r) => r.performance >= a.perfMax * 0.8 && r.salary != null && meds[r.department] && r.salary < meds[r.department] * 0.9).length;
    }
    if (H("manager")) {
      const spans = Object.values(countBy(pick(active, "manager")));
      a.avgSpan = mean(spans); a.wideSpans = spans.filter((s) => s > 12).length; a.managers = spans.length;
    }
    if (H("tenure_years") || H("age")) {
      a.longTenureShare = H("tenure_years") ? pick(active, "tenure_years").filter((x) => x >= 10).length / (active.length || 1) : null;
      a.retirementShare = H("age") ? pick(active, "age").filter((x) => x >= 55).length / (active.length || 1) : null;
    }
    a.quality = qualityScore(cleaned);
    return a;
  }

  function countBy(arr) { const c = {}; for (const v of arr) c[v] = (c[v] || 0) + 1; return c; }
  function sum(arr, k) { return arr.reduce((x, y) => x + y[k], 0); }
  function bands(vals, defs) { return defs.map(([lo, hi, label]) => ({ label, count: vals.filter((v) => v >= lo && v < hi).length })); }
  function corr(recs, a, b) {
    const pts = recs.filter((r) => r[a] != null && r[b] != null);
    if (pts.length < 10) return null;
    const ma = mean(pts.map((r) => r[a])), mb = mean(pts.map((r) => r[b]));
    let num = 0, da = 0, db = 0;
    for (const r of pts) { num += (r[a] - ma) * (r[b] - mb); da += (r[a] - ma) ** 2; db += (r[b] - mb) ** 2; }
    return da && db ? num / Math.sqrt(da * db) : null;
  }
  function qualityScore(c) {
    const n = c.log.rowsOut || 1, f = c.fields.length || 1;
    const missing = Object.values(c.log.missing).reduce((x, y) => x + y, 0);
    return Math.max(0, Math.round(100 * (1 - missing / (n * f)) - Math.min(20, (c.log.duplicates + c.log.duplicateIds) / n * 100)));
  }

  // ------------------------------------------------------------------ recommendations
  // Thresholds are rules of thumb, kept in one place so a company can tune them.
  const RULES = { deptAttritionMultiple: 1.5, minLeavers: 3, earlyLeaverShare: 0.3, topLeaverShare: 0.2, payGap: 0.05, overtimeMultiple: 1.5, lowEngagementShare: 0.25, stuckShare: 0.4, absenceMultiple: 1.5, missingShare: 0.1, wideSpan: 12, succession: 0.2 };
  const pct = (x, d = 0) => `${(x * 100).toFixed(d)}%`;

  function recommend(a, cleaned) {
    const quick = [], growth = [];
    const att = a.attrition?.rate;

    if (a.departments && att) {
      for (const d of a.departments) {
        if (d.attrition && d.leavers >= RULES.minLeavers && d.attrition >= att * RULES.deptAttritionMultiple)
          quick.push({ level: "high", title: `Hold stay interviews in ${d.name}`, why: `${d.name} attrition is ${pct(d.attrition)}, ${(d.attrition / att).toFixed(1)}× the company rate of ${pct(att)} (${d.leavers} leavers).`, action: `Talk to the remaining team this month to find the cause (manager, workload, pay), and review exit notes for the last ${d.leavers} leavers.`, score: d.attrition / att });
      }
    }
    if (a.earlyLeaverShare >= RULES.earlyLeaverShare && a.leftCount >= RULES.minLeavers)
      quick.push({ level: "high", title: "Fix the first year: onboarding and hiring fit", why: `${pct(a.earlyLeaverShare)} of leavers left within their first year.`, action: "Add 30/60/90-day check-ins, assign a buddy to every new hire, and compare job ads with the actual role to catch mismatched expectations.", score: 2 + a.earlyLeaverShare });
    if (a.topLeaverShare >= RULES.topLeaverShare && a.topLeavers >= 2)
      quick.push({ level: "high", title: "Protect your top performers", why: `${a.topLeavers} leavers (${pct(a.topLeaverShare)}) were top-rated performers.`, action: "List current top performers, check their pay against the department median, and agree a growth step with each one this quarter.", score: 2 + a.topLeaverShare });
    if (a.underpaidStars > 0)
      quick.push({ level: "medium", title: `Review pay for ${a.underpaidStars} underpaid high performer${a.underpaidStars > 1 ? "s" : ""}`, why: `${a.underpaidStars} top-rated employee${a.underpaidStars > 1 ? "s are" : " is"} paid at least 10% below their department's median.`, action: "Prioritise these people in the next pay review; replacing one usually costs far more than a raise.", score: 1.6 });
    if (a.payGap && Math.abs(a.payGap.gap) >= RULES.payGap && a.payGap.nm >= 5 && a.payGap.nf >= 5) {
      const worst = (a.payGapByDept || []).filter((d) => Math.abs(d.gap) >= RULES.payGap).sort((x, y) => Math.abs(y.gap) - Math.abs(x.gap))[0];
      quick.push({ level: "medium", title: "Run a pay equity check", why: `Median pay for ${a.payGap.gap > 0 ? "women" : "men"} is ${pct(Math.abs(a.payGap.gap), 1)} lower overall${worst ? `, and ${pct(Math.abs(worst.gap), 1)} lower in ${worst.name}` : ""}.`, action: "Compare pay within the same job title and level; part of the gap may be role mix, the rest needs correcting.", score: 1.5 + Math.abs(a.payGap.gap) });
    }
    if (a.overtimeLeaveRate != null && a.noOvertimeLeaveRate && a.overtimeLeaveRate >= a.noOvertimeLeaveRate * RULES.overtimeMultiple)
      quick.push({ level: "high", title: "Reduce sustained overtime", why: `People working overtime leave at ${pct(a.overtimeLeaveRate)}, versus ${pct(a.noOvertimeLeaveRate)} for those who don't. ${pct(a.overtimeShare)} of staff work overtime.`, action: "Find the teams with the most overtime, rebalance workload or add headcount there, and cap regular overtime.", score: 1.8 + a.overtimeLeaveRate / a.noOvertimeLeaveRate / 10 });
    if (a.lowEngagementShare >= RULES.lowEngagementShare)
      quick.push({ level: "medium", title: "Act on low engagement", why: `${pct(a.lowEngagementShare)} of employees give a low engagement or satisfaction score${a.engLeft != null && a.engActive != null && a.engLeft < a.engActive ? `; leavers averaged ${a.engLeft.toFixed(1)} versus ${a.engActive.toFixed(1)} for current staff` : ""}.`, action: "Share the results with managers, ask each team for its top two fixes, and re-survey in 90 days.", score: 1.4 });
    if (a.departments && a.avgAbsence) {
      const hi = a.departments.filter((d) => d.avgAbsence && d.headcount >= 5 && d.avgAbsence >= a.avgAbsence * RULES.absenceMultiple);
      for (const d of hi) quick.push({ level: "medium", title: `Look into absence in ${d.name}`, why: `${d.name} averages ${d.avgAbsence.toFixed(1)} absence days per person, versus ${a.avgAbsence.toFixed(1)} company-wide.`, action: "Check for workload, health and safety, or management issues, and offer flexible working where the job allows.", score: 1.2 });
    }
    if (a.stuckShare >= RULES.stuckShare)
      quick.push({ level: "medium", title: "Unblock promotions", why: `${pct(a.stuckShare)} of staff have gone 3 or more years without a promotion.`, action: "Publish promotion criteria and hold calibration sessions so managers put ready people forward.", score: 1.3 });
    if (a.wideSpans > 0)
      quick.push({ level: "low", title: `Split ${a.wideSpans} oversized team${a.wideSpans > 1 ? "s" : ""}`, why: `${a.wideSpans} manager${a.wideSpans > 1 ? "s have" : " has"} more than ${RULES.wideSpan} direct reports (average span ${a.avgSpan.toFixed(1)}).`, action: "Add team leads or split these teams so every employee gets regular one-to-ones.", score: 1 });
    const n = cleaned.log.rowsOut || 1;
    const gaps = Object.entries(cleaned.log.missing).filter(([, c]) => c / n >= RULES.missingShare).map(([k, c]) => `${FIELD[k].label.toLowerCase()} (${pct(c / n)} missing)`);
    if (gaps.length)
      quick.push({ level: "low", title: "Fill gaps in HR records", why: `Some key fields are often empty: ${gaps.slice(0, 3).join(", ")}.`, action: "Make these fields required in your HR system so the next report is complete.", score: 0.5 });

    // growth
    if (a.hires12 != null) {
      const net = a.hires12 - a.exits12;
      if (net < 0) growth.push({ title: "Rebuild capacity with a hiring plan", why: `Headcount fell by ${-net} over the last 12 months (${a.hires12} hires, ${a.exits12} exits).`, action: "Agree with each department head which roles to backfill first, and track time-to-hire monthly." });
      else if (a.hires12 > 0) growth.push({ title: "Scale onboarding and management with growth", why: `Net growth of ${net} people in the last 12 months (${a.hires12} hires${a.hiresPrev12 ? `, versus ${a.hiresPrev12} the year before` : ""}).`, action: "Standardise onboarding, and develop new team leads before teams outgrow their managers." });
    }
    if (a.stuckShare != null || a.avgTenure != null)
      growth.push({ title: "Build visible career paths", why: a.stuckShare != null ? `${pct(a.stuckShare)} of staff are 3+ years from their last promotion.` : `Average tenure is ${a.avgTenure.toFixed(1)} years.`, action: "Define job levels with clear criteria per department and post internal vacancies before external ones, so people grow here instead of leaving to grow." });
    if (a.trainingPerfCorr != null)
      growth.push({ title: a.trainingPerfCorr > 0.15 ? "Invest more in training" : "Make training count", why: a.trainingPerfCorr > 0.15 ? `Training hours and performance move together (correlation ${a.trainingPerfCorr.toFixed(2)}).` : `Training hours show little link to performance (correlation ${a.trainingPerfCorr.toFixed(2)}).`, action: a.trainingPerfCorr > 0.15 ? "Set a training budget per employee and target it at roles with the lowest ratings." : "Review which programmes actually build skills for each role, and drop the rest." });
    if ((a.retirementShare ?? 0) >= RULES.succession || (a.longTenureShare ?? 0) >= RULES.succession)
      growth.push({ title: "Plan succession for key roles", why: `${a.retirementShare >= RULES.succession ? `${pct(a.retirementShare)} of staff are 55 or older` : `${pct(a.longTenureShare)} of staff have 10+ years' tenure`}, so experience is concentrated.`, action: "Name a successor for each critical role and pair them with the current holder to transfer knowledge." });
    if (a.gender) {
      const tot = Object.values(a.gender).reduce((x, y) => x + y, 0);
      const minority = Math.min(a.gender.Male || 0, a.gender.Female || 0) / (tot || 1);
      if (minority < 0.35) growth.push({ title: "Widen your hiring pool", why: `The workforce is ${pct(1 - minority)} ${(a.gender.Male || 0) > (a.gender.Female || 0) ? "men" : "women"}.`, action: "Use structured interviews and diverse shortlists; mixed teams widen the talent you can hire from." });
    }
    if (a.has.engagement) growth.push({ title: "Measure engagement every quarter", why: `Current average is ${a.avgEngagement.toFixed(1)} out of ${a.engMax}.`, action: "Run a short pulse survey quarterly and track it next to attrition, so you see problems before people resign." });
    if (a.departments && a.departments.length > 1 && a.has.salary) {
      const meds = a.departments.filter((d) => d.medianSalary).map((d) => d.medianSalary);
      if (meds.length > 1 && Math.max(...meds) / Math.min(...meds) > 1.8)
        growth.push({ title: "Introduce salary bands", why: `Median pay ranges ${(Math.max(...meds) / Math.min(...meds)).toFixed(1)}× between departments.`, action: "Set pay bands per job level so offers, raises and promotions follow one consistent rule." });
    }
    const missingFor = [];
    if (!a.has.exit_date && !a.has.status) missingFor.push("employment status or exit date (for attrition)");
    if (!a.has.performance) missingFor.push("performance rating");
    if (!a.has.engagement) missingFor.push("engagement score");
    if (!a.has.salary) missingFor.push("salary");
    if (missingFor.length) growth.push({ title: "Track more data for sharper advice", why: `This file has no ${missingFor.join(", ")}.`, action: "Add these columns to your next export to unlock retention, pay and engagement analysis." });

    quick.sort((x, y) => y.score - x.score);
    return { quick: quick.slice(0, 6), growth: growth.slice(0, 5) };
  }

  function headline(a, recs) {
    const top = recs.quick[0];
    const d = a.departments && a.attrition?.rate ? [...a.departments].filter((x) => x.leavers >= RULES.minLeavers && x.attrition).sort((x, y) => y.attrition - x.attrition)[0] : null;
    if (d && d.attrition >= a.attrition.rate * RULES.deptAttritionMultiple) return `${d.name} is losing people ${(d.attrition / a.attrition.rate).toFixed(1)}× faster than the rest of the company`;
    if (top) return top.title;
    return `${a.headcount.toLocaleString("en")} employees${a.departments ? ` across ${a.departments.length} departments` : ""}`;
  }

  // ------------------------------------------------------------------ sample data (deliberately messy)
  function sampleCSV(n = 420, seed = 11) {
    let s = seed;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const pickOne = (arr) => arr[Math.floor(rnd() * arr.length)];
    const depts = [["Sales", 0.24, 52000, 0.32], ["Engineering", 0.26, 88000, 0.12], ["Customer Support", 0.18, 41000, 0.24], ["Marketing", 0.1, 60000, 0.14], ["Finance", 0.08, 70000, 0.08], ["Operations", 0.14, 48000, 0.13]];
    const titles = { Sales: ["Account Executive", "Sales Manager", "SDR"], Engineering: ["Software Engineer", "Senior Engineer", "QA Engineer"], "Customer Support": ["Support Agent", "Team Lead"], Marketing: ["Marketing Specialist", "Content Lead"], Finance: ["Accountant", "Financial Analyst"], Operations: ["Ops Coordinator", "Logistics Analyst"] };
    const first = ["Aisha", "Rahul", "Mei", "Omar", "Sara", "Daniel", "Priya", "Ahmed", "Lena", "Jon", "Fatima", "Ravi", "Nora", "Ali", "Chen", "Maya", "Yusuf", "Elena", "Arjun", "Hana"];
    const last = ["Khan", "Nair", "Tan", "Haddad", "Lim", "Silva", "Patel", "Rahman", "Weber", "Ong", "Ali", "Menon", "Costa", "Hassan", "Wong"];
    const reasons = ["Better pay elsewhere", "Career growth", "Relocation", "Manager", "Workload", "Personal"];
    const rows = [["Emp ID", "Full Name", "Dept", "Job Title", "Gender", "DOB", "Date of Joining", "Termination Date", "Status", "Annual Salary", "Performance Rating", "Job Satisfaction", "OverTime", "Absence Days", "Years Since Last Promotion", "Training Hours", "Manager", "Reason for Leaving"]];
    const ref = Date.UTC(2026, 9, 31);
    const fmt = (t, style) => {
      const d = new Date(t), y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, dd = d.getUTCDate();
      if (style === 0) return `${y}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
      if (style === 1) return `${dd}/${m}/${y}`;
      return `${dd} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${y}`;
    };
    for (let i = 0; i < n; i++) {
      let r = rnd(), dept = depts[0];
      for (const d of depts) { if (r < d[1]) { dept = d; break; } r -= d[1]; }
      const [dn, , basePay, risk] = dept;
      const gender = rnd() < (dn === "Engineering" ? 0.28 : 0.52) ? "F" : "M";
      const hire = ref - Math.floor(rnd() ** 1.6 * 9 * 365 + 20) * 864e5;
      const perf = Math.min(5, Math.max(1, Math.round(3.2 + (rnd() - 0.5) * 2.6)));
      const ot = rnd() < (dn === "Sales" || dn === "Customer Support" ? 0.45 : 0.18);
      const sat = Math.min(4, Math.max(1, Math.round(2.8 + (rnd() - 0.5) * 2.4 - (ot ? 0.5 : 0))));
      let p = risk * (ot ? 1.7 : 0.8) * (sat <= 2 ? 1.6 : 0.85);
      const leaves = rnd() < p;
      let exit = "";
      if (leaves) {
        const early = rnd() < (dn === "Sales" ? 0.5 : 0.25);
        const t = early ? hire + Math.floor(rnd() * 300 + 30) * 864e5 : hire + Math.floor(rnd() * (ref - hire) / 864e5) * 864e5;
        if (t < ref - 5 * 864e5) exit = t; // otherwise they haven't left yet
      }
      const pay = Math.round(basePay * (0.75 + rnd() * 0.6) * (gender === "F" ? 0.93 : 1) * (1 + (perf - 3) * 0.04) / 100) * 100;
      const style = Math.floor(rnd() * 3);
      const deptLabel = rnd() < 0.08 ? (rnd() < 0.5 ? dn.toUpperCase() : ` ${dn.toLowerCase()} `) : dn;
      const age = 22 + Math.floor(rnd() * 38);
      rows.push([
        `E${String(1000 + i)}`, `${pickOne(first)} ${pickOne(last)}`, deptLabel, pickOne(titles[dn]),
        rnd() < 0.04 ? "" : rnd() < 0.5 ? gender : gender === "F" ? "Female" : "male",
        fmt(ref - age * 365.25 * 864e5 - Math.floor(rnd() * 300) * 864e5, 0),
        fmt(hire, style), exit ? fmt(exit, style) : "", exit ? (rnd() < 0.5 ? "Terminated" : "Resigned") : "Active",
        rnd() < 0.03 ? "" : rnd() < 0.3 ? `$${pay.toLocaleString("en")}` : String(pay),
        String(perf), String(sat), ot ? "Yes" : "No", String(Math.round(rnd() ** 2 * (dn === "Customer Support" ? 22 : 11))),
        String(Math.floor(rnd() * 6)), String(Math.round(rnd() * 40 + perf * 4)),
        `M${String(Math.floor(rnd() * 28)).padStart(2, "0")}`, exit ? pickOne(reasons) : "",
      ]);
      if (rnd() < 0.015) rows.push([...rows[rows.length - 1]]); // accidental duplicate
    }
    return rows.map((r) => r.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(",")).join("\n");
  }

  function toCSV(records, fields) {
    const cols = ["employee_id", ...FIELDS.map((f) => f.key).filter((k) => k !== "employee_id")].filter((k) => fields.includes(k) || ["status", "tenure_years", "age"].includes(k) && records.some((r) => r[k] != null));
    const fmt = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v === true ? "Yes" : v === false ? "No" : typeof v === "number" && !Number.isInteger(v) ? v.toFixed(2) : v ?? "");
    const esc = (v) => { const s = String(fmt(v)); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    return [cols.map((k) => FIELD[k].label).join(","), ...records.map((r) => cols.map((k) => esc(r[k])).join(","))].join("\n");
  }

  const api = { FIELDS, FIELD, RULES, parseCSV, toTable, classify, clean, analyze, recommend, headline, sampleCSV, toCSV, toDate, toNumber };
  root.HRLens = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
