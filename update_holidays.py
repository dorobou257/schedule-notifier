"""
매년 1회(예: 1월 2일) 실행되어, 파이썬 holidays 라이브러리로 실행 시점 기준
한국 시각(KST)의 그 해 대한민국 공휴일을 계산해 노션 [일정] DB에 채워 넣는
스크립트.

필요한 환경변수(GitHub Actions Secrets):
- NOTION_TOKEN
- SCHEDULE_DB_ID

공공데이터포털 API와 달리 별도 활용신청/인증키 없이,
holidays 라이브러리가 로컬에서 계산한 값을 그대로 사용한다.
"""

import os
from datetime import datetime, timezone, timedelta

import holidays

from notion_http import post_with_retry

# notify.py도 같은 상수를 쓰지만, 이 스크립트는 GitHub Actions Secrets로
# NOTION_TOKEN/SCHEDULE_DB_ID만 받고 NOVEL_DB_ID/NTFY_TOPIC은 없으므로
# (notify.py를 import하면 모듈 최상단에서 그 값들을 요구해 실패한다)
# 이 한 줄만 따로 정의한다.
KST = timezone(timedelta(hours=9))

NOTION_TOKEN = os.environ["NOTION_TOKEN"]
SCHEDULE_DB_ID = os.environ["SCHEDULE_DB_ID"]

NOTION_API = "https://api.notion.com/v1"
HEADERS = {
    "Authorization": f"Bearer {NOTION_TOKEN}",
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
}


def fetch_holidays(year: int) -> list:
    """해당 연도의 공휴일 목록을 [(YYYY-MM-DD, 이름), ...] 형태로 반환."""
    kr_holidays = holidays.KR(years=year, language="ko")
    return sorted((d.isoformat(), name) for d, name in kr_holidays.items())


def existing_holiday_dates(year: int) -> set:
    """그 해에 이미 등록된 공휴일 페이지들의 날짜 집합.

    공휴일마다 한 번씩(연 15~20회) 물어보던 것을 한 해 범위 한 번으로 줄였다.
    '공휴일' 체크박스까지 걸러서, 단순히 그 날짜에 다른 일정/할일이 있다는
    이유로 건너뛰는 일은 없게 한다.

    날짜 범위는 앞뒤로 하루씩 넉넉히 잡고 원본 문자열로 다시 거른다 —
    노션 date 필터가 UTC로 비교해서 한국 오전 시각이 하루 밀리기 때문이다
    (notify.py / worker의 queryRange와 같은 이유, 같은 방식).
    """
    url = f"{NOTION_API}/databases/{SCHEDULE_DB_ID}/query"
    payload = {
        "filter": {
            "and": [
                {"property": "날짜", "date": {"on_or_after": f"{year - 1}-12-31"}},
                {"property": "날짜", "date": {"before": f"{year + 1}-01-02"}},
                {"property": "공휴일", "checkbox": {"equals": True}},
            ]
        }
    }
    dates = set()
    while True:
        resp = post_with_retry(url, headers=HEADERS, json=payload, label="노션 조회")
        data = resp.json()
        for p in data.get("results", []):
            start = ((p.get("properties", {}).get("날짜") or {}).get("date") or {}).get("start") or ""
            if start[:4] == str(year):
                dates.add(start[:10])
        if not data.get("has_more"):
            return dates
        payload["start_cursor"] = data["next_cursor"]


def create_holiday_page(date_str: str, name: str) -> None:
    url = f"{NOTION_API}/pages"
    payload = {
        "parent": {"database_id": SCHEDULE_DB_ID},
        "properties": {
            "이름": {"title": [{"text": {"content": name}}]},
            "날짜": {"date": {"start": date_str}},
            "종류": {"select": {"name": "공휴일"}},
            "공휴일": {"checkbox": True},
        },
    }
    # 페이지를 "만드는" 요청이라 조회와 다르게 다룬다. 타임아웃은 안 만들어진
    # 것이 아니라 만들어졌는지 모르는 것이어서, 다시 보내면 같은 공휴일이 두 개
    # 생길 수 있다. 속도 제한(429)은 노션이 분명하게 거절한 것이므로 그때만
    # 다시 보낸다 — 공휴일이 15~20개씩 연달아 들어가니 실제로 걸릴 수 있다.
    post_with_retry(
        url,
        headers=HEADERS,
        json=payload,
        retry_statuses=(429,),
        retry_on_network_error=False,
        label="공휴일 등록",
    )


def main():
    year = datetime.now(KST).year
    holiday_list = fetch_holidays(year)
    already = existing_holiday_dates(year)  # 조회는 한 번이면 된다
    added = 0
    for date_str, name in holiday_list:
        if date_str not in already:
            create_holiday_page(date_str, name)
            already.add(date_str)  # 같은 날 공휴일이 둘이어도 한 번만 만든다
            added += 1
            print(f"추가됨: {date_str} {name}")
    print(f"완료. 총 {len(holiday_list)}개 중 {added}개 신규 추가.")


if __name__ == "__main__":
    main()
