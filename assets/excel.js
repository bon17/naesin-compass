/*
 * 내신나침반 — 엑셀 읽기, 시트·열 이름 검사, 입력 양식 만들기 (SheetJS 사용)
 */
(function (root) {
  'use strict';

  const norm = (s) => String(s == null ? '' : s)
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/[\s·ㆍ_\-./]/g, '')
    .trim();

  // 받침에 따라 조사 고르기: josa('원점수', '으로') → '로'
  function josa(word, pair) {
    const ch = String(word).charCodeAt(String(word).length - 1);
    const has = ch >= 0xac00 && ch <= 0xd7a3 ? (ch - 0xac00) % 28 : 0;
    const map = { '으로': has && has !== 8 ? '으로' : '로', '을': has ? '을' : '를', '이': has ? '이' : '가', '은': has ? '은' : '는', '과': has ? '과' : '와' };
    return map[pair];
  }

  const NO = { key: 'no', name: '번호', alias: ['출석번호', '학생번호'] };
  const NAME = { key: 'name', name: '이름', alias: ['성명', '학생명', '학생이름'] };

  const SPECS = [
    {
      key: 'grades', name: '성적', required: true,
      guide: '한 줄에 한 과목. 학기는 2-1처럼 적고, 체육·음악·미술은 성취도(A~C)만 적어도 돼요.',
      cols: [
        NO, NAME,
        { key: 'sem', name: '학기', alias: ['학년학기'], hint: '1-2, 2-1처럼 학년-학기로 적어요.' },
        { key: 'subject', name: '과목', alias: ['과목명', '교과목'] },
        { key: 'ach', name: '성취도', alias: ['성취수준'], hint: 'A~E로 적어요.' },
        { key: 'raw', name: '원점수', alias: ['원점수100점'], hint: '100점 만점 원점수를 적는 열이에요.' },
      ],
    },
    {
      key: 'attendance', name: '출결', required: true,
      guide: '학년마다 한 줄. 질병·출석인정 결석은 빼고 미인정만 적어요.',
      cols: [
        NO, NAME,
        { key: 'grade', name: '학년', alias: [] },
        { key: 'absent', name: '미인정결석', alias: ['미인정결석일수'], hint: '질병·출석인정 결석은 빼고 미인정 결석 일수만 적어요.' },
        { key: 'late', name: '미인정지각', alias: [], hint: '미인정 지각 횟수예요.' },
        { key: 'early', name: '미인정조퇴', alias: [], hint: '미인정 조퇴 횟수예요.' },
        { key: 'missed', name: '미인정결과', alias: [], hint: '미인정 결과 횟수예요.' },
        { key: 'volunteer', name: '봉사시간', alias: ['봉사활동시간'], optional: true },
      ],
    },
    {
      key: 'awards', name: '수상', required: false,
      guide: '교내상만 적어요. 한 학기에 1개만 인정돼요.',
      cols: [NO, NAME, { key: 'sem', name: '학기', alias: ['학년학기'], hint: '1-2, 2-1처럼 학년-학기로 적어요.' }, { key: 'title', name: '수상명', alias: ['상명', '수상내역'] }],
    },
    {
      key: 'officers', name: '임원', required: false,
      guide: '학생회·학급 회장, 부회장 활동 개월 수. 기간이 겹치면 하나만 적어요.',
      cols: [NO, NAME, { key: 'role', name: '역할', alias: ['직책', '임원명'] }, { key: 'months', name: '개월', alias: ['개월수', '활동개월'], hint: '활동한 개월 수를 숫자로 적어요.' }],
    },
    {
      key: 'cutoffs', name: '커트라인', required: false,
      guide: '작년 합격 커트라인을 200점 만점 점수로 적어요.',
      cols: [{ key: 'school', name: '학교명', alias: ['학교'] }, { key: 'score', name: '커트라인', alias: ['합격선', '작년커트라인', '커트라인점수'], hint: '200점 만점 점수예요.' }],
    },
  ];

  const ARTS_SUBJECT = /^(체육|음악|미술)/;

  function cellAddr(table, i, j) {
    return root.XLSX.utils.encode_cell({ r: table.r0 + i, c: table.c0 + j });
  }

  function readSheet(ws) {
    if (!ws || !ws['!ref']) return { rows: [], r0: 0, c0: 0 };
    const range = root.XLSX.utils.decode_range(ws['!ref']);
    const rows = root.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
    return { rows, r0: range.s.r, c0: range.s.c };
  }

  function findSheet(names, wanted) {
    const w = norm(wanted);
    return names.find((n) => norm(n) === w) || names.find((n) => norm(n).indexOf(w) >= 0 && norm(n).length <= w.length + 3) || null;
  }

  function matchCol(spec, text) {
    const n = norm(text);
    if (!n) return null;
    return spec.cols.find((c) => norm(c.name) === n || c.alias.some((a) => norm(a) === n)) || null;
  }

  function findHeader(table, spec) {
    let best = null;
    const limit = Math.min(table.rows.length, 10);
    for (let i = 0; i < limit; i += 1) {
      const row = table.rows[i] || [];
      const map = {};
      const unmatched = [];
      let count = 0;
      row.forEach((cell, j) => {
        if (cell == null || String(cell).trim() === '') return;
        const col = matchCol(spec, cell);
        if (col && map[col.key] == null) { map[col.key] = j; count += 1; }
        else if (!col) unmatched.push({ j, text: String(cell).trim() });
      });
      if (count > 0 && (!best || count > best.count)) best = { i, map, unmatched, count, width: row.length };
    }
    return best;
  }

  function similarity(target, text) {
    const a = Array.from(new Set(norm(target)));
    const b = Array.from(new Set(norm(text)));
    if (!a.length || !b.length) return 0;
    const common = a.filter((ch) => b.indexOf(ch) >= 0).length;
    return common / Math.min(a.length, b.length);
  }

  function toText(v) {
    return v == null ? '' : String(v).trim();
  }

  function toNumber(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    const s = String(v).replace(/[점시간개월일회,\s]/g, '');
    if (s === '') return null;
    const n = Number(s);
    return isFinite(n) ? n : NaN;
  }

  function parseSem(v) {
    const s = toText(v).replace(/\s/g, '');
    const m = s.match(/^([123])(?:학년)?[-._·]?([12])(?:학기)?$/);
    return m ? `${m[1]}-${m[2]}` : null;
  }

  function parseGrade(v) {
    const m = toText(v).replace(/\s/g, '').match(/^([123])(?:학년)?$/);
    return m ? Number(m[1]) : null;
  }

  function parseNo(v) {
    const n = toNumber(v);
    return n != null && !isNaN(n) && n > 0 && Math.floor(n) === n ? String(n) : null;
  }

  /**
   * 워크북 → { ok, errors | students, cutoffs, issues }
   * errors: 시트·열 이름 문제(읽기 중단), issues: 칸 단위 확인 사항(해당 줄만 건너뜀)
   */
  function importWorkbook(wb, opts) {
    const fileName = (opts && opts.fileName) || '';
    const errors = [];
    const sheets = {};

    for (const spec of SPECS) {
      const sheetName = findSheet(wb.SheetNames, spec.name);
      if (!sheetName) {
        if (spec.required) {
          errors.push({
            sheet: spec.name, cell: '',
            text: `‘${spec.name}’ 시트가 없어요.`,
            hint: `지금 파일의 시트: ${wb.SheetNames.map((n) => `‘${n}’`).join(', ')}. 시트 이름을 ‘${spec.name}’${josa(spec.name, '으로')} 바꿔 주세요.`,
          });
        }
        continue;
      }
      const table = readSheet(wb.Sheets[sheetName]);
      const head = findHeader(table, spec);
      const needed = spec.cols.filter((c) => !c.optional);
      if (!head) {
        if (!table.rows.some((r) => r && r.some((c) => toText(c) !== ''))) {
          if (spec.required) errors.push({ sheet: sheetName, cell: 'A1', text: `‘${sheetName}’ 시트가 비어 있어요.`, hint: `1행에 ${needed.map((c) => `‘${c.name}’`).join(' · ')} 열 이름을 넣고 아래에 자료를 적어 주세요.` });
          continue;
        }
        errors.push({
          sheet: sheetName, cell: '1행',
          text: '열 이름 줄을 찾지 못했어요.',
          hint: `1행에 ${needed.map((c) => `‘${c.name}’`).join(' · ')} 순서로 열 이름을 적어 주세요.`,
        });
        continue;
      }
      const missing = needed.filter((c) => head.map[c.key] == null);
      if (missing.length) {
        const pool = head.unmatched.slice();
        let nextEmpty = head.width;
        for (const col of missing) {
          let best = null;
          pool.forEach((u) => {
            const s = similarity(col.name, u.text);
            if (s >= 0.5 && (!best || s > best.s)) best = { u, s };
          });
          if (best) {
            pool.splice(pool.indexOf(best.u), 1);
            errors.push({
              sheet: sheetName, cell: cellAddr(table, head.i, best.u.j),
              text: `‘${best.u.text}’${josa(best.u.text, '을')} ‘${col.name}’${josa(col.name, '으로')} 바꿔 주세요.`,
              hint: col.hint || '',
            });
          } else {
            errors.push({
              sheet: sheetName, cell: `${head.i + table.r0 + 1}행`,
              text: `‘${col.name}’ 열이 없어요.`,
              hint: `${cellAddr(table, head.i, nextEmpty)} 칸에 ‘${col.name}’ 열을 추가해 주세요. ${col.hint || ''}`.trim(),
            });
            nextEmpty += 1;
          }
        }
        continue;
      }
      sheets[spec.key] = { sheetName, table, head };
    }

    if (errors.length) return { ok: false, fileName, errors };

    const issues = [];
    const students = new Map();
    const issue = (sh, i, key, text) => {
      const j = key == null ? 0 : sh.head.map[key];
      issues.push({ sheet: sh.sheetName, cell: cellAddr(sh.table, i, j), text });
    };
    const rowsOf = (sh) => {
      const out = [];
      for (let i = sh.head.i + 1; i < sh.table.rows.length; i += 1) {
        const row = sh.table.rows[i];
        if (!row || row.every((c) => toText(c) === '')) continue;
        const get = (key) => (sh.head.map[key] == null ? null : row[sh.head.map[key]]);
        out.push({ i, get });
      }
      return out;
    };
    const studentFor = (sh, i, get, createIfMissing) => {
      const no = parseNo(get('no'));
      if (!no) {
        issue(sh, i, 'no', `번호 ‘${toText(get('no')) || '빈칸'}’${josa(toText(get('no')) || '빈칸', '을')} 읽지 못해 이 줄을 건너뛰었어요.`);
        return null;
      }
      const name = toText(get('name'));
      let st = students.get(no);
      if (!st) {
        if (!createIfMissing) {
          issue(sh, i, 'no', `${no}번 ${name}: ‘성적’ 시트에 없는 학생이라 이 줄을 건너뛰었어요.`);
          return null;
        }
        st = { id: no, no: Number(no), name, grades: [], attendance: {}, awards: [], officers: [], hasVolunteer: false };
        students.set(no, st);
      } else if (name && st.name && name !== st.name) {
        issue(sh, i, 'name', `${no}번 이름이 ‘${st.name}’${josa(st.name, '과')} 달라요(‘${name}’). 번호 기준으로 합쳤어요.`);
      }
      if (!st.name && name) st.name = name;
      return st;
    };

    // 성적
    const gs = sheets.grades;
    for (const { i, get } of rowsOf(gs)) {
      const st = studentFor(gs, i, get, true);
      if (!st) continue;
      const sem = parseSem(get('sem'));
      if (!sem) { issue(gs, i, 'sem', `학기 ‘${toText(get('sem')) || '빈칸'}’ — 2-1처럼 학년-학기로 적어 주세요. 이 줄은 건너뛰었어요.`); continue; }
      const subject = toText(get('subject'));
      if (!subject) { issue(gs, i, 'subject', '과목이 비어 있어 이 줄을 건너뛰었어요.'); continue; }
      const kind = ARTS_SUBJECT.test(subject) ? 'arts' : 'general';
      const achText = toText(get('ach')).toUpperCase();
      const raw = toNumber(get('raw'));
      if (kind === 'arts') {
        if (['A', 'B', 'C'].indexOf(achText) < 0) {
          issue(gs, i, 'ach', `${subject}(${sem}) 성취도 ‘${achText || '빈칸'}’ — 체육·예술은 A·B·C로 적어 주세요. 이 줄은 건너뛰었어요.`);
          continue;
        }
        st.grades.push({ sem, subject, kind, ach: achText, raw: raw != null && !isNaN(raw) ? raw : null });
        continue;
      }
      if (raw == null || isNaN(raw) || raw < 0 || raw > 100) {
        const why = raw == null ? '원점수가 비어 있어' : `원점수 ‘${toText(get('raw'))}’${josa(toText(get('raw')), '을')} 읽지 못해`;
        issue(gs, i, 'raw', `${subject}(${sem}) ${why} 계산에서 뺐어요. 0~100 사이 숫자로 적어 주세요.`);
        continue;
      }
      let ach = achText;
      if (['A', 'B', 'C', 'D', 'E'].indexOf(ach) < 0) {
        ach = root.Naesin.achFromRaw(raw);
        issue(gs, i, 'ach', `${subject}(${sem}) 성취도 ‘${achText || '빈칸'}’ 대신 원점수 ${raw}점 기준 ‘${ach}’${josa(ach, '으로')} 계산했어요.`);
      }
      st.grades.push({ sem, subject, kind, ach, raw });
    }
    if (!students.size) {
      return {
        ok: false, fileName,
        errors: [{ sheet: gs.sheetName, cell: `${gs.head.i + gs.table.r0 + 2}행`, text: '읽을 수 있는 성적 줄이 없어요.', hint: '열 이름 아래 줄부터 학생 성적을 적어 주세요.' }],
      };
    }

    // 출결
    const at = sheets.attendance;
    const hasVolunteer = at.head.map.volunteer != null;
    for (const { i, get } of rowsOf(at)) {
      const st = studentFor(at, i, get, false);
      if (!st) continue;
      const grade = parseGrade(get('grade'));
      if (!grade) { issue(at, i, 'grade', `학년 ‘${toText(get('grade')) || '빈칸'}’ — 1·2·3 중 하나로 적어 주세요. 이 줄은 건너뛰었어요.`); continue; }
      const rec = {};
      for (const key of ['absent', 'late', 'early', 'missed', 'volunteer']) {
        if (key === 'volunteer' && !hasVolunteer) { rec[key] = 0; continue; }
        const n = toNumber(get(key));
        if (n == null) rec[key] = 0;
        else if (isNaN(n) || n < 0) {
          rec[key] = 0;
          issue(at, i, key, `${st.no}번 ${grade}학년 ‘${toText(get(key))}’${josa(toText(get(key)), '을')} 숫자로 읽지 못해 0으로 넣었어요.`);
        } else rec[key] = key === 'volunteer' ? n : Math.floor(n);
      }
      if (st.attendance[grade]) issue(at, i, 'grade', `${st.no}번 ${grade}학년 줄이 두 번 있어 아래 줄을 썼어요.`);
      st.attendance[grade] = rec;
    }

    // 수상
    if (sheets.awards) {
      const aw = sheets.awards;
      for (const { i, get } of rowsOf(aw)) {
        const st = studentFor(aw, i, get, false);
        if (!st) continue;
        const sem = parseSem(get('sem'));
        if (!sem) { issue(aw, i, 'sem', `학기 ‘${toText(get('sem')) || '빈칸'}’ — 2-1처럼 적어 주세요. 이 수상은 건너뛰었어요.`); continue; }
        st.awards.push({ sem, title: toText(get('title')) || '(수상명 없음)' });
      }
    }

    // 임원
    if (sheets.officers) {
      const of = sheets.officers;
      for (const { i, get } of rowsOf(of)) {
        const st = studentFor(of, i, get, false);
        if (!st) continue;
        const months = toNumber(get('months'));
        if (months == null || isNaN(months) || months < 0) { issue(of, i, 'months', `개월 ‘${toText(get('months')) || '빈칸'}’ — 숫자로 적어 주세요. 이 줄은 건너뛰었어요.`); continue; }
        st.officers.push({ role: toText(get('role')) || '임원', months: Math.floor(months) });
      }
    }

    // 커트라인
    let cutoffs = null;
    if (sheets.cutoffs) {
      const cs = sheets.cutoffs;
      cutoffs = [];
      for (const { i, get } of rowsOf(cs)) {
        const school = toText(get('school'));
        const score = toNumber(get('score'));
        if (!school) { issue(cs, i, 'school', '학교명이 비어 있어 이 줄을 건너뛰었어요.'); continue; }
        if (score == null || isNaN(score) || score <= 0 || score > 200) { issue(cs, i, 'score', `${school} 커트라인 ‘${toText(get('score')) || '빈칸'}’ — 200점 이하 숫자로 적어 주세요.`); continue; }
        cutoffs.push({ id: `c${cutoffs.length + 1}-${Date.now().toString(36)}`, school, score });
      }
    }

    const list = Array.from(students.values()).sort((a, b) => a.no - b.no);
    list.forEach((st) => { st.hasVolunteer = hasVolunteer; });
    return { ok: true, fileName, students: list, cutoffs, issues, hasVolunteer };
  }

  // ---------- 예시 자료 (모두 가상) ----------

  function mulberry32(seed) {
    let a = seed;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const DEMO_NAMES = ['강하린', '고은우', '김도윤', '김서아', '남지후', '류하은', '박서연', '배준서', '서다인', '손유찬', '송예린', '신하준', '안소율', '양지안', '오태윤', '유채원', '윤건우', '이나윤', '이도현', '임수빈', '장민재', '전아린', '정우진', '조하율', '차예준', '최지유', '한서진', '허윤호'];
  const DEMO_SUBJECTS = {
    '1-2': ['국어', '수학', '영어', '사회', '과학', '정보'],
    '2-1': ['국어', '수학', '영어', '역사', '과학', '기술·가정', '도덕'],
  };
  const DEMO_AWARDS = ['과학탐구대회 장려상', '독서토론대회 우수상', '모범상', '영어말하기대회 동상', '수학경시대회 은상', '선행상'];
  const DEMO_CUTOFFS = [['가온고', 186.2], ['나래고', 178.45], ['다솜고', 172.9], ['라온고', 165.3], ['마루고', 158.0]];

  /** 시트별 2차원 배열(열 이름 줄 포함)로 가상 학생 자료 만들기 */
  function demoRows(count, seed) {
    const rnd = mulberry32(seed || 20261013);
    const grades = [['번호', '이름', '학기', '과목', '성취도', '원점수']];
    const attendance = [['번호', '이름', '학년', '미인정결석', '미인정지각', '미인정조퇴', '미인정결과', '봉사시간']];
    const awards = [['번호', '이름', '학기', '수상명']];
    const officers = [['번호', '이름', '역할', '개월']];
    const n = Math.min(count, DEMO_NAMES.length);
    for (let k = 0; k < n; k += 1) {
      const no = k + 1;
      const name = DEMO_NAMES[k];
      const mu = no === 7 ? 84 : 64 + rnd() * 32;
      const offsets = {};
      for (const sem of Object.keys(DEMO_SUBJECTS)) {
        for (const subject of DEMO_SUBJECTS[sem]) {
          if (offsets[subject] == null) offsets[subject] = (rnd() - 0.5) * 14;
          const raw = Math.max(35, Math.min(100, Math.round(mu + offsets[subject] + (rnd() - 0.5) * 8)));
          grades.push([no, name, sem, subject, root.Naesin.achFromRaw(raw), raw]);
        }
        for (const subject of ['체육', '음악', '미술']) {
          const lv = mu + (rnd() - 0.5) * 24;
          grades.push([no, name, sem, subject, lv >= 82 ? 'A' : lv >= 66 ? 'B' : 'C', null]);
        }
      }
      for (const grade of [1, 2]) {
        const absent = rnd() < 0.12 ? 1 + Math.floor(rnd() * 2) : 0;
        const late = rnd() < 0.3 ? Math.floor(rnd() * 5) : 0;
        const early = rnd() < 0.15 ? Math.floor(rnd() * 3) : 0;
        attendance.push([no, name, grade, absent, late, early, 0, 3 + Math.floor(rnd() * 7)]);
      }
      const awardCount = Math.floor(rnd() * 3.2);
      ['1-1', '1-2', '2-1'].slice(0, awardCount).forEach((sem) => {
        awards.push([no, name, sem, DEMO_AWARDS[Math.floor(rnd() * DEMO_AWARDS.length)]]);
      });
      if (rnd() < 0.22) officers.push([no, name, rnd() < 0.5 ? '학급회장' : '학급부회장', 5 + Math.floor(rnd() * 2)]);
    }
    const cutoffs = [['학교명', '커트라인']].concat(DEMO_CUTOFFS.map((c) => c.slice()));
    return { 성적: grades, 출결: attendance, 수상: awards, 임원: officers, 커트라인: cutoffs };
  }

  const GUIDE_ROWS = [
    ['내신나침반 입력 양식'],
    ['아래 시트의 1행 열 이름은 바꾸지 말고, 2행부터 자료를 적어 주세요. 예시 줄은 지우고 쓰면 돼요.'],
    [],
    ['시트', '필수', '열 이름', '적는 방법'],
  ].concat(SPECS.map((s) => [s.name, s.required ? '필수' : '선택', s.cols.map((c) => c.name).join(' · '), s.guide]))
    .concat([[], ['봉사시간 열은 2027학년도 지침으로 계산할 때만 써요.'], ['예시의 학생 이름·점수·학교는 모두 가상이에요.']]);

  function buildWorkbook(sheetRows, withGuide) {
    const X = root.XLSX;
    const wb = X.utils.book_new();
    if (withGuide) {
      const g = X.utils.aoa_to_sheet(GUIDE_ROWS);
      g['!cols'] = [{ wch: 10 }, { wch: 6 }, { wch: 52 }, { wch: 60 }];
      X.utils.book_append_sheet(wb, g, '안내');
    }
    for (const name of Object.keys(sheetRows)) {
      const ws = X.utils.aoa_to_sheet(sheetRows[name]);
      ws['!cols'] = sheetRows[name][0].map((h) => ({ wch: Math.max(8, String(h).length * 2 + 4) }));
      X.utils.book_append_sheet(wb, ws, name);
    }
    return wb;
  }

  function downloadTemplate() {
    const rows = demoRows(3, 11);
    root.XLSX.writeFile(buildWorkbook(rows, true), '내신나침반_입력양식.xlsx');
  }

  root.Excel = { SPECS, importWorkbook, demoRows, buildWorkbook, downloadTemplate, josa, norm };
})(window);
