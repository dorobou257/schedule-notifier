// 목록 제스처 — 노션식 드래그 재배열과 꾹 누르기.
//
// DOM 전용 모듈이다(테스트 없음). app.js에서 떼어낸 이유는 렌더링 코드와 섞여
// 있으면 둘 다 읽기 어려워서다. 화면 쪽이 알아야 하는 건 "지금 드래그 중인가"
// 뿐이라 isDragging()만 내보낸다.

// 드래그가 진행 중인 동안엔 1분 틱의 자동 렌더를 멈춰야 한다. 잡고 있던 요소가
// 통째로 사라지면 드래그가 끊기기 때문이다(app.js의 updateNowCard 참고).
let dragActive = false;
export function isDragging() {
  return dragActive;
}

export const REDUCED_MOTION = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** 짧은 진동 피드백. 지원하지 않는 브라우저(iOS Safari 등)에서는 조용히 무시된다. */
export function buzz(ms) {
  if (REDUCED_MOTION()) return;
  try {
    navigator.vibrate?.(ms);
  } catch {}
}

/** el에서 위로 올라가며 실제로 세로 스크롤되는 조상을 찾는다. 없으면 문서 스크롤. */
function scrollParentOf(el) {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return document.scrollingElement || document.documentElement;
}

// 순서 편집이 아닐 때의 "꾹 누르기". 드래그(300ms)보다 조금 길게 잡아
// 실수로 발동하지 않게 한다. 8px 넘게 움직이면 스크롤로 보고 취소.
//
// skipSelector에 걸리는 것(체크박스·버튼 등)에서 시작한 누름은 무시한다.
// 그 위에서 꾹 누르면 시트가 열리는 동시에 손을 뗄 때 그 컨트롤까지 눌린다.
export function enableLongPress(listEl, itemSelector, onLongPress, skipSelector) {
  let target = null;
  let startY = 0;
  let timer = null;
  let pointerId = null;

  function cancel() {
    clearTimeout(timer);
    if (target) target.classList.remove("pressing");
    target = null;
  }

  listEl.addEventListener("pointerdown", (e) => {
    if (target) return;
    if (skipSelector && e.target.closest(skipSelector)) return;
    const li = e.target.closest(itemSelector);
    if (!li || !listEl.contains(li)) return;
    target = li;
    startY = e.clientY;
    pointerId = e.pointerId;
    li.classList.add("pressing");
    timer = setTimeout(() => {
      const hit = target;
      target = null;
      hit.classList.remove("pressing");
      buzz(12);
      onLongPress(hit);
    }, 450);
  });

  listEl.addEventListener("pointermove", (e) => {
    if (target && e.pointerId === pointerId && Math.abs(e.clientY - startY) > 8) cancel();
  });
  listEl.addEventListener("pointerup", cancel);
  listEl.addEventListener("pointercancel", cancel);
}

