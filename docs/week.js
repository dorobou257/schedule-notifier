// 이번 주 화면.
//
// 메인은 어디까지나 "오늘"이다. 이 화면은 그 옆에 붙는 조망용으로, 강의처럼
// 시각이 정해진 약속과 노션에 적힌 일정이 이번 주 어디에 걸려 있는지를 한눈에
// 보는 데만 쓴다. 그래서 여기서는 아무것도 고치지 않는다 — 완료 체크도 읽기
// 전용이다(7일치 낙관적 갱신 + 오프라인 큐까지 끌고 오면 복잡도가 급증하는데,
// 정작 체크는 오늘 화면에서 하면 된다).
//
// 계산은 오늘 화면과 같은 순수 함수를 그대로 쓴다. 다만 취침 기록·하루짜리
// 손질(dayTweaks)은 오늘에만 유효하므로, 오늘은 이미 계산해둔 결과를 그대로
// 받아 쓰고 나머지 날은 기본 기상 시각으로 계산한다.
import { hhmmToBoundaryMinutes, boundaryMinutesToHHMM } from "./routine.js";
import {
  lectureBlocks,
  computeDayWithLectures,
  applySemesterMealTimes,
  isWithinSemester,
  LECTURE_CATEGORY,
  DAY_NAMES,
} from "./lectures.js";
import { store, shiftDateKey } from "./store.js";
import { WORKER_URL } from "./config.js";

export const WEEK_DAYS = 7;

const FETCH_TIMEOUT_MS = 8000;

// ---------------------------------------------------------------
// 날짜 계산(순수)
// ---------------------------------------------------------------

/** "YYYY-MM-DD" → 월=0 … 일=6 (logicalWeekday와 같은 규칙). */
export function weekdayOfKey(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}

/** 그 날짜가 속한 주의 월요일. 주는 항상 월요일에 시작한다(DAY_NAMES와 같은 기준). */
export function weekStartKey(dateKey) {
  return shiftDateKey(dateKey, -weekdayOfKey(dateKey));
}

/** "2026-08-06" → "8월 6일". */
export function shortDateLabel(dateKey) {
  const [, m, d] = dateKey.split("-").map(Number);
  return `${m}월 ${d}일`;
}

// ---------------------------------------------------------------
// 하루씩 계산(순수) — 테스트가 직접 부르는 지점
// ---------------------------------------------------------------

/**
 * 7일치를 한 번에 만든다. 부작용 없는 순수 함수.
 *
 * @param {object} p
 * @param {string} p.startKey 주의 첫날(월요일)
 * @param {object|null} p.data 워커 /week 응답(없으면 노션 항목 없이 루틴만)
 * @param {Array} p.blocks 루틴 원본(store.blocks)
 * @param {object} p.settings store.settings
 * @param {Array} p.lectures store.lectures
 * @param {object} p.semester store.semester
 * @param {string} p.todayKey 오늘의 논리적 날짜
 * @param {Array|null} p.todayBlocks 오늘은 이미 계산된 결과를 그대로 쓴다
 *   (취침 기록·하루짜리 손질이 반영된 것과 어긋나면 안 된다)
 */
export function buildWeekDays({ startKey, data, blocks, settings, lectures, semester, todayKey, todayBlocks }) {
  const dayBoundaryHour = settings.dayBoundaryHour ?? 4;
  const wakeMinutes = hhmmToBoundaryMinutes(settings.baseWake, dayBoundaryHour);
  const days = (data && data.days) || {};

  const out = [];
  for (let i = 0; i < WEEK_DAYS; i++) {
    const dateKey = shiftDateKey(startKey, i);
    const weekday = weekdayOfKey(dateKey);
    const d = days[dateKey] || {};
    const holidayNames = d.holiday_names || [];
    const isToday = dateKey === todayKey;

    let dayBlocks;
    if (isToday && todayBlocks) {
      dayBlocks = todayBlocks;
    } else {
      const lecs = lectureBlocks(lectures, {
        dateKey,
        semester,
        isHoliday: holidayNames.length > 0,
        dayBoundaryHour,
      });
      const routine = isWithinSemester(dateKey, semester)
        ? applySemesterMealTimes(blocks, settings.semesterMeals, dayBoundaryHour)
        : blocks;
      dayBlocks = computeDayWithLectures({
        blocks: routine,
        lectures: lecs,
        settings,
        weekday,
        wakeMinutes,
      }).blocks;
    }

    out.push({
      dateKey,
      weekday,
      isToday,
      isPast: dateKey < todayKey,
      holidayNames,
      specialItems: d.special_items || [],
      todoItems: d.todo_items || [],
      novelItems: d.novel_items || [],
      blocks: dayBlocks,
      // 길이 0으로 눌린 블록은 그날 실제로는 없는 것이라 목록에서 뺀다.
      lectures: dayBlocks.filter((b) => b.category === LECTURE_CATEGORY && b.minutes > 0),
    });
  }
  return out;
}

