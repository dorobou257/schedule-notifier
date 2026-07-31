// 상태·렌더링·상호작용. routine.js의 순수 계산 결과를 화면에 붙이는 역할만
// 한다 — 스케줄 계산 로직은 여기 두지 않는다(테스트 가능하게 분리 유지).
import {
  BASE_BLOCKS,
  DEFAULT_SETTINGS,
  computeSchedule,
  computeWakeMinutes,
  hhmmToBoundaryMinutes,
  boundaryMinutesToHHMM,
  dateToBoundaryMinutes,
  logicalWeekday,
  logicalDateKey,
  applyVisibleOrder,
} from "./routine.js";
import { WORKER_URL } from "./config.js";

const STORAGE_KEY = "schedule.v1";
const WEEKDAY_NAMES = ["월요일", "화요일", "수요일", "목요일", "금요일", "토요일", "일요일"];

// 블록 category(한글) → CSS data-cat 키(5색). 노션 태그도 같은 5색을 공유한다.
const ROUTINE_CAT = { "집필": "write", "작업": "work", "운동": "exercise", "여유": "rest", "식사": "rest", "기타": "other" };
const TODO_CAT = { "할일": "work", "과제": "write" };
const NOVEL_STAGE_CAT = { "설정": "other", "시놉시스": "work", "트리트먼트": "work", "초고": "write", "퇴고": "rest", "연재": "exercise" };

const ICONS = {
  clock: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>',
  check: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12.5 2.5 2.5 5-5"/></svg>',
  book: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
  holiday: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2.5c.35 0 .67.2.83.51l2.3 4.66 5.14.75a.93.93 0 0 1 .52 1.58l-3.72 3.63.88 5.12a.93.93 0 0 1-1.35.98L12 16.9l-4.6 2.42a.93.93 0 0 1-1.35-.98l.88-5.12-3.72-3.63a.93.93 0 0 1 .52-1.58l5.14-.75 2.3-4.66c.16-.31.48-.51.83-.51Z"/></svg>',
  refresh: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>',
  gear: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.05.05a2.06 2.06 0 1 1-2.92 2.92l-.05-.05a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2.06 2.06 0 1 1-4.13 0v-.08A1.7 1.7 0 0 0 8.7 19.4a1.7 1.7 0 0 0-1.87.34l-.05.05a2.06 2.06 0 1 1-2.92-2.92l.05-.05a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H2.6a2.06 2.06 0 1 1 0-4.13h.08A1.7 1.7 0 0 0 4.3 8.7a1.7 1.7 0 0 0-.34-1.87l-.05-.05A2.06 2.06 0 1 1 6.83 3.9l.05.05a1.7 1.7 0 0 0 1.87.34H8.9a1.7 1.7 0 0 0 1-1.55V2.6a2.06 2.06 0 1 1 4.13 0v.08a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.05-.05a2.06 2.06 0 1 1 2.92 2.92l-.05.05a1.7 1.7 0 0 0-.34 1.87v.15a1.7 1.7 0 0 0 1.55 1H21.4a2.06 2.06 0 1 1 0 4.13h-.08a1.7 1.7 0 0 0-1.55 1z"/></svg>',
  grip: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="8" cy="6" r="1.6"/><circle cx="16" cy="6" r="1.6"/><circle cx="8" cy="12" r="1.6"/><circle cx="16" cy="12" r="1.6"/><circle cx="8" cy="18" r="1.6"/><circle cx="16" cy="18" r="1.6"/></svg>',
  chevron: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
  plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
  trash: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h10l1-13"/></svg>',
  close: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  moon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/></svg>',
};

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  const { dataset, ...rest } = props;
  Object.assign(node, rest);
  if (dataset) Object.assign(node.dataset, dataset);
  children.forEach((c) => node.appendChild(c));
  return node;
}

/** "집필" → "집필로", "작업" → "작업으로". 받침이 없거나 ㄹ이면 "로"가 붙는다. */
function josaRo(word) {
  const last = word.charCodeAt(word.length - 1) - 0xac00;
  const jong = last >= 0 && last <= 11171 ? last % 28 : -1;
  return word + (jong === 0 || jong === 8 ? "로" : "으로");
}

function formatDuration(mins) {
  const m = Math.round(mins);
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h && rest) return `${h}시간 ${rest}분`;
  if (h) return `${h}시간`;
  return `${rest}분`;
}

// ---------------------------------------------------------------
// 저장소 — localStorage 단일 키. 쓰기는 디바운스, 확정 동작(적용/되돌리기
// 등)은 즉시 쓴다.
// ---------------------------------------------------------------

function emptySleep() {
  // forDate: 이 취침 기록이 "어느 논리적 날짜의 기상"을 예측하는지. 취침은 보통
  // 밤에 기록하므로 forDate는 대개 지금(now)의 논리적 날짜보다 하루 뒤다 —
  // 그래서 그날 밤 동안은 "예정" 상태로만 저장해두고, 실제로 그 날짜가 되어야
  // 오늘 일정 계산에 반영한다(applySleepToday 참고).
  return { forDate: null, bedAt: null, wakeOverride: null, protectedOverrides: [], accepted: false };
}

/** "YYYY-MM-DD" 하루 뒤의 같은 형식 날짜 키. */
function nextDateKey(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(y, m - 1, d + 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function defaultStore() {
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    blocks: BASE_BLOCKS.map((b) => ({ ...b })),
    presets: {},
    today: emptySleep(),
    // 그날 하루만 적용되는 손질. 날짜가 바뀌면 통째로 비운다.
    //   categories[blockId]: 오늘만 이 블록을 다른 성격으로 취급(집필↔작업)
    //   showRoutine: 특별 일정이 있는 날에도 루틴을 펼쳐서 볼지
    dayTweaks: { date: null, categories: {}, showRoutine: false },
    // 소설 일정 ↔ 집필 블록 배정. map[blockId] = 소설 항목 키(사용자가 직접 지정),
    // excluded = 어디에도 배정하지 않기로 한 항목 키들. 둘 다 해당 없는 항목은
    // 남은 집필 블록에 순서대로 자동 배정된다. 날짜가 바뀌면 통째로 비운다.
    novelAssign: { date: null, map: {}, excluded: [] },
  };
}

/** 소설 항목의 안정적인 키. 노션 페이지 id가 있으면 그걸 쓰고, 아직
 *  today.json이 갱신되지 않아 id가 없으면 내용으로 키를 만든다. */
function novelKey(item) {
  return item.id || `${(item.tags || []).join("/")}|${item.text || ""}`;
}

function migrate(parsed) {
  const base = defaultStore();
  return {
    version: 1,
    settings: { ...base.settings, ...(parsed.settings || {}) },
    blocks: Array.isArray(parsed.blocks) && parsed.blocks.length ? parsed.blocks : base.blocks,
    presets: parsed.presets && typeof parsed.presets === "object" ? parsed.presets : {},
    today: parsed.today && typeof parsed.today === "object" ? { ...emptySleep(), ...parsed.today } : base.today,
    dayTweaks:
      parsed.dayTweaks && typeof parsed.dayTweaks.categories === "object"
        ? {
            date: parsed.dayTweaks.date || null,
            categories: parsed.dayTweaks.categories,
            showRoutine: !!parsed.dayTweaks.showRoutine,
          }
        : base.dayTweaks,
    novelAssign:
      parsed.novelAssign && typeof parsed.novelAssign.map === "object"
        ? {
            date: parsed.novelAssign.date || null,
            map: parsed.novelAssign.map,
            excluded: Array.isArray(parsed.novelAssign.excluded) ? parsed.novelAssign.excluded : [],
          }
        : base.novelAssign,
  };
}

function loadStore() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (!raw) return defaultStore();
  try {
    return migrate(JSON.parse(raw));
  } catch {
    return defaultStore();
  }
}

let saveTimer = null;
function saveStore(immediate) {
  const write = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      /* localStorage 접근 불가(사생활 보호 모드 등) — 조용히 무시, 세션 동안은 메모리 상태로 계속 동작 */
    }
  };
  clearTimeout(saveTimer);
  if (immediate) {
    write();
  } else {
    saveTimer = setTimeout(write, 400);
  }
}

let store = loadStore();

/**
 * 취침 기록이 예측하는 날짜(forDate)가 이미 지나버렸으면(오늘보다 이전이면)
 * 낡은 기록이니 비운다. forDate가 오늘이거나(적용 중) 내일이면(아직 밤이라
 * 대기 중) 그대로 둔다 — 이 둘을 구분 못 하고 무조건 지우면, 밤에 기록해둔
 * 취침이 자정~새벽 사이 논리적 날짜가 바뀌는 순간 적용되기도 전에 사라진다.
 */
function rolloverIfStale(now) {
  const todayKey = logicalDateKey(now, store.settings.dayBoundaryHour);
  if (store.today.forDate && store.today.forDate < todayKey) {
    store.today = emptySleep();
    saveStore(true);
    state.proposalDismissed = false;
  }
  // 소설 배정은 그날 하루짜리다 — 날짜가 바뀌면 비우고 다시 자동 배정한다.
  if (store.novelAssign.date !== todayKey) {
    store.novelAssign = { date: todayKey, map: {}, excluded: [] };
    saveStore(true);
  }
  // 집필↔작업 교체도 오늘 하루짜리 — 내일은 원래 루틴으로 돌아간다.
  if (store.dayTweaks.date !== todayKey) {
    store.dayTweaks = { date: todayKey, categories: {}, showRoutine: false };
    saveStore(true);
  }
}

// ---------------------------------------------------------------
// 스케줄 계산 — routine.js 호출부. 제안 시트에서 토글할 때도 이 함수를
// 그대로 재사용해 실시간으로 다시 계산한다.
// ---------------------------------------------------------------

/** 취침 기록이 "오늘"(forDate === todayKey)에 대한 것일 때만 실제 계산에 반영한다.
 * 저녁에 미리 기록해둔 내일치 예측은 그 논리적 날짜가 되기 전까지는 오늘
 * 화면에 영향을 주지 않는다. */
function isSleepActive(now, dayBoundaryHour) {
  return store.today.forDate === logicalDateKey(now, dayBoundaryHour);
}

