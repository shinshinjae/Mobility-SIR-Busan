// Mobility-SIR 부산 — 화면 구성
import * as E from "./engine.js";

const $ = (sel, root = document) => root.querySelector(sel);
const app = () => document.getElementById("app");

const state = {
  datasets: [],      // 실제자료 시즌들 + 합성 검증 시즌
  ds: null,          // 지금 보고 있는 데이터셋
  cache: {},         // 데이터셋별 계산 결과
  demo: null, real: null, ref: null, summary: null,
  pf: null, base: null, signals: [],
  asOf: 0,
  showTruth: true,
  scen: { start: null, dur: 28, red: 0.1, eta: 0.5 },
  charts: [],
  route: "home",
};

// ---------- 형식 ----------
const MINUS = "−";
const nf = (x, d = 0) => {
  if (!Number.isFinite(x)) return "–";
  const v = +x.toFixed(d) || 0;
  return (v < 0 ? MINUS : "") + Math.abs(v).toLocaleString("ko-KR", { minimumFractionDigits: d, maximumFractionDigits: d });
};
const pct = (x, d = 0) => (Number.isFinite(x) ? `${(+x.toFixed(d) || 0) > 0 ? "+" : ""}${nf(x, d)}%` : "–");
const prob = p => (!Number.isFinite(p) ? "–" : p >= 0.995 ? "&gt;99%" : p < 0.005 ? "&lt;1%" : `${nf(p * 100)}%`);
const dlabel = iso => { const [y, m, d] = iso.split("-"); return `${y}.${+m}.${+d}.`; };
const shortDate = iso => { const [, m, d] = iso.split("-"); return `${+m}/${+d}`; };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sym = t => t.replace(/R_t/g, "R<sub>t</sub>").replace(/beta\(t\)/g, "β(t)").replace(/S\(t\)/g, "S(t)");
const dayDiff = (a, b) => Math.round((new Date(a) - new Date(b)) / 864e5);
const signalOf = level => E.LEVELS[level];
const OFFICIAL = "공식 경보는 질병관리청 유행주의보입니다. 이 신호는 부산시 내부 검토용입니다.";

// ---------- 차트 ----------
const vlines = {
  id: "vlines",
  afterDatasetsDraw(chart, _a, opts) {
    const lines = (opts && opts.lines) || [];
    const { top, bottom, left, right } = chart.chartArea, ctx = chart.ctx;
    lines.forEach((ln, k) => {
      if (ln.index == null || ln.index < 0) return;
      const x = chart.scales.x.getPixelForValue(ln.index);
      ctx.save();
      ctx.strokeStyle = ln.color || "#0b2545";
      ctx.lineWidth = 1.5;
      ctx.setLineDash(ln.dash || [5, 4]);
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
      if (ln.label) {
        ctx.setLineDash([]);
        ctx.font = "600 11px Pretendard, sans-serif";
        const w = ctx.measureText(ln.label).width + 10;
        const lx = Math.min(Math.max(x - w / 2, left), right - w);
        const ly = top + k * 19;
        ctx.fillStyle = ln.color || "#0b2545";
        ctx.fillRect(lx, ly, w, 17);
        ctx.fillStyle = "#fff";
        ctx.fillText(ln.label, lx + 5, ly + 12);
      }
      ctx.restore();
    });
  },
};

function destroyCharts() { state.charts.forEach(c => c.destroy()); state.charts = []; }

function monthTicks(labels) {
  return {
    ticks: {
      autoSkip: false, maxRotation: 0,
      callback: (v, i) => (labels[i] && labels[i].endsWith("-01") ? `${+labels[i].slice(5, 7)}월` : ""),
      font: { size: 11 },
    },
    grid: { color: ctx => (labels[ctx.index] && labels[ctx.index].endsWith("-01") ? "#e6eaf1" : "transparent") },
  };
}

function makeChart(canvas, { labels, datasets, y = {}, y2 = null, lines = [], legend = true, type = "line", stacked = false }) {
  const scales = { x: { ...monthTicks(labels), stacked }, y: { beginAtZero: false, grid: { color: "#eef1f6" }, stacked, ...y } };
  if (y2) scales.y2 = { position: "right", grid: { display: false }, ...y2 };
  const chart = new Chart(canvas, {
    type,
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, normalized: true,
      interaction: { mode: "index", intersect: false },
      elements: { point: { radius: 0, hitRadius: 6 }, line: { borderWidth: 2, tension: 0.15 } },
      plugins: {
        legend: { display: legend, labels: { boxWidth: 12, boxHeight: 12, font: { size: 12 }, filter: it => !it.text.startsWith("_") } },
        tooltip: {
          filter: it => !it.dataset.label.startsWith("_"),
          callbacks: { title: items => (items.length ? dlabel(labels[items[0].dataIndex]) : "") },
        },
        vlines: { lines },
      },
      scales,
    },
    plugins: [vlines],
  });
  state.charts.push(chart);
  return chart;
}

const upto = (arr, k) => arr.map((v, i) => (i <= k ? v : null));
const between = (arr, a, b) => arr.map((v, i) => (i >= a && i <= b ? v : null));

// ---------- 데이터셋 ----------
function buildDatasets() {
  const list = state.real.seasons.map(s => ({
    key: `real:${s.season}`, label: `${s.season.replace("-", "–")}절기${s.season === "2024-25" ? "(12.31.까지)" : ""}`,
    name: `부산 실제자료 ${s.season.replace("-", "–")}절기`, synthetic: false,
    dates: s.dates, cases: s.cases, xi: s.xi_rt, xiResearch: s.xi, boardings: s.boardings, N: s.N,
    tau: s.tau, advisory: s.advisory, L_ratio: s.L_ratio,
    defaultAsOf: s.season === "2024-25" ? s.dates.indexOf(s.advisory.date) : null,
  }));
  const d = state.demo;
  const xiRt = E.mobilityFactor(d.boardings, d.meta.N, { theta: d.meta.theta, ratio: d.meta.L_ratio, window: "trailing" }).xi;
  list.push({
    key: "synthetic", label: "합성 검증 시즌(정답 있음)", name: "합성 검증 시즌", synthetic: true,
    dates: d.dates, cases: d.cases, xi: xiRt, xiResearch: d.xi, boardings: d.boardings, N: d.meta.N, truth: d.truth,
    defaultAsOf: d.dates.indexOf("2025-12-01"),
  });
  return list;
}

function analyse(ds) {
  if (!state.cache[ds.key]) {
    const pf = E.runParticleFilter({ y: ds.cases, xi: ds.xi, N: ds.N, nParticles: 2000, seed: 7, sigma: 0.05, kObs: 20, lag: 14 });
    const base = E.epidemicBaseline(ds.cases, { threshold: ds.tau ?? null });
    const signals = E.signalSeries(pf.filter.pGt1, pf.filter.Rt.med, base.ma7, base.threshold);
    state.cache[ds.key] = { pf, base, signals };
  }
  Object.assign(state, state.cache[ds.key]);
  const T = ds.dates.length;
  const firstRise = state.signals.findIndex(s => s >= 2);
  state.asOf = Math.min(T - 1, Math.max(20, ds.defaultAsOf != null && ds.defaultAsOf >= 0 ? ds.defaultAsOf : T - 1));
  state.scen.start = firstRise > 0 ? firstRise : Math.floor(T / 3);
}

function setDataset(ds) { state.ds = ds; analyse(ds); }

function nowStats(t) {
  const ds = state.ds, f = state.pf.filter;
  const rt = f.Rt.med[t], r = Math.log(Math.max(1e-9, 1 + E.GAMMA * (rt - 1)));
  const xs = ds.xi.slice(0, t + 1).filter(Number.isFinite);
  const xiMean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const ma = state.base.ma7[t], maPrev = state.base.ma7[Math.max(0, t - 7)];
  return {
    level: state.signals[t], rt, lo: f.Rt.lo[t], hi: f.Rt.hi[t], p: f.pGt1[t],
    growth: r, doubling: r > 0.002 ? Math.log(2) / r : null, halving: r < -0.002 ? Math.log(2) / -r : null,
    xi: ds.xi[t], xiDev: (ds.xi[t] / xiMean - 1) * 100, beta: f.beta.med[t],
    ma7: ma, maChange: maPrev > 0 ? (ma / maPrev - 1) * 100 : null, thr: state.base.threshold,
  };
}

function seasonFacts(t) {
  const ds = state.ds, sig = state.signals, f = state.pf.filter;
  const rise = sig.findIndex(s => s >= 2);
  let passed = -1;
  for (let u = Math.max(1, rise); rise >= 0 && u <= t; u++) if (f.Rt.med[u] < 1 && f.pGt1[u] < 0.5) { passed = u; break; }
  let peak = -1;
  if (rise >= 0) { peak = rise; for (let u = rise; u <= t; u++) if (ds.cases[u] > ds.cases[peak]) peak = u; }
  const adv = ds.advisory ? ds.dates.indexOf(ds.advisory.date) : -1;
  return { rise, passed, peak, adv };
}

// 요인 분해: 합계와 같은 방향인 요인 중 가장 큰 것을 주 요인으로
function dominant(d) {
  const parts = [["이동성", d.dXi], ["고유 전파력", d.dBeta], ["감수성", d.dS]];
  const same = parts.filter(p => Math.sign(p[1]) === Math.sign(d.total) && p[1] !== 0).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  return same.length ? same[0][0] : "혼합";
}

