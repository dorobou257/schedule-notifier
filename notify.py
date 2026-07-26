"""
하루 한 번(아침 8시) 실행되어 노션의 [일정] / [소설] 캘린더를 확인하고
docs/today.json으로 정리해서 저장하는 스크립트.
GitHub Pages로 서비스되는 PWA(docs/index.html)가 이 파일을 읽어서 화면에 보여준다.

동시에 오늘 하루치 일정/할일/소설 목록을 하나로 요약해서 ntfy.sh로 푸시
알림을 한 번 보낸다. 같은 날 스크립트가 다시 실행돼도(수동 재실행 등)
이미 보냈으면 today.json에 기록된 걸 보고 중복 발송하지 않는다.

필요한 환경변수(GitHub Actions Secrets로 설정):
- NOTION_TOKEN   : 노션 Integration 토큰
- SCHEDULE_DB_ID : [일정] 데이터베이스 ID
- NOVEL_DB_ID    : [소설] 데이터베이스 ID
- NTFY_TOPIC     : ntfy.sh 구독 토픽 이름 (추측 불가능한 랜덤 문자열이어야 함 —
                    ntfy.sh는 공개 서버라 토픽 이름만 알면 누구나 구독/발행 가능)
"""

import json
import os
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests

NOTION_TOKEN = os.environ["NOTION_TOKEN"]
SCHEDULE_DB_ID = os.environ["SCHEDULE_DB_ID"]
NOVEL_DB_ID = os.environ["NOVEL_DB_ID"]
NTFY_TOPIC = os.environ["NTFY_TOPIC"]

NOTION_API = "https://api.notion.com/v1"
HEADERS = {
    "Authorization": f"Bearer {NOTION_TOKEN}",
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
}

NTFY_API = "https://ntfy.sh/"
APP_URL = "https://dorobou257.github.io/schedule-notifier/"

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


WEEKDAY_NAMES = ["월요일", "화요일", "수요일", "목요일", "금요일", "토요일", "일요일"]


def build_routine_items(weekday: int) -> list:
    """weekday: 월=0 ... 일=6.

    평일(월~금)은 집필 4블록, 주말(토~일)은 작업 2블록 + 구상으로 낮 일과가 갈린다.
    저녁 이후엔 월/수/금만 운동이 들어가고 나머지 평일은 그만큼 작업 시간이 늘어난다.
    금요일 밤은 다음날(토요일) 기상이 09시라 취침이 01:30으로 늦춰지고,
    반대로 일요일 밤은 다음날(월요일) 기상이 08시라 취침이 00:30으로 당겨진다.
    """
    if weekday <= 4:  # 월~금: 평일
        is_exercise_day = weekday in (0, 2, 4)
        evening = (
            [
                {"time": "19~20", "text": "작업"},
                {"time": "20~21", "text": "운동"},
            ]
            if is_exercise_day
            else [{"time": "19~21", "text": "작업"}]
        )
        is_friday = weekday == 4
        rest_time = "21~01:30" if is_friday else "21~24:30"
        sleep_time = "01:30" if is_friday else "00:30"
        return [
            {"time": "08", "text": "기상"},
            {"time": "08~09", "text": "아침 식사"},
            {"time": "09~11", "text": "1차 집필"},
            {"time": "11~13", "text": "2차 집필"},
            {"time": "13~14", "text": "점심 식사"},
            {"time": "14~16", "text": "3차 집필"},
            {"time": "16~18", "text": "4차 집필"},
            {"time": "18~19", "text": "저녁 식사"},
            *evening,
            {"time": rest_time, "text": "휴식"},
            {"time": sleep_time, "text": "취침"},
        ]

    # 토, 일: 주말
    is_sunday = weekday == 6
    rest_time = "22~00:30" if is_sunday else "22~01:30"
    sleep_time = "00:30" if is_sunday else "01:30"
    return [
        {"time": "09", "text": "기상"},
        {"time": "09~10", "text": "아침 식사"},
        {"time": "10~14", "text": "1차 작업"},
        {"time": "14~15", "text": "점심 식사"},
        {"time": "15~19", "text": "2차 작업"},
        {"time": "19~20", "text": "저녁 식사"},
        {"time": "20~22", "text": "구상"},
        {"time": rest_time, "text": "휴식"},
        {"time": sleep_time, "text": "취침"},
    ]


