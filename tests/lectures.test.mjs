// 강의 시간표. 사람이 손으로 적는 형식을 다루므로, 오타·이상한 줄이 들어와도
// 나머지가 살아남는지가 핵심이다 — 한 줄 잘못 적어서 학기 전체가 날아가면 안 된다.
import test from "node:test";
import assert from "node:assert/strict";

import {
  computeDayWithLectures,
  parseLectureLine,
  parseLectures,
  formatLectureLine,
  isWithinSemester,
  lectureBlocks,
  minutesToHHMM,
  DAY_NAMES,
} from "../docs/lectures.js";
import {
  computeSchedule,
  DEFAULT_SETTINGS,
  BASE_BLOCKS,
  SEMESTER_BLOCKS,
  hhmmToBoundaryMinutes,
  boundaryMinutesToHHMM,
} from "../docs/routine.js";
import { SEMESTER, TIMETABLE } from "../docs/semester-2026-2.js";

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

// --- 2026-2학기 실제 시간표로 일주일을 통째로 못 박는다 ---------------------
//
// 여기가 이 앱의 계약이다. 요일별 결과가 손으로 검산한 표와 한 칸이라도
// 달라지면 그건 회귀다.

const MON = 0, TUE = 1, WED = 2, THU = 3, FRI = 4, SAT = 5, SUN = 6;
const 학기시간표 = parseLectures(TIMETABLE).lectures;
const 학기중 = "2026-09-07"; // 개강 다음 주 월요일

/** 앱과 같은 경로(placement → computeSchedule)로 하루를 계산한다. */
function day(weekday, { blocks = SEMESTER_BLOCKS, dateKey = 학기중, wake = "08:00" } = {}) {
  return computeDayWithLectures({
    blocks,
    lectures: lectureBlocks(학기시간표, { dateKey, semester: SEMESTER, isHoliday: false }),
    settings: DEFAULT_SETTINGS,
    weekday,
    wakeMinutes: hhmmToBoundaryMinutes(wake),
  });
}

/** "08:00-09:00 준비 여유 · …" — 길이 0으로 눌린 블록은 그날 없는 것이라 뺀다. */
const 표 = (r) =>
  r.blocks
    .filter((b) => b.minutes > 0)
    .map((b) => `${boundaryMinutesToHHMM(b.start)}-${boundaryMinutesToHHMM(b.end)} ${b.name}`)
    .join(" · ");

const 학기표 = {
  [MON]: "08:00-09:00 준비 여유 · 09:00-11:00 집필 · 11:00-12:00 여유 · 12:00-13:00 점심 식사 · 13:00-15:00 집필 · 15:00-17:00 작업 · 17:00-18:00 오후 여유 · 18:00-19:00 저녁 식사 · 19:00-21:00 휴식 · 21:00-22:00 운동 · 22:00-00:00 밤 휴식",
  [TUE]: "08:00-09:00 준비 여유 · 09:00-12:00 문장실습Ⅱ · 12:00-13:00 점심 식사 · 13:00-15:00 집필 · 15:00-16:00 작업 · 16:00-17:00 크리틱Ⅳ · 17:00-18:00 여유 · 18:00-19:00 저녁 식사 · 19:00-00:00 휴식",
  [WED]: "08:00-09:00 준비 여유 · 09:00-12:00 장르연구Ⅰ(로맨스심화) · 12:00-13:00 점심 식사 · 13:00-15:00 집필 · 15:00-17:00 작업 · 17:00-18:00 여유 · 18:00-19:00 저녁 식사 · 19:00-21:00 휴식 · 21:00-22:00 운동 · 22:00-00:00 밤 휴식",
  [THU]: "08:00-09:00 준비 여유 · 09:00-12:00 장르연구Ⅴ(호러) · 12:00-13:00 점심 식사 · 13:00-16:00 웹소설창작실습Ⅳ(판무) · 16:00-19:00 캐릭터개발실습 · 19:00-20:00 저녁 식사 · 20:00-00:00 휴식",
  [FRI]: "08:00-10:00 준비 여유 · 10:00-12:00 플롯의이해와적용Ⅱ · 12:00-13:00 점심 식사 · 13:00-16:00 플롯의이해와적용Ⅱ · 16:00-18:00 집필 · 18:00-19:00 저녁 식사 · 19:00-21:00 작업 · 21:00-22:00 운동 · 22:00-00:00 밤 휴식",
  [SAT]: "08:00-09:00 준비 여유 · 09:00-11:00 집필 · 11:00-12:00 여유 · 12:00-13:00 점심 식사 · 13:00-15:00 작업 · 15:00-18:00 오후 여유 · 18:00-19:00 저녁 식사 · 19:00-00:00 휴식",
  [SUN]: "08:00-09:00 준비 여유 · 09:00-11:00 집필 · 11:00-12:00 여유 · 12:00-13:00 점심 식사 · 13:00-15:00 작업 · 15:00-18:00 오후 여유 · 18:00-19:00 저녁 식사 · 19:00-00:00 휴식",
};

for (const [wd, expected] of Object.entries(학기표)) {
  test(`학기 ${DAY_NAMES[wd]}요일 하루가 계획한 표 그대로다`, () => {
    const r = day(Number(wd));
    assert.equal(표(r), expected);
    assert.equal(r.warnings.length, 0, "매주 뜨는 경고가 있으면 안 된다");
    assert.equal(r.adjustments.length, 0, "매주 뜨는 조정 제안이 있으면 안 된다");
  });
}

test("08:00~09:00은 준비 시간 — 어느 요일에도 집필·작업이 들어오지 않는다", () => {
  for (let wd = 0; wd < 7; wd++) {
    for (const b of day(wd).blocks) {
      if (!["집필", "작업"].includes(b.category) || b.minutes <= 0) continue;
      assert.ok(b.start >= hhmmToBoundaryMinutes("09:00"), `${DAY_NAMES[wd]} ${b.name}이 준비 시간을 침범했다`);
    }
  }
});