// ---------- 화면: 개요 ----------
function renderHome() {
  const r = state.ref, sm = state.summary.real, seasons = sm.seasons;
  const mf = seasons.reduce((a, s) => a + s.model_false, 0), sf = seasons.reduce((a, s) => a + s.simple_false, 0);
  app().innerHTML = `
  <section class="hero">
    <svg class="hero-art" viewBox="0 0 420 220" aria-hidden="true">
      <path d="M0 190 C80 190 110 60 170 60 S250 170 320 120 S390 80 420 90" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="4"/>
      <path d="M0 205 H420" stroke="rgba(150,195,255,.7)" stroke-width="3" stroke-dasharray="10 8"/>
      ${[30, 110, 190, 270, 350].map(x => `<circle cx="${x}" cy="205" r="7" fill="#0b2545" stroke="#9cc4ff" stroke-width="3"/>`).join("")}
      <circle cx="170" cy="60" r="9" fill="#ffb347"/>
    </svg>
    <div class="hero-tags"><span>부산교통공사 도시철도 승차</span><span>NHIS 인플루엔자 의료이용</span><span>이동성 기반 SIR</span><span>입자필터·평활</span></div>
    <h1>도시철도 승차 데이터로<br>부산의 인플루엔자 전파를 읽습니다</h1>
    <p class="lead">출발–도착(OD) 자료나 개인 위치정보 없이, 공개된 도시철도 승차량으로 이동성 계수 ξ(t)를 만들어 R<sub>t</sub>를 정확히 읽는 보정 변수로 씁니다.
    건보 인플루엔자 의료이용과 결합한 이동성 기반 SIR로 부산의 감염재생산지수 R<sub>t</sub>와 이동성 보정 전파율 β(t)를 추정해,
    보건 담당자가 <b>지금 퍼지고 있는지</b>, <b>무엇이 움직이고 있는지</b>, <b>정점이 언제쯤인지</b>를 매주 검토하도록 돕습니다.</p>
    <div class="cta"><a class="btn" href="#dashboard">부산 실제자료 대시보드</a><a class="btn ghost" href="#research">실제자료 검증</a><a class="btn ghost" href="#method">수리모형</a></div>
  </section>

  <div class="grid g4 mt">
    <div class="kpi accent"><div class="label">부산 실제 6개 절기 후향 재현</div><div class="value">${sm.earlier_count}/${sm.n} 절기 선행</div><div class="note">내부 검토 신호가 전국 유행주의보보다 중앙값 ${nf(sm.median_lead_vs_advisory)}일 앞섬 (2016–2024)</div></div>
    <div class="kpi accent"><div class="label">단순 기준선 규칙 대비</div><div class="value">오작동일 ${nf((1 - mf / sf) * 100)}%↓</div><div class="note">사후 확정 R<sub>t</sub>&lt;1인데 켜진 날 ${sf}일 → ${mf}일 (6개 절기 합)</div></div>
    <div class="kpi accent"><div class="label">선행연구 결과 독립 재현</div><div class="value">ξ 평균 1.3135</div><div class="note">원고 Table 2의 1.3139(부산, θ=0.5)를 공개 원자료로 재계산</div></div>
    <div class="kpi accent"><div class="label">시차 이동성의 추가 설명력</div><div class="value">p = ${r.gls_validation.bootstrap_p}</div><div class="note">5개 도시 동적 GLS 우도비 ${r.gls_validation.LRT} (조건부 적합도, 선행연구)</div></div>
  </div>

  <div class="section-title mt2"><h2>왜 필요한가</h2><p>유행은 해마다 다르게 오지만, 부산의 확산 속도와 원인을 알려주는 지표는 아직 없습니다</p></div>
  <div class="grid g3">
    <div class="problem"><div class="num">문제 1 · 예측하기 어려워진 유행</div><h4>2024–25 감시체계 구축 이후 최고, 2026–27 더 이른 주의보</h4><p>2025년 1주 의사환자 분율 99.8명(2016년 감시체계 구축 이후 최고). 유행주의보는 2025–26절기 10.17., 2026–27절기 9.11.로 전 절기보다 한 달 이상 앞당겨졌습니다. 2026년 38주 부산 분율은 48.0명(같은 주 전국 32.3명)이었습니다.</p><p class="small muted">질병관리청 연례보고서(2026.4.17.)·보도자료(2026.9.11.), 경남권질병대응센터 소식지(2026.10.22., 지역 간 비교 목적 아님)</p></div>
    <div class="problem"><div class="num">문제 2 · 제도의 공백</div><h4>발생 수준은 보이지만 확산 속도·원인은 보이지 않음</h4><p>국가 표본감시 구조상 인플루엔자는 2025년까지 지역별로 산출되지 않았고(부산시 소식지 2025-47주), 2026년부터 시·도 주간 분율이 나오기 시작했습니다. 부산시는 이런 여건에서도 접종 독려와 표본감시 강화로 선제 대응해 왔습니다. 이 서비스는 그 판단을 데이터로 뒷받침합니다.</p><p class="small muted">부산시 감염병관리지원단(2025.11.25.), 부산시 감염병관리과 보도자료(2026.9.17.)</p></div>
    <div class="problem"><div class="num">문제 3 · 이동 데이터의 딜레마</div><h4>통신 이동자료는 민감, 도시철도 집계는 공개</h4><p>코로나19 때 이동량은 핵심 방역 지표였지만 기지국·위치정보 활용은 인권위 우려와 헌법소원을 불렀습니다. 부산 도시철도는 하루 87만 명(2025)이 타고, 승하차 자료는 매월 공개됩니다.</p><p class="small muted">뉴시스(2021.9.8.), 경향신문(2020.3.9.), 부산교통공사 결산(2025), 공공데이터포털</p></div>
  </div>
  <div class="card mt">
    <h3>현장의 목소리 <span class="pill">언론 보도 요약</span></h3>
    <div class="grid g3 small">
      <div><b>보건 행정</b><br>조규율 부산시 시민건강국장은 유행이 예년보다 일찍 시작된 만큼 예방접종 참여를 당부하고, 유관기관과 협력해 지역사회 유행 상황을 면밀히 살피겠다고 밝혔습니다. <span class="muted">(부산시 보도자료·복지TV부울경, 2026.9.17.)</span><br>전국 시·도 역학조사관 87명 중 의사는 1명입니다. <span class="muted">(의협신문, 2026.10.7.)</span></div>
      <div><b>의료 현장</b><br>동아대병원 한성호 교수는 유행이 꺾여도 평년의 몇 배라며 장기화를 경고했고<span class="muted">(부산일보 2025.2.5.)</span>, 부산시약사회는 타미플루 재고 소진을 알렸습니다<span class="muted">(KNN 2025.1.5.)</span>. 2026년 10월 부산 소아청소년과 전문의는 제약사·도매상에 전화해도 백신 물량이 없다고 했습니다. <span class="muted">(KNN 2026.10.16.)</span></div>
      <div><b>시민·보호자</b><br>영도의 한 아동병원을 찾은 30대 보호자는 오전 9시 전에 왔는데도 진료까지 2시간이 걸렸다고 했고, 이 병원에는 김해 등지에서도 환자가 찾아옵니다<span class="muted">(부산일보 2023.10.24.)</span>. 부산의 30대 직장인은 출퇴근 대중교통이 몸을 움직이기 어려울 만큼 붐빈다고 했습니다. <span class="muted">(부산일보 2026.4.18.)</span></div>
    </div>
  </div>

  <div class="section-title mt2"><h2>어떻게 작동하나</h2><p>공개 데이터 → 수리모형 → 확률 추론 → 내부 검토</p></div>
  <div class="flow">
    <div class="step"><span class="k">STEP 1</span><b>도시철도 승차량 X(t)</b><span>부산교통공사 일별 승차(게이트 입장) 집계</span></div>
    <div class="step"><span class="k">STEP 2</span><b>이동성 계수 ξ(t)</b><span>인구 보정 · 후행 7일 평균 · 구조적 이동수준 (L/L<sub>ref</sub>)<sup>θ</sup></span></div>
    <div class="step"><span class="k">STEP 3</span><b>Mobility-SIR + 음이항 관측</b><span>ξ(t)가 감염 항 ξβSI/N 을 보정, 의료이용의 과분산 반영(일·주 단위 관측)</span></div>
    <div class="step"><span class="k">STEP 4</span><b>입자필터 · 입자평활</b><span>실시간 R<sub>t</sub>(필터)와 확정 R<sub>t</sub>(평활, 14일 뒤), β(t), P(R<sub>t</sub>&gt;1)</span></div>
    <div class="step"><span class="k">STEP 5</span><b>내부 검토 신호 · 브리핑</b><span>신호 4단계, 요인 분해, 사후 시나리오, 주간 브리핑·시민 안내 초안</span></div>
  </div>

  <div class="grid g2 mt2">
    <div class="card">
      <h3>기존 방식과의 차이</h3>
      <div class="table-wrap"><table class="tbl compare">
        <tr><th>구분</th><th>주간 표본감시 통계</th><th>OD 기반 공간모형</th><th>Mobility-SIR 부산</th></tr>
        <tr><td>입력</td><td>의사환자 분율</td><td>지역 간 이동행렬, 통신 이동자료</td><td>공개 승차량 + 의료이용 + 인구</td></tr>
        <tr><td>공간·시간</td><td>전국→시·도, 주 단위</td><td>세밀하나 자료 확보가 관건</td><td>부산·일 단위 계산(구·군 확장 설계)</td></tr>
        <tr><td>산출</td><td>유행 수준</td><td>확산 경로 시뮬레이션</td><td>R<sub>t</sub>, β(t), P(R<sub>t</sub>&gt;1), 요인 분해</td></tr>
        <tr><td>개인정보</td><td>집계</td><td>민감 자료 필요</td><td>개인 식별 정보 없음</td></tr>
        <tr><td>불확실성</td><td>–</td><td>모형별 상이</td><td>90% 구간·확률로 제시</td></tr>
      </table></div>
    </div>
    <div class="card">
      <h3>누가, 어떻게 쓰나</h3>
      <div class="table-wrap"><table class="tbl">
        <tr><th>사용자</th><th>활용</th></tr>
        <tr><td>부산시 감염병 담당 부서</td><td>주간 브리핑으로 확산 속도·요인 검토, 시민 안내 시점 판단 근거</td></tr>
        <tr><td>부산시 감염병관리지원단</td><td>신호의 전문 검토·확인(사람이 최종 판단), 시민 안내문 발행 여부 결정</td></tr>
        <tr><td>16개 구·군 보건소</td><td>접종 홍보·소아 진료 안내 등 자원 운영 검토</td></tr>
        <tr><td>부산교통공사</td><td>혼잡 시간대 환기·마스크 안내 협조(이동 억제 아님)</td></tr>
        <tr><td>시민</td><td>지원단 검토 후 발행하는 ‘부산 독감 주간 안내’</td></tr>
      </table></div>
    </div>
  </div>`;
}

// ---------- 화면: 대시보드 ----------
function asOfToolbar(withTruth = true) {
  const ds = state.ds;
  return `
  <div class="toolbar no-print">
    <div class="asof">
      <label for="asof">기준일</label>
      <input type="range" id="asof" min="20" max="${ds.dates.length - 1}" value="${state.asOf}">
      <span class="date" id="asof-date">${dlabel(ds.dates[state.asOf])}</span>
    </div>
    ${withTruth && ds.truth ? `<label class="chk"><input type="checkbox" id="truth" ${state.showTruth ? "checked" : ""}> 합성 정답 R<sub>t</sub> 표시</label>` : ""}
    <span class="pill">실시간 = 입자필터(기준일까지 자료)</span>
    <span class="pill ok">확정 = 입자평활(14일 지연)</span>
  </div>`;
}

function bindAsOf(rerender) {
  const s = $("#asof");
  if (!s) return;
  let timer = null;
  s.addEventListener("input", () => {
    state.asOf = +s.value;
    $("#asof-date").textContent = dlabel(state.ds.dates[state.asOf]);
    clearTimeout(timer);
    timer = setTimeout(() => { destroyCharts(); rerender(); const n = $("#asof"); if (n) n.focus(); }, 80);
  });
  const tr = $("#truth");
  if (tr) tr.addEventListener("change", () => { state.showTruth = tr.checked; destroyCharts(); rerender(); });
}

function eventLines(t, facts) {
  const ds = state.ds, lines = [{ index: t, label: "기준일", color: "#0b2545" }];
  if (facts.adv >= 0 && facts.adv <= t) lines.push({ index: facts.adv, label: "전국 유행주의보", color: "#7a1f1f", dash: [2, 3] });
  if (facts.rise >= 0 && facts.rise <= t) lines.push({ index: facts.rise, label: "부산 첫 ‘상승’", color: "#e07b24", dash: [2, 3] });
  return ds ? lines : [];
}

