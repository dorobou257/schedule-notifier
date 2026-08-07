// 저장소 — localStorage 단일 키. 쓰기는 디바운스, 확정 동작(적용/되돌리기 등)은
// 즉시 쓴다. DOM은 건드리지 않는다 — Node(`node --test`)에서 그대로 임포트해서
// 여러 날에 걸친 롤오버 시나리오를 재생할 수 있어야 한다.
//
// localStorage가 아예 없는 환경(Node)이나 접근이 막힌 환경(사생활 보호 모드)에서도
// 죽지 않는다. 읽기·쓰기 모두 try/catch로 감싸 두었고, 그 경우 세션 동안은
// 메모리 상태로만 동작한다.
import { BASE_BLOCKS, SEMESTER_BLOCKS, DEFAULT_SETTINGS, logicalDateKey } from "./routine.js";
import { isWithinSemester, parseLectures } from "./lectures.js";
import { SEMESTER, TIMETABLE } from "./semester-2026-2.js";

export const STORAGE_KEY = "schedule.v1";

/** 저장본 모양의 버전. 올릴 때마다 migrate()에 한 번짜리 손질을 더한다. */
export const STORE_VERSION = 2;

export function emptySleep() {
  // forDate: 이 취침 기록이 "어느 논리적 날짜의 기상"을 예측하는지. 취침은 보통
  // 밤에 기록하므로 forDate는 대개 지금(now)의 논리적 날짜보다 하루 뒤다 —
  // 그래서 그날 밤 동안은 "예정" 상태로만 저장해두고, 실제로 그 날짜가 되어야
  // 오늘 일정 계산에 반영한다.
  return { forDate: null, bedAt: null, wakeOverride: null, protectedOverrides: [], accepted: false };
}

