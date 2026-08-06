// 강의 시간표.
//
// 강의는 새로운 개념이 아니라 "요일 반복 + 시각 고정 블록"이다 — routine.js가
// 이미 anchor:"clock" + fixedAt + days를 다루므로, 여기서는 사람이 적기 쉬운
// 형태를 그 블록 모양으로 옮기는 일만 한다.
//
// DOM도 저장소도 건드리지 않는 순수 함수 모음이다.
import { computeSchedule, hhmmToBoundaryMinutes } from "./routine.js";

/** 월=0 … 일=6 (notify.py / logicalWeekday와 같은 규칙). */
export const DAY_NAMES = ["월", "화", "수", "목", "금", "토", "일"];

export const LECTURE_CATEGORY = "강의";

/** "13:00" → 분(0~1439). 형식이 틀리면 null. */
function hhmmToMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

const pad = (n) => String(n).padStart(2, "0");
export const minutesToHHMM = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

/**
 * 사람이 적은 시간표 한 줄을 강의로 옮긴다.
 *
 *   월수 13:00-16:00 웹소설산업과비즈니스(A) @현3/304
 *   화 16:00~19:00 장르연구Ⅲ(판무B)
 *
 * 요일은 붙여 쓰고(월수), 시각은 - 또는 ~로 잇는다. @뒤는 장소(생략 가능).
 * @returns {object|null} 못 읽으면 null — 한 줄이 이상해도 나머지는 살린다.
 */
export function parseLectureLine(line) {
  const text = (line || "").trim();
  if (!text || text.startsWith("#")) return null;

  const m = /^([월화수목금토일]+)\s+(\d{1,2}:\d{2})\s*[-~]\s*(\d{1,2}:\d{2})\s+(.+)$/.exec(text);
  if (!m) return null;

  const days = [...new Set([...m[1]].map((d) => DAY_NAMES.indexOf(d)))].sort((a, b) => a - b);
  const start = hhmmToMinutes(m[2]);
  const end = hhmmToMinutes(m[3]);
  if (!days.length || start == null || end == null || end <= start) return null;

  const [rawName, ...placeParts] = m[4].split("@");
  const name = rawName.trim();
  if (!name) return null;

  return {
    days,
    start: minutesToHHMM(start),
    minutes: end - start,
    name,
    place: placeParts.join("@").trim(),
  };
}

/** 여러 줄을 한 번에. 못 읽은 줄은 따로 알려줘서 사용자가 고칠 수 있게 한다. */
export function parseLectures(text) {
  const lectures = [];
  const failed = [];
  (text || "").split("\n").forEach((line) => {
    if (!line.trim() || line.trim().startsWith("#")) return;
    const parsed = parseLectureLine(line);
    if (parsed) lectures.push(parsed);
    else failed.push(line.trim());
  });
  return { lectures: withIds(lectures), failed };
}

/** 저장·배정에 쓸 안정적인 id를 붙인다(내용이 같으면 같은 id). */
export function withIds(lectures) {
  const used = new Map();
  return lectures.map((lec) => {
    const base = `lec-${lec.days.join("")}-${lec.start.replace(":", "")}`;
    const n = (used.get(base) || 0) + 1;
    used.set(base, n);
    return { ...lec, id: n === 1 ? base : `${base}-${n}` };
  });
}

/** 강의 한 줄을 사람이 읽는 형태로 되돌린다(붙여넣기 칸 채우기용). */
export function formatLectureLine(lec) {
  const days = lec.days.map((d) => DAY_NAMES[d]).join("");
  const end = minutesToHHMM(hhmmToMinutes(lec.start) + lec.minutes);
  return `${days} ${lec.start}-${end} ${lec.name}${lec.place ? ` @${lec.place}` : ""}`;
}

/**
 * 이 날짜에 강의가 있는지. 학기 밖(방학)이면 하루에서 통째로 뺀다.
 * 시작/종료를 비워두면 "항상"으로 본다 — 학기를 안 적어도 쓸 수 있어야 한다.
 */
export function isWithinSemester(dateKey, semester) {
  if (!semester) return true;
  if (semester.start && dateKey < semester.start) return false;
  if (semester.end && dateKey > semester.end) return false;
  return true;
}

/**
 * 강의를 routine.js가 아는 블록 모양으로 바꾼다.
 *
 * 강의는 시각이 정해져 있고 줄일 수도 없으므로 clock 앵커 + protected다.
 * (오늘 하루만 옮기고 싶으면 메인 화면에서 끌면 된다 — dayTweaks.unpinned)
 *
 * @param {Array} lectures store.lectures
 * @param {{dateKey: string, semester: object, isHoliday: boolean, dayBoundaryHour: number}} ctx
 */
export function lectureBlocks(lectures, ctx) {
  const { dateKey, semester, isHoliday, dayBoundaryHour = 4 } = ctx;
  // 공휴일엔 강의가 없다. 휴강·보강까지는 알 수 없으니 그건 화면에서 개별로 끈다.
  if (isHoliday || !isWithinSemester(dateKey, semester)) return [];

  return (lectures || []).map((lec) => ({
    id: lec.id,
    name: lec.name,
    place: lec.place || "",
    category: LECTURE_CATEGORY,
    minutes: lec.minutes,
    minMinutes: lec.minutes,
    protected: true,
    anchor: "clock",
    fixedAt: hhmmToBoundaryMinutes(lec.start, dayBoundaryHour),
    days: lec.days,
  }));
}

