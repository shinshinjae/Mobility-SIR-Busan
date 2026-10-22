// Mobility-SIR 계산 엔진 (브라우저·Node 공용 ES 모듈)
// 선행연구 식 (1)-(10) 과 analysis/msir/*.py 를 같은 구조로 옮겼다.
//   R_t = xi(t) beta(t) S(t) / (gamma N),  gamma^-1 = 4.1일
//   y_t ~ NegBin(mean = rho C_t, k)  — 입자필터(PF, 실시간) / 고정지연 입자평활(PS, 사후)

export const GAMMA = 1 / 4.1;

// ---------- 난수 (시드 고정으로 같은 화면을 재현) ----------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeNormal(rng) {
  let spare = null;
  return function () {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let u = 0, v = 0;
    while (u === 0) u = rng();
    v = rng();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
}

export function poisson(rng, normal, lam) {
  if (!(lam > 0)) return 0;
  if (lam < 30) {
    const L = Math.exp(-lam);
    let k = 0, p = 1;
    do { k++; p *= rng(); } while (p > L);
    return k - 1;
  }
  return Math.max(0, Math.round(lam + Math.sqrt(lam) * normal()));
}

export function binomial(rng, normal, n, p) {
  if (n <= 0 || p <= 0) return 0;
  if (p >= 1) return n;
  const mean = n * p;
  if (n < 40) {
    let k = 0;
    for (let i = 0; i < n; i++) if (rng() < p) k++;
    return k;
  }
  if (mean < 15) return Math.min(n, poisson(rng, normal, mean));
  const x = Math.round(mean + Math.sqrt(mean * (1 - p)) * normal());
  return Math.min(n, Math.max(0, x));
}

