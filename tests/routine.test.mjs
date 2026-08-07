import test from "node:test";
import assert from "node:assert/strict";
import {
  BASE_BLOCKS,
  SEMESTER_BLOCKS,
  DEFAULT_SETTINGS,
  computeSchedule,
  computeWakeMinutes,
  hhmmToBoundaryMinutes,
  boundaryMinutesToHHMM,
  dateToBoundaryMinutes,
  logicalWeekday,
  logicalDateKey,
  applyVisibleOrder,
} from "../docs/routine.js";

const MON = 0; // 월요일 (notify.py 규칙: 월=0 … 일=6). 운동(월/수/금) 활성일.
const TUE = 1; // 운동 비활성일 확인용.
const THU = 3; // 집필·작업을 아예 하지 않는 휴일.

function byId(result, id) {
  return result.blocks.find((b) => b.id === id);
}
function minutesOf(result, id) {
  const b = byId(result, id);
  return b ? b.end - b.start : undefined;
}

test("hhmm <-> boundary minutes round-trip", () => {
  assert.equal(hhmmToBoundaryMinutes("08:00"), 240);
  assert.equal(hhmmToBoundaryMinutes("12:00"), 480);
  assert.equal(hhmmToBoundaryMinutes("00:00"), 1200);
  assert.equal(boundaryMinutesToHHMM(240), "08:00");
  assert.equal(boundaryMinutesToHHMM(480), "12:00");
  assert.equal(boundaryMinutesToHHMM(1200), "00:00");
});

test("기상 08:00(기준) → 방학 루틴과 완전히 일치, 합계 960분", () => {
  const wakeMinutes = hhmmToBoundaryMinutes("08:00");
  const r = computeSchedule({ blocks: BASE_BLOCKS, settings: DEFAULT_SETTINGS, weekday: MON, wakeMinutes });

  assert.equal(r.warnings.length, 0);
  assert.equal(r.adjustments.length, 0);

  const expected = [
    ["morning", "08:00", "09:00"],
    ["session1", "09:00", "11:00"],
    ["buffer1", "11:00", "12:00"],
    ["lunch", "12:00", "13:00"],
    ["session2", "13:00", "15:00"],
    ["work", "15:00", "17:00"],
    ["buffer2", "17:00", "18:00"],
    ["dinner", "18:00", "19:00"],
    ["session3", "19:00", "21:00"],
    ["exercise", "21:00", "22:00"],
    ["rest", "22:00", "23:00"],
    ["rest2", "23:00", "00:00"],
  ];
  for (const [id, start, end] of expected) {
    const b = byId(r, id);
    assert.equal(boundaryMinutesToHHMM(b.start), start, `${id} start`);
    assert.equal(boundaryMinutesToHHMM(b.end), end, `${id} end`);
  }

  const sleep = byId(r, "sleep");
  assert.equal(boundaryMinutesToHHMM(sleep.start), "00:00");

  const total = r.blocks.filter((b) => b.anchor !== "wake" && b.anchor !== "sleep").reduce((s, b) => s + (b.end - b.start), 0);
  assert.equal(total, 960);
});

test("아침 식사는 루틴에서 아예 사라졌다", () => {
  assert.equal(BASE_BLOCKS.find((b) => b.id === "breakfast"), undefined);
  assert.equal(SEMESTER_BLOCKS.find((b) => b.id === "breakfast"), undefined);
  assert.equal(DEFAULT_SETTINGS.dropBreakfastWhenLate, undefined, "아침을 지우던 설정도 함께 없앤다");
  assert.equal(DEFAULT_SETTINGS.semesterMeals, undefined, "학기 전용 식사 시각도 없앤다(점심은 언제나 12:00)");
});

