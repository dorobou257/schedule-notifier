// 빈 구간(gap)에 유동 블록을 배분하는 규칙.
//
// 요일별 최종 표는 lectures.test.mjs가 통째로 못 박는다. 여기서는 그 표를
// 만들어내는 규칙 하나하나를 따로 떼어 확인한다 — 표가 깨졌을 때 어느 규칙이
// 무너졌는지 바로 알 수 있게.
import test from "node:test";
import assert from "node:assert/strict";

import { placeIntoGaps } from "../docs/placement.js";
import { hhmmToBoundaryMinutes as at } from "../docs/routine.js";

const MON = 0;

const block = (id, category, minutes, extra = {}) => ({ id, name: id, category, minutes, minMinutes: 0, ...extra });
const anchor = (id, category, hhmm, minutes) => ({
  id,
  name: id,
  category,
  minutes,
  minMinutes: minutes,
  protected: true,
  anchor: "clock",
  fixedAt: at(hhmm),
});
const lecture = (id, hhmm, minutes) => ({ ...anchor(id, "강의", hhmm, minutes), days: [MON] });

const WAKE = { id: "wake", name: "기상", category: "기타", minutes: 0, anchor: "wake", protected: true };
const SLEEP = { id: "sleep", name: "취침", category: "기타", minutes: 0, anchor: "sleep", fixedAt: at("00:00"), protected: true };

/** 기본 골격 — 준비 여유 · 점심 12시 · 저녁 6시 · 운동 9시 · 취침 자정. */
function skeleton(middle = [], { exercise = true } = {}) {
  return [
    WAKE,
    block("morning", "여유", 60, { minMinutes: 60, prep: true }),
    ...middle,
    anchor("lunch", "식사", "12:00", 60),
    anchor("dinner", "식사", "18:00", 60),
    ...(exercise ? [anchor("exercise", "운동", "21:00", 60)] : []),
    block("rest", "여유", 60),
    SLEEP,
  ];
}

function run(blocks, lectures = [], wake = "08:00") {
  const r = placeIntoGaps({ blocks, lectures, weekday: MON, wakeMinutes: at(wake) });
  return {
    displaced: r.displaced,
    minutes: Object.fromEntries(r.blocks.map((b) => [b.id, b.minutes])),
    order: r.blocks.map((b) => b.id),
  };
}

// --- 규칙 2: 첫 gap은 준비 시간 --------------------------------------------

test("첫 gap이 강의로 끝나면 그 사이 전체가 준비 시간이다", () => {
  // 금요일이 이 경우다 — 10시 강의라 08:00~10:00이 통째로 준비 시간.
  const r = run(skeleton([block("write", "집필", 120, { minMinutes: 60 })]), [lecture("lec", "10:00", 120)]);
  assert.equal(r.minutes.morning, 120);
  assert.equal(r.displaced.has("write"), false, "집필은 다른 자리를 찾는다");
});

test("첫 gap이 루틴 앵커로 끝나면 준비 시간 한 시간만 떼고 나머지를 연다", () => {
  const r = run(skeleton([block("write", "집필", 120, { minMinutes: 60 })]));
  assert.equal(r.minutes.morning, 60, "08:00~09:00");
  assert.equal(r.minutes.write, 120, "09:00~11:00 — 남은 세 시간 중 두 시간을 집필이 쓴다");
});

test("첫 gap에는 집필이 들어와도 준비 시간보다 앞서지 않는다", () => {
  const r = run(skeleton([block("write", "집필", 120, { minMinutes: 60 })]));
  assert.ok(r.order.indexOf("morning") < r.order.indexOf("write"));
});

// --- 규칙 3: 집필·작업은 저녁 이전으로 최대한 앞당긴다 ----------------------

test("통째로 들어가는 가장 이른 자리를 고른다", () => {
  const r = run(skeleton([block("write", "집필", 120, { minMinutes: 60 })]), [lecture("lec", "09:00", 180)]);
  // 08~09는 준비 시간, 09~12는 강의, 13~18이 첫 빈자리다.
  assert.equal(r.minutes.write, 120);
  assert.ok(r.order.indexOf("lunch") < r.order.indexOf("write"));
});

test("통째로는 안 들어가면 minMinutes 이상 남은 가장 이른 자리에 줄여 넣는다", () => {
  // 13~16 강의로 오후가 한 시간(17~18)만 남는다.
  const blocks = skeleton([block("work", "작업", 120, { minMinutes: 30 })]);
  const r = run(blocks, [lecture("am", "09:00", 180), lecture("pm", "13:00", 240)]);
  assert.equal(r.minutes.work, 60, "17:00~18:00 한 시간으로 줄여서라도 앞에 넣는다");
  assert.equal(r.displaced.has("work"), false);
});