function getWakeMinutes(dayBoundaryHour, now) {
  const baseWakeMinutes = hhmmToBoundaryMinutes(store.settings.baseWake, dayBoundaryHour);
  const active = isSleepActive(now, dayBoundaryHour);
  const bedAtMinutes = active && store.today.bedAt ? dateToBoundaryMinutes(new Date(store.today.bedAt), dayBoundaryHour) : null;
  const wakeOverrideMinutes =
    active && store.today.wakeOverride ? dateToBoundaryMinutes(new Date(store.today.wakeOverride), dayBoundaryHour) : null;
  return computeWakeMinutes({
    bedAtMinutes,
    wakeOverrideMinutes,
    sleepTargetMinutes: store.settings.sleepTargetMinutes,
    baseWakeMinutes,
  });
}

/**
 * 오늘 밤 취침으로 실제 기록된 시각. wakeMinutes와 반대로 "활성화되지 않은
 * 동안"(forDate가 아직 오늘이 아닐 때, 즉 오늘 밤 예정 상태) 적용된다 —
 * 그 bedAt은 "지금부터 forDate까지"의 취침을 뜻하므로, forDate가 실제로
 * 되어 그 전환이 이미 끝난 뒤에는(활성화된 뒤에는) 오늘 밤 것이 아니게 된다.
 */
function getSleepOverrideMinutes(now, dayBoundaryHour) {
  if (isSleepActive(now, dayBoundaryHour)) return null;
  if (!store.today.bedAt) return null;
  return dateToBoundaryMinutes(new Date(store.today.bedAt), dayBoundaryHour);
}

/** protectedIds: 제안 시트에서 사용자가 체크 해제해 "오늘은 지키자"고 정한 블록 id 집합.
 * 커밋된 값은 store.today.protectedOverrides, 시트 안에서 토글하는 동안은 임시 값을 넘긴다. */
function computeForToday(now, protectedIds) {
  const dayBoundaryHour = store.settings.dayBoundaryHour;
  const weekday = logicalWeekday(now, dayBoundaryHour);
  const wakeMinutes = getWakeMinutes(dayBoundaryHour, now);
  const sleepMinutes = getSleepOverrideMinutes(now, dayBoundaryHour);
  const overrides = protectedIds || new Set(store.today.protectedOverrides || []);
  // 오늘만 성격을 바꾼 블록(집필↔작업)을 여기서 갈아끼운다 — 루틴 자체는 건드리지 않는다.
  const swaps = store.dayTweaks.categories || {};
  const blocks = store.blocks.map((b) => {
    const category = swaps[b.id] && swaps[b.id] !== b.category ? swaps[b.id] : null;
    if (!overrides.has(b.id) && !category) return b;
    return { ...b, ...(overrides.has(b.id) ? { protected: true } : {}), ...(category ? { category } : {}) };
  });
  const settings = {
    ...store.settings,
    dropBreakfastWhenLate: overrides.has("breakfast") ? false : store.settings.dropBreakfastWhenLate,
  };
  return { result: computeSchedule({ blocks, settings, weekday, wakeMinutes, sleepMinutes }), wakeMinutes };
}

// ---------------------------------------------------------------
// 전역 UI 상태(세션 한정 — 새로고침하면 초기화되어도 무방한 것들)
// ---------------------------------------------------------------

const state = {
  todayData: null, // today.json 파싱 결과
  computed: null, // 마지막 computeForToday().result
  agendaExpanded: false,
  agendaReorder: false, // 메인 화면 "오늘 하루"의 순서 편집 모드
  activeSheet: null, // null | 'proposal' | 'editor' | 'settings'
  proposalDismissed: false,
  editorBlocks: null, // 편집 시트 열려있는 동안의 작업 사본
  nowCardEls: null,
  novelAssignments: new Map(), // blockId → 소설 항목 (renderMain에서 매번 계산)
};

// ---------------------------------------------------------------
// 노션 데이터 불러오기.
//
// 워커 주소가 설정돼 있으면 노션을 직접 조회해 지금 상태를 그대로 받는다
// (체크한 할일이 바로 사라진다). 워커가 없거나 실패하면 GitHub Actions가
// 하루 한 번 만들어두는 today.json으로 폴백한다 — 오프라인에서도 열린다.
// ---------------------------------------------------------------

function setStatus(text) {
  const statusEl = document.getElementById("status");
  if (statusEl) statusEl.textContent = text || "";
}

// 날짜를 반드시 앱이 정해서 넘긴다. 이 앱의 하루는 dayBoundaryHour(기본 04:00)
// 기준이라 새벽 0~4시엔 아직 "어제"인데, 워커에게 맡기면 달력 날짜를 쓰기 때문에
// 루틴은 어제 것인데 할일·소설만 오늘 것이 뜨는 어긋남이 생긴다.
async function fetchFromWorker(dateKey) {
  if (!WORKER_URL) return null;
  const res = await fetch(`${WORKER_URL.replace(/\/$/, "")}/today?date=${dateKey}`, { cache: "no-store" });
  if (!res.ok) throw new Error("worker " + res.status);
  return res.json();
}

async function loadTodayJson(isRefresh) {
  const btn = document.getElementById("refresh-btn");
  if (isRefresh && btn) btn.classList.add("spin");
  const dateKey = logicalDateKey(new Date(), store.settings.dayBoundaryHour);
  try {
    let data = null;
    try {
      data = await fetchFromWorker(dateKey);
    } catch {
      data = null; // 워커가 죽었거나 오프라인 — 아래 today.json으로 내려간다
    }
    if (!data) {
      const res = await fetch("./today.json?t=" + Date.now(), { cache: "no-store" });
      data = await res.json();
    }
    state.todayData = data;
    setStatus(WORKER_URL && data.source !== "worker" ? "노션에 연결하지 못해 마지막 저장본을 보여드립니다." : "");
  } catch (e) {
    setStatus("새 데이터를 불러오지 못했습니다. 이전 화면을 보여드립니다.");
    if (!state.todayData) state.todayData = {};
  } finally {
    if (btn) setTimeout(() => btn.classList.remove("spin"), 600);
  }
  flushPendingChecks();
  renderShell();
}

// ---------------------------------------------------------------
// 체크박스 → 노션 반영. 화면은 먼저 바꾸고(낙관적 갱신) 실패하면 되돌린다.
// 오프라인이면 큐에 쌓아두고 다음에 앱을 열 때 몰아서 보낸다.
// ---------------------------------------------------------------

const PENDING_KEY = "schedule.pendingChecks";

function readPending() {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePending(list) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(list));
  } catch {
    /* 저장 불가 — 이번 세션 안에서만 잃는다 */
  }
}

function queuePending(id, done) {
  const list = readPending().filter((p) => p.id !== id);
  list.push({ id, done });
  writePending(list);
}

async function patchNotion(id, done) {
  const res = await fetch(`${WORKER_URL.replace(/\/$/, "")}/item`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, done }),
  });
  if (!res.ok) throw new Error("patch " + res.status);
}

/** 밀린 체크를 순서대로 보낸다. 하나라도 실패하면 그것부터 다시 큐에 남긴다. */
async function flushPendingChecks() {
  if (!WORKER_URL) return;
  const list = readPending();
  if (!list.length) return;
  const remaining = [];
  for (const item of list) {
    try {
      await patchNotion(item.id, item.done);
    } catch {
      remaining.push(item);
    }
  }
  writePending(remaining);
}

/** 할일/소설 항목의 완료 상태를 바꾼다. @returns 성공 여부 */
async function setItemDone(item, done) {
  item.done = done; // 화면에 이미 반영된 상태(낙관적)
  if (!WORKER_URL) return true; // 워커가 없으면 이 기기에만 남는다
  try {
    await patchNotion(item.id, done);
    return true;
  } catch {
    queuePending(item.id, done);
    setStatus("노션에 바로 반영하지 못했습니다. 다음에 열 때 다시 시도합니다.");
    return false;
  }
}

// ---------------------------------------------------------------
// 렌더링 — 오늘 화면
// ---------------------------------------------------------------

function renderShell() {
  const now = new Date();
  rolloverIfStale(now);

  const { result, wakeMinutes } = computeForToday(now);
  state.computed = result;
  state.wakeMinutes = wakeMinutes;

  renderHeader(now);
  renderMain(now);
  renderSleepBar();
  scheduleTick();
  maybeShowProposal();
}

function renderHeader(now) {
  const d = state.todayData || {};
  // 노션이 준 "2026-07-31"을 그대로 걸어두면 지금이 며칠인지 한눈에 안 들어온다.
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d.date || "");
  document.getElementById("date-label").textContent = iso
    ? `${Number(iso[2])}월 ${Number(iso[3])}일`
    : d.date || `${now.getMonth() + 1}월 ${now.getDate()}일`;
  document.getElementById("weekday-label").textContent = d.weekday || WEEKDAY_NAMES[logicalWeekday(now, store.settings.dayBoundaryHour)];
}

