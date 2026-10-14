/*
 * 내신나침반 — 상담 탭: 학생과 함께 보는 예상 총점, 목표 학교 비교, 3학년 필요 성적
 */
(function (root) {
  'use strict';

  const { esc, fmt, signed, maskName, computeAll, computeOne, validCutoffs, cutYears, brandMark, guideButton, BASIS } = root.UI;
  const N = root.Naesin;

  // 사용 안내(둘러보기) 단계. 태블릿에서만 있는 잠그기는 없으면 건너뛴다
  const TOUR = [
    { target: '.view-tabs', title: '세 화면을 오가요',
      body: ['‘상담’은 이 학생의 예상 총점과 목표 학교 비교예요.', '‘학교 커트라인’은 학교별 최근 4년 커트라인을 이 학생 점수와 함께 보여 줘요.', '‘산출 기준’은 내신이 어떻게 계산되는지 학생에게 설명할 때 써요.'] },
    { target: '.stepper', title: '학생을 넘겨요',
      body: ['‹ › 나 목록으로 학생을 바꿔요. 목록의 다른 학생 이름은 <strong>김○○</strong>처럼 가려져요.', '큰 이름은 지금 상담하는 학생만 전체로 보여요.'] },
    { target: '.tool-field', title: '목표 학교를 골라요',
      body: ['가장 최근 해 커트라인과 비교해 도달·부족을 바로 알려 줘요. 4년 값도 함께 나와요.', '아래 ‘입력한 학교 전체 비교’에서 학교를 눌러도 바뀌어요.'] },
    { target: '.award-plan', optional: true, title: '3학년 수상 계획을 넣어 봐요',
      body: ['상이 없는 학기의 <strong>‘받으면?’</strong>을 누르면 학교활동 점수와 판정이 바로 바뀌어요.', '상은 학기마다 1개만 0.5점, 임원과 합쳐 2점까지예요.'] },
    { target: () => document.querySelector('.verdict') || document.querySelector('.panel.target'), title: '3학년에 필요한 점수를 봐요',
      body: ['목표 학교에 닿으려면 3학년 학기마다 일반교과에서 몇 점이 필요한지 보여 줘요.', '과목별 목표 원점수는 다음 성취도까지 남은 점수가 적은 과목부터 높였어요.'] },
    { target: '#lockNow', optional: true, title: '상담이 끝나면 잠가요',
      body: ['잠그면 암호 4자리를 다시 눌러야 열려요.', '다른 앱에 5분 넘게 가 있어도 저절로 잠겨요.'] },
  ];

  let host = null;
  let unsub = null;
  let currentId = '';
  let planned = []; // 지금 보는 학생에게 '받을 예정'으로 고른 수상 학기
  let options = {}; // 태블릿 앱이 머리 오른쪽에 보관 기간·잠그기 버튼을 넣을 때 쓴다(aside)
  let tab = 'counsel'; // 'counsel' 상담 · 'rules' 내신 산출 기준(학생에게 보여 주는 설명)

  function header() {
    return `
      <header class="app-head">
        <div class="wrap app-head-inner">
          <div>
            <h1 class="app-name">${brandMark(32)}<span>내신나침반</span> <span class="app-sub">상담</span></h1>
            <p class="purpose">목표 학교를 고르면 지금 성적이 이어질 때의 예상 총점을 최근 커트라인과 비교하고, 3학년에 필요한 성적을 계산합니다.</p>
          </div>
          <div class="app-aside">${options.aside || ''}${guideButton('guideCounsel')}</div>
        </div>
      </header>`;
  }

  // '2학년 2학기, 3학년 1·2학기'
  function semesterPhrase(sems) {
    const byGrade = {};
    sems.forEach((s) => { (byGrade[s.charAt(0)] = byGrade[s.charAt(0)] || []).push(s.charAt(2)); });
    return Object.keys(byGrade).sort().map((g) => `${g}학년 ${byGrade[g].join('·')}학기`).join(', ');
  }

  function toolbar(s, rows, current, cutoffs) {
    const idx = rows.findIndex((x) => x.student.id === current.student.id);
    const studentOptions = rows.map(({ student: st }) =>
      `<option value="${esc(st.id)}"${st.id === current.student.id ? ' selected' : ''}>${st.no}번 ${esc(maskName(st.name))}</option>`).join('');
    const schoolOptions = ['<option value="">학교를 고르세요</option>']
      .concat(cutoffs.map((c) => `<option value="${esc(c.id)}"${c.id === s.counselSchool ? ' selected' : ''}>${esc(c.school)} (${fmt(c.score)})</option>`))
      .join('');
    const tabBtn = (key, id, label) => `<button type="button" class="view-tab${tab === key ? ' is-on' : ''}" id="${id}" data-tab="${key}" aria-pressed="${tab === key}">${label}</button>`;
    return `
      <div class="toolbar">
        <div class="wrap toolbar-inner">
          <div class="view-tabs" role="group" aria-label="화면 고르기">${tabBtn('counsel', 'tabCounsel', '상담')}${tabBtn('schools', 'tabSchools', '학교 커트라인')}${tabBtn('rules', 'tabRules', '산출 기준')}</div>
          <div class="stepper" role="group" aria-label="학생 고르기">
            <button type="button" class="btn btn-quiet btn-square" id="prevStudent" aria-label="이전 학생"${idx <= 0 ? ' disabled' : ''}>‹</button>
            <select id="student" class="select" aria-label="학생">${studentOptions}</select>
            <button type="button" class="btn btn-quiet btn-square" id="nextStudent" aria-label="다음 학생"${idx >= rows.length - 1 ? ' disabled' : ''}>›</button>
          </div>
          <label class="tool-field">
            <span class="tool-label">목표 학교</span>
            <select id="school" class="select"${cutoffs.length ? '' : ' disabled'}>${schoolOptions}</select>
          </label>
          <p class="tool-status"><span class="desc">${esc(N.RULES[BASIS].label)} 기준</span></p>
        </div>
      </div>`;
  }

  function summary(st, r) {
    const parts = [
      ['일반교과', r.general.score, r.general.max],
      ['체육·예술', r.arts.score, r.arts.max],
      ['출결', r.attendance.score, r.attendance.max],
    ];
    if (r.volunteer) parts.push(['봉사활동', r.volunteer.score, r.volunteer.max]);
    parts.push(['학교활동', r.activity.score, r.activity.max]);
    const projected = r.semesters.filter((x) => x.status === 'projected').map((x) => x.sem);
    return `
      <section class="panel summary" aria-labelledby="t-student">
        <h2 id="t-student" class="student-name">${st.no}번 ${esc(st.name)}</h2>
        <p class="desc">지금 성적이 3학년까지 이어질 때 예상 총점</p>
        <p class="total-line"><strong class="num-xl">${fmt(r.total)}</strong><span class="max">/ 200</span></p>
        <dl class="parts">
          ${parts.map(([k, v, m]) => `<div><dt>${k}</dt><dd><strong>${fmt(v)}</strong><span class="max">/${m}</span></dd></div>`).join('')}
        </dl>
        <p class="note">${projected.length ? `아직 성적이 없는 ${semesterPhrase(projected)}는 지금까지의 평균이, ` : ''}3학년 출결은 미인정 결석 0일로 보고 계산했어요.${r.activity.plannedAwards.length ? ' ‘받을 예정’으로 고른 상도 넣었어요.' : ''}</p>
        ${awardPlan(st, r)}
      </section>`;
  }

  // 학기별 수상 내역과 '받을 예정' 고르기: 학기마다 1개만 0.5점, 임원과 합쳐 가산 2점까지
  function awardPlan(st, r) {
    const bySem = {};
    st.awards.forEach((a) => { (bySem[a.sem] = bySem[a.sem] || []).push(a.title); });
    const act = r.activity;
    const rows = N.AWARD_SEMS.map((sem) => {
      const got = bySem[sem] || [];
      const plannable = N.PLANNABLE_AWARD_SEMS.indexOf(sem) >= 0 && !got.length;
      const on = act.plannedAwards.indexOf(sem) >= 0;
      // 태블릿으로는 수상명 없이 개수만 보낸다
      const what = got.length
        ? `${got.length}개${got[0] ? ` <span class="desc">${esc(got[0])}${got.length > 1 ? ` 외 ${got.length - 1}개` : ''}</span>` : ''}`
        : plannable ? '<span class="desc">아직 없음</span>' : '0개';
      const pts = got.length
        ? `0.5${got.length > 1 ? '<span class="desc"> 1개만 인정</span>' : ''}`
        : on ? '<strong class="plan-plus">+0.5</strong>' : '<span class="desc">0</span>';
      const action = plannable
        ? `<button type="button" class="pill${on ? ' is-on' : ''}" data-plan="${sem}" aria-pressed="${on}">${on ? '받을 예정 ✓' : '받으면?'}</button>`
        : '';
      return `<tr${on ? ' class="is-planned"' : ''}><th scope="row">${N.SEM_LABEL[sem]}</th><td><div class="award-cell"><span>${what}</span>${action}</div></td><td class="num">${pts}</td></tr>`;
    }).join('');

    const awardPts = (act.awardSemesters.length + act.plannedAwards.length) * 0.5;
    const open = N.PLANNABLE_AWARD_SEMS.filter((sem) => !bySem[sem] && act.plannedAwards.indexOf(sem) < 0);
    const remaining = Math.round((2 - act.extra) * 10) / 10;
    let advice;
    if (remaining <= 0) advice = '가산 2점을 다 채워 학교활동이 만점(10점)이에요. 상을 더 받아도 점수는 오르지 않아요.';
    else if (!open.length) advice = `남은 학기가 없어 학교활동은 ${fmt(act.score, 1)}점이에요.`;
    else {
      const need = Math.ceil(remaining / 0.5 - 1e-9);
      advice = need <= open.length
        ? `만점(10점)까지 ${fmt(remaining, 1)}점 남았어요. ${semesterPhrase(open.slice(0, need))}에 상을 ${need > 1 ? '1개씩' : '1개'} 받으면 만점이에요.`
        : `만점까지 ${fmt(remaining, 1)}점 남았어요. 남은 ${semesterPhrase(open)}에 모두 받아도 ${fmt(act.score + open.length * 0.5, 1)}점까지예요.`;
    }
    return `
      <div class="award-plan">
        <h3 class="mini-title">학교활동 · 수상 <span class="desc">학기마다 1개만 0.5점</span></h3>
        <div class="table-wrap"><table class="table mini award-table">
          <thead><tr><th scope="col">학기</th><th scope="col">받은 상</th><th class="num" scope="col">점수</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
        <p class="award-sum">수상 ${fmt(awardPts, 1)} + 임원 ${act.officerMonths}개월 ${fmt(act.officerMonths * 0.1, 1)} → 가산 <strong>${fmt(act.extra, 1)}</strong><span class="desc"> / 2점</span> · 학교활동 <strong>${fmt(act.score, 1)}</strong><span class="desc"> / 10</span></p>
        <p class="award-advice">${advice}</p>
      </div>`;
  }

  function gauge(total, cutoff, year) {
    const lo = Math.max(0, Math.floor(Math.min(total, cutoff) - 8));
    const hi = Math.min(200, Math.ceil(Math.max(total, cutoff) + 4));
    const pos = (v) => `${(((v - lo) / (hi - lo)) * 100).toFixed(1)}%`;
    return `
      <div class="gauge" aria-hidden="true">
        <div class="gauge-track">
          <div class="gauge-fill" style="width:${pos(total)}"></div>
          <div class="gauge-mark" style="left:${pos(cutoff)}"></div>
        </div>
        <div class="gauge-legend">
          <span><i class="key key-fill"></i>예상 총점 ${fmt(total, 1)}</span>
          <span><i class="key key-mark"></i>${year}학년도 커트라인 ${fmt(cutoff, 1)}</span>
        </div>
      </div>`;
  }

  function planTable(p) {
    if (!p.rows.length) return '';
    const unchanged = (row) => row.target === Math.round(row.avg);
    return `
      <h3 class="mini-title">3학년 과목별 목표 원점수 <span class="desc">학기마다</span></h3>
      <div class="table-wrap">
        <table class="table plan">
          <thead><tr><th scope="col">과목</th><th class="num" scope="col">지금까지 평균</th><th class="num" scope="col">3학년 목표</th><th class="num" scope="col">변화</th></tr></thead>
          <tbody>
            ${p.rows.map((row) => `
              <tr>
                <th scope="row">${esc(row.subject)}</th>
                <td class="num">${fmt(row.avg, 1)} <span class="ach">${N.achFromRaw(row.avg)}</span></td>
                <td class="num"><strong>${row.target}</strong> <span class="ach${row.targetAch !== N.achFromRaw(row.avg) ? ' ach-up' : ''}">${row.targetAch}</span></td>
                <td class="num">${unchanged(row) ? '<span class="desc">유지</span>' : `<span class="up">${signed(row.diff, 1)}</span>`}</td>
              </tr>`).join('')}
          </tbody>
          <tfoot>
            <tr><th scope="row">평균</th><td class="num">${fmt(p.curAvg, 1)}</td><td class="num"><strong>${fmt(p.targetAvg, 1)}</strong></td><td class="num">${signed(p.targetAvg - p.curAvg, 1)}</td></tr>
          </tfoot>
        </table>
      </div>
      <p class="desc">성취도는 원점수 90·80·70·60점 기준으로 바꿔 보여 줘요.${p.status === 'raise' ? ' 다음 성취도까지 남은 점수가 적은 과목부터 목표를 높였어요.' : ''}</p>`;
  }

  function verdict(r, p, cut) {
    const semPhrase = p.mode === 'open' ? semesterPhrase(p.semesters) : '';
    let main;
    let tone;
    if (p.mode === 'fixed') {
      tone = p.reached ? 'ok' : 'bad';
      main = p.reached ? `커트라인보다 <strong>${fmt(p.margin)}점</strong> 높아요` : `커트라인까지 <strong>${fmt(-p.margin)}점</strong> 모자라요`;
    } else if (p.status === 'reach') {
      tone = 'ok';
      main = `지금 추세로 도달해요 · 여유 <strong>${fmt(p.margin)}점</strong>`;
    } else if (p.status === 'raise') {
      tone = 'warn';
      main = `지금 추세로는 <strong>${fmt(-p.margin)}점</strong> 부족해요`;
    } else {
      tone = 'bad';
      main = `3학년 일반교과가 모두 만점이어도 <strong>${fmt(p.shortfallAtMax)}점</strong> 부족해요`;
    }

    let need = '';
    if (p.mode === 'fixed') {
      need = '<p class="desc">3학년 성적까지 모두 반영된 점수예요.</p>';
    } else if (p.status === 'raise') {
      need = `
        <div class="need">
          <p class="need-label">${semPhrase} 일반교과에서 학기마다</p>
          <p class="need-value"><strong class="num-lg">${fmt(p.needPer)}</strong><span class="max">/ ${p.maxPer}점 이상</span></p>
          <p class="desc">지금 추세는 학기당 ${fmt(p.trendPer)}점이에요. 학기마다 ${fmt(p.needPer - p.trendPer)}점을 더 받으면 커트라인에 닿아요.</p>
        </div>`;
    } else if (p.status === 'reach') {
      need = `
        <div class="need">
          <p class="need-label">${semPhrase} 일반교과에서 학기마다</p>
          <p class="need-value"><strong class="num-lg">${fmt(Math.max(p.needPer, 0))}</strong><span class="max">/ ${p.maxPer}점 이상</span></p>
          <p class="desc">지금 추세(학기당 ${fmt(p.trendPer)}점)를 지키면 커트라인보다 높아요.</p>
        </div>`;
    } else {
      need = `
        <div class="need">
          <p class="need-label">${semPhrase} 일반교과에서 학기마다</p>
          <p class="need-value"><strong class="num-lg">${fmt(p.needPer)}</strong><span class="max">/ ${p.maxPer}점이 필요해요</span></p>
          <p class="desc">학기 만점(${p.maxPer}점)을 넘어서요. 아래 ‘입력한 학교 전체 비교’에서 지금 성적으로 닿을 수 있는 학교를 함께 살펴보세요.</p>
        </div>`;
    }

    return `
      <div class="verdict verdict-${tone}">
        <p class="verdict-school">${esc(cut.school)} · ${cut.year}학년도 커트라인 <strong>${fmt(cut.score)}</strong></p>
        <p class="verdict-years desc">4년: ${cut.history.map((h) => `${h.year} ${h.score != null ? fmt(h.score) : h.note ? esc(h.note) : '—'}`).join(' · ')} · 평균 ${fmt(cut.avg)}</p>
        <p class="verdict-main">${main}</p>
        ${gauge(r.total, cut.score, cut.year)}
      </div>
      ${need}
      ${p.mode === 'open' && p.status !== 'impossible' ? planTable(p) : ''}`;
  }

  function compareList(st, r, s, cutoffs) {
    if (!cutoffs.length) return '';
    const items = cutoffs.slice().sort((a, b) => b.score - a.score).map((c) => {
      const p = N.plan(st, r, BASIS, c.score);
      const tone = p.mode === 'fixed' ? (p.reached ? 'ok' : 'bad') : p.status === 'reach' ? 'ok' : p.status === 'raise' ? 'warn' : 'bad';
      const label = p.mode === 'fixed'
        ? (p.reached ? '도달' : '미도달')
        : p.status === 'reach' ? '지금 추세로 도달'
          : p.status === 'raise' ? `3학년 학기당 ${fmt(p.needPer, 1)}점 필요`
            : '만점이어도 부족';
      return `
        <li>
          <button type="button" class="compare-row${c.id === s.counselSchool ? ' is-selected' : ''}" data-school="${esc(c.id)}" aria-pressed="${c.id === s.counselSchool}">
            <span class="c-school">${esc(c.school)}</span>
            <span class="c-cut">${c.history.map((h) => `<span class="${h.year === c.year ? 'is-latest' : ''}">${h.score != null ? fmt(h.score, 1) : h.note ? esc(h.note) : '—'}</span>`).join('')}</span>
            <span class="c-gap tone-${tone}">${signed(p.margin)}</span>
            <span class="c-need tone-${tone}">${label}</span>
          </button>
        </li>`;
    }).join('');
    const years = cutYears(s);
    return `
      <div class="compare-block">
        <h3 class="mini-title">입력한 학교 전체 비교</h3>
        <div class="compare-head" aria-hidden="true"><span>학교</span><span>커트라인 ${years.map((y) => y % 100).join('·')}</span><span>최근과 차이</span><span>3학년 필요</span></div>
        <ul class="compare">${items}</ul>
        <div class="compare-foot">
          <p class="desc">학교를 누르면 그 학교 기준으로 다시 계산해요. 판정은 가장 최근 해 커트라인으로 해요.</p>
          <button type="button" class="btn btn-outline" data-tab="schools">학교 커트라인 전체 보기 <span aria-hidden="true">→</span></button>
        </div>
      </div>`;
  }

  // 학교 커트라인 전체 보기: 최근 4년 값, 평균, 변화와 이 학생 예상 총점 비교
  function schoolsPanel(st, r, s, cutoffs) {
    const years = cutYears(s);
    if (!cutoffs.length) {
      return `<div class="callout"><p>아직 넣은 학교 커트라인이 없어요.</p>
        <p class="desc">입력·관리 화면의 ‘학교별 커트라인’에 학교를 넣으면 여기서 4년 커트라인을 함께 볼 수 있어요.</p></div>`;
    }
    const ok = !!(r && r.ok);
    const rows = cutoffs.slice().sort((a, b) => b.score - a.score).map((c) => {
      const p = ok ? N.plan(st, r, BASIS, c.score) : null;
      const tone = !p ? '' : p.mode === 'fixed' ? (p.reached ? 'ok' : 'bad') : p.status === 'reach' ? 'ok' : p.status === 'raise' ? 'warn' : 'bad';
      const label = !p ? '—' : p.mode === 'fixed' ? (p.reached ? '도달' : '미도달')
        : p.status === 'reach' ? '지금 추세로 도달' : p.status === 'raise' ? `학기당 ${fmt(p.needPer, 1)}점` : '만점이어도 부족';
      const got = c.history.filter((h) => h.score != null);
      const over = ok ? got.filter((h) => r.total >= h.score).length : 0;
      const first = got[0];
      const change = first && first.year !== c.year ? c.score - first.score : null;
      return `
        <tr${c.id === s.counselSchool ? ' class="is-selected"' : ''}>
          <th scope="row"><button type="button" class="school-go" data-school-go="${esc(c.id)}" aria-label="${esc(c.school)}로 상담하기">${esc(c.school)}</button></th>
          ${c.history.map((h) => {
            const isOver = ok && h.score != null && r.total >= h.score;
            return `<td class="num${isOver ? ' is-over' : ''}">${h.score != null ? `${fmt(h.score)}${isOver ? '<span class="sr-only"> 넘음</span>' : ''}` : `<span class="desc">${h.note ? esc(h.note) : '—'}</span>`}</td>`;
          }).join('')}
          <td class="num">${fmt(c.avg)}</td>
          <td class="num">${change == null ? '<span class="desc">—</span>' : `${change > 0 ? '▲' : change < 0 ? '▼' : '–'} ${fmt(Math.abs(change), 2)}`}</td>
          <td class="num tone-${tone}">${ok ? signed(p.margin) : '—'}</td>
          <td class="num">${ok ? `${over} / ${got.length}` : '—'}</td>
          <td class="tone-${tone}">${label}</td>
        </tr>`;
    }).join('');
    return `
      <section class="rule-card schools-card" aria-labelledby="t-schools">
        <h2 id="t-schools" class="rule-title">학교별 커트라인 <span class="rule-max">최근 4년</span></h2>
        <p>${esc(String(st.no))}번 ${esc(st.name)} 예상 총점 <strong>${ok ? fmt(r.total) : '—'}</strong> · 예상 총점이 커트라인 이상인 칸은 <span class="over-key">노랗게</span> 표시했어요.</p>
        <div class="table-wrap"><table class="table schools-table">
          <thead><tr>
            <th scope="col">학교</th>${years.map((y) => `<th class="num" scope="col">${y}</th>`).join('')}
            <th class="num" scope="col">4년 평균</th><th class="num" scope="col">변화</th><th class="num" scope="col">최근과 차이</th><th class="num" scope="col">넘은 해</th><th scope="col">3학년 필요</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
        <ul class="plain-list desc">
          <li>학교 이름을 누르면 그 학교를 목표로 상담 화면으로 돌아가요.</li>
          <li>판정과 ‘3학년 필요’는 가장 최근 해 커트라인으로 계산해요. ‘변화’는 첫해와 최근 해의 차이예요. ‘미달’처럼 숫자가 아닌 값은 메모로만 보여 줘요.</li>
          <li>커트라인은 그해 지원자에 따라 달라져요. 한 해 값보다 4년 평균과 흐름을 함께 보세요.</li>
        </ul>
      </section>`;
  }

  function targetPanel(st, r, s, cutoffs) {
    const selected = cutoffs.find((c) => c.id === s.counselSchool);
    let body;
    if (!cutoffs.length) {
      body = `<div class="callout"><p>아직 넣은 학교 커트라인이 없어요.</p>
        <p class="desc">입력·관리 화면의 ‘학교별 커트라인’에 학교를 넣으면 여기서 목표 학교로 고를 수 있어요.</p></div>`;
    } else if (!selected) {
      body = `<div class="callout"><p>위의 ‘목표 학교’에서 학교를 고르세요.</p>
        <p class="desc">최근 커트라인과 비교하고, 3학년에 학기마다 필요한 일반교과 점수와 과목별 목표 원점수를 계산해요.</p></div>`;
    } else {
      body = verdict(r, N.plan(st, r, BASIS, selected.score), selected);
    }
    return `
      <section class="panel target" aria-labelledby="t-target">
        <h2 id="t-target" class="block-title">목표 학교와 비교</h2>
        ${body}
        ${compareList(st, r, s, cutoffs)}
      </section>`;
  }

  // 내신 산출 기준: 학생에게 보여 주는 지침 설명. 표마다 지금 보는 학생의 값을 함께 둔다
  function rulesPanel(st, r) {
    const R = N.RULES[BASIS];
    const ok = !!(r && r.ok);
    const mine = (v, d) => (ok && v != null ? fmt(v, d) : '—');
    const STATUS = { actual: '반영', substitute: '대신 반영', projected: '예상' };

    const parts = [
      ['일반교과', '1학년 2학기~3학년 2학기 과목 성적', R.generalMax, ok && r.general.score],
      ['체육·예술', '체육·음악·미술 성취도', R.artsMax, ok && r.arts.score],
      ['출결', '1~3학년 미인정 결석', R.attendanceMax, ok && r.attendance.score],
      ['학교활동', '교내 수상·자치회 임원', R.activityMax, ok && r.activity.score],
    ];
    const total = parts.reduce((a, p) => a + p[2], 0);
    const partsTable = `
      <table class="table mini">
        <thead><tr><th scope="col">영역</th><th scope="col">무엇으로</th><th class="num" scope="col">만점</th><th class="num" scope="col">이 학생</th></tr></thead>
        <tbody>${parts.map(([k, what, max, v]) => `<tr><th scope="row">${k}</th><td>${what}</td><td class="num">${max}</td><td class="num"><strong>${mine(v)}</strong></td></tr>`).join('')}</tbody>
        <tfoot><tr><th scope="row" colspan="2">합계</th><td class="num">${total}</td><td class="num"><strong>${mine(ok && r.total)}</strong></td></tr></tfoot>
      </table>`;

    const semRows = N.SEMESTERS.map((sem) => {
      const g = R.general[sem];
      const x = ok ? r.semesters.find((y) => y.sem === sem) : null;
      return `<tr><th scope="row">${N.SEM_LABEL[sem]}</th><td class="num">${g.max}</td><td class="num">${g.base}</td><td class="num">× ${g.ach}</td><td class="num">× ${g.raw}</td>
        <td class="num"><strong>${x ? fmt(x.score) : '—'}</strong>${x ? ` <span class="tag ${x.status === 'actual' ? 'tag-plain' : 'tag-soft'}">${STATUS[x.status]}</span>` : ''}</td></tr>`;
    }).join('');
    const example = N.semScore(R.general['2-1'], { achAvg: 4.2, rawAvg: 84.6 });

    const allArts = (a, b, c) => N.round3(10 + (20 * (3 * a + 2 * b + c)) / (3 * (a + b + c)));
    const days = [0, 1, 2, 3, 4, 5, 6];
    const attRow = (label, max) => `<tr><th scope="row">${label}</th>${days.map((d) => `<td class="num">${fmt(N.round3(max * N.ATTENDANCE_RATE[d]), 1)}</td>`).join('')}</tr>`;
    const attMine = ok ? r.attendance.grades.map((g) => `${g.grade}학년 ${g.days}일${g.status === 'projected' ? '(예상)' : ''} → ${fmt(g.score, 1)}점`).join(' · ') : '—';

    const act = ok ? r.activity : null;
    const c = ok ? r.arts.counts : null;

    return `
      <div class="rules-col">
        <section class="rule-card" aria-labelledby="r-total">
          <h2 id="r-total" class="rule-title">200점은 이렇게 나뉘어요</h2>
          <p class="desc">${esc(R.label)} 기준이에요. 교과(일반교과 + 체육·예술) 150점, 출결 40점, 학교활동 10점을 더해요.</p>
          ${partsTable}
        </section>
        <section class="rule-card" aria-labelledby="r-general">
          <h2 id="r-general" class="rule-title">일반교과 <span class="rule-max">120점</span></h2>
          <p>학기마다 과목들의 <strong>성취도 평균</strong>과 <strong>원점수 평균</strong>으로 점수를 내요. 1학년 1학기는 자유학기라 넣지 않아요.</p>
          <p class="rule-formula">학기 점수 = 기본 점수 + 성취도 평균 × a + 원점수 평균 × r</p>
          <p class="desc">성취도는 A 5점, B 4점, C 3점, D 2점, E 1점으로 바꿔 평균을 내요.</p>
          <div class="table-wrap"><table class="table mini">
            <thead><tr><th scope="col">학기</th><th class="num" scope="col">만점</th><th class="num" scope="col">기본</th><th class="num" scope="col">성취도 a</th><th class="num" scope="col">원점수 r</th><th class="num" scope="col">이 학생</th></tr></thead>
            <tbody>${semRows}</tbody>
          </table></div>
          <p class="rule-example"><strong>예)</strong> 2학년 1학기 성취도가 A·B·C·B·A(평균 4.2), 원점수가 90·85·72·83·93점(평균 84.6)이면<br>8 + 1.6 × 4.2 + 0.08 × 84.6 = <strong>${fmt(example)}점</strong></p>
          <p class="rule-tip">3학년은 학기마다 30점이라 1·2학년보다 비중이 커요. 3학년 성적을 올리면 총점이 가장 크게 바뀌어요.</p>
        </section>
      </div>
      <div class="rules-col">
        <section class="rule-card" aria-labelledby="r-arts">
          <h2 id="r-arts" class="rule-title">체육·예술 <span class="rule-max">30점</span></h2>
          <p>체육·음악·미술 성취도를 A 3점, B 2점, C 1점으로 바꿔요. 반영하는 모든 학기를 함께 봐요.</p>
          <p class="rule-formula">10 + 20 × (A 개수×3 + B 개수×2 + C 개수×1) ÷ (과목 수×3)</p>
          <p class="desc">모두 A면 ${fmt(allArts(1, 0, 0))}점, 모두 B면 ${fmt(allArts(0, 1, 0))}점, 모두 C면 ${fmt(allArts(0, 0, 1))}점이에요.</p>
          <p class="rule-mine"><span>이 학생</span> ${ok ? `A ${c.A} · B ${c.B} · C ${c.C} → <strong>${fmt(r.arts.score)}점</strong>${r.arts.projected ? ' <span class="desc">(3학년도 같은 비율로 예상)</span>' : ''}` : '—'}</p>
        </section>
        <section class="rule-card" aria-labelledby="r-att">
          <h2 id="r-att" class="rule-title">출결 <span class="rule-max">40점</span></h2>
          <p>학년마다 <strong>미인정 결석</strong> 일수로 정해요. 질병·출석인정 결석은 빼요. 미인정 지각·조퇴·결과는 <strong>3번이 결석 1일</strong>이에요.</p>
          <div class="table-wrap"><table class="table mini rule-att">
            <thead><tr><th scope="col">미인정 결석</th>${days.map((d) => `<th class="num" scope="col">${d === 6 ? '6일+' : `${d}일`}</th>`).join('')}</tr></thead>
            <tbody>${attRow('1·2학년', R.attendance[1])}${attRow('3학년', R.attendance[3])}</tbody>
          </table></div>
          <p class="rule-mine"><span>이 학생</span> ${attMine}</p>
        </section>
        <section class="rule-card" aria-labelledby="r-act">
          <h2 id="r-act" class="rule-title">학교활동 <span class="rule-max">10점</span></h2>
          <p>기본 8점에 더해 받아요. 더하는 점수는 <strong>합쳐서 2점까지</strong>예요(3학년 10월 말까지).</p>
          <ul class="plain-list">
            <li><strong>교내 수상</strong>: 학기마다 1개만 0.5점. 한 학기에 여러 개를 받아도 0.5점이에요.</li>
            <li><strong>자치회 임원</strong>: 한 달에 0.1점. 전교·학년·학급 회장과 부회장, 15일 이상이면 한 달로 쳐요. 같은 기간에 둘을 맡았으면 한 가지만 쳐요.</li>
          </ul>
          <p class="rule-mine"><span>이 학생</span> ${act ? `수상 ${act.awardSemesters.length}개 학기${act.plannedAwards.length ? ` + 받을 예정 ${act.plannedAwards.length}개 학기` : ''} · 임원 ${act.officerMonths}개월 → 가산 ${fmt(act.extra, 1)}점 → <strong>${fmt(act.score, 1)}점</strong>` : '—'}</p>
        </section>
      </div>
      <section class="rule-note" aria-labelledby="r-note">
        <h2 id="r-note" class="mini-title">이 화면의 점수는 예상이에요</h2>
        <ul class="plain-list">
          <li>2028학년도 경기도 고입 내신 반영지침 <strong>예고안</strong>으로 계산했어요. 2027년 3월 확정 지침이 나오면 달라질 수 있어요.</li>
          <li>아직 성적이 없는 학기는 지금까지의 평균이 이어진다고 보고, 3학년 출결은 미인정 결석 0일로 봤어요.</li>
          <li>커트라인은 지난 입시 결과라 참고용이에요. 올해 커트라인은 지원하는 학생들에 따라 달라져요.</li>
        </ul>
      </section>`;
  }

  function render() {
    const s = Store.get();
    const focusId = document.activeElement && document.activeElement.id;
    const rows = computeAll(s);
    if (!rows.length) {
      host.innerHTML = `${header()}
        <main class="wrap layout-single">
          <div class="empty">
            <p class="empty-title">아직 산출된 자료가 없어요</p>
            <p>입력·관리 탭에서 엑셀을 올리면 이 화면이 바로 채워져요.</p>
            <a class="btn btn-outline" href="${esc(root.location.href.split('#')[0])}#manage">입력·관리 화면으로 가기</a>
          </div>
        </main>`;
      return;
    }
    const found = rows.find((x) => x.student.id === currentId) || rows[0];
    if (found.student.id !== currentId) planned = [];
    currentId = found.student.id;
    // 상담 중 '받을 예정'으로 고른 상을 넣어 다시 계산
    const current = { student: found.student, result: planned.length ? computeOne(s, found.student, { plannedAwards: planned }) : found.result };
    const cutoffs = validCutoffs(s);
    const main = current.result.ok
      ? `${summary(current.student, current.result)}${targetPanel(current.student, current.result, s, cutoffs)}`
      : `<div class="msg msg-warn"><p class="msg-title">${current.student.no}번 학생은 산출하지 못했어요</p>
          <ul class="plain-list">${current.result.flags.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></div>`;
    const body = tab === 'rules'
      ? `<main class="wrap layout-rules">${rulesPanel(current.student, current.result)}</main>`
      : tab === 'schools'
        ? `<main class="wrap layout-schools">${schoolsPanel(current.student, current.result, s, cutoffs)}</main>`
        : `<main class="wrap layout-counsel">${main}</main>`;
    host.innerHTML = `${header()}${toolbar(s, rows, current, cutoffs)}${body}`;
    if (focusId) {
      const el = host.querySelector(`#${focusId}`);
      if (el && !el.disabled) el.focus({ preventScroll: true });
    }
  }

  function go(id) {
    if (id !== currentId) planned = [];
    currentId = id;
    if (!Store.isMemory()) root.history.replaceState(null, '', `#counsel/${encodeURIComponent(id)}`);
    render();
  }

  function bind() {
    host.addEventListener('change', (e) => {
      if (e.target.id === 'student') go(e.target.value);
      if (e.target.id === 'school') Store.update({ counselSchool: e.target.value });
    });
    host.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.id === 'prevStudent' || btn.id === 'nextStudent') {
        const ids = Store.get().dataset.students.map((x) => x.id);
        const i = ids.indexOf(currentId) + (btn.id === 'prevStudent' ? -1 : 1);
        if (ids[i]) go(ids[i]);
      }
      if (btn.id === 'guideCounsel') {
        if (tab !== 'counsel') { tab = 'counsel'; render(); }
        root.Tour.start('counsel', '상담', TOUR);
        return;
      }
      if (btn.dataset.tab && btn.dataset.tab !== tab) {
        tab = btn.dataset.tab;
        render();
        root.scrollTo(0, 0);
        return;
      }
      if (btn.dataset.schoolGo) { // 학교 커트라인 표에서 학교를 누르면 그 학교로 상담
        tab = 'counsel';
        Store.update({ counselSchool: btn.dataset.schoolGo });
        root.scrollTo(0, 0);
        return;
      }
      if (btn.dataset.school) Store.update({ counselSchool: btn.dataset.school });
      if (btn.dataset.plan) {
        const sem = btn.dataset.plan;
        planned = planned.indexOf(sem) >= 0 ? planned.filter((x) => x !== sem) : planned.concat([sem]);
        render();
        const again = host.querySelector(`[data-plan="${sem}"]`);
        if (again) again.focus({ preventScroll: true });
      }
    });
  }

  root.CounselView = {
    mount(el, id, opts) {
      host = el;
      options = opts || {};
      currentId = id || currentId;
      document.title = '내신나침반 · 상담';
      if (!host.dataset.counselBound) { bind(); host.dataset.counselBound = '1'; }
      render();
      if (unsub) unsub();
      unsub = Store.subscribe(() => render());
      root.Tour.auto('counsel', '상담', TOUR, () => !!host.querySelector('.view-tabs'));
    },
    unmount() {
      if (unsub) unsub();
      unsub = null;
    },
  };
})(window);