test("저녁 이전을 다 훑고 나서야 저녁 이후를 쓴다", () => {
  // 줄여서 앞에 넣을 수 있으면 저녁 뒤로 미루지 않는다.
  const blocks = skeleton([block("work", "작업", 120, { minMinutes: 30 })]);
  const r = run(blocks, [lecture("am", "09:00", 180), lecture("pm", "13:00", 240)]);
  assert.ok(r.order.indexOf("work") < r.order.indexOf("dinner"));
});

test("저녁 이전에 자리가 없으면 저녁~운동 사이를 쓴다", () => {
  const blocks = skeleton([block("work", "작업", 120, { minMinutes: 120 })]);
  const r = run(blocks, [lecture("am", "09:00", 180), lecture("pm", "13:00", 300)]);
  assert.equal(r.minutes.work, 120);
  assert.ok(r.order.indexOf("dinner") < r.order.indexOf("work"), "저녁 뒤로 밀린다");
  assert.ok(r.order.indexOf("work") < r.order.indexOf("exercise"), "운동 앞까지만");
});

test("운동 시각 이후는 어떤 경우에도 쓰지 않는다 — 자리가 없으면 그날에서 뺀다", () => {
  // 저녁~운동 사이(19~21)보다 긴 블록. 밤 22시 이후를 쓰면 들어가지만 쓰지 않는다.
  const blocks = skeleton([block("work", "작업", 180, { minMinutes: 180 })]);
  const r = run(blocks, [lecture("am", "09:00", 180), lecture("pm", "13:00", 300)]);
  assert.equal(r.displaced.has("work"), true);
  assert.equal(r.minutes.work, undefined, "결과 배열에서 아예 빠진다");
});

test("운동이 없는 날에도 밤의 시작은 운동 시각 그대로다", () => {
  // 운동을 안 하는 날이라고 밤 열한 시에 작업을 얹지는 않는다.
  const withExercise = skeleton([block("work", "작업", 180, { minMinutes: 180 })]);
  const without = withExercise.filter((b) => b.id !== "exercise");
  const lectures = [lecture("am", "09:00", 180), lecture("pm", "13:00", 300)];
  // 운동 앵커는 요일 필터로 빠져도 루틴 배열에는 남아 있다 — 그 시각이 기준이다.
  const r = placeIntoGaps({
    blocks: withExercise.map((b) => (b.id === "exercise" ? { ...b, days: [1] } : b)),
    lectures,
    weekday: MON,
    wakeMinutes: at("08:00"),
  });
  assert.equal(r.displaced.has("work"), true);
  assert.equal(without.length, withExercise.length - 1);
});

test("배열에서 저녁보다 뒤에 놓인 집필은 저녁 이후를 먼저 본다", () => {
  // 방학 3차 집필이 이 경우다 — 오전에 한 시간 남았어도 저녁 뒤 두 시간을 고른다.
  const blocks = [
    WAKE,
    block("morning", "여유", 60, { minMinutes: 60, prep: true }),
    block("s1", "집필", 120, { minMinutes: 60 }),
    block("gap", "여유", 60),
    anchor("lunch", "식사", "12:00", 60),
    anchor("dinner", "식사", "18:00", 60),
    block("s3", "집필", 120, { minMinutes: 60 }),
    anchor("exercise", "운동", "21:00", 60),
    block("rest", "여유", 60),
    SLEEP,
  ];
  const r = run(blocks);
  assert.equal(r.minutes.s3, 120);
  assert.ok(r.order.indexOf("dinner") < r.order.indexOf("s3"), "19:00~21:00");
});

// --- 규칙 4·5: 여유 ---------------------------------------------------------

test("여유는 바로 앞 블록이 들어간 자리의 남은 시간을 흡수한다", () => {
  const blocks = skeleton([block("write", "집필", 120, { minMinutes: 60 }), block("gap", "여유", 60)]);
  const r = run(blocks);
  assert.equal(r.minutes.morning + r.minutes.write + r.minutes.gap, 240, "08:00~12:00을 정확히 채운다");
  assert.equal(r.minutes.gap, 60);
});