function renderMain(now) {
  const app = document.getElementById("app");
  app.innerHTML = "";
  const d = state.todayData || {};
  // 완료 여부와 유형에 따라 어느 블록에 붙일지는 resolveNovelAssignments가 가린다.
  state.novelAssignments = resolveNovelAssignments(state.computed.blocks, d.novel_items || []);

  if (d.holiday_names && d.holiday_names.length) {
    const banner = el("div", { className: "banner banner--holiday" });
    banner.innerHTML = ICONS.holiday;
    banner.appendChild(el("span", { textContent: "오늘은 공휴일입니다: " + d.holiday_names.join(", ") }));
    app.appendChild(banner);
  }

  // 기상 예측(아침 시간대)은 forDate가 실제로 오늘이 되기 전까진 반영하지
  // 않지만, 취침 시각 자체는 "오늘 밤" 얘기라 예약한 즉시 반영된다(오늘의
  // 취침 블록이 밀리고 휴식이 늘어난다) — computeForToday의 sleepMinutes 참고.
  const sleepActive = isSleepActive(now, store.settings.dayBoundaryHour);
  if (sleepActive && store.today.accepted) {
    const banner = el("div", { className: "banner banner--adjust" });
    banner.appendChild(el("span", { textContent: "오늘 일정이 조정되었습니다." }));
    banner.appendChild(el("span", { className: "spacer" }));
    const undoBtn = el("button", { className: "banner-link", textContent: "되돌리기" });
    undoBtn.addEventListener("click", undoToday);
    banner.appendChild(undoBtn);
    app.appendChild(banner);
  } else if (sleepActive && store.today.bedAt && !store.today.wakeOverride) {
    app.appendChild(renderMorningBanner());
  } else if (!sleepActive && store.today.bedAt) {
    app.appendChild(renderPendingSleepBanner());
  }

  // 노션에 종류="일정"으로 등록한 날은 그날 하루를 통째로 그 일정에 내주는 게
  // 기본이다(루틴 숨김). 다만 그런 날에도 루틴을 참고하고 싶을 때가 있으니
  // 직접 펼쳐볼 수 있게 해둔다 — 어디까지나 내가 꺼낼 때만.
  const special = d.special_items || [];
  if (special.length) {
    app.appendChild(renderSpecialScheduleCard(special, now));
    const toggle = el("button", {
      className: "routine-toggle",
      textContent: store.dayTweaks.showRoutine ? "루틴 숨기기" : "그래도 루틴 보기",
    });
    toggle.addEventListener("click", () => {
      store.dayTweaks.showRoutine = !store.dayTweaks.showRoutine;
      saveStore(true);
      renderMain(new Date());
    });
    app.appendChild(toggle);
    if (store.dayTweaks.showRoutine) {
      app.appendChild(renderNowCard(now));
      app.appendChild(renderAgenda(now));
    }
  } else {
    app.appendChild(renderNowCard(now));
    app.appendChild(renderAgenda(now));
  }

  // 할일도 소설 일정도, 완료한 것을 목록에서 지우지 않는다 — 지워버리면
  // 잘못 눌렀을 때 되돌릴 방법이 없다. 체크된 채로 남겨둔다.
  const todos = d.todo_items || [];
  if (todos.length) {
    app.appendChild(card(ICONS.check, "오늘의 할일", todos, "todo"));
  }
  app.appendChild(card(ICONS.book, "오늘의 소설 일정", d.novel_items || [], "novel"));
}

function renderMorningBanner() {
  const wakeMinutes = getWakeMinutes(store.settings.dayBoundaryHour, new Date());
  const banner = el("div", { className: "banner banner--wake" });
  banner.appendChild(
    el("span", { textContent: `방금 일어났어요? 예상 기상 ${boundaryMinutesToHHMM(wakeMinutes, store.settings.dayBoundaryHour)}` })
  );
  banner.appendChild(el("span", { className: "spacer" }));
  const confirmBtn = el("button", { className: "banner-link", textContent: "확정" });
  confirmBtn.addEventListener("click", () => {
    store.today.wakeOverride = new Date().toISOString();
    saveStore(true);
    state.proposalDismissed = false;
    renderShell();
  });
  const editBtn = el("button", { className: "banner-link", textContent: "직접 입력" });
  editBtn.addEventListener("click", () => openWakeTimeSheet());
  banner.appendChild(editBtn);
  banner.appendChild(confirmBtn);
  return banner;
}

function renderPendingSleepBanner() {
  const dayBoundaryHour = store.settings.dayBoundaryHour;
  const bedAtMinutes = dateToBoundaryMinutes(new Date(store.today.bedAt), dayBoundaryHour);
  const predictedWake = computeWakeMinutes({
    bedAtMinutes,
    wakeOverrideMinutes: null,
    sleepTargetMinutes: store.settings.sleepTargetMinutes,
    baseWakeMinutes: hhmmToBoundaryMinutes(store.settings.baseWake, dayBoundaryHour),
  });
  const banner = el("div", { className: "banner banner--wake" });
  banner.appendChild(
    el("span", {
      textContent: `오늘 밤 ${boundaryMinutesToHHMM(bedAtMinutes, dayBoundaryHour)} 취침 예정 · 내일 예상 기상 ${boundaryMinutesToHHMM(predictedWake, dayBoundaryHour)}`,
    })
  );
  banner.appendChild(el("span", { className: "spacer" }));
  const editBtn = el("button", { className: "banner-link", textContent: "변경" });
  editBtn.addEventListener("click", () => openBedTimeSheet());
  banner.appendChild(editBtn);
  return banner;
}

function renderSpecialScheduleCard(items, now) {
  const dayBoundaryHour = store.settings.dayBoundaryHour;
  const nowMinutes = dateToBoundaryMinutes(now, dayBoundaryHour);

  const section = el("section", { className: "card" });
  const head = el("div", { className: "card-head" });
  head.appendChild(el("span", { className: "icon", innerHTML: ICONS.clock }));
  head.appendChild(el("h2", { textContent: "오늘의 일정" }));
  head.appendChild(el("span", { className: "count", textContent: items.length + "건" }));
  section.appendChild(head);
  const ul = el("ul", { className: "rows" });
  items.forEach((it) => {
    const li = el("li", { className: "row" });
    // 이미 지난 시각이면 흐리게 — 표시가 없으면 한밤중에 "06:00 가족 휴가"가
    // 내일 아침 일정처럼 읽힌다(실사용 중 실제로 겪은 혼란).
    const time = (it.time || "").trim();
    if (time && hhmmToBoundaryMinutes(time, dayBoundaryHour) < nowMinutes) li.classList.add("is-past");
    li.appendChild(el("span", { className: "chip-time mono" + (time ? "" : " empty"), textContent: time || "--" }));
    const body = el("div", { className: "row-body" });
    body.appendChild(el("span", { className: "text", textContent: it.text || "" }));
    li.appendChild(body);
    ul.appendChild(li);
  });
  section.appendChild(ul);
  return section;
}

// ---------------------------------------------------------------
// 소설 일정 ↔ 집필 블록 배정
//
// 노션에 "오늘 44화 초고" 같은 소설 일정이 있어도 하루 중 언제 쓸지는
// 앱이 계산한 집필 블록에만 있었다. 둘을 이어붙여서 "2차 집필 = 44화 초고"로
// 보이게 한다. 기본은 순서대로 자동 배정이고, 사용자가 지정하면 그게 이긴다.
// ---------------------------------------------------------------

/** 오늘 실제로 시간이 배정된 해당 성격의 블록들(시간순). */
function blocksOfCategory(blocks, category) {
  return blocks.filter((b) => b.category === category && b.minutes > 0);
}

// 실제로 원고를 쓰는 단계만 "집필"에 붙는다. 트리트먼트/시놉시스/설정은
// 자료를 만지는 일에 가까우니 "작업"으로 간다.
const WRITING_STAGES = new Set(["초고", "퇴고"]);
// 연재는 올려두기만 하면 되는 일이라 하루의 어느 블록도 차지하지 않는다.
const UNSCHEDULED_STAGES = new Set(["연재"]);

/** 소설 항목의 유형. tags = [작품, 유형]. */
function stageOf(item) {
  return (item.tags || [])[1] || "";
}

/** 이 소설 항목이 붙을 수 있는 블록 성격. 어디에도 안 붙으면 null. */
function targetCategoryOf(item) {
  const stage = stageOf(item);
  if (UNSCHEDULED_STAGES.has(stage)) return null;
  return WRITING_STAGES.has(stage) ? "집필" : "작업";
}

/** 한 성격 안에서 블록당 1건씩 채운다. 블록보다 항목이 많으면 남는 건 배정되지 않는다. */
function assignInto(result, targetBlocks, items) {
  const map = store.novelAssign.map || {};
  const excluded = new Set(store.novelAssign.excluded || []);
  const byKey = new Map(items.map((it) => [novelKey(it), it]));
  const used = new Set();

  // 1) 사용자가 직접 지정한 것부터.
  for (const b of targetBlocks) {
    const key = map[b.id];
    if (key && byKey.has(key)) {
      result.set(b.id, byKey.get(key));
      used.add(key);
    }
  }
  // 2) 남은 항목을 아직 비어 있는 블록에 순서대로 채운다.
  //    "배정 해제"한 항목(excluded)은 자동 배정에서도 제외된다.
  const rest = items.filter((it) => !used.has(novelKey(it)) && !excluded.has(novelKey(it)));
  let i = 0;
  for (const b of targetBlocks) {
    if (result.has(b.id)) continue;
    if (i >= rest.length) break;
    result.set(b.id, rest[i++]);
  }
}

/** @returns {Map<string, object>} blockId → 소설 항목 */
function resolveNovelAssignments(blocks, novelItems) {
  const result = new Map();
  // 이미 완료한 항목은 자리를 차지하지 않는다 — 다음 일정이 당겨진다.
  const pending = novelItems.filter((it) => !it.done);
  for (const category of ["집필", "작업"]) {
    assignInto(
      result,
      blocksOfCategory(blocks, category),
      pending.filter((it) => targetCategoryOf(it) === category)
    );
  }
  return result;
}

/** "[챌린지] 초고 · 44화" 형태의 한 줄 요약. */
function novelLabel(item) {
  const tags = (item.tags || []).filter(Boolean);
  const head = tags.length ? `[${tags.join(" ")}] ` : "";
  return head + (item.text || "");
}

function findCurrentIndex(blocks, nowMinutes) {
  return blocks.findIndex((b) => b.start < b.end && nowMinutes >= b.start && nowMinutes < b.end);
}

