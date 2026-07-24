"""
매일 08:00(KST)에 실행되어 노션의 [일정] / [소설] 캘린더를 확인하고
docs/today.json으로 정리해서 저장하는 스크립트.
GitHub Pages로 서비스되는 PWA(docs/index.html)가 이 파일을 읽어서 화면에 보여준다.

필요한 환경변수(GitHub Actions Secrets로 설정):
- NOTION_TOKEN        : 노션 Integration 토큰
- SCHEDULE_DB_ID       : [일정] 데이터베이스 ID
- NOVEL_DB_ID          : [소설] 데이터베이스 ID
"""

import json
import os
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests

NOTION_TOKEN = os.environ["NOTION_TOKEN"]
SCHEDULE_DB_ID = os.environ["SCHEDULE_DB_ID"]
NOVEL_DB_ID = os.environ["NOVEL_DB_ID"]

NOTION_API = "https://api.notion.com/v1"
HEADERS = {
    "Authorization": f"Bearer {NOTION_TOKEN}",
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
}

KST = timezone(timedelta(hours=9))
TODAY_JSON_PATH = Path(__file__).parent / "docs" / "today.json"


def today_kst() -> datetime:
    return datetime.now(KST)


def query_database(database_id: str, date_str: str) -> list:
    """해당 날짜(date_str, YYYY-MM-DD)에 해당하는 페이지들을 모두 가져온다."""
    url = f"{NOTION_API}/databases/{database_id}/query"
    payload = {"filter": {"property": "날짜", "date": {"equals": date_str}}}
    results = []
    while True:
        resp = requests.post(url, headers=HEADERS, json=payload)
        resp.raise_for_status()
        data = resp.json()
        results.extend(data.get("results", []))
        if not data.get("has_more"):
            break
        payload["start_cursor"] = data["next_cursor"]
    return results


def get_title(page: dict, prop_name: str = "이름") -> str:
    prop = page["properties"].get(prop_name, {})
    title_parts = prop.get("title", [])
    return "".join(t.get("plain_text", "") for t in title_parts) or "(제목 없음)"


def get_select(page: dict, prop_name: str) -> str:
    prop = page["properties"].get(prop_name, {})
    select = prop.get("select")
    return select["name"] if select else ""


def get_checkbox(page: dict, prop_name: str) -> bool:
    prop = page["properties"].get(prop_name, {})
    return bool(prop.get("checkbox"))


def get_time(page: dict, prop_name: str = "날짜") -> str:
    """날짜 속성에 시간이 함께 입력되어 있으면 'HH:MM'을, 없으면 빈 문자열을 반환."""
    date_info = page["properties"].get(prop_name, {}).get("date") or {}
    start = date_info.get("start") or ""
    if "T" in start:
        return start.split("T", 1)[1][:5]
    return ""


def build_routine_lines(weekday: int) -> list:
    """weekday: 월=0 ... 일=6. 월/수/금은 운동, 그 외는 3차 작업으로 대체."""
    slot_21_22 = "21~22 - 운동" if weekday in (0, 2, 4) else "21~22 - 3차 작업"
    return [
        "08시 - 기상",
        "08~09 - 아침 식사",
        "09~11 - 1차 집필",
        "11~13 - 1차 작업",
        "13~14 - 점심 식사",
        "14~16 - 2차 집필",
        "16~18 - 2차 작업",
        "18~19 - 저녁 식사",
        "19~21 - 3차 집필",
        slot_21_22,
        "22~00 - 휴식",
        "취침 - 00:15 또는 01:45",
    ]


def build_today_data(date_str: str, weekday: int, schedule_pages: list, novel_pages: list) -> dict:
    holiday_pages = [p for p in schedule_pages if get_checkbox(p, "공휴일")]
    schedule_only = [p for p in schedule_pages if get_select(p, "종류") == "일정"]
    todo_pages = [p for p in schedule_pages if get_select(p, "종류") in ("할일", "과제")]

    holiday_banner = None
    if holiday_pages:
        names = ", ".join(get_title(p) for p in holiday_pages)
        holiday_banner = f"오늘은 공휴일입니다: {names}"

    if schedule_only:
        schedule_items = []
        for p in schedule_only:
            time_str = get_time(p)
            title = get_title(p)
            schedule_items.append(f"{time_str} {title}" if time_str else title)
    else:
        schedule_items = build_routine_lines(weekday)

    todo_items = []
    for p in todo_pages:
        kind = get_select(p, "종류")
        time_str = get_time(p)
        title = get_title(p)
        prefix = f"[{kind}] {time_str}" if time_str else f"[{kind}]"
        todo_items.append(f"{prefix} {title}")

    novel_items = []
    for p in novel_pages:
        work = get_select(p, "작품")
        kind = get_select(p, "유형")
        time_str = get_time(p)
        title = get_title(p)
        body_text = f"{time_str} {title}" if time_str else title
        novel_items.append(f"[{work}] {kind} - {body_text}")

    return {
        "date": date_str,
        "holiday_banner": holiday_banner,
        "schedule_title": "오늘의 일정",
        "schedule_items": schedule_items,
        "todo_items": todo_items,
        "novel_items": novel_items,
        "novel_empty_message": "오늘은 등록된 소설 일정이 없습니다.",
    }


def write_today_json(data: dict) -> None:
    TODAY_JSON_PATH.write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def main():
    now = today_kst()
    date_str = now.strftime("%Y-%m-%d")
    weekday = now.weekday()  # 월=0 ... 일=6

    schedule_pages = query_database(SCHEDULE_DB_ID, date_str)
    novel_pages = query_database(NOVEL_DB_ID, date_str)

    data = build_today_data(date_str, weekday, schedule_pages, novel_pages)
    write_today_json(data)
    print("today.json 갱신 완료:", date_str)


if __name__ == "__main__":
    main()
