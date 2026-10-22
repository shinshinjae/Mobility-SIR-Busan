"""이동성 기반 SIR(Mobility-informed SIR) 모형.

    dS/dt = -xi(t) beta(t) S I / N
    dI/dt =  xi(t) beta(t) S I / N - gamma I
    dR/dt =  gamma I
    R_t   =  xi(t) beta(t) S(t) / (gamma N)          (선행연구 식 (4))

gamma^-1 = 4.1일 (평균 감염기간, 선행연구 Table 1).
"""
from __future__ import annotations

import numpy as np

GAMMA = 1.0 / 4.1


def reproduction_number(xi, beta, S, N, gamma: float = GAMMA):
    return np.asarray(xi) * np.asarray(beta) * np.asarray(S) / (gamma * N)


def simulate_ode(xi, beta, S0: float, I0: float, N: float, gamma: float = GAMMA, substeps: int = 8):
    """하루 단위 xi, beta 를 받아 RK4로 적분한다. 일별 신규감염 C(t)를 함께 돌려준다."""
    xi = np.asarray(xi, dtype=float)
    beta = np.asarray(beta, dtype=float)
    T = len(xi)
    S = np.empty(T)
    I = np.empty(T)
    C = np.empty(T)
    s, i = float(S0), float(I0)
    h = 1.0 / substeps

    def f(s_, i_, k_):
        inf = k_ * s_ * i_ / N
        return -inf, inf - gamma * i_, inf

    for t in range(T):
        S[t], I[t] = s, i
        k = xi[t] * beta[t]
        new = 0.0
        for _ in range(substeps):
            a1 = f(s, i, k)
            a2 = f(s + h / 2 * a1[0], i + h / 2 * a1[1], k)
            a3 = f(s + h / 2 * a2[0], i + h / 2 * a2[1], k)
            a4 = f(s + h * a3[0], i + h * a3[1], k)
            s += h / 6 * (a1[0] + 2 * a2[0] + 2 * a3[0] + a4[0])
            i += h / 6 * (a1[1] + 2 * a2[1] + 2 * a3[1] + a4[1])
            new += h / 6 * (a1[2] + 2 * a2[2] + 2 * a3[2] + a4[2])
        C[t] = new
    return {"S": S, "I": I, "C": C, "Rt": reproduction_number(xi, beta, S, N, gamma)}


def simulate_stochastic(xi, beta, N: int, I0: int, rng: np.random.Generator, gamma: float = GAMMA,
                        rho: float = 1.0, k_obs: float = 30.0, R0_immune: int = 0):
    """일 단위(Euler, dt=1) 확률 SIR. 신규감염 ~ Poisson(xi beta S I / N), 회복 ~ Binomial(I, gamma),
    관측 ~ 음이항(평균 rho*C, 산포 k). 기대 성장배율이 1 + gamma (R_t - 1) 이므로 R_t = 1 이 곧 증감의 경계다."""
    xi = np.asarray(xi, dtype=float)
    beta = np.asarray(beta, dtype=float)
    T = len(xi)
    S = np.empty(T)
    I = np.empty(T)
    C = np.empty(T)
    y = np.empty(T, dtype=int)
    s, i = N - I0 - R0_immune, I0
    p_rec = gamma
    for t in range(T):
        S[t], I[t] = s, i
        lam = xi[t] * beta[t] * s * i / N
        c = min(rng.poisson(lam), s)
        r = rng.binomial(i, p_rec)
        C[t] = c
        mu = max(rho * c, 0.5)
        # numpy 음이항: 성공확률 p = k/(k+mu) 이면 평균 mu, 분산 mu + mu^2/k
        y[t] = rng.negative_binomial(k_obs, k_obs / (k_obs + mu))
        s, i = s - c, i + c - r
    return {"S": S, "I": I, "C": C, "y": y, "Rt": reproduction_number(xi, beta, S, N, gamma)}


def simulate_discrete(xi, beta, S0: float, I0: float, N: float, gamma: float = GAMMA):
    """입자필터 전이식의 결정론적 판(기댓값 경로). 시나리오 재계산에 쓴다."""
    xi = np.asarray(xi, dtype=float)
    beta = np.asarray(beta, dtype=float)
    T = len(xi)
    S, I, C = np.empty(T), np.empty(T), np.empty(T)
    s, i = float(S0), float(I0)
    for t in range(T):
        S[t], I[t] = s, i
        c = min(xi[t] * beta[t] * s * i / N, s)
        C[t] = c
        s, i = s - c, i + c - gamma * i
    return {"S": S, "I": I, "C": C, "Rt": reproduction_number(xi, beta, S, N, gamma)}


def log_decomposition(xi, beta, s_frac):
    """log R_t = log xi + log beta + log(S/N) - log gamma.

    주(7일) 평균 로그값의 변화량을 이동성·고유전파력·감수성 고갈의 기여로 나눈다.
    모형 안의 회계 항등식이며 인과효과 분해가 아니다.
    """
    lx, lb, ls = np.log(xi), np.log(beta), np.log(s_frac)
    return {"log_xi": lx, "log_beta": lb, "log_s": ls}


def scenario_metrics(C, Rt) -> dict:
    """정점 규모·시점, 누적 감염, R_t>1 일수(D), 초과 전파 면적(E)."""
    C = np.asarray(C, dtype=float)
    Rt = np.asarray(Rt, dtype=float)
    return {
        "peak": float(C.max()),
        "peak_day": int(C.argmax()),
        "cumulative": float(C.sum()),
        "days_rt_gt_1": int((Rt > 1).sum()),
        "excess_area": float(np.clip(Rt - 1, 0, None).sum()),
    }


def final_size(R0: float, tol: float = 1e-12) -> float:
    """상수 R0 인 SIR 의 최종 발병률 z:  1 - z = exp(-R0 z)."""
    if R0 <= 1:
        return 0.0
    z = 0.5
    for _ in range(200):
        g = 1 - z - np.exp(-R0 * z)
        dg = -1 + R0 * np.exp(-R0 * z)
        z_new = z - g / dg
        if abs(z_new - z) < tol:
            return float(z_new)
        z = z_new
    return float(z)