test("목요일은 집필도 작업도 없는 휴일 — 방학에도 학기에도", () => {
  const wakeMinutes = hhmmToBoundaryMinutes("08:00");
  for (const blocks of [BASE_BLOCKS, SEMESTER_BLOCKS]) {
    const r = computeSchedule({ blocks, settings: DEFAULT_SETTINGS, weekday: THU, wakeMinutes });
    const 생산 = r.blocks.filter((b) => ["집필", "작업"].includes(b.category) && b.minutes > 0);
    assert.deepEqual(생산, [], "목요일엔 집필·작업 블록이 하나도 없어야 한다");
    assert.equal(r.warnings.length, 0);
  }
});

test("기상 10:00(2시간 지연) → 여유가 먼저 사라지고 집필이 남는다", () => {
  const wakeMinutes = hhmmToBoundaryMinutes("10:00");
  const r = computeSchedule({ blocks: BASE_BLOCKS, settings: DEFAULT_SETTINGS, weekday: MON, wakeMinutes });

  assert.equal(r.warnings.length, 0);
  assert.equal(minutesOf(r, "buffer1"), 0, "오전 여유가 먼저 통째로 사라진다");
  assert.equal(minutesOf(r, "morning"), 60, "준비 시간 한 시간은 지켜진다");
  assert.equal(minutesOf(r, "session1"), 60, "1차 집필은 최소치까지만 줄고 살아남는다");
  assert.equal(minutesOf(r, "session2"), 120, "오후는 오전 사정과 무관하다");
  assert.equal(minutesOf(r, "session3"), 120);
  assert.equal(boundaryMinutesToHHMM(byId(r, "lunch").start), "12:00");
  assert.equal(boundaryMinutesToHHMM(byId(r, "sleep").start), "00:00");
});

test("기상 12:00(점심 고정 시각과 동시) → 오전이 통째로 비지만 경고는 없다", () => {
  const wakeMinutes = hhmmToBoundaryMinutes("12:00");
  const r = computeSchedule({ blocks: BASE_BLOCKS, settings: DEFAULT_SETTINGS, weekday: MON, wakeMinutes });

  for (const id of ["morning", "session1", "buffer1"]) {
    assert.equal(minutesOf(r, id), 0, `${id}는 완전히 공백이어야 한다`);
  }
  assert.equal(boundaryMinutesToHHMM(byId(r, "lunch").start), "12:00", "점심은 그대로 12시 고정");
  for (const id of ["session2", "work", "dinner", "session3"]) {
    assert.equal(minutesOf(r, id), BASE_BLOCKS.find((b) => b.id === id).minutes, `${id}는 오후라 변하지 않아야 한다`);
  }
  assert.equal(boundaryMinutesToHHMM(byId(r, "sleep").start), "00:00");
});

test("기상 13:30(점심 고정 시각을 이미 지남) → 오전 세그먼트 전부 공백 + 경고", () => {
  const wakeMinutes = hhmmToBoundaryMinutes("13:30");
  const r = computeSchedule({ blocks: BASE_BLOCKS, settings: DEFAULT_SETTINGS, weekday: MON, wakeMinutes });

  assert.ok(r.warnings.some((w) => w.type === "segment-empty"), "세그먼트 공백 경고가 있어야 한다");
  for (const id of ["morning", "session1", "buffer1"]) {
    assert.equal(minutesOf(r, id), 0, `${id}는 완전히 공백이어야 한다`);
  }
  // 타임라인이 거꾸로 흐르지 않는다: 점심은 기상 이전 시각으로 밀려나지 않는다.
  assert.ok(byId(r, "lunch").start >= wakeMinutes);
  assert.equal(boundaryMinutesToHHMM(byId(r, "sleep").start), "00:00");
});

