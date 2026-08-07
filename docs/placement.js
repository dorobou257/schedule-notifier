// 강의를 얹은 하루의 블록 배치.
//
// 예전에는 "강의와 겹치는 집필·작업을 통째로 지운다"였다. 강의가 하루의 절반을
// 가져가는 학기에는 그 방식이면 집필이 대부분의 요일에서 사라진다. 그래서
// 반대로 뒤집었다 — 시각 고정 블록(식사·운동·취침·강의)이 만들어낸 **빈 구간**을
// 먼저 구하고, 유동 블록을 그 구간에 배분한다.
//
// 규칙(사용자가 정한 생활 방침을 그대로 옮긴 것):
//   1. 기상~첫 앵커, 앵커 사이, 마지막 앵커~취침으로 gap 목록을 만든다.
//   2. 첫 gap은 준비 시간이다. 끝이 강의면 gap 전체가 준비 시간이 되고
//      (금요일 08–10), 끝이 루틴 앵커면 준비 시간 한 시간만 떼고 나머지를 연다.
//   3. 집필·작업은 저녁보다 이른 gap에 최대한 앞당겨 넣는다. 통째로 들어가는
//      자리를 먼저 찾고, 없으면 minMinutes 이상 남은 자리에 줄여서 넣는다.
//      그래도 없으면 저녁~운동 사이를 쓰고, 그마저 없으면 그날에서 뺀다.
//      운동 시각 이후(밤)는 어떤 경우에도 쓰지 않는다 — 밤은 언제나 휴식이다.
//      단 루틴 배열에서 저녁보다 뒤에 놓인 집필(방학 3차 집필)은 저녁 이후를
//      먼저 본다. 배열 순서가 곧 "이 블록은 저녁 뒤의 것"이라는 선언이다.
//   4. 여유 블록은 바로 앞 블록이 들어간 gap을 따라간다. 그러고도 여유가 하나도
//      없는 빈 gap이 남으면 남는 여유 블록을 그리로 옮긴다.
//   5. 같은 gap에서 서로 붙은 여유는 하나로 합친다.
//   6. gap 안의 순서는 준비 → 집필·작업(배열 순서) → 여유(배열 순서).
//
// 배분이 gap을 정확히 채우므로 computeSchedule은 늘리거나 줄일 것이 없다 —
// "무엇이 줄었다"는 제안이 매일 뜨지 않는다.
//
// DOM도 저장소도 건드리지 않는 순수 함수다.

/** 강의가 대신할 수 있는(=자리를 못 찾으면 그날에서 빠지는) 블록의 성격. */
export const PRODUCTIVE = new Set(["집필", "작업"]);

/** 남는 시간을 흡수하는 블록의 성격. */
export const BUFFER_CATEGORY = "여유";

const isTimed = (b) => b.anchor === "clock";

/**
 * 하루의 유동 블록을 gap에 배분한다.
 *
 * @param {Array} blocks 루틴 블록 전체(요일 필터 전)
 * @param {Array} lectures lectureBlocks()가 만든 강의 블록(요일 필터 전)
 * @param {number} weekday 월=0 … 일=6
 * @param {number} wakeMinutes 기상 시각(경계 좌표계 분)
 * @param {number|null} sleepMinutes 오늘 밤 실제 취침 시각. 없으면 취침 블록의 고정 시각.
 * @returns {{ blocks: Array, displaced: Set<string> }}
 *   blocks: computeSchedule에 그대로 넘길 수 있는 순서·분이 확정된 배열
 *   displaced: 자리를 찾지 못해 오늘에서 빠진 집필·작업 id
 */
