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

/** 오늘(KST) 기준 며칠 뒤/전의 YYYY-MM-DD. PATCH 허용 창을 테스트할 때 쓴다. */
function kstDay(offset = 0) {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000 + offset * 86400000);
  return d.toISOString().slice(0, 10);
}

/** GET /v1/pages/{id} 응답. isOwnPage가 부모 DB와 날짜를 여기서 읽는다. */
function pageDetail(id, databaseId, dateStr) {
  return {
    object: "page",
    id,
    parent: { type: "database_id", database_id: databaseId },
    properties: { 날짜: dateProp(dateStr) },
  };
}

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

    // 노션에 보낸 요청도 확인 — Authorization 헤더와 날짜 범위 필터.
    assert.equal(stub.calls.length, 2);
    assert.equal(stub.calls[0].headers.Authorization, "Bearer secret_test");
    assert.deepEqual(stub.calls[0].body.filter, {
      and: [
        { property: "날짜", date: { on_or_after: "2026-07-30" } },
        { property: "날짜", date: { before: "2026-08-02" } },
      ],
    });
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
  const stub = stubFetch((url, init) => {
    if (init.method === "PATCH") return jsonRes({ object: "page" });
    return jsonRes(pageDetail("p2", "db-schedule", kstDay(0)));
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

    // 검증에 쓰는 조회는 딱 한 번이어야 한다(예전엔 ±3일 × DB 2개 = 14번이었다).
    assert.equal(stub.calls.filter((c) => c.method === "GET").length, 1);
    assert.equal(stub.calls.filter((c) => c.url.includes("/query")).length, 0, "DB 전수조회는 더 이상 하지 않는다");
  } finally {
    stub.restore();
  }
});

test("PATCH /item: 소설 DB 페이지도 허용하고, id 하이픈 유무는 상관없다", async () => {
  const stub = stubFetch((url, init) => {
    if (init.method === "PATCH") return jsonRes({ object: "page" });
    // 노션은 부모 id를 하이픈 붙은 형태로 준다. 환경변수는 하이픈이 없을 수 있다.
    return jsonRes(pageDetail("n1", "db-nov-el", kstDay(0)));
  });
  const env = { ...ENV, NOVEL_DB_ID: "DBNOVEL" };
  try {
    const res = await worker.fetch(
      new Request("https://w.dev/item", { method: "PATCH", body: JSON.stringify({ id: "n1", done: false }) }),
      env
    );
    assert.equal(res.status, 200);
  } finally {
    stub.restore();
  }
});

