// 순수 로직 모듈. DOM을 건드리지 않는다 — 브라우저(<script type="module">)와
// Node(`node --test`) 양쪽에서 그대로 임포트해서 쓸 수 있어야 한다.
//
// 하루를 "경계 시각(기본 04:00) 이후 경과 분" 좌표계로 다룬다. 이렇게 하면
// 00:30 취침처럼 자정을 넘기는 시각도 음수/분기 없이 하나의 정수로 표현된다.
//   예) dayBoundaryHour=4 일 때 08:00 → 240, 13:00 → 540, 00:30(다음날) → 1230

export const DEFAULT_SETTINGS = {
  baseWake: "08:00",
  baseSleep: "00:30",
  sleepTargetMinutes: 450, // 7.5시간
  dayBoundaryHour: 4,
  dropBreakfastWhenLate: true,
  // 부족한 시간을 회수할 때의 순서. 앞에 있을수록 먼저 줄어든다.
  // 설정 화면에서 사용자가 이 배열 순서를 바꿀 수 있다.
  reducePriority: ["여유", "운동", "작업", "집필"],
};

/** "HH:MM" → 경계 좌표계 분(정수). */
export function hhmmToBoundaryMinutes(hhmm, dayBoundaryHour = 4) {
  const [h, m] = hhmm.split(":").map(Number);
  const raw = h * 60 + m;
  const boundary = dayBoundaryHour * 60;
  return raw < boundary ? raw + 1440 - boundary : raw - boundary;
}

