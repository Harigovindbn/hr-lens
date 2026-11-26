/* HR Lens UI: upload -> show dashboard. All processing happens in this browser. */
{
  const E = window.HRLens;
  const $ = (s) => document.querySelector(s);
  const app = $("#app");
  const state = { table: null, mapping: null, cleaned: null, name: "", sample: false, dept: "" };

  // ------------------------------------------------------------ formatting
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const int = (n) => Math.round(n).toLocaleString("en");
  const pct = (x, d = 0) => (x == null ? "–" : `${(x * 100).toFixed(d)}%`);
  const num = (n, d = 1) => (n == null ? "–" : n.toFixed(d));
  const money = (n) => (n == null ? "–" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}k` : int(n));
  const day = (d) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const toast = (msg) => { const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("on"), 2200); };

  // ------------------------------------------------------------ loading
  function load(table, name, sample) {
    if (!table.headers.length || !table.rows.length) return showError("That file has no rows to analyse. Check that the first row holds column names.");
    state.table = table; state.name = name; state.sample = sample; state.dept = "";
    state.mapping = E.classify(table);
    if (!state.mapping.some((m) => m.field)) return showError("No HR columns were recognised. Use column names such as Department, Hire date, Salary or Status.");
    process();
  }

  function process() {
    state.cleaned = E.clean(state.table, state.mapping);
    render();
  }

  function showError(msg) {
    const banner = `<div class="error" role="alert">${esc(msg)}</div>`;
    if (state.cleaned) { app.insertAdjacentHTML("afterbegin", banner); window.scrollTo({ top: 0 }); }
    else app.innerHTML = banner;
  }

  async function readFile(file) {
    const ext = file.name.split(".").pop().toLowerCase();
    try {
      if (ext === "xlsx" || ext === "xls") {
        if (!window.XLSX) return showError("The Excel reader could not load. Save the sheet as CSV and upload that instead.");
        const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
        const sheets = wb.SheetNames.map((n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: "" }));
        const best = sheets.sort((a, b) => b.length - a.length)[0] || [];
        load(E.toTable(best), file.name, false);
      } else {
        load(E.parseCSV(await file.text()), file.name, false);
      }
    } catch (err) {
      showError(`Could not read ${file.name}: ${err.message}`);
    }
  }

  $("#file").addEventListener("change", (e) => { if (e.target.files[0]) readFile(e.target.files[0]); e.target.value = ""; });
  let depth = 0;
  addEventListener("dragenter", (e) => { e.preventDefault(); depth++; document.body.classList.add("dragging"); });
  addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; document.body.classList.remove("dragging"); } });
  addEventListener("dragover", (e) => e.preventDefault());
  addEventListener("drop", (e) => {
    e.preventDefault(); depth = 0; document.body.classList.remove("dragging");
    const f = e.dataTransfer.files[0]; if (f) readFile(f);
  });

  // ------------------------------------------------------------ rendering
  function render() {
    const c = state.cleaned;
    const a = E.analyze(c, { department: state.dept });
    const full = state.dept ? E.analyze(c) : a;
    const rec = E.recommend(a, c);
    const depts = (full.departments || []).map((d) => d.name).filter((n) => n !== "Not recorded");

    app.innerHTML = [
      state.sample ? `<div class="sample"><b>Sample data:</b> a made-up company of ${int(c.log.rowsOut)} employees, deliberately messy. Upload your own file to replace it.</div>` : "",
      `<section class="head">
        <div>
          <h1>${esc(E.headline(a, rec))}</h1>
          <p class="meta">${esc(state.name)} · ${int(a.total)} employees${state.dept ? ` in ${esc(state.dept)}` : ""} · data as of ${day(c.log.asOf)}</p>
        </div>
        ${depts.length > 1 ? `<label class="filter" for="dept">Department
          <select id="dept"><option value="">All departments</option>${depts.map((d) => `<option ${d === state.dept ? "selected" : ""}>${esc(d)}</option>`).join("")}</select></label>` : ""}
      </section>`,
      kpis(a),
      `<section class="main"><div class="col">${groupsPanel(a)}${flowPanel(a)}</div>${fixesPanel(rec.quick)}</section>`,
      chartsGrid(a),
      growthBand(rec.growth),
      dataCheck(c, full.quality),
    ].join("");

    $("#dept")?.addEventListener("change", (e) => { state.dept = e.target.value; render(); });
    bindCheck();
    drawFlow(a);
  }

  function kpis(a) {
    const items = [];
    items.push(["Headcount", int(a.headcount), a.leftCount ? `${int(a.leftCount)} former employees in file` : "employees"]);
    if (a.attrition) items.push(["Attrition", pct(a.attrition.rate, 1), a.attrition.basis]);
    if (a.avgTenure != null) items.push(["Average tenure", `${num(a.avgTenure)} yrs`, "current employees"]);
    if (a.medianSalary != null) items.push(["Median salary", money(a.medianSalary), `per ${a.salaryPeriod}`]);
    if (a.payGap) items.push(["Gender pay gap", pct(Math.abs(a.payGap.gap), 1), Math.abs(a.payGap.gap) < 0.005 ? "median, about equal" : `median, ${a.payGap.gap > 0 ? "women paid less" : "men paid less"}`]);
    if (a.avgPerformance != null) items.push(["Performance", `${num(a.avgPerformance)}/${a.perfMax}`, "average rating"]);
    if (a.avgEngagement != null) items.push(["Engagement", `${num(a.avgEngagement)}/${a.engMax}`, "average score"]);
    if (a.avgAbsence != null) items.push(["Absence", `${num(a.avgAbsence)} days`, "per person"]);
    return `<section class="kpis" aria-label="Key figures">${items.slice(0, 6).map(([l, v, s]) => `<div class="kpi"><span>${l}</span><b class="fig-num">${v}</b><small>${esc(s)}</small></div>`).join("")}</section>`;
  }

  function groupsPanel(a) {
    const byJob = state.dept && a.jobs;
    const groups = (byJob ? a.jobs : a.departments || a.jobs || []).filter((g) => g.name !== "Not recorded" || g.total > 0);
    if (!groups.length) return `<div></div>`;
    const showAtt = !!a.attrition;
    const maxH = Math.max(...groups.map((g) => g.headcount), 1);
    const maxA = Math.max(...groups.map((g) => g.attrition || 0), 0.0001);
    const comp = a.attrition?.rate || 0;
    const label = byJob ? "Job title" : a.departments ? "Department" : "Job title";
    const rows = groups.slice(0, 12).map((g) => {
      const hot = showAtt && comp && g.leavers >= E.RULES.minLeavers && g.attrition >= comp * E.RULES.deptAttritionMultiple;
      return `<span class="name" title="${esc(g.name)}">${esc(g.name)}</span>
        <div class="track"><div class="bar" style="width:${(g.headcount / maxH) * 100}%"></div></div>
        <span class="n">${int(g.headcount)}</span>
        ${showAtt ? `<div class="track"><div class="bar att ${hot ? "hot" : ""}" style="width:${((g.attrition || 0) / maxA) * 100}%"></div></div>
        <span class="n">${pct(g.attrition)}</span>` : "<span></span><span></span>"}`;
    }).join("");
    return `<div class="panel">
      <header><h2>${byJob ? `Job titles in ${esc(state.dept)}` : `${label}s`}</h2>${showAtt ? `<p>attrition over ${esc(a.attrition.basis)}; <span style="color:var(--coral)">■</span> ${E.RULES.deptAttritionMultiple}× the company rate or more</p>` : ""}</header>
      <div class="rows" role="table" aria-label="${label} headcount and attrition">
        <span class="h">${label}</span><span class="h">Headcount</span><span></span><span class="h">${showAtt ? "Attrition" : ""}</span><span></span>
        ${rows}
      </div>
      ${groups.length > 12 ? `<p class="note">Showing the 12 largest of ${groups.length}.</p>` : ""}
    </div>`;
  }

  function fixesPanel(list) {
    return `<div class="panel">
      <header><h2>Quick improvements</h2><p>${list.length ? "most urgent first" : ""}</p></header>
      <div class="fixes">${list.length ? list.slice(0, 4).map(fixItem).join("") : `<p class="note">Nothing urgent stands out in this data.</p>`}</div>
      ${list.length > 4 ? `<details class="more"><summary>${list.length - 4} more improvement${list.length > 5 ? "s" : ""}</summary><div class="fixes">${list.slice(4).map(fixItem).join("")}</div></details>` : ""}
    </div>`;
  }

  const fixItem = (q) => `<article class="fix">
        <h3><span class="dot ${q.level}" aria-label="${q.level} priority"></span>${esc(q.title)}</h3>
        <p>${esc(q.why)}</p><p class="do">${esc(q.action)}</p></article>`;

  function flowPanel(a) {
    if (!a.flow || !a.flow.some((m) => m.hires || m.exits)) return "";
    return `<div class="panel"><header><h2>Hires and exits</h2><div class="legend"><span><i style="background:var(--green2)"></i>Hires ${a.hires12}</span><span><i style="background:var(--coral)"></i>Exits ${a.exits12}</span><span>in the last 12 months</span></div></header><div class="fig" id="flow"></div></div>`;
  }

  function hbars(rows, fmt = int, color = "var(--green2)") {
    const max = Math.max(...rows.map((r) => r[1]), 1);
    return `<div class="hbars">${rows.map(([l, v]) => `<span>${esc(l)}</span><div class="track"><div class="bar" style="width:${(v / max) * 100}%;background:${color}"></div></div><span class="n">${fmt(v)}</span>`).join("")}</div>`;
  }

  function chartsGrid(a) {
    const charts = [];
    if (a.departments && a.has.salary && !state.dept) {
      const rows = a.departments.filter((d) => d.medianSalary).map((d) => [d.name, d.medianSalary]).sort((x, y) => y[1] - x[1]);
      if (rows.length > 1) charts.push(`<div class="panel"><header><h2>Median salary by department</h2><p>per ${a.salaryPeriod}</p></header>${hbars(rows, money)}</div>`);
    }
    if (a.tenureBands) charts.push(`<div class="panel"><header><h2>Tenure</h2><p>current employees</p></header>${hbars(a.tenureBands.map((b) => [b.label, b.count]))}</div>`);
    if (a.perfDist) {
      const keys = Object.keys(a.perfDist).map(Number).sort((x, y) => x - y);
      charts.push(`<div class="panel"><header><h2>Performance ratings</h2><p>out of ${a.perfMax}</p></header>${hbars(keys.map((k) => [`Rating ${k}`, a.perfDist[k]]))}</div>`);
    }
    if (a.exitReasons?.length) charts.push(`<div class="panel"><header><h2>Why people leave</h2><p>${int(a.leftCount)} leavers</p></header>${hbars(a.exitReasons, int, "var(--coral)")}</div>`);
    if (a.gender) {
      const entries = Object.entries(a.gender).sort((x, y) => y[1] - x[1]);
      const tot = entries.reduce((s, e) => s + e[1], 0);
      const colors = ["var(--green)", "#7fb3a6", "#b8c2cc"];
      charts.push(`<div class="panel"><header><h2>Gender mix</h2><p>current employees</p></header>
        <div class="split">${entries.map(([g, n], i) => `<div style="width:${(n / tot) * 100}%;background:${colors[i] || "#ccc"}">${n / tot > 0.12 ? pct(n / tot) : ""}</div>`).join("")}</div>
        <div class="legend">${entries.map(([g, n], i) => `<span><i style="background:${colors[i] || "#ccc"}"></i>${esc(g)} ${int(n)}</span>`).join("")}</div></div>`);
    }
    if (a.ageBands && a.ageBands.some((b) => b.count)) charts.push(`<div class="panel"><header><h2>Age</h2><p>current employees</p></header>${hbars(a.ageBands.map((b) => [b.label, b.count]))}</div>`);
    if (!charts.length) return "";
    const list = charts.slice(0, 6);
    return `<section class="grid2">${list.map((h, i) => (i === list.length - 1 && list.length % 2 ? h.replace('class="panel"', 'class="panel" style="grid-column:1/-1"') : h)).join("")}</section>`;
  }

  function growthBand(list) {
    if (!list.length) return "";
    return `<section class="band"><div class="wrap" style="padding:0">
      <h2>How to grow from here</h2>
      <div class="growth">${list.slice(0, 4).map((g) => `<article class="card"><h3>${esc(g.title)}</h3><p>${esc(g.why)}</p><p class="do">${esc(g.action)}</p></article>`).join("")}</div>
      <p class="note">Advice is generated from your data with simple rules of thumb (for example, a department is flagged when its attrition is ${E.RULES.deptAttritionMultiple}× the company rate). Treat it as a starting point for discussion.</p>
    </div></section>`;
  }

  function dataCheck(c, quality) {
    const L = c.log, recognised = state.mapping.filter((m) => m.field).length;
    const fixes = L.duplicates + L.duplicateIds + L.trimmed + L.merged.reduce((s, m) => s + m.from.length, 0) + L.invalid.length;
    const parsed = Object.entries(L.parsed);
    const missing = Object.entries(L.missing).filter(([, n]) => n).sort((x, y) => y[1] - x[1]);
    const items = [
      `Read ${int(L.rowsIn)} rows and kept ${int(L.rowsOut)}.`,
      L.duplicates && `Removed ${int(L.duplicates)} duplicate row${L.duplicates > 1 ? "s" : ""}.`,
      L.duplicateIds && `Removed ${int(L.duplicateIds)} repeated employee ID${L.duplicateIds > 1 ? "s" : ""} (kept the first).`,
      L.emptyRows && `Skipped ${int(L.emptyRows)} empty row${L.emptyRows > 1 ? "s" : ""}.`,
      L.trimmed && `Trimmed extra spaces in ${int(L.trimmed)} cells.`,
      ...L.merged.slice(0, 6).map((m) => `Merged ${m.from.map((f) => `“${esc(f)}”`).join(", ")} into “${esc(m.to)}” (${esc(E.FIELD[m.field].label.toLowerCase())}).`),
      L.merged.length > 6 && `Merged ${L.merged.length - 6} more spelling variants.`,
      parsed.length && `Standardised ${parsed.map(([k, n]) => `${int(n)} ${esc(E.FIELD[k].label.toLowerCase())} values`).join(", ")}.`,
      L.invalid.length && `Set aside ${int(L.invalid.length)} unreadable or impossible values, e.g. ${L.invalid.slice(0, 3).map((x) => `${esc(E.FIELD[x.field].label.toLowerCase())} “${esc(x.value)}” (row ${x.row})`).join("; ")}.`,
      missing.length && `Blank cells: ${missing.slice(0, 5).map(([k, n]) => `${esc(E.FIELD[k].label.toLowerCase())} ${int(n)}`).join(", ")}.`,
    ].filter(Boolean);
    const options = (sel) => `<option value="">Ignore this column</option>${E.FIELDS.map((f) => `<option value="${f.key}" ${f.key === sel ? "selected" : ""}>${esc(f.label)}</option>`).join("")}`;
    const framed = window.top !== window.self;
    return `<details class="check" id="check">
      <summary>Data check <span>${recognised} of ${state.mapping.length} columns recognised · ${int(fixes)} fixes · quality score ${quality}/100</span></summary>
      <div class="check-body">
        <div><h3>Columns</h3><p class="note" style="margin-top:4px">Wrong guess? Change it and the dashboard updates.</p>
          <div class="scroll"><table><thead><tr><th>Your column</th><th>Read as</th><th>Match</th></tr></thead><tbody>
          ${state.mapping.map((m, i) => `<tr><td>${esc(m.column)}</td><td><select data-col="${i}" aria-label="Field for ${esc(m.column)}">${options(m.field)}</select></td><td class="conf">${m.field ? (m.confidence >= 0.95 ? "exact" : m.confidence >= 0.7 ? "likely" : m.confidence ? "guess" : "set by you") : ""}</td></tr>`).join("")}
          </tbody></table></div></div>
        <div><h3>What was cleaned</h3><ul class="log">${items.map((t) => `<li>${t}</li>`).join("")}</ul>
          <div class="actions"><button class="btn" id="copy">Copy cleaned data (CSV)</button>${framed ? "" : `<button class="btn" id="dl">Download cleaned CSV</button>`}</div></div>
      </div></details>`;
  }

  function bindCheck() {
    for (const sel of document.querySelectorAll("select[data-col]")) {
      sel.addEventListener("change", () => {
        const i = +sel.dataset.col, key = sel.value || null;
        state.mapping.forEach((m, j) => { if (key && j !== i && m.field === key) { m.field = null; m.confidence = 0; } });
        state.mapping[i] = { ...state.mapping[i], field: key, confidence: 0 };
        state.dept = "";
        process();
        const d = $("#check"); if (d) { d.open = true; d.scrollIntoView({ block: "start" }); }
      });
    }
    const csv = () => E.toCSV(state.cleaned.records, state.cleaned.fields);
    $("#copy")?.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(csv()); toast("Cleaned data copied"); }
      catch { toast("Copy was blocked by the browser"); }
    });
    $("#dl")?.addEventListener("click", () => {
      const url = URL.createObjectURL(new Blob([csv()], { type: "text/csv" }));
      const link = Object.assign(document.createElement("a"), { href: url, download: state.name.replace(/\.\w+$/, "") + "-cleaned.csv" });
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  // hires up, exits down, one bar pair per month
  let flowObserver;
  function drawFlow(a) {
    flowObserver?.disconnect();
    const box = $("#flow");
    if (!box || !a.flow) return;
    const draw = () => {
      const W = box.clientWidth, H = box.clientHeight;
      if (!W || !H) return;
      const L = 30, R = 20, T = 8, B = 24;
      const maxH = Math.max(1, ...a.flow.map((m) => m.hires)), maxE = Math.max(1, ...a.flow.map((m) => m.exits));
      const plotH = H - T - B, mid = T + plotH * (maxH / (maxH + maxE));
      const step = (W - L - R) / a.flow.length, bw = Math.max(2, step * 0.62);
      const y = (v, up) => (up ? (v / maxH) * (mid - T) : (v / maxE) * (H - B - mid));
      const every = W < 520 ? 6 : 3;
      const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      let s = `<line x1="${L}" x2="${W - R}" y1="${mid}" y2="${mid}" stroke="#c9cdd3"/>`;
      s += `<text x="${L - 6}" y="${T + 10}" text-anchor="end">${maxH}</text><text x="${L - 6}" y="${H - B}" text-anchor="end">${maxE}</text>`;
      a.flow.forEach((m, i) => {
        const x = L + i * step + (step - bw) / 2;
        const hh = y(m.hires, true), he = y(m.exits, false);
        s += `<rect x="${x}" y="${mid - hh}" width="${bw}" height="${hh}" rx="2" fill="#2f7d6d"><title>${m.month}: ${m.hires} hires</title></rect>`;
        s += `<rect x="${x}" y="${mid}" width="${bw}" height="${he}" rx="2" fill="#e5533d"><title>${m.month}: ${m.exits} exits</title></rect>`;
        if ((a.flow.length - 1 - i) % every === 0) {
          const [yy, mm] = m.month.split("-");
          s += `<text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${mon[+mm - 1]} ${yy.slice(2)}</text>`;
        }
      });
      box.innerHTML = `<svg role="img" aria-label="Monthly hires and exits over 24 months">${s}</svg>`;
    };
    flowObserver = new ResizeObserver(draw);
    flowObserver.observe(box);
  }

  // open with marked sample data so the page shows what it does
  load(E.parseCSV(E.sampleCSV()), "sample-company.csv", true);
}