// Lanczos 근사
const LG = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
export function lgamma(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  x -= 1;
  let a = LG[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += LG[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

export function nbLogpmf(y, mu, k) {
  const m = Math.max(mu, 0.5);
  return lgamma(y + k) - lgamma(k) - lgamma(y + 1) + k * Math.log(k / (k + m)) + y * Math.log(m / (k + m));
}

// ---------- 이동성 계수 (식 5-10) ----------
export function movingAverage(x, k = 7, mode = "centered") {
  const n = x.length, h = Math.floor(k / 2), out = new Array(n);
  for (let t = 0; t < n; t++) {
    const lo = mode === "centered" ? Math.max(0, t - h) : Math.max(0, t - k + 1);
    const hi = mode === "centered" ? Math.min(n - 1, t + h) : t;
    let s = 0, c = 0;
    for (let u = lo; u <= hi; u++) if (Number.isFinite(x[u])) { s += x[u]; c++; }
    out[t] = c ? s / c : NaN;
  }
  return out;
}

export function mobilityFactor(boardings, population, { theta = 0.5, ratio = 1, window = "centered", k = 7 } = {}) {
  const m = boardings.map(v => (Number.isFinite(v) ? v / population : NaN));
  const valid = m.filter(Number.isFinite);
  const L = valid.reduce((a, b) => a + b, 0) / valid.length;
  const c = m.map(v => v / L);
  const b = movingAverage(c, k, window);
  const scale = Math.pow(ratio, theta);
  return { m, L, c, b, xi: b.map(v => scale * v) };
}

// ---------- 결정론적 SIR (RK4) ----------
export function simulateODE(xi, beta, S0, I0, N, gamma = GAMMA, substeps = 8) {
  const T = xi.length, S = new Array(T), I = new Array(T), C = new Array(T), Rt = new Array(T);
  let s = S0, i = I0;
  const h = 1 / substeps;
  for (let t = 0; t < T; t++) {
    S[t] = s; I[t] = i;
    const k = xi[t] * beta[t];
    Rt[t] = k * s / (gamma * N);
    const f = (s_, i_) => { const inf = k * s_ * i_ / N; return [-inf, inf - gamma * i_, inf]; };
    let nw = 0;
    for (let q = 0; q < substeps; q++) {
      const a1 = f(s, i);
      const a2 = f(s + h / 2 * a1[0], i + h / 2 * a1[1]);
      const a3 = f(s + h / 2 * a2[0], i + h / 2 * a2[1]);
      const a4 = f(s + h * a3[0], i + h * a3[1]);
      s += h / 6 * (a1[0] + 2 * a2[0] + 2 * a3[0] + a4[0]);
      i += h / 6 * (a1[1] + 2 * a2[1] + 2 * a3[1] + a4[1]);
      nw += h / 6 * (a1[2] + 2 * a2[2] + 2 * a3[2] + a4[2]);
    }
    C[t] = nw;
  }
  return { S, I, C, Rt };
}

// 입자필터 전이식의 결정론적 판(일 단위 Euler): 기대 성장배율 1 + gamma(R_t - 1)
export function simulateDiscrete(xi, beta, S0, I0, N, gamma = GAMMA) {
  const T = xi.length, S = new Array(T), I = new Array(T), C = new Array(T), Rt = new Array(T);
  let s = S0, i = I0;
  for (let t = 0; t < T; t++) {
    S[t] = s; I[t] = i;
    Rt[t] = xi[t] * beta[t] * s / (gamma * N);
    const c = Math.min(xi[t] * beta[t] * s * i / N, s);
    C[t] = c;
    s -= c; i += c - gamma * i;
  }
  return { S, I, C, Rt };
}

// 결측(NaN)·0 이하 값을 앞뒤 값 사이 선형보간으로 채운다(양 끝은 가장 가까운 값)
export function fillGaps(x) {
  const v = x.map(a => (Number.isFinite(a) && a > 0 ? a : NaN));
  const idx = v.map((a, i) => (Number.isFinite(a) ? i : -1)).filter(i => i >= 0);
  if (!idx.length) throw new Error("이동성 계수(ξ)에 유효한 값이 없습니다.");
  return v.map((a, i) => {
    if (Number.isFinite(a)) return a;
    let lo = -1, hi = -1;
    for (const k of idx) { if (k < i) lo = k; else { hi = k; break; } }
    if (lo < 0) return v[hi];
    if (hi < 0) return v[lo];
    return v[lo] + (v[hi] - v[lo]) * (i - lo) / (hi - lo);
  });
}

// ---------- 입자필터 + 고정지연 입자평활 ----------
function weightedQuantiles(vals, w, idx, qs) {
  idx.sort((a, b) => vals[a] - vals[b]);
  let tot = 0;
  for (let j = 0; j < idx.length; j++) tot += w[idx[j]];
  const out = new Array(qs.length);
  let cw = 0, q = 0;
  for (let j = 0; j < idx.length && q < qs.length; j++) {
    cw += w[idx[j]] / tot;
    while (q < qs.length && cw >= qs[q]) { out[q] = vals[idx[j]]; q++; }
  }
  while (q < qs.length) { out[q] = vals[idx[idx.length - 1]]; q++; }
  return out;
}

export function runParticleFilter({
  y, xi, N, nParticles = 2000, gamma = GAMMA, sigma = 0.05, kObs = 20, rho = 1,
  lag = 14, seed = 2026, r0Prior = 1.0, qs = [0.05, 0.5, 0.95],
} = {}) {
  const T = y.length, P = nParticles;
  const rng = mulberry32(seed), normal = makeNormal(rng);
  xi = fillGaps(xi);
  // 관측이 있는 날만 가중치를 갱신한다. 일별·주별(주말에만 값) 관측 모두 '직전 관측 이후 누적 신규감염'과 비교한다.
  const ok = v => Number.isFinite(v) && v >= 0;
  const head = y.slice(0, Math.min(14, T));
  const y0 = Math.max(head.filter(ok).reduce((a, b) => a + b, 0) / Math.max(head.length, 1), 1);

  let S = new Float64Array(P), I = new Float64Array(P), logb = new Float64Array(P), cum = new Float64Array(P);
  for (let j = 0; j < P; j++) {
    const R = r0Prior * Math.exp(0.2 * normal());
    I[j] = Math.max(1, Math.round(y0 / (rho * gamma * R) * Math.exp(0.3 * normal())));
    S[j] = N - I[j];
    logb[j] = Math.log(R * gamma * N / (xi[0] * S[j]));
  }

  const vRt = new Float32Array(T * P), vBeta = new Float32Array(T * P);
  const vS = new Float32Array(T * P), vI = new Float32Array(T * P), vC = new Float32Array(T * P);
  const W = new Float64Array(T * P), A = new Int32Array(T * P);
  let logw = new Float64Array(P);
  const pRec = gamma;
  const C = new Float64Array(P), D = new Float64Array(P), w = new Float64Array(P);
  const ess = new Float64Array(T);

  for (let t = 0; t < T; t++) {
    const off = t * P;
    for (let j = 0; j < P; j++) {
      const beta = Math.exp(logb[j]);
      const lam = xi[t] * beta * S[j] * I[j] / N;
      C[j] = Math.min(poisson(rng, normal, lam), S[j]);
      D[j] = binomial(rng, normal, Math.round(I[j]), pRec);
      vRt[off + j] = xi[t] * beta * S[j] / (gamma * N);
      vBeta[off + j] = beta;
      vS[off + j] = S[j] / N;
      vI[off + j] = I[j];
      vC[off + j] = C[j];
      cum[j] += C[j];
      if (ok(y[t])) logw[j] += nbLogpmf(y[t], rho * cum[j], kObs);
    }
    if (ok(y[t])) cum.fill(0);
    let mx = -Infinity;
    for (let j = 0; j < P; j++) if (logw[j] > mx) mx = logw[j];
    if (!Number.isFinite(mx)) { logw.fill(0); mx = 0; }
    let tot = 0;
    for (let j = 0; j < P; j++) { w[j] = Math.exp(logw[j] - mx); tot += w[j]; }
    let s2 = 0;
    for (let j = 0; j < P; j++) { w[j] /= tot; W[off + j] = w[j]; s2 += w[j] * w[j]; }
    ess[t] = 1 / s2;
    const idx = new Int32Array(P);
    if (ess[t] < P / 2) {
      const u0 = rng() / P;
      let cs = w[0], i = 0;
      for (let j = 0; j < P; j++) {
        const u = u0 + j / P;
        while (u > cs && i < P - 1) { i++; cs += w[i]; }
        idx[j] = i;
      }
      logw = new Float64Array(P);
    } else {
      for (let j = 0; j < P; j++) { idx[j] = j; logw[j] = logw[j] - (mx + Math.log(tot)); }
    }
    A.set(idx, off);
    const nS = new Float64Array(P), nI = new Float64Array(P), nb = new Float64Array(P), nc = new Float64Array(P);
    for (let j = 0; j < P; j++) {
      const a = idx[j];
      nS[j] = S[a] - C[a];
      nI[j] = Math.max(I[a] + C[a] - D[a], 1);
      nb[j] = logb[a] + sigma * normal();
      nc[j] = cum[a];
    }
    S = nS; I = nI; logb = nb; cum = nc;
  }

  const order = Array.from({ length: P }, (_, j) => j);
  const mk = () => ({ lo: new Array(T), med: new Array(T), hi: new Array(T) });
  const filt = { Rt: mk(), beta: mk(), sfrac: new Array(T), I: new Array(T), C: new Array(T), pGt1: new Array(T) };
  const smth = { Rt: mk(), beta: mk(), sfrac: new Array(T), I: new Array(T), C: new Array(T), pGt1: new Array(T) };
  const tmpR = new Float64Array(P), tmpB = new Float64Array(P), wt = new Float64Array(P);

  function summarize(target, s, getVal, weights) {
    let sf = 0, si = 0, sc = 0, pg = 0;
    for (let j = 0; j < P; j++) {
      const v = getVal(j);
      tmpR[j] = vRt[v]; tmpB[j] = vBeta[v]; wt[j] = weights[j];
      sf += wt[j] * vS[v]; si += wt[j] * vI[v]; sc += wt[j] * vC[v];
      if (vRt[v] > 1) pg += wt[j];
    }
    const qr = weightedQuantiles(tmpR, wt, order, qs);
    const qb = weightedQuantiles(tmpB, wt, order, qs);
    target.Rt.lo[s] = qr[0]; target.Rt.med[s] = qr[1]; target.Rt.hi[s] = qr[2];
    target.beta.lo[s] = qb[0]; target.beta.med[s] = qb[1]; target.beta.hi[s] = qb[2];
    target.sfrac[s] = sf; target.I[s] = si; target.C[s] = sc * rho; target.pGt1[s] = Math.min(1, Math.max(0, pg));
  }

  const wf = new Float64Array(P);
  for (let t = 0; t < T; t++) {
    for (let j = 0; j < P; j++) wf[j] = W[t * P + j];
    summarize(filt, t, j => t * P + j, wf);
  }
  const lineage = new Int32Array(P);
  for (let s = 0; s < T; s++) {
    const t = Math.min(s + lag, T - 1);
    for (let j = 0; j < P; j++) { lineage[j] = j; wf[j] = W[t * P + j]; }
    for (let u = t - 1; u >= s; u--) {
      const off = u * P;
      for (let j = 0; j < P; j++) lineage[j] = A[off + lineage[j]];
    }
    summarize(smth, s, j => s * P + lineage[j], wf);
  }
  return { filter: filt, smooth: smth, ess: Array.from(ess), qs, settings: { nParticles: P, sigma, kObs, rho, lag, seed, gamma } };
}

// ---------- 지표 ----------
export function rmse(a, b) {
  let s = 0, n = 0;
  for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i]) && Number.isFinite(b[i])) { s += (a[i] - b[i]) ** 2; n++; }
  return Math.sqrt(s / n);
}