/** "YYYY-MM-DD" 하루 뒤의 같은 형식 날짜 키. */
export function nextDateKey(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(y, m - 1, d + 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export function defaultStore() {
  return {
    version: STORE_VERSION,
    settings: { ...DEFAULT_SETTINGS },
    // 방학 루틴과 학기 루틴을 따로 둔다. 강의가 하루의 절반을 가져가는 학기에는
    // 집필·작업 횟수 자체가 다르다 — 식사 시각만 갈아끼우는 걸로는 안 된다.
    blocks: BASE_BLOCKS.map((b) => ({ ...b })),
    semesterBlocks: SEMESTER_BLOCKS.map((b) => ({ ...b })),
    presets: {},
    today: emptySleep(),
    // 그날 하루만 적용되는 손질. 날짜가 바뀌면 통째로 비운다.
    //   categories[blockId]: 오늘만 이 블록을 다른 성격으로 취급(집필↔작업)
    //   showRoutine: 특별 일정이 있는 날에도 루틴을 펼쳐서 볼지
    //   unpinned: 오늘만 시각 고정을 푼 블록들(끌어서 옮긴 점심·강의 등)
    //   skippedLectures: 오늘만 없는 강의(휴강·보강)
    dayTweaks: { date: null, categories: {}, showRoutine: false, unpinned: [], skippedLectures: [] },
    // 소설 일정 ↔ 집필 블록 배정. map[blockId] = 소설 항목 키(사용자가 직접 지정),
    // excluded = 어디에도 배정하지 않기로 한 항목 키들. 둘 다 해당 없는 항목은
    // 남은 집필 블록에 순서대로 자동 배정된다. 날짜가 바뀌면 통째로 비운다.
    novelAssign: { date: null, map: {}, excluded: [] },
    // 끼니별로 등록해 둔 메뉴 후보. 오래 남는다(하루짜리가 아니다).
    mealPool: { lunch: [], dinner: [] },
    // 오늘의 식단. byBlockId[식사 블록 id] = "김치찌개". 날짜가 바뀌면 비운다.
    meals: { date: null, byBlockId: {} },
    // 최근에 뭘 먹었는지. 같은 메뉴가 연달아 나오지 않게 하는 데만 쓰므로
    // 오래 들고 있을 이유가 없다(MEAL_HISTORY_DAYS일치만 남긴다).
    mealHistory: [],
    // 강의 시간표. blocks와 따로 두는 이유: 학기마다 통째로 갈아끼우는데,
    // 사용자가 손봐온 루틴까지 같이 덮으면 안 된다.
    lectures: parseLectures(TIMETABLE).lectures,
    // 학기 기간. 비워두면 "항상"으로 본다 — 적지 않아도 쓸 수 있어야 한다.
    semester: { ...SEMESTER },
  };
}

/**
 * 이 날짜에 적용할 루틴 배열. 학기 안이면 학기 루틴, 아니면 방학 루틴이다.
 * 화면·주간 보기·저장 어느 쪽이든 반드시 이 함수를 거쳐야 둘이 어긋나지 않는다.
 *
 * 학기 기간을 아예 안 적어두면 방학 루틴을 쓴다 — isWithinSemester는 비어 있는
 * 기간을 "항상"으로 보지만, 여기서는 그 반대가 맞다(학기를 적지 않은 사람에게
 * 강의 전제의 루틴을 씌울 이유가 없다).
 */
export function activeBlocks(dateKey) {
  const s = store.semester || {};
  const bounded = !!(s.start || s.end);
  return bounded && isWithinSemester(dateKey, s) ? store.semesterBlocks : store.blocks;
}

/** 이 날짜의 루틴이 저장본의 어느 칸에 들어 있는지(순서 편집을 되돌려 쓸 때 필요). */
export function activeBlocksKey(dateKey) {
  return activeBlocks(dateKey) === store.semesterBlocks ? "semesterBlocks" : "blocks";
}

/** 식사 기록을 며칠치까지 들고 있을지. */
export const MEAL_HISTORY_DAYS = 14;

/** 오늘 먹은 걸 기록에 남기고 오래된 건 버린다. 같은 날 같은 블록은 덮어쓴다. */
export function rememberMeal(dateKey, blockId, text) {
  const kept = (store.mealHistory || []).filter((m) => !(m.date === dateKey && m.blockId === blockId));
  if (text) kept.push({ date: dateKey, blockId, text });
  const cutoff = shiftDateKey(dateKey, -MEAL_HISTORY_DAYS);
  store.mealHistory = kept.filter((m) => m.date > cutoff);
  // 사용자가 "이걸 먹는다"고 확정한 순간이라 즉시 쓴다. 디바운스로 미뤄두면
  // 곧바로 앱을 닫았을 때 기록만 빠진 채 저장된다.
  saveStore(true);
}

/** "YYYY-MM-DD"에서 days만큼 옮긴 같은 형식의 날짜 키. */
export function shiftDateKey(dateKey, days) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/**
 * 저장본을 현재 모양으로 맞춘다. 낡은 버전, 손으로 고친 백업 파일, 일부 필드가
 * 통째로 빠진 저장본까지 들어올 수 있으므로 필드마다 모양을 확인하고 아니면
 * 기본값으로 되돌린다 — 여기서 한 번 걸러야 화면 쪽이 방어 코드를 안 써도 된다.
 */
export function migrate(parsed) {
  const base = defaultStore();
  const p = upgrade(parsed && typeof parsed === "object" ? parsed : {}, base);
  return {
    version: STORE_VERSION,
    settings: { ...base.settings, ...(p.settings || {}) },
    blocks: Array.isArray(p.blocks) && p.blocks.length ? p.blocks : base.blocks,
    semesterBlocks: Array.isArray(p.semesterBlocks) && p.semesterBlocks.length ? p.semesterBlocks : base.semesterBlocks,
    presets: p.presets && typeof p.presets === "object" ? p.presets : {},
    today: p.today && typeof p.today === "object" ? { ...emptySleep(), ...p.today } : base.today,
    dayTweaks:
      p.dayTweaks && typeof p.dayTweaks.categories === "object"
        ? {
            date: p.dayTweaks.date || null,
            categories: p.dayTweaks.categories,
            showRoutine: !!p.dayTweaks.showRoutine,
            unpinned: Array.isArray(p.dayTweaks.unpinned) ? p.dayTweaks.unpinned : [],
            skippedLectures: Array.isArray(p.dayTweaks.skippedLectures) ? p.dayTweaks.skippedLectures : [],
          }
        : base.dayTweaks,
    novelAssign:
      p.novelAssign && typeof p.novelAssign.map === "object"
        ? {
            date: p.novelAssign.date || null,
            map: p.novelAssign.map,
            excluded: Array.isArray(p.novelAssign.excluded) ? p.novelAssign.excluded : [],
          }
        : base.novelAssign,
    mealPool: {
      lunch: strings(p.mealPool?.lunch),
      dinner: strings(p.mealPool?.dinner),
    },
    meals:
      p.meals && typeof p.meals.byBlockId === "object"
        ? { date: p.meals.date || null, byBlockId: p.meals.byBlockId }
        : base.meals,
    mealHistory: Array.isArray(p.mealHistory)
      ? p.mealHistory.filter((m) => m && typeof m.date === "string" && typeof m.text === "string")
      : [],
    lectures: Array.isArray(p.lectures)
      ? p.lectures.filter((l) => l && typeof l.name === "string" && Array.isArray(l.days) && typeof l.start === "string")
      : [],
    semester:
      p.semester && typeof p.semester === "object"
        ? { start: p.semester.start || null, end: p.semester.end || null }
        : base.semester,
  };
}

/**
 * 버전이 낮은 저장본에 한 번짜리 손질을 한다. migrate()의 모양 정리와 달리
 * 여기서는 "예전 값을 새 값으로 갈아끼우는" 일만 한다 — 매번 돌면 사용자가
 * 그 뒤에 고친 것을 계속 되돌려버리므로 version으로 딱 한 번만 지난다.
 *
 * v1 → v2: 2026년 2학기 개편. 기상 08:00은 그대로 두고 취침을 00:00으로,
 * 수면을 8시간으로 늘리고 아침 식사를 없앴다. 루틴 자체를 갈아엎는 게 목적이라
 * 사용자가 손봐온 blocks도 함께 덮는다 — "학기 시간표를 갈아끼워도 손본 루틴은
 * 지키자"던 원칙(defaultStore의 lectures 주석)과 여기서만 일부러 어긋난다.
 * 시간표와 학기 기간은 이미 적어둔 것이 있으면 건드리지 않는다.
 */
function upgrade(p, base) {
  if (Number(p.version) >= 2) return p;

  const settings = { ...(p.settings || {}) };
  delete settings.semesterMeals;
  delete settings.dropBreakfastWhenLate;
  settings.baseSleep = base.settings.baseSleep;
  settings.sleepTargetMinutes = base.settings.sleepTargetMinutes;

  const mealPool = { ...(p.mealPool || {}) };
  delete mealPool.breakfast;
  const byBlockId = { ...(p.meals?.byBlockId || {}) };
  delete byBlockId.breakfast;

  return {
    ...p,
    version: 2,
    settings,
    mealPool,
    meals: { ...(p.meals || {}), byBlockId },
    blocks: base.blocks,
    semesterBlocks: base.semesterBlocks,
    lectures: Array.isArray(p.lectures) && p.lectures.length ? p.lectures : base.lectures,
    semester: p.semester?.start || p.semester?.end ? p.semester : base.semester,
  };
}

/** 문자열만 남긴 배열. 손으로 고친 백업 파일이 들어와도 화면이 깨지지 않게 한다. */
function strings(v) {
  return Array.isArray(v) ? v.filter((s) => typeof s === "string" && s.trim()) : [];
}

export function loadStore() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    raw = null; // localStorage 자체가 없거나(Node) 막혀 있다
  }
  if (!raw) return defaultStore();
  try {
    return migrate(JSON.parse(raw));
  } catch {
    return defaultStore();
  }
}