/**
 * 루틴 블록 배열에 강의를 시각에 맞는 자리로 꽂는다.
 *
 * 그냥 뒤에 붙이면 안 된다. computeSchedule은 시각 고정 블록을 경계로 하루를
 * 구간으로 나누는데, 배열에서 강의보다 앞에 있는 블록은 전부 "점심~첫 강의"
 * 구간에 속하게 된다. 강의를 배열 끝에 붙이면 오후·저녁 루틴이 통째로 그
 * 좁은 구간에 갇혀 0분으로 눌린다(실제로 그랬다).
 *
 * 그래서 "자기보다 이른 마지막 시각 고정 블록의 바로 뒤"에 넣는다. 그러면
 * 강의 뒤에 오는 루틴 블록들이 자연스럽게 강의 이후 구간을 나눠 갖는다.
 */
/** 강의가 밀어낼 수 있는 블록의 성격. 식사·수면은 강의가 있어도 없앨 수 없다. */
export const DISPLACEABLE = new Set(["집필", "작업"]);

/**
 * 강의 시각과 겹치는 집필·작업 블록의 id.
 *
 * 강의를 그냥 끼워 넣으면 하루가 그만큼 길어져서, 밀려난 집필이 밤 열한 시에
 * 가서 붙는다. 실제로는 그 시간에 강의를 듣고 있으니 그 집필은 없는 것이다.
 * 그래서 강의 자리에 있던 집필·작업은 하루에서 뺀다 — 강의가 그것을 대신한다.
 *
 * 겹침 판정에는 "강의를 넣지 않고 계산한 하루"가 필요하다. 어느 블록이 몇 시에
 * 오는지는 배치해봐야 알 수 있는데, 강의를 이미 넣고 배치하면 강의에 밀린
 * 결과를 보게 되기 때문이다. computeDayWithLectures가 그 두 번을 맡는다.
 *
 * @param {Array} baseBlocks 강의 없이 계산한 computeSchedule 결과의 blocks
 * @param {Array} lectures lectureBlocks()가 만든 강의 블록
 */
export function blocksDisplacedBy(baseBlocks, lectures) {
  const spans = lectures.map((l) => [l.fixedAt, l.fixedAt + l.minutes]);
  const out = new Set();
  for (const b of baseBlocks) {
    if (!DISPLACEABLE.has(b.category) || b.minutes <= 0) continue;
    // 조금이라도 걸치면 뺀다. 반쯤 남은 집필 블록을 강의 앞뒤에 끼워 넣어봐야
    // 실제로는 오가는 시간이라 쓸 수 없다.
    if (spans.some(([start, end]) => b.start < end && start < b.end)) out.add(b.id);
  }
  return out;
}

/**
 * 강의를 얹은 하루를 계산한다. 강의가 없으면 그냥 한 번 계산하는 것과 같다.
 *
 * @returns {{blocks, adjustments, warnings, displaced: Set<string>}}
 *   displaced: 강의가 대신한 블록 id들(화면이 "무엇이 사라졌는지" 알려줄 수 있게).
 */
export function computeDayWithLectures({ blocks, lectures = [], settings, weekday, wakeMinutes, sleepMinutes }) {
  const args = { settings, weekday, wakeMinutes, sleepMinutes };
  if (!lectures.length) return { ...computeSchedule({ blocks, ...args }), displaced: new Set() };

  const base = computeSchedule({ blocks, ...args });
  const displaced = blocksDisplacedBy(base.blocks, lectures);
  const merged = mergeLectureBlocks(
    blocks.filter((b) => !displaced.has(b.id)),
    lectures
  );
  return { ...computeSchedule({ blocks: merged, ...args }), displaced };
}

/**
 * 학기 중에만 쓰는 식사 시각으로 갈아끼운다.
 *
 * 학기가 시작되면 점심이 13:00 강의와 부딪힌다. 그렇다고 방학에도 12:00에
 * 먹을 이유는 없어서, "평소 시각"과 "학기 중 시각"을 따로 둔다. 비워두면
 * 평소 시각을 그대로 쓴다.
 *
 * @param {Array} blocks 루틴 블록
 * @param {object} semesterMeals { breakfast, lunch, dinner } — "HH:MM" 또는 빈 값
 */
export function applySemesterMealTimes(blocks, semesterMeals, dayBoundaryHour = 4) {
  const times = semesterMeals || {};
  if (!Object.values(times).some(Boolean)) return blocks;
  return blocks.map((b) => {
    const at = times[b.id];
    if (!at) return b;
    return { ...b, anchor: "clock", fixedAt: hhmmToBoundaryMinutes(at, dayBoundaryHour) };
  });
}

export function mergeLectureBlocks(blocks, lectures) {
  if (!lectures.length) return blocks;

  const out = [...blocks];
  // 이른 강의부터 꽂아야 같은 자리에 여러 개가 들어갈 때 순서가 유지된다.
  for (const lec of [...lectures].sort((a, b) => a.fixedAt - b.fixedAt)) {
    let at = out.findIndex((b) => b.anchor === "wake") + 1; // 기본은 하루의 맨 앞
    out.forEach((b, i) => {
      const timed = b.anchor === "clock" || b.anchor === "sleep";
      if (timed && b.fixedAt != null && b.fixedAt <= lec.fixedAt) at = i + 1;
    });
    out.splice(at, 0, lec);
  }
  return out;
}
