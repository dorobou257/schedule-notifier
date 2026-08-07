// 저장소 테스트. localStorage가 없는 Node에서도 그대로 돌아간다(store.js가
// 읽기·쓰기를 try/catch로 감싸고 있어 기본값으로 떨어진다).
//
// 여기서 진짜 확인하고 싶은 건 migrate의 방어력과 "여러 날에 걸친 롤오버"다.
// 실사용에서 나온 버그가 전부 하루짜리 상태의 전환 지점(저녁에 기록 → 자정 →
// 다음날 → 그다음날)에서만 드러났기 때문에, 그 흐름을 끊지 않고 끝까지 재생한다.
import test from "node:test";
import assert from "node:assert/strict";

import {
  store, setStore, defaultStore, migrate, rolloverIfStale, emptySleep, nextDateKey,
  rememberMeal, shiftDateKey, MEAL_HISTORY_DAYS, activeBlocks, activeBlocksKey,
} from "../docs/store.js";
import { logicalDateKey } from "../docs/routine.js";

/** 로컬 시각으로 Date를 만든다(logicalDateKey가 로컬 시각 기준이라 맞춰준다). */
const at = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min, 0, 0);

function freshStore() {
  setStore(defaultStore());
  return store;
}

// --- migrate: 낡거나 망가진 저장본 ------------------------------------------

test("migrate: 빈 객체/null/이상한 값이 와도 기본 저장소 모양이 나온다", () => {
  for (const bad of [{}, null, undefined, [], "문자열", 42]) {
    const s = migrate(bad);
    assert.equal(s.version, 2);
    assert.equal(typeof s.settings.dayBoundaryHour, "number");
    assert.ok(Array.isArray(s.blocks) && s.blocks.length > 0, `blocks가 살아있어야 한다: ${JSON.stringify(bad)}`);
    assert.deepEqual(s.today, emptySleep());
    assert.deepEqual(s.novelAssign, { date: null, map: {}, excluded: [] });
  }
});

test("migrate: 설정은 병합하고 모르는 키는 그대로 둔다", () => {
  const s = migrate({ settings: { baseWake: "06:30", 미래설정: true } });
  assert.equal(s.settings.baseWake, "06:30", "저장된 값이 이긴다");
  assert.equal(s.settings.dayBoundaryHour, 4, "빠진 값은 기본값으로 채운다");
  assert.equal(s.settings.미래설정, true, "모르는 키를 지우지는 않는다");
});

test("migrate: 빈 blocks 배열은 기본 루틴으로 되돌린다", () => {
  assert.ok(migrate({ version: 2, blocks: [] }).blocks.length > 0);
  assert.ok(migrate({ version: 2, blocks: "블록아님" }).blocks.length > 0);

  const mine = [{ id: "x", name: "내 블록", category: "집필", minutes: 60 }];
  assert.deepEqual(migrate({ version: 2, blocks: mine }).blocks, mine, "내용이 있으면 그대로 쓴다");
});

// --- v1 → v2: 2026년 2학기 개편 ---------------------------------------------

