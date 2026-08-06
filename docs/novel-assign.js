// 소설 일정 ↔ 집필/작업 블록 배정.
//
// 노션에 "오늘 44화 초고" 같은 소설 일정이 있어도 하루 중 언제 쓸지는 앱이
// 계산한 블록에만 있었다. 둘을 이어붙여서 "2차 집필 = 44화 초고"로 보이게 한다.
// 기본은 순서대로 자동 배정이고, 사용자가 지정하면 그게 이긴다.
//
// DOM도 저장소도 건드리지 않는 순수 함수 모음이다 — 배정 규칙은 회귀가 잦은
// 부분이라 Node에서 그대로 테스트할 수 있어야 한다. 사용자가 지정한 배정
// 상태(store.novelAssign)는 전역으로 읽지 않고 인자로 받는다.

/** 소설 항목의 안정적인 키. 노션 페이지 id가 있으면 그걸 쓰고, 아직
 *  today.json이 갱신되지 않아 id가 없으면 내용으로 키를 만든다. */
export function novelKey(item) {
  return item.id || `${(item.tags || []).join("/")}|${item.text || ""}`;
}

// 실제로 원고를 쓰는 단계만 "집필"에 붙는다. 트리트먼트/시놉시스/설정은
// 자료를 만지는 일에 가까우니 "작업"으로 간다.
export const WRITING_STAGES = new Set(["초고", "퇴고"]);
// 연재는 올려두기만 하면 되는 일이라 하루의 어느 블록도 차지하지 않는다.
export const UNSCHEDULED_STAGES = new Set(["연재"]);

/** 소설 항목의 유형. tags = [작품, 유형]. */
export function stageOf(item) {
  return (item.tags || [])[1] || "";
}

/** 이 소설 항목이 붙을 수 있는 블록 성격. 어디에도 안 붙으면 null. */
export function targetCategoryOf(item) {
  const stage = stageOf(item);
  if (UNSCHEDULED_STAGES.has(stage)) return null;
  return WRITING_STAGES.has(stage) ? "집필" : "작업";
}

/** 오늘 실제로 시간이 배정된 해당 성격의 블록들(시간순). */
export function blocksOfCategory(blocks, category) {
  return blocks.filter((b) => b.category === category && b.minutes > 0);
}

/** "[챌린지] 초고 · 44화" 형태의 한 줄 요약. */
export function novelLabel(item) {
  const tags = (item.tags || []).filter(Boolean);
  const head = tags.length ? `[${tags.join(" ")}] ` : "";
  return head + (item.text || "");
}

/** 한 성격 안에서 블록당 1건씩 채운다. 블록보다 항목이 많으면 남는 건 배정되지 않는다. */
function assignInto(result, targetBlocks, items, assign) {
  const map = assign.map || {};
  const excluded = new Set(assign.excluded || []);
  const byKey = new Map(items.map((it) => [novelKey(it), it]));
  const used = new Set();

  // 1) 사용자가 직접 지정한 것부터.
  for (const b of targetBlocks) {
    const key = map[b.id];
    if (key && byKey.has(key)) {
      result.set(b.id, byKey.get(key));
      used.add(key);
    }
  }
  // 2) 남은 항목을 아직 비어 있는 블록에 순서대로 채운다.
  //    "배정 해제"한 항목(excluded)은 자동 배정에서도 제외된다.
  const rest = items.filter((it) => !used.has(novelKey(it)) && !excluded.has(novelKey(it)));
  let i = 0;
  for (const b of targetBlocks) {
    if (result.has(b.id)) continue;
    if (i >= rest.length) break;
    result.set(b.id, rest[i++]);
  }
}

/**
 * @param {Array} blocks 오늘 계산된 블록들(start/end가 붙은 결과)
 * @param {Array} novelItems 노션에서 온 소설 항목들
 * @param {{map: object, excluded: string[]}} assign 사용자가 지정한 배정 상태
 * @returns {Map<string, object>} blockId → 소설 항목
 */
export function resolveNovelAssignments(blocks, novelItems, assign = { map: {}, excluded: [] }) {
  const result = new Map();
  // 이미 완료한 항목은 자리를 차지하지 않는다 — 다음 일정이 당겨진다.
  const pending = novelItems.filter((it) => !it.done);
  for (const category of ["집필", "작업"]) {
    assignInto(
      result,
      blocksOfCategory(blocks, category),
      pending.filter((it) => targetCategoryOf(it) === category),
      assign
    );
  }
  return result;
}
