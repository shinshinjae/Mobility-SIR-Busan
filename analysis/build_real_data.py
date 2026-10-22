"""부산 실제자료 시즌 데이터를 만든다 (공공데이터 원본 → docs/data/busan_real.json).

입력(공공데이터, 연구팀 보관본):
  --nhis   국민건강보험공단_감염성질환(인플루엔자) 의료이용정보_20241231.xlsx  (data.go.kr 15089429)
           시트 '외래입원주부상병', 시도코드 26(부산), 요양개시일 기준 일별 진료에피소드 수
  --metro  {busan,seoul&g,daegu,daejeon,gwangju}_metro.csv 가 있는 폴더 (date, people_in)
  --pop    201612_202512_주민등록인구및세대현황_연간.csv (행정안전부)
처리:
  - 시즌 인구 N = 시즌이 걸친 두 해 연말 인구의 평균 (선행연구와 같은 정의)
  - L_i = 시즌 평균 1인당 승차, L_ref = 5개 도시 L_i 평균, xi = (L/L_ref)^theta * b(t)
  - b(t): 연구용 중심 7일 평균(xi), 운영용 후행 7일 평균(xi_rt)
실행:
  python analysis/build_real_data.py --nhis <xlsx> --metro <dir> --pop <csv>
"""
from __future__ import annotations

import argparse
import io
import json
from pathlib import Path

import numpy as np
import pandas as pd

from msir import moving_average

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "data" / "busan_real.json"
THETA = 0.5
# 질병관리청 유행주의보 발령일(효력일)·유행기준 — 질병관리청 보도자료 원문 확인(2026.10.22.)
ADVISORY = {
    "2016-17": ("2016-12-08", 8.9, "https://www.kdca.go.kr/bbs/kdca/42/210727/artclView.do"),
    "2017-18": ("2017-12-01", 6.6, "https://www.kdca.go.kr/bbs/kdca/42/210943/artclView.do"),
    "2018-19": ("2018-11-16", 6.3, "https://www.kdca.go.kr/bbs/kdca/42/211190/artclView.do"),
    "2022-23": ("2022-09-16", 4.9, "https://www.kdca.go.kr/bbs/kdca/42/213938/artclView.do"),
    "2023-24": ("2023-09-15", 6.5, "https://www.kdca.go.kr/bbs/kdca/42/214519/artclView.do"),
    "2024-25": ("2024-12-20", 8.6, "https://www.kdca.go.kr/bbs/kdca/42/215129/artclView.do"),
}
SEASONS = [
    ("2016-17", "2016-09-01", "2017-08-31"),
    ("2017-18", "2017-09-01", "2018-08-31"),
    ("2018-19", "2018-09-01", "2019-08-31"),
    ("2022-23", "2022-09-01", "2023-08-31"),
    ("2023-24", "2023-09-01", "2024-08-31"),
    ("2024-25", "2024-09-01", "2024-12-31"),   # 공개 원본이 2024.12.31.까지
]
CITIES = {"busan": ["부산광역시"], "seoul&g": ["서울특별시", "경기도"], "daegu": ["대구광역시"],
          "daejeon": ["대전광역시"], "gwangju": ["광주광역시"]}