test("v1 저장본은 루틴을 통째로 새것으로 갈아끼운다", () => {
  // 여기서만 "손봐온 루틴은 지킨다"는 원칙을 일부러 어긴다 — 루틴 자체를
  // 갈아엎는 것이 이 마이그레이션의 목적이다.
  const old = {
    version: 1,
    blocks: [{ id: "breakfast", name: "아침 식사", category: "식사", minutes: 60 }],
    settings: { baseWake: "07:30", baseSleep: "00:30", sleepTargetMinutes: 450, dropBreakfastWhenLate: true, semesterMeals: { lunch: "12:00" } },
    mealPool: { breakfast: ["토스트"], lunch: ["김치찌개"], dinner: [] },
    meals: { date: "2026-08-06", byBlockId: { breakfast: "토스트", lunch: "김밥" } },
  };
  const s = migrate(old);

  assert.equal(s.version, 2);
  assert.equal(s.blocks.find((b) => b.id === "breakfast"), undefined, "아침 식사는 사라진다");
  assert.ok(s.blocks.find((b) => b.id === "morning"), "준비 여유가 들어온다");
  assert.ok(Array.isArray(s.semesterBlocks) && s.semesterBlocks.length, "학기 루틴이 생긴다");

  assert.equal(s.settings.baseWake, "07:30", "기상 시각처럼 사용자가 정한 값은 지킨다");
  assert.equal(s.settings.baseSleep, "00:00", "취침과 수면 목표는 새 기준으로 덮는다");
  assert.equal(s.settings.sleepTargetMinutes, 480);
  assert.equal(s.settings.semesterMeals, undefined);
  assert.equal(s.settings.dropBreakfastWhenLate, undefined);

  assert.equal(s.mealPool.breakfast, undefined, "아침 후보 목록도 없앤다");
  assert.deepEqual(s.mealPool.lunch, ["김치찌개"], "나머지 끼니는 그대로");
  assert.equal(s.meals.byBlockId.breakfast, undefined);
  assert.equal(s.meals.byBlockId.lunch, "김밥");
});

test("v1 저장본에 이미 적어둔 시간표·학기는 건드리지 않는다", () => {
  const mine = [{ id: "lec-0-0900", name: "내 강의", days: [0], start: "09:00", minutes: 60 }];
  const s = migrate({ version: 1, lectures: mine, semester: { start: "2026-03-02", end: "2026-06-21" } });
  assert.deepEqual(s.lectures, mine);
  assert.deepEqual(s.semester, { start: "2026-03-02", end: "2026-06-21" });
});

test("v1 저장본에 시간표가 없으면 이번 학기 것을 넣어준다", () => {
  const s = migrate({ version: 1 });
  assert.equal(s.lectures.length, 8, "2026-2학기 여덟 줄");
  assert.deepEqual(s.semester, { start: "2026-08-31", end: "2026-12-18" });
});

test("이미 v2인 저장본은 다시 갈아엎지 않는다", () => {
  const mine = [{ id: "x", name: "내 블록", category: "집필", minutes: 60 }];
  const s = migrate({ version: 2, blocks: mine, settings: { baseSleep: "01:00" } });
  assert.deepEqual(s.blocks, mine);
  assert.equal(s.settings.baseSleep, "01:00", "한 번 지난 마이그레이션이 다시 덮으면 안 된다");
});

test("activeBlocks: 학기 안이면 학기 루틴, 방학이면 방학 루틴", () => {
  setStore(defaultStore());
  assert.equal(activeBlocks("2026-08-20"), store.blocks, "개강 전");
  assert.equal(activeBlocks("2026-08-31"), store.semesterBlocks, "개강일 포함");
  assert.equal(activeBlocks("2026-12-18"), store.semesterBlocks, "종강일 포함");
  assert.equal(activeBlocks("2026-12-19"), store.blocks, "종강 다음날");
  assert.equal(activeBlocksKey("2026-09-07"), "semesterBlocks");
  assert.equal(activeBlocksKey("2026-08-20"), "blocks");
});

test("activeBlocks: 학기 기간을 안 적었으면 방학 루틴", () => {
  setStore({ ...defaultStore(), semester: { start: null, end: null } });
  assert.equal(activeBlocks("2026-09-07"), store.blocks);
});

test("migrate: novelAssign.excluded가 배열이 아니면 빈 배열로 고친다", () => {
  const s = migrate({ novelAssign: { date: "2026-08-06", map: { a: "k" }, excluded: "망가짐" } });
  assert.deepEqual(s.novelAssign, { date: "2026-08-06", map: { a: "k" }, excluded: [] });
});

test("migrate: dayTweaks.categories가 없으면 통째로 기본값", () => {
  assert.deepEqual(migrate({ dayTweaks: { date: "2026-08-06" } }).dayTweaks, {
    date: null,
    categories: {},
    showRoutine: false,
    unpinned: [],
    skippedLectures: [],
  });
});

