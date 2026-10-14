/*
 * 내신나침반 — 경기도 고등학교 입학 내신성적 산출 규칙과 계산
 * 근거: 경기도교육청 「2028학년도 경기도 고등학교 입학 내신성적 반영지침 예고(안)」(2025.3.)
 *       경기도교육청 「2027학년도 경기도 고등학교 입학 내신성적 반영지침」(2026.3.)
 */
(function (root) {
  'use strict';

  // 교과활동상황 반영 학기 (1학년 2학기, 2·3학년)
  const SEMESTERS = ['1-2', '2-1', '2-2', '3-1', '3-2'];
  // 수상은 전 학년(3학년 10월 말까지) 학기마다 1개 인정. 상담 중 '받을 예정'으로 고를 수 있는 학기
  const AWARD_SEMS = ['1-1', '1-2', '2-1', '2-2', '3-1', '3-2'];
  const PLANNABLE_AWARD_SEMS = ['2-2', '3-1', '3-2'];
  const ACH_POINT = { A: 5, B: 4, C: 3, D: 2, E: 1 };
  const ARTS_POINT = { A: 3, B: 2, C: 1 };
  // 학년별 미인정 결석일수 0,1,2,3,4,5,6일 이상 → 반영 비율
  const ATTENDANCE_RATE = [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4];

  // 학기별 일반교과: 기본점수 + 성취도 평균 × ach + 원점수 평균 × raw
  const GENERAL = {
    '1-2': { base: 4, ach: 0.8, raw: 0.04, max: 12 },
    '2-1': { base: 8, ach: 1.6, raw: 0.08, max: 24 },
    '2-2': { base: 8, ach: 1.6, raw: 0.08, max: 24 },
    '3-1': { base: 10, ach: 2, raw: 0.1, max: 30 },
    '3-2': { base: 10, ach: 2, raw: 0.1, max: 30 },
  };

  const RULES = {
    '2028': {
      key: '2028',
      label: '2028학년도 지침 예고안',
      note: '현 중학교 2학년 대상 · 출결 40점, 봉사 미반영',
      general: GENERAL,
      generalMax: 120,
      artsMax: 30,
      attendance: { 1: 13, 2: 13, 3: 14 },
      attendanceMax: 40,
      volunteer: false,
      activityMax: 10,
    },
    '2027': {
      key: '2027',
      label: '2027학년도 지침',
      note: '현 중학교 3학년 대상 · 출결 20점, 봉사 20점',
      general: GENERAL,
      generalMax: 120,
      artsMax: 30,
      attendance: { 1: 6, 2: 7, 3: 7 },
      attendanceMax: 20,
      volunteer: true,
      volunteerMax: 20,
      activityMax: 10,
    },
  };

  const SEM_LABEL = {
    '1-1': '1학년 1학기', '1-2': '1학년 2학기', '2-1': '2학년 1학기',
    '2-2': '2학년 2학기', '3-1': '3학년 1학기', '3-2': '3학년 2학기',
  };

  // 학기별 점수는 소수 넷째 자리에서 반올림하여 셋째 자리까지
  const round3 = (x) => Math.round((x + 1e-10) * 1000) / 1000;
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

  // 원점수만 있고 성취도가 없을 때 지침의 환산 기준
  function achFromRaw(t) {
    if (t >= 90) return 'A';
    if (t >= 80) return 'B';
    if (t >= 70) return 'C';
    if (t >= 60) return 'D';
    return 'E';
  }

  function semStats(list) {
    return {
      n: list.length,
      achAvg: mean(list.map((g) => ACH_POINT[g.ach])),
      rawAvg: mean(list.map((g) => g.raw)),
    };
  }

  function semScore(rule, stats) {
    return round3(rule.base + rule.ach * stats.achAvg + rule.raw * stats.rawAvg);
  }

  function attendanceScore(rules, grade, days) {
    return round3(rules.attendance[grade] * ATTENDANCE_RATE[Math.min(days, 6)]);
  }

  function absenceDays(a) {
    // 미인정 지각·조퇴·결과는 학년 단위로 합산해 3회를 결석 1일로 계산
    return a.absent + Math.floor((a.late + a.early + a.missed) / 3);
  }

  function volunteerScore(hours) {
    const h = Math.floor(hours);
    if (h >= 15) return 20;
    if (h >= 8) return h + 5;
    return 12;
  }

  /**
   * 한 학생의 200점 만점 예상 내신.
   * 아직 성적이 없는 학기는 지금까지 반영 학기 평균이 이어진다고 보고 '예상'으로 채운다.
   * opts.plannedAwards: 상담 중 '받을 예정'으로 고른 학기들(2-2, 3-1, 3-2 중 아직 상이 없는 학기)
   */
  function compute(student, basis, opts) {
    const planned = ((opts && opts.plannedAwards) || []).filter((s) => PLANNABLE_AWARD_SEMS.indexOf(s) >= 0);
    const R = RULES[basis] || RULES['2028'];
    const flags = [];
    const general = {};
    const arts = {};
    for (const g of student.grades) {
      const bucket = g.kind === 'arts' ? arts : general;
      (bucket[g.sem] = bucket[g.sem] || []).push(g);
    }

    const actual = {};
    for (const sem of ['1-1'].concat(SEMESTERS)) {
      if (general[sem] && general[sem].length) actual[sem] = semStats(general[sem]);
    }
    const trendSems = SEMESTERS.filter((s) => actual[s]);
    const trendBase = trendSems.length ? trendSems : actual['1-1'] ? ['1-1'] : [];
    if (!trendBase.length) {
      return { ok: false, flags: ['일반교과 성적이 없어 산출하지 못했어요.'] };
    }
    const trend = {
      n: null,
      achAvg: mean(trendBase.map((s) => actual[s].achAvg)),
      rawAvg: mean(trendBase.map((s) => actual[s].rawAvg)),
    };

    const semesters = SEMESTERS.map((sem) => {
      const rule = R.general[sem];
      if (actual[sem]) {
        return { sem, status: 'actual', stats: actual[sem], score: semScore(rule, actual[sem]), max: rule.max };
      }
      // 지침 유의사항 3: 학년 내 다른 학기 → 차상위 학년 순으로 대체
      const subFrom = sem === '1-2' ? (actual['1-1'] ? '1-1' : actual['2-1'] ? '2-1' : null)
        : sem === '2-1' ? (actual['2-2'] ? '2-2' : null)
        : null;
      if (subFrom) {
        flags.push(`${SEM_LABEL[sem]} 성적이 없어 ${SEM_LABEL[subFrom]} 성적으로 대신 계산했어요.`);
        return { sem, status: 'substitute', from: subFrom, stats: actual[subFrom], score: semScore(rule, actual[subFrom]), max: rule.max };
      }
      if (sem === '1-2' || sem === '2-1') {
        flags.push(`${SEM_LABEL[sem]} 성적이 없어 지금까지 평균으로 넣었어요.`);
      }
      return { sem, status: 'projected', stats: trend, score: semScore(rule, trend), max: rule.max };
    });
    const generalScore = round3(semesters.reduce((a, s) => a + s.score, 0));

    // 체육·예술: 반영 학기의 A·B·C 개수 비율. 3학년은 같은 비율이 이어진다고 본다.
    let artsList = SEMESTERS.flatMap((s) => arts[s] || []);
    if (!(arts['1-2'] && arts['1-2'].length) && arts['1-1']) artsList = artsList.concat(arts['1-1']);
    const counts = { A: 0, B: 0, C: 0 };
    artsList.forEach((g) => { counts[g.ach] += 1; });
    let artsScore = 0;
    if (artsList.length) {
      artsScore = round3(10 + (20 * (3 * counts.A + 2 * counts.B + counts.C)) / (3 * artsList.length));
    } else {
      flags.push('체육·예술 성적이 없어 0점으로 넣었어요.');
    }
    const artsProjected = !(arts['3-1'] && arts['3-2']);

    // 출결: 학년 단위. 3학년은 미인정 결석 0일(만점)로 본다(교사와 정한 가정).
    const attGrades = [1, 2, 3].map((grade) => {
      const a = student.attendance[grade];
      if (a) {
        const days = absenceDays(a);
        return { grade, status: 'actual', days, raw: a, score: attendanceScore(R, grade, days), max: R.attendance[grade] };
      }
      return null;
    });
    for (const i of [0, 1, 2]) {
      if (attGrades[i]) continue;
      const grade = i + 1;
      const status = grade === 3 ? 'projected' : 'missing';
      if (status === 'missing') flags.push(`${grade}학년 출결이 없어 미인정 결석 0일로 넣었어요.`);
      attGrades[i] = { grade, status, days: 0, raw: null, score: attendanceScore(R, grade, 0), max: R.attendance[grade] };
    }
    const attendanceTotal = round3(attGrades.reduce((a, g) => a + g.score, 0));

    // 학교활동: 기본 8점 + 수상(학기당 1개, 0.5점) + 자치회 임원(월 0.1점), 가산 합계 2점 이내
    const awardSemesters = Array.from(new Set(student.awards.map((a) => a.sem))).sort();
    const plannedAwards = Array.from(new Set(planned)).filter((s) => awardSemesters.indexOf(s) < 0).sort();
    const officerMonths = student.officers.reduce((a, o) => a + o.months, 0);
    const activityExtra = Math.min(2, (awardSemesters.length + plannedAwards.length) * 0.5 + officerMonths * 0.1);
    const activityScore = round3(8 + activityExtra);

    let volunteer = null;
    if (R.volunteer) {
      const hours = [1, 2, 3].reduce((a, g) => a + ((student.attendance[g] && student.attendance[g].volunteer) || 0), 0);
      if (!student.hasVolunteer) flags.push('봉사시간 자료가 없어 0시간으로 넣었어요.');
      volunteer = { hours, score: volunteerScore(hours), max: R.volunteerMax };
    }

    const total = round3(generalScore + artsScore + attendanceTotal + activityScore + (volunteer ? volunteer.score : 0));

    return {
      ok: true,
      basis: R.key,
      semesters,
      general: { score: generalScore, max: R.generalMax },
      arts: { score: artsScore, max: R.artsMax, counts, n: artsList.length, projected: artsProjected },
      attendance: { grades: attGrades, score: attendanceTotal, max: R.attendanceMax },
      activity: { awardSemesters, plannedAwards, officerMonths, extra: round3(activityExtra), score: activityScore, max: R.activityMax },
      volunteer,
      total,
      flags,
    };
  }

  // 과목별 지금까지 평균 (반영 학기의 일반교과). 3학년 과목은 가장 최근 학기 과목을 따른다고 본다.
  function subjectBaseline(student) {
    const general = student.grades.filter((g) => g.kind === 'general' && SEMESTERS.indexOf(g.sem) >= 0);
    const pool = general.length ? general : student.grades.filter((g) => g.kind === 'general');
    if (!pool.length) return [];
    const latestSem = pool.map((g) => g.sem).sort().pop();
    const latestSubjects = [];
    pool.filter((g) => g.sem === latestSem).forEach((g) => {
      if (latestSubjects.indexOf(g.subject) < 0) latestSubjects.push(g.subject);
    });
    return latestSubjects.map((subject) => {
      const rows = pool.filter((g) => g.subject === subject).sort((a, b) => (a.sem < b.sem ? -1 : 1));
      return {
        subject,
        avg: round3(mean(rows.map((g) => g.raw))),
        history: rows.map((g) => ({ sem: g.sem, ach: g.ach, raw: g.raw })),
      };
    });
  }

  function planScore(rule, targets) {
    return semScore(rule, {
      achAvg: mean(targets.map((t) => ACH_POINT[achFromRaw(t)])),
      rawAvg: mean(targets),
    });
  }

  function nextStep(t) {
    // 다음 성취도 경계까지, A 구간이면 1점
    if (t >= 100) return null;
    if (t >= 90) return t + 1;
    return t >= 80 ? 90 : t >= 70 ? 80 : t >= 60 ? 70 : 60;
  }

  /**
   * 3학년 과목별 목표 원점수 제안.
   * 다음 성취도까지 남은 점수가 적은(점수 대비 효과가 큰) 과목부터 올려 필요한 학기 점수에 닿게 한다.
   */
  function subjectTargets(rule, baseline, need) {
    const targets = baseline.map((b) => Math.max(0, Math.min(100, Math.round(b.avg))));
    let guard = 0;
    while (planScore(rule, targets) < need - 1e-9 && guard < 2000) {
      guard += 1;
      const moves = [];
      targets.forEach((t, i) => {
        const to = nextStep(t);
        if (to === null) return;
        const gainPerSubject = 2 * (ACH_POINT[achFromRaw(to)] - ACH_POINT[achFromRaw(t)]) + 0.1 * (to - t);
        moves.push({ i, to, cost: to - t, eff: gainPerSubject / (to - t) });
        if (to - t > 1) moves.push({ i, to: t + 1, cost: 1, eff: 0.1 });
      });
      if (!moves.length) break;
      // 한 번에 끝낼 수 있는 가장 싼 이동이 있으면 그것으로 마무리
      const finishing = moves.filter((m) => {
        const next = targets.slice();
        next[m.i] = m.to;
        return planScore(rule, next) >= need - 1e-9;
      }).sort((a, b) => a.cost - b.cost || a.i - b.i);
      const move = finishing[0] || moves.sort((a, b) => b.eff - a.eff || a.cost - b.cost || a.i - b.i)[0];
      targets[move.i] = move.to;
    }
    return targets;
  }

  /**
   * 목표 학교 커트라인에 닿기 위해 3학년에 필요한 성적 역산.
   */
  function plan(student, result, basis, cutoff) {
    const R = RULES[basis] || RULES['2028'];
    const margin = round3(result.total - cutoff);
    const open = result.semesters.filter((s) => s.sem.charAt(0) === '3' && s.status === 'projected');
    if (!open.length) {
      return { mode: 'fixed', margin, reached: margin >= 0 };
    }
    const rule = R.general['3-1'];
    const fixedPart = result.total - open.reduce((a, s) => a + s.score, 0);
    const needSum = cutoff - fixedPart;
    const needPer = round3(needSum / open.length);
    const trendPer = open[0].score;
    const minPer = rule.base + rule.ach * 1; // 전 과목 E, 원점수 0점
    const baseline = subjectBaseline(student);
    const curAvg = baseline.length ? round3(mean(baseline.map((b) => b.avg))) : null;

    let status;
    if (needPer > rule.max + 1e-9) status = 'impossible';
    else if (margin >= 0) status = 'reach';
    else status = 'raise';

    let rows = [];
    if (status !== 'impossible' && baseline.length) {
      const goal = Math.max(needPer, minPer);
      const targets = status === 'reach'
        ? baseline.map((b) => Math.max(0, Math.min(100, Math.round(b.avg))))
        : subjectTargets(rule, baseline, goal);
      rows = baseline.map((b, i) => ({
        subject: b.subject,
        avg: b.avg,
        history: b.history,
        target: targets[i],
        targetAch: achFromRaw(targets[i]),
        diff: round3(targets[i] - b.avg),
      }));
    }
    const targetAvg = rows.length ? round3(mean(rows.map((r) => r.target))) : null;

    return {
      mode: 'open',
      status,
      margin,
      semesters: open.map((s) => s.sem),
      needPer,
      trendPer,
      maxPer: rule.max,
      shortfallAtMax: status === 'impossible' ? round3(needSum - rule.max * open.length) : 0,
      curAvg,
      targetAvg,
      rows,
    };
  }

  root.Naesin = {
    RULES,
    SEMESTERS,
    AWARD_SEMS,
    PLANNABLE_AWARD_SEMS,
    SEM_LABEL,
    ACH_POINT,
    ARTS_POINT,
    ATTENDANCE_RATE,
    achFromRaw,
    semScore,
    round3,
    compute,
    plan,
    subjectBaseline,
    absenceDays,
    volunteerScore,
  };
})(typeof window !== 'undefined' ? window : globalThis);
