"""
5분 간격으로 실행되어 노션의 [일정] / [소설] 캘린더를 확인하고
docs/today.json으로 정리해서 저장하는 스크립트.
GitHub Pages로 서비스되는 PWA(docs/index.html)가 이 파일을 읽어서 화면에 보여준다.

동시에, 지금 막 시작하는 항목(식사 제외)이 있으면 OneSignal로 푸시 알림을
보낸다. 같은 시각에 겹치는 항목은 하나로 합쳐서 보내고, 이미 보낸 시각은
today.json에 기록해 다시 보내지 않는다.

필요한 환경변수(GitHub Actions Secrets로 설정):
- NOTION_TOKEN          : 노션 Integration 토큰
- SCHEDULE_DB_ID        : [일정] 데이터베이스 ID
- NOVEL_DB_ID           : [소설] 데이터베이스 ID
- ONESIGNAL_APP_ID      : OneSignal 앱 ID
- ONESIGNAL_REST_API_KEY: OneSignal REST API 키
"""

import json
import os
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests

NOTION_TOKEN = os.environ["NOTION_TOKEN"]
SCHEDULE_DB_ID = os.environ["SCHEDULE_DB_ID"]
NOVEL_DB_ID = os.environ["NOVEL_DB_ID"]
ONESIGNAL_APP_ID = os.environ["ONESIGNAL_APP_ID"]
ONESIGNAL_REST_API_KEY = os.environ["ONESIGNAL_REST_API_KEY"]

NOTION_API = "https://api.notion.com/v1"
HEADERS = {
    "Authorization": f"Bearer {NOTION_TOKEN}",
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
}

ONESIGNAL_API = "https://onesignal.com/api/v1/notifications"
APP_URL = "https://dorobou257.github.io/schedule-notifier/"

KST = timezone(timedelta(hours=9))
TODAY_JSON_PATH = Path(__file__).parent / "docs" / "today.json"

# 고정 루틴 항목의 실제 알림 시각. 식사와 취침은 여기 없으므로 알림이 안 간다.
ROUTINE_NOTIFY_TIMES = {
    "기상": "08:00",
    "1차 집필": "09:00",
    "1차 작업": "11:00",
    "2차 집필": "14:00",
    "2차 작업": "16:00",
    "3차 집필": "19:00",
    "운동": "21:00",
    "3차 작업": "21:00",
    "휴식": "22:00",
}


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
    """weekday: 월=0 ... 일=6. 월/수/금은 운동, 그 외는 3차 작업으로 대체."""
    slot_21_22 = "운동" if weekday in (0, 2, 4) else "3차 작업"
    return [
        {"time": "08시", "text": "기상"},
        {"time": "08~09", "text": "아침 식사"},
        {"time": "09~11", "text": "1차 집필"},
        {"time": "11~13", "text": "1차 작업"},
        {"time": "13~14", "text": "점심 식사"},
        {"time": "14~16", "text": "2차 집필"},
        {"time": "16~18", "text": "2차 작업"},
        {"time": "18~19", "text": "저녁 식사"},
        {"time": "19~21", "text": "3차 집필"},
        {"time": "21~22", "text": slot_21_22},
        {"time": "22~00", "text": "휴식"},
        {"time": "취침", "text": "00:15 또는 01:45"},
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


def collect_due_notifications(data: dict, now_str: str, already_sent: set) -> list:
    """(알림시각, [내용, ...]) 목록을 시간순으로 반환한다.
    now_str(HH:MM) 시각이 이미 지났고, 아직 안 보낸 시각만 대상으로 한다."""
    by_time: dict[str, list[str]] = {}

    for item in data.get("schedule_items", []):
        if data.get("is_routine"):
            t = ROUTINE_NOTIFY_TIMES.get(item["text"])
        else:
            t = item.get("time") or None
        if t:
            by_time.setdefault(t, []).append(item["text"])

    for item in data.get("todo_items", []):
        t = item.get("time") or None
        if t:
            tag = item["tags"][0] if item.get("tags") else ""
            by_time.setdefault(t, []).append(f"[{tag}] {item['text']}")

    for item in data.get("novel_items", []):
        t = item.get("time") or None
        if t:
            label = " ".join(tag for tag in (item.get("tags") or []) if tag)
            by_time.setdefault(t, []).append(f"[{label}] {item['text']}" if label else item["text"])

    due = [
        (t, texts) for t, texts in by_time.items()
        if t <= now_str and t not in already_sent
    ]
    due.sort(key=lambda pair: pair[0])
    return due


def send_push(title: str, message: str) -> None:
    payload = {
        "app_id": ONESIGNAL_APP_ID,
        "included_segments": ["Subscribed Users"],
        "headings": {"en": title},
        "contents": {"en": message},
        "url": APP_URL,
    }
    resp = requests.post(
        ONESIGNAL_API,
        headers={
            "Authorization": f"Key {ONESIGNAL_REST_API_KEY}",
            "Content-Type": "application/json",
        },
        json=payload,
    )
    resp.raise_for_status()
    # OneSignal은 실패해도 HTTP 200을 주고 본문의 "errors"로만 실패를 알리는
    # 경우가 있어서, 상태 코드만으로는 성공 여부를 알 수 없다.
    body = resp.json()
    if body.get("errors"):
        raise RuntimeError(f"OneSignal 발송 실패: {body['errors']}")


def write_today_json(data: dict) -> None:
    TODAY_JSON_PATH.write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def main():
    now = today_kst()
    date_str = now.strftime("%Y-%m-%d")
    now_str = now.strftime("%H:%M")
    weekday = now.weekday()  # 월=0 ... 일=6

    schedule_pages = query_database(SCHEDULE_DB_ID, date_str)
    novel_pages = query_database(NOVEL_DB_ID, date_str)

    data = build_today_data(date_str, weekday, schedule_pages, novel_pages)

    previous = load_previous_data()
    already_sent = set(previous.get("notified_at", [])) if previous.get("date") == date_str else set()

    due = collect_due_notifications(data, now_str, already_sent)
    sent_count = 0
    for notify_time, texts in due:
        try:
            send_push(f"{notify_time} 일정", " · ".join(texts))
            already_sent.add(notify_time)
            sent_count += 1
        except Exception as e:
            # 화면 갱신은 푸시 성공 여부와 무관하게 계속되어야 하므로 여기서 멈추지 않는다.
            # 실패한 시각은 already_sent에 넣지 않아 다음 실행 때 다시 시도한다.
            print(f"푸시 발송 실패 ({notify_time}): {e}")

    data["notified_at"] = sorted(already_sent)
    write_today_json(data)
    print(f"today.json 갱신 완료: {date_str} {now_str} (알림 {sent_count}/{len(due)}건 발송)")


if __name__ == "__main__":
    main()
