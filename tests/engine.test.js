// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../engine.js");

const run = (csv) => {
  const t = E.parseCSV(csv);
  const m = E.classify(t);
  const c = E.clean(t, m);
  const a = E.analyze(c);
  return { t, m, c, a, r: E.recommend(a, c), map: Object.fromEntries(m.filter((x) => x.field).map((x) => [x.column, x.field])) };
};

test("recognises every column of the messy sample file", () => {
  const { map } = run(E.sampleCSV());
  assert.equal(Object.keys(map).length, 18);
  assert.equal(map["Dept"], "department");
  assert.equal(map["Date of Joining"], "hire_date");
  assert.equal(map["Job Satisfaction"], "engagement");
});

test("recognises IBM HR Analytics attrition columns and ignores look-alikes", () => {
  const head = "Age,Attrition,BusinessTravel,DailyRate,Department,EmployeeCount,EmployeeNumber,EnvironmentSatisfaction,Gender,JobRole,JobSatisfaction,MaritalStatus,MonthlyIncome,OverTime,PercentSalaryHike,PerformanceRating,TrainingTimesLastYear,YearsAtCompany,YearsInCurrentRole,YearsSinceLastPromotion";
  const rows = [];
  for (let i = 0; i < 60; i++) rows.push([30 + (i % 20), i % 5 ? "No" : "Yes", "Travel_Rarely", 800, i % 2 ? "Sales" : "Research & Development", 1, 1 + i, 1 + (i % 4), i % 3 ? "Male" : "Female", "Sales Executive", 1 + ((i + 1) % 4), i % 2 ? "Single" : "Married", 3000 + i * 50, i % 4 ? "No" : "Yes", 11 + (i % 5), 3 + (i % 2), i % 6, i % 10, i % 4, i % 3].join(","));
  const { map, a } = run([head, ...rows].join("\n"));
  assert.equal(map["Attrition"], "status");
  assert.equal(map["MonthlyIncome"], "salary");
  assert.equal(map["JobSatisfaction"], "engagement");
  assert.equal(map["YearsAtCompany"], "tenure_years");
  assert.equal(map["EmployeeNumber"], "employee_id");
  assert.equal(map["MaritalStatus"], undefined);
  assert.equal(map["EmployeeCount"], undefined);
  assert.equal(a.leftCount, 12);
  assert.equal(a.attrition.basis, "all records");
  assert.equal(a.salaryPeriod, "month");
});

test("cleans duplicates, spelling variants, currency and mixed date formats", () => {
  const csv = [
    "Employee ID;Name;Department;Salary;Start Date;Status",
    "1;Ana;Sales;$50,000;2021-03-15;Active",
    "1;Ana;Sales;$50,000;2021-03-15;Active",      // exact duplicate
    "2;Bo; sales ;52k;15/04/2022;Active",          // spacing, case, k-suffix, d/m/y
    "3;Cy;SALES;48000;3 Jan 2020;Resigned",
    "4;Di;Finance;-5;44927;Active",                // invalid salary, Excel serial date
    "2;Bo dup id;Sales;1;2022-04-15;Active",       // duplicate employee id
  ].join("\n");
  const { c, map } = run(csv);
  assert.equal(map["Start Date"], "hire_date");
  assert.equal(c.log.duplicates, 1);
  assert.equal(c.log.duplicateIds, 1);
  assert.equal(c.records.length, 4);
  assert.deepEqual([...new Set(c.records.map((r) => r.department))].sort(), ["Finance", "Sales"]);
  assert.equal(c.records[1].salary, 52000);
  assert.equal(c.records[1].hire_date.toISOString().slice(0, 10), "2022-04-15");
  assert.equal(c.records[2].hire_date.toISOString().slice(0, 10), "2020-01-03");
  assert.equal(c.records[3].hire_date.toISOString().slice(0, 10), "2023-01-01");
  assert.equal(c.records[3].salary, null);
  assert.equal(c.records[2].status, "Left");
});

test("keeps acronyms like SDR as they are", () => {
  const csv = ["Name,Job Title", "A,SDR", "B,SDR", "C,Engineer"].join("\n");
  const { c } = run(csv);
  assert.ok(c.records.some((r) => r.job_title === "SDR"));
});

test("a minimal file still works and asks for more data", () => {
  const { a, r } = run(["Name,Department", "A,Ops", "B,Ops", "C,HR"].join("\n"));
  assert.equal(a.headcount, 3);
  assert.equal(a.attrition, null);
  assert.ok(r.growth.some((g) => /Track more data/.test(g.title)));
});

test("attrition over the last 12 months uses exit dates", () => {
  const rows = ["ID,Department,Hire Date,Exit Date"];
  for (let i = 0; i < 10; i++) rows.push(`${i},Ops,2020-01-01,${i < 2 ? "2026-03-01" : ""}`);
  rows.push("99,Ops,2020-01-01,2019-06-01"); // exit before hire -> dropped as invalid
  const { a, c } = run(rows.join("\n"));
  assert.equal(a.attrition.leavers, 2);
  assert.equal(a.attrition.basis, "last 12 months");
  assert.ok(Math.abs(a.attrition.rate - 2 / ((11 + 9) / 2)) < 1e-9);
  assert.ok(c.log.invalid.some((x) => x.field === "exit_date"));
});

test("flags a department losing people much faster than the company", () => {
  const { r } = run(E.sampleCSV());
  assert.ok(r.quick.length >= 3);
  assert.ok(r.quick.some((q) => /Customer Support|Sales/.test(q.title + q.why)));
  for (const q of r.quick) assert.ok(q.why && q.action);
});

test("parses quoted CSV with commas inside fields", () => {
  const t = E.parseCSV('Name,Department\n"Smith, Jo","Research, Development"\n');
  assert.deepEqual(t.rows[0], ["Smith, Jo", "Research, Development"]);
});
