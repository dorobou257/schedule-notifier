// 강의 시간표. 사람이 손으로 적는 형식을 다루므로, 오타·이상한 줄이 들어와도
// 나머지가 살아남는지가 핵심이다 — 한 줄 잘못 적어서 학기 전체가 날아가면 안 된다.
import test from "node:test";
import assert from "node:assert/strict";

import {
  blocksDisplacedBy,
  computeDayWithLectures,
  applySemesterMealTimes,
  parseLectureLine,
  parseLectures,
  formatLectureLine,
  isWithinSemester,
  lectureBlocks,
  mergeLectureBlocks,
  minutesToHHMM,
  DAY_NAMES,
} from "../docs/lectures.js";
import { computeSchedule, DEFAULT_SETTINGS, BASE_BLOCKS, hhmmToBoundaryMinutes, boundaryMinutesToHHMM } from "../docs/routine.js";

// --- 한 줄 읽기 -------------------------------------------------------------

test("한 줄을 요일·시각·이름·장소로 나눈다", () => {
  assert.deepEqual(parseLectureLine("월 13:00-16:00 웹소설산업과비즈니스(A) @현3/304"), {
    days: [0],
    start: "13:00",
    minutes: 180,
    name: "웹소설산업과비즈니스(A)",
    place: "현3/304",
  });
});

test("요일을 붙여 쓰면 여러 요일로 반복된다", () => {
  const lec = parseLectureLine("월수금 09:00-10:30 교양");
  assert.deepEqual(lec.days, [0, 2, 4]);
  assert.equal(lec.minutes, 90);
  assert.equal(lec.place, "");
});

test("요일 순서가 뒤죽박죽이거나 겹쳐도 정리한다", () => {
  assert.deepEqual(parseLectureLine("수월수 10:00-11:00 x").days, [0, 2]);
});

test("~로 이어도 되고 공백이 들쭉날쭉해도 읽는다", () => {
  assert.equal(parseLectureLine("화 16:00~19:00 장르연구Ⅲ(판무B)").minutes, 180);
  assert.equal(parseLectureLine("  목   9:00 - 10:00   설계  ").name, "설계");
});

test("강의명에 @가 여러 개면 마지막 @부터가 아니라 첫 @까지가 이름", () => {
  const lec = parseLectureLine("금 10:00-11:00 이메일@수업 @본관101");
  assert.equal(lec.name, "이메일");
  assert.equal(lec.place, "수업 @본관101");
});

test("못 읽는 줄은 null", () => {
  for (const bad of [
    "",
    "   ",
    "# 주석",
    "월 13:00 이름만",           // 끝 시각 없음
    "월 13:00-13:00 길이0",      // 끝이 시작과 같다
    "월 16:00-13:00 거꾸로",
    "달 13:00-16:00 이상한요일",
    "월 25:00-26:00 없는시각",
    "월 13:60-14:00 없는분",
    "월 13:00-16:00",            // 이름 없음
  ]) {
    assert.equal(parseLectureLine(bad), null, `"${bad}"는 읽으면 안 된다`);
  }
});

// --- 여러 줄 ----------------------------------------------------------------

test("여러 줄을 읽고 실패한 줄은 따로 알려준다", () => {
  const { lectures, failed } = parseLectures(
    ["월 13:00-16:00 가", "이건 시간표가 아님", "", "# 주석", "화 16:00-19:00 나"].join("\n")
  );
  assert.deepEqual(lectures.map((l) => l.name), ["가", "나"]);
  assert.deepEqual(failed, ["이건 시간표가 아님"], "빈 줄과 주석은 실패가 아니다");
});

test("같은 요일·시각이 겹쳐도 id가 부딪히지 않는다", () => {
  const { lectures } = parseLectures(["월 13:00-16:00 가", "월 13:00-14:00 나"].join("\n"));
  assert.equal(new Set(lectures.map((l) => l.id)).size, 2);
});

test("읽은 걸 다시 한 줄로 되돌리면 같은 뜻이 된다", () => {
  for (const line of ["월수 13:00-16:00 강의명 @현3/304", "화 16:00-19:00 장르연구Ⅲ(판무B)"]) {
    assert.equal(formatLectureLine(parseLectureLine(line)), line);
  }
});

test("minutesToHHMM은 두 자리로 맞춘다", () => {
  assert.equal(minutesToHHMM(540), "09:00");
  assert.equal(minutesToHHMM(0), "00:00");
  assert.equal(minutesToHHMM(1439), "23:59");
});

