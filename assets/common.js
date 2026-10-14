/*
 * 내신나침반 — 저장소(이 브라우저의 localStorage)와 화면 공용 도우미
 * 입력·관리 탭과 상담 탭은 같은 저장소를 읽고, 한쪽이 바뀌면 다른 탭도 다시 그린다.
 */
(function (root) {
  'use strict';

  const KEY = 'naesin-compass:v1';
  // officers: 담임이 손으로 넣는 자치회 임원 기록 { 학생번호: [{ id, sem, role, months }] } (예전 기록은 sem 없음) — 나이스 파일을 다시 올려도 남는다
  // sentAt·sentSig: 마지막으로 태블릿 QR을 만든 때와 그때 자료의 지문(자료가 바뀌면 다시 보내라고 알린다)
  // edits: 담임이 앱에서 고친 나이스 값 { 학생번호: { grades: { '학기|과목': { ach, raw } }, attendance: { 학년: {…} }, awards: { 학기: 개수 } } }
  //        엑셀을 다시 올려도 남고, 칸마다 '원래대로'로 지운다
  // cutoffs: [{ id, school, years: { '2026': '181.3', … } }] 학년도별 커트라인(적은 글자 그대로). cutLatest: 화면에 보일 최근 학년도(0이면 오늘 기준)
  const DEFAULT = { basis: '2028', dataset: null, lastError: null, cutoffs: [], cutLatest: 0, counselSchool: '', officers: {}, edits: {}, sentAt: '', sentSig: '' };
  let memory = null; // 시안 보기에서는 저장소를 건드리지 않고 메모리만 쓴다
  let cache = null;
  const subscribers = new Set();

  function get() {
    if (memory) return memory;
    if (cache) return cache;
    try {
      const raw = root.localStorage.getItem(KEY);
      cache = raw ? Object.assign({}, DEFAULT, JSON.parse(raw)) : Object.assign({}, DEFAULT);
    } catch (e) {
      cache = Object.assign({}, DEFAULT);
    }
    return cache;
  }

  function write(next) {
    let saved = true;
    if (memory) memory = next;
    else {
      cache = next;
      try { root.localStorage.setItem(KEY, JSON.stringify(next)); } catch (e) { saved = false; }
    }
    subscribers.forEach((fn) => fn(next, { saved }));
  }

  root.addEventListener('storage', (e) => {
    if (memory || e.key !== KEY) return;
    cache = null;
    const s = get();
    subscribers.forEach((fn) => fn(s, { remote: true, saved: true }));
  });

  root.Store = {
    get,
    update(patch) {
      const cur = get();
      write(Object.assign({}, cur, typeof patch === 'function' ? patch(cur) : patch));
    },
    clearData() {
      write(Object.assign({}, DEFAULT, { cutoffs: get().cutoffs }));
    },
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    useMemory(initial) {
      memory = Object.assign({}, DEFAULT, initial || {});
    },
    isMemory: () => !!memory,
  };

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const fmt = (n, d) => (n == null || isNaN(n) ? '—' : Number(n).toFixed(d == null ? 3 : d));
  const signed = (n, d) => (n > 0 ? '+' : n < 0 ? '−' : '±') + fmt(Math.abs(n), d);

  function maskName(name) {
    const s = String(name || '');
    return s.length <= 1 ? s : s.charAt(0) + '○'.repeat(s.length - 1);
  }

  function formatTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = (x) => String(x).padStart(2, '0');
    return `${d.getMonth() + 1}월 ${d.getDate()}일 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // 산출 기준은 2028학년도 지침으로 정했다(화면에서 고르지 않음)
  const BASIS = '2028';

  // 나이스 자료에 담임이 넣은 임원 기록과 앱에서 고친 값을 덮은 학생. 고친 성적에는 edited와 원래 값(orig)을 붙인다
  function withManual(state, s) {
    const list = (state.officers || {})[s.id];
    const ed = (state.edits || {})[s.id];
    if (!(list && list.length) && !ed) return s;
    const out = Object.assign({}, s);
    if (list && list.length) out.officers = list;
    if (!ed) return out;
    if (ed.grades) {
      out.grades = s.grades.map((g) => {
        const o = ed.grades[`${g.sem}|${g.subject}`];
        return o ? Object.assign({}, g, o, { edited: true, orig: { ach: g.ach, raw: g.raw } }) : g;
      });
    }
    if (ed.attendance) {
      out.attendance = Object.assign({}, s.attendance);
      Object.keys(ed.attendance).forEach((grade) => {
        out.attendance[grade] = Object.assign({ absent: 0, late: 0, early: 0, missed: 0, volunteer: 0 }, s.attendance[grade] || {}, ed.attendance[grade]);
      });
    }
    if (ed.awards) {
      out.awards = s.awards.filter((a) => !(a.sem in ed.awards));
      Object.keys(ed.awards).forEach((sem) => {
        const orig = s.awards.filter((a) => a.sem === sem);
        for (let i = 0; i < ed.awards[sem]; i += 1) out.awards.push(orig[i] || { sem, title: '' });
      });
    }
    return out;
  }

  // 한 학생에게 고친 칸이 몇 개인지
  function editCount(state, id) {
    const ed = (state.edits || {})[id];
    if (!ed) return 0;
    return ['grades', 'attendance', 'awards'].reduce((n, k) => n + Object.keys(ed[k] || {}).length, 0);
  }

  function computeOne(state, s, opts) {
    return root.Naesin.compute(withManual(state, s), BASIS, opts);
  }

  function computeAll(state, opts) {
    if (!state.dataset) return [];
    return state.dataset.students.map((s) => ({ student: withManual(state, s), result: computeOne(state, s, opts) }));
  }

  const OFFICER_ROLES = ['학급 회장', '학급 부회장', '전교 회장', '전교 부회장'];
  // 임원 기록의 학기: [값, 화면 이름, 인정 개월]
  // 1학기 3월 1일~8월 17일(5개월 17일), 2학기 8월 18일~2월 말은 15일 이상을 한 달로 쳐 6개월.
  // 3학년 2학기는 넣지 않는다(담임 결정)
  const OFFICER_SEMS = ['1-1', '1-2', '2-1', '2-2', '3-1'].map((s) => [s, `${s[0]}학년 ${s[2]}학기`, 6]);

  // ---------- 학교별 커트라인(최근 4개 학년도) ----------

  const CUT_YEAR_COUNT = 4;

  // 그해 고입 결과는 1월 말까지 나오므로 2월부터 그해를 최근 학년도로 본다
  function defaultLatestYear(d) {
    const now = d || new Date();
    return now.getMonth() >= 1 ? now.getFullYear() : now.getFullYear() - 1;
  }
  function cutLatestYear(state) {
    return Number(state.cutLatest) || defaultLatestYear();
  }
  // [오래된 해, …, 최근 해]
  function cutYears(state) {
    const y = cutLatestYear(state);
    return Array.from({ length: CUT_YEAR_COUNT }, (_, i) => y - (CUT_YEAR_COUNT - 1) + i);
  }
  // 예전 저장 모양({ score, text })은 최근 학년도 값으로 읽는다
  function cutYearTexts(c, latest) {
    if (c.years) return c.years;
    const t = c.text != null ? c.text : c.score;
    return t != null && t !== '' ? { [latest]: String(t) } : {};
  }
  function cutNumber(text) {
    const t = String(text == null ? '' : text).trim().replace(/,/g, '');
    if (!t) return null;
    const n = Number(t);
    return isFinite(n) && n > 0 && n <= 200 ? n : NaN;
  }
  // 숫자만으로 된 글이 아니면('미달', '147근처' 등) 메모로 보여 주고 계산에는 쓰지 않는다
  function isCutNote(text) {
    const t = String(text == null ? '' : text).trim().replace(/,/g, '');
    return !!t && !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t);
  }

  // 상담에 쓰는 학교: 네 해 중 한 해라도 맞는 커트라인이 있는 학교. score·year는 가장 최근 값
  function validCutoffs(state) {
    const years = cutYears(state);
    return (state.cutoffs || []).map((c) => {
      if (!c.school) return null;
      const texts = cutYearTexts(c, cutLatestYear(state));
      const history = years.map((year) => {
        const n = cutNumber(texts[year]);
        const score = typeof n === 'number' && !isNaN(n) ? n : null;
        return { year, score, note: score == null && isCutNote(texts[year]) ? String(texts[year]).replace(/\s+/g, ' ').trim() : '' };
      });
      const latest = history.slice().reverse().find((h) => h.score != null);
      if (!latest) return null;
      const got = history.filter((h) => h.score != null);
      return {
        id: c.id,
        school: c.school,
        score: latest.score,
        year: latest.year,
        history,
        avg: Math.round((got.reduce((a, h) => a + h.score, 0) / got.length) * 1000) / 1000,
      };
    }).filter(Boolean);
  }

  function counselUrl(id) {
    return `${root.location.href.split('#')[0]}#counsel/${encodeURIComponent(id || '')}`;
  }

  // 나침반 표식: 노란 판 위에 주홍(북)·먹색(남) 바늘
  function brandMark(size) {
    const s = size || 28;
    return `<svg class="mark" viewBox="0 0 32 32" width="${s}" height="${s}" aria-hidden="true" focusable="false"><circle class="mark-ring" cx="16" cy="16" r="14"/><g transform="rotate(40 16 16)"><path class="mark-n" d="M16 5 20.5 16h-9z"/><path class="mark-s" d="M16 27 11.5 16h9z"/></g><circle class="mark-pin" cx="16" cy="16" r="2"/></svg>`;
  }

  // 화면 머리의 '사용 안내' 버튼(누르면 그 화면 둘러보기)
  function guideButton(id) {
    return `<button type="button" class="btn btn-quiet btn-guide" id="${id}"><span class="guide-i" aria-hidden="true">i</span>사용 안내</button>`;
  }

  root.UI = { esc, fmt, signed, maskName, formatTime, computeAll, computeOne, editCount, validCutoffs, cutYears, cutLatestYear, cutYearTexts, cutNumber, isCutNote, defaultLatestYear, counselUrl, brandMark, guideButton, BASIS, OFFICER_ROLES, OFFICER_SEMS };
})(window);