test("비어 있는 세그먼트를 지나쳐 앵커가 밀려도 경고를 남기지 않는다", () => {
  // 학기 목요일이 이 모양이다 — 강의가 저녁 앵커(18:00)를 넘겨 19시에 끝난다.
  // 잃은 것이 없는데도 경고를 띄우면 매주 목요일 "무리한 하루"가 뜬다(회귀 방지).
  const blocks = [
    { id: "wake", name: "기상", category: "기타", minutes: 0, anchor: "wake", protected: true },
    { id: "lec", name: "강의", category: "강의", minutes: 180, minMinutes: 180, protected: true, anchor: "clock", fixedAt: at("16:00") },
    { id: "dinner", name: "저녁 식사", category: "식사", minutes: 60, minMinutes: 60, protected: true, anchor: "clock", fixedAt: at("18:00") },
    { id: "rest", name: "휴식", category: "여유", minutes: 60, minMinutes: 0 },
    { id: "sleep", name: "취침", category: "기타", minutes: 0, protected: true, anchor: "sleep", fixedAt: at("00:00") },
  ];
  const r = computeSchedule({ blocks, settings: DEFAULT_SETTINGS, weekday: THU, wakeMinutes: at("08:00") });
  assert.equal(r.warnings.length, 0, "잃은 블록이 없으면 경고도 없다");
  assert.equal(boundaryMinutesToHHMM(byId(r, "dinner").start), "19:00", "저녁은 강의가 끝난 뒤로 밀린다");
});

test("기상 07:00(1시간 이름) → 여유가 남는 시간을 흡수해 점심까지 빈틈없이 채운다", () => {
  const wakeMinutes = hhmmToBoundaryMinutes("07:00");
  const r = computeSchedule({ blocks: BASE_BLOCKS, settings: DEFAULT_SETTINGS, weekday: MON, wakeMinutes });

  assert.equal(r.adjustments.length, 0, "이른 기상은 삭제/축소를 유발하지 않는다(단순 확장은 기록 대상이 아님)");
  assert.equal(minutesOf(r, "morning"), 60, "준비 시간 자체는 늘어나지 않는다");
  assert.equal(minutesOf(r, "buffer1"), 120, "1시간 여유분을 오전 여유가 흡수해 60→120분");
  assert.equal(boundaryMinutesToHHMM(byId(r, "morning").start), "07:00");
  assert.equal(boundaryMinutesToHHMM(byId(r, "buffer1").end), "12:00", "빈 시간 없이 점심 시작과 정확히 맞물린다");
  assert.equal(boundaryMinutesToHHMM(byId(r, "lunch").start), "12:00");
});

test("sleepMinutes로 취침을 미루면 휴식이 그만큼 늘어나 취침 시각과 맞물린다", () => {
  const wakeMinutes = hhmmToBoundaryMinutes("08:00");
  const sleepMinutes = hhmmToBoundaryMinutes("01:30"); // 기준(00:00)보다 1시간 30분 늦음
  const r = computeSchedule({ blocks: BASE_BLOCKS, settings: DEFAULT_SETTINGS, weekday: MON, wakeMinutes, sleepMinutes });

  assert.equal(boundaryMinutesToHHMM(byId(r, "sleep").start), "01:30", "취침 앵커 자체가 실제 예약 시각으로 옮겨간다");
  assert.equal(minutesOf(r, "rest2"), 150, "마지막 여유가 90분을 더 흡수해 60→150분");
  assert.equal(boundaryMinutesToHHMM(byId(r, "rest2").end), "01:30", "빈 시간 없이 취침과 맞물린다");
  // 오전 세그먼트는 취침 시각과 무관하게 그대로다.
  assert.equal(minutesOf(r, "morning"), 60);
  assert.equal(r.adjustments.length, 0);
});

test("sleepMinutes를 넘기지 않으면 기본 취침(baseSleep) 그대로 계산된다", () => {
  const wakeMinutes = hhmmToBoundaryMinutes("08:00");
  const r = computeSchedule({ blocks: BASE_BLOCKS, settings: DEFAULT_SETTINGS, weekday: MON, wakeMinutes });
  assert.equal(boundaryMinutesToHHMM(byId(r, "sleep").start), "00:00");
  assert.equal(minutesOf(r, "rest2"), 60);
});