function renderNowCard(now) {
  const dayBoundaryHour = store.settings.dayBoundaryHour;
  const nowMinutes = dateToBoundaryMinutes(now, dayBoundaryHour);
  const blocks = state.computed.blocks;
  const idx = findCurrentIndex(blocks, nowMinutes);

  const wrap = el("div", { className: "now-card" });
  if (idx === -1) {
    const firstReal = blocks.find((b) => b.start < b.end);
    const empty = el("div", { className: "now-card--empty" });
    if (firstReal && nowMinutes < firstReal.start) {
      empty.textContent = `기상 전이에요 · 예상 기상 ${boundaryMinutesToHHMM(state.wakeMinutes, dayBoundaryHour)}`;
    } else {
      empty.textContent = "취침 시간이에요";
    }
    wrap.appendChild(empty);
    state.nowCardEls = null;
    return wrap;
  }

  const b = blocks[idx];
  wrap.appendChild(el("div", { className: "now-card__label", textContent: "지금" }));
  const nameEl = el("div", { className: "now-card__name", textContent: b.name });
  wrap.appendChild(nameEl);

  const novel = state.novelAssignments.get(b.id);
  if (novel) wrap.appendChild(el("div", { className: "now-card__novel", textContent: novelLabel(novel) }));

  const meta = el("div", { className: "now-card__meta" });
  const timeEl = el("span", {
    className: "now-card__time mono",
    textContent: `${boundaryMinutesToHHMM(b.start, dayBoundaryHour)} → ${boundaryMinutesToHHMM(b.end, dayBoundaryHour)}`,
  });
  const remainEl = el("span", { className: "now-card__remain", textContent: `${b.end - nowMinutes}분 남음` });
  meta.appendChild(timeEl);
  meta.appendChild(remainEl);
  wrap.appendChild(meta);

  const bar = el("div", { className: "now-card__bar" });
  const fill = el("div", { className: "now-card__bar-fill" });
  const pct = Math.max(0, Math.min(100, ((nowMinutes - b.start) / (b.end - b.start)) * 100));
  fill.style.width = pct + "%";
  bar.appendChild(fill);
  wrap.appendChild(bar);

  state.nowCardEls = { remainEl, fillEl: fill, blockIndex: idx };
  return wrap;
}

function renderAgenda(now) {
  const dayBoundaryHour = store.settings.dayBoundaryHour;
  const nowMinutes = dateToBoundaryMinutes(now, dayBoundaryHour);
  const blocks = state.computed.blocks;
  const currentIdx = findCurrentIndex(blocks, nowMinutes);

  const reordering = state.agendaReorder;

  const wrap = el("div", { className: "agenda" });
  const head = el("div", { className: "agenda__head" });
  head.appendChild(el("h2", { textContent: "오늘 하루" }));
  head.appendChild(el("span", { className: "spacer" }));
  const reorderBtn = el("button", {
    className: "agenda__reorder" + (reordering ? " is-on" : ""),
    title: "순서 편집",
  });
  reorderBtn.innerHTML = `${ICONS.grip} <span>${reordering ? "완료" : "순서"}</span>`;
  reorderBtn.addEventListener("click", () => {
    state.agendaReorder = !state.agendaReorder;
    // 순서를 바꾸려면 하루 전체가 보여야 한다.
    if (state.agendaReorder) state.agendaExpanded = true;
    renderMain(new Date());
  });
  head.appendChild(reorderBtn);
  wrap.appendChild(head);

  const ul = el("ul", { className: "agenda__list" + (reordering ? " is-reordering" : "") });
  const upcomingCount = 5;
  const startIdx = currentIdx === -1 ? 0 : currentIdx;
  const visible = reordering || state.agendaExpanded ? blocks : blocks.slice(startIdx, startIdx + upcomingCount);

  visible.forEach((b) => {
    const realIdx = blocks.indexOf(b);
    // 기상/취침/시각 고정(점심)은 하루의 뼈대라 순서를 바꿀 수 없다 — 다른
    // 블록이 이 지점을 넘어가지도 못하게 "벽"으로 표시한다(enableDragReorder).
    const fixed = b.anchor === "wake" || b.anchor === "sleep" || b.anchor === "clock";
    const li = el("li", {
      className: "agenda__row",
      dataset: { cat: ROUTINE_CAT[b.category] || "other", id: b.id, ...(fixed ? { fixed: "1" } : {}) },
    });
    if (b.minutes === 0 && b.anchor !== "wake" && b.anchor !== "sleep") li.classList.add("is-removed");
    if (realIdx === currentIdx) li.classList.add("is-current");
    else if (b.end <= nowMinutes) li.classList.add("is-past");
    if (reordering && fixed) li.classList.add("is-locked");
    // 오늘만 성격을 바꾼 블록인지 — 꾹 눌러 집필↔작업을 맞바꾼 경우.
    const swapped = !!store.dayTweaks.categories[b.id];
    if (swapped) li.classList.add("is-swapped");
    if (!reordering && (b.category === "집필" || b.category === "작업")) li.dataset.swappable = "1";
    li.appendChild(el("span", { className: "agenda__time mono", textContent: boundaryMinutesToHHMM(b.start, dayBoundaryHour) }));
    const body = el("div", { className: "agenda__body" });
    body.appendChild(el("span", { className: "agenda__name", textContent: b.name }));
    if (swapped) body.appendChild(el("span", { className: "agenda__swap", textContent: `오늘만 ${b.category}` }));
    const novel = state.novelAssignments.get(b.id);
    if (novel) body.appendChild(el("span", { className: "agenda__novel", textContent: novelLabel(novel) }));
    li.appendChild(body);
    if (reordering && !fixed) li.appendChild(el("span", { className: "agenda__grip", innerHTML: ICONS.grip }));
    ul.appendChild(li);
  });
  wrap.appendChild(ul);

  if (reordering) {
    enableDragReorder(
      ul,
      (order) => {
        store.blocks = applyVisibleOrder(store.blocks, order);
        saveStore(true);
        // 안착 애니메이션이 끝난 뒤에 다시 그린다 — 곧바로 갈아끼우면
        // 블록이 제자리로 스르륵 돌아가는 모습이 잘려버린다.
        setTimeout(() => renderShell(), 200);
      },
      () => {},
      "li.agenda__row"
    );
    wrap.appendChild(
      el("p", { className: "agenda__hint", textContent: "블록을 꾹 눌러 끌면 순서가 바뀝니다. 기상·점심·취침은 고정입니다." })
    );
  } else {
    // 순서 편집이 아닐 때의 꾹 누르기 — 집필↔작업을 오늘만 맞바꾼다.
    enableLongPress(ul, 'li.agenda__row[data-swappable="1"]', (li) => openCategorySwapSheet(li.dataset.id));
  }

  if (!reordering && blocks.length > upcomingCount) {
    const toggle = el("button", {
      className: "agenda__toggle",
      textContent: state.agendaExpanded ? "접기" : "전체 보기",
    });
    toggle.addEventListener("click", () => {
      state.agendaExpanded = !state.agendaExpanded;
      renderMain(new Date());
    });
    wrap.appendChild(toggle);
  }
  return wrap;
}

function card(iconHtml, title, items, sectionType) {
  const section = el("section", { className: "card" });
  const head = el("div", { className: "card-head" });
  head.appendChild(el("span", { className: "icon", innerHTML: iconHtml }));
  head.appendChild(el("h2", { textContent: title }));
  // 완료한 항목도 목록에 남으므로, 몇 건이 남았는지는 숫자로 알려준다.
  const pending = items.filter((it) => !it.done).length;
  const countText = pending === items.length ? `${items.length}건` : `${pending}/${items.length}건`;
  head.appendChild(el("span", { className: "count", textContent: countText }));
  section.appendChild(head);

  if (items.length) {
    const ul = el("ul", { className: "rows" });
    items.forEach((it) => ul.appendChild(notionRow(it, sectionType)));
    section.appendChild(ul);
  } else {
    section.appendChild(el("p", { className: "empty", textContent: "등록된 항목이 없습니다." }));
  }
  return section;
}

function notionRow(item, sectionType) {
  const tags = (item.tags || []).filter(Boolean);
  let cat = "other";
  if (sectionType === "todo") cat = TODO_CAT[tags[0]] || "other";
  else if (sectionType === "novel") cat = NOVEL_STAGE_CAT[tags[1]] || "other";

  const li = el("li", { className: "row", dataset: { cat } });

  // 노션 페이지 id가 있는 항목만 체크할 수 있다(id 없이는 어느 페이지인지
  // 특정할 수 없다 — today.json이 아직 갱신되지 않은 경우).
  if (item.id) {
    // 체크해도 목록에서 지우지 않는다 — 지워버리면 잘못 눌렀을 때 되돌릴
    // 방법이 없다. 체크된 채로 남겨두고 다시 누르면 노션에서도 해제된다.
    const box = el("input", { type: "checkbox", className: "row-check", checked: !!item.done });
    box.addEventListener("change", async () => {
      const next = box.checked;
      box.disabled = true;
      li.classList.toggle("is-checked", next);
      await setItemDone(item, next);
      renderMain(new Date());
    });
    li.appendChild(box);
  }
  if (item.done) li.classList.add("is-checked");

  const timeText = (item.time || "").trim();
  li.appendChild(el("span", { className: "chip-time mono" + (timeText ? "" : " empty"), textContent: timeText || "--" }));

  const body = el("div", { className: "row-body" });
  if (tags.length) {
    const tagsWrap = el("div", { className: "tags" });
    tags.forEach((t) => tagsWrap.appendChild(el("span", { className: "tag", textContent: t })));
    body.appendChild(tagsWrap);
  }
  body.appendChild(el("span", { className: "text", textContent: item.text || "" }));
  li.appendChild(body);

  // 이 소설 일정이 어느 블록에 배정됐는지 보여주고, 눌러서 바꾼다.
  // 초고·퇴고는 집필, 트리트먼트·시놉시스·설정은 작업, 연재는 어디에도 안 붙는다.
  // 이미 완료한 항목도 배정할 게 없으니 버튼을 달지 않는다.
  if (sectionType === "novel" && targetCategoryOf(item) && !item.done) {
    const key = novelKey(item);
    let assignedTo = null;
    for (const [blockId, it] of state.novelAssignments) {
      if (novelKey(it) === key) {
        assignedTo = state.computed.blocks.find((b) => b.id === blockId);
        break;
      }
    }
    const btn = el("button", {
      className: "row-assign" + (assignedTo ? " is-on" : ""),
      textContent: assignedTo ? assignedTo.name : "배정",
    });
    btn.addEventListener("click", () => openNovelAssignSheet(item));
    li.appendChild(btn);
  }
  return li;
}

