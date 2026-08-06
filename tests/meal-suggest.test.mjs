// 식단 추천. 규칙이 몇 줄 안 되지만, 틀려도 "그냥 좀 이상한 추천"으로만 보여서
// 눈으로는 절대 안 잡힌다 — 어제 먹은 걸 또 권해도 화면은 멀쩡하다.
import test from "node:test";
import assert from "node:assert/strict";

import { rankMeals, suggestMeal, reasonFor, daysBetween, AVOID_DAYS } from "../docs/meal-suggest.js";

const 후보 = ["김치찌개", "된장찌개", "제육볶음", "카레"];

/** 며칠 전에 먹었는지로 기록을 만든다(오늘은 2026-08-06). */
const 오늘 = "2026-08-06";
const 며칠전 = (n) => {
  const d = new Date(Date.UTC(2026, 7, 6 - n));
  return d.toISOString().slice(0, 10);
};
const 먹음 = (menu, daysAgo, blockId = "lunch") => ({ date: 며칠전(daysAgo), blockId, text: menu });

test("후보가 없으면 권할 것도 없다", () => {
  assert.deepEqual(rankMeals({ pool: [], blockId: "lunch" }), []);
  assert.equal(suggestMeal({ pool: [], blockId: "lunch" }), null);
});

test("기록이 없으면 등록한 순서 그대로", () => {
  assert.deepEqual(rankMeals({ pool: 후보, blockId: "lunch" }), 후보);
});

test("안 먹어본 메뉴를 먼저 권한다", () => {
  // 등록만 해두고 한 번도 안 나온 후보가 계속 묻히면 등록한 의미가 없다.
  const history = [먹음("김치찌개", 1), 먹음("된장찌개", 2)];
  assert.deepEqual(rankMeals({ pool: 후보, history, blockId: "lunch" }), [
    "제육볶음",
    "카레",
    "된장찌개",
    "김치찌개",
  ]);
});

test("먹어본 것끼리는 오래된 순", () => {
  const history = [먹음("김치찌개", 1), 먹음("된장찌개", 9), 먹음("제육볶음", 4), 먹음("카레", 2)];
  assert.deepEqual(rankMeals({ pool: 후보, history, blockId: "lunch" }), [
    "된장찌개",
    "제육볶음",
    "카레",
    "김치찌개",
  ]);
});

test("같은 메뉴를 여러 번 먹었으면 가장 최근 날짜로 센다", () => {
  // 열흘 전에도 먹고 어제도 먹었으면 "오래 안 먹은 메뉴"가 아니다.
  const history = [먹음("김치찌개", 10), 먹음("김치찌개", 1), 먹음("된장찌개", 5)];
  const ranked = rankMeals({ pool: ["김치찌개", "된장찌개"], history, blockId: "lunch" });
  assert.deepEqual(ranked, ["된장찌개", "김치찌개"]);
});

test("다른 끼니의 기록은 섞이지 않는다", () => {
  // 저녁에 김치찌개를 먹었다고 점심 추천이 달라지면 안 된다(후보 목록도 따로다).
  const history = [먹음("김치찌개", 1, "dinner")];
  assert.deepEqual(rankMeals({ pool: ["김치찌개", "카레"], history, blockId: "lunch" }), ["김치찌개", "카레"]);
});

test("오늘 다른 끼니에 정한 메뉴는 맨 뒤로 밀린다", () => {
  // 같은 날 두 번 먹자고 권할 수는 없다. 다만 목록에서 빼지는 않는다 —
  // 후보가 있는데 아무것도 못 권하면 고장으로 보인다.
  const ranked = rankMeals({ pool: ["김치찌개", "카레"], blockId: "lunch", exclude: ["김치찌개"] });
  assert.deepEqual(ranked, ["카레", "김치찌개"]);

  const only = rankMeals({ pool: ["김치찌개"], blockId: "lunch", exclude: ["김치찌개"] });
  assert.deepEqual(only, ["김치찌개"], "하나뿐이면 그거라도 권한다");
});

test("밀어낸 것끼리도 오래된 순은 지킨다", () => {
  const history = [먹음("김치찌개", 1), 먹음("카레", 8)];
  const ranked = rankMeals({ pool: ["김치찌개", "카레"], history, blockId: "lunch", exclude: ["김치찌개", "카레"] });
  assert.deepEqual(ranked, ["카레", "김치찌개"]);
});

test("망가진 기록이 섞여도 죽지 않는다", () => {
  // 백업 파일을 손으로 고쳤거나 예전 버전이 남긴 항목이 들어올 수 있다.
  const history = [null, {}, { blockId: "lunch" }, 먹음("김치찌개", 1)];
  assert.deepEqual(rankMeals({ pool: ["김치찌개", "카레"], history, blockId: "lunch" }), ["카레", "김치찌개"]);
});

test("같은 입력이면 언제나 같은 순서 — 무작위가 아니다", () => {
  const history = [먹음("김치찌개", 3), 먹음("카레", 3)];
  const once = rankMeals({ pool: 후보, history, blockId: "lunch" });
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(rankMeals({ pool: 후보, history, blockId: "lunch" }), once);
  }
});

// --- 왜 권하는지 --------------------------------------------------------------

test("추천 이유를 사람 말로 알려준다", () => {
  const history = [먹음("김치찌개", 1), 먹음("카레", 5), 먹음("제육볶음", 0)];
  const ctx = { history, blockId: "lunch", dateKey: 오늘 };
  assert.equal(reasonFor("된장찌개", ctx), "아직 한 번도 안 먹은 메뉴예요");
  assert.equal(reasonFor("김치찌개", ctx), "어제 먹은 메뉴예요");
  assert.equal(reasonFor("카레", ctx), "5일 전에 먹었어요");
  assert.equal(reasonFor("제육볶음", ctx), "오늘 이미 먹은 메뉴예요");
});

test("daysBetween은 달과 해를 넘어도 센다", () => {
  assert.equal(daysBetween("2026-08-05", "2026-08-06"), 1);
  assert.equal(daysBetween("2026-07-31", "2026-08-01"), 1);
  assert.equal(daysBetween("2025-12-31", "2026-01-01"), 1);
  assert.equal(daysBetween("2026-08-06", "2026-08-06"), 0);
});

test("AVOID_DAYS는 화면 안내와 같은 값이어야 한다", () => {
  // 화면은 "최근 N일 안에 먹은 메뉴"라고 적는다. 두 값이 갈라지면 거짓말이 된다.
  assert.equal(AVOID_DAYS, 3);
});