test("반복 요일로 빠진 블록의 시간은 다음 여유 블록이 흡수해 취침 전 빈 시간이 남지 않는다", () => {
  // 화/목처럼 운동(월/수/금 전용)이 없는 날, 그 60분이 허공에 뜨지 않고
  // 같은 세그먼트의 여유 블록이 흡수해야 한다 — 실사용 중 "휴식이 23:00에
  // 끝나는데 취침 00:00까지 빈 시간은 뭐냐"는 혼란으로 이어졌던 버그(회귀 방지).
  const wakeMinutes = hhmmToBoundaryMinutes("08:00");
  const r = computeSchedule({ blocks: BASE_BLOCKS, settings: DEFAULT_SETTINGS, weekday: TUE, wakeMinutes });

  assert.equal(byId(r, "exercise"), undefined, "화요일엔 운동이 없다");
  assert.equal(minutesOf(r, "rest2"), 120, "운동이 빠진 60분을 마지막 여유가 흡수해 60→120분");
  assert.equal(boundaryMinutesToHHMM(byId(r, "rest2").end), "00:00", "빈 시간 없이 취침과 정확히 맞물린다");
  assert.equal(boundaryMinutesToHHMM(byId(r, "sleep").start), "00:00");
  assert.equal(r.adjustments.length, 0, "정상 기상일엔 확장이 조정 제안으로 뜨지 않는다");
});

test("우선순위를 뒤집으면(집필이 최우선으로 희생) 다른 블록이 대신 줄어든다", () => {
  // 09:00 기상 = 한 시간 부족. 기본 순서라면 여유 하나로 메워진다.
  const wakeMinutes = hhmmToBoundaryMinutes("09:00");
  const base = computeSchedule({ blocks: BASE_BLOCKS, settings: DEFAULT_SETTINGS, weekday: MON, wakeMinutes });
  assert.equal(minutesOf(base, "buffer1"), 0, "기본 순서에선 여유가 먼저 사라진다");
  assert.equal(minutesOf(base, "session1"), 120, "집필은 그대로");

  const reversedSettings = { ...DEFAULT_SETTINGS, reducePriority: ["집필", "작업", "운동", "여유"] };
  const r = computeSchedule({ blocks: BASE_BLOCKS, settings: reversedSettings, weekday: MON, wakeMinutes });
  assert.equal(minutesOf(r, "session1"), 60, "이번엔 집필이 먼저 최소치까지 줄어든다");
  assert.equal(minutesOf(r, "buffer1"), 60, "여유는 우선순위가 밀려 그대로 보존된다");
});

test("점심 앵커를 12:30으로 옮기면 세그먼트 경계가 함께 이동한다", () => {
  const movedLunchBlocks = BASE_BLOCKS.map((b) => (b.id === "lunch" ? { ...b, fixedAt: hhmmToBoundaryMinutes("12:30") } : b));
  const wakeMinutes = hhmmToBoundaryMinutes("08:00");
  const r = computeSchedule({ blocks: movedLunchBlocks, settings: DEFAULT_SETTINGS, weekday: MON, wakeMinutes });

  assert.equal(boundaryMinutesToHHMM(byId(r, "lunch").start), "12:30");
  // 오전 예산이 270분으로 늘어 여유가 60→90으로 30분을 더 흡수한다.
  assert.equal(minutesOf(r, "buffer1"), 90);
  assert.equal(minutesOf(r, "morning"), 60, "예산이 충분해 준비 시간은 건드리지 않는다");
});

test("반복 요일: 운동은 화요일엔 아예 하루에서 빠진다", () => {
  const wakeMinutes = hhmmToBoundaryMinutes("08:00");
  const r = computeSchedule({ blocks: BASE_BLOCKS, settings: DEFAULT_SETTINGS, weekday: TUE, wakeMinutes });
  assert.equal(byId(r, "exercise"), undefined, "화요일엔 운동 블록 자체가 결과에 없어야 한다");
});