export function coverage(lo, hi, truth) {
  let c = 0;
  for (let i = 0; i < truth.length; i++) if (lo[i] <= truth[i] && truth[i] <= hi[i]) c++;
  return c / truth.length;
}

// log R_t = log xi + log beta + log(S/N) - log gamma — 7일 평균 로그값 차이로 기여 분해
export function decompose(xi, beta, sfrac, t, win = 7) {
  const mean = (arr, a, b) => { let s = 0; for (let i = a; i <= b; i++) s += Math.log(arr[i]); return s / (b - a + 1); };
  const e = Math.max(t, 2 * win - 1), a1 = e - win + 1, a0 = e - 2 * win + 1;
  const dXi = mean(xi, a1, e) - mean(xi, a0, a1 - 1);
  const dB = mean(beta, a1, e) - mean(beta, a0, a1 - 1);
  const dS = mean(sfrac, a1, e) - mean(sfrac, a0, a1 - 1);
  const total = dXi + dB + dS;
  return { end: e, dXi, dBeta: dB, dS, total, pct: (Math.exp(total) - 1) * 100 };
}

// 내부 검토 신호: P(R_t > 1 | y_1..t) 와 유행 기준선으로 4단계 분류(공식 경보는 질병관리청 유행주의보).
// 단계는 3일 연속 같은 방향일 때만 바꾸고, 올릴 때는 3일 중 가장 낮은 단계, 내릴 때는 가장 높은 단계로 바꾼다.
// 기준선 미만에서는 '관찰'까지만 올린다.
export const LEVELS = [
  { key: "stable", name: "안정", color: "#2e7d5b", desc: "R_t > 1 일 확률 50% 미만" },
  { key: "watch", name: "관찰", color: "#c9a227", desc: "확률 50% 이상(기준선 미만 포함)" },
  { key: "rising", name: "상승", color: "#e07b24", desc: "확률 80% 이상 + 7일 평균 ≥ 유행 기준선" },
  { key: "surge", name: "급상승", color: "#c62f2f", desc: "확률 95% 이상 + R_t 중앙값 ≥ 1.3 + 기준선 이상" },
];

