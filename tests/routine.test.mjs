import test from "node:test";
import assert from "node:assert/strict";
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
} from "../docs/routine.js";

const MON = 0; // 월요일 (notify.py 규칙: 월=0 … 일=6). 운동(월/수/금) 활성일.
const TUE = 1; // 운동 비활성일 확인용.

function byId(result, id) {
  return result.blocks.find((b) => b.id === id);
}
function minutesOf(result, id) {
  const b = byId(result, id);
  return b ? b.end - b.start : undefined;
}

test("hhmm <-> boundary minutes round-trip", () => {
  assert.equal(hhmmToBoundaryMinutes("08:00"), 240);
  assert.equal(hhmmToBoundaryMinutes("13:00"), 540);
  assert.equal(hhmmToBoundaryMinutes("00:30"), 1230);
  assert.equal(boundaryMinutesToHHMM(240), "08:00");
  assert.equal(boundaryMinutesToHHMM(540), "13:00");
  assert.equal(boundaryMinutesToHHMM(1230), "00:30");
});

test("기상 08:00(기준) → 기본 루틴과 완전히 일치, 합계 990분", () => {
  const wakeMinutes = hhmmToBoundaryMinutes("08:00");
  const r = computeSchedule({ blocks: BASE_BLOCKS, settings: DEFAULT_SETTINGS, weekday: MON, wakeMinutes });

  assert.equal(r.warnings.length, 0);
  assert.equal(r.adjustments.length, 0);

  const expected = [
    ["breakfast", "08:00", "09:00"],
    ["session1", "09:00", "11:00"],
    ["buffer", "11:00", "13:00"],
    ["lunch", "13:00", "14:00"],
    ["session2", "14:00", "16:00"],
    ["work", "16:00", "18:00"],
    ["dinner", "18:00", "19:00"],
    ["session3", "19:00", "21:00"],
    ["exercise", "21:00", "22:00"],
    ["rest", "22:00", "00:30"],
  ];
  for (const [id, start, end] of expected) {
    const b = byId(r, id);
    assert.equal(boundaryMinutesToHHMM(b.start), start, `${id} start`);
    assert.equal(boundaryMinutesToHHMM(b.end), end, `${id} end`);
  }

  const sleep = byId(r, "sleep");
  assert.equal(boundaryMinutesToHHMM(sleep.start), "00:30");

  const total = r.blocks.filter((b) => b.anchor !== "wake" && b.anchor !== "sleep").reduce((s, b) => s + (b.end - b.start), 0);
  assert.equal(total, 990);
});

test("기상 10:00(2시간 지연) → 아침 삭제 + 여유만 축소, 집필 3블록 생존, 취침 00:30 유지", () => {
  const wakeMinutes = hhmmToBoundaryMinutes("10:00");
  const r = computeSchedule({ blocks: BASE_BLOCKS, settings: DEFAULT_SETTINGS, weekday: MON, wakeMinutes });

  assert.equal(r.warnings.length, 0);
  assert.equal(minutesOf(r, "breakfast"), 0);
  assert.equal(minutesOf(r, "session1"), 120, "1차 집필은 그대로 살아남는다");
  assert.equal(minutesOf(r, "buffer"), 60, "여유가 120→60으로 흡수");
  assert.equal(minutesOf(r, "session2"), 120);
  assert.equal(minutesOf(r, "session3"), 120);
  assert.equal(boundaryMinutesToHHMM(byId(r, "lunch").start), "13:00");
  assert.equal(boundaryMinutesToHHMM(byId(r, "sleep").start), "00:30");

  const breakfastAdj = r.adjustments.find((a) => a.id === "breakfast");
  assert.equal(breakfastAdj.type, "removed");
  assert.equal(breakfastAdj.reason, "wake-delayed");
});

test("기상 12:00 → 여유 전부 회수 후 1차 집필까지 최소치로 축소, 오후는 무변화", () => {
  const wakeMinutes = hhmmToBoundaryMinutes("12:00");
  const r = computeSchedule({ blocks: BASE_BLOCKS, settings: DEFAULT_SETTINGS, weekday: MON, wakeMinutes });

  assert.equal(minutesOf(r, "breakfast"), 0);
  assert.equal(minutesOf(r, "buffer"), 0, "여유는 완전히 삭제된다");
  assert.equal(minutesOf(r, "session1"), 60, "1차 집필은 최소치(60분)까지만 줄어들고 사라지지 않는다");
  assert.equal(boundaryMinutesToHHMM(byId(r, "lunch").start), "13:00", "점심은 그대로 13시 고정");

  // 오후 세그먼트는 오전 사정과 완전히 독립적으로 손대지 않는다.
  for (const id of ["session2", "work", "dinner", "session3", "rest"]) {
    assert.equal(minutesOf(r, id), BASE_BLOCKS.find((b) => b.id === id).minutes, `${id}는 오후라 변하지 않아야 한다`);
  }
  assert.equal(boundaryMinutesToHHMM(byId(r, "sleep").start), "00:30");
});

