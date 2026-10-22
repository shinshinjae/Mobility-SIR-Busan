"""웹 시연용 부산 합성 시즌 데이터를 만든다 (실측 자료 아님).

- 달력: 2025-09-01 ~ 2026-08-31, 실제 공휴일·방학 시기를 반영한 도시철도 승차 패턴
- 이동성 계수: 선행연구 식 (5)-(10), theta = 0.5, 부산 L_i/L_ref = 1.7263
  (선행연구 Table 2 의 theta = 1 평균값에서 역산: (L/L_ref)^theta * mean(b) 이고 mean(b) ~ 1)
- 전파율 beta(t): A형 겨울 유행 + B형 봄 유행을 흉내 낸 가상 경로
- 관측: 음이항(산포 k = 30)

생성된 '정답' 경로(truth)는 웹에서 입자필터/평활의 오차(RMSE)를 직접 검증하는 데 쓴다.
실행:  python analysis/build_demo_data.py
"""
from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

import numpy as np

from msir import GAMMA, mobility_factor, pf, simulate_stochastic, summary

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "data" / "busan_demo.json"

SEED = 20251203
N = 3_280_000                 # 시연용 근사 인구(부산 주민등록인구 규모)
MEAN_BOARDINGS = 900_000      # 시연용 일평균 승차량 규모
THETA = 0.5
L_RATIO = 1.7263              # 부산 L_i / L_ref (선행연구 Table 2 에서 역산)
K_OBS = 30.0
BASE = 0.99                   # 비유행기 전파 수준(R_t 가 1 근처에서 완만히 감소)
A1, C1, W1 = 0.90, 92, 8.5     # A형 유행 강도·중심일(9/1 기준)·폭
A2, C2, W2 = 0.45, 190, 9.0
SUMMER = 0.06
I0 = 300
START = dt.date(2025, 9, 1)
END = dt.date(2026, 8, 31)

HOLIDAYS = {
    "2025-10-03": "개천절", "2025-10-05": "추석 연휴", "2025-10-06": "추석", "2025-10-07": "추석 연휴",
    "2025-10-08": "대체공휴일", "2025-10-09": "한글날", "2025-12-25": "성탄절", "2026-01-01": "신정",
    "2026-02-16": "설날 연휴", "2026-02-17": "설날", "2026-02-18": "설날 연휴", "2026-03-02": "대체공휴일(삼일절)",
    "2026-05-05": "어린이날", "2026-05-25": "대체공휴일(부처님오신날)", "2026-06-03": "전국동시지방선거",
    "2026-08-17": "대체공휴일(광복절)",
}
MAJOR = {"2025-10-05", "2025-10-06", "2025-10-07", "2026-02-16", "2026-02-17", "2026-02-18"}
VACATIONS = [(dt.date(2025, 12, 29), dt.date(2026, 2, 27)), (dt.date(2026, 7, 22), dt.date(2026, 8, 23))]
WEEKDAY = [1.04, 1.05, 1.05, 1.06, 1.10, 0.86, 0.70]   # 월~일


def calendar():
    n = (END - START).days + 1
    return [START + dt.timedelta(days=i) for i in range(n)]


def synthetic_boardings(dates, rng):
    c = np.array([WEEKDAY[d.weekday()] for d in dates])
    for i, d in enumerate(dates):
        key = d.isoformat()
        if key in MAJOR:
            c[i] = 0.50
        elif key in HOLIDAYS:
            c[i] = min(c[i], 0.64)
        if any(a <= d <= b for a, b in VACATIONS) and d.weekday() < 5:
            c[i] *= 0.95
    noise = np.zeros(len(dates))
    for i in range(1, len(dates)):
        noise[i] = 0.7 * noise[i - 1] + 0.025 * rng.standard_normal()
    c = c * np.exp(noise)
    c = c / c.mean()
    return np.round(c * MEAN_BOARDINGS).astype(int)


def true_beta(t, xi_bar, rng):
    beta0 = GAMMA / xi_bar
    bump = lambda c, w: np.exp(-0.5 * ((t - c) / w) ** 2)
    # 12월 A형 유행(정점 R ~ 1.8) 뒤 급감, 3월 B형 유행(정점 R ~ 1.35), 늦여름 소폭 상승
    f = (BASE + A1 * bump(C1, W1) - 0.38 * bump(C1 + 24, 11)
         + A2 * bump(C2, W2) - 0.20 * bump(C2 + 22, 12) + SUMMER * bump(335, 10))
    rw = np.cumsum(0.003 * rng.standard_normal(len(t)))
    rw -= np.linspace(rw[0], rw[-1], len(t))   # 장기 표류 제거
    return beta0 * f * np.exp(rw)


def main():
    rng_mob, rng_beta, rng_sim = (np.random.default_rng(SEED + i) for i in range(3))
    dates = calendar()
    T = len(dates)
    X = synthetic_boardings(dates, rng_mob)
    mob = mobility_factor(X, N, theta=THETA, window="centered")
    xi = L_RATIO ** THETA * mob["b"]
    t = np.arange(T, dtype=float)
    beta = true_beta(t, xi.mean(), rng_beta)
    sim = simulate_stochastic(xi, beta, N, I0=I0, rng=rng_sim, k_obs=K_OBS)

    est = pf.run(sim["y"], xi, N, n_particles=3000, k_obs=20.0, sigma=0.05, lag=14, seed=7)
    rmse = lambda a: float(np.sqrt(np.mean((a - sim["Rt"]) ** 2)))
    pf_rmse = rmse(est["filter"]["Rt"][:, 1])
    ps_rmse = rmse(est["smooth"]["Rt"][:, 1])
    cover = lambda q: float(np.mean((q[:, 0] <= sim["Rt"]) & (sim["Rt"] <= q[:, 2])))

    data = {
        "meta": {
            "title": "부산 시연 시즌 (합성 데이터)",
            "synthetic": True,
            "notice": "실측 자료가 아닌 시연용 합성 데이터입니다. 달력·공휴일 패턴과 모형 구조만 실제를 따릅니다.",
            "city": "부산", "N": N, "gamma": GAMMA, "theta": THETA, "L_ratio": L_RATIO,
            "k_obs_true": K_OBS, "seed": SEED, "start": START.isoformat(), "end": END.isoformat(),
            "xi_summary": summary(xi), "b_summary": summary(mob["b"]),
            "python_reference": {"pf_rmse": pf_rmse, "ps_rmse": ps_rmse,
                                 "reduction_pct": 100 * (1 - ps_rmse / pf_rmse),
                                 "pf_cover90": cover(est["filter"]["Rt"]), "ps_cover90": cover(est["smooth"]["Rt"])},
        },
        "dates": [d.isoformat() for d in dates],
        "holidays": HOLIDAYS,
        "boardings": X.tolist(),
        "b": np.round(mob["b"], 6).tolist(),
        "xi": np.round(xi, 6).tolist(),
        "cases": sim["y"].astype(int).tolist(),
        "truth": {
            "beta": np.round(beta, 6).tolist(),
            "Rt": np.round(sim["Rt"], 6).tolist(),
            "C": sim["C"].astype(int).tolist(),
            "sfrac": np.round(sim["S"] / N, 6).tolist(),
        },
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps(data["meta"], ensure_ascii=False, indent=1))
    print("peak cases", int(sim["y"].max()), "on", dates[int(sim["y"].argmax())], "attack", float(sim["C"].sum() / N))
    print("max Rt", float(sim["Rt"].max()), "min S/N", float((sim["S"] / N).min()))


if __name__ == "__main__":
    main()
