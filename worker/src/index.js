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
 * PATCH /item  {id, done}      해당 노션 페이지의 "완료" 체크박스를 바꾼다.
 *
 * 공개 PWA가 부르는 엔드포인트라 사용자 인증은 불가능하다. 대신
 * (1) CORS를 앱 도메인으로 고정하고 (2) PATCH 대상이 우리 두 DB에 속한
 * 최근 날짜 페이지인지 매번 다시 조회해서 확인한다. 그래서 최악의 경우도
 * "본인 오늘 할일 체크박스가 토글되는 것"에 그치고, 임의의 노션 페이지를
 * 건드리는 건 불가능하다.
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

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, PATCH, OPTIONS",
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
 * 이 페이지 id가 정말 우리 두 DB의 최근 날짜 항목인지 확인한다.
 *
 * 예전에는 오늘 ±3일 × DB 2개 = 14번을 순차로 조회해서 답을 찾았다. 체크박스
 * 한 번 누를 때마다 그게 다 돌아 몇 초씩 걸렸다. 페이지를 직접 한 번 읽으면
 * 부모 DB와 날짜가 같이 오므로 검증 강도는 그대로 두고 요청만 14 → 1이 된다.
 */
async function isOwnPage(env, pageId) {
  const res = await fetch(`${NOTION_API}/pages/${pageId}`, { headers: notionHeaders(env) });
  if (!res.ok) return false; // 없는 페이지거나 이 인티그레이션에 공유되지 않았다

  const page = await res.json();
  const ours = [env.SCHEDULE_DB_ID, env.NOVEL_DB_ID].map(normalizeId);
  if (!ours.includes(normalizeId(page.parent?.database_id))) return false;

  // 어제 못 지운 할일을 오늘 정리하는 정도는 되어야 하므로 앞뒤로 넉넉히 둔다.
  const today = todayKST();
  const date = startDateOf(page);
  return !!date && date >= shiftDate(today, -PATCH_DAY_WINDOW) && date <= shiftDate(today, PATCH_DAY_WINDOW);
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

async function handleItem(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "본문을 읽을 수 없습니다." }, env, 400);
  }
  const { id, done } = body || {};
  if (typeof id !== "string" || !id || typeof done !== "boolean") {
    return json({ error: "id(string)와 done(boolean)이 필요합니다." }, env, 400);
  }
  if (!(await isOwnPage(env, id))) {
    return json({ error: "이 앱이 다룰 수 있는 페이지가 아닙니다." }, env, 403);
  }

  const res = await fetch(`${NOTION_API}/pages/${id}`, {
    method: "PATCH",
    headers: notionHeaders(env),
    body: JSON.stringify({ properties: { [DONE_PROP]: { checkbox: done } } }),
  });
  if (!res.ok) {
    const text = await res.text();
    // "완료" 속성이 아직 없으면 노션이 400을 준다 — 원인을 그대로 알려준다.
    return json({ error: `노션 수정 실패(${res.status})`, detail: text }, env, 502);
  }
  return json({ ok: true, id, done }, env);
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
    } catch (e) {
      return json({ error: String(e && e.message ? e.message : e) }, env, 502);
    }
    return json({ error: "Not found" }, env, 404);
  },
};
