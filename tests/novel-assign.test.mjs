// 소설 일정 ↔ 블록 배정 규칙. 실사용 중 "완료했는데 다음 게 안 당겨진다",
// "배정을 풀었는데 자동으로 도로 채워진다" 같은 회귀가 잦았던 부분이라
// 규칙을 하나씩 고정해 둔다.
import test from "node:test";
import assert from "node:assert/strict";

import {
  novelKey,
  novelLabel,
  stageOf,
  targetCategoryOf,
  blocksOfCategory,
  resolveNovelAssignments,
} from "../docs/novel-assign.js";

const block = (id, category, minutes = 120) => ({ id, category, minutes });
const item = (text, 작품, 유형, done = false) => ({ tags: [작품, 유형], text, done });

// 오늘 하루 예시: 집필 3블록 + 작업 1블록.
const BLOCKS = [
  block("session1", "집필"),
  block("work", "작업"),
  block("session2", "집필"),
  block("session3", "집필"),
];

const NONE = { map: {}, excluded: [] };
const assigned = (result) => Object.fromEntries([...result].map(([k, v]) => [k, v.text]));

// --- 분류 규칙 --------------------------------------------------------------

test("유형에 따라 붙을 블록 성격이 갈린다", () => {
  assert.equal(targetCategoryOf(item("50화", "챌린지", "초고")), "집필");
  assert.equal(targetCategoryOf(item("50화", "챌린지", "퇴고")), "집필");
  assert.equal(targetCategoryOf(item("EP 4", "호위기사", "트리트먼트")), "작업");
  assert.equal(targetCategoryOf(item("설정집", "호위기사", "시놉시스")), "작업");
  assert.equal(targetCategoryOf(item("세계관", "호위기사", "설정")), "작업");
  assert.equal(targetCategoryOf(item("50화", "챌린지", "연재")), null, "연재는 시간을 안 쓴다");
});

test("유형이 비었거나 모르는 값이면 작업으로 간다", () => {
  assert.equal(stageOf({ tags: ["챌린지"] }), "");
  assert.equal(targetCategoryOf({ tags: ["챌린지"], text: "뭔가" }), "작업");
  assert.equal(targetCategoryOf({ text: "태그 없음" }), "작업");
});

test("novelKey: 노션 id가 있으면 그걸, 없으면 내용으로 키를 만든다", () => {
  assert.equal(novelKey({ id: "abc", tags: ["챌린지", "초고"], text: "50화" }), "abc");
  assert.equal(novelKey({ tags: ["챌린지", "초고"], text: "50화" }), "챌린지/초고|50화");
  assert.equal(novelKey({}), "|");
});

test("novelLabel: 태그를 대괄호로 묶어 한 줄로", () => {
  assert.equal(novelLabel(item("50화", "챌린지", "초고")), "[챌린지 초고] 50화");
  assert.equal(novelLabel({ text: "제목만" }), "제목만");
  assert.equal(novelLabel({ tags: ["챌린지", null], text: "50화" }), "[챌린지] 50화", "빈 태그는 건너뛴다");
});

test("blocksOfCategory: 길이가 0으로 줄어든 블록은 후보에서 빠진다", () => {
  const blocks = [block("a", "집필", 120), block("b", "집필", 0), block("c", "작업", 60)];
  assert.deepEqual(blocksOfCategory(blocks, "집필").map((b) => b.id), ["a"]);
});

// --- 자동 배정 --------------------------------------------------------------

test("같은 성격 블록에 시간순으로 하나씩 채운다", () => {
  const items = [item("50화", "챌린지", "초고"), item("51화", "챌린지", "초고"), item("EP 4", "호위기사", "트리트먼트")];
  assert.deepEqual(assigned(resolveNovelAssignments(BLOCKS, items, NONE)), {
    session1: "50화",
    session2: "51화",
    work: "EP 4",
  });
});