// --- 학기 기간 --------------------------------------------------------------

test("학기 기간 안팎을 가른다", () => {
  const sem = { start: "2026-03-02", end: "2026-06-21" };
  assert.equal(isWithinSemester("2026-03-02", sem), true, "시작일 포함");
  assert.equal(isWithinSemester("2026-06-21", sem), true, "종료일 포함");
  assert.equal(isWithinSemester("2026-03-01", sem), false);
  assert.equal(isWithinSemester("2026-08-06", sem), false, "방학");
});

test("학기를 안 적었으면 항상 강의가 있다", () => {
  assert.equal(isWithinSemester("2026-08-06", { start: null, end: null }), true);
  assert.equal(isWithinSemester("2026-08-06", null), true);
  assert.equal(isWithinSemester("2026-08-06", { start: "2026-03-02", end: null }), true, "끝만 비면 이후 계속");
});

// --- 블록으로 옮기기 --------------------------------------------------------

const 시간표 = parseLectures(
  [
    "월 13:00-16:00 웹소설산업과비즈니스(A) @현3/304",
    "화 13:00-16:00 문장실습Ⅰ(B) @현3/201",
    "화 16:00-19:00 장르연구Ⅲ(판무B) @현1/303",
  ].join("\n")
).lectures;

const 학기 = { start: "2026-03-02", end: "2026-06-21" };
const ctx = (over = {}) => ({ dateKey: "2026-03-09", semester: 학기, isHoliday: false, dayBoundaryHour: 4, ...over });

test("강의는 시각 고정 + 보호 블록이 된다", () => {
  const [b] = lectureBlocks(시간표, ctx());
  assert.equal(b.category, "강의");
  assert.equal(b.anchor, "clock");
  assert.equal(b.protected, true);
  assert.equal(b.minutes, 180);
  assert.equal(b.minMinutes, 180, "강의는 줄일 수 없다");
  assert.equal(boundaryMinutesToHHMM(b.fixedAt), "13:00");
  assert.deepEqual(b.days, [0]);
  assert.equal(b.place, "현3/304");
});

test("공휴일과 방학에는 강의가 통째로 빠진다", () => {
  assert.equal(lectureBlocks(시간표, ctx({ isHoliday: true })).length, 0);
  assert.equal(lectureBlocks(시간표, ctx({ dateKey: "2026-08-06" })).length, 0, "방학");
  assert.equal(lectureBlocks(시간표, ctx()).length, 3, "학기 중 평일엔 그대로");
});

test("경계 시각을 바꾸면 고정 시각 좌표도 따라 움직인다", () => {
  const [b] = lectureBlocks(시간표, ctx({ dayBoundaryHour: 6 }));
  assert.equal(boundaryMinutesToHHMM(b.fixedAt, 6), "13:00");
});

// --- 루틴과 합쳐 하루 만들기 ------------------------------------------------

const TUE = 1;

/** 앱과 같은 방식으로 강의를 끼워 넣어 하루를 계산한다. */
function dayWith(lectures, blocks = BASE_BLOCKS, weekday = TUE) {
  return computeSchedule({
    blocks: mergeLectureBlocks(blocks, lectures),
    settings: DEFAULT_SETTINGS,
    weekday,
    wakeMinutes: hhmmToBoundaryMinutes("08:00"),
  });
}

test("강의를 낀 화요일이 시각대로 배치되고 하루가 비지 않는다", () => {
  // 기본 루틴의 점심은 13:00 고정인데 화요일 첫 강의도 13:00이다. 실제로도
  // 강의가 있으면 점심을 옮겨야 하므로, 설정에서 옮긴 상태로 계산한다.
  const blocks = BASE_BLOCKS.map((b) =>
    b.id === "lunch" ? { ...b, fixedAt: hhmmToBoundaryMinutes("12:00") } : b
  );
  const lectures = lectureBlocks(시간표, ctx({ dateKey: "2026-03-10" }));
  const r = dayWith(lectures, blocks);

  const at = (id) => boundaryMinutesToHHMM(r.blocks.find((b) => b.id === id).start);
  const 화요일강의 = lectures.filter((l) => l.days.includes(TUE));
  assert.equal(화요일강의.length, 2);
  assert.equal(at(화요일강의[0].id), "13:00");
  assert.equal(at(화요일강의[1].id), "16:00");
  assert.equal(at("lunch"), "12:00");
  assert.equal(at("sleep"), "00:30", "취침은 그대로 지켜진다");
  assert.equal(r.warnings.length, 0, "강의를 넣었다고 하루가 무너지면 안 된다");
});