test("computeWakeMinutes: 보정 > 취침 기록 > 기본값 우선순위", () => {
  const baseWakeMinutes = hhmmToBoundaryMinutes("08:00");
  assert.equal(
    computeWakeMinutes({ bedAtMinutes: null, wakeOverrideMinutes: null, sleepTargetMinutes: 450, baseWakeMinutes }),
    baseWakeMinutes,
    "둘 다 없으면 기본 기상"
  );
  const bedAtMinutes = hhmmToBoundaryMinutes("02:30");
  assert.equal(
    computeWakeMinutes({ bedAtMinutes, wakeOverrideMinutes: null, sleepTargetMinutes: 450, baseWakeMinutes }),
    (bedAtMinutes + 450) % 1440,
    "취침 기록 + 수면 목표 (1440분 범위로 접힘)"
  );
  const override = hhmmToBoundaryMinutes("11:15");
  assert.equal(
    computeWakeMinutes({ bedAtMinutes, wakeOverrideMinutes: override, sleepTargetMinutes: 450, baseWakeMinutes }),
    override,
    "아침 보정이 최우선"
  );
});

test("computeWakeMinutes: 저녁에 취침을 기록하면 1440분을 넘는 합도 하루 범위로 접힌다", () => {
  // 22:00 취침 + 8시간 목표 = 다음날 06:00. 접지 않으면 1440을 넘는 원값이
  // 그대로 반환되어, 점심(480)·취침(1200) 같은 [0,1440) 범위의 고정 앵커와 좌표계가
  // 어긋나 하루 전체가 지워지는 버그가 났었다(회귀 방지).
  const baseWakeMinutes = hhmmToBoundaryMinutes("08:00");
  const bedAtMinutes = hhmmToBoundaryMinutes("22:00");
  const wakeMinutes = computeWakeMinutes({ bedAtMinutes, wakeOverrideMinutes: null, sleepTargetMinutes: 480, baseWakeMinutes });
  assert.ok(wakeMinutes < 1440, "항상 [0, 1440) 범위여야 한다");
  assert.equal(boundaryMinutesToHHMM(wakeMinutes), "06:00");

  const r = computeSchedule({ blocks: BASE_BLOCKS, settings: DEFAULT_SETTINGS, weekday: MON, wakeMinutes });
  assert.equal(r.warnings.length, 0, "정상적인 이른 기상이라 세그먼트 붕괴가 없어야 한다");
  assert.equal(minutesOf(r, "morning"), 60, "준비 시간은 그대로다");
  assert.equal(boundaryMinutesToHHMM(byId(r, "sleep").start), "00:00", "취침은 그대로 유지");
});

test("dateToBoundaryMinutes / logicalWeekday: 자정 넘긴 새벽엔 전날로 취급", () => {
  const lateNight = new Date(2026, 6, 30, 1, 15); // 2026-07-30(목) 01:15 → 논리적으로는 수요일 밤의 연장
  assert.equal(dateToBoundaryMinutes(lateNight), hhmmToBoundaryMinutes("01:15"));
  assert.equal(logicalWeekday(lateNight), 2, "목요일 새벽 01:15는 논리적으로 수요일(=2)");

  const morning = new Date(2026, 6, 30, 9, 0); // 같은 날 09:00은 그대로 목요일(=3)
  assert.equal(logicalWeekday(morning), 3);

  assert.equal(logicalDateKey(lateNight), "2026-07-29");
  assert.equal(logicalDateKey(morning), "2026-07-30");
});

// ---------------------------------------------------------------
// applyVisibleOrder — 메인 화면에서 바꾼 순서를 전체 블록에 반영하기
// ---------------------------------------------------------------

const ids = (blocks) => blocks.map((b) => b.id);

test("applyVisibleOrder: 전부 보이는 경우 그대로 새 순서가 된다", () => {
  const blocks = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(ids(applyVisibleOrder(blocks, ["c", "a", "b"])), ["c", "a", "b"]);
});