test("블록보다 항목이 많으면 남는 항목은 배정되지 않는다", () => {
  const items = ["A", "B", "C", "D", "E"].map((t) => item(t, "챌린지", "초고"));
  const result = resolveNovelAssignments(BLOCKS, items, NONE);
  assert.deepEqual(assigned(result), { session1: "A", session2: "B", session3: "C" });
  assert.equal(result.size, 3, "집필 블록이 3개뿐이라 D·E는 자리가 없다");
});

test("완료한 항목은 자리를 차지하지 않고 다음 게 당겨진다", () => {
  const items = [
    item("50화", "챌린지", "초고", true), // 완료
    item("51화", "챌린지", "초고"),
    item("52화", "챌린지", "초고"),
  ];
  assert.deepEqual(assigned(resolveNovelAssignments(BLOCKS, items, NONE)), {
    session1: "51화",
    session2: "52화",
  });
});

test("연재 항목은 어느 블록도 차지하지 않는다", () => {
  const items = [item("50화", "챌린지", "연재"), item("51화", "챌린지", "초고")];
  assert.deepEqual(assigned(resolveNovelAssignments(BLOCKS, items, NONE)), { session1: "51화" });
});

// --- 사용자가 지정한 배정 ---------------------------------------------------

test("직접 지정한 배정이 자동 배정보다 먼저다", () => {
  const items = [item("50화", "챌린지", "초고"), item("51화", "챌린지", "초고")];
  const assign = { map: { session3: novelKey(items[0]) }, excluded: [] };
  assert.deepEqual(assigned(resolveNovelAssignments(BLOCKS, items, assign)), {
    session3: "50화", // 지정한 자리로 간다
    session1: "51화", // 남은 항목이 앞에서부터 채워진다
  });
});

test("배정을 해제한 항목은 자동 배정도 되지 않는다", () => {
  // excluded가 없으면 자리를 비우자마자 자동 배정이 같은 항목을 도로 채워버린다.
  const items = [item("50화", "챌린지", "초고"), item("51화", "챌린지", "초고")];
  const assign = { map: {}, excluded: [novelKey(items[0])] };
  assert.deepEqual(assigned(resolveNovelAssignments(BLOCKS, items, assign)), { session1: "51화" });
});

test("이미 사라진 항목을 가리키는 지정은 조용히 무시된다", () => {
  // 노션에서 항목을 지웠는데 배정만 남아 있는 경우.
  const items = [item("51화", "챌린지", "초고")];
  const assign = { map: { session2: "없어진키" }, excluded: [] };
  assert.deepEqual(assigned(resolveNovelAssignments(BLOCKS, items, assign)), { session1: "51화" });
});

test("지정한 블록이 오늘 없으면(요일 제외 등) 그 지정은 버려진다", () => {
  const items = [item("50화", "챌린지", "초고")];
  const assign = { map: { session3: novelKey(items[0]) }, excluded: [] };
  const 오늘블록 = [block("session1", "집필")]; // session3이 오늘은 없다
  assert.deepEqual(assigned(resolveNovelAssignments(오늘블록, items, assign)), { session1: "50화" });
});

test("assign 인자를 생략해도 자동 배정만으로 동작한다", () => {
  const items = [item("50화", "챌린지", "초고")];
  assert.deepEqual(assigned(resolveNovelAssignments(BLOCKS, items)), { session1: "50화" });
});

test("집필과 작업은 서로 자리를 뺏지 않는다", () => {
  const items = [
    item("A", "챌린지", "초고"),
    item("B", "챌린지", "초고"),
    item("C", "챌린지", "초고"),
    item("D", "챌린지", "초고"), // 집필 블록(3개)보다 하나 많다
    item("E", "호위기사", "트리트먼트"),
  ];
  const result = assigned(resolveNovelAssignments(BLOCKS, items, NONE));
  assert.deepEqual(result, { session1: "A", session2: "B", session3: "C", work: "E" });
  assert.equal(Object.values(result).includes("D"), false, "넘친 집필 항목이 작업 블록으로 새면 안 된다");
});
