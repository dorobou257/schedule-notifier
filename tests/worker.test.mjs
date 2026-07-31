// 노션 중계 워커 테스트. 진짜 노션 대신 fetch를 가로채서 요청 모양과
// 응답 처리를 확인한다(토큰 없이도 CI/로컬에서 그대로 돌아간다).
import test from "node:test";
import assert from "node:assert/strict";

import worker from "../worker/src/index.js";

const ENV = {
  NOTION_TOKEN: "secret_test",
  SCHEDULE_DB_ID: "db-schedule",
  NOVEL_DB_ID: "db-novel",
  ALLOWED_ORIGIN: "https://dorobou257.github.io",
};

function page(id, props) {
  return { id, properties: props };
}
const title = (t) => ({ title: [{ plain_text: t }] });
const select = (n) => ({ select: { name: n } });
const checkbox = (v) => ({ checkbox: v });
const dateProp = (s) => ({ date: { start: s } });

/** globalThis.fetch를 가로채고, 오간 요청 목록을 돌려준다. */
function stubFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET", body: init.body ? JSON.parse(init.body) : null, headers: init.headers });
    return handler(String(url), init, calls.length);
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status });

test("GET /today: 노션 페이지를 today.json과 같은 형태로 바꾼다", async () => {
  const schedulePages = [
    page("p1", { 이름: title("병원 예약"), 종류: select("일정"), 날짜: dateProp("2026-07-31T14:30:00+09:00") }),
    page("p2", { 이름: title("장보기"), 종류: select("할일"), 완료: checkbox(false), 날짜: dateProp("2026-07-31") }),
    page("p3", { 이름: title("이미 한 일"), 종류: select("할일"), 완료: checkbox(true), 날짜: dateProp("2026-07-31") }),
    page("p4", { 이름: title("광복절"), 공휴일: checkbox(true), 날짜: dateProp("2026-07-31") }),
  ];
  const novelPages = [page("n1", { 이름: title("45화"), 작품: select("챌린지"), 유형: select("초고"), 완료: checkbox(false), 날짜: dateProp("2026-07-31") })];

  const stub = stubFetch((url, init) => {
    const dbId = url.match(/databases\/([^/]+)\/query/)[1];
    return jsonRes({ results: dbId === "db-schedule" ? schedulePages : novelPages, has_more: false });
  });
  try {
    const res = await worker.fetch(new Request("https://w.dev/today?date=2026-07-31"), ENV);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), ENV.ALLOWED_ORIGIN);
    const data = await res.json();

    assert.equal(data.date, "2026-07-31");
    assert.equal(data.weekday, "금요일");
    assert.deepEqual(data.holiday_names, ["광복절"]);
    assert.deepEqual(data.special_items, [{ id: "p1", time: "14:30", text: "병원 예약", done: false }]);
    assert.equal(data.todo_items.length, 2);
    assert.deepEqual(data.todo_items[0], { id: "p2", time: "", tags: ["할일"], text: "장보기", done: false });
    assert.equal(data.todo_items[1].done, true, "완료 여부는 그대로 넘기고 거르는 건 앱이 한다");
    assert.deepEqual(data.novel_items[0].tags, ["챌린지", "초고"]);
    assert.equal(data.source, "worker");

    // 노션에 보낸 요청도 확인 — Authorization 헤더와 날짜 필터.
    assert.equal(stub.calls.length, 2);
    assert.equal(stub.calls[0].headers.Authorization, "Bearer secret_test");
    assert.deepEqual(stub.calls[0].body.filter, { property: "날짜", date: { equals: "2026-07-31" } });
  } finally {
    stub.restore();
  }
});

test("GET /today: 날짜 형식이 잘못되면 400", async () => {
  const stub = stubFetch(() => jsonRes({ results: [] }));
  try {
    const res = await worker.fetch(new Request("https://w.dev/today?date=오늘"), ENV);
    assert.equal(res.status, 400);
    assert.equal(stub.calls.length, 0, "노션을 부르지도 않아야 한다");
  } finally {
    stub.restore();
  }
});

test("PATCH /item: 우리 DB의 페이지면 완료 체크박스를 바꾼다", async () => {
  const stub = stubFetch((url) => {
    if (url.includes("/query")) return jsonRes({ results: [page("p2", {})], has_more: false });
    return jsonRes({ object: "page" });
  });
  try {
    const res = await worker.fetch(
      new Request("https://w.dev/item", { method: "PATCH", body: JSON.stringify({ id: "p2", done: true }) }),
      ENV
    );
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, id: "p2", done: true });

    const patch = stub.calls.find((c) => c.method === "PATCH");
    assert.equal(patch.url, "https://api.notion.com/v1/pages/p2");
    assert.deepEqual(patch.body, { properties: { 완료: { checkbox: true } } });
  } finally {
    stub.restore();
  }
});

test("PATCH /item: 우리 DB에 없는 페이지는 403이고 노션을 수정하지 않는다", async () => {
  const stub = stubFetch(() => jsonRes({ results: [page("other", {})], has_more: false }));
  try {
    const res = await worker.fetch(
      new Request("https://w.dev/item", { method: "PATCH", body: JSON.stringify({ id: "남의페이지", done: true }) }),
      ENV
    );
    assert.equal(res.status, 403);
    assert.equal(stub.calls.some((c) => c.method === "PATCH"), false);
  } finally {
    stub.restore();
  }
});

test("PATCH /item: id나 done이 빠지면 400", async () => {
  const stub = stubFetch(() => jsonRes({ results: [] }));
  try {
    for (const body of ['{"id":"p2"}', '{"done":true}', "{}", "not json"]) {
      const res = await worker.fetch(new Request("https://w.dev/item", { method: "PATCH", body }), ENV);
      assert.equal(res.status, 400, `body=${body}`);
    }
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test("OPTIONS 프리플라이트와 알 수 없는 경로", async () => {
  const opt = await worker.fetch(new Request("https://w.dev/item", { method: "OPTIONS" }), ENV);
  assert.equal(opt.status, 204);
  assert.equal(opt.headers.get("Access-Control-Allow-Methods"), "GET, PATCH, OPTIONS");

  const nf = await worker.fetch(new Request("https://w.dev/nope"), ENV);
  assert.equal(nf.status, 404);
  assert.equal(nf.headers.get("Access-Control-Allow-Origin"), ENV.ALLOWED_ORIGIN);
});

test("노션이 실패하면 502로 감싸고 이유를 남긴다", async () => {
  const stub = stubFetch(() => new Response("unauthorized", { status: 401 }));
  try {
    const res = await worker.fetch(new Request("https://w.dev/today?date=2026-07-31"), ENV);
    assert.equal(res.status, 502);
    assert.match((await res.json()).error, /401/);
  } finally {
    stub.restore();
  }
});
