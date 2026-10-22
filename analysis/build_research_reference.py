"""선행연구에 보고된 실제자료 분석값을 웹에서 쓰는 JSON 으로 정리한다.

값은 새로 계산하지 않고 원고·저장소에 보고된 수치를 옮긴다.
  [P] Shin J, Ahn S, Kim M (2026). A mobility-informed SIR model for regional transmission dynamics:
      Evidence from subway mobility data in Korea, 2016-2023. 연구원고.
  [R] github.com/jaewansh/KMOU-A-mobility-informed-SIR-model, results/tables/scenario_summary_reference.csv
실행:  python analysis/build_research_reference.py
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "data" / "research_reference.json"
SCENARIO_CSV = Path(__file__).resolve().parent / "reference" / "scenario_summary_reference.csv"

CITY_KO = {"Seoul": "서울", "Busan": "부산", "Daegu": "대구", "Daejeon": "대전", "Gwangju": "광주"}


def load_scenarios():
    rows = []
    with SCENARIO_CSV.open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            rows.append({
                "city": r["city"], "city_ko": CITY_KO[r["city"]], "scenario": r["scenario"],
                "mean_Rt": float(r["mean_Rt"]), "delta_mean_Rt": float(r["delta_mean_Rt"]),
                "mean_reduction_percent": float(r["mean_reduction_percent"]),
                "days_Rt_gt_1": int(r["days_Rt_gt_1"]), "days_reduction_percent": float(r["days_reduction_percent"]),
                "excess_area": float(r["excess_area"]),
            })
    return rows


def main():
    data = {
        "source_note": "선행연구 원고·보충자료·공개 저장소에 보고된 실제자료 분석값(재계산 없음).",
        "study": {
            "cities": ["서울", "부산", "대구", "대전", "광주"],
            "seasons": ["2016-09-01~2017-08-31", "2017-09-01~2018-08-31", "2018-09-01~2019-08-31",
                        "2022-09-01~2023-08-31"],
            "diagnosis_codes": ["J09", "J10", "J11"],
            "gamma_inv_days": 4.1,
            "theta_main": 0.5,
            "source": "[P] §2.1-2.2, Table 1, p.3-5",
        },
        "busan_xi_by_theta": {
            "rows": [
                {"theta": 0.01, "mean": 1.0055, "variance": 0.0037, "sd": 0.0606, "min": 0.7082, "max": 1.1011},
                {"theta": 0.5, "mean": 1.3139, "variance": 0.0063, "sd": 0.0792, "min": 0.9255, "max": 1.4389},
                {"theta": 1.0, "mean": 1.7263, "variance": 0.0108, "sd": 0.1041, "min": 1.2160, "max": 1.8905},
            ],
            "source": "[P] Table 2, p.12",
        },
        "synthetic_validation": {
            "horizon_days": 100, "population": 10_000_000, "xi": 1.0, "observation": "negative binomial",
            "pf_rmse": 0.10888, "ps_rmse": 0.02947, "reduction_percent": 72.9,
            "source": "[P] §6.1 p.11-12, 보충자료 Figure S1",
        },
        "gls_validation": {
            "outcome": "주별 log(R_t)", "lags_weeks": [1, 2], "correlation": "CAR(1)",
            "LRT": 10.22, "bootstrap_p": 0.0065, "bootstrap_B": 1999,
            "source": "[P] §5, Table 3, p.9-10, 16",
            "caution": "조건부 적합도 비교이며 인과효과 증명이 아님",
        },
        "population_denominators_2016_2017": {
            "서울": 22689358.5, "부산": 3484591, "대구": 2479894, "대전": 1508298.5, "광주": 1466492,
            "source": "[R] data/population_denominators_2016_2017.csv",
        },
        "scenarios": {
            "rows": load_scenarios(),
            "definition": "R_c(t) = (1-r) xi(t) beta(t) S(t) / (gamma N), 4개 절기 일별값 합산. D_c = #{R_c>1}, E_c = sum max(R_c-1,0)",
            "source": "[R] results/tables/scenario_summary_reference.csv (원고 보충표 전사본)",
            "caution": "beta(t)·S(t)를 고정한 정적 반사실 계산이며 감염 감소 효과의 인과 추정이 아님",
        },
        "key_findings": [
            {"text": "이동성이 높은 지역일수록 정점 R_t 가 더 크고 날카롭다", "source": "[P] p.13-15"},
            {"text": "R_t 의 지역 간 편차 상당 부분이 이동성에서 비롯되고, 이동성 보정 beta(t)는 지역 간 변동이 크게 줄어든다", "source": "[P] p.15, Figure 5"},
            {"text": "1·2주 시차 이동성 항이 모형 적합도를 유의하게 개선한다 (LRT 10.22, p=0.0065)", "source": "[P] Table 3, p.16"},
            {"text": "시차 효과는 잠복기와 행동 반응의 결합으로 해석된다", "source": "[P] p.18"},
            {"text": "이동성은 전파를 일률적으로 키우는 주동인이 아니라 맥락 의존적 조절인자다", "source": "[P] p.17-18"},
        ],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print("wrote", OUT, len(data["scenarios"]["rows"]), "scenario rows")


if __name__ == "__main__":
    main()
