// 강의 시간표.
//
// 강의는 새로운 개념이 아니라 "요일 반복 + 시각 고정 블록"이다 — routine.js가
// 이미 anchor:"clock" + fixedAt + days를 다루므로, 여기서는 사람이 적기 쉬운
// 형태를 그 블록 모양으로 옮기는 일만 한다.
//
// DOM도 저장소도 건드리지 않는 순수 함수 모음이다.
import { computeSchedule, hhmmToBoundaryMinutes } from "./routine.js";
import { placeIntoGaps } from "./placement.js";

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
 * 강의를 얹은 하루를 계산한다. 강의가 없으면 그냥 한 번 계산하는 것과 같다.
 *
 * 강의를 배열 어디에 꽂을지 고민하는 대신, 시각 고정 블록이 만든 빈 구간에
 * 유동 블록을 배분한다(placement.js). 배분이 구간을 정확히 채우므로
 * computeSchedule은 시각만 매기면 된다.
 *
 * @returns {{blocks, adjustments, warnings, displaced: Set<string>}}
 *   displaced: 자리를 찾지 못해 오늘에서 빠진 집필·작업 id
 *   (화면이 "강의가 그 자리를 대신했다"를 알려줄 수 있게).
 */
export function computeDayWithLectures({ blocks, lectures = [], settings, weekday, wakeMinutes, sleepMinutes }) {
  const placed = placeIntoGaps({ blocks, lectures, weekday, wakeMinutes, sleepMinutes });
  const out = computeSchedule({ blocks: placed.blocks, settings, weekday, wakeMinutes, sleepMinutes });

  const baseWake = hhmmToBoundaryMinutes(settings.baseWake, settings.dayBoundaryHour ?? 4);
  if (wakeMinutes === baseWake && sleepMinutes == null) {
    return { ...out, displaced: placed.displaced };
  }

  // 늦잠·이른 기상·취침 변경으로 하루가 달라졌을 때, "무엇이 줄었는지"는
  // 기준대로 일어났을 하루와 견줘서만 알 수 있다. 배치가 블록을 다른 자리로
  // 옮겨 담으면서 길이를 조절하기 때문에, computeSchedule 안의 축소 기록만으로는
  // 그 차이가 잡히지 않는다(강의 때문에 줄어든 것까지 섞이면 매일 제안이 뜬다).
  const refBlocks = placeIntoGaps({ blocks, lectures, weekday, wakeMinutes: baseWake }).blocks;
  const ref = computeSchedule({ blocks: refBlocks, settings, weekday, wakeMinutes: baseWake });
  return { ...out, adjustments: shrinkageAgainst(ref.blocks, out.blocks), displaced: placed.displaced };
}

/** 기준 하루와 견줘 짧아지거나 사라진 블록만 조정 내역으로 만든다. */
function shrinkageAgainst(refBlocks, actualBlocks) {
  const actual = new Map(actualBlocks.map((b) => [b.id, b.end - b.start]));
  const out = [];
  for (const b of refBlocks) {
    if (b.anchor || b.protected) continue;
    const before = b.end - b.start;
    const after = actual.get(b.id) ?? 0;
    if (before <= 0 || after >= before) continue;
    out.push({ id: b.id, name: b.name, before, after, type: after === 0 ? "removed" : "shortened" });
  }
  return out;
}