// --- nextDateKey ------------------------------------------------------------

test("nextDateKey: 월말·연말·윤년을 넘어간다", () => {
  assert.equal(nextDateKey("2026-08-06"), "2026-08-07");
  assert.equal(nextDateKey("2026-08-31"), "2026-09-01");
  assert.equal(nextDateKey("2026-12-31"), "2027-01-01");
  assert.equal(nextDateKey("2028-02-28"), "2028-02-29", "2028은 윤년");
});

// --- 롤오버: 하루를 실제 순서대로 살아본다 ----------------------------------

test("롤오버 시나리오: 저녁 취침 기록 → 자정 → 다음날 적용 → 그다음날 정리", () => {
  const s = freshStore();
  const boundary = s.settings.dayBoundaryHour; // 04:00

  // [8/6 22:00] 저녁에 "오늘 23:30에 잘 것"이라고 기록한다.
  // 취침은 밤에 기록하므로 이 예측이 향하는 건 "내일 아침 기상"이다.
  const bedAt = at(2026, 8, 6, 23, 30);
  s.today = { ...emptySleep(), bedAt: bedAt.toISOString(), forDate: nextDateKey(logicalDateKey(bedAt, boundary)) };
  assert.equal(s.today.forDate, "2026-08-07");

  const evening = at(2026, 8, 6, 22, 0);
  assert.equal(rolloverIfStale(evening), false, "기록한 날 저녁에 사라지면 안 된다");
  assert.equal(store.today.forDate, "2026-08-07");
  assert.equal(store.dayTweaks.date, "2026-08-06", "하루짜리 상태는 오늘 날짜로 초기화된다");

  // [8/7 01:00] 자정을 넘겼지만 경계(04:00) 전이라 논리적으로는 아직 8/6이다.
  // 예전에 실사용에서 터진 지점 — 여기서 지워버리면 기록이 적용되기도 전에 증발한다.
  const afterMidnight = at(2026, 8, 7, 1, 0);
  assert.equal(logicalDateKey(afterMidnight, boundary), "2026-08-06");
  assert.equal(rolloverIfStale(afterMidnight), false, "자정~경계 사이에 취침 기록이 사라지면 안 된다");
  assert.equal(store.today.bedAt, bedAt.toISOString());

  // [8/7 09:00] 경계를 넘겨 논리적 날짜가 forDate와 같아졌다 — 이제 적용 중이다.
  const nextMorning = at(2026, 8, 7, 9, 0);
  assert.equal(logicalDateKey(nextMorning, boundary), "2026-08-07");
  assert.equal(rolloverIfStale(nextMorning), false, "적용되는 날에도 지우면 안 된다");
  assert.equal(store.today.forDate, "2026-08-07");
  assert.equal(store.dayTweaks.date, "2026-08-07", "하루짜리 상태는 새 날짜로 갈렸다");

  // [8/8 09:00] 하루가 더 지났다 — 이제야 낡은 기록이므로 비운다.
  const dayAfter = at(2026, 8, 8, 9, 0);
  assert.equal(rolloverIfStale(dayAfter), true, "지나간 취침 기록은 정리하고 그 사실을 알려준다");
  assert.deepEqual(store.today, emptySleep());
});

test("롤오버: 하루가 바뀌면 오늘만 적용되던 손질과 소설 배정이 비워진다", () => {
  const s = freshStore();
  rolloverIfStale(at(2026, 8, 6, 9, 0));

  // 오늘 하루만 집필→작업으로 바꾸고, 소설 항목을 직접 배정해 둔다.
  s.dayTweaks.categories["session1"] = "작업";
  s.dayTweaks.showRoutine = true;
  s.novelAssign.map["session2"] = "챌린지/초고|50화";
  s.novelAssign.excluded.push("어떤키");

  // 같은 날 안에서는 몇 번을 불러도 유지된다.
  rolloverIfStale(at(2026, 8, 6, 23, 0));
  assert.deepEqual(store.dayTweaks.categories, { session1: "작업" });
  assert.equal(store.dayTweaks.showRoutine, true);
  assert.deepEqual(store.novelAssign.excluded, ["어떤키"]);

  // 다음날이 되면 원래 루틴으로 돌아간다.
  rolloverIfStale(at(2026, 8, 7, 9, 0));
  assert.deepEqual(store.dayTweaks, { date: "2026-08-07", categories: {}, showRoutine: false, unpinned: [], skippedLectures: [] });
  assert.deepEqual(store.novelAssign, { date: "2026-08-07", map: {}, excluded: [] });
});