/** 경계 좌표계 분 → "HH:MM" (렌더링·테스트용 역변환). */
export function boundaryMinutesToHHMM(minutes, dayBoundaryHour = 4) {
  const boundary = dayBoundaryHour * 60;
  let total = (minutes + boundary) % 1440;
  if (total < 0) total += 1440;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Date → 경계 좌표계 분. */
export function dateToBoundaryMinutes(date, dayBoundaryHour = 4) {
  const raw = date.getHours() * 60 + date.getMinutes();
  const boundary = dayBoundaryHour * 60;
  return raw < boundary ? raw + 1440 - boundary : raw - boundary;
}

/**
 * 논리적 요일(월=0…일=6, notify.py의 datetime.weekday() 규칙과 동일).
 * dayBoundaryHour 이전 시각은 전날로 취급해서 "취침 직후 자정을 넘겨 앱을
 * 열어도 어제의 하루가 계속되는" 감각을 유지한다.
 */
export function logicalWeekday(date, dayBoundaryHour = 4) {
  const d = new Date(date);
  if (d.getHours() < dayBoundaryHour) d.setDate(d.getDate() - 1);
  return (d.getDay() + 6) % 7;
}

/** logicalWeekday와 같은 날짜 이동 규칙으로 "YYYY-MM-DD" 키를 만든다.
 * 하루치 취침 기록(localStorage today.date)이 새 논리적 하루로 넘어갔는지
 * 판정하는 용도. */
export function logicalDateKey(date, dayBoundaryHour = 4) {
  const d = new Date(date);
  if (d.getHours() < dayBoundaryHour) d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// 평일/주말 구분을 폐기한 단일 기본 루틴. 합계는 정확히 기준 예산(기상
// 08:00~취침 00:30 = 990분)과 일치한다 — 08:00 기상 시 결과가 이 표와
// 그대로 같아야 한다(회귀 테스트로 고정).
//
// anchor:
//   "wake"  하루의 시작점. 실제/예상 기상 시각이 곧 이 블록의 시각.
//   "clock" 이 블록은 앞뒤 블록과 무관하게 항상 fixedAt 시각에 시작한다.
//           (점심 13:00 고정 — 오전 지연의 손실이 이 지점에서 흡수되도록 하는 핵심 앵커)
//   "sleep" 하루의 끝점. 취침은 절대 밀리지 않는다(요구사항).
//   없음    유동 블록. 같은 구간(segment) 안에서 순서대로 이어 붙는다.
export const BASE_BLOCKS = [
  { id: "wake", name: "기상", category: "기타", minutes: 0, anchor: "wake", protected: true },
  { id: "breakfast", name: "아침 식사", category: "식사", minutes: 60, minMinutes: 60, protected: true },
  { id: "session1", name: "1차 집필", category: "집필", minutes: 120, minMinutes: 60 },
  { id: "buffer", name: "여유", category: "여유", minutes: 120, minMinutes: 0 },
  { id: "lunch", name: "점심 식사", category: "식사", minutes: 60, minMinutes: 60, protected: true, anchor: "clock", fixedAt: hhmmToBoundaryMinutes("13:00") },
  { id: "session2", name: "2차 집필", category: "집필", minutes: 120, minMinutes: 60 },
  { id: "work", name: "작업", category: "작업", minutes: 120, minMinutes: 30 },
  { id: "dinner", name: "저녁 식사", category: "식사", minutes: 60, minMinutes: 60, protected: true },
  { id: "session3", name: "3차 집필", category: "집필", minutes: 120, minMinutes: 60 },
  { id: "exercise", name: "운동", category: "운동", minutes: 60, minMinutes: 30, days: [0, 2, 4] },
  { id: "rest", name: "휴식", category: "여유", minutes: 150, minMinutes: 0 },
  { id: "sleep", name: "취침", category: "기타", minutes: 0, protected: true, anchor: "sleep", fixedAt: hhmmToBoundaryMinutes("00:30") },
];

/**
 * 취침 기록으로부터 기상 시각(경계 좌표계 분)을 결정한다.
 * 우선순위: 아침 보정(wakeOverrideMinutes) > 취침 기록 + 수면 목표 > 기본 기상.
 *
 * bedAtMinutes + sleepTargetMinutes는 1440(하루)을 넘길 수 있다 — 저녁에
 * 취침 버튼을 누르면 그 시각(예: 22:00 → 경계 좌표계로는 1080)에 수면
 * 목표(450분)를 더한 값(1530)이 다음날 새벽을 가리키기 때문이다. lunch/sleep
 * 같은 clock 앵커는 전부 [0, 1440) 범위라서, 이 값을 그대로 넘기면
 * computeSchedule이 "기상이 점심/취침보다 한참 뒤"라고 오판해 하루 전체가
 * 지워진다. 항상 [0, 1440) 범위로 접어(mod) 반환해 같은 좌표계를 유지한다.
 */
export function computeWakeMinutes({ bedAtMinutes, wakeOverrideMinutes, sleepTargetMinutes, baseWakeMinutes }) {
  if (wakeOverrideMinutes != null) return wakeOverrideMinutes;
  if (bedAtMinutes != null) return (bedAtMinutes + sleepTargetMinutes) % 1440;
  return baseWakeMinutes;
}

/**
 * 우선순위 순서대로 세그먼트 안의 블록을 줄여 deficit(분)을 회수한다.
 * forced=false일 때는 각 블록의 minMinutes까지만, forced=true(최후 수단)일
 * 때는 0까지 줄인다. 같은 카테고리 안에서는 "늦은 블록부터" 줄인다 —
 * segment 배열이 이미 시간순이므로 뒤집어서 순회하면 된다.
 */
function reduceBy(segment, priority, deficit, adjustments, forced) {
  for (const cat of priority) {
    if (deficit <= 0) break;
    const candidates = segment.filter((b) => b.category === cat && !b.protected && b.minutes > 0).reverse();
    for (const b of candidates) {
      if (deficit <= 0) break;
      const floor = forced ? 0 : b.minMinutes || 0;
      const reducible = b.minutes - floor;
      if (reducible <= 0) continue;
      const cut = Math.min(reducible, deficit);
      const before = b.minutes;
      b.minutes -= cut;
      deficit -= cut;
      adjustments.push({
        id: b.id,
        name: b.name,
        before,
        after: b.minutes,
        type: b.minutes === 0 ? "removed" : "shortened",
        forced: !!forced,
      });
    }
  }
  return deficit;
}

/**
 * 하루치 블록 목록을 실제 기상 시각에 맞춰 재배치한다. 부작용 없는 순수 함수.
 *
 * 핵심 아이디어: anchor:"clock"/"sleep" 블록을 경계로 하루를 세그먼트로
 * 쪼개고, 세그먼트별로 "그 안의 블록 합 - 세그먼트 예산"만큼만 독립적으로
 * 압축한다. 점심이 13:00에 고정되어 있으므로 오전 지연은 오전 세그먼트
 * 안에서만 흡수되고 오후·저녁·취침은 건드리지 않는다.
 *
 * @returns {{ blocks: Array, adjustments: Array, warnings: Array }}
 *   blocks: { ...원본 필드, start, end } — start/end는 경계 좌표계 분.
 *   adjustments: 제안 시트에 그대로 나열할 수 있는 변경 내역.
 *   warnings: 취침 전에 다 밀어넣지 못한 경우 등 이상 상황 표시.
 */
export function computeSchedule({ blocks = BASE_BLOCKS, settings = DEFAULT_SETTINGS, weekday, wakeMinutes }) {
  const priority = settings.reducePriority || DEFAULT_SETTINGS.reducePriority;
  const dayBoundaryHour = settings.dayBoundaryHour ?? DEFAULT_SETTINGS.dayBoundaryHour;
  const baseWakeMinutes = hhmmToBoundaryMinutes(settings.baseWake, dayBoundaryHour);

  // 오늘 반복 대상이 아닌 블록(예: 화/목의 운동)은 애초에 하루에서 빠진다.
  // 깊은 복사를 해서 호출자의 blocks 배열/객체를 절대 변형하지 않는다.
  const work = blocks.filter((b) => !b.days || b.days.includes(weekday)).map((b) => ({ ...b }));

  const adjustments = [];
  const warnings = [];

  // 1) 기상이 기준보다 늦으면 아침 식사는 우선순위 목록과 무관하게 무조건 삭제.
  if (wakeMinutes > baseWakeMinutes && settings.dropBreakfastWhenLate) {
    for (const b of work) {
      if (b.id === "breakfast" && b.minutes > 0) {
        adjustments.push({ id: b.id, name: b.name, before: b.minutes, after: 0, type: "removed", reason: "wake-delayed" });
        b.minutes = 0;
      }
    }
  }

  // 2) clock/sleep 앵커를 경계로 세그먼트를 나누며 순서대로 배치.
  const resultBlocks = [];
  let cursor = wakeMinutes;
  let segment = [];

  function flushSegment(budget) {
    if (!segment.length) return;
    const total = segment.reduce((s, b) => s + b.minutes, 0);
    let deficit = total - budget;
    if (deficit > 0) {
      deficit = reduceBy(segment, priority, deficit, adjustments, false);
      if (deficit > 0) deficit = reduceBy(segment, priority, deficit, adjustments, true);
      if (deficit > 0) warnings.push({ type: "segment-overflow", minutes: deficit });
    }
    for (const b of segment) {
      const start = cursor;
      const end = cursor + b.minutes;
      resultBlocks.push({ ...b, start, end });
      cursor = end;
    }
    segment = [];
  }

  for (const b of work) {
    if (b.anchor === "wake") {
      resultBlocks.push({ ...b, start: wakeMinutes, end: wakeMinutes });
      cursor = wakeMinutes;
      continue;
    }
    if (b.anchor === "clock" || b.anchor === "sleep") {
      const budget = b.fixedAt - cursor;
      if (budget < 0) {
        // 기상 자체가 이 앵커의 고정 시각을 이미 지나버린 극단적인 경우.
        // 취침 우선 원칙과 마찬가지로 앵커 시각을 뒤로 밀지 않고, 대신
        // 세그먼트 전체를 비우고 경고를 남긴다 — "무리한 하루"를 조용히
        // 숨기지 않고 사용자에게 드러내는 편을 택했다.
        for (const sb of segment) {
          if (sb.minutes > 0) {
            adjustments.push({ id: sb.id, name: sb.name, before: sb.minutes, after: 0, type: "removed", reason: "segment-overflow" });
            sb.minutes = 0;
          }
          resultBlocks.push({ ...sb, start: cursor, end: cursor });
        }
        warnings.push({ type: "segment-empty", beforeId: b.id });
        segment = [];
        cursor = Math.max(cursor, b.fixedAt); // 타임라인이 거꾸로 흐르지 않도록.
      } else {
        flushSegment(budget);
        cursor = b.fixedAt;
      }
      const start = cursor;
      const end = cursor + b.minutes;
      resultBlocks.push({ ...b, start, end });
      cursor = end;
      continue;
    }
    segment.push(b);
  }
  // sleep이 항상 마지막 anchor이므로 보통 비어 있지만, 방어적으로 처리.
  if (segment.length) flushSegment(segment.reduce((s, b) => s + b.minutes, 0));

  return { blocks: resultBlocks, adjustments, warnings };
}
