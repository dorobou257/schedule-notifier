"""
매일 08:00(KST)에 실행되어 노션의 [일정] / [소설] 캘린더를 확인하고
하나의 이메일로 정리해서 보내는 스크립트.

필요한 환경변수(GitHub Actions Secrets로 설정):
- NOTION_TOKEN        : 노션 Integration 토큰
- SCHEDULE_DB_ID       : [일정] 데이터베이스 ID
- NOVEL_DB_ID          : [소설] 데이터베이스 ID
- GMAIL_ADDRESS        : 보내는 사람 gmail 주소
- GMAIL_APP_PASSWORD   : gmail 앱 비밀번호(일반 로그인 비밀번호 아님)
- MAIL_TO              : 받는 사람 이메일 주소 (본인 주소면 됨)
"""

import html
import os
import smtplib
import traceback
from datetime import datetime, timezone, timedelta
from email.mime.text import MIMEText

import requests

NOTION_TOKEN = os.environ["NOTION_TOKEN"]
SCHEDULE_DB_ID = os.environ["SCHEDULE_DB_ID"]
NOVEL_DB_ID = os.environ["NOVEL_DB_ID"]
GMAIL_ADDRESS = os.environ["GMAIL_ADDRESS"]
GMAIL_APP_PASSWORD = os.environ["GMAIL_APP_PASSWORD"]
MAIL_TO = os.environ["MAIL_TO"]

NOTION_API = "https://api.notion.com/v1"
HEADERS = {
    "Authorization": f"Bearer {NOTION_TOKEN}",
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
}

KST = timezone(timedelta(hours=9))


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


def build_email_body(date_str: str, weekday: int, schedule_pages: list, novel_pages: list) -> str:
    holiday_pages = [p for p in schedule_pages if get_checkbox(p, "공휴일")]
    schedule_only = [p for p in schedule_pages if get_select(p, "종류") == "일정"]
    todo_pages = [p for p in schedule_pages if get_select(p, "종류") in ("할일", "과제")]

    lines = []
    lines.append(f"<h2>{date_str} 오늘 정리</h2>")

    if holiday_pages:
        names = ", ".join(html.escape(get_title(p)) for p in holiday_pages)
        lines.append(f"<p><b>오늘은 공휴일입니다: {names}</b></p>")

    lines.append("<h3>오늘의 일정</h3>")
    if schedule_only:
        lines.append("<ul>")
        for p in schedule_only:
            lines.append(f"<li>{html.escape(get_title(p))}</li>")
        lines.append("</ul>")
    else:
        lines.append("<ul>")
        for r in build_routine_lines(weekday):
            lines.append(f"<li>{html.escape(r)}</li>")
        lines.append("</ul>")

    if todo_pages:
        lines.append("<h3>오늘의 할일</h3>")
        lines.append("<ul>")
        for p in todo_pages:
            kind = get_select(p, "종류")
            lines.append(f"<li>[{html.escape(kind)}] {html.escape(get_title(p))}</li>")
        lines.append("</ul>")

    lines.append("<h3>오늘의 소설 일정</h3>")
    if novel_pages:
        lines.append("<ul>")
        for p in novel_pages:
            work = get_select(p, "작품")
            kind = get_select(p, "유형")
            lines.append(
                f"<li>[{html.escape(work)}] {html.escape(kind)} - {html.escape(get_title(p))}</li>"
            )
        lines.append("</ul>")
    else:
        lines.append("<p>오늘은 등록된 소설 일정이 없습니다.</p>")

    return "\n".join(lines)


def send_email(subject: str, html_body: str) -> None:
    msg = MIMEText(html_body, "html", "utf-8")
    msg["Subject"] = subject
    msg["From"] = GMAIL_ADDRESS
    msg["To"] = MAIL_TO

    with smtplib.SMTP("smtp.gmail.com", 587) as server:
        server.starttls()
        server.login(GMAIL_ADDRESS, GMAIL_APP_PASSWORD)
        server.sendmail(GMAIL_ADDRESS, [MAIL_TO], msg.as_string())


def send_failure_notification(error: Exception) -> None:
    """실행 중 예외가 발생했을 때 실패 사실을 메일로 알린다."""
    body = (
        "<h2>일정 알리미 실행 실패</h2>"
        f"<p>{html.escape(str(error))}</p>"
        f"<pre>{html.escape(traceback.format_exc())}</pre>"
    )
    send_email("[일정 알리미] 실행 실패 알림", body)


def main():
    try:
        now = today_kst()
        date_str = now.strftime("%Y-%m-%d")
        weekday = now.weekday()  # 월=0 ... 일=6

        schedule_pages = query_database(SCHEDULE_DB_ID, date_str)
        novel_pages = query_database(NOVEL_DB_ID, date_str)

        body = build_email_body(date_str, weekday, schedule_pages, novel_pages)
        send_email(f"{date_str} 일정", body)
        print("메일 전송 완료:", date_str)
    except Exception as e:
        try:
            send_failure_notification(e)
        except Exception as notify_error:
            print("실패 알림 메일 발송도 실패:", notify_error)
        raise


if __name__ == "__main__":
    main()