test("롤오버: 며칠을 건너뛰고 열어도 한 번에 정리된다", () => {
  const s = freshStore();
  const bedAt = at(2026, 8, 1, 23, 0);
  s.today = { ...emptySleep(), bedAt: bedAt.toISOString(), forDate: "2026-08-02" };
  s.dayTweaks = { date: "2026-08-01", categories: { session1: "작업" }, showRoutine: true };

  // 일주일 뒤에 앱을 연다(여행 다녀온 뒤 같은 상황).
  assert.equal(rolloverIfStale(at(2026, 8, 9, 10, 0)), true);
  assert.deepEqual(store.today, emptySleep());
  assert.deepEqual(store.dayTweaks, { date: "2026-08-09", categories: {}, showRoutine: false, unpinned: [], skippedLectures: [] });
});

test("롤오버: 취침 기록이 없으면 아무것도 비웠다고 하지 않는다", () => {
  freshStore();
  assert.equal(rolloverIfStale(at(2026, 8, 6, 9, 0)), false);
  assert.equal(rolloverIfStale(at(2026, 8, 7, 9, 0)), false, "날짜가 바뀌어도 취침 기록이 없으면 false");
});

test("롤오버: 경계 시각을 바꾸면 하루가 갈리는 지점도 함께 움직인다", () => {
  const s = freshStore();
  s.settings.dayBoundaryHour = 6;
  s.today = { ...emptySleep(), bedAt: at(2026, 8, 6, 23, 0).toISOString(), forDate: "2026-08-07" };

  // 05:00은 경계(06:00) 전이므로 아직 8/6이다.
  assert.equal(rolloverIfStale(at(2026, 8, 7, 5, 0)), false);
  assert.equal(store.dayTweaks.date, "2026-08-06");

  // 07:00이면 8/7로 넘어간다 — forDate와 같아지므로 아직 비우지 않는다.
  assert.equal(rolloverIfStale(at(2026, 8, 7, 7, 0)), false);
  assert.equal(store.dayTweaks.date, "2026-08-07");
});

// --- 오늘만 시각 고정 해제 -------------------------------------------------

test("migrate: unpinned가 없거나 배열이 아니면 빈 배열로 채운다", () => {
  assert.deepEqual(migrate({}).dayTweaks.unpinned, []);
  assert.deepEqual(migrate({ dayTweaks: { categories: {}, unpinned: "망가짐" } }).dayTweaks.unpinned, []);
  assert.deepEqual(migrate({ dayTweaks: { categories: {}, unpinned: ["lunch"] } }).dayTweaks.unpinned, ["lunch"]);
});

test("롤오버: 오늘만 푼 시각 고정도 다음날이면 원래대로 돌아온다", () => {
  const s = freshStore();
  rolloverIfStale(at(2026, 8, 6, 9, 0));
  s.dayTweaks.unpinned.push("lunch", "lec1");

  // 같은 날 안에서는 유지된다 — 하루 종일 옮겨둔 점심이 저녁에 되돌아가면 곤란하다.
  rolloverIfStale(at(2026, 8, 6, 23, 0));
  assert.deepEqual(store.dayTweaks.unpinned, ["lunch", "lec1"]);

  rolloverIfStale(at(2026, 8, 7, 9, 0));
  assert.deepEqual(store.dayTweaks.unpinned, [], "내일은 강의도 점심도 제 시각으로");
});

// --- 식단 -------------------------------------------------------------------