test("기상 13:30(점심 고정 시각을 이미 지남) → 오전 세그먼트 전부 공백 + 경고", () => {
  const wakeMinutes = hhmmToBoundaryMinutes("13:30");
  const r = computeSchedule({ blocks: BASE_BLOCKS, settings: DEFAULT_SETTINGS, weekday: MON, wakeMinutes });

  assert.ok(r.warnings.some((w) => w.type === "segment-empty"), "세그먼트 공백 경고가 있어야 한다");
  for (const id of ["breakfast", "session1", "buffer"]) {
    assert.equal(minutesOf(r, id), 0, `${id}는 완전히 공백이어야 한다`);
  }
  // 타임라인이 거꾸로 흐르지 않는다: 점심은 기상 이전 시각으로 밀려나지 않는다.
  assert.ok(byId(r, "lunch").start >= wakeMinutes);
  // 오후 세그먼트(점심 이후)는 예산이 남아있으므로 여전히 정상 배치된다.
  assert.equal(boundaryMinutesToHHMM(byId(r, "sleep").start), "00:30");
});

test("기상 07:00(1시간 이름) → 여유가 남는 시간을 흡수해 점심까지 빈틈없이 채운다", () => {
  const wakeMinutes = hhmmToBoundaryMinutes("07:00");
  const r = computeSchedule({ blocks: BASE_BLOCKS, settings: DEFAULT_SETTINGS, weekday: MON, wakeMinutes });

  assert.equal(r.adjustments.length, 0, "이른 기상은 삭제/축소를 유발하지 않는다(단순 확장은 기록 대상이 아님)");
  assert.equal(minutesOf(r, "breakfast"), 60, "식사 시간 자체는 늘어나지 않는다");
  assert.equal(minutesOf(r, "buffer"), 180, "1시간 여유분을 여유가 흡수해 120→180분");
  assert.equal(boundaryMinutesToHHMM(byId(r, "breakfast").start), "07:00");
  assert.equal(boundaryMinutesToHHMM(byId(r, "buffer").end), "13:00", "빈 시간 없이 점심 시작과 정확히 맞물린다");
  assert.equal(boundaryMinutesToHHMM(byId(r, "lunch").start), "13:00");
});

test("sleepMinutes로 취침을 미루면 휴식이 그만큼 늘어나 취침 시각과 맞물린다", () => {
  const wakeMinutes = hhmmToBoundaryMinutes("08:00");
  const sleepMinutes = hhmmToBoundaryMinutes("02:00"); // 기준(00:30)보다 1시간 30분 늦음
  const r = computeSchedule({ blocks: BASE_BLOCKS, settings: DEFAULT_SETTINGS, weekday: MON, wakeMinutes, sleepMinutes });

  assert.equal(boundaryMinutesToHHMM(byId(r, "sleep").start), "02:00", "취침 앵커 자체가 실제 예약 시각으로 옮겨간다");
  assert.equal(minutesOf(r, "rest"), 240, "휴식이 90분을 더 흡수해 150→240분");
  assert.equal(boundaryMinutesToHHMM(byId(r, "rest").end), "02:00", "빈 시간 없이 취침과 맞물린다");
  // 아침~점심 이전 세그먼트는 취침 시각과 무관하게 그대로다.
  assert.equal(minutesOf(r, "breakfast"), 60);
  assert.equal(r.adjustments.length, 0);
});

test("sleepMinutes를 넘기지 않으면 기본 취침(baseSleep) 그대로 계산된다", () => {
  const wakeMinutes = hhmmToBoundaryMinutes("08:00");
  const r = computeSchedule({ blocks: BASE_BLOCKS, settings: DEFAULT_SETTINGS, weekday: MON, wakeMinutes });
  assert.equal(boundaryMinutesToHHMM(byId(r, "sleep").start), "00:30");
  assert.equal(minutesOf(r, "rest"), 150);
});