function renderDashboard() {
  const ds = state.ds, t = state.asOf, pf = state.pf, f = pf.filter, sm = pf.smooth, L = pf.settings.lag;
  const s = nowStats(t), lv = signalOf(s.level), facts = seasonFacts(t);
  const conf = t >= L ? t - L : -1;
  const lines = eventLines(t, facts);
  app().innerHTML = `
  <div class="section-title"><h2>부산 대시보드</h2><p>${esc(ds.name)} · ${dlabel(ds.dates[0])} ~ ${dlabel(ds.dates[ds.dates.length - 1])}</p></div>
  ${asOfToolbar()}
  <div class="grid g6 mt">
    <div class="signal-card" style="background:${lv.color}"><div class="label">내부 검토 신호</div><div class="value">${lv.name}</div><div class="note">${lv.desc}</div></div>
    <div class="kpi"><div class="label">실시간 R<sub>t</sub> (90% 구간)</div><div class="value">${nf(s.rt, 2)}</div><div class="note">${nf(s.lo, 2)} – ${nf(s.hi, 2)}</div></div>
    <div class="kpi"><div class="label">P(R<sub>t</sub> &gt; 1)</div><div class="value">${prob(s.p)}</div><div class="note">모형 조건부 확산 확률</div></div>
    <div class="kpi"><div class="label">${s.doubling ? "환자 배가시간" : s.halving ? "환자 반감기" : "증감 속도"}</div><div class="value">${s.doubling ? nf(s.doubling, 1) + "<small>일</small>" : s.halving ? nf(s.halving, 1) + "<small>일</small>" : "정체"}</div><div class="note">r = ln(1+γ(R<sub>t</sub>−1)) = ${nf(s.growth, 3)}/일</div></div>
    <div class="kpi"><div class="label">이동성 계수 ξ(t)</div><div class="value">${nf(s.xi, 2)}</div><div class="note">기준일까지 평균 대비 ${pct(s.xiDev, 1)}</div></div>
    <div class="kpi"><div class="label">의료이용 7일 평균</div><div class="value">${nf(s.ma7, 0)}<small>건/일</small></div><div class="note">전주 대비 ${pct(s.maChange, 0)} · 기준선 ${nf(s.thr, 0)}</div></div>
  </div>
  <p class="small muted" style="margin:8px 2px 0">${OFFICIAL}</p>

  <div class="card mt">
    <h3>감염재생산지수 R<sub>t</sub></h3>
    <p class="sub">주황 점선 = 실시간(입자필터, 기준일까지의 자료만 사용) · 파랑 = 확정(고정지연 입자평활, 기준일 ${L}일 전까지)${ds.truth && state.showTruth ? " · 검정 = 합성 정답" : ""}${ds.advisory ? " · 붉은 점선 = 질병관리청 전국 유행주의보" : ""}</p>
    <div class="chart-box tall"><canvas id="c-rt"></canvas></div>
  </div>
  <div class="grid g2 mt">
    <div class="card"><h3>인플루엔자 의료이용</h3><p class="sub">막대 = 관측(일별 진료에피소드), 선 = 모형 기대값(확정), 점선 = 유행 기준선 τ</p><div class="chart-box"><canvas id="c-cases"></canvas></div></div>
    <div class="card"><h3>이동성 계수 ξ(t)와 이동성 보정 전파율 β(t)</h3><p class="sub">ξ(t)는 도시철도 승차량에서 계산(왼쪽 축), β(t)는 추정값(오른쪽 축)</p><div class="chart-box"><canvas id="c-xb"></canvas></div></div>
  </div>
  <div class="card mt">
    <h3>내부 검토 신호 타임라인</h3>
    <div class="strip">${state.signals.map((v, i) => `<span title="${ds.dates[i]} ${signalOf(v).name}" style="background:${i <= t ? signalOf(v).color : "#e9edf3"}"></span>`).join("")}</div>
    <div class="strip-labels">${ds.dates.map((d, i) => (d.endsWith("-01") ? `<span style="left:${(i / ds.dates.length) * 100}%">${+d.slice(5, 7)}월</span>` : "")).join("")}</div>
    <div class="legend-row">${E.LEVELS.map(l => `<span><i style="background:${l.color}"></i>${l.name}: ${l.desc}</span>`).join("")}</div>
    <div class="callout mt" id="interp"></div>
  </div>`;

  const labels = ds.dates;
  const ds1 = [
    { label: "_hiS", data: between(sm.Rt.hi, 0, conf), borderWidth: 0, fill: false },
    { label: "확정 90% 구간", data: between(sm.Rt.lo, 0, conf), borderWidth: 0, backgroundColor: "rgba(31,95,191,.16)", fill: "-1" },
    { label: "확정 R_t (평활)", data: between(sm.Rt.med, 0, conf), borderColor: "#1f5fbf" },
    { label: "_hiF", data: upto(f.Rt.hi, t), borderWidth: 0, fill: false },
    { label: "실시간 90% 구간", data: upto(f.Rt.lo, t), borderWidth: 0, backgroundColor: "rgba(224,123,36,.13)", fill: "-1" },
    { label: "실시간 R_t (필터)", data: upto(f.Rt.med, t), borderColor: "#e07b24", borderDash: [5, 3] },
    { label: "_one", data: labels.map(() => 1), borderColor: "#c62f2f", borderWidth: 1, borderDash: [2, 3] },
  ];
  if (ds.truth && state.showTruth) ds1.push({ label: "합성 정답 R_t", data: upto(ds.truth.Rt, t), borderColor: "#111", borderWidth: 1.2 });
  makeChart($("#c-rt"), { labels, datasets: ds1, y: { suggestedMin: 0.4, suggestedMax: 2.0, title: { display: true, text: "R_t" } }, lines });

  makeChart($("#c-cases"), {
    labels, type: "bar",
    datasets: [
      { type: "bar", label: "관측 의료이용", data: upto(ds.cases, t), backgroundColor: "rgba(91,100,116,.45)", barPercentage: 1, categoryPercentage: 1 },
      { type: "line", label: "모형 기대값(확정)", data: between(sm.C, 0, conf), borderColor: "#1f5fbf" },
      { type: "line", label: "유행 기준선 τ", data: labels.map(() => state.base.threshold), borderColor: "#c62f2f", borderDash: [4, 4], borderWidth: 1.2 },
    ],
    y: { beginAtZero: true, title: { display: true, text: "건/일" } }, lines: lines.slice(0, 1),
  });

  makeChart($("#c-xb"), {
    labels,
    datasets: [
      { label: "ξ(t) 이동성 계수", data: upto(ds.xi, t), borderColor: "#17807e", yAxisID: "y" },
      { label: "β(t) 확정", data: between(sm.beta.med, 0, conf), borderColor: "#6a4fb3", yAxisID: "y2" },
      { label: "β(t) 실시간", data: upto(f.beta.med, t), borderColor: "rgba(106,79,179,.5)", borderDash: [4, 3], yAxisID: "y2" },
    ],
    y: { title: { display: true, text: "ξ(t)" } }, y2: { title: { display: true, text: "β(t)" } }, lines: lines.slice(0, 1),
  });

  const msgs = [];
  msgs.push(`<b>${dlabel(ds.dates[t])} 기준</b> 부산의 실시간 R<sub>t</sub>는 ${nf(s.rt, 2)}(90% 구간 ${nf(s.lo, 2)}–${nf(s.hi, 2)}), 모형이 계산한 확산 확률은 ${prob(s.p)}입니다.`);
  if (s.doubling) msgs.push(`현재 속도가 유지되면 의료이용은 약 ${nf(s.doubling, 1)}일마다 두 배가 됩니다.`);
  if (s.halving) msgs.push(`의료이용은 약 ${nf(s.halving, 1)}일마다 절반으로 줄어드는 추세입니다.`);
  if (facts.rise >= 0 && facts.rise <= t) msgs.push(`이번 시즌 첫 ‘상승’ 신호는 ${dlabel(ds.dates[facts.rise])}입니다.`);
  if (ds.advisory) {
    const a = ds.advisory.date;
    if (facts.adv >= 0 && facts.adv <= t) {
      const lead = facts.rise >= 0 ? dayDiff(a, ds.dates[facts.rise]) : null;
      msgs.push(`질병관리청 전국 유행주의보는 ${dlabel(a)} 발령되었습니다${lead != null ? `(부산 첫 ‘상승’ 신호 대비 ${lead >= 0 ? lead + "일 뒤" : -lead + "일 앞"})` : ""}.`);
    } else msgs.push(`기준일 현재 이번 절기 전국 유행주의보는 아직 발령 전입니다(실제 발령 ${dlabel(a)}).`);
  }
  if (facts.passed >= 0) msgs.push(`R<sub>t</sub>가 1 아래로 내려간 ${dlabel(ds.dates[facts.passed])}에 유병 정점을 지난 것으로 볼 수 있습니다(의료이용 정점은 그보다 며칠 앞설 수 있음).`);
  msgs.push(`<span class="small muted">${ds.synthetic ? "합성 검증 시즌입니다. " : "공개 원본(연 1회 갱신)으로 지난 절기를 하루씩 따라가며 재현한 후향 분석입니다. "}요인별 해석은 「요인 분해」, 사후 시나리오는 「시나리오」 탭에서 확인하세요.</span>`);
  $("#interp").innerHTML = msgs.join(" ");
  bindAsOf(renderDashboard);
}

// ---------- 화면: 요인 분해 ----------
function decompositionSeries() {
  const ds = state.ds, f = state.pf.filter;
  const xi = E.fillGaps(ds.xi);
  const out = { total: [], xi: [], beta: [], s: [] };
  for (let t = 0; t < ds.dates.length; t++) {
    if (t < 13) { out.total.push(null); out.xi.push(null); out.beta.push(null); out.s.push(null); continue; }
    const d = E.decompose(xi, f.beta.med, f.sfrac, t);
    out.total.push(d.total * 100); out.xi.push(d.dXi * 100); out.beta.push(d.dBeta * 100); out.s.push(d.dS * 100);
  }
  return out;
}

function barRow(name, v, scale, color) {
  const w = Math.min(50, Math.abs(v) / scale * 50);
  const left = v >= 0 ? 50 : 50 - w;
  return `<div class="bar-row"><span>${name}</span><div class="bar-track"><div class="zero"></div><div class="bar-fill" style="left:${left}%;width:${w}%;background:${color}"></div></div><span class="v">${(v > 0 ? "+" : "") + nf(v, 1)}</span></div>`;
}

function adviceFor(d) {
  const dom = dominant(d);
  if (Math.abs(d.total) < 0.02) return { dom, rising: false, text: "R<sub>t</sub> 변화가 작습니다. 정기 모니터링을 유지합니다." };
  if (d.total < 0) return { dom, rising: false, text: `R<sub>t</sub>가 낮아지는 중이며 하락 요인은 주로 <b>${dom}</b>입니다. 연휴처럼 이동이 일시적으로 줄어든 경우라면 연휴 뒤 재상승 가능성을 함께 점검합니다.` };
  if (dom === "이동성") return { dom, rising: true, text: "상승이 주로 <b>이동성 계수</b>와 함께 나타났습니다(가정 기반 회계 분해의 검토 후보). 연휴·행사·개학 등 이동 요인을 확인하고, 필요하면 부산교통공사와 혼잡 시간대 환기·마스크 안내를 검토합니다(이동 억제 아님)." };
  if (dom === "고유 전파력") return { dom, rising: true, text: "이동성 보정 후에도 <b>전파율 β(t)</b>가 올랐습니다(가정 기반 회계 분해의 검토 후보). 학교·보육시설 유증상자 관리, 고위험군 예방접종 독려, 소아청소년과·응급실 진료 수요 대비를 검토합니다." };
  return { dom, rising: true, text: "여러 요인이 섞여 있습니다. 의료이용 추이와 현장 정보를 함께 검토합니다." };
}

function renderDecompose() {
  const ds = state.ds, t = Math.max(state.asOf, 13), f = state.pf.filter;
  const d = E.decompose(E.fillGaps(ds.xi), f.beta.med, f.sfrac, t);
  const parts = [["이동성 ξ(t)", d.dXi * 100, "#17807e"], ["전파율 β(t)", d.dBeta * 100, "#6a4fb3"], ["감수성 S/N", d.dS * 100, "#8a94a6"]];
  const scale = Math.max(5, ...parts.map(p => Math.abs(p[1])), Math.abs(d.total * 100));
  const adv = adviceFor(d);
  const series = decompositionSeries();
  app().innerHTML = `
  <div class="section-title"><h2>요인 분해</h2><p>Δlog R<sub>t</sub> = Δlog ξ + Δlog β + Δlog(S/N) — 모형 가정(θ, ρ, γ) 아래의 회계적 분해</p></div>
  ${asOfToolbar(false)}
  <div class="grid g2 mt">
    <div class="card">
      <h3>최근 1주 R<sub>t</sub> 변화의 구성 <span class="pill">${dlabel(ds.dates[t - 6])} ~ ${dlabel(ds.dates[t])} vs 직전 주</span></h3>
      <p class="sub">단위: 로그 %p(=100×Δlog). 합계 ${(d.total > 0 ? "+" : "") + nf(d.total * 100, 1)} 로그 %p는 실제 변화율 ${pct(d.pct, 1)}에 해당</p>
      <div class="bars mt">${parts.map(p => barRow(p[0], p[1], scale, p[2])).join("")}
      ${barRow("합계 (R_t 변화)", d.total * 100, scale, d.total > 0 ? "#e4572e" : "#2e7d5b")}</div>
      <p class="small muted mt">β(t)에는 기온·접종·학사일정 등 모형 밖 요인이 섞일 수 있고, 이동성 몫은 θ(구조적 이동수준 탄력성) 가정에 따라 달라집니다. 인과효과의 크기가 아닙니다.</p>
    </div>
    <div class="card">
      <h3>검토 후보 (자동 결정 아님)</h3>
      <div class="callout ${adv.rising ? "warn" : "ok"}">${adv.text}</div>
      <h4 class="mt">해석 원칙</h4>
      <ul class="small">
        <li>R<sub>t</sub>는 이동과 전파율을 모두 반영하고, β(t)는 이동성 계수를 보정한 뒤 남는 전파율입니다(선행연구 p.15).</li>
        <li>선행연구의 동적 GLS에서 1·2주 시차 이동성 블록이 적합도를 개선했습니다(LRT 10.22, p=0.0065). 표본 안의 조건부 검정이며 선행성이나 인과의 증명은 아닙니다.</li>
        <li>${OFFICIAL}</li>
      </ul>
    </div>
  </div>
  <div class="card mt">
    <h3>시즌 전체의 주간 기여 추이</h3>
    <p class="sub">각 날짜의 직전 7일 vs 그 전 7일 비교(로그 %p). 실시간(입자필터) 추정 기반</p>
    <div class="chart-box tall"><canvas id="c-dec"></canvas></div>
  </div>`;
  makeChart($("#c-dec"), {
    labels: ds.dates, type: "bar", stacked: true,
    datasets: [
      { type: "bar", label: "이동성 ξ", data: upto(series.xi, state.asOf), backgroundColor: "rgba(23,128,126,.75)", barPercentage: 1, categoryPercentage: 1, stack: "s" },
      { type: "bar", label: "전파율 β", data: upto(series.beta, state.asOf), backgroundColor: "rgba(106,79,179,.7)", barPercentage: 1, categoryPercentage: 1, stack: "s" },
      { type: "bar", label: "감수성 S/N", data: upto(series.s, state.asOf), backgroundColor: "rgba(138,148,166,.8)", barPercentage: 1, categoryPercentage: 1, stack: "s" },
      { type: "line", label: "합계", data: upto(series.total, state.asOf), borderColor: "#e4572e", borderWidth: 1.6, stack: "line" },
    ],
    y: { title: { display: true, text: "주간 변화 (로그 %p)" } }, lines: [{ index: state.asOf, label: "기준일" }],
  });
  bindAsOf(renderDecompose);
}

// ---------- 화면: 시나리오(내부 분석) ----------
function renderScenario() {
  const ds = state.ds, sm = state.pf.smooth, sc = state.scen, ref = state.ref;
  const T = ds.dates.length;
  sc.start = Math.min(Math.max(sc.start, 0), T - 30);
  const xi = E.fillGaps(ds.xi);
  const run = eta => E.mobilityScenario({ xi, beta: sm.beta.med, sfrac: sm.sfrac, I: sm.I, N: ds.N, t0: sc.start, dur: sc.dur, reduction: sc.red, elasticity: eta });
  const res = run(sc.eta), res1 = run(1);
  const mb = res.mBase, ms = res.mScen;
  const rel = (a, b) => (b > 0 ? (a / b - 1) * 100 : 0);
  const busan = ref.scenarios.rows.filter(r => r.city === "Busan");
  const cities = ["Seoul", "Busan", "Daegu", "Daejeon", "Gwangju"];
  app().innerHTML = `
  <div class="section-title"><h2>시나리오 (내부 분석용)</h2><p>지난 시즌을 대상으로 “혼잡 시간대 이동이 r% 적었다면?”을 다시 계산하는 사후 분석입니다</p></div>
  <div class="callout warn">모형 가정(같은 β(t) 경로 유지, ρ=1, 초기 면역 0) 아래의 반사실 계산이며 정책 효과를 보장하지 않습니다. 대중교통 이용을 줄이자는 뜻이 아니라, 혼잡 분산·시차출퇴근 같은 조치를 검토할 때 크기를 가늠하는 내부 참고자료입니다.</div>
  <div class="card no-print mt">
    <div class="controls">
      <div class="control"><label>시작일 <output id="o-start">${dlabel(ds.dates[sc.start])}</output></label><input type="range" id="s-start" min="0" max="${T - 30}" value="${sc.start}"></div>
      <div class="control"><label>적용 기간 <output id="o-dur">${sc.dur}일</output></label><input type="range" id="s-dur" min="7" max="90" value="${sc.dur}"></div>
      <div class="control"><label>이동량 감소율 r <output id="o-red">${Math.round(sc.red * 100)}%</output></label><input type="range" id="s-red" min="0" max="50" step="5" value="${Math.round(sc.red * 100)}"></div>
      <div class="control"><label>이동→접촉 탄력성 η <output id="o-eta">${sc.eta.toFixed(2)}</output></label><input type="range" id="s-eta" min="0.25" max="1" step="0.25" value="${sc.eta}"></div>
    </div>
    <p class="small muted" style="margin:10px 0 0">ξ(t) → (1−r)<sup>η</sup>ξ(t)로 바꿔 같은 β(t)에서 SIR을 다시 계산합니다. η=1은 선행연구 모형의 비례 가정, η&lt;1은 이동이 줄어도 접촉은 덜 줄어드는 보수적 가정입니다.</p>
  </div>
  <div class="metric-grid mt">
    <div class="metric"><div class="label">정점 일 신규 감염 (η=${sc.eta})</div><div class="value">${nf(ms.peak)}</div><div class="delta ${ms.peak <= mb.peak ? "good" : "bad"}">기준 ${nf(mb.peak)} 대비 ${pct(rel(ms.peak, mb.peak), 1)}</div></div>
    <div class="metric"><div class="label">정점 시점</div><div class="value">${shortDate(ds.dates[ms.peakDay])}</div><div class="delta good">기준 ${shortDate(ds.dates[mb.peakDay])} · ${ms.peakDay - mb.peakDay >= 0 ? "+" : MINUS}${Math.abs(ms.peakDay - mb.peakDay)}일</div></div>
    <div class="metric"><div class="label">시작일 이후 누적 감염</div><div class="value">${nf(ms.cumulative)}</div><div class="delta ${ms.cumulative <= mb.cumulative ? "good" : "bad"}">${pct(rel(ms.cumulative, mb.cumulative), 1)}</div></div>
    <div class="metric"><div class="label">민감도: η=1(비례 가정)일 때</div><div class="value">${pct(rel(res1.mScen.peak, mb.peak), 1)}</div><div class="delta muted">정점 변화 · 누적 ${pct(rel(res1.mScen.cumulative, mb.cumulative), 1)}</div></div>
  </div>
  <div class="grid g2 mt">
    <div class="card"><h3>일별 신규 감염 (모형)</h3><p class="sub">회색 = 기준(관측 이동량), 초록 = 시나리오</p><div class="chart-box"><canvas id="c-sc1"></canvas></div></div>
    <div class="card"><h3>R<sub>t</sub> (모형)</h3><p class="sub">적용 기간에 R<sub>t</sub>가 낮아지고, 기간이 끝나면 원래 경로로 돌아갑니다</p><div class="chart-box"><canvas id="c-sc2"></canvas></div></div>
  </div>

  <div class="section-title mt2"><h2>참고: 연구 저장소의 정적 계산</h2><p>4개 절기 일별 R<sub>t</sub>에 (1−r)을 곱한 산술 · β·S 고정</p></div>
  <div class="grid g2">
    <div class="card">
      <h3>부산</h3>
      <div class="table-wrap"><table class="tbl">
        <tr><th>시나리오</th><th class="num">평균 R<sub>t</sub></th><th class="num">R<sub>t</sub>&gt;1 일수</th><th class="num">일수 변화</th><th class="num">초과 면적</th></tr>
        ${busan.map(r => `<tr><td>${r.scenario === "Observed" ? "관측 이동량" : r.scenario.replace(" reduction", " 감소")}</td><td class="num">${r.mean_Rt.toFixed(3)}</td><td class="num">${nf(r.days_Rt_gt_1)}</td><td class="num">${r.days_reduction_percent ? MINUS + nf(r.days_reduction_percent, 1) + "%" : "–"}</td><td class="num">${r.excess_area.toFixed(2)}</td></tr>`).join("")}
      </table></div>
      <p class="small muted mt">출처: ${ref.scenarios.source}. R<sub>t</sub>가 1 근처를 오가는 비유행기 날이 많아 일수 변화가 크게 나오는 산술 결과이며, 동역학·감수성 되먹임이 없어 정책 효과의 크기가 아닙니다.</p>
    </div>
    <div class="card"><h3>5개 도시: R<sub>t</sub>&gt;1 일수 변화율(정적 계산)</h3><p class="sub">이동량 감소율별(%)</p><div class="chart-box"><canvas id="c-ref"></canvas></div></div>
  </div>`;

  const labels = ds.dates;
  const pad = arr => labels.map((_, i) => (i < sc.start ? null : arr[i - sc.start]));
  const winEnd = Math.min(T - 1, sc.start + sc.dur - 1);
  makeChart($("#c-sc1"), {
    labels,
    datasets: [
      { label: "기준", data: pad(res.base.C), borderColor: "#8a94a6" },
      { label: "시나리오", data: pad(res.scen.C), borderColor: "#2e7d5b", backgroundColor: "rgba(46,125,91,.1)", fill: "-1" },
      { label: "_obs", data: ds.cases, borderColor: "rgba(0,0,0,.15)", borderWidth: 1 },
    ],
    y: { beginAtZero: true, title: { display: true, text: "명/일" } }, lines: [{ index: sc.start, label: `r=${Math.round(sc.red * 100)}% · ${sc.dur}일` }],
  });
  makeChart($("#c-sc2"), {
    labels,
    datasets: [
      { label: "기준 R_t", data: pad(res.base.Rt), borderColor: "#8a94a6" },
      { label: "시나리오 R_t", data: pad(res.scen.Rt), borderColor: "#2e7d5b" },
      { label: "_one", data: labels.map(() => 1), borderColor: "#c62f2f", borderWidth: 1, borderDash: [2, 3] },
    ],
    y: { suggestedMin: 0.4, suggestedMax: 2, title: { display: true, text: "R_t" } }, lines: [{ index: winEnd, label: "적용 종료" }],
  });
  const reds = ["10% reduction", "20% reduction", "30% reduction", "40% reduction", "50% reduction"];
  const palette = ["#9cc4ff", "#5f9bea", "#1f5fbf", "#163f80", "#0b2545"];
  state.charts.push(new Chart($("#c-ref"), {
    type: "bar",
    data: {
      labels: cities.map(c => ref.scenarios.rows.find(r => r.city === c).city_ko),
      datasets: reds.map((s, k) => ({ label: s.replace(" reduction", ""), data: cities.map(c => -ref.scenarios.rows.find(r => r.city === c && r.scenario === s).days_reduction_percent), backgroundColor: palette[k] })),
    },
    options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { labels: { boxWidth: 12 } } }, scales: { y: { min: -100, max: 0, title: { display: true, text: "R_t>1 일수 변화 (%)" } } } },
  }));

  const bind = (id, key, fmt, conv) => {
    $(id).addEventListener("change", e => { sc[key] = conv(+e.target.value); destroyCharts(); renderScenario(); });
    $(id).addEventListener("input", e => { $(fmt[0]).textContent = fmt[1](+e.target.value); });
  };
  bind("#s-start", "start", ["#o-start", v => dlabel(ds.dates[v])], v => v);
  bind("#s-dur", "dur", ["#o-dur", v => `${v}일`], v => v);
  bind("#s-red", "red", ["#o-red", v => `${v}%`], v => v / 100);
  bind("#s-eta", "eta", ["#o-eta", v => v.toFixed(2)], v => v);
}

// ---------- 화면: 연구 근거(실제자료 검증) ----------
function table2Repro() {
  const s = state.real.seasons[0];
  const b = s.xi.map(v => v / Math.pow(s.L_ratio, 0.5));
  return [0.01, 0.5, 1].map(th => {
    const x = b.map(v => Math.pow(s.L_ratio, th) * v);
    const m = x.reduce((a, c) => a + c, 0) / x.length;
    const sd = Math.sqrt(x.reduce((a, c) => a + (c - m) ** 2, 0) / x.length);
    return { th, mean: m, sd, min: Math.min(...x), max: Math.max(...x) };
  });
}

function renderResearch() {
  const r = state.ref, sm = state.summary, rows = sm.real.seasons, rep = table2Repro();
  const mf = rows.reduce((a, s) => a + s.model_false, 0), sf = rows.reduce((a, s) => a + s.simple_false, 0);
  const mo = rows.reduce((a, s) => a + s.model_on, 0), so = rows.reduce((a, s) => a + s.simple_on, 0);
  const op = sm.synthetic.operational_trailing;
  app().innerHTML = `
  <div class="section-title"><h2>실제자료 검증과 연구 근거</h2><p>부산 공개 원자료로 6개 절기를 하루씩 다시 따라가며(후향 재현) 계산</p></div>
  <div class="card">
    <h3>부산 실제자료 후향 재현: 내부 검토 신호 vs 질병관리청 전국 유행주의보</h3>
    <p class="sub">신호 = 입자필터(기준일까지 자료) + 후행 7일 ξ + 유행 기준선 τ(직전 3개 절기 비유행기 평균+2SD). 단순 규칙 = 7일 평균 ≥ τ 이고 1주 전보다 증가한 날이 3일 연속</p>
    <div class="table-wrap"><table class="tbl">
      <tr><th>절기</th><th>첫 ‘상승’ 신호</th><th>단순 규칙</th><th>전국 유행주의보</th><th class="num">신호 선행(일)</th><th>부산 의료이용 정점</th><th class="num">정점 R<sub>t</sub>(확정)</th><th class="num">오작동일 모형/단순</th><th class="num">적합 MAE(7일)</th></tr>
      ${rows.map(s => `<tr><td>${s.season.replace("-", "–")}${s.partial ? "*" : ""}</td><td>${dlabel(s.first_signal)}</td><td>${dlabel(s.simple_rule)}</td><td><a href="${s.advisory_source}" target="_blank" rel="noopener">${dlabel(s.advisory)}</a></td><td class="num">${s.lead_vs_advisory > 0 ? "+" : ""}${nf(s.lead_vs_advisory)}</td><td>${dlabel(s.peak_date)} (${nf(s.peak)}건)</td><td class="num">${s.rt_peak_smooth.toFixed(2)}</td><td class="num">${s.model_false}/${s.simple_false}</td><td class="num">${nf(s.mae7, 1)}</td></tr>`).join("")}
    </table></div>
    <div class="callout ok mt">6개 절기 중 ${sm.real.earlier_count}개 절기에서 부산 내부 신호가 전국 유행주의보보다 먼저 켜졌습니다(중앙값 ${nf(sm.real.median_lead_vs_advisory)}일). 2022–23·2023–24는 비유행기 없이 유행이 이어져 전국 주의보가 절기 초에 나온 경우입니다. 신호 시점은 단순 기준선 규칙과 비슷하지만(2–5일 늦음), 사후 확정 R<sub>t</sub>&lt;1인데 켜진 날이 ${sf}일(켜진 ${so}일 중) → ${mf}일(켜진 ${mo}일 중)로 줄었습니다.</div>
    <p class="small muted mt">* 2024–25는 공개 원본이 2024.12.31.까지라 절기 초반만 포함. 공개 청구자료는 연 1회 갱신되므로 이 결과는 후향 재현이며, 실시간 운영에는 기관 간 자료연계(또는 질병청 부산 주간 분율 연계)가 필요합니다. 전국 주의보는 전국 표본감시 기준이라 부산 청구자료 신호와 자료원이 다릅니다. 발령일은 질병관리청 보도자료 원문(링크) 기준.</p>
  </div>
  <div class="grid g2 mt">
    <div class="card">
      <h3>선행연구 수치의 독립 재현 (부산 2016–17)</h3>
      <div class="table-wrap"><table class="tbl"><tr><th class="num">θ</th><th class="num">평균(재현/원고)</th><th class="num">표준편차</th><th class="num">최솟값</th><th class="num">최댓값</th></tr>
      ${rep.map((x, i) => { const o = r.busan_xi_by_theta.rows[i]; return `<tr class="${x.th === 0.5 ? "hl" : ""}"><td class="num">${x.th}</td><td class="num">${x.mean.toFixed(4)} / ${o.mean}</td><td class="num">${x.sd.toFixed(4)} / ${o.sd}</td><td class="num">${x.min.toFixed(4)} / ${o.min}</td><td class="num">${x.max.toFixed(4)} / ${o.max}</td></tr>`; }).join("")}</table></div>
      <p class="small muted mt">공개 원자료(승차·인구)로 다시 계산한 부산 L/L<sub>ref</sub> = ${state.real.seasons[0].L_ratio}(원고 역산 1.7263). 이후 절기는 ${state.real.seasons.slice(1).map(s => s.L_ratio).join(", ")}.</p>
    </div>
    <div class="card">
      <h3>검증 지표 요약</h3>
      <div class="table-wrap"><table class="tbl">
        <tr><th>구분</th><th>결과</th><th>성격</th></tr>
        <tr><td>부산 6개 절기 신호 선행</td><td>${sm.real.earlier_count}/${sm.real.n} 절기, 중앙값 ${nf(sm.real.median_lead_vs_advisory)}일</td><td>실제자료·후향</td></tr>
        <tr><td>시차 이동성 동적 GLS</td><td>LRT ${r.gls_validation.LRT}, p = ${r.gls_validation.bootstrap_p}</td><td>실제자료·선행연구(조건부 적합도)</td></tr>
        <tr><td>R<sub>t</sub> 재구성 오차(선행연구)</td><td>RMSE ${r.synthetic_validation.pf_rmse} → ${r.synthetic_validation.ps_rmse} (−${r.synthetic_validation.reduction_percent}%)</td><td>합성 100일, ξ=1</td></tr>
        <tr><td>R<sub>t</sub> 재구성 오차(이 서비스)</td><td>RMSE ${op.pf_rmse.toFixed(3)} → ${op.ps_rmse.toFixed(3)} (${MINUS}${nf(op.reduction_pct, 1)}%), 포함률 ${nf(op.pf_cover90 * 100, 1)}%/${nf(op.ps_cover90 * 100, 1)}%</td><td>합성 시즌, 운영 설정(후행 ξ)</td></tr>
      </table></div>
    </div>
  </div>
  <div class="grid g2 mt">
    <figure class="card figure"><img src="assets/img/fig5_city_comparison.png" alt="2016-2017 시즌 5개 도시 관측·모형 곡선, R_t, 전파율 비교"><figcaption>그림 1. 2016–17 시즌 도시별 관측·모형 의료이용(a), R<sub>t</sub>(b), 이동성 보정 전파율 β(t)(c). 선행연구 Figure 5. θ=0.5 가정 아래 β(t)의 도시 간 변동이 R<sub>t</sub>보다 작습니다.</figcaption></figure>
    <div>
      <div class="card">
        <h3>핵심 발견(선행연구)</h3>
        <ul>${r.key_findings.map(k => `<li>${sym(k.text)} <span class="small muted">${k.source}</span></li>`).join("")}</ul>
        <p class="small muted">β(t)의 도시 간 변동 감소와 요인 분해의 이동성 몫은 θ와 단기 탄력성 1 가정의 영향을 받습니다.</p>
      </div>
      <figure class="card figure"><img src="assets/img/busan_heatmap.png" alt="부산 전파율 히트맵"><figcaption>그림 2. 부산의 시즌·월별 전파율 β(t) 히트맵(이동성 포함/제거 설정 비교). 선행연구 보충자료 Figure S6.</figcaption></figure>
    </div>
  </div>
  <div class="grid g2 mt">
    <figure class="card figure"><img src="assets/img/model_schematic.png" alt="이동성 기반 SIR 모형 구조"><figcaption>그림 3. 도시철도 이동성 계수 ξ<sub>i</sub>(t)가 감염 항을 보정하는 SIR 구조. 선행연구 Figure 1.</figcaption></figure>
    <figure class="card figure"><img src="assets/img/mobility_pipeline.png" alt="이동성 계수 구성 절차"><figcaption>그림 4. 승차량 → 1인당 이동강도 → 구조적 이동수준 → 7일 평균 → 이동성 계수. 선행연구 Figure 2.</figcaption></figure>
  </div>
  <div class="card mt">
    <h3>선행연구</h3>
    <ol class="small">
      <li>Shin J., Ahn S., Kim M. (2026). <i>A mobility-informed SIR model for regional transmission dynamics: Evidence from subway mobility data in Korea, 2016–2023.</i> 연구원고(한국해양대학교).</li>
      <li>Shin J., Jeong E., Jo S., Kim M. (2026). <i>Disentangling Mobility-Driven and Intrinsic Transmission in Regional Influenza Dynamics.</i> 한국수리생물학회 포스터 발표. 부산광역시·교육부 RISE 사업 지원(2026-RISE-02-002-001).</li>
      <li>연구 코드·재현 자료: <a href="https://github.com/jaewansh/KMOU-A-mobility-informed-SIR-model" target="_blank" rel="noopener">github.com/jaewansh/KMOU-A-mobility-informed-SIR-model</a></li>
    </ol>
  </div>`;
}

// ---------- 화면: 수리모형 ----------
const EQS = [
  ["① 이동성 계수", "선행연구 식 (5)–(10)", String.raw`m_i(t)=\frac{X_i(t)}{Pop_i},\quad L_i=\frac{1}{|T|}\sum_{t\in T} m_i(t),\quad L_{ref}=\frac{1}{|I|}\sum_{i\in I}L_i`, String.raw`c_i(t)=\frac{m_i(t)}{L_i},\quad b_i(t)=\frac{1}{|W(t)|}\sum_{\mu\in W(t)}c_i(\mu),\quad \xi_i(t)=\left(\frac{L_i}{L_{ref}}\right)^{\theta} b_i(t)`, "θ∈[0,1]: 구조적 이동수준 탄력성(0.5). 연구는 중심 7일 평균, 이 서비스의 실시간 계산은 후행 7일 평균(t−6…t). L_i는 시즌 평균(운영 시 직전 시즌 값으로 고정 예정)."],
  ["② 이동성 기반 SIR", "선행연구 식 (1)–(3)", String.raw`\frac{dS_i}{dt}=-\xi_i(t)\beta_i(t)\frac{S_iI_i}{N_i},\quad \frac{dI_i}{dt}=\xi_i(t)\beta_i(t)\frac{S_iI_i}{N_i}-\gamma I_i,\quad \frac{dR_i}{dt}=\gamma I_i`, "", "γ⁻¹ = 4.1일. ξ ≡ 1 이면 고전 SIR. S+I+R=N 보존, 비음수성."],
  ["③ 감염재생산지수", "선행연구 식 (4)", String.raw`\mathcal{R}_i(t)=\frac{\xi_i(t)\,\beta_i(t)}{\gamma}\,\frac{S_i(t)}{N_i}`, String.raw`r_t=\ln\!\big(1+\gamma(\mathcal{R}_t-1)\big)\approx\gamma(\mathcal{R}_t-1),\qquad T_d=\frac{\ln 2}{r_t}`, "일 단위 성장률 r_t와 배가시간 T_d(감소기에는 반감기)."],
  ["④ 정점 조건", "모형에서 직접 유도(상수 모수일 때)", String.raw`\frac{dI_i}{dt}=0\iff \mathcal{R}_i(t)=1,\qquad S_i^{*}=\frac{N_i}{\mathcal{R}_{0,i}},\quad \mathcal{R}_{0,i}=\frac{\xi_i\beta_i}{\gamma}`, String.raw`1-z=e^{-\mathcal{R}_0 z}\quad(\text{상수 } \mathcal{R}_0 \text{ 의 최종 발병률 } z)`, "R_t=1은 유병자(I) 정점 조건입니다. 관측되는 의료이용(발생) 정점은 R_t가 내려가는 중일 때 그보다 며칠 앞섭니다. 출생·사망이 없는 SIR에는 감염자가 남는 평형이 없습니다."],
  ["⑤ 확률 상태공간 모형", "입자필터 전이식 (일 단위 Euler)", String.raw`C_t\sim\text{Poisson}\!\Big(\xi_t\beta_t\frac{S_tI_t}{N}\Big),\quad D_t\sim\text{Binomial}\big(I_t,\,\gamma\big)`, String.raw`S_{t+1}=S_t-C_t,\quad I_{t+1}=I_t+C_t-D_t,\quad \log\beta_{t+1}=\log\beta_t+\sigma\varepsilon_t`, "기대 성장배율 1+γ(R_t−1) → R_t=1이 증감 경계와 일치. σ=0.05."],
  ["⑥ 음이항 관측모형", "일·주 단위 공용", String.raw`y_t\sim\text{NB}\Big(\mu_t=\rho\!\!\sum_{u\in(t',\,t]}\!\! C_u,\ k\Big),\qquad \mathrm{Var}[y_t]=\mu_t+\frac{\mu_t^2}{k}`, "", "t′는 직전 관측일. 일별 자료면 그날의 C_t, 주별 자료면 1주 누적과 비교합니다(결측·음수는 관측 없음). 가정: ρ=1(청구=신규 감염), 초기 면역 0."],
  ["⑦ 입자필터 (실시간)", "Sequential Monte Carlo", String.raw`w_t^{(j)}\propto w_{t-1}^{(j)}\,p\big(y_t\mid x_t^{(j)}\big),\quad \mathrm{ESS}_t=\Big(\sum_j (w_t^{(j)})^2\Big)^{-1}<\tfrac{N_p}{2}\Rightarrow\text{계통 재표집}`, String.raw`P(\mathcal{R}_t>1\mid y_{1:t})=\sum_j w_t^{(j)}\,\mathbb{1}\{\mathcal{R}_t^{(j)}>1\}`, "기준일까지의 자료만 사용. N_p=2,000. 확률은 γ·ρ·θ를 고정한 모형 조건부 값이라 화면에서는 >99%로 상한 표시."],
  ["⑧ 고정지연 입자평활 (확정)", "Backward lineage", String.raw`p\big(x_s\mid y_{1:\min(s+L,T)}\big)\approx\sum_j w_{s+L}^{(j)}\,\delta\big(x_s-x_s^{(\mathrm{anc}_s(j))}\big),\qquad L=14\text{일}`, "", "anc_s(j)는 s+L 시점 입자 j의 s 시점 조상. 14일 뒤 확정값."],
  ["⑨ 내부 검토 신호", "의사결정 보조 규칙", String.raw`\text{신호}_t=\begin{cases}\text{급상승} & p_t\ge 0.95,\ \tilde{\mathcal{R}}_t\ge 1.3,\ \bar y^{(7)}_t\ge \tau\\ \text{상승} & p_t\ge 0.8,\ \bar y^{(7)}_t\ge \tau\\ \text{관찰} & p_t\ge 0.5\\ \text{안정} & \text{그 외}\end{cases}`, String.raw`\tau=\overline{m}+2s_m\quad(\text{직전 3개 절기 비유행기 7일 평균의 평균}+2\text{SD})`, "R̃_t는 실시간 R_t 중앙값. 3일 연속 같은 방향일 때만 단계를 바꾸고, 올릴 때는 3일 중 최저, 내릴 때는 최고 단계로 바꿉니다. 비유행기 = 7일 평균이 그 절기 중앙값 이하인 날."],
  ["⑩ R_t 요인 분해", "로그 항등식(가정 기반)", String.raw`\Delta\log\mathcal{R}_t=\underbrace{\Delta\log\xi_t}_{\text{이동성}}+\underbrace{\Delta\log\beta_t}_{\text{전파율}}+\underbrace{\Delta\log(S_t/N)}_{\text{감수성}}`, "", "Δ는 최근 7일 평균과 직전 7일 평균의 차이. 모형 안의 회계적 분해이며 이동성 몫은 θ 가정에 따라 달라집니다."],
  ["⑪ 사후 시나리오", "동적·정적 반사실", String.raw`\xi_c(t)=(1-r)^{\eta\,\mathbb{1}\{t_0\le t\lt t_0+d\}}\,\xi(t)\;\Rightarrow\;\text{같은 }\beta(t)\text{로 SIR 재계산}`, String.raw`D_c=\sum_t\mathbb{1}\{\mathcal{R}_c(t)>1\},\qquad E_c=\sum_t\max\big(\mathcal{R}_c(t)-1,0\big)`, "β(t) 경로를 유지하는 가정이라 효과가 크게 나올 수 있습니다(지난 시즌 사후 분석 전용). 연구 저장소의 정적 계산 R_c=(1−r)R도 참고로 표시."],
  ["⑫ 통계적 검증 (선행연구)", "동적 GLS + 부트스트랩 LRT", String.raw`\log\mathcal{R}_{iet}=\alpha+\delta_i+\lambda_1\tilde M_{ie,t-1}+\lambda_2\tilde M_{ie,t-2}+\sum_{j=1}^{4}\psi_{ej}B_{ej}(u_{iet})+\sum_{h=1}^{2}\Big[c_h\sin\frac{2\pi h\omega}{52}+d_h\cos\frac{2\pi h\omega}{52}\Big]+\varepsilon_{iet}`, String.raw`H_0:\lambda_1=\lambda_2=0,\quad T_{obs}=2\{\ell(\hat\Theta_{full})-\ell(\hat\Theta_0)\},\quad p_{boot}=\frac{1+\sum_{b}\mathbb{1}\{T_b^*\ge T_{obs}\}}{B+1}`, "CAR(1) 잔차 상관, B=1,999 → LRT 10.22, p=0.0065. 종속변수 log R_t에 이동성 계수가 들어 있어 시차 연관에 기계적 성분이 섞일 수 있습니다(계수 방향 미보고, 표본 내 검정)."],
  ["⑬ 성능 지표", "검증", String.raw`\mathrm{RMSE}=\sqrt{\frac{1}{T}\sum_{t}(\hat{\mathcal{R}}_t-\mathcal{R}_t)^2},\qquad \text{Coverage}_{90}=\frac{1}{T}\sum_t\mathbb{1}\{\mathcal{R}_t\in[\hat q_{.05},\hat q_{.95}]\}`, "", "합성자료는 정답 대비 오차·포함률, 실제자료는 전국 주의보 대비 신호 시점·단순 규칙 대비 오작동일·관측 적합(MAE)으로 평가."],
];

function synthValidation() {
  const ds = state.datasets.find(d => d.synthetic);
  const c = state.cache[ds.key];
  if (!c) return "";
  const pf = c.pf;
  const fr = E.rmse(pf.filter.Rt.med, ds.truth.Rt), sr = E.rmse(pf.smooth.Rt.med, ds.truth.Rt);
  const fc = E.coverage(pf.filter.Rt.lo, pf.filter.Rt.hi, ds.truth.Rt), sc = E.coverage(pf.smooth.Rt.lo, pf.smooth.Rt.hi, ds.truth.Rt);
  const rc = state.summary.synthetic.research_centered;
  return `<div class="card mt"><h3>이 브라우저에서 계산한 합성 검증 <span class="pill">정답 R<sub>t</sub>를 아는 합성 시즌 ${ds.dates.length}일</span></h3>
    <div class="table-wrap"><table class="tbl"><tr><th>추정 방식</th><th class="num">R<sub>t</sub> RMSE</th><th class="num">90% 구간 포함률</th><th>자료 사용</th></tr>
    <tr><td>입자필터 (실시간, 후행 ξ)</td><td class="num">${fr.toFixed(4)}</td><td class="num">${nf(fc * 100, 1)}%</td><td>y₁…y_t</td></tr>
    <tr class="hl"><td>고정지연 입자평활 (확정)</td><td class="num">${sr.toFixed(4)}</td><td class="num">${nf(sc * 100, 1)}%</td><td>y₁…y_{t+14}</td></tr>
    <tr><td>참고: 연구 설정(중심 ξ) 필터 / 평활</td><td class="num">${rc.pf_rmse.toFixed(4)} / ${rc.ps_rmse.toFixed(4)}</td><td class="num">${nf(rc.pf_cover90 * 100, 1)}% / ${nf(rc.ps_cover90 * 100, 1)}%</td><td>미래 3일 승차량 포함</td></tr></table></div>
    <p class="small muted mt">평활 오차가 필터보다 ${nf((1 - sr / fr) * 100, 1)}% 작습니다. 생성 모형과 추론 모형이 같은 시즌 하나에서의 검증이라, 실제자료 검증(「실제자료 검증」 탭)과 함께 봐야 합니다. 유행 급변기에는 실시간 값이 과소추정되는 경향이 있습니다.</p>
    ${signalPerformanceTable(ds, c.signals)}</div>`;
}

function signalPerformance(ds, sig) {
  const R = ds.truth.Rt, T = R.length, waves = [];
  for (let t = 0; t < T;) {
    if (R[t] > 1.15) { let e = t; while (e + 1 < T && R[e + 1] > 1.15) e++; if (e - t + 1 >= 7) waves.push([t, e]); t = e + 1; } else t++;
  }
  const rows = waves.map(([a, b]) => {
    let s = -1;
    for (let t = Math.max(0, a - 14); t <= b; t++) if (sig[t] >= 2) { s = t; break; }
    let p = a;
    for (let t = a; t <= Math.min(T - 1, b + 30); t++) if (ds.cases[t] > ds.cases[p]) p = t;
    return { a, b, s, p, lead: s >= 0 ? p - s : null };
  });
  let on = 0, hit = 0;
  for (let t = 0; t < T; t++) if (sig[t] >= 2) { on++; if (R[t] > 1) hit++; }
  return { rows, precision: on ? hit / on : null, on, falseDays: on - hit };
}

function signalPerformanceTable(ds, sig) {
  const sp = signalPerformance(ds, sig);
  return `<h4 class="mt">내부 검토 신호 성능 (합성 정답 기준)</h4>
    <div class="table-wrap"><table class="tbl"><tr><th>유행파 (정답 R<sub>t</sub>&gt;1.15 구간)</th><th>첫 ‘상승’ 이상 신호</th><th>관측 정점</th><th class="num">정점까지</th></tr>
    ${sp.rows.map(r => `<tr><td>${dlabel(ds.dates[r.a])} ~ ${dlabel(ds.dates[r.b])}</td><td>${r.s >= 0 ? dlabel(ds.dates[r.s]) : "미탐지"}</td><td>${dlabel(ds.dates[r.p])}</td><td class="num">${r.lead != null ? r.lead + "일" : "–"}</td></tr>`).join("")}
    </table></div>
    <p class="small muted mt">‘상승’ 이상 신호가 켜진 ${sp.on}일 중 정답 R<sub>t</sub>&gt;1인 날의 비율(정밀도) ${nf((sp.precision || 0) * 100, 1)}%.</p>`;
}

function renderMethod() {
  if (!state.cache.synthetic) state.cache.synthetic = (() => {
    const ds = state.datasets.find(d => d.synthetic);
    const pf = E.runParticleFilter({ y: ds.cases, xi: ds.xi, N: ds.N, nParticles: 2000, seed: 7, sigma: 0.05, kObs: 20, lag: 14 });
    const base = E.epidemicBaseline(ds.cases);
    return { pf, base, signals: E.signalSeries(pf.filter.pGt1, pf.filter.Rt.med, base.ma7, base.threshold) };
  })();
  app().innerHTML = `
  <div class="section-title"><h2>수리모형과 수식</h2><p>선행연구 모형 + 서비스 운영을 위한 확장</p></div>
  <div class="grid g2">${EQS.map(([title, tag, a, b, note]) => `
    <div class="eq-card"><span class="tag">${tag}</span><h4>${title}</h4>
      <div class="eq">$$${a}$$</div>${b ? `<div class="eq">$$${b}$$</div>` : ""}<p>${note}</p></div>`).join("")}
  </div>
  ${synthValidation()}
  <div class="grid g2 mt">
    <div class="card"><h3>모수와 가정</h3>
      <div class="table-wrap"><table class="tbl"><tr><th>기호</th><th>값</th><th>설명</th></tr>
        <tr><td>γ⁻¹</td><td>4.1일</td><td>평균 감염기간 (선행연구 Table 1, 잠복기 없는 SIR)</td></tr>
        <tr><td>θ</td><td>0.5</td><td>구조적 이동수준 탄력성 (선행연구 기본값, 추정하지 않은 가정)</td></tr>
        <tr><td>L/L<sub>ref</sub></td><td>1.73–1.83 (부산)</td><td>5개 도시 승차·인구로 절기별 계산</td></tr>
        <tr><td>ρ</td><td>1</td><td>관측비율(청구=신규 감염) 가정</td></tr>
        <tr><td>S₀/N</td><td>≈1</td><td>초기 면역 0 가정</td></tr>
        <tr><td>N<sub>p</sub>, σ, k, L</td><td>2,000, 0.05, 20, 14일</td><td>입자 수, log β 확률보행 SD, 음이항 산포, 평활 지연</td></tr>
      </table></div></div>
    <div class="card"><h3>한계와 대응</h3>
      <ul class="small">
        <li>도시철도 승차량은 접촉 수 자체가 아니며 자가용·도시 간 이동(원고 p.18)과 버스 이동을 담지 않습니다 → 시내버스 교통카드 결합을 1단계 과제로 둡니다.</li>
        <li>청구자료는 진료 지연과 요일·공휴일 효과가 있고 연 1회 공개됩니다 → 지연분포·요일계수, 질병청 주간 분율 연계를 운영 단계에서 추가합니다.</li>
        <li>ρ, 초기 면역, γ, θ는 자료만으로 식별되지 않습니다 → 민감도 분석(ρ∈{0.1,0.3,1}, S₀/N∈{0.6,0.8,1}, γ⁻¹∈{3,4.1,5}, θ∈{0,0.5,1})을 진행합니다.</li>
        <li>입자평활은 뒤 자료를 씁니다 → 실시간 판단은 입자필터 값만 사용합니다.</li>
        <li>GLS·요인 분해·시나리오는 인과효과의 증명이 아닙니다.</li>
      </ul></div>
  </div>`;
  if (window.renderMathInElement) window.renderMathInElement(app(), { delimiters: [{ left: "$$", right: "$$", display: true }], throwOnError: false });
}

// ---------- 화면: 주간 브리핑 ----------
const CITIZEN = [
  { title: "안정", text: "부산의 인플루엔자 확산이 뚜렷하지 않습니다. 손 씻기와 기침 예절을 지켜 주세요. 고위험군은 접종 일정을 확인해 주세요." },
  { title: "관찰", text: "부산에서 인플루엔자가 조금씩 늘 수 있는 시기입니다. 65세 이상·어린이·임신부·만성질환자는 예방접종을 미리 받아 주세요." },
  { title: "주의", text: "부산에서 인플루엔자가 늘고 있습니다. 열·기침이 있으면 등교·출근을 쉬고 진료를 받아 주세요. 붐비는 대중교통에서는 마스크 착용을 권합니다." },
  { title: "주의", text: "부산에서 인플루엔자가 빠르게 늘고 있습니다. 고위험군은 증상이 생기면 바로 진료를 받아 주세요. 야간·휴일 소아 진료기관을 미리 확인해 두세요." },
];

function renderBriefing() {
  const ds = state.ds, t = state.asOf, s = nowStats(t), lv = signalOf(s.level);
  const d = E.decompose(E.fillGaps(ds.xi), state.pf.filter.beta.med, state.pf.filter.sfrac, Math.max(t, 13));
  const adv = adviceFor(d);
  const week = Math.floor((new Date(ds.dates[t]) - new Date(ds.dates[0])) / (7 * 864e5)) + 1;
  const actions = [];
  if (s.level >= 2) {
    actions.push("시민 안내: 고위험군(65세 이상·영유아·임신부·만성질환자) 예방접종 및 유증상 시 등교·출근 자제 안내 검토");
    actions.push("의료 대응: 소아청소년과·응급실 진료 수요 대비, 달빛어린이병원·공공심야어린이병원 안내 강화 검토");
    if (adv.rising && adv.dom === "이동성") actions.push("교통: 혼잡 시간대 환기·마스크 안내 협조 검토(부산교통공사, 이동 억제 아님)");
    if (adv.rising && adv.dom === "고유 전파력") actions.push("학교·보육: 교육청과 집단 발생 모니터링 공유, 유증상자 관리 안내 검토");
  } else if (s.level === 1) actions.push("관찰 단계: 다음 주 신호 변화와 의료이용 추이를 재확인하고 예방접종 독려 유지");
  else actions.push("안정 단계: 정기 모니터링 유지, 다음 유행기 대비 예방접종 홍보 계획 점검");
  const advText = ds.advisory ? (new Date(ds.dates[t]) >= new Date(ds.advisory.date) ? `전국 유행주의보 발령 중(${dlabel(ds.advisory.date)}~)` : "전국 유행주의보 발령 전") : "";
  const cz = CITIZEN[s.level];
  app().innerHTML = `
  <div class="toolbar no-print" style="margin-bottom:14px">
    <div class="asof"><label for="asof">기준일</label><input type="range" id="asof" min="20" max="${ds.dates.length - 1}" value="${t}"><span class="date" id="asof-date">${dlabel(ds.dates[t])}</span></div>
    <button class="btn sm" id="print">인쇄 / PDF 저장</button>
  </div>
  <article class="report">
    <h2>부산 인플루엔자 전파 주간 브리핑 <span class="small muted">(시즌 ${week}주차 · 내부 검토용)</span></h2>
    <div class="meta"><span>기준일 ${dlabel(ds.dates[t])} · 자료: ${esc(ds.name)}${advText ? " · " + advText : ""}</span><span>Mobility-SIR 부산 자동 생성 · 감염병관리지원단 검토 전 초안</span></div>
    <p>내부 검토 신호 <span class="signal-badge" style="background:${lv.color}">${lv.name}</span> &nbsp; 실시간 R<sub>t</sub> <b>${nf(s.rt, 2)}</b> (90% 구간 ${nf(s.lo, 2)}–${nf(s.hi, 2)}), 모형 확산 확률 <b>${prob(s.p)}</b></p>
    <h4>1. 요약</h4>
    <ul>
      <li>의료이용 7일 평균 ${nf(s.ma7)}건/일, 전주 대비 ${pct(s.maChange, 0)} (유행 기준선 ${nf(s.thr)}건/일 ${s.ma7 >= s.thr ? "초과" : "미만"}).</li>
      <li>${s.doubling ? `현재 추세라면 배가시간 약 ${nf(s.doubling, 1)}일.` : s.halving ? `반감기 약 ${nf(s.halving, 1)}일로 감소 추세.` : "증감이 크지 않음."}</li>
      <li>최근 1주 R<sub>t</sub> 변화 ${(d.total > 0 ? "+" : "") + nf(d.total * 100, 1)} 로그 %p(${pct(d.pct, 1)}): 이동성 ${(d.dXi > 0 ? "+" : "") + nf(d.dXi * 100, 1)}, 전파율 ${(d.dBeta > 0 ? "+" : "") + nf(d.dBeta * 100, 1)}, 감수성 ${(d.dS > 0 ? "+" : "") + nf(d.dS * 100, 1)} → ${d.total >= 0 ? "주된 상승 요인" : "주된 하락 요인"} <b>${adv.dom}</b>(가정 기반 분해).</li>
      <li>도시철도 이동성 계수 ξ(t) ${nf(s.xi, 2)} (기준일까지 평균 대비 ${pct(s.xiDev, 1)}).</li>
    </ul>
    <h4>2. 검토 권고 (자동 결정 아님)</h4>
    <ul>${actions.map(a => `<li>${a}</li>`).join("")}</ul>
    <h4>3. 해석상 유의점</h4>
    <ul class="small">
      <li>${OFFICIAL}</li>
      <li>R<sub>t</sub>·β(t)는 모형 추정치(γ·ρ·θ 고정)이며 90% 구간과 함께 해석합니다. 확정값(입자평활)은 14일 뒤 갱신됩니다.</li>
      <li>의료이용 청구자료는 실제 감염 전체가 아니며 공개 시차가 있습니다. 도시철도 외 이동은 반영되지 않습니다.</li>
    </ul>
  </article>
  <article class="report mt">
    <h2>시민 안내문 초안 <span class="small muted">(감염병관리지원단 검토 후 발행 · 시 전체 단위)</span></h2>
    <p><b>부산 독감 주간 안내 — ${cz.title}</b></p>
    <p>${cz.text}</p>
    <ul class="small">
      <li>예방접종 위탁의료기관 찾기: 질병관리청 예방접종도우미 <a href="https://nip.kdca.go.kr" target="_blank" rel="noopener">nip.kdca.go.kr</a></li>
      <li>야간·휴일 소아 진료(달빛어린이병원 등): 응급의료포털 <a href="https://www.e-gen.or.kr" target="_blank" rel="noopener">e-gen.or.kr</a></li>
      <li>이 안내는 부산의 의료이용·도시철도 이용 통계를 바탕으로 한 참고 정보이며, 공식 경보는 질병관리청 유행주의보입니다.</li>
    </ul>
  </article>`;
  $("#print").addEventListener("click", () => window.print());
  bindAsOf(renderBriefing);
}

// ---------- 화면: 데이터 ----------
function renderData() {
  const ds = state.ds;
  app().innerHTML = `
  <div class="section-title"><h2>데이터</h2><p>모든 계산은 브라우저 안에서 이루어지며, 업로드한 파일은 외부로 전송되지 않습니다</p></div>
  <div class="card">
    <h3>활용 데이터</h3>
    <div class="table-wrap"><table class="tbl">
      <tr><th>#</th><th>데이터명</th><th>출처</th><th>내용·활용</th></tr>
      <tr><td>1</td><td>부산교통공사 시간대별 승하차인원</td><td><a href="https://www.data.go.kr/data/3057229/fileData.do" target="_blank" rel="noopener">공공데이터포털 3057229</a></td><td>역·시간대별 승하차, 월간 갱신·OpenAPI. 승차 일별 합계 → X(t) → ξ(t). 2016.1.–2024.12. 사용</td></tr>
      <tr><td>2</td><td>국민건강보험공단 감염성질환(인플루엔자) 의료이용정보</td><td><a href="https://www.data.go.kr/data/15089429/fileData.do" target="_blank" rel="noopener">공공데이터포털 15089429</a></td><td>요양개시일 기준 시도별 일별 진료에피소드 수(외래입원 주부상병, 28일 이내 동일 상병 1건), 연 1회 갱신. 부산(26) 2016–2024 사용</td></tr>
      <tr><td>3</td><td>행정안전부 주민등록 인구통계</td><td><a href="https://jumin.mois.go.kr" target="_blank" rel="noopener">jumin.mois.go.kr</a></td><td>연말 인구, 시즌 인구 = 두 해 평균 → Pop, N</td></tr>
      <tr><td>4</td><td>서울·대구·대전·광주 도시철도 승하차</td><td>각 운영기관 / 공공데이터포털</td><td>기준 이동수준 L<sub>ref</sub>(5개 도시 평균)</td></tr>
      <tr><td>5</td><td>질병관리청 인플루엔자 유행주의보·표본감시</td><td>질병관리청 보도자료·감염병포털</td><td>신호 시점 비교 기준(발령 효력일), 운영 단계 주간 관측 보조</td></tr>
    </table></div>
  </div>
  <div class="grid g2 mt">
    <div class="card">
      <h3>내 데이터로 분석하기</h3>
      <p class="small">CSV 열: <code>date</code>(YYYY-MM-DD), <code>cases</code>(일별 또는 주별 의료이용 — 주별이면 주 마지막 날에만 값), 그리고 <code>boardings</code>(일별 승차량) 또는 <code>xi</code>(이동성 계수) 중 하나.</p>
      <div class="drop" id="drop"><p><b>CSV 파일을 끌어다 놓거나</b></p><input type="file" id="file" accept=".csv,text/csv"></div>
      <div class="form-row">
        <label>인구 N<input type="number" id="f-n" value="${ds.N}"></label>
        <label>θ<input type="number" id="f-theta" value="0.5" step="0.1" min="0" max="1"></label>
        <label>L/L<sub>ref</sub><input type="number" id="f-ratio" value="${ds.L_ratio || 1.7263}" step="0.01"></label>
        <label>이동평균<select id="f-win"><option value="trailing">후행 7일(실시간)</option><option value="centered">중심 7일(연구)</option></select></label>
      </div>
      <div class="form-row"><button class="btn" id="run" disabled>분석 실행</button><button class="btn ghost" id="template">CSV 양식 내려받기</button></div>
      <div id="upload-msg" class="small mt"></div>
    </div>
    <div class="card">
      <h3>현재 데이터셋</h3>
      <div class="table-wrap"><table class="tbl">
        <tr><th>이름</th><td>${esc(ds.name)}</td></tr>
        <tr><th>기간</th><td>${dlabel(ds.dates[0])} ~ ${dlabel(ds.dates[ds.dates.length - 1])} (${ds.dates.length}일)</td></tr>
        <tr><th>인구 N</th><td>${nf(ds.N)}</td></tr>
        <tr><th>의료이용 합계</th><td>${nf(ds.cases.reduce((a, b) => a + (Number.isFinite(b) && b > 0 ? b : 0), 0))}건</td></tr>
        <tr><th>유행 기준선 τ</th><td>${nf(state.base.threshold, 1)}건/일 (${ds.tau != null ? "직전 3개 절기 비유행기" : "7일 평균이 가장 낮은 8주 구간"})</td></tr>
        <tr><th>유형</th><td>${ds.synthetic ? `<span class="pill warn">합성 검증</span> ${esc(state.demo.meta.notice)}` : ds.upload ? `<span class="pill ok">업로드</span>` : `<span class="pill ok">공개 원자료(후향 재현)</span>`}</td></tr>
      </table></div>
      <h4 class="mt">개인정보 보호 설계</h4>
      <ul class="small"><li>개인 이동경로·위치·카드 정보 없이 <b>일별 집계</b>만 사용</li><li>정적 웹으로 서버 저장소가 없음</li><li>구·군 단위 결과는 자료 정합 확인 전 비공개, 시민 안내는 시 전체 단위</li></ul>
    </div>
  </div>`;
  let parsed = null;
  const msg = $("#upload-msg"), runBtn = $("#run");
  const handle = file => {
    parsed = null; runBtn.disabled = true;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        parsed = parseCSV(String(rd.result));
        msg.innerHTML = `<span class="pill ok">읽기 완료</span> ${parsed.rows.length}일, 열: ${parsed.cols.map(esc).join(", ")}${parsed.warn.length ? `<br><span class="pill warn">점검</span> ${parsed.warn.map(esc).join(" · ")}` : ""}`;
        runBtn.disabled = false;
      } catch (e) { parsed = null; runBtn.disabled = true; msg.innerHTML = `<span class="pill warn">오류</span> ${esc(e.message)}`; }
    };
    rd.readAsText(file);
  };
  $("#file").addEventListener("change", e => e.target.files[0] && handle(e.target.files[0]));
  const drop = $("#drop");
  drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("drag"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
  drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("drag"); e.dataTransfer.files[0] && handle(e.dataTransfer.files[0]); });
  runBtn.addEventListener("click", () => {
    if (!parsed) return;
    const N = +$("#f-n").value, theta = +$("#f-theta").value, ratio = +$("#f-ratio").value, win = $("#f-win").value;
    const rows = parsed.rows;
    let xi;
    try {
      xi = parsed.cols.includes("xi") ? E.fillGaps(rows.map(r => r.xi)) : E.fillGaps(E.mobilityFactor(rows.map(r => r.boardings), N, { theta, ratio, window: win }).xi);
    } catch (e) { msg.innerHTML = `<span class="pill warn">오류</span> ${esc(e.message)}`; return; }
    const nds = { key: `upload:${Date.now() % 1e6}`, label: "업로드 데이터", name: "업로드 데이터", synthetic: false, upload: true, dates: rows.map(r => r.date), cases: rows.map(r => r.cases), xi, N };
    msg.textContent = "계산 중…";
    setTimeout(() => {
      state.datasets = state.datasets.filter(d => !d.upload).concat(nds);
      setDataset(nds); location.hash = "#dashboard"; route();
    }, 30);
  });
  $("#template").addEventListener("click", () => {
    const d = state.ds, lines = ["date,boardings,cases"];
    d.dates.forEach((x, i) => lines.push(`${x},${d.boardings && d.boardings[i] != null ? d.boardings[i] : ""},${d.cases[i]}`));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = "mobility_sir_template.csv"; a.click();
  });
}

