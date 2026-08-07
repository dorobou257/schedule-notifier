// 이번 주 화면의 계산 부분. 화면 자체는 브라우저에서 확인하고, 여기서는
// "어느 날에 무엇이 걸리는가"만 고정한다 — 요일이 하루 밀리는 종류의 버그는
// 눈으로는 잘 안 보이고, 복학하면 매주 그 어긋남을 겪게 된다.
import test from "node:test";
import assert from "node:assert/strict";

import { weekdayOfKey, weekStartKey, shortDateLabel, buildWeekDays, WEEK_DAYS } from "../docs/week.js";
import { parseLectures } from "../docs/lectures.js";
import { BASE_BLOCKS, SEMESTER_BLOCKS, DEFAULT_SETTINGS, boundaryMinutesToHHMM } from "../docs/routine.js";
import { SEMESTER, TIMETABLE } from "../docs/semester-2026-2.js";

// --- 날짜 계산 --------------------------------------------------------------

test("월=0 규칙이 lectures/DAY_NAMES와 같다", () => {
  assert.equal(weekdayOfKey("2026-08-03"), 0, "2026-08-03은 월요일");
  assert.equal(weekdayOfKey("2026-08-06"), 3, "목요일");
  assert.equal(weekdayOfKey("2026-08-09"), 6, "일요일");
});

test("주는 언제나 월요일에 시작한다", () => {
  for (const d of ["2026-08-03", "2026-08-06", "2026-08-09"]) {
    assert.equal(weekStartKey(d), "2026-08-03", `${d}이 속한 주`);
  }
  assert.equal(weekStartKey("2026-08-10"), "2026-08-10", "다음 월요일은 그 자신");
});

test("월을 넘어가는 주도 이어진다", () => {
  assert.equal(weekStartKey("2026-03-01"), "2026-02-23", "일요일은 지난 월요일에 붙는다");
});

test("shortDateLabel은 0을 떼고 읽는다", () => {
  assert.equal(shortDateLabel("2026-08-06"), "8월 6일");
  assert.equal(shortDateLabel("2026-12-25"), "12월 25일");
});

// --- 7일 만들기 -------------------------------------------------------------

const 시간표 = parseLectures(
  ["월 13:00-16:00 웹소설산업과비즈니스(A) @현3/304", "화 16:00-19:00 장르연구Ⅲ(판무B)"].join("\n")
).lectures;

const 학기 = { start: "2026-03-02", end: "2026-06-21" };

const build = (over = {}) =>
  buildWeekDays({
    startKey: "2026-03-09", // 학기 중의 월요일
    data: null,
    blocks: BASE_BLOCKS,
    semesterBlocks: SEMESTER_BLOCKS,
    settings: DEFAULT_SETTINGS,
    lectures: 시간표,
    semester: 학기,
    todayKey: "2026-03-11",
    todayBlocks: null,
    ...over,
  });

test("월요일부터 7일치가 순서대로 나온다", () => {
  const days = build();
  assert.equal(days.length, WEEK_DAYS);
  assert.deepEqual(
    days.map((d) => d.dateKey),
    ["2026-03-09", "2026-03-10", "2026-03-11", "2026-03-12", "2026-03-13", "2026-03-14", "2026-03-15"]
  );
  assert.deepEqual(days.map((d) => d.weekday), [0, 1, 2, 3, 4, 5, 6]);
});

test("오늘·지난날 표시가 todayKey를 기준으로 갈린다", () => {
  const days = build();
  assert.deepEqual(days.map((d) => d.isToday), [false, false, true, false, false, false, false]);
  assert.deepEqual(days.map((d) => d.isPast), [true, true, false, false, false, false, false]);
});

test("강의는 그 요일에만 걸린다", () => {
  const days = build();
  assert.deepEqual(days.map((d) => d.lectures.map((b) => b.name)), [
    ["웹소설산업과비즈니스(A)"],
    ["장르연구Ⅲ(판무B)"],
    [], [], [], [], [],
  ]);
  const 월 = days[0];
  assert.equal(boundaryMinutesToHHMM(월.lectures[0].start), "13:00");
  assert.equal(월.lectures[0].place, "현3/304");
});

test("방학 주에는 어느 날에도 강의가 없다", () => {
  const days = build({ startKey: "2026-08-03", todayKey: "2026-08-06" });
  assert.deepEqual(days.flatMap((d) => d.lectures), []);
});

