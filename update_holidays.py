"""
매년 1회(예: 1월 2일) 실행되어, 한국천문연구원 특일 정보 API(공공데이터포털)를 조회해
앞으로 1년치 대한민국 공휴일을 노션 [일정] DB에 채워 넣는 스크립트.

필요한 환경변수(GitHub Actions Secrets):
- NOTION_TOKEN
- SCHEDULE_DB_ID
- HOLIDAY_API_KEY   : 공공데이터포털에서 발급받은 "한국천문연구원_특일 정보" 인증키(디코딩된 값)

참고: 이 API는 보통 향후 1년 치 정도의 확정된 공휴일만 제공합니다.
      매년 초에 이 스크립트를 실행하면 그 해 공휴일이 자동으로 채워집니다.
"""

import os
from datetime import datetime

import requests

NOTION_TOKEN = os.environ["NOTION_TOKEN"]
SCHEDULE_DB_ID = os.environ["SCHEDULE_DB_ID"]
HOLIDAY_API_KEY = os.environ["HOLIDAY_API_KEY"]

NOTION_API = "https://api.notion.com/v1"
HEADERS = {
    "Authorization": f"Bearer {NOTION_TOKEN}",
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
}

HOLIDAY_API_URL = (
    "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getHoliDeInfo"
)


def fetch_holidays(year: int) -> list:
    """해당 연도의 공휴일 목록을 [(YYYYMMDD, 이름), ...] 형태로 반환."""
    holidays = []
    for month in range(1, 13):
        params = {
            "serviceKey": HOLIDAY_API_KEY,
            "solYear": year,
            "solMonth": f"{month:02d}",
            "_type": "json",
            "numOfRows": "30",
        }
        resp = requests.get(HOLIDAY_API_URL, params=params)
        resp.raise_for_status()
        data = resp.json()
        items = (
            data.get("response", {})
            .get("body", {})
            .get("items", {})
            .get("item", [])
        )
        if isinstance(items, dict):
            items = [items]
        for item in items:
            # isHoliday: "Y"인 것만 실제 공휴일
            if item.get("isHoliday") == "Y":
                holidays.append((str(item["locdate"]), item["dateName"]))
    return holidays


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
            "종류": {"select": {"name": "일정"}},
            "공휴일": {"checkbox": True},
        },
    }
    resp = requests.post(url, headers=HEADERS, json=payload)
    resp.raise_for_status()


def main():
    year = datetime.now().year
    holidays = fetch_holidays(year)
    added = 0
    for locdate, name in holidays:
        date_str = f"{locdate[0:4]}-{locdate[4:6]}-{locdate[6:8]}"
        if not date_already_exists(date_str):
            create_holiday_page(date_str, name)
            added += 1
            print(f"추가됨: {date_str} {name}")
    print(f"완료. 총 {len(holidays)}개 중 {added}개 신규 추가.")


if __name__ == "__main__":
    main()