// RFC 4180 방식: 따옴표 안 쉼표·"" 이스케이프 처리
function splitCSVLine(line) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function normDate(s) {
  const m = String(s).trim().slice(0, 10).replace(/[./]/g, "-").match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : null;
}

function parseCSV(text) {
  const lines = text.replace(/^﻿/, "").replace(/\r/g, "").split("\n").filter(l => l.trim());
  if (!lines.length) throw new Error("빈 파일입니다.");
  const head = splitCSVLine(lines[0]).map(h => h.toLowerCase());
  for (const n of ["date", "cases"]) if (!head.includes(n)) throw new Error(`필수 열 '${n}'이 없습니다.`);
  if (!head.includes("boardings") && !head.includes("xi")) throw new Error("'boardings' 또는 'xi' 열이 필요합니다.");
  const warn = [], seen = new Map();
  let bad = 0, neg = 0;
  for (const l of lines.slice(1)) {
    const v = splitCSVLine(l);
    if (v.length !== head.length) { bad++; continue; }
    const o = {};
    head.forEach((h, i) => {
      if (h === "date") o.date = normDate(v[i]);
      else { const x = v[i].replace(/[,\s]/g, ""); o[h] = x === "" ? NaN : +x; }
    });
    if (!o.date) { bad++; continue; }
    if (Number.isFinite(o.cases) && o.cases < 0) { neg++; o.cases = NaN; }
    if (seen.has(o.date)) throw new Error(`날짜가 중복됩니다: ${o.date}`);
    seen.set(o.date, o);
  }
  const dates = [...seen.keys()].sort();
  if (dates.length < 60) throw new Error("최소 60일 이상의 자료가 필요합니다.");
  const rows = [];
  let missing = 0;
  for (let d = new Date(dates[0]); d <= new Date(dates[dates.length - 1]); d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    if (seen.has(key)) rows.push(seen.get(key));
    else { missing++; rows.push({ date: key, cases: NaN, boardings: NaN, xi: NaN }); }
  }
  if (bad) warn.push(`형식이 맞지 않는 행 ${bad}개 제외`);
  if (neg) warn.push(`음수 환자 수 ${neg}일을 결측으로 처리`);
  if (missing) warn.push(`빠진 날짜 ${missing}일을 결측으로 채움`);
  const missC = rows.filter(r => !Number.isFinite(r.cases)).length;
  if (missC) warn.push(`환자 수 결측 ${missC}일(가중치 갱신 생략)`);
  return { rows, cols: head, warn };
}

