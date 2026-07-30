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
import requests

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


def date_already_exists(date_str: str) -> bool:
    """해당 날짜에 '공휴일' 체크박스가 켜진 페이지가 이미 있는지 확인한다.

    (단순히 그 날짜에 다른 일정/할일이 있다는 이유로 건너뛰지 않도록,
    공휴일 여부까지 필터링한다.)
    """
    url = f"{NOTION_API}/databases/{SCHEDULE_DB_ID}/query"
    payload = {
        "filter": {
            "and": [
                {"property": "날짜", "date": {"equals": date_str}},
                {"property": "공휴일", "checkbox": {"equals": True}},
            ]
        }
    }
    resp = requests.post(url, headers=HEADERS, json=payload)
    resp.raise_for_status()
    return len(resp.json().get("results", [])) > 0


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
    resp = requests.post(url, headers=HEADERS, json=payload)
    resp.raise_for_status()


def main():
    year = datetime.now(KST).year
    holiday_list = fetch_holidays(year)
    added = 0
    for date_str, name in holiday_list:
        if not date_already_exists(date_str):
            create_holiday_page(date_str, name)
            added += 1
            print(f"추가됨: {date_str} {name}")
    print(f"완료. 총 {len(holiday_list)}개 중 {added}개 신규 추가.")


if __name__ == "__main__":
    main()
