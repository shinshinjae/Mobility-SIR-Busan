"""도시철도 승차량으로 이동성 계수 xi(t)를 만드는 함수.

선행연구(Shin, Ahn, Kim 2026) 식 (5)-(10)을 그대로 따른다.

    m_i(t)  = X_i(t) / Pop_i                      (5)  1인당 이동강도
    L_i     = mean_{t in T} m_i(t)                (6)  지역의 구조적 이동수준
    L_ref   = mean_{i in I} L_i                   (7)  기준 이동수준
    c_i(t)  = m_i(t) / L_i                        (8)  지역 내 상대 변동
    b_i(t)  = 7일 이동평균 of c_i(t)               (9)  주간 주기 완화
    xi_i(t) = (L_i / L_ref)^theta * b_i(t)        (10) 이동성 계수

연구(후향 분석)는 중심 이동평균 |mu - t| <= 3 을 쓰지만, 운영(실시간)에서는
미래 값을 쓰지 않도록 후행 이동평균(t-6..t)을 쓴다. window 인자로 고른다.
"""
from __future__ import annotations

import numpy as np


def moving_average(x: np.ndarray, k: int = 7, window: str = "centered") -> np.ndarray:
    """경계에서는 사용 가능한 값만 평균한다 (W(t) = {mu in T : |mu - t| <= 3})."""
    x = np.asarray(x, dtype=float)
    n = len(x)
    out = np.empty(n)
    h = k // 2
    for t in range(n):
        if window == "centered":
            lo, hi = max(0, t - h), min(n, t + h + 1)
        elif window == "trailing":
            lo, hi = max(0, t - k + 1), t + 1
        else:
            raise ValueError("window must be 'centered' or 'trailing'")
        seg = x[lo:hi]
        seg = seg[np.isfinite(seg)]
        out[t] = seg.mean() if len(seg) else np.nan
    return out


def mobility_factor(boardings, population, *, theta: float = 0.5, L_ref: float | None = None,
                    window: str = "centered", k: int = 7) -> dict:
    """일별 승차량 X(t)와 인구 Pop으로 xi(t)를 계산한다.

    L_ref 를 주지 않으면 L_i / L_ref = 1 (단일 지역 분석)로 둔다.
    결측(NaN)은 0으로 바꾸지 않고 이동평균에서 제외한다.
    """
    X = np.asarray(boardings, dtype=float)
    m = X / float(population)
    L = float(np.nanmean(m))
    c = m / L
    b = moving_average(c, k=k, window=window)
    ratio = 1.0 if L_ref is None else L / float(L_ref)
    xi = ratio ** theta * b
    return {"m": m, "L": L, "c": c, "b": b, "ratio": ratio, "xi": xi}


def summary(x) -> dict:
    """선행연구 Table 2 와 같은 형식(평균·분산·표준편차·최솟값·최댓값)."""
    x = np.asarray(x, dtype=float)
    x = x[np.isfinite(x)]
    return {
        "mean": float(x.mean()),
        "variance": float(x.var()),
        "sd": float(x.std()),
        "min": float(x.min()),
        "max": float(x.max()),
    }
