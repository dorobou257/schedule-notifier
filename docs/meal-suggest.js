// 식단 추천.
//
// 추천이라고 해서 대단한 걸 하지 않는다. 사람이 끼니를 정하기 어려운 이유는
// 후보가 없어서가 아니라 "며칠 전에 뭘 먹었더라"를 기억하기 귀찮아서다.
// 그래서 등록해둔 후보를 오래 안 먹은 순서로 줄 세우는 것이 일의 전부다.
//
// 고르지 "않고" 줄을 세우는 이유: 하나만 돌려주면 마음에 안 들 때 다시 누를
// 수밖에 없는데, 그러면 무작위가 되어야 하고 무작위는 테스트할 수 없다.
// 순위를 주면 화면은 차례로 넘기기만 하면 되고, 규칙은 그대로 고정된다.
//
// DOM도 저장소도 건드리지 않는 순수 함수 모음이다.

/** 최근 며칠 안에 먹은 것은 뒤로 미룬다는 기준(화면 안내 문구와 같은 값). */
export const AVOID_DAYS = 3;

/**
 * 이 끼니로 각 메뉴를 마지막으로 먹은 날짜. 안 먹어본 메뉴는 아예 안 들어간다.
 * @param {Array} history store.mealHistory ([{date, blockId, text}])
 */
function lastEatenByMenu(history, blockId) {
  const map = new Map();
  (history || []).forEach((m) => {
    if (!m || m.blockId !== blockId || !m.text) return;
    const prev = map.get(m.text);
    if (!prev || m.date > prev) map.set(m.text, m.date);
  });
  return map;
}

/**
 * 후보를 추천 순서대로 줄 세운다. 앞에 있을수록 먼저 권한다.
 *
 * 1. 오늘 다른 끼니에 이미 정한 메뉴는 맨 뒤로 — 같은 날 두 번 먹자고 권할 수는 없다.
 * 2. 안 먹어본 메뉴가 먼저. 등록만 해두고 한 번도 안 나온 후보가 계속 묻히면
 *    후보를 등록한 의미가 없다.
 * 3. 그다음은 오래 안 먹은 순.
 * 4. 그래도 같으면 등록한 순서대로 — 결과가 항상 같아야 테스트할 수 있다.
 *
 * 후보를 통째로 빼지 않고 뒤로 미루기만 하는 이유: 뺐다가 목록이 비면 "추천할
 * 게 없다"는 말밖에 못 하는데, 후보가 있는데 아무것도 못 권하는 건 고장으로 보인다.
 *
 * @param {{pool: string[], history: Array, blockId: string, exclude: string[]}} p
 * @returns {string[]} 후보 전체(순서만 바뀐다)
 */
export function rankMeals({ pool = [], history = [], blockId, exclude = [] }) {
  const lastEaten = lastEatenByMenu(history, blockId);
  const excluded = new Set(exclude.filter(Boolean));

  return pool
    .map((menu, index) => ({
      menu,
      index,
      // 안 먹어본 메뉴는 빈 문자열 — 어떤 날짜보다도 앞선다.
      last: lastEaten.get(menu) || "",
      deferred: excluded.has(menu) ? 1 : 0,
    }))
    .sort((a, b) => a.deferred - b.deferred || (a.last < b.last ? -1 : a.last > b.last ? 1 : 0) || a.index - b.index)
    .map((c) => c.menu);
}

/** 가장 먼저 권할 메뉴 하나. 후보가 없으면 null. */
export function suggestMeal(p) {
  return rankMeals(p)[0] || null;
}

/**
 * 이 메뉴를 왜 권하는지 한 줄로. 추천이 납득되지 않으면 그냥 안 쓰게 된다.
 * @param {string} menu
 * @param {{history: Array, blockId: string, dateKey: string}} p
 */
export function reasonFor(menu, { history = [], blockId, dateKey }) {
  const last = lastEatenByMenu(history, blockId).get(menu);
  if (!last) return "아직 한 번도 안 먹은 메뉴예요";
  const days = daysBetween(last, dateKey);
  if (days <= 0) return "오늘 이미 먹은 메뉴예요";
  if (days === 1) return "어제 먹은 메뉴예요";
  return `${days}일 전에 먹었어요`;
}

/** "YYYY-MM-DD" 두 날짜 사이의 일수(from → to). */
export function daysBetween(from, to) {
  const at = (key) => {
    const [y, m, d] = key.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((at(to) - at(from)) / 86400000);
}
