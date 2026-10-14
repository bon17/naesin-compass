/*
 * 내신나침반 — 입력·관리 화면(학교 PC): 나이스 출력물 올리기, 학교별 커트라인, 학생별 산출 결과
 */
(function (root) {
  'use strict';

  const { esc, fmt, formatTime, computeAll, editCount, validCutoffs, cutYears, cutLatestYear, cutYearTexts, cutNumber, isCutNote, defaultLatestYear, counselUrl, brandMark, guideButton, BASIS } = root.UI;
  const N = root.Naesin;

  // 사용 안내(둘러보기) 단계
  const TOUR = [
    { target: '.hud', title: '네 단계만 차례로 하면 돼요',
      body: ['지금 할 단계는 <strong>빨간 테두리</strong>로, 끝난 단계는 <strong>노란 ✓</strong>로 보여요.', '단계를 누르면 그 자리로 바로 가요. 아래 ‘다음 할 일’ 한 줄도 함께 바뀌어요.'] },
    { target: '#drop', title: '나이스 출력물 3개를 올려요',
      body: ['교과학습발달상황·출결상황·수상경력 엑셀을 <strong>고치지 말고 그대로</strong> 끌어다 놓거나 버튼으로 골라요.', '한 번에 여러 파일을 올려도 되고, 읽은 결과와 확인할 곳이 바로 아래에 나와요.'] },
    { target: 'section[aria-labelledby="t-cut"]', title: '최근 4년 커트라인을 넣어요',
      body: ['학교 이름과 학년도별 <strong>200점 만점</strong> 커트라인을 적으면 상담 화면에서 목표 학교로 고를 수 있어요.', '커트라인 표 엑셀·사진·PDF가 있으면 <strong>‘엑셀·사진·PDF로 한꺼번에 넣기’</strong>로 읽어서 정리할 수 있어요.'] },
    { target: () => document.querySelector('.results .row') || document.querySelector('#results'), title: '학생을 눌러 점검하고 고쳐요',
      body: ['학생 줄을 누르면 학기별 점수가 펼쳐져요. 그 안에서 <strong>자치회 임원</strong>을 넣고, <strong>나이스 자료 고치기</strong>로 성적·출결·수상 개수를 고칠 수 있어요.', '고친 값은 엑셀을 다시 올려도 남아요.'] },
    { target: '.hud-step:last-child', title: '태블릿으로 보내요',
      body: ['준비가 끝나면 여기를 눌러 암호 4자리를 정하고, 나온 QR을 태블릿으로 찍어요.', '보낸 뒤에 자료를 고치면 이 칸에 ‘다시 보내기’가 떠요.'] },
  ];

  const ACH_GENERAL = ['A', 'B', 'C', 'D', 'E'];
  const ACH_ARTS = ['A', 'B', 'C'];
  const ATT_FIELDS = [['absent', '결석'], ['late', '지각'], ['early', '조퇴'], ['missed', '결과']];
  const AWARD_EDIT_SEMS = ['1-1', '1-2', '2-1', '2-2']; // 3학년 수상은 상담 화면의 '받을 예정'으로 본다

  let host = null;
  let unsub = null;
  let expanded = null;
  let openFix = null; // '나이스 자료 고치기'를 펼친 학생
  let fixSem = null; // 고치기에서 보고 있는 학기
  let showAllIssues = false;
  let busy = false;
  let saveFailed = false;

  const STATUS_LABEL = { actual: '반영', substitute: '대체', projected: '예상', missing: '없음' };
  // 올릴 출력물: 교과는 꼭 있어야 하고, 나머지는 없으면 0으로 계산한다
  const SOURCES = [
    { kind: 'grades', label: '교과학습발달상황', need: '필수', empty: '이 파일이 있어야 산출할 수 있어요.' },
    { kind: 'attendance', label: '출결상황', need: '필수', empty: '없으면 미인정 결석 0일로 계산해요.' },
    { kind: 'awards', label: '수상경력', need: '선택', empty: '없으면 수상 없이 계산해요.' },
  ];

  function skeleton() {
    return `
      <header class="work-head">
        <div class="wrap work-head-inner">
          <h1 class="work-title"><a href="#" class="brand">${brandMark()}<span class="brand-name">내신나침반</span></a> <span class="work-sub">입력·관리 · ${esc(N.RULES[BASIS].label)} 기준</span></h1>
          <div class="work-actions">${guideButton('guideManage')}<a class="btn-text" href="#">처음 화면</a></div>
        </div>
      </header>
      <nav class="hud" aria-label="사용 순서">
        <div class="wrap">
          <ol class="hud-steps" id="hud"></ol>
          <p class="hud-next" id="hudNext" aria-live="polite"></p>
        </div>
      </nav>
      <main class="wrap layout-manage">
        <div class="col-input">
          <section class="block" aria-labelledby="t-upload">
            <h2 id="t-upload" class="block-title"><span class="step">1</span>나이스 출력물 올리기</h2>
            <p class="desc">교과학습발달상황·출결상황·수상경력 엑셀을 고치지 말고 한꺼번에 올리면 바로 계산해요.</p>
            <div class="drop" id="drop">
              <p class="drop-text">엑셀 파일을 여기에 끌어다 놓거나</p>
              <button type="button" class="btn btn-primary btn-block" id="pick">엑셀 올려 산출하기</button>
              <p class="desc">.xlsx 또는 .xls · 여러 개를 한 번에 골라도 돼요 · 같은 종류를 다시 올리면 바뀌어요</p>
            </div>
            <input type="file" id="file" accept=".xlsx,.xls" multiple hidden>
            <div id="uploadResult" aria-live="polite"></div>
            <details class="guide">
              <summary>나이스에서 받을 파일</summary>
              <ul class="plain-list">
                <li>학교생활기록부 <strong>교과학습발달상황</strong> — 우리 반 전체, 1학년부터</li>
                <li>학교생활기록부 <strong>출결상황</strong> — 우리 반 전체</li>
                <li>학교생활기록부 <strong>수상경력</strong> — 우리 반 전체</li>
              </ul>
              <p class="desc">엑셀로 저장해서 그대로 올리면 돼요. 쪽마다 반복되는 머리글과 합쳐진 칸은 알아서 읽어요.</p>
              <p class="desc">직접 만든 엑셀로 넣으려면 <button type="button" class="btn-text btn-inline" id="template">입력 양식 내려받기</button></p>
            </details>
          </section>

          <section class="block" aria-labelledby="t-cut">
            <h2 id="t-cut" class="block-title"><span class="step">2</span>학교별 커트라인 <span class="desc">최근 4년</span></h2>
            <p class="desc">200점 만점 기준 합격 커트라인을 학년도마다 넣어요. 상담에서는 가장 최근 값으로 판정하고 4년 값을 함께 보여 줘요.</p>
            <label class="tool-field cut-latest"><span class="tool-label">가장 최근 학년도</span><select class="select" id="cutLatest"></select></label>
            <div id="cutoffs"></div>
            <div class="cut-actions">
              <button type="button" class="btn btn-quiet" id="addSchool">+ 학교 추가</button>
              <button type="button" class="btn btn-outline" id="importCut">엑셀·사진·PDF로 한꺼번에 넣기</button>
            </div>
            <div id="cutMsg" aria-live="polite"></div>
          </section>
        </div>

        <section class="col-result" aria-labelledby="t-result">
          <div class="result-head">
            <h2 id="t-result" class="block-title"><span class="step">3</span>학생별 예상 내신</h2>
            <div class="result-actions">
              <button type="button" class="btn-text" id="clearData" hidden>저장된 자료 지우기</button>
              <a class="btn btn-outline" href="#send" id="sendLink" hidden>태블릿으로 보내기 <span aria-hidden="true">→</span></a>
            </div>
          </div>
          <div id="results"></div>
        </section>
      </main>`;
  }

  // ---------- 그리기 ----------

  // 사용 순서 안내(HUD): 지금 어디까지 했는지와 다음 할 일을 한 줄로 보여 준다
  function renderHud(s) {
    const d = s.dataset;
    const src = (d && d.sources) || {};
    const hasGrades = !!(d && d.students.length);
    const fileCount = src.template ? 3 : ['grades', 'attendance', 'awards'].filter((k) => src[k]).length;
    const schools = validCutoffs(s).length;
    const flagged = hasGrades ? computeAll(s).filter((x) => !x.result.ok || x.result.flags.length).length : 0;
    // 태블릿으로 보낸 자료가 지금 자료와 같은지(임원·커트라인을 고치면 다시 보내야 한다)
    const sent = hasGrades && !!s.sentSig && root.SendView && s.sentSig === root.SendView.signature(s);

    const steps = [
      { n: 1, label: '나이스 출력물 올리기', target: 't-upload', done: hasGrades && (src.template || src.attendance),
        status: src.template ? '직접 만든 양식' : `${fileCount}/3개 올림` },
      { n: 2, label: '학교별 커트라인 넣기', target: 't-cut', done: schools > 0, status: `${schools}곳` },
      { n: 3, label: '학생별 점수 점검', target: 't-result', done: hasGrades && flagged === 0,
        status: hasGrades ? `${d.students.length}명${flagged ? ` · 확인 ${flagged}명` : ''}` : '자료 없음' },
      { n: 4, label: '태블릿으로 보내기', target: 'send', done: sent,
        status: sent ? `${formatTime(s.sentAt)} 보냄` : !hasGrades ? '앞 단계 먼저' : s.sentAt ? '자료가 바뀜 · 다시 보내기' : 'QR 만들기' },
    ];
    let next;
    if (!hasGrades) next = { step: 1, text: '나이스에서 내려받은 교과학습발달상황·출결상황·수상경력 엑셀을 한꺼번에 올려 주세요.' };
    else if (!src.template && !src.attendance) next = { step: 1, text: '출결상황도 올려 주세요. 지금은 미인정 결석 0일로 계산하고 있어요.' };
    else if (!schools) next = { step: 2, text: '학교별 작년 커트라인을 넣어 주세요. 상담 화면에서 목표 학교로 고를 수 있어요.' };
    else if (flagged) next = { step: 3, text: `‘확인’ 표시가 있는 학생 ${flagged}명을 눌러 학기별 점수를 점검해 주세요.` };
    else if (!sent && s.sentAt) next = { step: 4, text: 'QR을 만든 뒤 자료가 바뀌었어요. ‘태블릿으로 보내기’에서 QR을 다시 만들어 태블릿으로 찍어 주세요.' };
    else if (!sent) next = { step: 4, text: '준비가 끝났어요. ‘태블릿으로 보내기’에서 QR을 만들어 태블릿으로 찍어 주세요.' };
    else next = { step: 0, text: '태블릿으로 보냈어요. 자료나 커트라인을 고치면 QR을 다시 만들어 주세요.' };

    host.querySelector('#hud').innerHTML = steps.map((st) => {
      const state = st.n === next.step ? 'now' : st.done ? 'done' : 'todo';
      return `
        <li class="hud-step is-${state}"${state === 'now' ? ' aria-current="step"' : ''}>
          <button type="button" class="hud-btn" data-go="${st.target}">
            <span class="hud-num" aria-hidden="true">${state === 'done' ? '✓' : st.n}</span>
            <span class="hud-text"><span class="hud-label">${st.label}</span><span class="hud-status">${esc(st.status)}</span></span>
          </button>
        </li>`;
    }).join('');
    host.querySelector('#hudNext').innerHTML = `<strong>다음 할 일</strong> ${esc(next.text)}${hasGrades ? `<span class="desc"> · ${esc(d.cls || '우리 반')} ${esc(formatTime(d.uploadedAt))} 저장</span>` : ''}`;
  }

  function issueList(items, limit) {
    const shown = limit ? items.slice(0, limit) : items;
    return `<ol class="issue-list">${shown.map((it) => {
      const where = [it.file, it.cell].filter(Boolean).join(' · ');
      return `
      <li>
        ${where ? `<span class="loc">${esc(where)}</span>` : ''}
        <div><p>${esc(it.text)}</p>${it.hint ? `<p class="desc">${esc(it.hint)}</p>` : ''}</div>
      </li>`;
    }).join('')}</ol>`;
  }

  function fileTable(d) {
    const sources = (d && d.sources) || {};
    const item = (kind, title, line, removable) => `
      <li class="file-item${removable ? '' : ' is-empty'}">
        <div><p class="file-kind">${title}</p><p class="desc">${line}</p></div>
        ${removable ? `<button type="button" class="btn-text" data-remove="${kind}" aria-label="${esc(removable)} 빼기">빼기</button>` : ''}
      </li>`;
    if (sources.template) {
      return `<ul class="file-list" aria-label="올린 파일">${item('template', '직접 만든 양식', `${esc(sources.template.fileName)} · ${sources.template.students}명`, '직접 만든 양식')}</ul>`;
    }
    return `<ul class="file-list" aria-label="올린 파일">${SOURCES.map((src) => {
      const got = sources[src.kind];
      if (!got) return item(src.kind, `${src.label} <span class="desc">${src.need} · 아직 안 올림</span>`, src.empty, '');
      return item(src.kind, `<span class="file-ok" aria-hidden="true">✓</span> ${src.label}`,
        `${esc(got.fileName)}${got.cls ? ` · ${esc(got.cls)}` : ''} · ${got.students}명`, src.label);
    }).join('')}</ul>`;
  }

  function renderUploadResult(s) {
    const el = host.querySelector('#uploadResult');
    if (busy) {
      el.innerHTML = '<div class="msg msg-info"><p class="msg-title">엑셀을 읽는 중이에요…</p></div>';
      return;
    }
    let html = '';
    if (s.lastError && s.lastError.errors.length) {
      html += `
        <div class="msg msg-error" role="alert">
          <p class="msg-title">읽지 못한 파일이 있어요</p>
          <p class="msg-text">아래 위치를 확인한 뒤 그 파일만 다시 올려 주세요. 나머지 파일은 그대로 반영했어요.</p>
          ${issueList(s.lastError.errors)}
        </div>`;
    }
    const d = s.dataset;
    if (d && d.sources && Object.keys(d.sources).length) {
      html += fileTable(d);
      const issues = d.issues || [];
      if (d.students.length && !(s.lastError && s.lastError.errors.length)) {
        html += `<div class="msg msg-ok"><p class="msg-title">${d.students.length}명 산출을 마쳤어요</p>
          ${d.freeSemesters && d.freeSemesters.length ? `<p class="msg-text">${d.freeSemesters.map((x) => N.SEM_LABEL[x]).join(', ')}는 자유학기(P)라 반영하지 않았어요.</p>` : ''}</div>`;
      }
      if (issues.length) {
        const limit = showAllIssues ? 0 : 3;
        html += `<div class="msg msg-warn"><p class="msg-title">확인할 곳 ${issues.length}개</p>
          <p class="msg-text">해당 줄은 건너뛰거나 안내대로 바꿔 계산했어요.</p>
          ${issueList(issues, limit)}
          ${issues.length > 3 ? `<button type="button" class="btn-text" id="moreIssues">${showAllIssues ? '접기' : `나머지 ${issues.length - 3}개 보기`}</button>` : ''}</div>`;
      }
    }
    if (saveFailed) {
      html += '<div class="msg msg-warn"><p class="msg-title">이 브라우저에 저장하지 못했어요</p><p class="msg-text">창을 닫으면 자료가 사라질 수 있어요. 브라우저 저장 공간 설정을 확인해 주세요.</p></div>';
    }
    el.innerHTML = html;
  }

  const cutBad = (texts, years) => years.some((y) => Number.isNaN(cutNumber(texts[y])) && !isCutNote(texts[y]));

  function cutoffRow(c, years) {
    const texts = cutYearTexts(c, years[years.length - 1]);
    const name = c.school || '이 학교';
    return `
      <li class="cut-row" data-id="${esc(c.id)}">
        <input class="input" data-field="school" aria-label="학교명" placeholder="예: 가온고" value="${esc(c.school)}">
        ${years.map((y) => `<input class="input num" data-field="year" data-year="${y}" aria-label="${esc(name)} ${y}학년도 커트라인" inputmode="decimal" placeholder="—" value="${esc(texts[y] || '')}">`).join('')}
        <button type="button" class="btn btn-quiet cut-del" data-remove aria-label="${esc(name)} 삭제">✕</button>
        <p class="field-error"${cutBad(texts, years) ? '' : ' hidden'}>커트라인은 0보다 크고 200 이하인 숫자로 적어 주세요.</p>
      </li>`;
  }

  function cutCountText(s) {
    return `${validCutoffs(s).length}개 학교가 상담 화면 목록에 보여요. 빈칸인 해는 비워 둬도 돼요. ‘미달’처럼 숫자가 아닌 글은 메모로 보여 주고 판정에는 쓰지 않아요.`;
  }

  function renderCutoffs(s, force) {
    const el = host.querySelector('#cutoffs');
    const years = cutYears(s);
    const latest = cutLatestYear(s);
    const sel = host.querySelector('#cutLatest');
    if (document.activeElement !== sel) {
      const base = defaultLatestYear();
      const opts = [base - 3, base - 2, base - 1, base, base + 1];
      if (opts.indexOf(latest) < 0) opts.push(latest);
      sel.innerHTML = opts.sort().map((y) => `<option value="${y}"${y === latest ? ' selected' : ''}>${y}학년도</option>`).join('');
    }
    if (!force && el.contains(document.activeElement)) return;
    const list = s.cutoffs || [];
    if (!list.length) {
      el.innerHTML = '<p class="empty-line">아직 넣은 학교가 없어요. ‘학교 추가’로 한 곳씩 적거나, 커트라인 표 엑셀·사진·PDF로 한꺼번에 넣어 주세요.</p>';
      return;
    }
    el.innerHTML = `
      <div class="cut-head" aria-hidden="true"><span>학교명</span>${years.map((y) => `<span>${y}</span>`).join('')}<span></span></div>
      <ul class="cut-list">${list.map((c) => cutoffRow(c, years)).join('')}</ul>
      <p class="desc" id="cutCount">${cutCountText(s)}</p>`;
  }

  function semRow(sem) {
    const status = sem.status === 'substitute' ? `대체(${sem.from})` : STATUS_LABEL[sem.status];
    return `
      <tr>
        <td>${esc(N.SEM_LABEL[sem.sem])}</td>
        <td><span class="tag ${sem.status === 'actual' ? 'tag-plain' : 'tag-soft'}">${esc(status)}</span></td>
        <td class="num">${fmt(sem.stats.achAvg, 2)}</td>
        <td class="num">${fmt(sem.stats.rawAvg, 1)}</td>
        <td class="num"><strong>${fmt(sem.score)}</strong><span class="desc"> /${sem.max}</span></td>
      </tr>`;
  }

  // 자치회 임원은 나이스 출력물에 없어 담임이 직접 넣는다(월 0.1점). 학급 임원은 학기, 전교 임원은 학년 단위
  // 같은 기간에 임원이 둘이면 한 가지만 반영한다 — 학급·전교를 둘 다 넣어 두고, 겹친 기록에 표시한다
  const officerPeriod = (o) => (o.grade ? `${o.grade}학년`
    : o.sem ? ((root.UI.OFFICER_SEMS.find(([v]) => v === o.sem) || [])[1] || '') : '');

  // 역할을 고른 뒤의 두 번째 칸: 학급 임원은 학기, 전교 임원은 학년
  function officerWhenOptions(role) {
    if (!role) return '<option value="" selected disabled>학기·학년</option>';
    if (root.UI.isSchoolOfficer(role)) {
      return `<option value="" selected disabled>학년</option>${root.UI.OFFICER_YEARS.map(([v, name, sems]) => `<option value="${v}">${name} · ${sems.length * 6}개월</option>`).join('')}`;
    }
    return `<option value="" selected disabled>학기</option>${root.UI.OFFICER_SEMS.map(([v, name]) => `<option value="${v}">${name}</option>`).join('')}`;
  }

  function officerBox(st) {
    const first = (o) => String(root.UI.officerSems(o)[0] || '');
    // 학기 순, 같은 때 시작하면 전교 임원 먼저
    const list = (st.officers || []).slice().sort((a, b) => first(a).localeCompare(first(b)) || (b.grade ? 1 : 0) - (a.grade ? 1 : 0));
    const overlaps = (o) => list.some((x) => x !== o && root.UI.officerSems(x).some((sem) => root.UI.officerSems(o).indexOf(sem) >= 0));
    const anyOverlap = list.some(overlaps);
    const total = N.officerMonths(list);
    return `
      <div class="officer-box" data-student="${esc(st.id)}">
        <p class="officer-title">자치회 임원 <span class="desc">담임 입력 · 1개월에 0.1점</span></p>
        ${list.length ? `<ul class="officer-list">${list.map((o) => {
          const period = officerPeriod(o);
          const label = `${period ? `${period} ` : ''}${o.role} · ${o.months}개월${overlaps(o) ? '' : ` ${fmt(o.months * 0.1, 1)}점`}`;
          return `
          <li><span>${esc(label)}${overlaps(o) ? ' <span class="tag tag-soft">기간 겹침</span>' : ''}</span>
            <button type="button" class="btn-text" data-officer-del="${esc(o.id)}" aria-label="${esc(label)} 삭제">삭제</button></li>`;
        }).join('')}</ul>`
          : '<p class="desc">아직 넣은 기록이 없어요.</p>'}
        ${anyOverlap ? `<p class="desc">같은 기간에 임원을 둘 맡으면 한 가지만 반영해요. 겹친 기간은 한 번만 쳐서 모두 <strong>${total}개월 ${fmt(total * 0.1, 1)}점</strong>이에요.</p>` : ''}
        <div class="officer-form">
          <select class="select" data-officer-role aria-label="임원 역할"><option value="" selected disabled>임원</option>${root.UI.OFFICER_ROLES.map((role) => `<option>${role}</option>`).join('')}</select>
          <select class="select" data-officer-when aria-label="학기·학년" disabled>${officerWhenOptions('')}</select>
          <button type="button" class="btn btn-quiet" data-officer-add>추가</button>
        </div>
        <p class="field-error" data-officer-error hidden></p>
        <p class="desc">학급 임원은 학기(6개월·0.6점), 전교 임원은 학년(2학년 12개월·1.2점, 3학년은 1학기 6개월)으로 넣어요. 학급 임원과 전교 임원을 같은 때 했으면 둘 다 넣으세요. 겹친 기간은 한 번만 쳐요.</p>
      </div>`;
  }

  function revertBtn(kind, key, label) {
    return `<button type="button" class="btn-text btn-revert" data-revert="${kind}" data-key="${esc(key)}" aria-label="${esc(label)} 나이스 값으로 되돌리기">원래대로</button>`;
  }

  // 나이스 값 고치기: 과목 성적·출결(1·2학년)·수상 개수. st는 고친 값을 덮은 학생, 나이스 원래 값은 dataset에서 찾는다
  function fixBox(st, s) {
    const raw = s.dataset.students.find((x) => x.id === st.id) || st;
    const ed = (s.edits || {})[st.id] || {};
    const count = editCount(s, st.id);
    // 과목 성적은 학기 하나씩 본다(기본은 가장 최근 학기)
    const sems = Array.from(new Set(st.grades.map((g) => g.sem))).sort();
    const sem = sems.indexOf(fixSem) >= 0 ? fixSem : sems[sems.length - 1];
    const gradeRow = (g) => {
      const key = `${sem}|${g.subject}`;
      const label = `${N.SEM_LABEL[sem]} ${g.subject}`;
      const opts = (g.kind === 'arts' ? ACH_ARTS : ACH_GENERAL).map((a) => `<option${a === g.ach ? ' selected' : ''}>${a}</option>`).join('');
      return `
        <tr${g.edited ? ' class="is-edited"' : ''}>
          <th scope="row">${esc(g.subject)}</th>
          <td><select class="select" data-edit="grade" data-key="${esc(key)}" data-field="ach" data-edit-key="g:${esc(key)}:ach" aria-label="${esc(label)} 성취도">${opts}</select></td>
          <td>${g.kind === 'arts' ? '<span class="desc">원점수 없음</span>' : `<input class="input num fix-num" data-edit="grade" data-key="${esc(key)}" data-field="raw" data-edit-key="g:${esc(key)}:raw" inputmode="decimal" value="${esc(g.raw)}" aria-label="${esc(label)} 원점수">`}</td>
          <td class="fix-state">${g.edited ? `<span class="tag tag-edit">수정함</span> <span class="desc">나이스 ${esc(g.orig.ach)}${g.kind === 'arts' ? '' : ` ${esc(g.orig.raw)}점`}</span> ${revertBtn('grade', key, label)}` : ''}</td>
        </tr>`;
    };
    const inSem = st.grades.filter((g) => g.sem === sem);
    const general = inSem.filter((g) => g.kind !== 'arts');
    const arts = inSem.filter((g) => g.kind === 'arts');
    const semTabs = sems.map((x) => {
      const n = st.grades.filter((g) => g.sem === x && g.edited).length;
      return `<button type="button" class="seg${x === sem ? ' is-on' : ''}" data-fix-sem="${x}" data-edit-key="t:${x}" aria-pressed="${x === sem}">${N.SEM_LABEL[x]}${n ? ` <span class="tag tag-edit">${n}</span>` : ''}</button>`;
    }).join('');
    const gradeTables = sems.length ? `
      <div class="segs" role="group" aria-label="학기 고르기">${semTabs}</div>
      <div class="table-wrap"><table class="table mini fix-table">
        <thead><tr><th scope="col">과목</th><th scope="col">성취도</th><th scope="col">원점수</th><th scope="col"><span class="sr-only">고친 상태</span></th></tr></thead>
        <tbody>
          ${general.map(gradeRow).join('')}
          ${arts.length ? `<tr class="fix-sub"><th colspan="4" scope="colgroup">체육·예술 <span class="desc">A·B·C</span></th></tr>${arts.map(gradeRow).join('')}` : ''}
        </tbody>
      </table></div>` : '';

    const attRows = [1, 2].map((grade) => {
      const cur = st.attendance[grade] || { absent: 0, late: 0, early: 0, missed: 0 };
      const orig = raw.attendance[grade];
      const edited = !!(ed.attendance && ed.attendance[grade]);
      return `
        <tr${edited ? ' class="is-edited"' : ''}>
          <th scope="row">${grade}학년</th>
          ${ATT_FIELDS.map(([f, name]) => `<td><input class="input num fix-num" data-edit="att" data-key="${grade}" data-field="${f}" data-edit-key="a:${grade}:${f}" inputmode="numeric" value="${cur[f] || 0}" aria-label="${grade}학년 미인정 ${name}"></td>`).join('')}
          <td class="fix-state">${edited ? `<span class="tag tag-edit">수정함</span> <span class="desc">나이스 ${orig ? ATT_FIELDS.map(([f]) => orig[f]).join('·') : '자료 없음'}</span> ${revertBtn('att', grade, `${grade}학년 출결`)}` : ''}</td>
        </tr>`;
    }).join('');

    const awardRows = AWARD_EDIT_SEMS.map((sem) => {
      const cur = st.awards.filter((a) => a.sem === sem).length;
      const orig = raw.awards.filter((a) => a.sem === sem).length;
      const edited = !!(ed.awards && sem in ed.awards);
      return `
        <tr${edited ? ' class="is-edited"' : ''}>
          <th scope="row">${N.SEM_LABEL[sem]}</th>
          <td><input class="input num fix-num" data-edit="award" data-key="${sem}" data-edit-key="w:${sem}" inputmode="numeric" value="${cur}" aria-label="${N.SEM_LABEL[sem]} 수상 개수"></td>
          <td class="fix-state">${edited ? `<span class="tag tag-edit">수정함</span> <span class="desc">나이스 ${orig}개</span> ${revertBtn('award', sem, `${N.SEM_LABEL[sem]} 수상`)}` : ''}</td>
        </tr>`;
    }).join('');

    return `
      <details class="fix" data-fix="${esc(st.id)}"${openFix === st.id ? ' open' : ''}>
        <summary><span class="fix-title">나이스 자료 고치기</span><span class="desc">과목 성적 · 출결 · 수상 개수${count ? ` · <strong>고친 칸 ${count}개</strong>` : ''}</span></summary>
        <div class="fix-body">
          <p class="desc">고친 값은 바로 계산에 들어가고, 엑셀을 다시 올려도 남아요. ‘원래대로’를 누르면 나이스 값으로 돌아가요. 원점수를 바꾸면 성취도도 90·80·70·60점 기준으로 함께 맞춰요(다르면 성취도를 따로 고르세요).</p>
          <p class="field-error" data-fix-error role="alert" hidden></p>
          <h3 class="mini-title">과목 성적</h3>
          ${gradeTables || '<p class="desc">읽은 과목 성적이 없어요.</p>'}
          <div class="fix-pair">
            <div>
              <h3 class="mini-title">출결 <span class="desc">미인정만 · 결석은 일, 나머지는 회</span></h3>
              <div class="table-wrap"><table class="table mini fix-table">
                <thead><tr><th scope="col">학년</th>${ATT_FIELDS.map(([, name]) => `<th scope="col">${name}</th>`).join('')}<th scope="col"><span class="sr-only">고친 상태</span></th></tr></thead>
                <tbody>${attRows}</tbody>
              </table></div>
            </div>
            <div>
              <h3 class="mini-title">수상 개수 <span class="desc">학기마다 1개만 점수에 들어가요</span></h3>
              <div class="table-wrap"><table class="table mini fix-table">
                <thead><tr><th scope="col">학기</th><th scope="col">개수</th><th scope="col"><span class="sr-only">고친 상태</span></th></tr></thead>
                <tbody>${awardRows}</tbody>
              </table></div>
            </div>
          </div>
          ${count ? '<button type="button" class="btn btn-quiet" data-revert-all>이 학생 고친 것 모두 되돌리기</button>' : ''}
        </div>
      </details>`;
  }

  function detail(st, r) {
    if (!r.ok) {
      return `<div class="detail"><div class="msg msg-warn"><p class="msg-title">산출하지 못했어요</p>
        <ul class="plain-list">${r.flags.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></div></div>`;
    }
    const att = r.attendance.grades.map((g) => {
      const raw = g.raw;
      const memo = raw
        ? `결석 ${raw.absent}일 · 지각·조퇴·결과 ${raw.late + raw.early + raw.missed}회`
        : g.status === 'projected' ? '결석 0일로 예상' : '자료 없음';
      return `<tr><td>${g.grade}학년${g.status === 'projected' ? ' <span class="tag tag-soft">예상</span>' : ''}</td>
        <td>${g.days}일<span class="desc"> (${esc(memo)})</span></td>
        <td class="num"><strong>${fmt(g.score)}</strong><span class="desc"> /${g.max}</span></td></tr>`;
    }).join('');
    const awardsBySem = {};
    st.awards.forEach((a) => { (awardsBySem[a.sem] = awardsBySem[a.sem] || []).push(a.title); });
    const awards = Object.keys(awardsBySem).sort().map((sem) => `${sem} ${awardsBySem[sem].length}개`).join(', ') || '없음';
    const c = r.arts.counts;
    return `
      <div class="detail">
        <div class="detail-head">
          <p class="detail-title">${st.no}번 ${esc(st.name)} · 예상 총점 <strong>${fmt(r.total)}</strong><span class="desc"> /200</span></p>
          <button type="button" class="btn btn-outline" data-counsel="${esc(st.id)}">이 학생 상담 화면 미리 보기 <span aria-hidden="true">↗</span></button>
        </div>
        ${r.flags.length ? `<div class="msg msg-warn"><p class="msg-title">확인할 점</p><ul class="plain-list">${r.flags.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></div>` : ''}
        <div class="detail-grid">
          <div>
            <h3 class="mini-title">일반교과 <span class="desc">${fmt(r.general.score)} / ${r.general.max}</span></h3>
            <div class="table-wrap"><table class="table mini">
              <thead><tr><th>학기</th><th>구분</th><th class="num">성취도 평균</th><th class="num">원점수 평균</th><th class="num">점수</th></tr></thead>
              <tbody>${r.semesters.map(semRow).join('')}</tbody>
            </table></div>
          </div>
          <div>
            <h3 class="mini-title">출결 <span class="desc">${fmt(r.attendance.score)} / ${r.attendance.max}</span></h3>
            <div class="table-wrap"><table class="table mini">
              <thead><tr><th>학년</th><th>미인정 결석 환산</th><th class="num">점수</th></tr></thead>
              <tbody>${att}</tbody>
            </table></div>
            <h3 class="mini-title">체육·예술 <span class="desc">${fmt(r.arts.score)} / ${r.arts.max}</span></h3>
            <p class="detail-line">A ${c.A} · B ${c.B} · C ${c.C}${r.arts.projected ? ' <span class="tag tag-soft">3학년은 같은 비율로 예상</span>' : ''}</p>
            <h3 class="mini-title">학교활동 <span class="desc">${fmt(r.activity.score)} / ${r.activity.max}</span></h3>
            <p class="detail-line">기본 8점 + 수상 ${r.activity.awardSemesters.length}개 학기 + 임원 ${r.activity.officerMonths}개월 = 가산 ${fmt(r.activity.extra, 1)}점<span class="desc"> (가산은 2점까지)</span></p>
            <p class="desc">수상: ${esc(awards)} (학기마다 1개만 인정)</p>
            ${officerBox(st)}
          </div>
        </div>
        ${fixBox(st, Store.get())}
      </div>`;
  }

  function renderResults(s) {
    const el = host.querySelector('#results');
    const d = s.dataset;
    host.querySelector('#clearData').hidden = !d;
    host.querySelector('#sendLink').hidden = !(d && d.students.length);
    if (!d || !d.students.length) {
      el.innerHTML = `
        <div class="empty">
          <p class="empty-title">${d && d.sources && !d.sources.grades ? '교과학습발달상황을 올려 주세요' : '아직 올린 자료가 없어요'}</p>
          <p>나이스 출력물을 올리면 학생마다 일반교과·체육·예술·출결·학교활동 점수와 3학년까지 이어 본 예상 총점이 여기에 정리돼요.</p>
          <ol class="steps">
            <li>나이스에서 교과학습발달상황·출결상황·수상경력을 엑셀로 내려받아요.</li>
            <li>‘엑셀 올려 산출하기’로 세 파일을 한꺼번에 올려요.</li>
            <li>학생을 눌러 학기별 점수를 점검하고, 상담 화면을 미리 봐요.</li>
          </ol>
        </div>`;
      return;
    }
    const R = N.RULES[BASIS];
    const rows = computeAll(s);
    const body = rows.map(({ student: st, result: r }) => {
      const open = expanded === st.id;
      const cell = (v) => `<td class="num c-part">${r.ok ? fmt(v) : '—'}</td>`;
      const check = !r.ok
        ? '<span class="tag tag-bad">산출 불가</span>'
        : r.flags.length ? `<span class="tag tag-warn">확인 ${r.flags.length}</span>` : '<span class="desc">—</span>';
      return `
        <tr class="row${open ? ' is-open' : ''}" data-id="${esc(st.id)}" tabindex="0" aria-expanded="${open}">
          <td class="num">${st.no}</td>
          <td><span class="name">${esc(st.name)}</span>${editCount(s, st.id) ? ' <span class="tag tag-edit">수정</span>' : ''}</td>
          ${cell(r.ok && r.general.score)}
          ${cell(r.ok && r.arts.score)}
          ${cell(r.ok && r.attendance.score)}
          ${cell(r.ok && r.activity.score)}
          <td class="num total">${r.ok ? fmt(r.total) : '—'}</td>
          <td class="check">${check}</td>
        </tr>
        ${open ? `<tr class="detail-row"><td colspan="8">${detail(st, r)}</td></tr>` : ''}`;
    }).join('');

    // 고치기 칸에서 다른 칸으로 옮겨 가는 중에 다시 그려도 그 칸에 커서를 돌려준다
    const active = document.activeElement;
    const focusKey = active && el.contains(active) && active.dataset ? active.dataset.editKey : null;
    el.innerHTML = `
      <p class="desc table-note">아직 성적이 없는 학기는 지금까지의 평균이 이어진다고 보고, 3학년 출결은 결석 0일로 보고 넣은 예상치예요. 학생을 누르면 학기별 점수를 볼 수 있어요.</p>
      <div class="table-wrap">
        <table class="table results">
          <thead>
            <tr>
              <th class="num" scope="col">번호</th>
              <th scope="col">이름</th>
              <th class="num c-part" scope="col">일반교과<span class="max">/120</span></th>
              <th class="num c-part" scope="col">체육·예술<span class="max">/30</span></th>
              <th class="num c-part" scope="col">출결<span class="max">/${R.attendanceMax}</span></th>
              <th class="num c-part" scope="col">학교활동<span class="max">/10</span></th>
              <th class="num" scope="col">예상 총점<span class="max">/200</span></th>
              <th scope="col">확인</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      <p class="desc foot-note">자료는 이 컴퓨터의 브라우저에만 저장되고 어디로도 보내지 않아요.</p>`;
    if (focusKey) {
      const again = el.querySelector(`[data-edit-key="${focusKey.replace(/"/g, '\\"')}"]`);
      if (again) {
        again.focus({ preventScroll: true });
        if (again.select) again.select();
      }
    }
  }

  function renderAll() {
    const s = Store.get();
    renderHud(s);
    renderUploadResult(s);
    renderResults(s);
    renderCutoffs(s, false);
    const count = host.querySelector('#cutCount');
    if (count) count.textContent = cutCountText(s);
  }

  // ---------- 자료 합치기 ----------

  function rebuild(sources, errors, cutoffs) {
    let merged;
    if (sources.template) merged = { students: sources.template.data, issues: sources.template.issues || [] };
    else {
      merged = root.Neis.merge(sources);
      const fileIssues = [];
      Object.values(sources).forEach((src) => src.issues.forEach((it) => fileIssues.push(Object.assign({ file: src.label }, it))));
      merged.issues = fileIssues.concat(merged.issues);
    }
    const any = Object.keys(sources).length > 0;
    Store.update((s) => ({
      dataset: any ? {
        sources,
        students: merged.students,
        issues: merged.issues,
        cls: (sources.grades && sources.grades.cls) || '',
        freeSemesters: (sources.grades && sources.grades.freeSemesters) || [],
        uploadedAt: new Date().toISOString(),
      } : null,
      lastError: errors && errors.length ? { at: new Date().toISOString(), errors } : null,
      cutoffs: cutoffs || s.cutoffs,
    }));
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (!root.XLSX) {
      Store.update({ lastError: { at: new Date().toISOString(), errors: [{ file: '', cell: '', text: '엑셀 읽기 도구를 불러오지 못했어요.', hint: 'assets/vendor 폴더가 index.html 옆에 그대로 있는지 확인해 주세요.' }] } });
      return;
    }
    busy = true;
    renderUploadResult(Store.get());
    const current = Store.get().dataset;
    let sources = Object.assign({}, (current && current.sources) || {});
    let cutoffs = null;
    const errors = [];
    for (const file of files) {
      if (!/\.(xlsx|xls)$/i.test(file.name)) {
        errors.push({ file: file.name, cell: '', text: '엑셀 파일(.xlsx, .xls)만 올릴 수 있어요.' });
        continue;
      }
      let wb;
      try {
        wb = root.XLSX.read(await file.arrayBuffer(), { type: 'array' });
      } catch (e) {
        errors.push({ file: file.name, cell: '', text: '파일을 열지 못했어요.', hint: '암호가 걸려 있거나 손상된 파일인지 확인해 주세요.' });
        continue;
      }
      const neis = root.Neis.parseWorkbook(wb, file.name);
      if (neis) {
        if (!neis.ok) {
          neis.errors.forEach((e) => errors.push(Object.assign({}, e, { file: `${file.name}(${neis.label})` })));
          continue;
        }
        delete sources.template;
        sources[neis.kind] = {
          kind: neis.kind, label: neis.label, fileName: file.name, cls: neis.cls,
          rows: neis.rows, issues: neis.issues, students: neis.students, freeSemesters: neis.freeSemesters || [],
        };
        continue;
      }
      if (wb.SheetNames.some((n) => root.Excel.norm(n).indexOf('성적') >= 0)) {
        const res = root.Excel.importWorkbook(wb, { fileName: file.name });
        if (!res.ok) {
          res.errors.forEach((e) => errors.push({ file: `${file.name} · ${e.sheet} 시트`, cell: e.cell, text: e.text, hint: e.hint }));
          continue;
        }
        sources = { template: { fileName: file.name, students: res.students.length, data: res.students, issues: res.issues.map((it) => ({ file: `${it.sheet} 시트`, cell: it.cell, text: it.text })) } };
        // 입력 양식의 커트라인은 한 해 값이라 가장 최근 학년도에 넣는다
        if (res.cutoffs) {
          const latest = cutLatestYear(Store.get());
          cutoffs = res.cutoffs.map((c) => ({ id: c.id, school: c.school, years: { [latest]: String(c.score) } }));
        }
        continue;
      }
      errors.push({ file: file.name, cell: '', text: '어떤 출력물인지 알 수 없어요.', hint: '나이스에서 내려받은 ‘학교생활기록부’ 교과학습발달상황·출결상황·수상경력 파일을 올려 주세요.' });
    }
    expanded = null;
    showAllIssues = false;
    busy = false;
    rebuild(sources, errors, cutoffs);
    if (cutoffs) renderCutoffs(Store.get(), true);
  }

  function removeSource(kind) {
    const d = Store.get().dataset;
    if (!d) return;
    const sources = Object.assign({}, d.sources);
    delete sources[kind];
    expanded = null;
    rebuild(sources, null, null);
  }

  // ---------- 동작 ----------

  function openCounsel(id) {
    const s = Store.get();
    const target = id || expanded || (s.dataset && s.dataset.students[0] && s.dataset.students[0].id) || '';
    const w = root.open(counselUrl(target), 'naesin-counsel');
    if (w) w.focus();
    else root.location.href = counselUrl(target);
  }

  // ---------- 나이스 값 고치기 ----------

  function saveEdits(sid, cur) {
    ['grades', 'attendance', 'awards'].forEach((k) => { if (cur[k] && !Object.keys(cur[k]).length) delete cur[k]; });
    Store.update((s) => {
      const edits = Object.assign({}, s.edits);
      if (Object.keys(cur).length) edits[sid] = cur;
      else delete edits[sid];
      return { edits };
    });
  }

  // 칸 하나를 고친다. 나이스 값과 같아지면 고친 기록을 지운다
  function commitEdit(el) {
    const box = el.closest('.fix');
    if (!box) return;
    const s = Store.get();
    const sid = box.dataset.fix;
    const raw = s.dataset && s.dataset.students.find((x) => x.id === sid);
    if (!raw) return;
    const err = box.querySelector('[data-fix-error]');
    const fail = (text) => {
      el.setAttribute('aria-invalid', 'true');
      err.textContent = text;
      err.hidden = false;
    };
    const value = String(el.value).trim();
    const key = el.dataset.key;
    const cur = JSON.parse(JSON.stringify((s.edits || {})[sid] || {}));

    if (el.dataset.edit === 'grade') {
      const g = raw.grades.find((x) => `${x.sem}|${x.subject}` === key);
      if (!g) return;
      const prev = (cur.grades || {})[key] || {};
      const next = { ach: prev.ach || g.ach };
      if (g.kind !== 'arts') next.raw = prev.raw != null ? prev.raw : g.raw;
      if (el.dataset.field === 'raw') {
        const n = Number(value);
        if (value === '' || !isFinite(n) || n < 0 || n > 100) { fail('원점수는 0~100 사이 숫자로 적어 주세요.'); return; }
        next.raw = Math.round(n * 10) / 10;
        next.ach = N.achFromRaw(next.raw);
      } else {
        next.ach = value;
      }
      cur.grades = Object.assign({}, cur.grades);
      if (next.ach === g.ach && (g.kind === 'arts' || next.raw === g.raw)) delete cur.grades[key];
      else cur.grades[key] = next;
    } else if (el.dataset.edit === 'att') {
      if (!/^\d+$/.test(value) || Number(value) > 365) { fail('출결은 0 이상의 정수로 적어 주세요.'); return; }
      const orig = raw.attendance[key];
      const base = orig || { absent: 0, late: 0, early: 0, missed: 0 };
      const next = Object.assign({ absent: base.absent, late: base.late, early: base.early, missed: base.missed }, (cur.attendance || {})[key]);
      next[el.dataset.field] = Number(value);
      cur.attendance = Object.assign({}, cur.attendance);
      // 나이스에 그 학년 출결이 없으면 0을 적어도 '확인한 값'으로 남긴다
      if (orig && ATT_FIELDS.every(([f]) => next[f] === orig[f])) delete cur.attendance[key];
      else cur.attendance[key] = next;
    } else if (el.dataset.edit === 'award') {
      if (!/^\d+$/.test(value) || Number(value) > 20) { fail('수상 개수는 0~20 사이 정수로 적어 주세요.'); return; }
      const orig = raw.awards.filter((a) => a.sem === key).length;
      cur.awards = Object.assign({}, cur.awards);
      if (Number(value) === orig) delete cur.awards[key];
      else cur.awards[key] = Number(value);
    }
    saveEdits(sid, cur);
  }

  function revertEdit(btn) {
    const box = btn.closest('.fix');
    const sid = box.dataset.fix;
    const s = Store.get();
    if (btn.hasAttribute('data-revert-all')) {
      if (!root.confirm('이 학생에게 고친 값을 모두 나이스 값으로 되돌릴까요?')) return;
      saveEdits(sid, {});
      return;
    }
    const cur = JSON.parse(JSON.stringify((s.edits || {})[sid] || {}));
    const part = { grade: 'grades', att: 'attendance', award: 'awards' }[btn.dataset.revert];
    if (cur[part]) delete cur[part][btn.dataset.key];
    saveEdits(sid, cur);
  }

  function updateCutoff(id, field, value, year) {
    Store.update((s) => {
      const latest = cutLatestYear(s);
      return {
        cutoffs: s.cutoffs.map((c) => {
          if (c.id !== id) return c;
          if (field === 'school') return Object.assign({}, c, { school: value.trim() });
          const years = Object.assign({}, cutYearTexts(c, latest));
          const text = value.trim();
          if (text) years[year] = text;
          else delete years[year];
          return { id: c.id, school: c.school, years };
        }),
      };
    });
  }

  // 예전에 한 해 값으로 저장한 커트라인({ score, text })을 학년도별 모양으로 바꿔 둔다
  function migrateCutoffs() {
    const s = Store.get();
    if (!(s.cutoffs || []).some((c) => !c.years)) return;
    const latest = cutLatestYear(s);
    Store.update({ cutoffs: s.cutoffs.map((c) => (c.years ? c : { id: c.id, school: c.school, years: cutYearTexts(c, latest) })) });
  }

  function bind() {
    const fileInput = host.querySelector('#file');
    const drop = host.querySelector('#drop');

    host.querySelector('#hud').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-go]');
      if (!btn) return;
      if (btn.dataset.go === 'send') { root.location.hash = '#send'; return; }
      const target = host.querySelector(`#${btn.dataset.go}`);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
      }
    });
    host.querySelector('#guideManage').addEventListener('click', () => root.Tour.start('manage', '입력·관리', TOUR));
    host.querySelector('#pick').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => { handleFiles(fileInput.files); fileInput.value = ''; });

    ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('is-over')));
    drop.addEventListener('drop', (e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); });

    host.querySelector('#template').addEventListener('click', () => {
      if (root.XLSX) root.Excel.downloadTemplate();
    });

    host.querySelector('#clearData').addEventListener('click', () => {
      if (root.confirm('저장된 학생 자료를 이 브라우저에서 지울까요? 학교별 커트라인은 남겨 둬요.')) {
        expanded = null;
        Store.clearData();
      }
    });

    host.querySelector('#addSchool').addEventListener('click', () => {
      const id = `c${Date.now().toString(36)}`;
      Store.update((s) => ({ cutoffs: (s.cutoffs || []).concat([{ id, school: '', years: {} }]) }));
      renderCutoffs(Store.get(), true);
      const input = host.querySelector(`.cut-row[data-id="${id}"] input`);
      if (input) input.focus();
    });
    host.querySelector('#cutLatest').addEventListener('change', (e) => {
      Store.update({ cutLatest: Number(e.target.value) });
      renderCutoffs(Store.get(), true);
    });
    host.querySelector('#importCut').addEventListener('click', () => {
      host.querySelector('#cutMsg').innerHTML = '';
      root.CutImport.open();
    });

    const cut = host.querySelector('#cutoffs');
    cut.addEventListener('input', (e) => {
      const row = e.target.closest('.cut-row');
      if (!row || !e.target.dataset.field) return;
      updateCutoff(row.dataset.id, e.target.dataset.field, e.target.value, e.target.dataset.year);
      if (e.target.dataset.field === 'year') {
        const s = Store.get();
        const c = s.cutoffs.find((x) => x.id === row.dataset.id);
        const years = cutYears(s);
        row.querySelector('.field-error').hidden = !(c && cutBad(cutYearTexts(c, cutLatestYear(s)), years));
      }
    });
    cut.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove]');
      if (!btn) return;
      const id = btn.closest('.cut-row').dataset.id;
      Store.update((s) => ({ cutoffs: s.cutoffs.filter((c) => c.id !== id) }));
      renderCutoffs(Store.get(), true);
    });

    host.querySelector('#uploadResult').addEventListener('click', (e) => {
      if (e.target.id === 'moreIssues') { showAllIssues = !showAllIssues; renderUploadResult(Store.get()); }
      const rm = e.target.closest('[data-remove]');
      if (rm) removeSource(rm.dataset.remove);
    });

    const results = host.querySelector('#results');
    const toggle = (row) => {
      expanded = expanded === row.dataset.id ? null : row.dataset.id;
      renderResults(Store.get());
      const again = results.querySelector(`.row[data-id="${row.dataset.id}"]`);
      if (again) again.focus({ preventScroll: true });
    };
    // 고치기 칸: 고르거나 칸을 떠날 때(Enter 포함) 저장. 다음 칸으로 커서가 옮겨 간 뒤 다시 그린다
    results.addEventListener('change', (e) => {
      const el = e.target.closest('[data-edit]');
      if (el) setTimeout(() => commitEdit(el), 0);
      // 임원 역할을 고르면 두 번째 칸을 학기(학급) 또는 학년(전교)으로 바꾼다
      const roleSel = e.target.closest('[data-officer-role]');
      if (roleSel) {
        const box = roleSel.closest('.officer-box');
        const when = box.querySelector('[data-officer-when]');
        when.innerHTML = officerWhenOptions(roleSel.value);
        when.disabled = false;
        when.setAttribute('aria-label', root.UI.isSchoolOfficer(roleSel.value) ? '학년' : '학기');
        box.querySelector('[data-officer-error]').hidden = true;
      }
    });
    results.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('input[data-edit]')) { e.preventDefault(); e.target.blur(); e.target.focus(); }
    });
    // <details>의 열림은 다시 그려도 남긴다(toggle은 버블링되지 않아 잡기 단계에서 받는다)
    results.addEventListener('toggle', (e) => {
      if (!e.target.matches || !e.target.matches('.fix')) return;
      if (e.target.open) openFix = e.target.dataset.fix;
      else if (openFix === e.target.dataset.fix) openFix = null;
    }, true);

    results.addEventListener('click', (e) => {
      const counsel = e.target.closest('[data-counsel]');
      if (counsel) { openCounsel(counsel.dataset.counsel); return; }
      const revert = e.target.closest('[data-revert], [data-revert-all]');
      if (revert) { revertEdit(revert); return; }
      const semBtn = e.target.closest('[data-fix-sem]');
      if (semBtn) { fixSem = semBtn.dataset.fixSem; renderResults(Store.get()); return; }
      if (e.target.closest('.fix')) return;
      const box = e.target.closest('.officer-box');
      if (box) {
        const sid = box.dataset.student;
        if (e.target.closest('[data-officer-add]')) {
          const role = box.querySelector('[data-officer-role]').value;
          const when = box.querySelector('[data-officer-when]').value;
          const school = root.UI.isSchoolOfficer(role);
          let rec = null;
          if (role && when) {
            if (school) {
              const sems = root.UI.OFFICER_YEARS.find(([v]) => v === when)[2];
              rec = { role, grade: when, sems, months: sems.length * 6 };
            } else {
              rec = { role, sem: when, months: root.UI.OFFICER_SEMS.find(([v]) => v === when)[2] };
            }
          }
          // 학급끼리·전교끼리 기간이 겹치면 막는다. 학급과 전교가 겹치는 것은 넣고 계산에서 한 번만 친다
          const clash = rec && ((Store.get().officers || {})[sid] || []).find((o) => root.UI.isSchoolOfficer(o.role) === school
            && root.UI.officerSems(o).some((sem) => root.UI.officerSems(rec).indexOf(sem) >= 0));
          const err = !role ? '임원을 골라 주세요.'
            : !when ? `${school ? '학년을' : '학기를'} 골라 주세요.`
              : clash ? `${officerPeriod(clash)} ${clash.role}을 이미 넣었어요. 같은 기간에는 한 가지만 반영돼요.` : '';
          const errEl = box.querySelector('[data-officer-error]');
          errEl.textContent = err;
          errEl.hidden = !err;
          if (err) return;
          Store.update((s) => {
            const officers = Object.assign({}, s.officers);
            officers[sid] = (officers[sid] || []).concat([Object.assign({ id: `o${Date.now().toString(36)}` }, rec)]);
            return { officers };
          });
        }
        const del = e.target.closest('[data-officer-del]');
        if (del) {
          Store.update((s) => {
            const officers = Object.assign({}, s.officers);
            officers[sid] = (officers[sid] || []).filter((o) => o.id !== del.dataset.officerDel);
            return { officers };
          });
        }
        return;
      }
      const row = e.target.closest('.row');
      if (row) toggle(row);
    });
    results.addEventListener('keydown', (e) => {
      const row = e.target.closest('.row');
      if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(row); }
    });
  }

  // 사진으로 커트라인을 넣고 나면 목록을 다시 그리고 몇 곳 넣었는지 알린다
  function onCutImport(e) {
    renderCutoffs(Store.get(), true);
    const { added, changed } = e.detail;
    const done = [added ? `새 학교 ${added}곳` : '', changed ? `값을 바꾼 학교 ${changed}곳` : ''].filter(Boolean).join(', ');
    host.querySelector('#cutMsg').innerHTML = `<div class="msg msg-ok"><p class="msg-text">커트라인을 넣었어요(${done}). 원본과 한 번 더 비교해 주세요.</p></div>`;
  }

  root.ManageView = {
    mount(el) {
      host = el;
      document.title = '내신나침반 · 입력·관리';
      migrateCutoffs();
      host.innerHTML = skeleton();
      bind();
      renderAll();
      renderCutoffs(Store.get(), true);
      if (unsub) unsub();
      unsub = Store.subscribe((s, meta) => {
        saveFailed = meta && meta.saved === false;
        renderAll();
      });
      document.addEventListener('cutimport', onCutImport);
      root.Tour.auto('manage', '입력·관리', TOUR, () => document.body.dataset.view === 'manage');
    },
    unmount() {
      if (unsub) unsub();
      unsub = null;
      document.removeEventListener('cutimport', onCutImport);
    },
    handleFiles,
    setExpanded(id) { expanded = id; if (host) renderResults(Store.get()); },
  };
})(window);