export function rawLevel(p, rtMed, aboveBaseline = true) {
  if (!Number.isFinite(p)) return 0;
  if (p >= 0.95 && rtMed >= 1.3) return aboveBaseline ? 3 : 1;
  if (p >= 0.8) return aboveBaseline ? 2 : 1;
  if (p >= 0.5) return 1;
  return 0;
}

// 유행 기준선 τ = 비유행 구간 7일 평균의 평균 + 2SD.
// threshold 를 주면(과거 절기에서 미리 계산한 값) 그대로 쓰고, 없으면 7일 평균이 가장 낮은 연속 8주 구간으로 계산한다.
export function epidemicBaseline(cases, { threshold = null, weeks = 8 } = {}) {
  const clean = cases.map(v => (Number.isFinite(v) && v >= 0 ? v : NaN));
  const ma = movingAverage(clean, 7, "trailing");
  if (threshold != null) return { ma7: ma, threshold, method: "external" };
  const W = weeks * 7;
  let best = Infinity, bi = 0;
  for (let i = 6; i + W <= ma.length; i++) {
    let s = 0, n = 0;
    for (let k = i; k < i + W; k++) if (Number.isFinite(ma[k])) { s += ma[k]; n++; }
    if (n > W / 2 && s / n < best) { best = s / n; bi = i; }
  }
  const seg = ma.slice(bi, bi + W).filter(Number.isFinite);
  const mean = seg.reduce((a, b) => a + b, 0) / seg.length;
  const sd = Math.sqrt(seg.reduce((a, b) => a + (b - mean) ** 2, 0) / seg.length);
  return { ma7: ma, mean, sd, threshold: mean + 2 * sd, method: "lowest-8w", from: bi, to: bi + W - 1 };
}

