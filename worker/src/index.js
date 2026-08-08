/**
 * 일정 알리미 PWA ↔ 노션 중계 워커.
 *
 * PWA는 GitHub Pages의 정적 사이트라 노션을 직접 부를 수 없다 — 공개 저장소에
 * 토큰을 둘 수 없고, 노션 API는 브라우저 호출(CORS)도 막는다. 그래서 토큰을
 * 아는 건 이 워커뿐이고, 앱은 워커에게만 말을 건다.
 *
 * GET  /today?date=YYYY-MM-DD  오늘치 노션 데이터를 today.json과 같은 형태로.
 *                              항목마다 id와 done(완료 체크박스)이 붙는다.
 * GET  /week?start=YYYY-MM-DD  start부터 7일치를 날짜별로 담아서(주간 화면용).
 * POST   /item {db, date, ...}  일정/할일/과제나 소설 일정을 노션에 새로 만든다.
 * PATCH  /item {id, ...}        완료 체크·이름·종류·작품·날짜·시각을 고친다.
 * DELETE /item {id}             해당 페이지를 노션 휴지통으로 보낸다(보관).
 *
 * 공개 PWA가 부르는 엔드포인트라 사용자 인증은 불가능하다. 대신
 * (1) CORS를 앱 도메인으로 고정하고 (2) 손대는 대상이 우리 두 DB에 속한
 * 최근 날짜 페이지인지 매번 다시 조회해서 확인한다(ownPage). 그래서 최악의
 * 경우도 "본인의 최근 며칠치 할일이 흔들리는 것"에 그치고, 임의의 노션
 * 페이지를 건드리는 건 불가능하다.
 *
 * 만들기·고치기는 같은 강도로 막는다 — 인증이 없으니 **쓸 수 있는 모양 자체를
 * 좁히는 것**이 방어책이다. 대상 DB는 "schedule"/"novel" 두 이름으로만 고르고
 * 실제 DB id는 env에서만 온다(클라이언트가 DB id를 보내지 못한다). 고칠 때는
 * 그 이름조차 받지 않고 페이지의 부모 DB로 정한다. 날짜는 ±PATCH_DAY_WINDOW
 * 안이어야 하고, 종류·유형은 허용 목록과 정확히 일치해야 하며, 그 밖의 속성은
 * 아예 받지 않는다. 특히 "공휴일" 체크박스는 만들 수도 고칠 수도 없다 — 그건
 * 연간 스크립트(update_holidays.py)의 몫이다.
 *
 * 지우기는 완전 삭제가 아니라 보관이다. 노션 휴지통에서 30일 동안 되살릴 수
 * 있다 — 잘못 눌렀을 때 되돌릴 방법이 없으면 안 된다.
 *
 * 환경변수: NOTION_TOKEN(secret), SCHEDULE_DB_ID, NOVEL_DB_ID, ALLOWED_ORIGIN
 */

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const DONE_PROP = "완료";
const WEEKDAY_NAMES = ["월요일", "화요일", "수요일", "목요일", "금요일", "토요일", "일요일"];

// PATCH를 허용할 날짜 범위(오늘 기준 ±일). 어제 못 지운 할일을 오늘 정리하는
// 정도는 되어야 해서 넉넉히 둔다.
const PATCH_DAY_WINDOW = 3;

// /week가 한 번에 돌려주는 날짜 수.
const WEEK_DAYS = 7;

// POST /item으로 만들 수 있는 것의 전부. 여기 없는 DB도, 여기 없는 종류·유형도
// 만들 수 없다. 노션 쪽 select 옵션을 늘렸다면 여기도 같이 늘려야 한다.
const CREATABLE = {
  schedule: { dbEnv: "SCHEDULE_DB_ID", prop: "종류", kinds: ["일정", "할일", "과제"] },
  novel: { dbEnv: "NOVEL_DB_ID", prop: "유형", kinds: ["설정", "시놉시스", "트리트먼트", "초고", "퇴고", "연재"] },
};

/** 제목·작품 이름의 길이 상한. 노션 title은 훨씬 길어도 되지만 받을 이유가 없다. */
const MAX_TEXT = 200;

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body, env, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(env) },
  });
}

