"""공공데이터 원본을 웹 업로드용 CSV(date, boardings, cases)로 바꾼다.

1) 부산교통공사_시간대별 승하차인원 (data.go.kr/data/3057229)
   일자·역·구분(승차/하차)·시간대별 인원 → '승차' 행만 골라 일별 합계 X(t)
2) 국민건강보험공단 감염성질환(인플루엔자) 의료이용정보 (data.go.kr/data/15089429)
   진료일·지역·건수 → 부산 지역 일별 건수 y_t

원본 열 이름은 연도별로 조금씩 달라서, 이름 후보로 자동 인식하고 실패하면 --*-col 인자로 지정한다.
결측일은 0 으로 채우지 않고 비워 둔다(웹 엔진은 결측 관측을 가중치 갱신에서 건너뛴다).

예)
  python analysis/prepare_inputs.py --metro 부산교통공사_2025.csv --nhis 인플루엔자_의료이용.csv \
         --region 부산 --start 2025-09-01 --end 2026-08-31 --out busan_2025_26.csv
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path

import pandas as pd

DATE_CANDIDATES = ["date", "일자", "년월일", "날짜", "운행일자", "진료일", "진료일자", "기준일자"]
TYPE_CANDIDATES = ["구분", "승하차구분", "승하차", "type"]
REGION_CANDIDATES = ["지역", "시도", "시도명", "region"]
COUNT_CANDIDATES = ["건수", "환자수", "진료건수", "count", "cases"]


def read_any(path: Path) -> pd.DataFrame:
    for enc in ("utf-8-sig", "cp949", "euc-kr"):
        try:
            return pd.read_csv(path, encoding=enc)
        except UnicodeDecodeError:
            continue
    raise ValueError(f"인코딩을 인식하지 못했습니다: {path}")


def pick(df: pd.DataFrame, candidates, given=None) -> str:
    if given:
        return given
    cols = {c.strip(): c for c in df.columns}
    for c in candidates:
        if c in cols:
            return cols[c]
    for c in df.columns:
        if any(k in str(c) for k in candidates):
            return c
    raise KeyError(f"열을 찾지 못했습니다. 후보: {candidates}, 실제: {list(df.columns)}")


def to_date(s: pd.Series) -> pd.Series:
    s = s.astype(str).str.replace(r"[^0-9]", "", regex=True).str[:8]
    return pd.to_datetime(s, format="%Y%m%d", errors="coerce")


def metro_daily(path: Path, date_col=None, type_col=None) -> pd.Series:
    df = read_any(path)
    dc, tc = pick(df, DATE_CANDIDATES, date_col), pick(df, TYPE_CANDIDATES, type_col)
    df = df[df[tc].astype(str).str.contains("승차")]
    hour_cols = [c for c in df.columns if re.search(r"\d{1,2}\s*시", str(c))]
    if "합계" in df.columns:
        val = pd.to_numeric(df["합계"], errors="coerce")
    elif hour_cols:
        val = df[hour_cols].apply(pd.to_numeric, errors="coerce").sum(axis=1, min_count=1)
    else:
        raise KeyError("시간대별 인원 열(예: '01시-02시')이나 '합계' 열이 필요합니다.")
    out = val.groupby(to_date(df[dc])).sum(min_count=1)
    out.index.name = "date"
    return out.rename("boardings")


def nhis_daily(path: Path, region: str, date_col=None, region_col=None, count_col=None) -> pd.Series:
    df = read_any(path)
    dc = pick(df, DATE_CANDIDATES, date_col)
    rc = pick(df, REGION_CANDIDATES, region_col)
    cc = pick(df, COUNT_CANDIDATES, count_col)
    df = df[df[rc].astype(str).str.contains(region)]
    out = pd.to_numeric(df[cc], errors="coerce").groupby(to_date(df[dc])).sum(min_count=1)
    out.index.name = "date"
    return out.rename("cases")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--metro", type=Path, required=True)
    ap.add_argument("--nhis", type=Path, required=True)
    ap.add_argument("--region", default="부산")
    ap.add_argument("--start")
    ap.add_argument("--end")
    ap.add_argument("--out", type=Path, default=Path("mobility_sir_input.csv"))
    ap.add_argument("--metro-date-col"), ap.add_argument("--metro-type-col")
    ap.add_argument("--nhis-date-col"), ap.add_argument("--nhis-region-col"), ap.add_argument("--nhis-count-col")
    a = ap.parse_args()

    X = metro_daily(a.metro, a.metro_date_col, a.metro_type_col)
    y = nhis_daily(a.nhis, a.region, a.nhis_date_col, a.nhis_region_col, a.nhis_count_col)
    df = pd.concat([X, y], axis=1)
    lo = pd.Timestamp(a.start) if a.start else df.index.min()
    hi = pd.Timestamp(a.end) if a.end else df.index.max()
    df = df.reindex(pd.date_range(lo, hi, freq="D"))
    df.index.name = "date"
    df.reset_index().assign(date=lambda d: d["date"].dt.strftime("%Y-%m-%d")).to_csv(a.out, index=False)
    print(f"{a.out}: {len(df)}일, 승차 결측 {df['boardings'].isna().sum()}일, 의료이용 결측 {df['cases'].isna().sum()}일")


if __name__ == "__main__":
    main()
