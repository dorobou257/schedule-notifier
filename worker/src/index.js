/**
 * 일정 알리미 PWA ↔ 노션 중계 워커.
 *
 * PWA는 GitHub Pages의 정적 사이트라 노션을 직접 부를 수 없다 — 공개 저장소에
 * 토큰을 둘 수 없고, 노션 API는 브라우저 호출(CORS)도 막는다. 그래서 토큰을
 * 아는 건 이 워커뿐이고, 앱은 워커에게만 말을 건다.
 *
 * GET  /today?date=YYYY-MM-DD  오늘치 노션 데이터를 today.json과 같은 형태로.
 *                              항목마다 id와 done(완료 체크박스)이 붙는다.
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

async function queryDatabase(env, databaseId, dateStr) {
  const results = [];
  let cursor;
  do {
    const body = { filter: { property: "날짜", date: { equals: dateStr } } };
    if (cursor) body.start_cursor = cursor;
    const res = await fetch(`${NOTION_API}/databases/${databaseId}/query`, {
      method: "POST",
      headers: notionHeaders(env),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`노션 조회 실패(${res.status}) db=${databaseId} date=${dateStr}: ${detail || "(본문 없음)"}`);
    }
    const data = await res.json();
    results.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return results;
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

/** 이 페이지 id가 정말 우리 두 DB의 최근 날짜 항목인지 확인한다. */
async function isOwnPage(env, pageId) {
  const today = todayKST();
  for (let d = -PATCH_DAY_WINDOW; d <= PATCH_DAY_WINDOW; d++) {
    const dateStr = shiftDate(today, d);
    for (const dbId of [env.SCHEDULE_DB_ID, env.NOVEL_DB_ID]) {
      const pages = await queryDatabase(env, dbId, dateStr);
      if (pages.some((p) => p.id === pageId)) return true;
    }
  }
  return false;
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
    // 설정이 제대로 들어갔는지만 확인하는 용도. 토큰은 "그럴듯한 모양인지"만
    // 알려주고 값은 한 글자도 내보내지 않는다 — 공개 엔드포인트이기 때문이다.
    // (붙여넣기가 실패해 Ctrl+V 제어문자가 그대로 저장된 적이 있어서 남겨둠)
    if (request.method === "GET" && url.pathname === "/diag") {
      const t = env.NOTION_TOKEN || "";
      return json(
        {
          hasToken: !!t,
          tokenLength: t.length,
          tokenLooksValid: /^(secret_|ntn_)[A-Za-z0-9]+$/.test(t),
          scheduleDb: env.SCHEDULE_DB_ID || null,
          novelDb: env.NOVEL_DB_ID || null,
          today: todayKST(),
        },
        env
      );
    }
    try {
      if (request.method === "GET" && url.pathname === "/today") return await handleToday(request, env);
      if (request.method === "PATCH" && url.pathname === "/item") return await handleItem(request, env);
    } catch (e) {
      return json({ error: String(e && e.message ? e.message : e) }, env, 502);
    }
    return json({ error: "Not found" }, env, 404);
  },
};