// ---------------------------------------------------------------
// 화면 상태 — 이 화면을 열어둔 동안만 산다(새로고침하면 사라져도 무방).
// ---------------------------------------------------------------

const weekState = {
  startKey: null,
  data: null,
  loading: false,
  failed: false,
  expanded: new Set(), // 하루 전체 루틴을 펼쳐둔 날짜들
};

async function fetchWeek(startKey) {
  if (!WORKER_URL) return null;
  const res = await fetch(`${WORKER_URL.replace(/\/$/, "")}/week?start=${startKey}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error("week " + res.status);
  return res.json();
}

function loadWeek(rerender) {
  const wanted = weekState.startKey;
  weekState.loading = true;
  weekState.failed = false;
  weekState.data = null;
  fetchWeek(wanted)
    .then((data) => {
      // 그 사이 사용자가 다른 주로 넘어갔다면 늦게 온 응답은 버린다.
      if (weekState.startKey !== wanted) return;
      weekState.data = data;
      weekState.failed = !data;
    })
    .catch(() => {
      if (weekState.startKey === wanted) weekState.failed = true;
    })
    .finally(() => {
      if (weekState.startKey !== wanted) return;
      weekState.loading = false;
      rerender();
    });
}

/** 주간 화면을 연다(또는 오늘이 속한 주로 되돌린다). */
export function openWeek(todayKey, rerender) {
  weekState.startKey = weekStartKey(todayKey);
  weekState.expanded = new Set();
  loadWeek(rerender);
}

/** 이전/다음 주로 넘긴다. delta는 주 단위. */
export function gotoWeek(delta, rerender) {
  weekState.startKey = shiftDateKey(weekState.startKey, delta * WEEK_DAYS);
  weekState.expanded = new Set();
  loadWeek(rerender);
  // 응답을 기다렸다가 그리면 회선이 느릴 때 몇 초 동안 지난 주가 그대로 남는다
  // — 누른 게 먹혔는지 알 수 없어 두세 번 더 누르게 된다. 바뀐 주와 "불러오는
  // 중"을 먼저 보여주고, 데이터가 오면 loadWeek이 한 번 더 그린다.
  rerender();
}

/** 헤더에 걸 "8월 3일 – 8월 9일". */
export function weekRangeLabel() {
  if (!weekState.startKey) return "";
  return `${shortDateLabel(weekState.startKey)} – ${shortDateLabel(shiftDateKey(weekState.startKey, WEEK_DAYS - 1))}`;
}

// ---------------------------------------------------------------
// 렌더링
// ---------------------------------------------------------------

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  const { dataset, ...rest } = props;
  Object.assign(node, rest);
  if (dataset) Object.assign(node.dataset, dataset);
  children.forEach((c) => node.appendChild(c));
  return node;
}

// 블록 category(한글) → CSS data-cat 키. app.js의 것과 같은 표를 쓴다.
const ROUTINE_CAT = { "집필": "write", "작업": "work", "운동": "exercise", "여유": "rest", "식사": "rest", "기타": "other", "강의": "lecture" };

/**
 * 주간 화면 전체를 만들어 돌려준다.
 *
 * @param {object} p
 * @param {string} p.todayKey 오늘의 논리적 날짜
 * @param {Array} p.todayBlocks 오늘 화면이 이미 계산해둔 블록
 * @param {Function} p.rerender 다시 그리기(app.js의 renderShell)
 */
export function renderWeekView({ todayKey, todayBlocks, rerender }) {
  const dayBoundaryHour = store.settings.dayBoundaryHour;
  const wrap = el("div", { className: "week" });

  wrap.appendChild(renderWeekNav(rerender));

  if (weekState.loading) {
    wrap.appendChild(el("p", { className: "empty", textContent: "이번 주를 불러오는 중…" }));
    return wrap;
  }
  if (weekState.failed) {
    // 노션 항목만 없을 뿐 루틴·강의는 그대로 계산할 수 있다 — 빈 화면을 주는
    // 것보다 "무엇이 빠졌는지" 알리고 나머지를 보여주는 편이 낫다.
    wrap.appendChild(
      el("div", { className: "banner banner--holiday" }, [
        el("span", { textContent: "노션 일정을 불러오지 못했습니다. 루틴과 강의만 보여드립니다." }),
      ])
    );
  }

  const days = buildWeekDays({
    startKey: weekState.startKey,
    data: weekState.data,
    blocks: store.blocks,
    settings: store.settings,
    lectures: store.lectures,
    semester: store.semester,
    todayKey,
    todayBlocks,
  });

  wrap.appendChild(renderDayChips(days));
  days.forEach((day) => wrap.appendChild(renderDayCard(day, dayBoundaryHour, rerender)));
  return wrap;
}

function renderWeekNav(rerender) {
  const nav = el("div", { className: "week__nav" });
  const prev = el("button", { className: "week__nav-btn", textContent: "‹ 지난주", "aria-label": "지난주" });
  prev.addEventListener("click", () => gotoWeek(-1, rerender));
  const label = el("span", { className: "week__nav-label", textContent: weekRangeLabel() });
  const next = el("button", { className: "week__nav-btn", textContent: "다음주 ›", "aria-label": "다음주" });
  next.addEventListener("click", () => gotoWeek(1, rerender));
  nav.appendChild(prev);
  nav.appendChild(label);
  nav.appendChild(next);
  return nav;
}

/** 월~일 칩. 누르면 그날 카드로 스크롤한다. */
function renderDayChips(days) {
  const strip = el("div", { className: "week__chips" });
  days.forEach((day) => {
    const chip = el("button", {
      className:
        "week__chip" +
        (day.isToday ? " is-today" : "") +
        (day.isPast ? " is-past" : "") +
        (day.holidayNames.length ? " is-holiday" : ""),
    });
    chip.appendChild(el("span", { className: "week__chip-day", textContent: DAY_NAMES[day.weekday] }));
    chip.appendChild(el("span", { className: "week__chip-date mono", textContent: String(Number(day.dateKey.slice(8))) }));
    // 그날 실제로 걸려 있는 약속 수 — 점 하나로 "빈 날/바쁜 날"이 구분된다.
    const marks = day.lectures.length + day.specialItems.length;
    if (marks) chip.appendChild(el("span", { className: "week__chip-dot" }));
    chip.addEventListener("click", () => {
      document.getElementById(dayAnchorId(day.dateKey))?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    strip.appendChild(chip);
  });
  return strip;
}

const dayAnchorId = (dateKey) => `week-day-${dateKey}`;

function renderDayCard(day, dayBoundaryHour, rerender) {
  const section = el("section", {
    className: "card week__day" + (day.isToday ? " is-today" : "") + (day.isPast ? " is-past" : ""),
    id: dayAnchorId(day.dateKey),
  });

  const head = el("div", { className: "card-head" });
  head.appendChild(el("h2", { textContent: `${shortDateLabel(day.dateKey)} (${DAY_NAMES[day.weekday]})` }));
  if (day.isToday) head.appendChild(el("span", { className: "week__badge", textContent: "오늘" }));
  head.appendChild(el("span", { className: "spacer" }));
  const pending = day.todoItems.filter((it) => !it.done).length + day.novelItems.filter((it) => !it.done).length;
  if (pending) head.appendChild(el("span", { className: "count", textContent: `${pending}건` }));
  section.appendChild(head);

  if (day.holidayNames.length) {
    section.appendChild(
      el("p", { className: "week__holiday", textContent: "공휴일 · " + day.holidayNames.join(", ") })
    );
  }

  const ul = el("ul", { className: "rows" });
  let any = false;

  // 특별 일정이 먼저다 — 그날 하루를 통째로 내주는 종류라 가장 위에 온다.
  day.specialItems.forEach((it) => {
    any = true;
    ul.appendChild(weekRow(it.time, it.text, "일정", it.done));
  });
  // 그다음이 강의. 이 화면을 만든 이유이기도 하다.
  day.lectures.forEach((b) => {
    any = true;
    const time = `${boundaryMinutesToHHMM(b.start, dayBoundaryHour)}`;
    ul.appendChild(weekRow(time, b.name + (b.place ? ` · ${b.place}` : ""), "강의", false));
  });
  day.todoItems.forEach((it) => {
    any = true;
    ul.appendChild(weekRow(it.time, it.text, "할일", it.done));
  });
  day.novelItems.forEach((it) => {
    any = true;
    ul.appendChild(weekRow(it.time, it.text, (it.tags || []).filter(Boolean)[1] || "소설", it.done));
  });

  if (any) section.appendChild(ul);
  else section.appendChild(el("p", { className: "empty", textContent: "정해진 약속이 없습니다." }));

  // 하루 전체 루틴은 접어둔다. 일곱 날치를 모두 펼치면 훑어볼 수가 없다.
  const open = weekState.expanded.has(day.dateKey);
  if (open) section.appendChild(renderRoutineList(day, dayBoundaryHour));
  const toggle = el("button", {
    className: "agenda__toggle",
    textContent: open ? "루틴 접기" : "하루 전체 보기",
  });
  toggle.addEventListener("click", () => {
    if (open) weekState.expanded.delete(day.dateKey);
    else weekState.expanded.add(day.dateKey);
    rerender();
  });
  section.appendChild(toggle);

  return section;
}

function weekRow(time, text, tag, done) {
  const li = el("li", { className: "row" + (done ? " is-checked" : "") });
  const t = (time || "").trim();
  li.appendChild(el("span", { className: "chip-time mono" + (t ? "" : " empty"), textContent: t || "--" }));
  const body = el("div", { className: "row-body" });
  if (tag) body.appendChild(el("div", { className: "tags" }, [el("span", { className: "tag", textContent: tag })]));
  body.appendChild(el("span", { className: "text", textContent: text || "" }));
  li.appendChild(body);
  return li;
}

function renderRoutineList(day, dayBoundaryHour) {
  const ul = el("ul", { className: "agenda__list week__routine" });
  const endpoint = (b) => b.anchor === "wake" || b.anchor === "sleep";
  day.blocks
    .filter((b) => !endpoint(b) && b.minutes > 0)
    .forEach((b) => {
      const li = el("li", { className: "agenda__row", dataset: { cat: ROUTINE_CAT[b.category] || "other" } });
      li.appendChild(
        el("span", { className: "agenda__time mono", textContent: boundaryMinutesToHHMM(b.start, dayBoundaryHour) })
      );
      const body = el("div", { className: "agenda__body" });
      body.appendChild(el("span", { className: "agenda__name", textContent: b.name }));
      if (b.place) body.appendChild(el("span", { className: "agenda__novel", textContent: b.place }));
      li.appendChild(body);
      ul.appendChild(li);
    });

  const wake = day.blocks.find((b) => b.anchor === "wake");
  const sleep = day.blocks.find((b) => b.anchor === "sleep");
  const wrap = el("div");
  if (wake) {
    wrap.appendChild(
      el("p", {
        className: "agenda__endpoint",
        textContent: `${boundaryMinutesToHHMM(wake.start, dayBoundaryHour)} 기상`,
      })
    );
  }
  wrap.appendChild(ul);
  if (sleep) {
    wrap.appendChild(
      el("p", {
        className: "agenda__endpoint",
        textContent: `${boundaryMinutesToHHMM(sleep.start, dayBoundaryHour)} 취침`,
      })
    );
  }
  return wrap;
}
