"""
하루 한 번(아침 8시) 실행되어 노션의 [일정] / [소설] 캘린더를 확인하고
docs/today.json으로 정리해서 저장하는 스크립트.
GitHub Pages로 서비스되는 PWA(docs/index.html)가 이 파일을 읽어서 화면에 보여준다.

이 스크립트는 "루틴"(기상/식사/집필 등 매일 반복되는 하루 일과)을 더 이상
만들지 않는다 — 루틴은 실제 취침 시각에 맞춰 매번 달라져야 하므로 브라우저의
docs/routine.js가 그때그때 계산한다. 여기서는 노션에만 있는, 그날그날 다른
데이터(공휴일/특별 일정/할일/소설 일정)만 today.json에 담는다.

동시에 오늘 하루치 특별 일정/할일/소설 목록을 하나로 요약해서 ntfy.sh로 푸시
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

# 상대가 응답하지 않으면 GitHub Actions 한도(6시간)까지 잡이 매달린다. 항상 상한을 둔다.
HTTP_TIMEOUT = 15

KST = timezone(timedelta(hours=9))
TODAY_JSON_PATH = Path(__file__).parent / "docs" / "today.json"


def today_kst() -> datetime:
    return datetime.now(KST)


def shift_date(date_str: str, days: int) -> str:
    return (datetime.strptime(date_str, "%Y-%m-%d") + timedelta(days=days)).strftime("%Y-%m-%d")


def start_date_of(page: dict, prop_name: str = "날짜") -> str:
    """노션 date 속성의 시작 날짜(원본 문자열 앞 10글자 = 입력한 그대로의 날짜)."""
    date_info = page["properties"].get(prop_name, {}).get("date") or {}
    return (date_info.get("start") or "")[:10]


def query_database(database_id: str, date_str: str) -> list:
    """해당 날짜(date_str, YYYY-MM-DD)에 해당하는 페이지들을 모두 가져온다.

    노션의 date 필터는 타임스탬프를 UTC로 비교한다. 그래서 equals로 물으면
    8월 1일 06:00(KST) 항목을 놓친다 — UTC로는 7월 31일 21:00이기 때문이다.
    (한국 시각 오전 9시 이전이 붙은 일정이 전부 하루 전으로 밀렸다.)
    앞뒤로 넉넉히 받아온 뒤 원본 문자열의 날짜로 직접 고른다 — 타임존 해석에
    의존하지 않는다. worker/src/index.js의 queryDatabase도 같은 방식이다.
    """
    url = f"{NOTION_API}/databases/{database_id}/query"
    payload = {
        "filter": {
            "and": [
                {"property": "날짜", "date": {"on_or_after": shift_date(date_str, -1)}},
                {"property": "날짜", "date": {"before": shift_date(date_str, 2)}},
            ]
        }
    }
    results = []
    while True:
        resp = requests.post(url, headers=HEADERS, json=payload, timeout=HTTP_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        results.extend(data.get("results", []))
        if not data.get("has_more"):
            break
        payload["start_cursor"] = data["next_cursor"]
    return [p for p in results if start_date_of(p) == date_str]


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

# 노션 [일정]/[소설] DB의 완료 체크박스 속성 이름. 워커도 같은 이름을 쓴다.
DONE_PROP = "완료"


def build_today_data(date_str: str, weekday: int, schedule_pages: list, novel_pages: list) -> dict:
    holiday_pages = [p for p in schedule_pages if get_checkbox(p, "공휴일")]
    special_pages = [p for p in schedule_pages if get_select(p, "종류") == "일정"]
    todo_pages = [p for p in schedule_pages if get_select(p, "종류") in ("할일", "과제")]

    holiday_names = [get_title(p) for p in holiday_pages]

    # 종류="일정"으로 노션에 직접 등록된 항목이 있으면 그날은 앱의 자동 루틴
    # 대신 이 목록을 그대로 보여준다(비어 있으면 프론트가 routine.js로 계산).
    # 각 항목에 노션 페이지 id를 함께 넘긴다 — 앱이 "이 소설 일정은 2차 집필에
    # 배정" 같은 상태를 항목별로 기억하고, 체크박스를 눌러 노션의 그 페이지를
    # 완료 처리하려면 안정적인 키가 필요하다(worker/src/index.js 참고).
    # done은 노션의 "완료" 체크박스 — 이미 끝낸 항목은 앱이 화면에서 뺀다.
    special_items = [
        {"id": p["id"], "time": get_time(p), "text": get_title(p), "done": get_checkbox(p, DONE_PROP)}
        for p in special_pages
    ]

    todo_items = [
        {
            "id": p["id"],
            "time": get_time(p),
            "tags": [get_select(p, "종류")],
            "text": get_title(p),
            "done": get_checkbox(p, DONE_PROP),
        }
        for p in todo_pages
    ]

    novel_items = [
        {
            "id": p["id"],
            "time": get_time(p),
            "tags": [get_select(p, "작품"), get_select(p, "유형")],
            "text": get_title(p),
            "done": get_checkbox(p, DONE_PROP),
        }
        for p in novel_pages
    ]

    return {
        "date": date_str,
        "weekday": WEEKDAY_NAMES[weekday],
        "holiday_names": holiday_names,
        "special_items": special_items,
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
    매일 반복되는 루틴은 애초에 이 데이터에 들어있지 않다(브라우저가 그때그때
    계산) — 그날그날 달라지는 공휴일/특별 일정/할일/소설 항목만 넣는다."""
    title = f"{data['date']} ({data['weekday']}) 오늘 일정"

    lines = []
    if data.get("holiday_names"):
        lines.append("공휴일: " + ", ".join(data["holiday_names"]))

    # 이미 완료 처리한 항목은 아침 알림에서도 뺀다.
    def pending(items):
        return [it for it in items if not it.get("done")]

    for item in pending(data.get("special_items", [])):
        t = (item.get("time") or "").strip()
        lines.append(f"{t} {item['text']}".strip())

    for item in pending(data.get("todo_items", [])):
        tag = item["tags"][0] if item.get("tags") else ""
        prefix = f"[{tag}] " if tag else ""
        lines.append(f"할일 · {prefix}{item['text']}")

    for item in pending(data.get("novel_items", [])):
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
        timeout=HTTP_TIMEOUT,
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