def read_pop(path: Path) -> dict:
    raw = path.read_bytes()
    for enc in ("utf-8-sig", "cp949"):
        try:
            df = pd.read_csv(io.StringIO(raw.decode(enc)))
            break
        except UnicodeDecodeError:
            continue
    out = {}
    for key, names in CITIES.items():
        rows = df[df["행정구역"].apply(lambda s: any(s.startswith(n) for n in names))]
        out[key] = {y: int(rows[f"{y}년_총인구수"].astype(str).str.replace(",", "").astype(int).sum()) for y in range(2016, 2026)}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--nhis", type=Path, required=True)
    ap.add_argument("--metro", type=Path, required=True)
    ap.add_argument("--pop", type=Path, required=True)
    a = ap.parse_args()

    nh = pd.read_excel(a.nhis, sheet_name="외래입원주부상병", dtype={"주소(시도)": str})
    bus = nh[nh["주소(시도)"] == "26"]
    daily = bus.groupby("요양개시일자")["진료에피소드 건수"].sum()
    daily.index = pd.to_datetime(daily.index)
    age = bus.groupby(["요양개시일자", "연령군"])["진료에피소드 건수"].sum().unstack(fill_value=0)
    age.index = pd.to_datetime(age.index)

    metro = {k: pd.read_csv(a.metro / f"{k}_metro.csv", parse_dates=["date"]).set_index("date")["people_in"] for k in CITIES}
    pop = read_pop(a.pop)

    # 유행 기준선 τ: 직전 3개 절기에서 7일 평균이 그 절기 중앙값 이하인 날(비유행기)의 평균 + 2SD
    full = daily.reindex(pd.date_range("2006-01-01", daily.index.max(), freq="D")).fillna(0)
    ma7 = full.rolling(7).mean()

    def tau_for(year):
        pooled = []
        for yy in range(year - 3, year):
            seg = ma7[f"{yy}-09-01":f"{yy + 1}-08-31"]
            pooled.append(seg[seg <= seg.median()])
        seg = pd.concat(pooled)
        return round(float(seg.mean() + 2 * seg.std()), 1)

    seasons = []
    for name, s, e in SEASONS:
        idx = pd.date_range(s, e, freq="D")
        y0, y1 = idx[0].year, idx[-1].year if idx[-1].year != idx[0].year else idx[0].year + 1
        N = {k: (pop[k][y0] + pop[k][y1]) / 2 for k in CITIES}
        L = {}
        for k in CITIES:
            x = metro[k].reindex(idx)
            if x.notna().sum() > 0.8 * len(idx):
                L[k] = float((x / N[k]).mean())
        L_ref = float(np.mean(list(L.values())))
        X = metro["busan"].reindex(idx).astype(float)
        m = X / N["busan"]
        c = (m / L["busan"]).to_numpy()
        ratio = L["busan"] / L_ref
        xi = ratio ** THETA * moving_average(c, 7, "centered")
        xi_rt = ratio ** THETA * moving_average(c, 7, "trailing")
        y = daily.reindex(idx).fillna(0).astype(int)
        ag = age.reindex(idx).fillna(0).astype(int)
        seasons.append({
            "season": name, "start": s, "end": e, "N": round(N["busan"]),
            "L_ratio": round(ratio, 4), "cities_in_Lref": sorted(L),
            "dates": [d.strftime("%Y-%m-%d") for d in idx],
            "boardings": [None if np.isnan(v) else int(v) for v in X],
            "xi": [round(float(v), 6) for v in xi], "xi_rt": [round(float(v), 6) for v in xi_rt],
            "cases": y.tolist(),
            "age": {str(col): ag[col].tolist() for col in ag.columns},
            "summary": {"total": int(y.sum()), "peak": int(y.max()), "peak_date": y.idxmax().strftime("%Y-%m-%d")},
            "tau": tau_for(int(s[:4])),
            "advisory": {"date": ADVISORY[name][0], "ili_threshold": ADVISORY[name][1], "source": ADVISORY[name][2]},
        })
        print(name, "N", round(N["busan"]), "L/Lref", round(ratio, 4), "cities", len(L), "cases", int(y.sum()), "peak", int(y.max()), y.idxmax().date())

    data = {
        "meta": {
            "title": "부산 실제자료(후향 재현)",
            "synthetic": False,
            "sources": {
                "cases": "국민건강보험공단 감염성질환(인플루엔자) 의료이용정보(2006.1.–2024.12.), 외래입원 주부상병, 부산(시도코드 26), 요양개시일 기준 일별 진료에피소드 수 — data.go.kr/data/15089429",
                "boardings": "부산교통공사 시간대별 승하차인원(승차 일별 합계) — data.go.kr/data/3057229, 연구팀 정제본",
                "population": "행정안전부 주민등록 인구(연말), 시즌 인구 = 두 해 평균",
                "L_ref": "서울·경기, 부산, 대구, 대전, 광주 도시철도 승차 기준 평균 이동수준",
                "tau": "직전 3개 절기 비유행기(7일 평균이 절기 중앙값 이하인 날)의 평균 + 2SD — 질병관리청 유행기준 산식을 청구자료에 맞게 단순화",
                "advisory": "질병관리청 인플루엔자 유행주의보 보도자료(발령 효력일)",
            },
            "theta": THETA,
            "note": "공개 원본은 연 1회 갱신되므로 이 화면은 과거 시즌을 하루씩 따라가며 재현한 후향 분석이다.",
        },
        "seasons": seasons,
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("wrote", OUT, round(OUT.stat().st_size / 1024), "KB")


if __name__ == "__main__":
    main()
