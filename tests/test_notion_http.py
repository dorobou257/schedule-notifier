"""재시도 로직. 실제로 몇 초씩 자면서 확인할 수는 없으므로 sleep과 session을
갈아끼워 "몇 번 보냈고 얼마나 기다렸는가"만 본다.

여기서 틀리기 쉬운 것들을 특히 고정한다: 마지막 시도 뒤에도 자는 것(잡이
괜히 늘어진다), 4xx를 다시 보내는 것(몇 번을 보내도 같다), 그리고 무언가를
만드는 요청을 타임아웃 때문에 다시 보내는 것(같은 게 두 개 생긴다).
"""

import sys
import unittest
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from notion_http import MAX_ATTEMPTS, backoff_seconds, parse_retry_after, post_with_retry


class FakeResponse:
    def __init__(self, status_code, headers=None):
        self.status_code = status_code
        self.headers = headers or {}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"HTTP {self.status_code}", response=self)


class FakeSession:
    """정해둔 결과를 순서대로 돌려준다. 예외를 넣어두면 그 자리에서 던진다."""

    def __init__(self, *outcomes):
        self.outcomes = list(outcomes)
        self.calls = []

    def post(self, url, headers=None, json=None, timeout=None):
        self.calls.append({"url": url, "json": json, "timeout": timeout})
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


class Sleeper:
    def __init__(self):
        self.waits = []

    def __call__(self, seconds):
        self.waits.append(seconds)


def send(session, sleeper, **kwargs):
    return post_with_retry("https://example.test/x", json={}, sleep=sleeper, session=session, **kwargs)


class BackoffTest(unittest.TestCase):
    def test_지수적으로_늘어난다(self):
        self.assertEqual(backoff_seconds(1), 1.0)
        self.assertEqual(backoff_seconds(2), 2.0)
        self.assertEqual(backoff_seconds(3), 4.0)

    def test_Retry_After가_더_길면_그_말을_따른다(self):
        self.assertEqual(backoff_seconds(1, "5"), 5.0)
        self.assertEqual(backoff_seconds(2, "1"), 2.0, "더 짧게 말해도 우리 간격보다 일찍 두드리지 않는다")

    def test_Retry_After가_지나치게_길면_상한에서_끊는다(self):
        self.assertEqual(backoff_seconds(1, "99999"), 30.0)

    def test_숫자가_아닌_Retry_After는_무시한다(self):
        # HTTP-date 형식으로 올 수도 있다. 못 읽으면 우리 간격을 쓴다.
        self.assertIsNone(parse_retry_after("Wed, 21 Oct 2026 07:28:00 GMT"))
        self.assertIsNone(parse_retry_after(None))
        self.assertEqual(backoff_seconds(1, "Wed, 21 Oct 2026 07:28:00 GMT"), 1.0)


class RetryTest(unittest.TestCase):
    def test_한_번에_되면_기다리지_않는다(self):
        session = FakeSession(FakeResponse(200))
        sleeper = Sleeper()
        resp = send(session, sleeper)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(session.calls), 1)
        self.assertEqual(sleeper.waits, [])

    def test_503이면_다시_보내고_성공하면_거기서_멈춘다(self):
        session = FakeSession(FakeResponse(503), FakeResponse(200))
        sleeper = Sleeper()
        self.assertEqual(send(session, sleeper).status_code, 200)
        self.assertEqual(len(session.calls), 2)
        self.assertEqual(sleeper.waits, [1.0])

    def test_연결이_끊겨도_다시_보낸다(self):
        session = FakeSession(requests.ConnectionError("끊김"), requests.Timeout("느림"), FakeResponse(200))
        sleeper = Sleeper()
        self.assertEqual(send(session, sleeper).status_code, 200)
        self.assertEqual(sleeper.waits, [1.0, 2.0])

    def test_끝까지_실패하면_마지막_응답의_오류를_올린다(self):
        session = FakeSession(*[FakeResponse(500)] * MAX_ATTEMPTS)
        sleeper = Sleeper()
        with self.assertRaises(requests.HTTPError):
            send(session, sleeper)
        self.assertEqual(len(session.calls), MAX_ATTEMPTS)
        # 마지막 시도 뒤에는 자지 않는다 — 어차피 다시 보내지 않는다.
        self.assertEqual(len(sleeper.waits), MAX_ATTEMPTS - 1)

    def test_4xx는_다시_보내지_않는다(self):
        # 요청이 잘못된 것이라 몇 번을 보내도 같다. 바로 올려서 로그에 드러낸다.
        session = FakeSession(FakeResponse(400), FakeResponse(200))
        sleeper = Sleeper()
        with self.assertRaises(requests.HTTPError):
            send(session, sleeper)
        self.assertEqual(len(session.calls), 1)
        self.assertEqual(sleeper.waits, [])

    def test_429는_Retry_After를_지킨다(self):
        session = FakeSession(FakeResponse(429, {"Retry-After": "7"}), FakeResponse(200))
        sleeper = Sleeper()
        send(session, sleeper)
        self.assertEqual(sleeper.waits, [7.0])

    def test_만드는_요청은_응답을_못_받았을_때_다시_보내지_않는다(self):
        # 타임아웃은 "안 만들어졌다"가 아니라 "만들어졌는지 모르겠다"다.
        session = FakeSession(requests.Timeout("느림"), FakeResponse(200))
        sleeper = Sleeper()
        with self.assertRaises(requests.Timeout):
            send(session, sleeper, retry_on_network_error=False)
        self.assertEqual(len(session.calls), 1, "두 번 만들면 같은 게 두 개 생긴다")

    def test_만드는_요청도_429에는_다시_보낸다(self):
        # 노션이 분명하게 거절한 것이라 아직 아무것도 만들어지지 않았다.
        session = FakeSession(FakeResponse(429), FakeResponse(200))
        sleeper = Sleeper()
        resp = send(session, sleeper, retry_statuses=(429,), retry_on_network_error=False)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(session.calls), 2)

    def test_만드는_요청은_5xx에도_다시_보내지_않게_설정할_수_있다(self):
        session = FakeSession(FakeResponse(500), FakeResponse(200))
        sleeper = Sleeper()
        with self.assertRaises(requests.HTTPError):
            send(session, sleeper, retry_statuses=(429,), retry_on_network_error=False)
        self.assertEqual(len(session.calls), 1)

    def test_타임아웃_상한이_매번_붙는다(self):
        session = FakeSession(FakeResponse(200))
        send(session, Sleeper())
        self.assertEqual(session.calls[0]["timeout"], 15)


if __name__ == "__main__":
    unittest.main()
