"""노션·ntfy 호출을 재시도해서 보낸다.

이 저장소의 파이썬은 GitHub Actions에서 하루 한 번(notify.py), 또는 1년에 한 번
(update_holidays.py) 돌아간다. 그 한 번이 상대의 일시적인 문제로 실패하면
다음 기회는 하루 뒤 또는 1년 뒤다 — 그날 아침 알림이 통째로 없거나, 그해
공휴일이 하나도 안 들어간 채로 한 해를 보낸다. 그래서 한 번 튕겼다고 바로
포기하지 않는다.

되살릴 수 있는 실패만 다시 보낸다:
  - 연결 실패·타임아웃(응답 자체를 못 받음)
  - 429(속도 제한) 및 5xx(상대 쪽 일시 장애)
4xx는 요청이 잘못된 것이라 몇 번을 다시 보내도 같다 — 그대로 올린다.

requests 말고는 의존성이 없다. 테스트가 sleep과 session을 갈아끼울 수 있게
인자로 받는다(실제로 몇 초씩 자면서 테스트할 수는 없다).
"""

import time

import requests

# 상대가 응답하지 않으면 GitHub Actions 한도(6시간)까지 잡이 매달린다. 항상 상한을 둔다.
HTTP_TIMEOUT = 15

# 첫 시도를 포함한 총 시도 횟수. 1초 → 2초를 기다리며 최대 세 번 두드린다.
MAX_ATTEMPTS = 3
BACKOFF_BASE = 1.0
MAX_BACKOFF = 30.0

# 다시 보낼 가치가 있는 상태 코드.
RETRY_STATUSES = (429, 500, 502, 503, 504)


def parse_retry_after(value) -> float | None:
    """Retry-After 헤더의 초 단위 값. 숫자가 아니면(HTTP-date 형식 등) None."""
    if not value:
        return None
    try:
        seconds = float(value)
    except (TypeError, ValueError):
        return None
    return seconds if seconds >= 0 else None


def backoff_seconds(attempt: int, retry_after=None) -> float:
    """attempt번째 시도가 실패한 뒤 기다릴 시간. 1초, 2초, 4초…

    상대가 Retry-After로 더 오래 기다리라고 하면 그 말을 따른다 — 속도 제한에
    걸린 상태에서 우리 계산대로 일찍 다시 두드려봐야 또 429다. 다만 상한을
    둔다(잡이 통째로 매달리는 것보다 다음 실행을 기다리는 편이 낫다).
    """
    wait = BACKOFF_BASE * (2 ** (attempt - 1))
    hinted = parse_retry_after(retry_after)
    if hinted is not None:
        wait = max(wait, hinted)
    return min(wait, MAX_BACKOFF)


def post_with_retry(
    url,
    *,
    headers=None,
    json=None,
    timeout=HTTP_TIMEOUT,
    retry_statuses=RETRY_STATUSES,
    retry_on_network_error=True,
    label="요청",
    sleep=time.sleep,
    session=requests,
):
    """POST를 보내고, 되살릴 수 있는 실패면 지수 백오프로 다시 보낸다.

    :param retry_on_network_error: 응답을 못 받은 경우에도 다시 보낼지.
        읽기 요청은 그냥 켜두면 되지만, 무언가를 만드는 요청은 다르다 —
        타임아웃은 "안 만들어졌다"가 아니라 "만들어졌는지 모르겠다"라서,
        다시 보내면 같은 것이 두 개 생길 수 있다.
    :param label: 로그에 남길 이름(Actions 로그에서 어느 호출인지 알아보게).
    :returns: 성공한 응답. 끝내 실패하면 마지막 예외를 그대로 올린다.
    """
    for attempt in range(1, MAX_ATTEMPTS + 1):
        last = attempt == MAX_ATTEMPTS
        try:
            resp = session.post(url, headers=headers, json=json, timeout=timeout)
        except requests.RequestException as e:
            if last or not retry_on_network_error:
                raise
            wait = backoff_seconds(attempt)
            print(f"{label} 실패({type(e).__name__}) - {wait:g}초 뒤 다시 시도합니다 ({attempt}/{MAX_ATTEMPTS - 1})")
            sleep(wait)
            continue

        if resp.status_code in retry_statuses and not last:
            wait = backoff_seconds(attempt, resp.headers.get("Retry-After"))
            print(f"{label} 실패(HTTP {resp.status_code}) - {wait:g}초 뒤 다시 시도합니다 ({attempt}/{MAX_ATTEMPTS - 1})")
            sleep(wait)
            continue

        resp.raise_for_status()
        return resp
