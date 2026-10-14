/*
 * 내신나침반 — 나이스 '학교생활기록부' 출력물 읽기
 * 교과학습발달상황 · 출결상황 · 수상경력 엑셀을 고치지 않고 그대로 읽는다.
 * 출력물 특징: 위쪽 제목·반 칸, 쪽마다 반복되는 머리글, 쪽 번호 줄, 병합 셀(첫 줄에만 값).
 */
(function (root) {
  'use strict';

  const KINDS = {
    grades: { title: '교과학습발달상황', label: '교과학습발달상황' },
    attendance: { title: '출결상황', label: '출결상황' },
    awards: { title: '수상경력', label: '수상경력' },
  };

  const squash = (v) => String(v == null ? '' : v).replace(/\s+/g, '');
  const text = (v) => (v == null ? '' : String(v).trim());

  function readTable(ws) {
    const X = root.XLSX;
    if (!ws || !ws['!ref']) return { rows: [], r0: 0, c0: 0 };
    const range = X.utils.decode_range(ws['!ref']);
    const rows = X.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
    return { rows, r0: range.s.r, c0: range.s.c };
  }

  const addr = (t, i, j) => root.XLSX.utils.encode_cell({ r: t.r0 + i, c: t.c0 + j });
  const rowNo = (t, i) => t.r0 + i + 1;

  /** 위쪽 제목 칸으로 출력물 종류를 알아낸다. 학교생활기록부 출력물이 아니면 null */
  function detect(wb) {
    for (const name of wb.SheetNames) {
      const t = readTable(wb.Sheets[name]);
      for (let i = 0; i < Math.min(t.rows.length, 10); i += 1) {
        const line = squash((t.rows[i] || []).join(' '));
        if (line.indexOf('학교생활기록부') < 0) continue;
        for (const kind of Object.keys(KINDS)) {
          if (line.indexOf(KINDS[kind].title) >= 0) return { kind, sheet: name, table: t };
        }
      }
    }
    return null;
  }

  function findClass(t) {
    for (let i = 0; i < Math.min(t.rows.length, 12); i += 1) {
      for (const v of t.rows[i] || []) {
        const m = squash(v).match(/^(\d)학년(\d+)반$/);
        if (m) return `${m[1]}학년 ${m[2]}반`;
      }
    }
    return '';
  }

  const isHeader = (row) => {
    const cells = (row || []).map(squash);
    return cells.indexOf('번호') >= 0 && cells.indexOf('성명') >= 0;
  };
  // 쪽 번호 줄('1 / 34')과 빈 줄
  const isFooter = (row) => (row || []).some((v) => text(v) === '/');
  const isBlank = (row) => !row || row.every((v) => text(v) === '');

  // 머리글 글자 → 열 위치. 같은 이름이 둘이면 앞의 것.
  function mapHeader(row, names) {
    const map = {};
    (row || []).forEach((v, j) => {
      const s = squash(v);
      for (const key of Object.keys(names)) {
        if (map[key] == null && names[key].indexOf(s) >= 0) map[key] = j;
      }
    });
    return map;
  }

  function parseNumber(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v;
    const n = Number(String(v).replace(/[^\d.-]/g, ''));
    return String(v).trim() === '' || isNaN(n) ? NaN : n;
  }

  // ---------- 교과학습발달상황 ----------
  const GRADE_COLS = {
    no: ['번호'], name: ['성명'], grade: ['학년'], sem: ['학기'], subject: ['과목'],
    raw: ['원점수/과목평균', '원점수/과목평균(표준편차)', '원점수'], ach: ['성취도'], hours: ['이수시간'], pass: ['이수여부'],
  };

  function parseGrades(t, out) {
    let map = null;
    let section = 'general';
    const ctx = { no: null, name: '', grade: null, sem: null };
    const freeSemesters = new Set();

    t.rows.forEach((row, i) => {
      if (isBlank(row) || isFooter(row)) return;
      if (isHeader(row)) {
        // 구역은 머리글 모양으로 안다: 이수시간·이수여부 → 학교자율시간(안 읽음), 원점수 열 없음 → 체육·예술
        map = mapHeader(row, GRADE_COLS);
        section = map.hours != null || map.pass != null ? 'skip' : map.raw == null ? 'arts' : 'general';
        if (section !== 'skip') {
          const need = section === 'arts' ? ['no', 'name', 'grade', 'sem', 'subject', 'ach'] : ['no', 'name', 'grade', 'sem', 'subject', 'raw', 'ach'];
          const label = { no: '번호', name: '성명', grade: '학년', sem: '학기', subject: '과목', raw: '원점수/과목평균', ach: '성취도' };
          need.filter((k) => map[k] == null).forEach((k) => {
            out.errors.push({ cell: `${rowNo(t, i)}행`, text: `‘${label[k]}’ 열을 찾지 못했어요.`, hint: '나이스에서 내려받은 파일을 고치지 말고 그대로 올려 주세요.' });
          });
          if (out.errors.length) map = null;
        }
        return;
      }
      if (!map || section === 'skip') return;
      const get = (k) => (map[k] == null ? null : row[map[k]]);
      const no = parseNumber(get('no'));
      if (no != null && !isNaN(no)) { ctx.no = no; ctx.name = text(get('name')) || ctx.name; }
      const g = parseNumber(get('grade'));
      if (g != null && !isNaN(g)) ctx.grade = g;
      const s = parseNumber(get('sem'));
      if (s != null && !isNaN(s)) ctx.sem = s;
      const subject = text(get('subject'));
      if (!subject || ctx.no == null || !ctx.grade || !ctx.sem) return;
      const sem = `${ctx.grade}-${ctx.sem}`;
      const ach = text(get('ach')).toUpperCase();
      const cell = addr(t, i, map.ach);
      if (ach === 'P') { freeSemesters.add(sem); return; } // 자유학기·이수 과목
      if (section === 'arts') {
        if (['A', 'B', 'C'].indexOf(ach) < 0) {
          out.issues.push({ cell, text: `${ctx.no}번 ${subject}(${sem}) 성취도 ‘${ach || '빈칸'}’를 읽지 못해 뺐어요.` });
          return;
        }
        out.rows.push({ no: ctx.no, name: ctx.name, sem, subject, kind: 'arts', ach, raw: null });
        return;
      }
      const rawText = text(get('raw'));
      const raw = parseNumber(rawText.split('/')[0]);
      if (raw == null || isNaN(raw) || raw < 0 || raw > 100) {
        out.issues.push({ cell: addr(t, i, map.raw), text: `${ctx.no}번 ${subject}(${sem}) 원점수가 ${rawText ? `‘${rawText}’라` : '비어 있어'} 계산에서 뺐어요.` });
        return;
      }
      let finalAch = ach;
      if (['A', 'B', 'C', 'D', 'E'].indexOf(ach) < 0) {
        finalAch = root.Naesin.achFromRaw(raw);
        out.issues.push({ cell, text: `${ctx.no}번 ${subject}(${sem}) 성취도 ‘${ach || '빈칸'}’ 대신 원점수 ${raw}점 기준 ‘${finalAch}’로 계산했어요.` });
      }
      out.rows.push({ no: ctx.no, name: ctx.name, sem, subject, kind: 'general', ach: finalAch, raw });
    });
    out.freeSemesters = Array.from(freeSemesters).sort();
  }

  // ---------- 출결상황 ----------
  function parseAttendance(t, out) {
    let map = null;
    const ctx = { no: null, name: '' };
    t.rows.forEach((row, i) => {
      if (isBlank(row) || isFooter(row)) return;
      if (isHeader(row)) {
        map = mapHeader(row, { no: ['번호'], name: ['성명'], grade: ['학년'] });
        // 두 줄 머리글: 아래 줄의 '미인정'이 위 줄 어느 항목(결석·지각·조퇴·결과) 밑에 있는지 본다
        const sub = t.rows[i + 1] || [];
        const groups = { 결석: 'absent', 지각: 'late', 조퇴: 'early', 결과: 'missed' };
        sub.forEach((v, j) => {
          if (squash(v) !== '미인정') return;
          for (let k = j; k >= 0; k -= 1) {
            const top = squash(row[k]);
            if (top) { if (groups[top]) map[groups[top]] = j; break; }
          }
        });
        const label = { no: '번호', name: '성명', grade: '학년', absent: '결석-미인정', late: '지각-미인정', early: '조퇴-미인정', missed: '결과-미인정' };
        Object.keys(label).filter((k) => map[k] == null).forEach((k) => {
          out.errors.push({ cell: `${rowNo(t, i)}행`, text: `‘${label[k]}’ 칸을 찾지 못했어요.`, hint: '결석·지각·조퇴·결과가 질병·미인정·기타로 나뉜 출결상황 출력물을 올려 주세요.' });
        });
        if (out.errors.length) map = null;
        return;
      }
      if (!map) return;
      if (squash(row[map.absent]) === '미인정') return; // 머리글 아래 줄
      const get = (k) => row[map[k]];
      const no = parseNumber(get('no'));
      if (no != null && !isNaN(no)) { ctx.no = no; ctx.name = text(get('name')) || ctx.name; }
      const grade = parseNumber(get('grade'));
      if (grade == null || isNaN(grade) || ctx.no == null) return;
      const rec = { no: ctx.no, name: ctx.name, grade };
      for (const k of ['absent', 'late', 'early', 'missed']) {
        const n = parseNumber(get(k));
        if (n == null) rec[k] = 0;
        else if (isNaN(n) || n < 0) {
          rec[k] = 0;
          out.issues.push({ cell: addr(t, i, map[k]), text: `${ctx.no}번 ${grade}학년 ‘${text(get(k))}’를 숫자로 읽지 못해 0으로 넣었어요.` });
        } else rec[k] = Math.floor(n);
      }
      out.rows.push(rec);
    });
  }

  // ---------- 수상경력 ----------
  function parseAwards(t, out) {
    let map = null;
    const ctx = { no: null, name: '', grade: null, sem: null };
    t.rows.forEach((row, i) => {
      if (isBlank(row) || isFooter(row)) return;
      if (isHeader(row)) {
        map = mapHeader(row, { gradeSem: ['학년(학기)'], no: ['번호'], name: ['성명'], title: ['수상명'], date: ['수상연월일'], org: ['수여기관'] });
        const label = { gradeSem: '학년(학기)', no: '번호', name: '성명', title: '수상명' };
        Object.keys(label).filter((k) => map[k] == null).forEach((k) => {
          out.errors.push({ cell: `${rowNo(t, i)}행`, text: `‘${label[k]}’ 열을 찾지 못했어요.`, hint: '나이스에서 내려받은 수상경력 파일을 그대로 올려 주세요.' });
        });
        if (out.errors.length) map = null;
        return;
      }
      if (!map) return;
      const g = parseNumber(row[map.gradeSem]);
      if (g != null && !isNaN(g)) ctx.grade = g;
      const s = parseNumber(row[map.gradeSem + 1]); // 학년(학기) 칸은 학년·학기 두 열로 나뉜다
      if (s != null && !isNaN(s)) ctx.sem = s;
      const no = parseNumber(row[map.no]);
      if (no != null && !isNaN(no)) { ctx.no = no; ctx.name = text(row[map.name]) || ctx.name; }
      const title = text(row[map.title]);
      if (!title || ctx.no == null) return;
      if (!ctx.grade || !ctx.sem) {
        out.issues.push({ cell: addr(t, i, map.gradeSem), text: `${ctx.no}번 ‘${title}’의 학년·학기를 알 수 없어 뺐어요.` });
        return;
      }
      out.rows.push({ no: ctx.no, name: ctx.name, sem: `${ctx.grade}-${ctx.sem}`, title, date: text(row[map.date]) });
    });
  }

  /** 출력물 하나 → { ok, kind, cls, rows, issues, errors } */
  function parseWorkbook(wb, fileName) {
    const found = detect(wb);
    if (!found) return null;
    const out = { ok: true, kind: found.kind, label: KINDS[found.kind].label, fileName, cls: findClass(found.table), rows: [], issues: [], errors: [] };
    if (found.kind === 'grades') parseGrades(found.table, out);
    if (found.kind === 'attendance') parseAttendance(found.table, out);
    if (found.kind === 'awards') parseAwards(found.table, out);
    if (!out.errors.length && !out.rows.length) {
      out.errors.push({ cell: '', text: '읽을 수 있는 줄이 없어요.', hint: '학생 자료가 들어 있는 출력물인지 확인해 주세요.' });
    }
    out.ok = !out.errors.length;
    out.students = new Set(out.rows.map((r) => r.no)).size;
    return out;
  }

  /** 출력물별 결과를 학생 단위로 합친다. 기준 명단은 교과학습발달상황. */
  function merge(sources) {
    const issues = [];
    const grades = sources.grades;
    if (!grades) return { students: [], issues };
    const students = new Map();
    for (const r of grades.rows) {
      let st = students.get(r.no);
      if (!st) {
        st = { id: String(r.no), no: r.no, name: r.name, grades: [], attendance: {}, awards: [], officers: [], hasVolunteer: false };
        students.set(r.no, st);
      }
      st.grades.push({ sem: r.sem, subject: r.subject, kind: r.kind, ach: r.ach, raw: r.raw });
    }
    const attach = (src, fn) => {
      if (!src) return;
      const missing = new Set();
      const renamed = new Set();
      for (const r of src.rows) {
        const st = students.get(r.no);
        if (!st) { missing.add(r.no); continue; }
        if (r.name && st.name && r.name !== st.name && !renamed.has(r.no)) {
          renamed.add(r.no);
          issues.push({ file: src.label, cell: '', text: `${r.no}번 이름이 파일마다 달라요(교과: ${st.name}, ${src.label}: ${r.name}). 번호 기준으로 합쳤어요.` });
        }
        fn(st, r);
      }
      missing.forEach((no) => issues.push({ file: src.label, cell: '', text: `${src.label}의 ${no}번은 교과학습발달상황에 없어 넣지 않았어요.` }));
    };
    attach(sources.attendance, (st, r) => { st.attendance[r.grade] = { absent: r.absent, late: r.late, early: r.early, missed: r.missed, volunteer: 0 }; });
    attach(sources.awards, (st, r) => { st.awards.push({ sem: r.sem, title: r.title }); });

    if (sources.attendance) {
      students.forEach((st) => {
        if (!st.attendance[1] && !st.attendance[2]) issues.push({ file: '출결상황', cell: '', text: `${st.no}번 ${st.name}의 출결이 없어 미인정 결석 0일로 넣었어요.` });
      });
    }
    const classes = Object.values(sources).filter(Boolean).map((s) => s.cls).filter(Boolean);
    if (new Set(classes).size > 1) issues.push({ file: '', cell: '', text: `파일마다 반이 달라요(${Array.from(new Set(classes)).join(', ')}). 같은 반 출력물인지 확인해 주세요.` });
    return { students: Array.from(students.values()).sort((a, b) => a.no - b.no), issues };
  }

  const api = { KINDS, detect, parseWorkbook, merge };
  root.Neis = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
