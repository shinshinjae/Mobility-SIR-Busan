"""수리모형·이동성 계수·입자필터의 기본 성질을 확인한다.  실행: python -m pytest tests"""
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "analysis"))

from msir import GAMMA, final_size, mobility_factor, pf, simulate_discrete, simulate_ode, summary  # noqa: E402


def test_mobility_factor_matches_definition():
    X = np.array([100, 120, 80, 100, 110, 90, 100, 105.0])
    out = mobility_factor(X, 1000, theta=0.5, L_ref=0.05, window="centered")
    m = X / 1000
    assert np.isclose(out["L"], m.mean())
    assert np.allclose(out["c"], m / m.mean())
    # 중심 7일 이동평균, 경계에서는 가능한 값만 평균 (|mu - t| <= 3)
    assert np.isclose(out["b"][0], out["c"][:4].mean())
    assert np.isclose(out["b"][4], out["c"][1:8].mean())
    assert np.allclose(out["xi"], (m.mean() / 0.05) ** 0.5 * out["b"])


def test_trailing_window_uses_no_future():
    X = np.arange(1, 15, dtype=float)
    out = mobility_factor(X, 1.0, window="trailing")
    X2 = X.copy()
    X2[10:] = 999.0
    out2 = mobility_factor(X2, 1.0, window="trailing")
    # L 이 바뀌므로 c 의 비율 구조만 비교: 과거 구간의 상대값은 미래 값과 무관
    assert np.allclose(out["b"][:10] * out["L"], out2["b"][:10] * out2["L"])


def test_busan_table2_is_consistent_with_L_ratio():
    # 선행연구 Table 2: theta 별 평균이 (L/Lref)^theta * mean(b) 로 설명되는지 (mean(b) ~ 1)
    ratio = 1.7263
    for theta, reported in [(0.01, 1.0055), (0.5, 1.3139), (1.0, 1.7263)]:
        assert abs(ratio ** theta - reported) < 2e-3


def test_ode_conserves_population_and_positivity():
    T, N = 200, 1_000_000
    xi = np.full(T, 1.2)
    beta = np.full(T, 0.3)
    out = simulate_ode(xi, beta, N - 10, 10, N)
    R = N - out["S"] - out["I"]
    assert np.all(out["S"] >= 0) and np.all(out["I"] >= 0) and np.all(R >= -1e-6)
    assert np.all(np.diff(out["S"]) <= 1e-9)


def test_discrete_threshold_is_rt_equal_one():
    # 일 단위 이산화에서 R_t = 1 이면 감염자 수가 (거의) 변하지 않아야 한다
    N, I0 = 1e9, 1000.0
    T = 30
    xi = np.ones(T)
    beta = np.full(T, GAMMA)  # R_t = S/N ~ 1
    out = simulate_discrete(xi, beta, N - I0, I0, N)
    assert abs(out["I"][-1] / I0 - 1) < 1e-3


def test_final_size_relation():
    for R0 in [1.2, 1.5, 2.0, 3.0]:
        z = final_size(R0)
        assert abs(1 - z - np.exp(-R0 * z)) < 1e-10


def test_peak_occurs_when_rt_crosses_one():
    T, N = 400, 1_000_000
    out = simulate_discrete(np.ones(T), np.full(T, 0.5), N - 10, 10, N)
    peak = int(np.argmax(out["I"]))
    assert out["Rt"][peak - 1] >= 1 - 1e-3 and out["Rt"][peak + 1] <= 1 + 1e-3


def test_particle_smoother_beats_filter_on_demo_data():
    d = json.loads((ROOT / "docs" / "data" / "busan_demo.json").read_text(encoding="utf-8"))
    est = pf.run(np.array(d["cases"]), np.array(d["xi"]), d["meta"]["N"], n_particles=1500, seed=11)
    truth = np.array(d["truth"]["Rt"])
    rmse = lambda a: np.sqrt(np.mean((a - truth) ** 2))
    f, s = rmse(est["filter"]["Rt"][:, 1]), rmse(est["smooth"]["Rt"][:, 1])
    assert s < f
    assert f < 0.15
    cover = np.mean((est["smooth"]["Rt"][:, 0] <= truth) & (truth <= est["smooth"]["Rt"][:, 2]))
    assert cover > 0.8


def test_summary_keys():
    s = summary([1.0, 2.0, 3.0])
    assert set(s) == {"mean", "variance", "sd", "min", "max"}


if __name__ == "__main__":
    # pytest 가 없어도 실행할 수 있도록 간단한 실행기를 둔다:  python tests/test_model.py
    tests = [(k, v) for k, v in dict(globals()).items() if k.startswith("test_") and callable(v)]
    failed = 0
    for name, fn in tests:
        try:
            fn()
            print("ok  ", name)
        except Exception as e:  # noqa: BLE001
            failed += 1
            print("FAIL", name, e)
    print(f"{len(tests) - failed} passed, {failed} failed")
    sys.exit(1 if failed else 0)
