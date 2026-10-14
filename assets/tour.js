/*
 * 내신나침반 — 화면 사용 안내(둘러보기)
 * 설명할 곳을 밝히고 나머지는 어둡게 한 뒤, 옆 말풍선으로 한 단계씩 넘긴다.
 * 화면마다 처음 들어왔을 때 한 번 저절로 뜨고, 머리의 '사용 안내'로 언제든 다시 본다.
 *
 * steps: [{ target: '선택자' | () => 요소, title, body: ['문단(HTML)', …], optional }]
 *  optional: 그 요소가 화면에 없으면 단계를 건너뛴다(없으면 가운데에 말풍선만 띄운다)
 */
(function (root) {
  'use strict';

  const KEY = 'naesin-compass:tour';
  const PAD = 8; // 밝힌 칸 여백
  const GAP = 14; // 밝힌 칸과 말풍선 사이
  const MARGIN = 16; // 화면 가장자리 여백

  let el = null;
  let steps = [];
  let index = 0;
  let label = '';
  let lastFocus = null;
  let raf = 0;
  let followUntil = 0;

  const reduced = () => !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function seen() {
    try { return JSON.parse(root.localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; }
  }
  function markSeen(name) {
    try {
      const s = seen();
      s[name] = 1;
      root.localStorage.setItem(KEY, JSON.stringify(s));
    } catch (e) { /* 기억 못 하면 다음에도 한 번 더 뜬다 */ }
  }

  function find(step) {
    const t = typeof step.target === 'function' ? step.target() : document.querySelector(step.target);
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return r.width || r.height ? t : null;
  }

  function build() {
    el = document.createElement('div');
    el.className = 'tour';
    el.innerHTML = `
      <div class="tour-spot is-none" aria-hidden="true"></div>
      <div class="tour-pop" role="dialog" aria-modal="true" aria-labelledby="tourTitle" aria-describedby="tourBody">
        <div class="tour-head">
          <p class="tour-eyebrow"></p>
          <button type="button" class="tour-x" data-tour="close" aria-label="사용 안내 닫기">✕</button>
        </div>
        <div class="tour-progress" aria-hidden="true"><span class="tour-count"></span><span class="tour-bar"><i></i></span></div>
        <h2 class="tour-title" id="tourTitle"></h2>
        <div class="tour-body" id="tourBody"></div>
        <div class="tour-foot">
          <button type="button" class="btn-text" data-tour="close">그만 보기</button>
          <span class="tour-nav">
            <button type="button" class="btn btn-quiet" data-tour="prev">이전</button>
            <button type="button" class="btn btn-primary" data-tour="next"></button>
          </span>
        </div>
      </div>`;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tour]');
      if (!b) return;
      if (b.dataset.tour === 'close') stop();
      if (b.dataset.tour === 'prev') go(index - 1);
      if (b.dataset.tour === 'next') go(index + 1);
    });
    document.body.appendChild(el);
  }

  // 밝힌 칸과 말풍선 자리 잡기(스크롤·창 크기에 따라 다시 부른다)
  function place() {
    if (!el) return;
    const spot = el.querySelector('.tour-spot');
    const pop = el.querySelector('.tour-pop');
    const vw = document.documentElement.clientWidth;
    const vh = root.innerHeight;
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    const t = find(steps[index]);
    if (!t) {
      spot.classList.add('is-none');
      Object.assign(spot.style, { top: `${vh / 2}px`, left: `${vw / 2}px`, width: '0px', height: '0px' });
      Object.assign(pop.style, { left: `${Math.max(MARGIN, (vw - pw) / 2)}px`, top: `${Math.max(MARGIN, (vh - ph) / 2)}px` });
      return;
    }
    spot.classList.remove('is-none');
    const r = t.getBoundingClientRect();
    const top = clamp(r.top - PAD, 4, vh - 4);
    const left = clamp(r.left - PAD, 4, vw - 4);
    const box = {
      top,
      left,
      width: Math.max(0, Math.min(r.right + PAD, vw - 4) - left),
      height: Math.max(0, Math.min(r.bottom + PAD, vh - 4) - top),
    };
    Object.assign(spot.style, { top: `${box.top}px`, left: `${box.left}px`, width: `${box.width}px`, height: `${box.height}px` });

    let pt;
    let pl;
    const below = vh - (box.top + box.height) - GAP;
    const above = box.top - GAP;
    const right = vw - (box.left + box.width) - GAP;
    const leftSpace = box.left - GAP;
    if (vw < 600) { // 좁은 화면은 아래에 붙인다
      pl = MARGIN;
      pt = box.top + box.height + GAP + ph <= vh - MARGIN ? box.top + box.height + GAP : vh - ph - MARGIN;
    } else if (below >= ph) { pt = box.top + box.height + GAP; pl = box.left; }
    else if (right >= pw) { pl = box.left + box.width + GAP; pt = box.top; }
    else if (above >= ph) { pt = box.top - GAP - ph; pl = box.left; }
    else if (leftSpace >= pw) { pl = box.left - GAP - pw; pt = box.top; }
    else { pt = vh - ph - MARGIN; pl = vw - pw - MARGIN; } // 칸이 화면보다 크면 오른쪽 아래
    Object.assign(pop.style, {
      left: `${clamp(pl, MARGIN, Math.max(MARGIN, vw - pw - MARGIN))}px`,
      top: `${clamp(pt, MARGIN, Math.max(MARGIN, vh - ph - MARGIN))}px`,
    });
  }

  // 부드러운 스크롤을 따라가며 잠깐 동안 매 장면 자리를 다시 잡는다
  function follow(ms) {
    followUntil = root.performance.now() + ms;
    root.cancelAnimationFrame(raf);
    const tick = () => {
      place();
      if (root.performance.now() < followUntil) raf = root.requestAnimationFrame(tick);
    };
    tick();
  }

  function go(i) {
    if (i < 0) return;
    if (i >= steps.length) { stop(); return; }
    index = i;
    const step = steps[i];
    const pop = el.querySelector('.tour-pop');
    el.querySelector('.tour-eyebrow').textContent = `${label} · 사용 안내`;
    el.querySelector('.tour-count').textContent = `${i + 1} / ${steps.length}`;
    el.querySelector('.tour-bar i').style.width = `${((i + 1) / steps.length) * 100}%`;
    el.querySelector('.tour-title').textContent = step.title;
    el.querySelector('.tour-body').innerHTML = step.body.map((p) => `<p>${p}</p>`).join('');
    el.querySelector('[data-tour="prev"]').disabled = i === 0;
    el.querySelector('[data-tour="next"]').textContent = i === steps.length - 1 ? '끝내기' : '다음 →';
    pop.classList.remove('is-in');
    void pop.offsetWidth; // 말풍선이 새로 떠오르게
    pop.classList.add('is-in');
    const t = find(step);
    if (t) t.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
    follow(900);
    el.querySelector('[data-tour="next"]').focus({ preventScroll: true });
  }

  function onKey(e) {
    if (!el) return;
    if (e.key === 'Escape') { e.preventDefault(); stop(); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); go(index + 1); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(index - 1); return; }
    if (e.key === 'Tab') { // 말풍선 안에서만 돈다
      const items = Array.from(el.querySelectorAll('.tour-pop button:not(:disabled)'));
      const at = items.indexOf(document.activeElement);
      e.preventDefault();
      const next = e.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : (at + 1) % items.length;
      items[next].focus();
    }
  }
  function onMove() { place(); }

  function start(name, labelText, list) {
    const usable = list.filter((s) => !s.optional || find(s));
    if (!usable.length) return;
    if (el) stop();
    steps = usable;
    label = labelText;
    lastFocus = document.activeElement;
    markSeen(name);
    build();
    document.addEventListener('keydown', onKey, true);
    root.addEventListener('resize', onMove);
    root.addEventListener('scroll', onMove, true);
    root.requestAnimationFrame(() => {
      if (!el) return;
      el.classList.add('is-open');
      go(0);
    });
  }

  function stop() {
    if (!el) return;
    root.cancelAnimationFrame(raf);
    document.removeEventListener('keydown', onKey, true);
    root.removeEventListener('resize', onMove);
    root.removeEventListener('scroll', onMove, true);
    el.remove();
    el = null;
    if (lastFocus && document.contains(lastFocus) && lastFocus.focus) lastFocus.focus({ preventScroll: true });
    lastFocus = null;
  }

  // 그 화면을 처음 봤을 때만 저절로 띄운다. still(): 그사이 다른 화면으로 갔으면 띄우지 않는다
  function auto(name, labelText, list, still) {
    if (seen()[name]) return;
    root.setTimeout(() => {
      if (el || (still && !still())) return;
      start(name, labelText, list);
    }, 600);
  }

  root.Tour = { start, stop, auto, isOpen: () => !!el };
})(window);