test("22:00 이후엔 어느 요일에도 집필·작업이 없다 — 밤은 언제나 휴식", () => {
  for (let wd = 0; wd < 7; wd++) {
    for (const blocks of [SEMESTER_BLOCKS, BASE_BLOCKS]) {
      for (const b of day(wd, { blocks }).blocks) {
        if (!["집필", "작업"].includes(b.category) || b.minutes <= 0) continue;
        assert.ok(b.end <= hhmmToBoundaryMinutes("22:00"), `${DAY_NAMES[wd]} ${b.name}이 밤까지 넘어갔다`);
      }
    }
  }
});

test("학기 월요일은 집필이 두 번, 다른 평일은 한 번", () => {
  const 집필횟수 = (wd) => day(wd).blocks.filter((b) => b.category === "집필" && b.minutes > 0).length;
  assert.equal(집필횟수(MON), 2, "공강인 월요일은 집필 두 타임");
  for (const wd of [TUE, WED, FRI]) assert.equal(집필횟수(wd), 1);
  assert.equal(집필횟수(THU), 0, "목요일은 휴일");
});

test("목요일은 강의 아홉 시간 — 집필·작업 0분에 경고도 없다", () => {
  const r = day(THU);
  assert.deepEqual(
    r.blocks.filter((b) => ["집필", "작업"].includes(b.category) && b.minutes > 0),
    []
  );
  assert.equal(r.warnings.length, 0, "강의가 저녁 시각을 넘겨 끝나는 건 정상이다");
  assert.equal(boundaryMinutesToHHMM(r.blocks.find((b) => b.id === "dinner").start), "19:00");
});

test("방학 날짜에는 강의가 얹히지 않고 방학 표가 나온다", () => {
  const r = day(TUE, { blocks: BASE_BLOCKS, dateKey: "2026-08-20" });
  assert.deepEqual(r.blocks.filter((b) => b.category === "강의"), []);
  assert.equal(
    표(r),
    "08:00-09:00 준비 여유 · 09:00-11:00 1차 집필 · 11:00-12:00 여유 · 12:00-13:00 점심 식사 · " +
      "13:00-15:00 2차 집필 · 15:00-17:00 작업 · 17:00-18:00 오후 여유 · 18:00-19:00 저녁 식사 · " +
      "19:00-21:00 3차 집필 · 21:00-00:00 휴식"
  );
});

test("강의가 없는 날은 배치가 루틴을 손대지 않은 것과 같다", () => {
  // 방학 월요일. gap이 블록 합과 맞아떨어지므로 placement를 거쳐도 결과가 같아야 한다.
  const 배치 = day(MON, { blocks: BASE_BLOCKS, dateKey: "2026-08-17" });
  const 그냥 = computeSchedule({
    blocks: BASE_BLOCKS,
    settings: DEFAULT_SETTINGS,
    weekday: MON,
    wakeMinutes: hhmmToBoundaryMinutes("08:00"),
  });
  assert.deepEqual(배치.displaced, new Set());
  // 휴식 둘이 하나로 합쳐지는 것만 다르다.
  assert.equal(표(배치), 표(그냥).replace("22:00-23:00 휴식 · 23:00-00:00 밤 휴식", "22:00-00:00 휴식"));
});

test("공강인 월요일에 늦잠을 자면 여유가 먼저 줄고 집필이 남는다", () => {
  const r = day(MON, { wake: "10:00" });
  const 분 = (id) => {
    const b = r.blocks.find((x) => x.id === id);
    return b ? b.end - b.start : 0;
  };
  assert.equal(분("morning"), 60, "준비 시간 한 시간은 지켜진다");
  assert.equal(분("session1") + 분("session2"), 240, "집필 네 시간은 자리를 옮겨서라도 지킨다");
  assert.equal(boundaryMinutesToHHMM(r.blocks.find((b) => b.id === "lunch").start), "12:00");
  assert.equal(boundaryMinutesToHHMM(r.blocks.find((b) => b.id === "sleep").start), "00:00");

  // 두 시간 늦게 일어났으니 어딘가는 줄어야 한다 — 그걸 제안 시트가 알린다.
  assert.ok(r.adjustments.length, "무엇이 줄었는지 알려야 한다");
  for (const a of r.adjustments) assert.ok(a.after < a.before);
  assert.ok(r.adjustments.some((a) => ["작업", "여유"].includes(a.name) || a.id.startsWith("buffer") || a.id === "work"));
});

test("강의 시작 시각을 넘겨 일어나면 강의가 밀린 것으로 드러난다", () => {
  // 조용히 넘기면 수업에 늦는다 — 화면은 "고정 시각 ≠ 실제 시각"으로 이걸 잡는다.
  const r = day(WED, { wake: "10:00" });
  const pushed = r.blocks
    .filter((b) => b.anchor === "clock" && b.fixedAt != null && b.start !== b.fixedAt)
    .map((b) => `${b.name} ${boundaryMinutesToHHMM(b.fixedAt)}→${boundaryMinutesToHHMM(b.start)}`);
  assert.ok(pushed.includes("장르연구Ⅰ(로맨스심화) 09:00→10:00"));
  assert.equal(boundaryMinutesToHHMM(r.blocks.find((b) => b.id === "sleep").start), "00:00", "취침은 그래도 지켜진다");
});

test("DAY_NAMES는 월=0 규칙(logicalWeekday와 같다)", () => {
  assert.equal(DAY_NAMES[0], "월");
  assert.equal(DAY_NAMES[6], "일");
});
