// 브라우저 엔진(docs/assets/js/engine.js) 검증.  실행: node --test tests/engine.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as E from "../docs/assets/js/engine.js";

const demo = JSON.parse(readFileSync(new URL("../docs/data/busan_demo.json", import.meta.url), "utf8"));

test("lgamma matches known values", () => {
  assert.ok(Math.abs(E.lgamma(1)) < 1e-10);
  assert.ok(Math.abs(E.lgamma(5) - Math.log(24)) < 1e-10);
  assert.ok(Math.abs(E.lgamma(0.5) - Math.log(Math.sqrt(Math.PI))) < 1e-10);
});

test("negative binomial pmf sums to one", () => {
  let s = 0;
  for (let y = 0; y < 2000; y++) s += Math.exp(E.nbLogpmf(y, 120, 20));
  assert.ok(Math.abs(s - 1) < 1e-6);
});

test("mobility factor uses centered window with truncated edges", () => {
  const X = [100, 120, 80, 100, 110, 90, 100, 105];
  const out = E.mobilityFactor(X, 1000, { theta: 0.5, ratio: 4 });
  const c = out.c;
  const mean = a => a.reduce((p, q) => p + q, 0) / a.length;
  assert.ok(Math.abs(out.b[0] - mean(c.slice(0, 4))) < 1e-12);
  assert.ok(Math.abs(out.xi[4] - 2 * mean(c.slice(1, 8))) < 1e-12);
});

test("discrete model: R_t = 1 is the growth threshold", () => {
  const T = 30, N = 1e9, I0 = 1000;
  const out = E.simulateDiscrete(new Array(T).fill(1), new Array(T).fill(E.GAMMA), N - I0, I0, N);
  assert.ok(Math.abs(out.I[T - 1] / I0 - 1) < 1e-3);
});

test("final size satisfies 1 - z = exp(-R0 z)", () => {
  for (const R0 of [1.3, 2, 2.5]) {
    const z = E.finalSize(R0);
    assert.ok(Math.abs(1 - z - Math.exp(-R0 * z)) < 1e-10);
  }
});

test("particle smoother beats filter on the synthetic Busan season", () => {
  const r = E.runParticleFilter({ y: demo.cases, xi: demo.xi, N: demo.meta.N, nParticles: 1500, seed: 3 });
  const f = E.rmse(r.filter.Rt.med, demo.truth.Rt), s = E.rmse(r.smooth.Rt.med, demo.truth.Rt);
  assert.ok(s < f, `smooth ${s} should be below filter ${f}`);
  assert.ok(E.coverage(r.smooth.Rt.lo, r.smooth.Rt.hi, demo.truth.Rt) > 0.8);
  assert.ok(r.filter.pGt1.every(p => p >= 0 && p <= 1));
});

test("decomposition adds up to the total log change", () => {
  const xi = demo.xi, beta = demo.truth.beta, s = demo.truth.sfrac;
  const d = E.decompose(xi, beta, s, 120);
  assert.ok(Math.abs(d.dXi + d.dBeta + d.dS - d.total) < 1e-12);
});

test("mobility reduction lowers the scenario peak", () => {
  const T = demo.dates.length;
  const sc = E.mobilityScenario({ xi: demo.xi, beta: demo.truth.beta, sfrac: demo.truth.sfrac, I: demo.truth.C.map(c => c / E.GAMMA),
    N: demo.meta.N, t0: 70, dur: 28, reduction: 0.2 });
  assert.ok(sc.mScen.peak < sc.mBase.peak);
  assert.equal(sc.base.C.length, T - 70);
});

test("signal never jumps before three consecutive days", () => {
  const p = [0, 0, 0.99, 0.99, 0, 0, 0.99, 0.99, 0.99, 0.99];
  const rt = p.map(v => (v > 0.5 ? 1.5 : 0.9));
  const s = E.signalSeries(p, rt);
  assert.deepEqual(s.slice(0, 6), [0, 0, 0, 0, 0, 0]);
  assert.equal(s[8], 3);
});

test("hysteresis raises only to the level held for three days", () => {
  const s = E.signalSeries([0.6, 0.6, 0.99], [1.1, 1.1, 1.5]);
  assert.equal(s[2], 1);
});

test("surge needs the epidemic baseline as well", () => {
  assert.equal(E.rawLevel(0.99, 1.5, false), 1);
  assert.equal(E.rawLevel(0.99, 1.5, true), 3);
});

test("negative or missing counts are skipped instead of breaking the filter", () => {
  const y = demo.cases.slice();
  y[100] = -1; y[101] = NaN;
  const r = E.runParticleFilter({ y, xi: demo.xi, N: demo.meta.N, nParticles: 500, seed: 5 });
  assert.ok(r.filter.Rt.med.every(Number.isFinite));
  assert.ok(r.filter.pGt1.every(Number.isFinite));
});

test("weekly totals (observed once a week) still track R_t", () => {
  const y = demo.cases.map((_, t) => (t % 7 === 6 ? demo.cases.slice(t - 6, t + 1).reduce((a, b) => a + b, 0) : NaN));
  const r = E.runParticleFilter({ y, xi: demo.xi, N: demo.meta.N, nParticles: 1500, seed: 9 });
  assert.ok(E.rmse(r.smooth.Rt.med, demo.truth.Rt) < 0.15);
});

test("gaps in the mobility factor are interpolated", () => {
  assert.deepEqual(E.fillGaps([NaN, 1, NaN, 3, NaN]), [1, 1, 2, 3, 3]);
});