/** 소설 항목 하나를 어느 블록에 붙일지 고르는 시트. 유형에 맞는 성격의 블록만 보여준다. */
function openNovelAssignSheet(item) {
  const key = novelKey(item);
  const category = targetCategoryOf(item);
  const blocks = blocksOfCategory(state.computed.blocks, category);
  const dayBoundaryHour = store.settings.dayBoundaryHour;

  const list = el("ul", { className: "rows" });
  const pick = (blockId) => {
    const map = { ...store.novelAssign.map };
    // 한 항목이 두 블록에 동시에 붙어 있을 수는 없다.
    for (const [bid, k] of Object.entries(map)) if (k === key) delete map[bid];
    // 배정을 지정하면 제외 목록에서 빼고, 해제하면 넣는다 — 넣어두지 않으면
    // 자리를 비우자마자 자동 배정이 같은 항목을 도로 채워버린다.
    const excluded = (store.novelAssign.excluded || []).filter((k) => k !== key);
    if (blockId) map[blockId] = key;
    else excluded.push(key);
    store.novelAssign = { date: store.novelAssign.date, map, excluded };
    saveStore(true);
    closeSheet();
    renderShell();
  };

  blocks.forEach((b) => {
    const row = el("li", { className: "row row--pick" });
    row.appendChild(
      el("span", {
        className: "chip-time mono",
        textContent: boundaryMinutesToHHMM(b.start, dayBoundaryHour),
      })
    );
    const rb = el("div", { className: "row-body" });
    rb.appendChild(el("span", { className: "text", textContent: b.name }));
    const current = state.novelAssignments.get(b.id);
    if (current) rb.appendChild(el("span", { className: "row-sub", textContent: "현재: " + novelLabel(current) }));
    row.appendChild(rb);
    row.addEventListener("click", () => pick(b.id));
    list.appendChild(row);
  });

  if (!blocks.length) {
    list.appendChild(
      el("li", {
        className: "empty",
        textContent: `오늘은 ${category} 블록이 없습니다. 다른 블록을 꾹 눌러 ${category}으로 바꿀 수 있습니다.`,
      })
    );
  }

  const clearBtn = el("button", { className: "btn btn--ghost", textContent: "배정 해제" });
  clearBtn.addEventListener("click", () => pick(null));
  const cancelBtn = el("button", { className: "btn btn--ghost", textContent: "닫기" });
  cancelBtn.addEventListener("click", closeSheet);

  openSheet(`${category} 블록에 배정`, novelLabel(item), [list], [clearBtn, cancelBtn]);
}

// ---------------------------------------------------------------
// 상황판 1분 틱 — 화면 전체를 다시 그리지 않고 텍스트/바 너비만 갱신한다.
// 다음 "분" 경계에 맞춘 단발 setTimeout 체인이며, 탭이 백그라운드로
// 가면 멈추고 돌아오면 즉시 1회 갱신 후 체인을 다시 건다.
// ---------------------------------------------------------------

let tickTimer = null;

function updateNowCard() {
  // 드래그로 순서를 바꾸는 중이라면 화면을 갈아끼우면 안 된다 — 잡고 있던
  // 요소가 통째로 사라져 드래그가 끊긴다. 다음 틱에서 따라잡는다.
  if (dragActive) return;
  if (!state.nowCardEls) {
    // 블록 경계를 넘었을 수 있으니(예: 다음 블록으로 진입) 전체를 다시 그린다.
    renderMain(new Date());
    return;
  }
  const now = new Date();
  const dayBoundaryHour = store.settings.dayBoundaryHour;
  const nowMinutes = dateToBoundaryMinutes(now, dayBoundaryHour);
  const b = state.computed.blocks[state.nowCardEls.blockIndex];
  if (!b || nowMinutes < b.start || nowMinutes >= b.end) {
    renderMain(now); // 블록이 바뀌었다 — 이번만 다시 그린다.
    return;
  }
  state.nowCardEls.remainEl.textContent = `${b.end - nowMinutes}분 남음`;
  const pct = Math.max(0, Math.min(100, ((nowMinutes - b.start) / (b.end - b.start)) * 100));
  state.nowCardEls.fillEl.style.width = pct + "%";
}

function scheduleTick() {
  clearTimeout(tickTimer);
  if (document.hidden) return;
  const now = new Date();
  const msToNextMinute = 60000 - (now.getSeconds() * 1000 + now.getMilliseconds());
  tickTimer = setTimeout(() => {
    updateNowCard();
    scheduleTick();
  }, msToNextMinute);
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    clearTimeout(tickTimer);
  } else {
    updateNowCard();
    scheduleTick();
  }
});

// ---------------------------------------------------------------
// 하단 취침 바
// ---------------------------------------------------------------

function renderSleepBar() {
  let bar = document.getElementById("sleep-bar");
  if (!bar) {
    bar = el("div", { id: "sleep-bar", className: "sleep-bar" });
    const inner = el("div", { className: "sleep-bar__inner" });
    const btn = el("button", { className: "sleep-btn", id: "sleep-btn" });
    btn.innerHTML = `${ICONS.moon} <span>취침</span>`;
    btn.style.display = "flex";
    btn.style.alignItems = "center";
    btn.style.justifyContent = "center";
    btn.style.gap = "8px";
    btn.addEventListener("click", openBedTimeSheet);
    inner.appendChild(btn);
    bar.appendChild(inner);
    document.body.appendChild(bar);
  }
  const btn = document.getElementById("sleep-btn");
  const isTonight = !!store.today.bedAt;
  btn.classList.toggle("is-active", isTonight);
  btn.querySelector("span").textContent = isTonight ? "취침 기록됨 · 다시 기록" : "취침";
}

/**
 * "HH:MM" 입력값을 지금(now)에서 가장 가까운 실제 시각으로 되돌린다.
 * 자정을 걸치는 입력(예: 23:58에 버튼을 눌렀는데 "00:10"을 입력)을 오늘 날짜의
 * 과거 시각으로 잘못 해석하지 않도록, 12시간 넘게 차이 나면 하루를 앞/뒤로
 * 밀어 "지금과 가장 가까운 그 시각"으로 취급한다.
 */
function nearestTimeToNow(hh, mm, now) {
  const d = new Date(now);
  d.setHours(hh, mm, 0, 0);
  const diffHours = (d - now) / 3600000;
  if (diffHours > 12) d.setDate(d.getDate() - 1);
  else if (diffHours < -12) d.setDate(d.getDate() + 1);
  return d;
}

function openBedTimeSheet() {
  state.activeSheet = "bedtime";
  const now = new Date();
  const input = el("input", { type: "time" });
  input.value = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const field = el("div", { className: "field-row" });
  field.appendChild(el("label", { textContent: "취침 시각" }));
  field.appendChild(input);

  const applyBtn = el("button", { className: "btn btn--primary", textContent: "확인" });
  applyBtn.addEventListener("click", () => {
    if (!input.value) return;
    const [h, m] = input.value.split(":").map(Number);
    const bedAtDate = nearestTimeToNow(h, m, new Date());
    const dayBoundaryHour = store.settings.dayBoundaryHour;
    store.today.bedAt = bedAtDate.toISOString();
    // 취침은 그 논리적 하루가 끝나기 전(밤)에 기록하므로, 예측은 "다음" 논리적
    // 날짜의 기상에 적용된다. 그 날짜가 되기 전까지는 오늘 화면을 그대로 둔다.
    store.today.forDate = nextDateKey(logicalDateKey(bedAtDate, dayBoundaryHour));
    store.today.wakeOverride = null;
    store.today.accepted = false;
    store.today.protectedOverrides = [];
    saveStore(true);
    state.proposalDismissed = false;
    closeSheet();
    renderShell();
  });
  const cancelBtn = el("button", { className: "btn btn--ghost", textContent: "취소" });
  cancelBtn.addEventListener("click", closeSheet);

  openSheet("취침 기록", "잠들 시각을 확인하거나 바꾸세요. 수면 목표 시간만큼 더해 내일 기상 시각을 예상합니다.", [field], [cancelBtn, applyBtn]);
}

// ---------------------------------------------------------------
// 시트 공통 (제안 / 아침 보정 / 편집 / 설정)
// ---------------------------------------------------------------

function closeSheet() {
  const root = document.getElementById("sheet-root");
  root.innerHTML = "";
  state.activeSheet = null;
}

function openSheet(title, subtitle, bodyChildren, actions) {
  const root = document.getElementById("sheet-root");
  root.innerHTML = "";
  const overlay = el("div", { className: "sheet-overlay" });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeSheet();
  });
  const sheet = el("div", { className: "sheet" });
  sheet.appendChild(el("div", { className: "sheet__handle" }));
  sheet.appendChild(el("h2", { className: "sheet__title", textContent: title }));
  if (subtitle) sheet.appendChild(el("p", { className: "sheet__subtitle", textContent: subtitle }));
  const body = el("div", { className: "sheet__body" });
  bodyChildren.forEach((c) => body.appendChild(c));
  sheet.appendChild(body);
  if (actions && actions.length) {
    const actionsRow = el("div", { className: "sheet__actions" });
    actions.forEach((a) => actionsRow.appendChild(a));
    sheet.appendChild(actionsRow);
  }
  overlay.appendChild(sheet);
  root.appendChild(overlay);
  return { overlay, sheet, body };
}

// ---- 아침 보정: 실제 기상 시각 직접 입력 ----

function openWakeTimeSheet() {
  state.activeSheet = "wake";
  const input = el("input", { type: "time" });
  const predicted = boundaryMinutesToHHMM(getWakeMinutes(store.settings.dayBoundaryHour, new Date()), store.settings.dayBoundaryHour);
  input.value = predicted;
  const field = el("div", { className: "field-row" });
  field.appendChild(el("label", { textContent: "실제 기상 시각" }));
  field.appendChild(input);

  const applyBtn = el("button", { className: "btn btn--primary", textContent: "확인" });
  applyBtn.addEventListener("click", () => {
    if (!input.value) return;
    const [h, m] = input.value.split(":").map(Number);
    store.today.wakeOverride = nearestTimeToNow(h, m, new Date()).toISOString();
    saveStore(true);
    state.proposalDismissed = false;
    closeSheet();
    renderShell();
  });
  const cancelBtn = el("button", { className: "btn btn--ghost", textContent: "취소" });
  cancelBtn.addEventListener("click", closeSheet);

  openSheet("아침 보정", "실제로 일어난 시각을 알려주면 오늘 일정을 다시 계산합니다.", [field], [cancelBtn, applyBtn]);
}

// ---- 제안 시트 ----