test("점심과 강의가 같은 시각이면 강의가 밀린다 — 화면이 알아챌 수 있어야 한다", () => {
  // 기본 루틴 그대로(점심 13:00)면 13:00 강의가 14:00으로 밀린다. 조용히 밀리면
  // 수업에 늦으므로, 화면은 "고정 시각과 실제 시각이 다르다"로 이 상황을 잡는다.
  const lectures = lectureBlocks(시간표, ctx({ dateKey: "2026-03-10" }));
  const r = dayWith(lectures);

  const pushed = r.blocks
    .filter((b) => b.anchor === "clock" && b.fixedAt != null && b.start !== b.fixedAt)
    .map((b) => `${b.name} ${boundaryMinutesToHHMM(b.fixedAt)}→${boundaryMinutesToHHMM(b.start)}`);

  // 한 번 밀리면 뒤 강의까지 연쇄로 밀린다. 그래서 더더욱 조용히 넘기면 안 된다.
  assert.deepEqual(pushed, ["문장실습Ⅰ(B) 13:00→14:00", "장르연구Ⅲ(판무B) 16:00→17:00"]);
  assert.equal(boundaryMinutesToHHMM(r.blocks.find((b) => b.id === "lunch").start), "13:00", "점심은 제자리를 지킨다");
});

test("월요일엔 화요일 강의가 나오지 않는다", () => {
  const r = dayWith(lectureBlocks(시간표, ctx()), BASE_BLOCKS, 0);
  const 있는강의 = r.blocks.filter((b) => b.category === "강의").map((b) => b.name);
  assert.deepEqual(있는강의, ["웹소설산업과비즈니스(A)"]);
});

// --- 강의가 집필·작업을 대신한다 ------------------------------------------

/** 학기 중 점심을 12:00으로 옮긴 루틴(복학 후의 실제 설정). */
const 학기루틴 = applySemesterMealTimes(BASE_BLOCKS, { lunch: "12:00" });

const day = (lectures, weekday, blocks = 학기루틴) =>
  computeDayWithLectures({
    blocks,
    lectures,
    settings: DEFAULT_SETTINGS,
    weekday,
    wakeMinutes: hhmmToBoundaryMinutes("08:00"),
  });

test("강의 시간과 겹치는 집필·작업만 밀려난다", () => {
  const base = computeSchedule({
    blocks: 학기루틴,
    settings: DEFAULT_SETTINGS,
    weekday: TUE,
    wakeMinutes: hhmmToBoundaryMinutes("08:00"),
  });
  // 13:00-19:00 강의. 이 시간대엔 2차 집필·작업·3차 집필이 걸쳐 있다.
  const lectures = lectureBlocks(시간표, ctx({ dateKey: "2026-03-10" })).filter((l) => l.days.includes(TUE));
  const displaced = blocksDisplacedBy(base.blocks, lectures);
  assert.deepEqual([...displaced].sort(), ["session2", "session3", "work"]);
});

test("식사와 하루의 끝은 강의가 밀어내지 못한다", () => {
  const base = computeSchedule({
    blocks: 학기루틴,
    settings: DEFAULT_SETTINGS,
    weekday: TUE,
    wakeMinutes: hhmmToBoundaryMinutes("08:00"),
  });
  const lectures = lectureBlocks(시간표, ctx({ dateKey: "2026-03-10" })).filter((l) => l.days.includes(TUE));
  const displaced = blocksDisplacedBy(base.blocks, lectures);
  // 저녁 식사는 강의 시간과 겹치지만 끼니는 거를 수 없다 — 뒤로 흘러간다.
  for (const id of ["breakfast", "lunch", "dinner", "sleep", "wake", "rest", "buffer"]) {
    assert.equal(displaced.has(id), false, `${id}는 밀려나면 안 된다`);
  }
});