test("PATCH /item: 우리 DB에 없는 페이지는 403이고 노션을 수정하지 않는다", async () => {
  const stub = stubFetch(() => jsonRes(pageDetail("남의페이지", "db-남의것", kstDay(0))));
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

test("PATCH /item: 우리 DB라도 허용 창(±3일) 밖 날짜는 403", async () => {
  for (const offset of [-4, 4]) {
    const stub = stubFetch(() => jsonRes(pageDetail("old", "db-schedule", kstDay(offset))));
    try {
      const res = await worker.fetch(
        new Request("https://w.dev/item", { method: "PATCH", body: JSON.stringify({ id: "old", done: true }) }),
        ENV
      );
      assert.equal(res.status, 403, `offset=${offset}`);
      assert.equal(stub.calls.some((c) => c.method === "PATCH"), false);
    } finally {
      stub.restore();
    }
  }
});

test("PATCH /item: 노션이 페이지를 못 찾으면(404) 403으로 막는다", async () => {
  const stub = stubFetch(() => new Response("not found", { status: 404 }));
  try {
    const res = await worker.fetch(
      new Request("https://w.dev/item", { method: "PATCH", body: JSON.stringify({ id: "없는id", done: true }) }),
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

test("GET /week: 7일치를 DB당 한 번의 조회로 받아 날짜별로 나눈다", async () => {
  const schedulePages = [
    page("a", { 이름: title("월요일 할일"), 종류: select("할일"), 날짜: dateProp("2026-08-03") }),
    page("b", { 이름: title("수요일 병원"), 종류: select("일정"), 날짜: dateProp("2026-08-05T09:00:00+09:00") }),
    page("c", { 이름: title("다음주"), 종류: select("할일"), 날짜: dateProp("2026-08-10") }), // 범위 밖
  ];
  const novelPages = [page("n", { 이름: title("50화"), 작품: select("챌린지"), 유형: select("초고"), 날짜: dateProp("2026-08-05") })];

  const stub = stubFetch((url) => {
    const dbId = url.match(/databases\/([^/]+)\/query/)[1];
    return jsonRes({ results: dbId === "db-schedule" ? schedulePages : novelPages, has_more: false });
  });
  try {
    const res = await worker.fetch(new Request("https://w.dev/week?start=2026-08-03"), ENV);
    assert.equal(res.status, 200);
    const data = await res.json();

    assert.equal(data.start, "2026-08-03");
    assert.equal(data.end, "2026-08-09");
    assert.deepEqual(Object.keys(data.days), [
      "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06",
      "2026-08-07", "2026-08-08", "2026-08-09",
    ]);

    assert.deepEqual(data.days["2026-08-03"].todo_items.map((i) => i.text), ["월요일 할일"]);
    assert.equal(data.days["2026-08-03"].weekday, "월요일");
    assert.deepEqual(data.days["2026-08-05"].special_items.map((i) => i.text), ["수요일 병원"]);
    assert.deepEqual(data.days["2026-08-05"].novel_items.map((i) => i.text), ["50화"]);
    assert.deepEqual(data.days["2026-08-04"].todo_items, [], "항목 없는 날도 빈 채로 들어있다");

    // 범위 밖(8/10)은 어느 날에도 섞이면 안 된다.
    const allTexts = Object.values(data.days).flatMap((d) => d.todo_items.map((i) => i.text));
    assert.equal(allTexts.includes("다음주"), false);

    // 핵심: 하루씩 7번(=14회)이 아니라 DB당 1번씩 총 2번만 조회한다.
    assert.equal(stub.calls.length, 2);
    assert.deepEqual(stub.calls[0].body.filter, {
      and: [
        { property: "날짜", date: { on_or_after: "2026-08-02" } },
        { property: "날짜", date: { before: "2026-08-11" } },
      ],
    });
  } finally {
    stub.restore();
  }
});

test("GET /week: start가 없으면 오늘부터, 형식이 틀리면 400", async () => {
  const stub = stubFetch(() => jsonRes({ results: [], has_more: false }));
  try {
    const bad = await worker.fetch(new Request("https://w.dev/week?start=이번주"), ENV);
    assert.equal(bad.status, 400);
    assert.equal(stub.calls.length, 0);

    const ok = await worker.fetch(new Request("https://w.dev/week"), ENV);
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).start, kstDay(0));
  } finally {
    stub.restore();
  }
});

// --- POST /item : 앱에서 만든 항목을 노션에 남긴다 --------------------------
//
// 인증이 없는 공개 엔드포인트다. 그래서 "무엇을 만들 수 있는가"의 경계가 곧
// 보안 경계다 — 여기 테스트는 그 경계를 못 박는 것이 목적이다.

const post = (body) =>
  worker.fetch(
    new Request("https://w.dev/item", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    ENV
  );

test("POST /item: 할일을 만들고 목록에 꽂을 수 있는 모양으로 돌려준다", async () => {
  const created = page("new1", { 이름: title("장보기"), 종류: select("할일"), 완료: checkbox(false), 날짜: dateProp(kstDay(0)) });
  const stub = stubFetch(() => jsonRes(created));
  try {
    const res = await post({ db: "schedule", date: kstDay(0), name: "장보기", kind: "할일" });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.list, "todo_items");
    assert.deepEqual(data.item, { id: "new1", time: "", tags: ["할일"], text: "장보기", done: false });

    assert.equal(stub.calls.length, 1);
    assert.match(stub.calls[0].url, /\/v1\/pages$/);
    assert.equal(stub.calls[0].method, "POST");
    assert.equal(stub.calls[0].body.parent.database_id, "db-schedule", "DB id는 서버가 정한다");
    assert.deepEqual(Object.keys(stub.calls[0].body.properties).sort(), ["날짜", "이름", "종류"]);
  } finally {
    stub.restore();
  }
});

test("POST /item: 종류가 '일정'이면 특별 일정 자리로 간다", async () => {
  const created = page("new2", { 이름: title("병원"), 종류: select("일정"), 날짜: dateProp(`${kstDay(0)}T14:30:00+09:00`) });
  const stub = stubFetch(() => jsonRes(created));
  try {
    const data = await (await post({ db: "schedule", date: kstDay(0), name: "병원", kind: "일정", time: "14:30" })).json();
    assert.equal(data.list, "special_items");
    assert.equal(data.item.time, "14:30");
    // 시각을 붙일 땐 KST 오프셋이 명시돼야 노션이 아홉 시간 밀지 않는다.
    assert.equal(stub.calls[0].body.properties.날짜.date.start, `${kstDay(0)}T14:30:00+09:00`);
  } finally {
    stub.restore();
  }
});

test("POST /item: 소설 일정은 작품과 유형이 함께 붙는다", async () => {
  const created = page("new3", { 이름: title("3화 초고"), 작품: select("챌린지"), 유형: select("초고"), 완료: checkbox(false), 날짜: dateProp(kstDay(1)) });
  const stub = stubFetch(() => jsonRes(created));
  try {
    const data = await (await post({ db: "novel", date: kstDay(1), name: "3화 초고", kind: "초고", work: "챌린지" })).json();
    assert.equal(data.list, "novel_items");
    assert.deepEqual(data.item.tags, ["챌린지", "초고"]);
    assert.equal(stub.calls[0].body.parent.database_id, "db-novel");
    assert.deepEqual(stub.calls[0].body.properties.유형, { select: { name: "초고" } });
    assert.deepEqual(stub.calls[0].body.properties.작품, { select: { name: "챌린지" } });
  } finally {
    stub.restore();
  }
});

test("POST /item: 허용 목록 밖의 종류·유형은 400", async () => {
  const stub = stubFetch(() => jsonRes({}));
  try {
    for (const body of [
      { db: "schedule", date: kstDay(0), name: "x", kind: "공휴일" },
      { db: "schedule", date: kstDay(0), name: "x", kind: "초고" }, // 소설 DB의 유형
      { db: "novel", date: kstDay(0), name: "x", kind: "할일" },
      { db: "novel", date: kstDay(0), name: "x", kind: "" },
    ]) {
      const res = await post(body);
      assert.equal(res.status, 400, JSON.stringify(body));
    }
    assert.equal(stub.calls.length, 0, "노션을 부르지도 않아야 한다");
  } finally {
    stub.restore();
  }
});

test("POST /item: 허용 창(±3일) 밖의 날짜는 403", async () => {
  const stub = stubFetch(() => jsonRes({}));
  try {
    for (const d of [kstDay(4), kstDay(-4), "2030-01-01"]) {
      const res = await post({ db: "schedule", date: d, name: "x", kind: "할일" });
      assert.equal(res.status, 403, d);
    }
    assert.equal((await post({ db: "schedule", date: "오늘", name: "x", kind: "할일" })).status, 400);
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test("POST /item: db 이름을 위조해도 다른 DB에는 못 쓴다", async () => {
  const stub = stubFetch(() => jsonRes({}));
  try {
    for (const db of ["db-schedule", "남의DB", "", null, { database_id: "x" }]) {
      const res = await post({ db, date: kstDay(0), name: "x", kind: "할일" });
      assert.equal(res.status, 400, String(db));
    }
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test("POST /item: 이름이 비었거나 너무 길면 400", async () => {
  const stub = stubFetch(() => jsonRes({}));
  try {
    assert.equal((await post({ db: "schedule", date: kstDay(0), name: "   ", kind: "할일" })).status, 400);
    assert.equal((await post({ db: "schedule", date: kstDay(0), name: "가".repeat(201), kind: "할일" })).status, 400);
    assert.equal((await post({ db: "novel", date: kstDay(0), name: "x", kind: "초고", work: "가".repeat(201) })).status, 400);
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test("POST /item: 임의의 속성은 통째로 무시한다 — 공휴일은 만들 수 없다", async () => {
  const created = page("new4", { 이름: title("x"), 종류: select("할일"), 날짜: dateProp(kstDay(0)) });
  const stub = stubFetch(() => jsonRes(created));
  try {
    await post({
      db: "schedule",
      date: kstDay(0),
      name: "x",
      kind: "할일",
      properties: { 공휴일: { checkbox: true } },
      공휴일: true,
      완료: true,
      parent: { database_id: "남의DB" },
    });
    const sent = stub.calls[0].body;
    assert.equal(sent.parent.database_id, "db-schedule");
    assert.deepEqual(Object.keys(sent.properties).sort(), ["날짜", "이름", "종류"]);
  } finally {
    stub.restore();
  }
});

test("POST /item: 본문이 JSON이 아니거나 노션이 실패하면 각각 400·502", async () => {
  const bad = await worker.fetch(
    new Request("https://w.dev/item", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }),
    ENV
  );
  assert.equal(bad.status, 400);

  const stub = stubFetch(() => new Response("nope", { status: 400 }));
  try {
    const res = await post({ db: "schedule", date: kstDay(0), name: "x", kind: "할일" });
    assert.equal(res.status, 502, "노션 쪽 실패는 502로 감싼다");
  } finally {
    stub.restore();
  }
});

test("GET /diag는 더 이상 없다(DB id를 아무에게나 알려주지 않는다)", async () => {
  const res = await worker.fetch(new Request("https://w.dev/diag"), ENV);
  assert.equal(res.status, 404);
  assert.equal((await res.text()).includes("db-schedule"), false);
});

test("OPTIONS 프리플라이트와 알 수 없는 경로", async () => {
  const opt = await worker.fetch(new Request("https://w.dev/item", { method: "OPTIONS" }), ENV);
  assert.equal(opt.status, 204);
  assert.equal(opt.headers.get("Access-Control-Allow-Methods"), "GET, POST, PATCH, OPTIONS");

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

test("한국 오전 시각이 붙은 일정은 UTC 기준으로 밀리지 않고 제 날짜에 잡힌다", () => {
  // 노션 date 필터는 UTC로 비교하므로 8/1 06:00(KST)=7/31 21:00(UTC)이 되어
  // equals 필터로는 하루 전에 걸려버렸다. 실사용 중 "가족 휴가(8/1 06:00)"가
  // 7/31에 뜨면서 발견된 버그 — 넓게 받아온 뒤 원본 날짜로 거르는지 확인한다.
  const 가족휴가 = page("fam", {
    이름: title("가족 휴가"),
    종류: select("일정"),
    날짜: dateProp("2026-08-01T06:00:00.000+09:00"),
  });
  const 어제일정 = page("old", {
    이름: title("어제 일"),
    종류: select("일정"),
    날짜: dateProp("2026-07-31T06:00:00.000+09:00"),
  });

  // 노션이 범위 필터로 두 건 다 돌려줘도, 워커가 날짜별로 정확히 갈라야 한다.
  const run = async (dateStr) => {
    const stub = stubFetch(() => jsonRes({ results: [가족휴가, 어제일정], has_more: false }));
    try {
      const res = await worker.fetch(new Request(`https://w.dev/today?date=${dateStr}`), ENV);
      return (await res.json()).special_items.map((i) => i.text);
    } finally {
      stub.restore();
    }
  };

  return Promise.all([run("2026-08-01"), run("2026-07-31")]).then(([sat, fri]) => {
    assert.deepEqual(sat, ["가족 휴가"], "8/1 06:00 일정은 8/1에 나와야 한다");
    assert.deepEqual(fri, ["어제 일"], "7/31 조회에 8/1 일정이 섞이면 안 된다");
  });
});

test("날짜만 있고 시각이 없는 항목(소설 일정 등)도 그대로 동작한다", async () => {
  const stub = stubFetch((url) => {
    const dbId = url.match(/databases\/([^/]+)\/query/)[1];
    if (dbId !== "db-novel") return jsonRes({ results: [], has_more: false });
    return jsonRes({
      results: [
        page("n1", { 이름: title("EP 4"), 작품: select("호위기사"), 유형: select("트리트먼트"), 날짜: dateProp("2026-08-01") }),
        page("n2", { 이름: title("46화"), 작품: select("챌린지"), 유형: select("초고"), 날짜: dateProp("2026-08-02") }),
      ],
      has_more: false,
    });
  });
  try {
    const res = await worker.fetch(new Request("https://w.dev/today?date=2026-08-01"), ENV);
    assert.deepEqual((await res.json()).novel_items.map((i) => i.text), ["EP 4"]);
  } finally {
    stub.restore();
  }
});