test("반복 요일로 빠진 블록의 시간은 다음 여유 블록이 흡수해 취침 전 빈 시간이 남지 않는다", () => {
  // 화/목처럼 운동(월/수/금 전용)이 없는 날, 그 60분이 허공에 뜨지 않고
  // 같은 세그먼트의 여유 블록(휴식)이 흡수해야 한다 — 실사용 중 "휴식이 23:30에
  // 끝나는데 취침 00:30까지 빈 시간은 뭐냐"는 혼란으로 이어졌던 버그(회귀 방지).
  const wakeMinutes = hhmmToBoundaryMinutes("08:00");
  const r = computeSchedule({ blocks: BASE_BLOCKS, settings: DEFAULT_SETTINGS, weekday: TUE, wakeMinutes });

  assert.equal(byId(r, "exercise"), undefined, "화요일엔 운동이 없다");
  assert.equal(minutesOf(r, "rest"), 210, "운동이 빠진 60분을 휴식이 흡수해 150→210분");
  assert.equal(boundaryMinutesToHHMM(byId(r, "rest").end), "00:30", "빈 시간 없이 취침과 정확히 맞물린다");
  assert.equal(boundaryMinutesToHHMM(byId(r, "sleep").start), "00:30");
  assert.equal(r.adjustments.length, 0, "정상 기상일엔 확장이 조정 제안으로 뜨지 않는다");
});

test("우선순위를 뒤집으면(집필이 최우선으로 희생) 다른 블록이 대신 줄어든다", () => {
  const wakeMinutes = hhmmToBoundaryMinutes("10:00");
  const reversedSettings = { ...DEFAULT_SETTINGS, reducePriority: ["집필", "작업", "운동", "여유"] };
  const r = computeSchedule({ blocks: BASE_BLOCKS, settings: reversedSettings, weekday: MON, wakeMinutes });

  assert.equal(minutesOf(r, "session1"), 60, "이번엔 집필이 먼저 최소치까지 줄어든다");
  assert.equal(minutesOf(r, "buffer"), 120, "여유는 우선순위가 밀려 그대로 보존된다");
});

test("점심 앵커를 12:30으로 옮기면 세그먼트 경계가 함께 이동한다", () => {
  const movedLunchBlocks = BASE_BLOCKS.map((b) => (b.id === "lunch" ? { ...b, fixedAt: hhmmToBoundaryMinutes("12:30") } : b));
  const wakeMinutes = hhmmToBoundaryMinutes("08:00");
  const r = computeSchedule({ blocks: movedLunchBlocks, settings: DEFAULT_SETTINGS, weekday: MON, wakeMinutes });

  assert.equal(boundaryMinutesToHHMM(byId(r, "lunch").start), "12:30");
  // 오전 예산이 270분으로 줄어 여유가 120→90으로 30분만 흡수하면 된다.
  assert.equal(minutesOf(r, "buffer"), 90);
  assert.equal(minutesOf(r, "breakfast"), 60, "예산이 충분해 아침까지 건드릴 필요는 없다");
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
  // 22:00 취침 + 7.5시간 목표 = 다음날 05:30. 접지 않으면 1440을 넘는 원값(1530)이
  // 그대로 반환되어, 점심(540)·취침(1230) 같은 [0,1440) 범위의 고정 앵커와 좌표계가
  // 어긋나 하루 전체가 지워지는 버그가 났었다(회귀 방지).
  const baseWakeMinutes = hhmmToBoundaryMinutes("08:00");
  const bedAtMinutes = hhmmToBoundaryMinutes("22:00");
  const wakeMinutes = computeWakeMinutes({ bedAtMinutes, wakeOverrideMinutes: null, sleepTargetMinutes: 450, baseWakeMinutes });
  assert.ok(wakeMinutes < 1440, "항상 [0, 1440) 범위여야 한다");
  assert.equal(boundaryMinutesToHHMM(wakeMinutes), "05:30");

  const r = computeSchedule({ blocks: BASE_BLOCKS, settings: DEFAULT_SETTINGS, weekday: MON, wakeMinutes });
  assert.equal(r.warnings.length, 0, "정상적인 이른 기상이라 세그먼트 붕괴가 없어야 한다");
  assert.equal(minutesOf(r, "breakfast"), 60, "이른 기상이라 아침이 삭제되지 않는다");
  assert.equal(boundaryMinutesToHHMM(byId(r, "sleep").start), "00:30", "취침은 그대로 유지");
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