def build_today_data(date_str: str, weekday: int, schedule_pages: list, novel_pages: list) -> dict:
    holiday_pages = [p for p in schedule_pages if get_checkbox(p, "공휴일")]
    schedule_only = [p for p in schedule_pages if get_select(p, "종류") == "일정"]
    todo_pages = [p for p in schedule_pages if get_select(p, "종류") in ("할일", "과제")]

    holiday_names = [get_title(p) for p in holiday_pages]

    if schedule_only:
        schedule_items = [
            {"time": get_time(p), "text": get_title(p)} for p in schedule_only
        ]
        is_routine = False
    else:
        schedule_items = build_routine_items(weekday)
        is_routine = True

    todo_items = [
        {"time": get_time(p), "tags": [get_select(p, "종류")], "text": get_title(p)}
        for p in todo_pages
    ]

    novel_items = [
        {
            "time": get_time(p),
            "tags": [get_select(p, "작품"), get_select(p, "유형")],
            "text": get_title(p),
        }
        for p in novel_pages
    ]

    return {
        "date": date_str,
        "weekday": WEEKDAY_NAMES[weekday],
        "holiday_names": holiday_names,
        "schedule_title": "오늘의 일정",
        "schedule_items": schedule_items,
        "is_routine": is_routine,
        "todo_items": todo_items,
        "novel_items": novel_items,
    }


def load_previous_data() -> dict:
    if not TODAY_JSON_PATH.exists():
        return {}
    try:
        return json.loads(TODAY_JSON_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def format_digest(data: dict) -> tuple[str, str]:
    """오늘 하루치 데이터를 알림 제목/본문 한 쌍으로 요약한다.
    루틴 일정(is_routine)은 매일 똑같아서 알림에는 안 넣고, 그날그날 달라지는
    공휴일/특별 일정/할일/소설 항목만 넣는다."""
    title = f"{data['date']} ({data['weekday']}) 오늘 일정"

    lines = []
    if data.get("holiday_names"):
        lines.append("공휴일: " + ", ".join(data["holiday_names"]))

    if not data.get("is_routine"):
        for item in data.get("schedule_items", []):
            t = (item.get("time") or "").strip()
            lines.append(f"{t} {item['text']}".strip())

    for item in data.get("todo_items", []):
        tag = item["tags"][0] if item.get("tags") else ""
        prefix = f"[{tag}] " if tag else ""
        lines.append(f"할일 · {prefix}{item['text']}")

    for item in data.get("novel_items", []):
        label = " ".join(tag for tag in (item.get("tags") or []) if tag)
        prefix = f"[{label}] " if label else ""
        lines.append(f"소설 · {prefix}{item['text']}")

    message = "\n".join(lines) if lines else "오늘은 등록된 할일/소설 일정이 없습니다."
    return title, message


def send_push(title: str, message: str) -> None:
    # ntfy.sh는 구독자 수를 알려주지 않는 단순 발행-구독 방식이라, 여기서
    # HTTP 상태만 확인할 뿐 실제 수신 여부(구독 앱이 켜져 있는지 등)는 알 수 없다.
    resp = requests.post(
        NTFY_API,
        json={
            "topic": NTFY_TOPIC,
            "title": title,
            "message": message,
            "click": APP_URL,
        },
    )
    resp.raise_for_status()


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

    previous = load_previous_data()
    already_notified = previous.get("date") == date_str and previous.get("notified", False)

    if already_notified:
        data["notified"] = True
        print(f"{date_str} 알림은 이미 보냈으므로 건너뜁니다.")
    else:
        title, message = format_digest(data)
        try:
            send_push(title, message)
            data["notified"] = True
            print("알림 발송 완료")
        except Exception as e:
            # 화면 갱신은 푸시 성공 여부와 무관하게 계속되어야 하므로 여기서 멈추지 않는다.
            data["notified"] = False
            print(f"푸시 발송 실패: {e}")

    write_today_json(data)
    print(f"today.json 갱신 완료: {date_str}")


if __name__ == "__main__":
    main()