test("강의가 집필을 대신하면 하루가 밤까지 늘어나지 않는다", () => {
  const lectures = lectureBlocks(시간표, ctx({ dateKey: "2026-03-10" })).filter((l) => l.days.includes(TUE));
  const r = day(lectures, TUE);
  const at = (id) => boundaryMinutesToHHMM(r.blocks.find((b) => b.id === id).start);

  assert.equal(at(lectures[0].id), "13:00");
  assert.equal(at(lectures[1].id), "16:00");
  // 강의가 대신한 집필·작업은 하루에서 아예 빠진다 — 밤 열한 시로 밀리지 않는다.
  for (const id of ["session2", "work", "session3"]) {
    assert.equal(r.blocks.find((b) => b.id === id), undefined, `${id}는 강의가 대신한다`);
  }
  assert.equal(at("dinner"), "19:00", "저녁은 강의가 끝나고 바로");
  assert.equal(at("sleep"), "00:30");
  assert.equal(r.warnings.length, 0);
});

test("강의가 없는 날은 루틴이 그대로다", () => {
  const lectures = lectureBlocks(시간표, ctx()).filter((l) => l.days.includes(4)); // 금요일
  const r = day(lectures, 4);
  assert.deepEqual(r.displaced, new Set());
  assert.deepEqual(
    r.blocks.map((b) => b.id),
    computeSchedule({
      blocks: 학기루틴,
      settings: DEFAULT_SETTINGS,
      weekday: 4,
      wakeMinutes: hhmmToBoundaryMinutes("08:00"),
    }).blocks.map((b) => b.id)
  );
});

test("오전 집필은 오후 강의에 밀리지 않는다", () => {
  const lectures = lectureBlocks(시간표, ctx()).filter((l) => l.days.includes(0)); // 월 13:00-16:00
  const r = day(lectures, 0);
  const s1 = r.blocks.find((b) => b.id === "session1");
  assert.equal(boundaryMinutesToHHMM(s1.start), "09:00", "1차 집필은 강의와 겹치지 않는다");
  assert.equal(r.displaced.has("session1"), false);
  assert.equal(r.displaced.has("session2"), true, "13:00에 있던 2차 집필은 강의가 대신한다");
});

// --- 학기 중 식사 시각 ------------------------------------------------------

test("학기 중 식사 시각이 평소 시각을 덮는다", () => {
  const out = applySemesterMealTimes(BASE_BLOCKS, { lunch: "12:00" });
  const lunch = out.find((b) => b.id === "lunch");
  assert.equal(boundaryMinutesToHHMM(lunch.fixedAt), "12:00");
  assert.equal(lunch.anchor, "clock");
  assert.equal(BASE_BLOCKS.find((b) => b.id === "lunch").fixedAt, hhmmToBoundaryMinutes("13:00"), "원본은 그대로");
});

test("비운 끼니는 건드리지 않는다", () => {
  const out = applySemesterMealTimes(BASE_BLOCKS, { breakfast: "", lunch: "12:00", dinner: "" });
  assert.equal(out.find((b) => b.id === "breakfast").anchor, undefined);
  assert.equal(out.find((b) => b.id === "dinner").fixedAt, undefined);
});

test("셋 다 비었으면 원래 배열을 그대로 돌려준다", () => {
  assert.equal(applySemesterMealTimes(BASE_BLOCKS, { lunch: "" }), BASE_BLOCKS);
  assert.equal(applySemesterMealTimes(BASE_BLOCKS, null), BASE_BLOCKS);
});

test("고정이 아니던 식사도 학기 중에는 고정된다", () => {
  // 저녁은 기본적으로 유동 블록이다. 학기 중 시각을 적으면 그날은 시각이 선다.
  const out = applySemesterMealTimes(BASE_BLOCKS, { dinner: "18:30" });
  const dinner = out.find((b) => b.id === "dinner");
  assert.equal(dinner.anchor, "clock");
  assert.equal(boundaryMinutesToHHMM(dinner.fixedAt), "18:30");
});

test("점심을 12:00으로 옮기면 13:00 강의와 더는 부딪히지 않는다", () => {
  const lectures = lectureBlocks(시간표, ctx({ dateKey: "2026-03-10" })).filter((l) => l.days.includes(TUE));
  const 밀린것 = (blocks) =>
    blocks.filter((b) => b.anchor === "clock" && b.fixedAt != null && b.start !== b.fixedAt).map((b) => b.name);

  assert.notDeepEqual(밀린것(day(lectures, TUE, BASE_BLOCKS).blocks), [], "점심이 13:00이면 강의가 밀린다");
  assert.deepEqual(밀린것(day(lectures, TUE).blocks), [], "12:00으로 옮기면 제 시각에 앉는다");
});

test("DAY_NAMES는 월=0 규칙(logicalWeekday와 같다)", () => {
  assert.equal(DAY_NAMES[0], "월");
  assert.equal(DAY_NAMES[6], "일");
});