function openProposalSheet() {
  state.activeSheet = "proposal";
  const overrides = new Set(store.today.protectedOverrides || []);
  render();

  function render() {
    const { result } = computeForToday(new Date(), overrides);
    const rows = result.adjustments.map((adj) => {
      const row = el("div", { className: "proposal-row" });
      const checkbox = el("input", { type: "checkbox" });
      checkbox.checked = !overrides.has(adj.id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) overrides.delete(adj.id);
        else overrides.add(adj.id);
        render();
      });
      row.appendChild(checkbox);
      const label = adj.type === "removed" ? `${adj.name} 삭제` : `${adj.name} ${formatDuration(adj.before)} → ${formatDuration(adj.after)}`;
      row.appendChild(el("span", { className: "proposal-row__label", textContent: label }));
      row.appendChild(el("span", { className: "proposal-row__delta", textContent: `−${formatDuration(adj.before - adj.after)}` }));
      return row;
    });

    const summary = el("div", { className: "proposal-summary" });
    const sleepBlock = result.blocks.find((b) => b.anchor === "sleep");
    summary.appendChild(
      el("div", {
        innerHTML: `집필 <strong>${result.blocks.filter((b) => b.category === "집필" && b.minutes > 0).length}블록</strong> · 취침 <strong>${boundaryMinutesToHHMM(sleepBlock.start, store.settings.dayBoundaryHour)}</strong> 유지`,
      })
    );
    if (result.warnings.length) {
      summary.appendChild(el("div", { textContent: "⚠ 오늘은 예산 안에 다 담기지 않았어요.", style: "color:var(--red);font-weight:700;" }));
    }
    if (!rows.length) {
      summary.appendChild(el("div", { textContent: "오늘은 기본 루틴 그대로도 충분해요." }));
    }

    const applyBtn = el("button", { className: "btn btn--primary", textContent: "적용" });
    applyBtn.addEventListener("click", () => {
      store.today.protectedOverrides = Array.from(overrides);
      store.today.accepted = true;
      saveStore(true);
      closeSheet();
      renderShell();
    });
    const editBtn = el("button", { className: "btn btn--ghost", textContent: "직접 조정" });
    editBtn.addEventListener("click", () => {
      closeSheet();
      openEditorSheet();
    });

    const wakeMinutes = getWakeMinutes(store.settings.dayBoundaryHour, new Date());
    const { sheet } = openSheet(
      `${boundaryMinutesToHHMM(wakeMinutes, store.settings.dayBoundaryHour)} 기상`,
      "오늘 일정을 이렇게 조정할까요? 항목을 체크 해제하면 그 블록은 그대로 유지됩니다.",
      [...rows, summary],
      [editBtn, applyBtn]
    );
    sheet.querySelector(".sheet-overlay")?.addEventListener("click", () => {});
  }
}

function maybeShowProposal() {
  if (state.activeSheet) return;
  if (state.proposalDismissed) return;
  if (store.today.accepted) return;
  if (!state.computed.adjustments.length) return;
  if ((state.todayData?.special_items || []).length) return; // 특별 일정이 있는 날은 루틴 자체가 무의미
  openProposalSheet();
}

function undoToday() {
  store.today = emptySleep();
  saveStore(true);
  state.proposalDismissed = false;
  closeSheet();
  renderShell();
}

// ---- 루틴 편집 시트 (드래그 재배열 + 블록 편집) ----

function openEditorSheet() {
  state.activeSheet = "editor";
  state.editorBlocks = store.blocks.map((b) => ({ ...b }));
  renderEditor();
}

function budgetMinutes() {
  const dayBoundaryHour = store.settings.dayBoundaryHour;
  return hhmmToBoundaryMinutes(store.settings.baseSleep, dayBoundaryHour) - hhmmToBoundaryMinutes(store.settings.baseWake, dayBoundaryHour);
}

function renderEditor() {
  const blocks = state.editorBlocks;
  const total = blocks.filter((b) => b.anchor !== "wake" && b.anchor !== "sleep").reduce((s, b) => s + b.minutes, 0);
  const budget = budgetMinutes();

  const validation = el("div", {
    className: "validation-bar " + (total > budget ? "is-error" : "is-ok"),
    textContent: `합계 ${total}분 / 예산 ${budget}분 ${total > budget ? `(${total - budget}분 초과)` : "✓"}`,
  });

  const list = el("ul", { className: "block-list" });
  blocks.forEach((b) => list.appendChild(blockItem(b)));
  enableDragReorder(
    list,
    (order) => {
      state.editorBlocks = order.map((id) => state.editorBlocks.find((b) => b.id === id));
    },
    (id) => openBlockEdit(id)
  );

  const addBtn = el("button", { className: "btn btn--ghost btn--block" });
  addBtn.innerHTML = `${ICONS.plus} <span>블록 추가</span>`;
  addBtn.style.display = "flex";
  addBtn.style.alignItems = "center";
  addBtn.style.justifyContent = "center";
  addBtn.style.gap = "6px";
  addBtn.addEventListener("click", () => {
    const id = "block-" + Date.now();
    state.editorBlocks.push({ id, name: "새 블록", category: "여유", minutes: 30, minMinutes: 0, days: null });
    renderEditor();
  });

  const presetsBlock = renderPresetControls();

  const saveBtn = el("button", { className: "btn btn--primary", textContent: "저장" });
  saveBtn.addEventListener("click", () => {
    store.blocks = state.editorBlocks;
    saveStore(true);
    closeSheet();
    renderShell();
  });
  const cancelBtn = el("button", { className: "btn btn--ghost", textContent: "취소" });
  cancelBtn.addEventListener("click", closeSheet);

  openSheet("루틴 편집", "블록을 눌러 세부 사항을 바꾸거나, 잡고 끌어서 순서를 바꾸세요.", [validation, list, addBtn, presetsBlock], [cancelBtn, saveBtn]);
}

function blockItem(b) {
  const cat = ROUTINE_CAT[b.category] || "other";
  const li = el("li", { className: "block-item", dataset: { id: b.id, cat } });
  li.appendChild(el("span", { className: "block-item__handle", innerHTML: ICONS.grip }));
  const body = el("div", { className: "block-item__body" });
  body.appendChild(el("div", { className: "block-item__name", textContent: b.name }));
  const metaParts = [b.anchor === "clock" ? `${boundaryMinutesToHHMM(b.fixedAt, store.settings.dayBoundaryHour)} 고정` : `${b.minutes}분`];
  if (b.days) metaParts.push("반복: " + b.days.map((d) => "월화수목금토일"[d]).join(""));
  body.appendChild(el("div", { className: "block-item__meta", textContent: metaParts.join(" · ") }));
  li.appendChild(body);
  li.appendChild(el("span", { className: "block-item__chevron", innerHTML: ICONS.chevron }));
  return li;
}