test("applyVisibleOrder: 화면에 없는 블록은 원래 인덱스에 고정된다", () => {
  // 화요일엔 운동(exercise)이 화면에 없다 — 3차 집필과 휴식만 자리를 바꿔도
  // 운동은 원래 있던 자리(인덱스 1)에 그대로 있어야 한다.
  const blocks = [{ id: "session3" }, { id: "exercise" }, { id: "rest" }];
  const result = applyVisibleOrder(blocks, ["rest", "session3"]);
  assert.deepEqual(ids(result), ["rest", "exercise", "session3"]);
});

test("applyVisibleOrder: 블록 객체는 새로 만들지 않고 그대로 옮긴다", () => {
  const a = { id: "a", minutes: 30 };
  const b = { id: "b", minutes: 60 };
  const result = applyVisibleOrder([a, b], ["b", "a"]);
  assert.equal(result[0], b);
  assert.equal(result[1], a);
});

test("applyVisibleOrder: 원본 배열을 변형하지 않는다", () => {
  const blocks = [{ id: "a" }, { id: "b" }];
  applyVisibleOrder(blocks, ["b", "a"]);
  assert.deepEqual(ids(blocks), ["a", "b"]);
});

test("applyVisibleOrder: 모르는 id나 중복은 무시한다", () => {
  const blocks = [{ id: "a" }, { id: "b" }, { id: "c" }];
  // DOM에서 온 값이라 신뢰할 수 없다 — 유효한 id만 순서대로 채우고
  // 나머지 자리는 원래 블록이 유지되어야 한다.
  assert.deepEqual(ids(applyVisibleOrder(blocks, ["c", "zzz", "c", "a"])), ["c", "b", "a"]);
});

test("applyVisibleOrder: 실제 BASE_BLOCKS에서 유동 블록만 뒤집어도 고정 앵커는 제자리", () => {
  const visible = BASE_BLOCKS.map((b) => b.id);
  // 1차 집필과 여유의 자리를 바꾼다.
  const i = visible.indexOf("session1");
  [visible[i], visible[i + 1]] = [visible[i + 1], visible[i]];
  const result = ids(applyVisibleOrder(BASE_BLOCKS, visible));
  assert.equal(result[0], "wake");
  assert.equal(result[result.length - 1], "sleep");
  assert.equal(result.indexOf("lunch"), BASE_BLOCKS.findIndex((b) => b.id === "lunch"));
  assert.ok(result.indexOf("buffer1") < result.indexOf("session1"));
});

// ---------------------------------------------------------------
// 시각 고정 앵커 정렬
//
// 강의가 들어오면 clock 앵커가 여러 개가 되고, 메인 화면에서 순서를 자유롭게
// 바꿀 수 있게 되면서 "배열 순서 ≠ 시각 순서"가 될 수 있다. 예전 코드는 배열
// 순서대로 앵커를 처리하다가 고정 시각이 커서보다 앞이면 그 구간을 통째로
// 비워버렸다 — 강의 하나 잘못 끌면 하루가 사라진다는 뜻이다.
// ---------------------------------------------------------------

const at = (hhmm) => hhmmToBoundaryMinutes(hhmm);

/** 강의 두 개가 낀 하루. 배열 순서는 인자로 받아 뒤섞을 수 있게 한다. */
function dayWithLectures(order) {
  const byId = {
    wake: { id: "wake", name: "기상", category: "기타", minutes: 0, anchor: "wake", protected: true },
    lec1: { id: "lec1", name: "자료구조", category: "강의", minutes: 75, minMinutes: 75, protected: true, anchor: "clock", fixedAt: at("10:00") },
    lec2: { id: "lec2", name: "알고리즘", category: "강의", minutes: 75, minMinutes: 75, protected: true, anchor: "clock", fixedAt: at("15:00") },
    lunch: { id: "lunch", name: "점심 식사", category: "식사", minutes: 60, minMinutes: 60, protected: true, anchor: "clock", fixedAt: at("13:00") },
    buffer: { id: "buffer", name: "여유", category: "여유", minutes: 60, minMinutes: 0 },
    rest: { id: "rest", name: "휴식", category: "여유", minutes: 60, minMinutes: 0 },
    sleep: { id: "sleep", name: "취침", category: "기타", minutes: 0, protected: true, anchor: "sleep", fixedAt: at("00:30") },
  };
  return order.map((id) => byId[id]);
}