test("공휴일인 날은 강의가 빠진다 — 그날만", () => {
  const data = {
    days: {
      "2026-03-09": { holiday_names: ["임시공휴일"] },
      "2026-03-10": { holiday_names: [] },
    },
  };
  const days = build({ data });
  assert.deepEqual(days[0].holidayNames, ["임시공휴일"]);
  assert.equal(days[0].lectures.length, 0, "공휴일엔 강의 없음");
  assert.equal(days[1].lectures.length, 1, "다음 날은 그대로");
});

test("노션 항목이 날짜별로 갈라진다", () => {
  const data = {
    days: {
      "2026-03-10": {
        special_items: [{ text: "가족 모임", time: "18:00" }],
        todo_items: [{ text: "장보기", done: false }],
        novel_items: [{ text: "3장 초고", done: true }],
      },
    },
  };
  const days = build({ data });
  assert.deepEqual(days[1].specialItems.map((i) => i.text), ["가족 모임"]);
  assert.deepEqual(days[1].todoItems.map((i) => i.text), ["장보기"]);
  assert.deepEqual(days[1].novelItems.map((i) => i.text), ["3장 초고"]);
  assert.deepEqual(days[0].specialItems, [], "다른 날엔 새지 않는다");
});

test("워커 응답이 없어도 루틴과 강의는 그대로 계산된다", () => {
  // 노션이 죽었다고 이번 주 시간표까지 못 보면 이 화면은 쓸모가 없다.
  const days = build({ data: null });
  assert.equal(days[0].lectures.length, 1);
  assert.ok(days[0].blocks.length > 1);
  assert.deepEqual(days[0].todoItems, []);
});

test("오늘은 이미 계산해둔 결과를 그대로 쓴다", () => {
  // 오늘 화면은 취침 기록·하루짜리 손질까지 반영해 계산돼 있다. 주간 화면이
  // 그걸 무시하고 다시 계산하면 같은 날이 두 화면에서 다르게 보인다.
  const todayBlocks = [{ id: "fake", name: "이미 계산된 오늘", category: "기타", minutes: 60, start: 0, end: 60 }];
  const days = build({ todayBlocks });
  assert.deepEqual(days[2].blocks, todayBlocks);
  assert.notDeepEqual(days[1].blocks, todayBlocks, "다른 날은 직접 계산한다");
});

test("취침 기록은 오늘 것이므로 다른 날은 기본 기상 시각으로 선다", () => {
  const days = build();
  const wakeOf = (d) => boundaryMinutesToHHMM(d.blocks.find((b) => b.anchor === "wake").start);
  days.forEach((d) => assert.equal(wakeOf(d), DEFAULT_SETTINGS.baseWake));
});

test("하루가 눌리지 않는다 — 강의를 낀 날도 취침까지 이어진다", () => {
  const days = build();
  days.forEach((d) => {
    const sleep = d.blocks.find((b) => b.anchor === "sleep");
    assert.equal(boundaryMinutesToHHMM(sleep.start), "00:00", `${d.dateKey}의 취침`);
  });
});

// --- 개강 경계 주 -----------------------------------------------------------

test("개강 주는 같은 주 안에서 방학 루틴과 학기 루틴이 갈린다", () => {
  // 2026-08-31(월) 개강. 그 전 주는 통째로 방학이고, 개강 주는 통째로 학기다.
  const 개강주 = buildWeekDays({
    startKey: "2026-08-31",
    data: null,
    blocks: BASE_BLOCKS,
    semesterBlocks: SEMESTER_BLOCKS,
    settings: DEFAULT_SETTINGS,
    lectures: parseLectures(TIMETABLE).lectures,
    semester: SEMESTER,
    todayKey: "2026-08-31",
    todayBlocks: null,
  });
  const 이름들 = (d) => d.blocks.filter((b) => b.category === "집필" && b.minutes > 0).map((b) => b.name);

  assert.deepEqual(이름들(개강주[0]), ["집필", "집필"], "개강일 월요일은 학기 루틴(집필 두 번)");
  assert.deepEqual(개강주[1].lectures.map((b) => b.name), ["문장실습Ⅱ", "크리틱Ⅳ"], "화요일 강의가 붙는다");

  const 방학주 = buildWeekDays({
    startKey: "2026-08-24",
    data: null,
    blocks: BASE_BLOCKS,
    semesterBlocks: SEMESTER_BLOCKS,
    settings: DEFAULT_SETTINGS,
    lectures: parseLectures(TIMETABLE).lectures,
    semester: SEMESTER,
    todayKey: "2026-08-24",
    todayBlocks: null,
  });
  assert.deepEqual(방학주.flatMap((d) => d.lectures), [], "개강 전 주엔 강의가 없다");
  assert.deepEqual(이름들(방학주[1]), ["1차 집필", "2차 집필", "3차 집필"], "화요일도 방학 루틴 그대로");
});
