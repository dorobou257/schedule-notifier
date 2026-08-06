// 저장소 테스트. localStorage가 없는 Node에서도 그대로 돌아간다(store.js가
// 읽기·쓰기를 try/catch로 감싸고 있어 기본값으로 떨어진다).
//
// 여기서 진짜 확인하고 싶은 건 migrate의 방어력과 "여러 날에 걸친 롤오버"다.
// 실사용에서 나온 버그가 전부 하루짜리 상태의 전환 지점(저녁에 기록 → 자정 →
// 다음날 → 그다음날)에서만 드러났기 때문에, 그 흐름을 끊지 않고 끝까지 재생한다.
import test from "node:test";
import assert from "node:assert/strict";

import { store, setStore, defaultStore, migrate, rolloverIfStale, emptySleep, nextDateKey } from "../docs/store.js";
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
    assert.equal(s.version, 1);
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
  assert.ok(migrate({ blocks: [] }).blocks.length > 0);
  assert.ok(migrate({ blocks: "블록아님" }).blocks.length > 0);

  const mine = [{ id: "x", name: "내 블록", category: "집필", minutes: 60 }];
  assert.deepEqual(migrate({ blocks: mine }).blocks, mine, "내용이 있으면 그대로 쓴다");
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
  assert.deepEqual(store.dayTweaks, { date: "2026-08-07", categories: {}, showRoutine: false, unpinned: [] });
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
  assert.deepEqual(store.dayTweaks, { date: "2026-08-09", categories: {}, showRoutine: false, unpinned: [] });
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