const startOf = (r, id) => boundaryMinutesToHHMM(byId(r, id).start);

test("시각 고정 블록은 배열 순서가 뒤섞여도 제 시각에 배치된다", () => {
  const 정순 = ["wake", "buffer", "lec1", "lunch", "lec2", "rest", "sleep"];
  const 뒤섞임 = ["wake", "buffer", "lec2", "lunch", "lec1", "rest", "sleep"]; // 강의 둘의 자리를 바꿈

  const opts = { settings: DEFAULT_SETTINGS, weekday: MON, wakeMinutes: at("08:00") };
  const a = computeSchedule({ ...opts, blocks: dayWithLectures(정순) });
  const b = computeSchedule({ ...opts, blocks: dayWithLectures(뒤섞임) });

  for (const r of [a, b]) {
    assert.equal(startOf(r, "lec1"), "10:00");
    assert.equal(startOf(r, "lunch"), "13:00");
    assert.equal(startOf(r, "lec2"), "15:00");
    assert.equal(r.warnings.length, 0, "하루가 비어버리면 안 된다");
  }
  assert.deepEqual(ids(a.blocks), ids(b.blocks), "결과 배치는 같아야 한다");
});

test("앵커를 뒤집어도 유동 블록끼리의 순서는 사용자가 정한 대로 유지된다", () => {
  const blocks = dayWithLectures(["wake", "rest", "lec2", "lunch", "lec1", "buffer", "sleep"]);
  const r = computeSchedule({ blocks, settings: DEFAULT_SETTINGS, weekday: MON, wakeMinutes: at("08:00") });

  const 유동 = ids(r.blocks).filter((id) => id === "rest" || id === "buffer");
  assert.deepEqual(유동, ["rest", "buffer"], "휴식이 여유보다 앞이라는 사용자 순서는 그대로");
  assert.equal(startOf(r, "lec1"), "10:00");
  assert.equal(startOf(r, "lec2"), "15:00");
});

test("루틴 앵커들은 정렬을 거쳐도 제 시각 그대로다", () => {
  const r = computeSchedule({
    blocks: BASE_BLOCKS,
    settings: DEFAULT_SETTINGS,
    weekday: MON,
    wakeMinutes: at("08:00"),
  });
  assert.equal(startOf(r, "lunch"), "12:00");
  assert.equal(startOf(r, "dinner"), "18:00");
  assert.equal(startOf(r, "exercise"), "21:00");
  assert.equal(startOf(r, "sleep"), "00:00");
  assert.equal(r.adjustments.length, 0);
});

test("취침을 미루면 취침 앵커도 새 시각 기준으로 자리를 잡는다", () => {
  // sleepMinutes(02:00)가 들어오면 취침은 lec2(15:00)보다 뒤라는 판단이 유지돼야 한다.
  const blocks = dayWithLectures(["wake", "buffer", "lec1", "lunch", "lec2", "rest", "sleep"]);
  const r = computeSchedule({
    blocks,
    settings: DEFAULT_SETTINGS,
    weekday: MON,
    wakeMinutes: at("08:00"),
    sleepMinutes: at("02:00"),
  });
  assert.equal(startOf(r, "sleep"), "02:00");
  assert.equal(startOf(r, "lec2"), "15:00");
  assert.equal(r.warnings.length, 0);
});

test("정렬은 호출자의 배열을 변형하지 않는다", () => {
  const blocks = dayWithLectures(["wake", "buffer", "lec2", "lunch", "lec1", "rest", "sleep"]);
  const before = ids(blocks);
  computeSchedule({ blocks, settings: DEFAULT_SETTINGS, weekday: MON, wakeMinutes: at("08:00") });
  assert.deepEqual(ids(blocks), before);
});