test("shiftDateKey: 앞뒤로 옮기고 월·연 경계를 넘는다", () => {
  assert.equal(shiftDateKey("2026-08-06", 1), "2026-08-07");
  assert.equal(shiftDateKey("2026-08-06", -3), "2026-08-03");
  assert.equal(shiftDateKey("2026-09-01", -1), "2026-08-31");
  assert.equal(shiftDateKey("2027-01-01", -1), "2026-12-31");
});

test("migrate: 식단 필드가 없는 옛 저장본도 안전하게 채운다", () => {
  const s = migrate({});
  assert.deepEqual(s.mealPool, { lunch: [], dinner: [] });
  assert.deepEqual(s.meals, { date: null, byBlockId: {} });
  assert.deepEqual(s.mealHistory, []);
});

test("migrate: 후보 목록에서 문자열이 아닌 것과 빈 값을 걸러낸다", () => {
  const s = migrate({ mealPool: { lunch: ["김치찌개", "", "  ", 42, null, "된장찌개"], dinner: "배열아님" } });
  assert.deepEqual(s.mealPool.lunch, ["김치찌개", "된장찌개"]);
  assert.deepEqual(s.mealPool.dinner, []);
});

test("migrate: 망가진 식사 기록 항목은 버린다", () => {
  const s = migrate({
    mealHistory: [
      { date: "2026-08-05", blockId: "lunch", text: "김치찌개" },
      { date: 20260805, blockId: "lunch", text: "숫자날짜" },
      { date: "2026-08-04", blockId: "lunch" },
      null,
    ],
  });
  assert.deepEqual(s.mealHistory.map((m) => m.text), ["김치찌개"]);
});

test("롤오버: 오늘의 식단은 날짜가 바뀌면 비우되 기록은 남긴다", () => {
  const s = freshStore();
  rolloverIfStale(at(2026, 8, 6, 9, 0));
  s.meals.byBlockId.lunch = "김치찌개";
  rememberMeal("2026-08-06", "lunch", "김치찌개");

  rolloverIfStale(at(2026, 8, 6, 22, 0));
  assert.equal(store.meals.byBlockId.lunch, "김치찌개", "같은 날엔 그대로");

  rolloverIfStale(at(2026, 8, 7, 9, 0));
  assert.deepEqual(store.meals, { date: "2026-08-07", byBlockId: {} }, "다음날 화면은 비운다");
  assert.deepEqual(
    store.mealHistory.map((m) => m.text),
    ["김치찌개"],
    "무엇을 먹었는지는 남아야 중복 추천을 피할 수 있다"
  );
});

test("rememberMeal: 같은 날 같은 끼니는 덮어쓰고, 비우면 지운다", () => {
  freshStore();
  rememberMeal("2026-08-06", "lunch", "김치찌개");
  rememberMeal("2026-08-06", "lunch", "된장찌개");
  assert.deepEqual(store.mealHistory.map((m) => m.text), ["된장찌개"]);

  rememberMeal("2026-08-06", "dinner", "제육볶음");
  assert.equal(store.mealHistory.length, 2, "다른 끼니는 따로 쌓인다");

  rememberMeal("2026-08-06", "lunch", "");
  assert.deepEqual(store.mealHistory.map((m) => m.text), ["제육볶음"], "비우면 기록도 지운다");
});

test("rememberMeal: 오래된 기록은 알아서 버린다", () => {
  freshStore();
  const today = "2026-08-20";
  rememberMeal(shiftDateKey(today, -(MEAL_HISTORY_DAYS + 5)), "lunch", "아주 옛날");
  rememberMeal(shiftDateKey(today, -(MEAL_HISTORY_DAYS - 1)), "dinner", "아슬아슬");
  rememberMeal(today, "breakfast", "오늘");

  const texts = store.mealHistory.map((m) => m.text);
  assert.equal(texts.includes("아주 옛날"), false, `${MEAL_HISTORY_DAYS}일보다 오래된 건 버린다`);
  assert.deepEqual(texts, ["아슬아슬", "오늘"]);
});