// ---------- 라우팅 ----------
const ROUTES = { home: renderHome, dashboard: renderDashboard, decompose: renderDecompose, scenario: renderScenario, research: renderResearch, method: renderMethod, briefing: renderBriefing, data: renderData };

function route() {
  const key = (location.hash || "#home").slice(1).split("?")[0];
  state.route = ROUTES[key] ? key : "home";
  document.querySelectorAll(".tabs a").forEach(a => a.classList.toggle("active", a.dataset.route === state.route));
  destroyCharts();
  ROUTES[state.route]();
  renderBanner();
  window.scrollTo({ top: 0 });
}

function renderBanner() {
  const ds = state.ds;
  const opts = state.datasets.map(d => `<option value="${esc(d.key)}" ${d.key === ds.key ? "selected" : ""}>${esc(d.label)}</option>`).join("");
  $("#dataset-banner").innerHTML = `<div class="pill-row">
    ${ds.synthetic ? `<span class="pill warn">합성 검증 시즌</span>` : ds.upload ? `<span class="pill ok">업로드 데이터</span>` : `<span class="pill ok">부산 실제자료 · 후향 재현</span>`}
    <label class="ds-select">데이터 <select id="ds-select">${opts}</select></label>
    <span>${ds.synthetic ? "정답 R<sub>t</sub>를 아는 합성 시즌으로 방법의 정확도를 확인합니다." : ds.upload ? `${ds.dates.length}일 자료로 계산했습니다.` : "공개 원자료(건보 의료이용·부산교통공사 승차)로 지난 절기를 하루씩 따라가며 계산합니다."}</span>
  </div>`;
  $("#ds-select").addEventListener("change", e => {
    const next = state.datasets.find(d => d.key === e.target.value);
    $("#app").innerHTML = `<div class="loading"><div class="spinner"></div><p>입자필터로 ${esc(next.name)}의 R<sub>t</sub>를 추정하는 중…</p></div>`;
    setTimeout(() => { setDataset(next); route(); }, 30);
  });
}

