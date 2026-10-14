/*
 * 내신나침반 — 태블릿으로 보낼 상담 자료 꾸리기·풀기
 * QR 장수를 줄이려고 짧게 적는다. 엑셀 원본·수상명은 보내지 않고, 계산에 필요한 성적과 수상 개수만 보낸다.
 *
 * { v: 3, basis, cls, made, days, subj: [과목명…], cy: [세 학년도], cut: [[학교, 해1, 해2, 해3]…], st: [[번호, 이름, 성적, 출결, 수상, 임원개월]…] }
 *  (v2는 cut: [[학교, 커트라인]…]으로 한 해만 보냈다. 받을 때는 둘 다 읽는다)
 *  성적: '학기글자 과목번호 성취도 원점수'를 쉼표로 잇는다. 예) 'c3A92' = 2학년 1학기, 과목 3, A, 92점 (체육·예술은 원점수 없음)
 *  출결: [[학년, 미인정 결석, 지각, 조퇴, 결과]…]   수상: '학기글자 개수' 이어 쓰기. 예) 'b1c2'
 */
(function (root) {
  'use strict';

  const VERSION = 3;
  const SEM_CODES = { '1-1': 'a', '1-2': 'b', '2-1': 'c', '2-2': 'd', '3-1': 'e', '3-2': 'f' };
  const CODE_SEMS = {};
  Object.keys(SEM_CODES).forEach((sem) => { CODE_SEMS[SEM_CODES[sem]] = sem; });
  const DAYS = 30;

  function pack(students, cutoffs, info) {
    const subj = [];
    const subjIndex = (name) => {
      let i = subj.indexOf(name);
      if (i < 0) { subj.push(name); i = subj.length - 1; }
      return i.toString(36);
    };
    const st = students.map((s) => {
      const grades = s.grades
        .filter((g) => SEM_CODES[g.sem])
        .map((g) => `${SEM_CODES[g.sem]}${subjIndex(g.subject)}${g.kind === 'arts' ? g.ach.toLowerCase() : g.ach}${g.kind === 'arts' || g.raw == null ? '' : g.raw}`)
        .join(',');
      const att = Object.keys(s.attendance || {}).sort().map((grade) => {
        const a = s.attendance[grade];
        return [Number(grade), a.absent, a.late, a.early, a.missed];
      });
      const counts = {};
      (s.awards || []).forEach((a) => { counts[a.sem] = (counts[a.sem] || 0) + 1; });
      const awards = Object.keys(counts).filter((sem) => SEM_CODES[sem]).sort().map((sem) => `${SEM_CODES[sem]}${counts[sem]}`).join('');
      const months = (s.officers || []).reduce((a, o) => a + o.months, 0);
      return [s.no, s.name, grades, att, awards, months];
    });
    if (subj.length > 36) throw new Error('과목이 너무 많아요');
    return {
      v: VERSION,
      basis: info.basis,
      cls: info.cls || '',
      made: info.made || new Date().toISOString(),
      days: DAYS,
      subj,
      cy: info.years,
      cut: cutoffs.map((c) => [c.school].concat(info.years.map((y) => {
        const h = (c.history || []).find((x) => x.year === y);
        if (!h) return null;
        return h.score != null ? h.score : h.note || null;
      }))),
      st,
    };
  }

  // 받은 자료를 화면이 쓰는 학생 모양으로 되돌린다(나이스에서 읽은 학생과 같은 모양)
  function unpack(obj) {
    if (!obj || (obj.v !== VERSION && obj.v !== 2) || !Array.isArray(obj.st)) throw new Error('format');
    const students = obj.st.map(([no, name, grades, att, awards, months]) => {
      const st = { id: String(no), no, name, grades: [], attendance: {}, awards: [], officers: [], hasVolunteer: false };
      (grades ? grades.split(',') : []).forEach((tok) => {
        const m = tok.match(/^([a-f])([0-9a-z])([A-Ea-c])([\d.]*)$/);
        if (!m) return;
        const arts = m[3] === m[3].toLowerCase();
        st.grades.push({
          sem: CODE_SEMS[m[1]],
          subject: obj.subj[parseInt(m[2], 36)],
          kind: arts ? 'arts' : 'general',
          ach: m[3].toUpperCase(),
          raw: arts ? null : Number(m[4]),
        });
      });
      (att || []).forEach(([grade, absent, late, early, missed]) => {
        st.attendance[grade] = { absent, late, early, missed, volunteer: 0 };
      });
      (awards || '').replace(/([a-f])(\d+)/g, (all, code, n) => {
        for (let i = 0; i < Number(n); i += 1) st.awards.push({ sem: CODE_SEMS[code], title: '' });
        return all;
      });
      if (months > 0) st.officers.push({ id: 'o1', role: '자치회 임원', months });
      return st;
    });
    // 커트라인은 화면 저장 모양({ id, school, years })으로. v2는 한 해 값이라 최근 학년도로 둔다
    const cy = obj.v === 2 ? null : obj.cy;
    const cutoffs = obj.cut.map((row, i) => {
      const years = {};
      if (cy) cy.forEach((y, k) => { if (row[k + 1] != null) years[y] = String(row[k + 1]); });
      return cy ? { id: `c${i + 1}`, school: row[0], years } : { id: `c${i + 1}`, school: row[0], score: row[1], text: String(row[1]) };
    });
    return {
      basis: obj.basis,
      cls: obj.cls,
      made: obj.made,
      days: obj.days || DAYS,
      students,
      cutoffs,
      cutLatest: cy ? cy[cy.length - 1] : 0,
    };
  }

  const api = { pack, unpack, VERSION, DAYS };
  root.Payload = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