export function signalSeries(pGt1, rtMed, ma7 = null, threshold = null) {
  const out = new Array(pGt1.length);
  let cur = 0, dir = 0, run = 0, ext = 0;
  for (let t = 0; t < pGt1.length; t++) {
    const above = ma7 == null || threshold == null ? true : ma7[t] >= threshold;
    const r = rawLevel(pGt1[t], rtMed[t], above);
    const d = Math.sign(r - cur);
    if (d === 0) { dir = 0; run = 0; }
    else {
      if (d !== dir) { dir = d; run = 0; ext = r; }
      run++;
      ext = d > 0 ? Math.min(ext, r) : Math.max(ext, r);
      if (run >= 3) { cur = ext; dir = 0; run = 0; }
    }
    out[t] = cur;
  }
  return out;
}

// 이동성 시나리오: t0 부터 dur 일간 xi 를 (1-r)^eta 배로 줄여 다시 계산 (동적 반사실)
// eta: 이동 감소가 접촉 감소로 이어지는 탄력성(1 = 선행연구 모형과 같은 비례 가정)
export function mobilityScenario({ xi, beta, sfrac, I, N, t0, dur, reduction, elasticity = 1, gamma = GAMMA }) {
  const T = xi.length;
  const xiB = xi.slice(t0), betaB = beta.slice(t0);
  const f = Math.pow(1 - reduction, elasticity);
  const xiS = xiB.map((v, i) => (i < dur ? v * f : v));
  const S0 = sfrac[t0] * N, I0 = I[t0];
  const base = simulateDiscrete(xiB, betaB, S0, I0, N, gamma);
  const scen = simulateDiscrete(xiS, betaB, S0, I0, N, gamma);
  const metrics = sim => {
    let peak = 0, peakDay = 0, cum = 0, days = 0, area = 0;
    sim.C.forEach((c, i) => { if (c > peak) { peak = c; peakDay = i; } cum += c; });
    sim.Rt.forEach(r => { if (r > 1) { days++; area += r - 1; } });
    return { peak, peakDay: t0 + peakDay, cumulative: cum, daysRtGt1: days, excessArea: area };
  };
  // 연구 저장소와 같은 정적 반사실: beta, S 고정, R_c = (1-r) R
  const staticRt = base.Rt.map((r, i) => (i < dur ? r * f : r));
  return { t0, dur, reduction, T, base, scen, mBase: metrics(base), mScen: metrics(scen),
    staticDays: staticRt.filter(r => r > 1).length };
}

// 상수 R0 SIR 최종 발병률: 1 - z = exp(-R0 z)
export function finalSize(R0) {
  if (R0 <= 1) return 0;
  let z = 0.5;
  for (let i = 0; i < 200; i++) {
    const g = 1 - z - Math.exp(-R0 * z), dg = -1 + R0 * Math.exp(-R0 * z);
    const zn = z - g / dg;
    if (Math.abs(zn - z) < 1e-12) return zn;
    z = zn;
  }
  return z;
}
