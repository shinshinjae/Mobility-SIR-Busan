"""음이항 관측모형 + 입자필터(PF) / 고정지연 입자평활(PS).

상태 x_t = (S_t, I_t, log beta_t)
  C_t ~ Poisson(xi_t beta_t S_t I_t / N)            신규 감염
  D_t ~ Binomial(I_t, gamma)                        회복 (일 단위 Euler 이산화)
  log beta_{t+1} = log beta_t + sigma * eps_t        전파율의 확률보행
관측(관측이 있는 날만; 일별·주별 모두 직전 관측 이후 누적 신규감염과 비교)
  y_t ~ NegBin(mean = rho * sum_{u in (t_prev, t]} C_u, dispersion k)   Var = mu + mu^2 / k
가중치
  w_t^(j) ∝ w_{t-1}^(j) p(y_t | x_t^(j)),  ESS = 1 / sum_j (w_t^(j))^2 < Np/2 이면 계통 재표집
PF 는 y_1..y_t 만 쓰므로 실시간(nowcast)에 쓰고, PS 는 y_1..y_{t+L} 을 쓰는 사후 재구성이다.
"""
from __future__ import annotations

import numpy as np
from scipy.special import gammaln

from .model import GAMMA


def nb_logpmf(y, mu, k):
    mu = np.maximum(mu, 0.5)
    return (gammaln(y + k) - gammaln(k) - gammaln(y + 1)
            + k * np.log(k / (k + mu)) + y * np.log(mu / (k + mu)))


def systematic_resample(w, rng):
    n = len(w)
    u = (rng.random() + np.arange(n)) / n
    cs = np.cumsum(w)
    cs[-1] = 1.0
    return np.searchsorted(cs, u)


def weighted_quantiles(values, weights, qs):
    order = np.argsort(values)
    v, w = values[order], weights[order]
    cw = np.cumsum(w)
    cw /= cw[-1]
    return np.array([v[min(np.searchsorted(cw, q), len(v) - 1)] for q in qs])


def run(y, xi, N, *, n_particles=2000, gamma=GAMMA, sigma=0.05, k_obs=20.0, rho=1.0,
        lag=14, seed=2026, r0_prior=1.0, qs=(0.05, 0.5, 0.95)):
    y = np.asarray(y, dtype=float)
    y = np.where(np.isfinite(y) & (y >= 0), y, np.nan)   # 음수·결측은 관측 없음으로 처리
    xi = np.asarray(xi, dtype=float)
    T, P = len(y), n_particles
    rng = np.random.default_rng(seed)

    head = y[: min(14, T)]
    y0 = max(float(np.nansum(head)) / max(len(head), 1), 1.0)
    R_init = r0_prior * np.exp(0.2 * rng.standard_normal(P))
    I = np.maximum(1.0, np.round(y0 / (rho * gamma * R_init) * np.exp(0.3 * rng.standard_normal(P))))
    S = N - I
    logb = np.log(R_init * gamma * N / (xi[0] * S))

    vals = {key: np.empty((T, P)) for key in ("Rt", "beta", "sfrac", "C")}
    W = np.empty((T, P))
    A = np.empty((T, P), dtype=np.int64)  # A[t, j]: t+1 시점 입자 j 의 t 시점 조상
    logw = np.zeros(P)
    cum = np.zeros(P)
    p_rec = gamma

    for t in range(T):
        beta = np.exp(logb)
        lam = xi[t] * beta * S * I / N
        C = np.minimum(rng.poisson(lam), S)
        D = rng.binomial(I.astype(np.int64), p_rec)
        vals["Rt"][t] = xi[t] * beta * S / (gamma * N)
        vals["beta"][t] = beta
        vals["sfrac"][t] = S / N
        vals["C"][t] = C
        cum = cum + C
        if np.isfinite(y[t]):
            logw = logw + nb_logpmf(y[t], rho * cum, k_obs)
            cum = np.zeros(P)
        mx = logw.max()
        if not np.isfinite(mx):
            logw, mx = np.zeros(P), 0.0
        w = np.exp(logw - mx)
        tot = w.sum()
        w /= tot
        W[t] = w
        ess = 1.0 / np.sum(w ** 2)
        if ess < P / 2:
            idx = systematic_resample(w, rng)
            logw = np.zeros(P)
        else:
            idx = np.arange(P)
            logw = logw - (mx + np.log(tot))
        A[t] = idx
        S = (S - C)[idx]
        cum = cum[idx]
        I = np.maximum((I + C - D)[idx], 1.0)
        logb = logb[idx] + sigma * rng.standard_normal(P)

    out = {"filter": {}, "smooth": {}}
    for key in vals:
        fq = np.array([weighted_quantiles(vals[key][t], W[t], qs) for t in range(T)])
        out["filter"][key] = fq
    out["filter"]["p_rt_gt_1"] = np.array([np.sum(W[t] * (vals["Rt"][t] > 1)) for t in range(T)])

    # 고정지연 평활: 시점 s 의 추정에 min(s+L, T-1) 시점의 가중치와 계보를 쓴다.
    sq = {key: np.empty((T, len(qs))) for key in vals}
    p_s = np.empty(T)
    for s in range(T):
        t = min(s + lag, T - 1)
        j = np.arange(P)
        for u in range(t - 1, s - 1, -1):
            j = A[u][j]
        for key in vals:
            sq[key][s] = weighted_quantiles(vals[key][s][j], W[t], qs)
        p_s[s] = np.sum(W[t] * (vals["Rt"][s][j] > 1))
    out["smooth"] = sq
    out["smooth"]["p_rt_gt_1"] = p_s
    out["qs"] = list(qs)
    return out