function openBlockEdit(id) {
  const b = state.editorBlocks.find((x) => x.id === id);
  if (!b) return;

  const isEndpoint = b.anchor === "wake" || b.anchor === "sleep";
  const nameField = fieldRow("이름", el("input", { type: "text", value: b.name }));
  const catField = fieldRow("카테고리", selectField(["집필", "작업", "운동", "여유", "식사", "기타"], b.category));
  const minutesField = fieldRow("길이(분)", el("input", { type: "number", value: b.minutes, min: 0, step: 10 }));
  const minMinutesField = fieldRow("최소 길이(분)", el("input", { type: "number", value: b.minMinutes || 0, min: 0, step: 10 }));
  if (isEndpoint) {
    // 기상/취침은 하루의 시작·끝을 표시하는 길이 0짜리 표지일 뿐이라 길이 입력이 의미 없다.
    minutesField.style.display = "none";
    minMinutesField.style.display = "none";
  }
  const anchorField = fieldRow("앵커", selectField(["유동", "시각 고정", "기상", "취침"], anchorLabel(b.anchor)));
  const fixedAtInput = el("input", { type: "time", value: b.fixedAt != null ? boundaryMinutesToHHMM(b.fixedAt, store.settings.dayBoundaryHour) : "13:00" });
  const fixedAtField = fieldRow("고정 시각", fixedAtInput);
  fixedAtField.style.display = b.anchor === "clock" ? "" : "none";
  anchorField.querySelector("select").addEventListener("change", (e) => {
    fixedAtField.style.display = e.target.value === "시각 고정" ? "" : "none";
  });

  const daysRow = el("div", { className: "field-row" });
  daysRow.appendChild(el("label", { textContent: "반복 요일 (전체 선택 시 매일)" }));
  const dayToggles = el("div", { className: "day-toggles" });
  const activeDays = new Set(b.days || [0, 1, 2, 3, 4, 5, 6]);
  "월화수목금토일".split("").forEach((label, i) => {
    const t = el("button", { className: "day-toggle" + (activeDays.has(i) ? " is-on" : ""), textContent: label });
    t.addEventListener("click", () => {
      if (activeDays.has(i)) activeDays.delete(i);
      else activeDays.add(i);
      t.classList.toggle("is-on");
    });
    dayToggles.appendChild(t);
  });
  daysRow.appendChild(dayToggles);

  const protectedField = fieldRow(
    "보호(자동 축소 대상에서 제외)",
    el("input", { type: "checkbox", checked: !!b.protected })
  );
  protectedField.classList.add("inline");

  const deleteBtn = el("button", { className: "btn btn--danger" });
  deleteBtn.innerHTML = `${ICONS.trash} <span>삭제</span>`;
  deleteBtn.style.display = "flex";
  deleteBtn.style.alignItems = "center";
  deleteBtn.style.justifyContent = "center";
  deleteBtn.style.gap = "6px";
  deleteBtn.addEventListener("click", () => {
    state.editorBlocks = state.editorBlocks.filter((x) => x.id !== id);
    closeSheet();
    renderEditor();
  });

  const saveBtn = el("button", { className: "btn btn--primary", textContent: "완료" });
  saveBtn.addEventListener("click", () => {
    b.name = nameField.querySelector("input").value || b.name;
    b.category = catField.querySelector("select").value;
    b.minutes = Number(minutesField.querySelector("input").value) || 0;
    b.minMinutes = Number(minMinutesField.querySelector("input").value) || 0;
    const anchorVal = anchorField.querySelector("select").value;
    b.anchor = anchorVal === "유동" ? undefined : { "시각 고정": "clock", "기상": "wake", "취침": "sleep" }[anchorVal];
    if (b.anchor === "clock") {
      const [h, m] = fixedAtInput.value.split(":").map(Number);
      b.fixedAt = hhmmToBoundaryMinutes(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`, store.settings.dayBoundaryHour);
    } else {
      delete b.fixedAt;
    }
    b.days = activeDays.size === 7 ? null : Array.from(activeDays).sort();
    b.protected = protectedField.querySelector("input").checked;
    closeSheet();
    renderEditor();
  });
  const cancelBtn = el("button", { className: "btn btn--ghost", textContent: "취소" });
  cancelBtn.addEventListener("click", () => {
    closeSheet();
    renderEditor();
  });

  const body = el("div", { className: "block-edit" }, [
    nameField, catField, minutesField, minMinutesField, anchorField, fixedAtField, daysRow, protectedField, deleteBtn,
  ]);
  openSheet("블록 편집", null, [body], [cancelBtn, saveBtn]);
}

function anchorLabel(anchor) {
  return { clock: "시각 고정", wake: "기상", sleep: "취침" }[anchor] || "유동";
}

function fieldRow(labelText, inputEl) {
  const row = el("div", { className: "field-row" });
  row.appendChild(el("label", { textContent: labelText }));
  row.appendChild(inputEl);
  return row;
}

function selectField(options, current) {
  const select = el("select");
  options.forEach((o) => {
    const opt = el("option", { value: o, textContent: o });
    if (o === current) opt.selected = true;
    select.appendChild(opt);
  });
  return select;
}

// 드래그가 진행 중인 동안엔 1분 틱의 자동 렌더를 멈춘다(updateNowCard 참고).
let dragActive = false;

const REDUCED_MOTION = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** 짧은 진동 피드백. 지원하지 않는 브라우저(iOS Safari 등)에서는 조용히 무시된다. */
function buzz(ms) {
  if (REDUCED_MOTION()) return;
  try {
    navigator.vibrate?.(ms);
  } catch {}
}

/** el에서 위로 올라가며 실제로 세로 스크롤되는 조상을 찾는다. 없으면 문서 스크롤. */
function scrollParentOf(el) {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return document.scrollingElement || document.documentElement;
}

// 순서 편집이 아닐 때의 "꾹 누르기". 드래그(300ms)보다 조금 길게 잡아
// 실수로 발동하지 않게 한다. 8px 넘게 움직이면 스크롤로 보고 취소.
function enableLongPress(listEl, itemSelector, onLongPress) {
  let target = null;
  let startY = 0;
  let timer = null;
  let pointerId = null;

  function cancel() {
    clearTimeout(timer);
    if (target) target.classList.remove("pressing");
    target = null;
  }

  listEl.addEventListener("pointerdown", (e) => {
    if (target) return;
    const li = e.target.closest(itemSelector);
    if (!li || !listEl.contains(li)) return;
    target = li;
    startY = e.clientY;
    pointerId = e.pointerId;
    li.classList.add("pressing");
    timer = setTimeout(() => {
      const hit = target;
      target = null;
      hit.classList.remove("pressing");
      buzz(12);
      onLongPress(hit);
    }, 450);
  });

  listEl.addEventListener("pointermove", (e) => {
    if (target && e.pointerId === pointerId && Math.abs(e.clientY - startY) > 8) cancel();
  });
  listEl.addEventListener("pointerup", cancel);
  listEl.addEventListener("pointercancel", cancel);
}

/** 오늘 하루만 이 블록의 성격을 집필↔작업으로 맞바꾸는 시트. 루틴 자체는 그대로 둔다. */
function openCategorySwapSheet(blockId) {
  const b = state.computed.blocks.find((x) => x.id === blockId);
  if (!b) return;
  const other = b.category === "집필" ? "작업" : "집필";
  const original = (store.blocks.find((x) => x.id === blockId) || {}).category;

  const apply = (category) => {
    const categories = { ...store.dayTweaks.categories };
    if (category === original) delete categories[blockId];
    else categories[blockId] = category;
    store.dayTweaks = { ...store.dayTweaks, categories };
    saveStore(true);
    closeSheet();
    renderShell();
  };

  const swapped = !!store.dayTweaks.categories[blockId];
  const actions = [];
  if (swapped) {
    // 이미 바꿔놓은 블록 — 원래대로 돌리는 것 하나면 된다(둘은 같은 동작이다).
    const resetBtn = el("button", { className: "btn btn--primary", textContent: `${josaRo(original)} 되돌리기` });
    resetBtn.addEventListener("click", () => apply(original));
    actions.push(resetBtn);
  } else {
    const swapBtn = el("button", { className: "btn btn--primary", textContent: `오늘만 ${josaRo(other)}` });
    swapBtn.addEventListener("click", () => apply(other));
    actions.push(swapBtn);
  }
  const cancelBtn = el("button", { className: "btn btn--ghost", textContent: "닫기" });
  cancelBtn.addEventListener("click", closeSheet);
  actions.push(cancelBtn);

  const info = el("p", {
    className: "sheet-note",
    textContent: `오늘 하루만 바뀌고 내일은 원래 루틴(${original})으로 돌아갑니다. 소설 일정도 규칙에 맞춰 다시 배정됩니다.`,
  });
  openSheet(
    b.name,
    `${boundaryMinutesToHHMM(b.start, store.settings.dayBoundaryHour)} · 지금은 ${b.category}`,
    [info],
    actions
  );
}

// 노션식 드래그 재배열: 300ms 길게 누르면 드래그 모드로 들어가고,
// 그 전에 놓거나 8px 넘게 움직이면 각각 "탭"/"스크롤"로 취급한다.
// 매 이동마다 전체를 다시 그리지 않고 transform과 필요할 때만의
// insertBefore 한 번으로 처리해 화면이 가볍게 반응하도록 한다.
//
// itemSelector로 드래그 대상 요소를 지정한다(루틴 편집 시트는 li.block-item,
// 메인 화면 "오늘 하루"는 li.agenda__row). data-fixed="1"인 항목은 잡을 수도
// 없고 다른 항목이 그 자리를 넘어갈 수도 없는 "벽"으로 동작한다 — 점심(시각
// 고정)이나 기상/취침처럼 하루의 뼈대를 이루는 블록을 위한 장치다.
function enableDragReorder(listEl, onReorder, onTap, itemSelector = "li.block-item") {
  let dragEl = null;
  let startY = 0; // 이 값을 기준으로 translateY를 계산한다(스왑 때마다 레이아웃 이동량만큼 보정)
  let pressTimer = null;
  let dragging = false;
  let pointerId = null;
  let lastY = 0;
  let originalOrder = null; // pointercancel 때 되돌리기 위한 스냅샷
  let autoScrollRaf = null;

  const items = () => Array.from(listEl.querySelectorAll(itemSelector));
  const movable = (li) => li.dataset.fixed !== "1";

  /** FLIP: 레이아웃이 바뀐 형제들이 새 자리로 미끄러져 가는 것처럼 보이게 한다. */
  function flip(measured) {
    if (REDUCED_MOTION()) return;
    for (const [el, prevTop] of measured) {
      const delta = prevTop - el.getBoundingClientRect().top;
      if (!delta) continue;
      el.animate([{ transform: `translateY(${delta}px)` }, { transform: "none" }], {
        duration: 180,
        easing: "cubic-bezier(.2,.8,.2,1)",
      });
    }
  }

  function stopAutoScroll() {
    if (autoScrollRaf) cancelAnimationFrame(autoScrollRaf);
    autoScrollRaf = null;
  }

  // 손가락이 스크롤 영역의 위/아래 끝에 닿아 있는 동안 리스트를 계속 굴려준다.
  // 이게 없으면 화면 밖으로 블록을 옮길 방법이 없다.
  function autoScroll() {
    autoScrollRaf = null;
    if (!dragging || !dragEl) return;
    const sp = scrollParentOf(dragEl);
    const isDoc = sp === document.scrollingElement || sp === document.documentElement;
    const top = isDoc ? 0 : sp.getBoundingClientRect().top;
    const bottom = isDoc ? window.innerHeight : sp.getBoundingClientRect().bottom;
    const EDGE = 48;
    const STEP = 7; // 프레임당 px ≈ 초당 400px
    let dy = 0;
    if (lastY < top + EDGE) dy = -STEP;
    else if (lastY > bottom - EDGE) dy = STEP;
    if (dy) {
      const before = sp.scrollTop;
      sp.scrollTop += dy;
      // 실제로 스크롤된 만큼만 기준점을 옮겨야 블록이 손가락에 붙어 있다.
      startY -= sp.scrollTop - before;
      applyTransform();
      reorderAt(lastY);
    }
    autoScrollRaf = requestAnimationFrame(autoScroll);
  }

  function applyTransform() {
    dragEl.style.transform = `translateY(${lastY - startY}px) scale(1.03)`;
  }

  /** 포인터 y좌표를 기준으로 필요하면 이웃과 자리를 바꾼다. */
  function reorderAt(clientY) {
    for (const sib of items()) {
      if (sib === dragEl) continue;
      const r = sib.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      const dragIsBefore = !!(dragEl.compareDocumentPosition(sib) & Node.DOCUMENT_POSITION_FOLLOWING);
      const crossing = (clientY > mid && dragIsBefore) || (clientY < mid && !dragIsBefore);
      if (!crossing) continue;
      // 고정 항목은 넘어갈 수 없다 — 여기서 멈춘다.
      if (!movable(sib)) break;

      const measured = items()
        .filter((x) => x !== dragEl)
        .map((x) => [x, x.getBoundingClientRect().top]);
      const prevOffsetTop = dragEl.offsetTop;

      listEl.insertBefore(dragEl, clientY > mid ? sib.nextSibling : sib);

      // 스왑으로 dragEl 자신의 레이아웃 위치가 바뀐 만큼 기준점을 보정한다.
      // (예전 코드는 startY = clientY로 리셋해서 블록 높이가 다르면 손가락과
      //  블록이 어긋났다. offsetTop은 transform의 영향을 받지 않아 안전하다.)
      startY += dragEl.offsetTop - prevOffsetTop;
      applyTransform();
      flip(measured);
      buzz(6);
      break;
    }
  }

  function cleanupVisual() {
    dragActive = false;
    listEl.classList.remove("is-dragging");
    stopAutoScroll();
    if (!dragEl) return;
    dragEl.classList.remove("pressing");
    dragEl.classList.remove("dragging");
    dragEl.style.transform = "";
  }

  listEl.addEventListener("pointerdown", (e) => {
    if (dragEl) return; // 드래그 중 두 번째 손가락은 무시
    const li = e.target.closest(itemSelector);
    if (!li || !listEl.contains(li) || !movable(li)) return;
    dragEl = li;
    startY = lastY = e.clientY;
    pointerId = e.pointerId;
    dragging = false;
    dragEl.classList.add("pressing");
    pressTimer = setTimeout(() => {
      dragging = true;
      dragActive = true;
      originalOrder = items();
      dragEl.classList.remove("pressing");
      dragEl.classList.add("dragging");
      listEl.classList.add("is-dragging");
      dragEl.style.transform = "scale(1.03)";
      buzz(12);
      try {
        dragEl.setPointerCapture(pointerId);
      } catch {}
    }, 300);
  });

  // 비패시브 touchmove — pointermove의 preventDefault로는 이미 시작된 네이티브
  // 스크롤/새로고침 제스처를 취소할 수 없다. 드래그는 300ms 정지 후 시작되므로
  // 이 시점엔 아직 스크롤이 시작되지 않아 여기서 확실히 막을 수 있다.
  listEl.addEventListener(
    "touchmove",
    (e) => {
      if (dragging) e.preventDefault();
    },
    { passive: false }
  );

  listEl.addEventListener("pointermove", (e) => {
    if (!dragEl || e.pointerId !== pointerId) return;
    if (!dragging) {
      if (Math.abs(e.clientY - startY) > 8) {
        clearTimeout(pressTimer);
        dragEl.classList.remove("pressing");
        dragEl = null;
      }
      return;
    }
    e.preventDefault();
    lastY = e.clientY;
    applyTransform();
    reorderAt(lastY);
    if (!autoScrollRaf) autoScrollRaf = requestAnimationFrame(autoScroll);
  });

  function endDrag(e) {
    if (e && dragEl && e.pointerId !== pointerId) return;
    clearTimeout(pressTimer);
    if (!dragEl) {
      dragging = false;
      return;
    }
    const el = dragEl;
    const wasDragging = dragging;
    const id = el.dataset.id;

    if (wasDragging) {
      // 손가락을 뗀 자리에서 제자리로 스르륵 안착시킨다.
      const from = el.style.transform;
      cleanupVisual();
      if (!REDUCED_MOTION()) {
        el.animate([{ transform: from }, { transform: "none" }], {
          duration: 180,
          easing: "cubic-bezier(.2,.8,.2,1)",
        });
      }
      onReorder(items().map((x) => x.dataset.id));
    } else {
      cleanupVisual();
      onTap(id);
    }
    dragEl = null;
    dragging = false;
    originalOrder = null;
  }

  function cancelDrag(e) {
    if (e && dragEl && e.pointerId !== pointerId) return;
    clearTimeout(pressTimer);
    // 전화 수신 등으로 제스처가 끊기면 중간 순서를 저장하지 말고 원래대로 되돌린다.
    if (dragging && originalOrder) originalOrder.forEach((x) => listEl.appendChild(x));
    cleanupVisual();
    dragEl = null;
    dragging = false;
    originalOrder = null;
  }

  listEl.addEventListener("pointerup", endDrag);
  listEl.addEventListener("pointercancel", cancelDrag);
}

function renderPresetControls() {
  const wrap = el("div", { className: "settings-group" });
  wrap.appendChild(el("h3", { textContent: "프리셋" }));
  const list = el("div", { className: "preset-list" });
  Object.keys(store.presets).forEach((name) => {
    const chip = el("button", { className: "preset-chip", textContent: name + "  ×" });
    chip.addEventListener("click", (e) => {
      if (confirm(`"${name}" 프리셋을 불러올까요? 현재 편집 중인 내용은 사라집니다.`)) {
        state.editorBlocks = store.presets[name].map((b) => ({ ...b }));
        renderEditor();
      }
    });
    list.appendChild(chip);
  });
  const saveBtn = el("button", { className: "preset-chip", textContent: "+ 현재 저장" });
  saveBtn.addEventListener("click", () => {
    const name = prompt("프리셋 이름을 입력하세요");
    if (!name) return;
    store.presets[name] = state.editorBlocks.map((b) => ({ ...b }));
    saveStore(true);
    renderEditor();
  });
  list.appendChild(saveBtn);
  wrap.appendChild(list);
  return wrap;
}

// ---- 설정 시트 ----

function openSettingsSheet() {
  state.activeSheet = "settings";
  renderSettings();
}

function renderSettings() {
  const s = store.settings;

  const editRoutineBtn = el("button", { className: "btn btn--ghost btn--block", textContent: "루틴 편집 열기" });
  editRoutineBtn.addEventListener("click", () => {
    closeSheet();
    openEditorSheet();
  });

  const baseWakeInput = el("input", { type: "time", value: s.baseWake });
  const baseSleepInput = el("input", { type: "time", value: s.baseSleep });
  const sleepTargetInput = el("input", { type: "number", value: Math.round(s.sleepTargetMinutes / 60 * 10) / 10, step: 0.5, min: 4, max: 12 });
  const dropBreakfastInput = el("input", { type: "checkbox", checked: s.dropBreakfastWhenLate });

  const basics = el("div", { className: "settings-group" });
  basics.appendChild(el("h3", { textContent: "기준 시각" }));
  basics.appendChild(fieldRow("기본 기상", baseWakeInput));
  basics.appendChild(fieldRow("기본 취침", baseSleepInput));
  basics.appendChild(fieldRow("목표 수면 시간(시간)", sleepTargetInput));
  const dropRow = fieldRow("기상이 늦으면 아침 식사 자동 삭제", dropBreakfastInput);
  dropRow.classList.add("inline");
  basics.appendChild(dropRow);

  const priorityGroup = el("div", { className: "settings-group" });
  priorityGroup.appendChild(el("h3", { textContent: "축소 우선순위 (위에서부터 먼저 줄어듭니다)" }));
  const priorityList = el("ul", { className: "priority-list" });
  const order = [...s.reducePriority];
  function renderPriorityList() {
    priorityList.innerHTML = "";
    order.forEach((name, i) => {
      const li = el("li", {});
      li.appendChild(el("span", { className: "rank", textContent: String(i + 1) }));
      li.appendChild(el("span", { textContent: name, style: "flex:1" }));
      const upBtn = el("button", { className: "btn btn--ghost", textContent: "↑" });
      upBtn.style.padding = "4px 10px";
      upBtn.disabled = i === 0;
      upBtn.addEventListener("click", () => {
        [order[i - 1], order[i]] = [order[i], order[i - 1]];
        renderPriorityList();
      });
      const downBtn = el("button", { className: "btn btn--ghost", textContent: "↓" });
      downBtn.style.padding = "4px 10px";
      downBtn.disabled = i === order.length - 1;
      downBtn.addEventListener("click", () => {
        [order[i + 1], order[i]] = [order[i], order[i + 1]];
        renderPriorityList();
      });
      li.appendChild(upBtn);
      li.appendChild(downBtn);
      priorityList.appendChild(li);
    });
  }
  renderPriorityList();
  priorityGroup.appendChild(priorityList);

  const dataGroup = el("div", { className: "settings-group" });
  dataGroup.appendChild(el("h3", { textContent: "백업" }));
  const btnRow = el("div", { className: "btn-row" });
  const exportBtn = el("button", { className: "btn btn--ghost", textContent: "내보내기" });
  exportBtn.addEventListener("click", exportData);
  const importLabel = el("label", { className: "btn btn--ghost", textContent: "불러오기" });
  importLabel.style.textAlign = "center";
  const importInput = el("input", { type: "file", accept: "application/json", style: "display:none" });
  importInput.addEventListener("change", (e) => {
    if (e.target.files[0]) importData(e.target.files[0]);
  });
  importLabel.appendChild(importInput);
  btnRow.appendChild(exportBtn);
  btnRow.appendChild(importLabel);
  dataGroup.appendChild(btnRow);
  const resetBtn = el("button", { className: "btn btn--danger btn--block", textContent: "초기화" });
  resetBtn.style.marginTop = "10px";
  resetBtn.addEventListener("click", () => {
    if (confirm("모든 설정과 루틴을 기본값으로 되돌릴까요? 되돌릴 수 없습니다.")) {
      store = defaultStore();
      saveStore(true);
      closeSheet();
      renderShell();
    }
  });
  dataGroup.appendChild(resetBtn);

  const saveBtn = el("button", { className: "btn btn--primary", textContent: "저장" });
  saveBtn.addEventListener("click", () => {
    s.baseWake = baseWakeInput.value || s.baseWake;
    s.baseSleep = baseSleepInput.value || s.baseSleep;
    s.sleepTargetMinutes = Math.round(Number(sleepTargetInput.value) * 60) || s.sleepTargetMinutes;
    s.dropBreakfastWhenLate = dropBreakfastInput.checked;
    s.reducePriority = order;
    saveStore(true);
    closeSheet();
    renderShell();
  });
  const cancelBtn = el("button", { className: "btn btn--ghost", textContent: "닫기" });
  cancelBtn.addEventListener("click", closeSheet);

  openSheet("설정", null, [editRoutineBtn, basics, priorityGroup, dataGroup], [cancelBtn, saveBtn]);
}

function exportData() {
  const blob = new Blob([JSON.stringify(store, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: `schedule-backup-${logicalDateKey(new Date(), store.settings.dayBoundaryHour)}.json` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || !Array.isArray(parsed.blocks) || !parsed.settings) throw new Error("invalid shape");
      store = migrate(parsed);
      saveStore(true);
      closeSheet();
      renderShell();
    } catch (e) {
      alert("올바른 백업 파일이 아닙니다.");
    }
  };
  reader.readAsText(file);
}

// ---------------------------------------------------------------
// 초기화
// ---------------------------------------------------------------

document.getElementById("refresh-btn").addEventListener("click", () => loadTodayJson(true));
document.getElementById("settings-btn").addEventListener("click", openSettingsSheet);
document.getElementById("settings-btn").innerHTML = ICONS.gear;
document.getElementById("refresh-btn").innerHTML = ICONS.refresh;

loadTodayJson(false);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("service-worker.js", { scope: "./" });
}