function notionHeaders(env) {
  return {
    Authorization: `Bearer ${env.NOTION_TOKEN}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

/** KST 기준 오늘 날짜(YYYY-MM-DD). 워커는 UTC로 도니 직접 9시간을 더한다. */
function todayKST() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function shiftDate(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 노션 date 속성의 시작 날짜(원본 문자열의 앞 10글자 = 입력한 그대로의 날짜). */
function startDateOf(page, prop = "날짜") {
  return (page.properties?.[prop]?.date?.start || "").slice(0, 10);
}

/**
 * [fromDate, toDate] 범위(양 끝 포함)의 페이지들을 가져온다.
 *
 * 노션의 date 필터는 타임스탬프를 UTC로 비교한다. 그래서 `equals: "2026-08-01"`은
 * 8월 1일 06:00(KST) 항목을 놓친다 — UTC로는 7월 31일 21:00이기 때문이다.
 * (한국 시각 오전 9시 이전이 붙은 일정이 전부 하루 전으로 밀렸다.)
 * 그래서 앞뒤로 넉넉한 범위를 받아온 뒤, 노션이 돌려준 원본 문자열의 날짜
 * 부분으로 직접 고른다 — 타임존 해석에 의존하지 않는다.
 *
 * 하루가 아니라 범위를 받는 이유: 주간 화면은 7일치가 필요한데 하루씩 7번
 * 부르면 DB당 7회, 두 DB면 14회가 된다. 범위로 한 번에 받으면 DB당 1회다.
 */
async function queryRange(env, databaseId, fromDate, toDate) {
  const results = [];
  let cursor;
  do {
    const body = {
      filter: {
        and: [
          { property: "날짜", date: { on_or_after: shiftDate(fromDate, -1) } },
          { property: "날짜", date: { before: shiftDate(toDate, 2) } },
        ],
      },
    };
    if (cursor) body.start_cursor = cursor;
    const res = await fetch(`${NOTION_API}/databases/${databaseId}/query`, {
      method: "POST",
      headers: notionHeaders(env),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `노션 조회 실패(${res.status}) db=${databaseId} range=${fromDate}~${toDate}: ${detail || "(본문 없음)"}`
      );
    }
    const data = await res.json();
    results.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return results.filter((p) => {
    const d = startDateOf(p);
    return d >= fromDate && d <= toDate;
  });
}

/** 하루치. queryRange의 특수한 경우일 뿐이다. */
const queryDatabase = (env, databaseId, dateStr) => queryRange(env, databaseId, dateStr, dateStr);

/** 페이지들을 시작 날짜별로 묶는다. */
function bucketByDate(pages) {
  const byDate = new Map();
  for (const p of pages) {
    const d = startDateOf(p);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(p);
  }
  return byDate;
}

// --- 노션 속성 읽기 (notify.py의 get_* 함수들과 같은 규칙) -----------------

const getTitle = (p, name = "이름") =>
  (p.properties?.[name]?.title || []).map((t) => t.plain_text || "").join("") || "(제목 없음)";
const getSelect = (p, name) => p.properties?.[name]?.select?.name || "";
const getCheckbox = (p, name) => !!p.properties?.[name]?.checkbox;
const getTime = (p, name = "날짜") => {
  const start = p.properties?.[name]?.date?.start || "";
  return start.includes("T") ? start.split("T", 2)[1].slice(0, 5) : "";
};

function buildTodayData(dateStr, schedulePages, novelPages) {
  const holidayPages = schedulePages.filter((p) => getCheckbox(p, "공휴일"));
  const specialPages = schedulePages.filter((p) => getSelect(p, "종류") === "일정");
  const todoPages = schedulePages.filter((p) => ["할일", "과제"].includes(getSelect(p, "종류")));

  const weekday = (new Date(dateStr + "T00:00:00Z").getUTCDay() + 6) % 7; // 월=0 … 일=6

  return {
    date: dateStr,
    weekday: WEEKDAY_NAMES[weekday],
    holiday_names: holidayPages.map((p) => getTitle(p)),
    special_items: specialPages.map((p) => ({
      id: p.id,
      time: getTime(p),
      text: getTitle(p),
      done: getCheckbox(p, DONE_PROP),
    })),
    todo_items: todoPages.map((p) => ({
      id: p.id,
      time: getTime(p),
      tags: [getSelect(p, "종류")],
      text: getTitle(p),
      done: getCheckbox(p, DONE_PROP),
    })),
    novel_items: novelPages.map((p) => ({
      id: p.id,
      time: getTime(p),
      tags: [getSelect(p, "작품"), getSelect(p, "유형")],
      text: getTitle(p),
      done: getCheckbox(p, DONE_PROP),
    })),
    source: "worker",
  };
}

/** 노션 id는 하이픈이 있을 수도 없을 수도 있다 — 같은 id인지 비교하려면 벗겨야 한다. */
const normalizeId = (id) => String(id || "").replace(/-/g, "").toLowerCase();

/**
 * 이 페이지 id가 정말 우리 두 DB의 최근 날짜 항목인지 확인하고, 맞으면 그
 * 페이지와 어느 DB인지를 함께 돌려준다.
 *
 * 예전에는 오늘 ±3일 × DB 2개 = 14번을 순차로 조회해서 답을 찾았다. 체크박스
 * 한 번 누를 때마다 그게 다 돌아 몇 초씩 걸렸다. 페이지를 직접 한 번 읽으면
 * 부모 DB와 날짜가 같이 오므로 검증 강도는 그대로 두고 요청만 14 → 1이 된다.
 *
 * 어느 DB인지도 여기서 정한다 — 수정할 때 종류·유형을 어느 목록으로 검사할지
 * 클라이언트에게 물으면 그 말을 믿어야 한다. 페이지의 부모가 답이다.
 *
 * @returns {{page: object, db: "schedule"|"novel"}|null}
 */
async function ownPage(env, pageId) {
  const res = await fetch(`${NOTION_API}/pages/${pageId}`, { headers: notionHeaders(env) });
  if (!res.ok) return null; // 없는 페이지거나 이 인티그레이션에 공유되지 않았다

  const page = await res.json();
  const parent = normalizeId(page.parent?.database_id);
  const db = parent === normalizeId(env.SCHEDULE_DB_ID) ? "schedule" : parent === normalizeId(env.NOVEL_DB_ID) ? "novel" : null;
  if (!db) return null;

  // 어제 못 지운 할일을 오늘 정리하는 정도는 되어야 하므로 앞뒤로 넉넉히 둔다.
  if (!withinWindow(startDateOf(page))) return null;
  return { page, db };
}

/** "HH:MM"이 실제로 존재하는 시각인지. \d{2}:\d{2}만 보면 25:00이 통과한다. */
const isHHMM = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

/** 이 앱이 건드릴 수 있는 날짜인지(오늘 ±PATCH_DAY_WINDOW). */
function withinWindow(date) {
  if (!date) return false;
  const today = todayKST();
  return date >= shiftDate(today, -PATCH_DAY_WINDOW) && date <= shiftDate(today, PATCH_DAY_WINDOW);
}

/** 노션 date 속성 값. 시각이 있으면 KST 오프셋을 명시한다(안 그러면 아홉 시간 밀린다). */
const dateValue = (date, time) => (time ? `${date}T${time}:00+09:00` : date);

/** 만들어지거나 고쳐진 페이지를 조회 결과와 같은 항목 모양으로. */
function itemOf(db, page) {
  const date = startDateOf(page);
  const data = db === "novel" ? buildTodayData(date, [], [page]) : buildTodayData(date, [page], []);
  const list = db === "novel" ? "novel_items" : getSelect(page, "종류") === "일정" ? "special_items" : "todo_items";
  return { list, item: data[list][0] };
}

async function handleToday(request, env) {
  const url = new URL(request.url);
  const dateStr = url.searchParams.get("date") || todayKST();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return json({ error: "날짜 형식이 잘못되었습니다." }, env, 400);

  const [schedulePages, novelPages] = await Promise.all([
    queryDatabase(env, env.SCHEDULE_DB_ID, dateStr),
    queryDatabase(env, env.NOVEL_DB_ID, dateStr),
  ]);
  return json(buildTodayData(dateStr, schedulePages, novelPages), env);
}

/** 주간 화면용. start부터 7일치를 /today와 같은 형태로 날짜별로 담아 돌려준다. */
async function handleWeek(request, env) {
  const url = new URL(request.url);
  const start = url.searchParams.get("start") || todayKST();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return json({ error: "날짜 형식이 잘못되었습니다." }, env, 400);
  const end = shiftDate(start, WEEK_DAYS - 1);

  // DB당 한 번씩, 총 두 번만 조회한다(하루씩 부르면 14번이 된다).
  const [schedulePages, novelPages] = await Promise.all([
    queryRange(env, env.SCHEDULE_DB_ID, start, end),
    queryRange(env, env.NOVEL_DB_ID, start, end),
  ]);
  const schedule = bucketByDate(schedulePages);
  const novel = bucketByDate(novelPages);

  const days = {};
  for (let i = 0; i < WEEK_DAYS; i++) {
    const d = shiftDate(start, i);
    days[d] = buildTodayData(d, schedule.get(d) || [], novel.get(d) || []);
  }
  return json({ start, end, days, source: "worker" }, env);
}

/**
 * 항목 고치기. 완료 체크만 하던 자리인데 이름·종류·작품·날짜·시각까지 받는다.
 *
 * 만들 때와 같은 허용 목록을 그대로 쓴다 — 만들 수 없는 것을 고쳐서 만들어낼 수
 * 있으면 허용 목록이 무의미하다. 어느 목록으로 검사할지는 페이지의 부모 DB가
 * 정한다(ownPage). 보내지 않은 속성은 건드리지 않는다.
 */
async function handleItem(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "본문을 읽을 수 없습니다." }, env, 400);
  }
  const { id, done, name, kind, work, date, time } = body || {};
  if (typeof id !== "string" || !id) return json({ error: "id(string)가 필요합니다." }, env, 400);

  const owned = await ownPage(env, id);
  if (!owned) return json({ error: "이 앱이 다룰 수 있는 페이지가 아닙니다." }, env, 403);
  const spec = CREATABLE[owned.db];

  const properties = {};

  if (done !== undefined) {
    if (typeof done !== "boolean") return json({ error: "done은 boolean이어야 합니다." }, env, 400);
    properties[DONE_PROP] = { checkbox: done };
  }

  if (name !== undefined) {
    const text = typeof name === "string" ? name.trim() : "";
    if (!text || text.length > MAX_TEXT) return json({ error: "이름이 비었거나 너무 깁니다." }, env, 400);
    properties["이름"] = { title: [{ text: { content: text } }] };
  }

  if (kind !== undefined) {
    if (!spec.kinds.includes(kind)) {
      return json({ error: `${spec.prop}는 ${spec.kinds.join("/")} 중 하나여야 합니다.` }, env, 400);
    }
    properties[spec.prop] = { select: { name: kind } };
  }

  if (work !== undefined) {
    if (owned.db !== "novel") return json({ error: "작품은 소설 일정에만 있습니다." }, env, 400);
    const workName = typeof work === "string" ? work.trim() : "";
    if (workName.length > MAX_TEXT) return json({ error: "작품 이름이 너무 깁니다." }, env, 400);
    // 빈 값은 "지운다"는 뜻이다 — 작품을 잘못 붙였을 때 되돌릴 방법이 있어야 한다.
    properties["작품"] = workName ? { select: { name: workName } } : { select: null };
  }

  if (date !== undefined || time !== undefined) {
    // 시각만 고칠 때는 지금 적혀 있는 날짜를 그대로 쓴다.
    const day = date === undefined ? startDateOf(owned.page) : date;
    if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return json({ error: "날짜 형식이 잘못되었습니다." }, env, 400);
    }
    if (!withinWindow(day)) return json({ error: "이 앱이 다룰 수 있는 날짜가 아닙니다." }, env, 403);
    if (time != null && time !== "" && !isHHMM(time)) {
      return json({ error: "시각 형식이 잘못되었습니다." }, env, 400);
    }
    properties["날짜"] = { date: { start: dateValue(day, time) } };
  }

  if (!Object.keys(properties).length) return json({ error: "고칠 내용이 없습니다." }, env, 400);

  const res = await fetch(`${NOTION_API}/pages/${id}`, {
    method: "PATCH",
    headers: notionHeaders(env),
    body: JSON.stringify({ properties }),
  });
  if (!res.ok) {
    const text = await res.text();
    // "완료" 속성이 아직 없으면 노션이 400을 준다 — 원인을 그대로 알려준다.
    return json({ error: `노션 수정 실패(${res.status})`, detail: text }, env, 502);
  }
  // done만 보낸 예전 호출도 그대로 쓰던 응답을 받는다.
  return json({ ok: true, id, ...(done !== undefined ? { done } : {}), ...itemOf(owned.db, await res.json()) }, env);
}

/**
 * 항목 지우기. 노션에서 "지운다"는 건 보관(휴지통으로 옮기기)이다 — 30일 동안
 * 되살릴 수 있다. 잘못 눌렀을 때 되돌릴 방법이 없으면 안 되므로 완전 삭제는
 * 하지 않는다(체크해도 목록에서 안 지우는 것과 같은 이유다).
 */
async function handleDeleteItem(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "본문을 읽을 수 없습니다." }, env, 400);
  }
  const { id } = body || {};
  if (typeof id !== "string" || !id) return json({ error: "id(string)가 필요합니다." }, env, 400);
  if (!(await ownPage(env, id))) {
    return json({ error: "이 앱이 다룰 수 있는 페이지가 아닙니다." }, env, 403);
  }

  const res = await fetch(`${NOTION_API}/pages/${id}`, {
    method: "PATCH",
    headers: notionHeaders(env),
    body: JSON.stringify({ archived: true }),
  });
  if (!res.ok) {
    const text = await res.text();
    return json({ error: `노션 보관 실패(${res.status})`, detail: text }, env, 502);
  }
  return json({ ok: true, id, archived: true }, env);
}

/** 앱이 만든 항목을 노션 페이지로 남긴다. 받을 수 있는 모양은 CREATABLE이 전부다. */
async function handleCreateItem(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "본문을 읽을 수 없습니다." }, env, 400);
  }
  const { db, date, name, kind, work, time } = body || {};

  const spec = CREATABLE[db];
  if (!spec) return json({ error: "db는 schedule 또는 novel이어야 합니다." }, env, 400);

  const text = typeof name === "string" ? name.trim() : "";
  if (!text || text.length > MAX_TEXT) return json({ error: "이름이 비었거나 너무 깁니다." }, env, 400);

  if (!spec.kinds.includes(kind)) {
    return json({ error: `${spec.prop}는 ${spec.kinds.join("/")} 중 하나여야 합니다.` }, env, 400);
  }

  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({ error: "날짜 형식이 잘못되었습니다." }, env, 400);
  }
  // 체크와 같은 범위. "오늘 할 일을 적는다"가 이 앱의 쓰임이라 그 밖으로 나갈 이유가 없다.
  if (!withinWindow(date)) return json({ error: "이 앱이 다룰 수 있는 날짜가 아닙니다." }, env, 403);

  if (time != null && time !== "" && !isHHMM(time)) {
    return json({ error: "시각 형식이 잘못되었습니다." }, env, 400);
  }

  const properties = {
    이름: { title: [{ text: { content: text } }] },
    날짜: { date: { start: dateValue(date, time) } },
    [spec.prop]: { select: { name: kind } },
  };
  if (db === "novel") {
    const workName = typeof work === "string" ? work.trim() : "";
    if (workName.length > MAX_TEXT) return json({ error: "작품 이름이 너무 깁니다." }, env, 400);
    if (workName) properties["작품"] = { select: { name: workName } };
  }

  const res = await fetch(`${NOTION_API}/pages`, {
    method: "POST",
    headers: notionHeaders(env),
    body: JSON.stringify({ parent: { database_id: env[spec.dbEnv] }, properties }),
  });
  if (!res.ok) {
    const detail = await res.text();
    return json({ error: `노션 생성 실패(${res.status})`, detail }, env, 502);
  }
  // 목록에 그대로 꽂을 수 있도록 조회 결과와 같은 모양으로 돌려준다.
  return json({ ok: true, ...itemOf(db, await res.json()) }, env);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }
    // /diag는 뺐다. 설정이 들어갔는지 확인하는 일회성 용도였는데, 인증이 없는
    // 공개 엔드포인트라 DB id 두 개를 아무에게나 알려주고 있었다. 다시 필요하면
    // `npx wrangler tail`로 로그를 보는 편이 낫다.
    try {
      if (request.method === "GET" && url.pathname === "/today") return await handleToday(request, env);
      if (request.method === "GET" && url.pathname === "/week") return await handleWeek(request, env);
      if (request.method === "PATCH" && url.pathname === "/item") return await handleItem(request, env);
      if (request.method === "POST" && url.pathname === "/item") return await handleCreateItem(request, env);
      if (request.method === "DELETE" && url.pathname === "/item") return await handleDeleteItem(request, env);
    } catch (e) {
      return json({ error: String(e && e.message ? e.message : e) }, env, 502);
    }
    return json({ error: "Not found" }, env, 404);
  },
};