// #dashboard?ds=real:2017-18&asof=2017-12-01 처럼 공유한 링크의 절기·기준일을 반영 (탭 이동처럼 매개변수가 없으면 그대로 둔다)
function applyHashParams() {
  const q = new URLSearchParams(location.hash.split("?")[1] || "");
  const want = q.get("ds") ? state.datasets.find(d => d.key === q.get("ds")) : null;
  if (want && want !== state.ds) setDataset(want);
  if (q.get("asof")) { const i = state.ds.dates.indexOf(q.get("asof")); if (i >= 0) state.asOf = Math.max(20, i); }
}

async function init() {
  try {
    const get = f => fetch(f).then(r => { if (!r.ok) throw new Error(`${f} ${r.status}`); return r.json(); });
    const [demo, real, ref, summary] = await Promise.all([
      get("data/busan_demo.json"), get("data/busan_real.json"), get("data/research_reference.json"), get("data/validation_summary.json"),
    ]);
    Object.assign(state, { demo, real, ref, summary });
    state.datasets = buildDatasets();
    await new Promise(r => setTimeout(r, 20));
    setDataset(state.datasets.find(d => d.key === "real:2024-25") || state.datasets[0]);
    applyHashParams();
    window.addEventListener("hashchange", () => { applyHashParams(); route(); });
    route();
    document.body.dataset.ready = "1";
  } catch (e) {
    app().innerHTML = `<div class="card"><h3>데이터를 불러오지 못했습니다</h3><p>${esc(e.message)}</p><p class="small">로컬에서 index.html을 직접 열면 브라우저 보안 정책으로 JSON을 읽지 못할 수 있습니다. 저장소 README의 로컬 실행 방법(python -m http.server)을 참고하세요.</p></div>`;
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