// ES 모듈의 export는 살아있는 바인딩이라, 여기서 store를 갈아끼우면 임포트한
// 쪽에서도 새 값이 보인다. 덕분에 app.js는 `store.settings...`를 예전처럼
// 그대로 쓰면서, 초기화/불러오기만 setStore를 거치면 된다.
export let store = loadStore();

export function setStore(next) {
  store = next;
}

let saveTimer = null;
export function saveStore(immediate) {
  const write = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      /* 접근 불가(사생활 보호 모드 등) — 조용히 무시, 세션 동안은 메모리 상태로 계속 동작 */
    }
  };
  clearTimeout(saveTimer);
  if (immediate) {
    write();
  } else {
    saveTimer = setTimeout(write, 400);
  }
}

/**
 * 하루짜리 상태들을 논리적 날짜에 맞춰 정리한다.
 *
 * 취침 기록이 예측하는 날짜(forDate)가 이미 지나버렸으면(오늘보다 이전이면)
 * 낡은 기록이니 비운다. forDate가 오늘이거나(적용 중) 내일이면(아직 밤이라
 * 대기 중) 그대로 둔다 — 이 둘을 구분 못 하고 무조건 지우면, 밤에 기록해둔
 * 취침이 자정~새벽 사이 논리적 날짜가 바뀌는 순간 적용되기도 전에 사라진다.
 *
 * @returns {boolean} 취침 기록을 비웠는지. 화면 쪽은 이때 제안 시트를 다시
 *   띄울 수 있게 "닫아둠" 표시를 푼다(그 판단은 UI의 몫이라 여기서 안 한다).
 */
export function rolloverIfStale(now) {
  const todayKey = logicalDateKey(now, store.settings.dayBoundaryHour);
  let sleepReset = false;

  if (store.today.forDate && store.today.forDate < todayKey) {
    store.today = emptySleep();
    saveStore(true);
    sleepReset = true;
  }
  // 소설 배정은 그날 하루짜리다 — 날짜가 바뀌면 비우고 다시 자동 배정한다.
  if (store.novelAssign.date !== todayKey) {
    store.novelAssign = { date: todayKey, map: {}, excluded: [] };
    saveStore(true);
  }
  // 집필↔작업 교체도, 시각 고정 해제도 오늘 하루짜리 — 내일은 원래 루틴이다.
  if (store.dayTweaks.date !== todayKey) {
    store.dayTweaks = { date: todayKey, categories: {}, showRoutine: false, unpinned: [], skippedLectures: [] };
    saveStore(true);
  }
  // 어제 먹은 걸 오늘 화면에 띄워둘 이유는 없다. 다만 기록으로는 남겨둔다 —
  // 같은 메뉴를 연달아 추천하지 않는 데 쓴다.
  if (store.meals.date !== todayKey) {
    store.meals = { date: todayKey, byBlockId: {} };
    saveStore(true);
  }
  return sleepReset;
}
