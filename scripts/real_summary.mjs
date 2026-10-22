// 부산 실제자료 6개 절기 후향 재현 요약과 합성 검증 지표를 계산해 docs/data/validation_summary.json 에 쓴다.
// 실행: node scripts/real_summary.mjs
import { readFileSync, writeFileSync } from "node:fs";
import * as E from "../docs/assets/js/engine.js";

const root = new URL("../docs/data/", import.meta.url);
const real = JSON.parse(readFileSync(new URL("busan_real.json", root), "utf8"));
const demo = JSON.parse(readFileSync(new URL("busan_demo.json", root), "utf8"));
const day = s => Math.round(new Date(s).getTime() / 864e5);
const SET = { nParticles: 2000, seed: 7, sigma: 0.05, kObs: 20, lag: 14 };

function simpleRule(ma7, tau) {
  // 비교 기준: 7일 평균 ≥ τ 이고 1주 전보다 증가한 날이 3일 이어지면 켜짐
  const on = ma7.map((v, t) => t >= 7 && v >= tau && v > ma7[t - 7]);
  let first = -1, run = 0;
  for (let t = 0; t < on.length; t++) { run = on[t] ? run + 1 : 0; if (run >= 3) { first = t - 2; break; } }
  return { on, first };
}

const seasons = real.seasons.map(s => {
  const r = E.runParticleFilter({ y: s.cases, xi: s.xi_rt, N: s.N, ...SET });
  const B = E.epidemicBaseline(s.cases, { threshold: s.tau });
  const sig = E.signalSeries(r.filter.pGt1, r.filter.Rt.med, B.ma7, B.threshold);
  const first = sig.findIndex(v => v >= 2);
  const cross = B.ma7.findIndex(v => v >= B.threshold);
  const simple = simpleRule(B.ma7, B.threshold);
  const pk = s.cases.indexOf(Math.max(...s.cases));
  const obs7 = E.movingAverage(s.cases, 7, "centered"), fit7 = E.movingAverage(r.smooth.C, 7, "centered");
  let ae = 0, n = 0;
  obs7.forEach((v, i) => { if (Number.isFinite(v) && Number.isFinite(fit7[i])) { ae += Math.abs(v - fit7[i]); n++; } });
  const mean = s.cases.reduce((a, b) => a + b, 0) / s.cases.length;
  let modelOn = 0, modelFalse = 0, simpleOn = 0, simpleFalse = 0;
  for (let t = 0; t < s.cases.length; t++) {
    const decl = r.smooth.Rt.med[t] < 1;   // 사후 확정 R_t 가 1 미만인데 신호가 켜진 날
    if (sig[t] >= 2) { modelOn++; if (decl) modelFalse++; }
    if (simple.on[t]) { simpleOn++; if (decl) simpleFalse++; }
  }
  return {
    season: s.season, N: s.N, L_ratio: s.L_ratio, tau: s.tau,
    total: s.summary.total, peak: s.summary.peak, peak_date: s.summary.peak_date,
    advisory: s.advisory.date, advisory_source: s.advisory.source,
    first_signal: first >= 0 ? s.dates[first] : null,
    baseline_cross: cross >= 0 ? s.dates[cross] : null,
    simple_rule: simple.first >= 0 ? s.dates[simple.first] : null,
    lead_vs_advisory: first >= 0 ? day(s.advisory.date) - day(s.dates[first]) : null,
    lead_vs_peak: first >= 0 ? pk - first : null,
    rt_peak_smooth: Math.max(...r.smooth.Rt.med), rt_peak_filter: Math.max(...r.filter.Rt.med),
    mae7: ae / n, mae7_rel_peak: ae / n / s.summary.peak, mean_daily: mean,
    model_on: modelOn, model_false: modelFalse, simple_on: simpleOn, simple_false: simpleFalse,
    partial: s.season === "2024-25",
  };
});

const leads = seasons.map(s => s.lead_vs_advisory).filter(v => v != null).sort((a, b) => a - b);
const median = leads.length % 2 ? leads[(leads.length - 1) / 2] : (leads[leads.length / 2 - 1] + leads[leads.length / 2]) / 2;

// 합성 검증: 운영 설정(후행 ξ) 과 연구 설정(중심 ξ)
const N = demo.meta.N;
const xiRt = E.mobilityFactor(demo.boardings, N, { theta: demo.meta.theta, ratio: demo.meta.L_ratio, window: "trailing" }).xi;
const synth = {};
for (const [key, xi] of [["operational_trailing", xiRt], ["research_centered", demo.xi]]) {
  const r = E.runParticleFilter({ y: demo.cases, xi, N, ...SET });
  const B = E.epidemicBaseline(demo.cases);
  const sig = E.signalSeries(r.filter.pGt1, r.filter.Rt.med, B.ma7, B.threshold);
  const R = demo.truth.Rt, T = R.length;
  let on = 0, hit = 0;
  sig.forEach((v, t) => { if (v >= 2) { on++; if (R[t] > 1) hit++; } });
  const waves = [];
  for (let t = 0; t < T;) { if (R[t] > 1.15) { let e = t; while (e + 1 < T && R[e + 1] > 1.15) e++; if (e - t + 1 >= 7) waves.push([t, e]); t = e + 1; } else t++; }
  const lead = waves.map(([a, b]) => {
    let s = -1; for (let t = Math.max(0, a - 14); t <= b; t++) if (sig[t] >= 2) { s = t; break; }
    let p = a; for (let t = a; t <= Math.min(T - 1, b + 30); t++) if (demo.cases[t] > demo.cases[p]) p = t;
    return { wave: [demo.dates[a], demo.dates[b]], signal: s >= 0 ? demo.dates[s] : null, peak: demo.dates[p], lead: s >= 0 ? p - s : null };
  });
  const fr = E.rmse(r.filter.Rt.med, R), sr = E.rmse(r.smooth.Rt.med, R);
  synth[key] = {
    pf_rmse: fr, ps_rmse: sr, reduction_pct: (1 - sr / fr) * 100,
    pf_cover90: E.coverage(r.filter.Rt.lo, r.filter.Rt.hi, R), ps_cover90: E.coverage(r.smooth.Rt.lo, r.smooth.Rt.hi, R),
    precision: on ? hit / on : null, signal_days: on, waves: lead, tau: B.threshold,
  };
}

const out = { generated: "scripts/real_summary.mjs", settings: SET, real: { seasons, median_lead_vs_advisory: median, earlier_count: leads.filter(v => v > 0).length, n: leads.length }, synthetic: synth };
writeFileSync(new URL("validation_summary.json", root), JSON.stringify(out, null, 1));
console.table(seasons.map(s => ({ season: s.season, first: s.first_signal, simple: s.simple_rule, advisory: s.advisory, lead: s.lead_vs_advisory, peak: s.peak_date, rtPeak: s.rt_peak_smooth.toFixed(2), mae7: s.mae7.toFixed(1), modelOn: s.model_on, modelFalse: s.model_false, simpleOn: s.simple_on, simpleFalse: s.simple_false })));
console.log("median lead", median, "earlier", out.real.earlier_count, "/", out.real.n);
for (const [k, v] of Object.entries(synth)) console.log(k, v.pf_rmse.toFixed(4), v.ps_rmse.toFixed(4), v.reduction_pct.toFixed(1), v.pf_cover90.toFixed(3), v.ps_cover90.toFixed(3), "prec", v.precision?.toFixed(3), v.signal_days, JSON.stringify(v.waves.map(w => [w.signal, w.peak, w.lead])), "tau", v.tau.toFixed(1));