export function placeIntoGaps({ blocks, lectures = [], weekday, wakeMinutes, sleepMinutes }) {
  const onToday = (b) => !b.days || b.days.includes(weekday);
  const today = blocks.filter(onToday).map((b) => ({ ...b }));
  const todayLectures = lectures.filter(onToday).map((l) => ({ ...l, isLecture: true }));

  const wakeBlock = today.find((b) => b.anchor === "wake");
  const sleepBlock = today.find((b) => b.anchor === "sleep");
  const dayEnd = sleepMinutes != null ? sleepMinutes : sleepBlock?.fixedAt ?? wakeMinutes;

  // 운동 시각이 곧 "밤의 시작"이다. 그날 운동이 없어도(화·목·주말) 기준은 같다 —
  // 운동을 안 하는 날이라고 밤 열한 시에 작업을 얹지는 않는다.
  const exerciseAnchor = blocks.find((b) => isTimed(b) && b.category === "운동");
  const nightStart = exerciseAnchor?.fixedAt ?? dayEnd;

  const dinner = [...today].reverse().find((b) => isTimed(b) && b.category === "식사");

  // 1) gap 목록.
  const anchors = [...today.filter(isTimed), ...todayLectures].sort((a, b) => a.fixedAt - b.fixedAt);
  const gaps = [];
  let cursor = wakeMinutes;
  for (const a of anchors) {
    const end = Math.max(cursor, a.fixedAt);
    gaps.push(makeGap(cursor, end, a));
    cursor = end + a.minutes;
  }
  gaps.push(makeGap(cursor, Math.max(cursor, dayEnd), sleepBlock));

  // 저녁 앵커가 닫는 gap까지가 "저녁보다 이른 자리"다.
  const dinnerGapIdx = dinner ? gaps.findIndex((g) => g.closedBy === dinner) : gaps.length - 1;
  const before = gaps.slice(0, dinnerGapIdx + 1);
  const after = gaps.slice(dinnerGapIdx + 1);

  const free = (g) => g.capacity - g.used;
  // 저녁 이후 gap은 운동 시각까지만 쓸 수 있다.
  const freeAtNight = (g) => Math.max(0, Math.min(g.end, nightStart) - g.start) - g.used;

  // 2) 준비 시간.
  const prep = today.find((b) => b.prep);
  if (prep && gaps.length) {
    const first = gaps[0];
    // 첫 gap이 강의로 끝나면 그 사이는 통째로 준비 시간이다(금요일 08–10).
    prep.minutes = first.closedBy?.isLecture ? first.capacity : Math.min(prep.minutes, first.capacity);
    place(first, prep, prep.minutes);
  }

  // 3) 집필·작업.
  const dinnerArrayIdx = dinner ? today.indexOf(dinner) : today.length;
  const displaced = new Set();
  today.forEach((b, i) => {
    if (b.anchor || !PRODUCTIVE.has(b.category)) return;
    const evening = i > dinnerArrayIdx;
    // 저녁 이전을 다 훑고 나서야 저녁 이후를 본다 — 줄여서라도 앞에 넣는 편이
    // "최대한 앞당기고 저녁은 비운다"는 방침에 맞다.
    const attempts = evening
      ? [[after, false], [after, true], [before, false], [before, true]]
      : [[before, false], [before, true], [after, false], [after, true]];
    for (const [list, partial] of attempts) {
      const room = list === after ? freeAtNight : free;
      const g = list.find((gap) => (partial ? room(gap) > 0 && room(gap) >= (b.minMinutes || 0) : room(gap) >= b.minutes));
      if (g) {
        place(g, b, partial ? Math.min(b.minutes, room(g)) : b.minutes);
        return;
      }
    }
    displaced.add(b.id);
  });

  // 4) 여유. 배열에서 바로 앞의 블록이 들어간 gap을 따라간다.
  const buffers = [];
  let currentGap = gaps[0] || null;
  const gapAfter = new Map(gaps.map((g, i) => [g.closedBy, gaps[i + 1] || null]));
  for (const b of today) {
    if (b.anchor === "wake") continue;
    if (b.anchor) {
      currentGap = gapAfter.get(b) ?? currentGap;
      continue;
    }
    if (b.prep) {
      currentGap = b.gap || currentGap;
      continue;
    }
    if (PRODUCTIVE.has(b.category)) {
      if (b.gap) currentGap = b.gap;
      continue;
    }
    buffers.push({ block: b, prefer: currentGap });
  }

  const pending = [];
  for (const { block, prefer } of buffers) {
    if (prefer && free(prefer) > 0 && !prefer.hasBuffer) attachBuffer(prefer, block);
    else pending.push({ block, prefer });
  }
  // 여유가 하나도 없는 빈 gap이 남으면 남는 여유를 그리로 옮긴다(화요일 17–18).
  for (const g of gaps) {
    if (!pending.length) break;
    if (free(g) <= 0 || g.hasBuffer) continue;
    attachBuffer(g, pending.shift().block);
  }
  for (const { block, prefer } of pending) attachBuffer(prefer || gaps[0], block);

  // gap마다 남은 시간을 여유에 나눠 담는다. 정확히 채워야 computeSchedule이
  // 늘리거나 줄이지 않는다.
  for (const g of gaps) {
    let left = Math.max(0, g.capacity - g.used);
    g.buffers.forEach((b) => {
      b.minutes = Math.min(b.minutes, left);
      left -= b.minutes;
    });
    if (left > 0 && g.buffers.length) {
      const soak = [...g.buffers].reverse().find((b) => b.category === BUFFER_CATEGORY) || g.buffers[g.buffers.length - 1];
      soak.minutes += left;
    }
  }

  // 6) gap 안의 순서 + 앵커를 시각 순으로 이어 붙인다.
  const out = [];
  if (wakeBlock) out.push(wakeBlock);
  gaps.forEach((g) => {
    out.push(...g.prep, ...g.work, ...g.buffers);
    if (g.closedBy && g.closedBy !== sleepBlock) out.push(g.closedBy);
  });
  if (sleepBlock) out.push(sleepBlock);

  return { blocks: mergeAdjacentBuffers(out), displaced };

  function makeGap(start, end, closedBy) {
    return { start, end, capacity: Math.max(0, end - start), used: 0, closedBy, prep: [], work: [], buffers: [], hasBuffer: false };
  }

  function place(gap, block, minutes) {
    block.minutes = minutes;
    block.gap = gap;
    gap.used += minutes;
    (block.prep ? gap.prep : gap.work).push(block);
  }

  function attachBuffer(gap, block) {
    if (!gap) return;
    block.gap = gap;
    gap.buffers.push(block);
    gap.hasBuffer = true;
  }
}

/**
 * 같은 gap에서 서로 붙은 여유를 하나로 합친다. 운동이 없는 날의 "휴식"과
 * "밤 휴식"이 21시에 끊겨 보일 이유가 없다. 준비 시간은 합치지 않는다 —
 * 하루의 시작을 따로 보여주는 편이 낫다.
 */
function mergeAdjacentBuffers(blocks) {
  const out = [];
  for (const b of blocks) {
    const prev = out[out.length - 1];
    const mergeable = (x) => x && !x.anchor && !x.prep && x.category === BUFFER_CATEGORY;
    if (mergeable(prev) && mergeable(b) && prev.gap === b.gap) {
      prev.minutes += b.minutes;
      continue;
    }
    out.push(b);
  }
  // gap은 배치용 내부 상태다 — 밖으로 내보내면 순환 참조로 JSON 직렬화가 깨진다.
  return out.map(({ gap, isLecture, ...rest }) => rest);
}