// 노션식 드래그 재배열: 300ms 길게 누르면 드래그 모드로 들어가고,
// 그 전에 놓거나 8px 넘게 움직이면 각각 "탭"/"스크롤"로 취급한다.
// 매 이동마다 전체를 다시 그리지 않고 transform과 필요할 때만의
// insertBefore 한 번으로 처리해 화면이 가볍게 반응하도록 한다.
//
// itemSelector로 드래그 대상 요소를 지정한다(루틴 편집 시트는 li.block-item,
// 메인 화면 "오늘 하루"는 li.agenda__row). data-fixed="1"인 항목은 잡을 수도
// 없고 다른 항목이 그 자리를 넘어갈 수도 없는 "벽"으로 동작한다 — 점심(시각
// 고정)이나 기상/취침처럼 하루의 뼈대를 이루는 블록을 위한 장치다.
export function enableDragReorder(listEl, onReorder, onTap, itemSelector = "li.block-item") {
  let dragEl = null;
  let startY = 0; // 이 값을 기준으로 translateY를 계산한다(스왑 때마다 레이아웃 이동량만큼 보정)
  let pressTimer = null;
  let dragging = false;
  let pointerId = null;
  let lastY = 0;
  let originalOrder = null; // pointercancel 때 되돌리기 위한 스냅샷
  let autoScrollRaf = null;

  const items = () => Array.from(listEl.querySelectorAll(itemSelector));
  const movable = (li) => li.dataset.fixed !== "1";

  /** FLIP: 레이아웃이 바뀐 형제들이 새 자리로 미끄러져 가는 것처럼 보이게 한다. */
  function flip(measured) {
    if (REDUCED_MOTION()) return;
    for (const [el, prevTop] of measured) {
      const delta = prevTop - el.getBoundingClientRect().top;
      if (!delta) continue;
      el.animate([{ transform: `translateY(${delta}px)` }, { transform: "none" }], {
        duration: 180,
        easing: "cubic-bezier(.2,.8,.2,1)",
      });
    }
  }

  function stopAutoScroll() {
    if (autoScrollRaf) cancelAnimationFrame(autoScrollRaf);
    autoScrollRaf = null;
  }

  // 손가락이 스크롤 영역의 위/아래 끝에 닿아 있는 동안 리스트를 계속 굴려준다.
  // 이게 없으면 화면 밖으로 블록을 옮길 방법이 없다.
  function autoScroll() {
    autoScrollRaf = null;
    if (!dragging || !dragEl) return;
    const sp = scrollParentOf(dragEl);
    const isDoc = sp === document.scrollingElement || sp === document.documentElement;
    const top = isDoc ? 0 : sp.getBoundingClientRect().top;
    const bottom = isDoc ? window.innerHeight : sp.getBoundingClientRect().bottom;
    const EDGE = 48;
    const STEP = 7; // 프레임당 px ≈ 초당 400px
    let dy = 0;
    if (lastY < top + EDGE) dy = -STEP;
    else if (lastY > bottom - EDGE) dy = STEP;
    if (dy) {
      const before = sp.scrollTop;
      sp.scrollTop += dy;
      // 실제로 스크롤된 만큼만 기준점을 옮겨야 블록이 손가락에 붙어 있다.
      startY -= sp.scrollTop - before;
      applyTransform();
      reorderAt(lastY);
    }
    autoScrollRaf = requestAnimationFrame(autoScroll);
  }

  function applyTransform() {
    dragEl.style.transform = `translateY(${lastY - startY}px) scale(1.03)`;
  }

  /** 포인터 y좌표를 기준으로 필요하면 이웃과 자리를 바꾼다. */
  function reorderAt(clientY) {
    for (const sib of items()) {
      if (sib === dragEl) continue;
      const r = sib.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      const dragIsBefore = !!(dragEl.compareDocumentPosition(sib) & Node.DOCUMENT_POSITION_FOLLOWING);
      const crossing = (clientY > mid && dragIsBefore) || (clientY < mid && !dragIsBefore);
      if (!crossing) continue;
      // 고정 항목은 넘어갈 수 없다 — 여기서 멈춘다.
      if (!movable(sib)) break;

      const measured = items()
        .filter((x) => x !== dragEl)
        .map((x) => [x, x.getBoundingClientRect().top]);
      const prevOffsetTop = dragEl.offsetTop;

      listEl.insertBefore(dragEl, clientY > mid ? sib.nextSibling : sib);

      // 스왑으로 dragEl 자신의 레이아웃 위치가 바뀐 만큼 기준점을 보정한다.
      // (예전 코드는 startY = clientY로 리셋해서 블록 높이가 다르면 손가락과
      //  블록이 어긋났다. offsetTop은 transform의 영향을 받지 않아 안전하다.)
      startY += dragEl.offsetTop - prevOffsetTop;
      applyTransform();
      flip(measured);
      buzz(6);
      break;
    }
  }

  function cleanupVisual() {
    dragActive = false;
    listEl.classList.remove("is-dragging");
    stopAutoScroll();
    if (!dragEl) return;
    dragEl.classList.remove("pressing");
    dragEl.classList.remove("dragging");
    dragEl.style.transform = "";
  }

  listEl.addEventListener("pointerdown", (e) => {
    if (dragEl) return; // 드래그 중 두 번째 손가락은 무시
    const li = e.target.closest(itemSelector);
    if (!li || !listEl.contains(li) || !movable(li)) return;
    dragEl = li;
    startY = lastY = e.clientY;
    pointerId = e.pointerId;
    dragging = false;
    dragEl.classList.add("pressing");
    pressTimer = setTimeout(() => {
      dragging = true;
      dragActive = true;
      originalOrder = items();
      dragEl.classList.remove("pressing");
      dragEl.classList.add("dragging");
      listEl.classList.add("is-dragging");
      dragEl.style.transform = "scale(1.03)";
      buzz(12);
      try {
        dragEl.setPointerCapture(pointerId);
      } catch {}
    }, 300);
  });

  // 비패시브 touchmove — pointermove의 preventDefault로는 이미 시작된 네이티브
  // 스크롤/새로고침 제스처를 취소할 수 없다. 드래그는 300ms 정지 후 시작되므로
  // 이 시점엔 아직 스크롤이 시작되지 않아 여기서 확실히 막을 수 있다.
  listEl.addEventListener(
    "touchmove",
    (e) => {
      if (dragging) e.preventDefault();
    },
    { passive: false }
  );

  listEl.addEventListener("pointermove", (e) => {
    if (!dragEl || e.pointerId !== pointerId) return;
    if (!dragging) {
      if (Math.abs(e.clientY - startY) > 8) {
        clearTimeout(pressTimer);
        dragEl.classList.remove("pressing");
        dragEl = null;
      }
      return;
    }
    e.preventDefault();
    lastY = e.clientY;
    applyTransform();
    reorderAt(lastY);
    if (!autoScrollRaf) autoScrollRaf = requestAnimationFrame(autoScroll);
  });

  function endDrag(e) {
    if (e && dragEl && e.pointerId !== pointerId) return;
    clearTimeout(pressTimer);
    if (!dragEl) {
      dragging = false;
      return;
    }
    const el = dragEl;
    const wasDragging = dragging;
    const id = el.dataset.id;

    if (wasDragging) {
      // 손가락을 뗀 자리에서 제자리로 스르륵 안착시킨다.
      const from = el.style.transform;
      cleanupVisual();
      if (!REDUCED_MOTION()) {
        el.animate([{ transform: from }, { transform: "none" }], {
          duration: 180,
          easing: "cubic-bezier(.2,.8,.2,1)",
        });
      }
      // 새 순서와 함께 "무엇을 끌었는지"도 넘긴다 — 시각 고정 블록을 옮겼을
      // 땐 화면 쪽이 그 사실을 알아야 오늘만 고정을 풀어줄 수 있다.
      onReorder(items().map((x) => x.dataset.id), id);
    } else {
      cleanupVisual();
      onTap(id);
    }
    dragEl = null;
    dragging = false;
    originalOrder = null;
  }

  function cancelDrag(e) {
    if (e && dragEl && e.pointerId !== pointerId) return;
    clearTimeout(pressTimer);
    // 전화 수신 등으로 제스처가 끊기면 중간 순서를 저장하지 말고 원래대로 되돌린다.
    if (dragging && originalOrder) originalOrder.forEach((x) => listEl.appendChild(x));
    cleanupVisual();
    dragEl = null;
    dragging = false;
    originalOrder = null;
  }

  listEl.addEventListener("pointerup", endDrag);
  listEl.addEventListener("pointercancel", cancelDrag);
}