test("여유가 하나도 없는 빈 자리가 남으면 남는 여유를 그리로 옮긴다", () => {
  // 학기 화요일 17:00~18:00이 이 경우다. 오전 여유는 자기 자리에 남을 시간이
  // 없어(강의가 다 가져갔다) 통째로 빈 구간으로 옮겨간다.
  const blocks = [
    WAKE,
    block("morning", "여유", 60, { minMinutes: 60, prep: true }),
    block("write", "집필", 120, { minMinutes: 60 }),
    block("gap", "여유", 60),
    anchor("lunch", "식사", "12:00", 60),
    block("work", "작업", 120, { minMinutes: 30 }),
    anchor("dinner", "식사", "18:00", 60),
    block("rest", "여유", 60),
    SLEEP,
  ];
  const r = run(blocks, [lecture("am", "09:00", 180), lecture("pm", "16:00", 60)]);
  // 13~16이 집필 2시간 + 작업 1시간으로 꽉 차서 오전 여유가 갈 곳을 잃는다.
  assert.equal(r.minutes.write, 120);
  assert.equal(r.minutes.work, 60);
  assert.equal(r.minutes.gap, 60, "17:00~18:00을 채운다");
  assert.ok(r.order.indexOf("pm") < r.order.indexOf("gap"));
  assert.ok(r.order.indexOf("gap") < r.order.indexOf("dinner"));
});

test("같은 자리에서 서로 붙은 여유는 하나로 합친다", () => {
  const blocks = [
    WAKE,
    block("morning", "여유", 60, { minMinutes: 60, prep: true }),
    block("gap", "여유", 60),
    anchor("lunch", "식사", "12:00", 60),
    block("gap2", "여유", 60),
    anchor("dinner", "식사", "18:00", 60),
    block("rest", "여유", 60),
    block("rest2", "여유", 60),
    SLEEP,
  ];
  const r = run(blocks);
  assert.equal(r.minutes.rest, 300, "18:00 이후 다섯 시간이 한 덩어리가 된다");
  assert.equal(r.minutes.rest2, undefined, "뒤 블록은 앞 블록에 흡수된다");
  assert.equal(r.minutes.gap, 180, "09:00~12:00");
  assert.equal(r.minutes.gap2, 300, "13:00~18:00");
});

test("준비 시간은 뒤따르는 여유와 합쳐지지 않는다", () => {
  // 하루의 시작을 따로 보여주는 편이 낫다.
  const blocks = skeleton([block("gap", "여유", 60)]);
  const r = run(blocks);
  assert.equal(r.minutes.morning, 60);
  assert.equal(r.minutes.gap, 180, "09:00~12:00");
});

// --- 규칙 6 및 기타 ---------------------------------------------------------

test("한 자리 안에서는 준비 → 집필·작업 → 여유 순서다", () => {
  const blocks = skeleton([
    block("gap", "여유", 60),
    block("write", "집필", 60, { minMinutes: 60 }),
    block("work", "작업", 60, { minMinutes: 60 }),
  ]);
  const r = run(blocks);
  const i = (id) => r.order.indexOf(id);
  assert.ok(i("morning") < i("write"));
  assert.ok(i("write") < i("work"), "배열 순서대로");
  assert.ok(i("work") < i("gap"), "여유는 맨 뒤");
});

test("호출자의 블록 배열을 변형하지 않는다", () => {
  const blocks = skeleton([block("write", "집필", 120, { minMinutes: 60 })]);
  const before = JSON.stringify(blocks);
  run(blocks, [lecture("am", "09:00", 180)]);
  assert.equal(JSON.stringify(blocks), before);
});

test("결과 블록에는 내부 상태(gap)가 새어 나오지 않는다", () => {
  const r = placeIntoGaps({
    blocks: skeleton([block("write", "집필", 120, { minMinutes: 60 })]),
    lectures: [],
    weekday: MON,
    wakeMinutes: at("08:00"),
  });
  for (const b of r.blocks) assert.equal(b.gap, undefined);
  assert.doesNotThrow(() => JSON.stringify(r.blocks), "순환 참조가 없어야 직렬화된다");
});

test("오늘 요일이 아닌 블록과 강의는 애초에 빠진다", () => {
  const blocks = skeleton([block("write", "집필", 120, { minMinutes: 60, days: [1] })]);
  const r = run(blocks, [{ ...lecture("lec", "09:00", 180), days: [1] }]);
  assert.equal(r.minutes.write, undefined);
  assert.equal(r.minutes.lec, undefined);
  assert.equal(r.displaced.size, 0, "요일이 아니라서 없는 것은 밀려난 게 아니다");
});
