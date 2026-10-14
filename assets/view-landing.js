/*
 * 내신나침반 — 첫 화면(히어로): 무엇을 하는 도구인지 한눈에 보여 주고, 버튼을 누르면 작업 화면으로 간다
 */
(function (root) {
  'use strict';

  const { esc, formatTime, brandMark } = root.UI;

  const STEPS = [
    ['나이스 출력물 올리기', '교과·출결·수상 엑셀 3개를 그대로'],
    ['커트라인 넣기', '작년 학교별 200점 만점 점수'],
    ['학생별 점수 점검', '학기별 점수와 확인할 점'],
    ['태블릿으로 상담', '목표 학교까지 3학년에 필요한 점수'],
  ];

  // 상담 화면이 무엇을 보여 주는지 감을 잡게 하는 가상 학생 예시(실제 자료와 무관)
  function preview() {
    return `
      <aside class="preview" aria-label="상담 화면 예시">
        <div class="preview-card">
          <p class="preview-top"><span class="preview-tag">상담 화면 예시</span><span class="desc">가상 학생</span></p>
          <p class="preview-school">○○고등학교 · 작년 커트라인 <strong>181.300</strong></p>
          <p class="preview-total"><strong class="preview-num">179.452</strong><span class="max">/ 200 예상</span></p>
          <div class="gauge" aria-hidden="true">
            <div class="gauge-track"><div class="gauge-fill" style="width:72%"></div><div class="gauge-mark" style="left:81%"></div></div>
          </div>
          <p class="preview-verdict">커트라인까지 1.848점 남았어요</p>
          <dl class="preview-list">
            <div><dt>3학년 일반교과</dt><dd>학기마다 <strong>26.9점</strong> 이상</dd></div>
            <div><dt>3학년 1학기 수상 1개</dt><dd>학교활동 <strong>+0.5점</strong></dd></div>
          </dl>
        </div>
      </aside>`;
  }

  function render(host) {
    const d = Store.get().dataset;
    const saved = d && d.students && d.students.length;
    host.innerHTML = `
      <div class="landing">
        <header class="landing-bar">
          <span class="brand">${brandMark()}<span class="brand-name">내신나침반</span></span>
          <span class="landing-basis">2028학년도 고입 지침 예고안 기준</span>
        </header>
        <main class="landing-main">
          <section class="landing-hero">
            <div class="landing-copy">
              <p class="landing-eyebrow">경기도 중학교 2학년 담임을 위한 고입 내신 상담 도구</p>
              <h1 class="landing-title">
                <span class="line">나이스 출력물 세 개로,</span>
                <span class="line">목표 학교까지 <mark class="hl">남은 점수</mark>를.</span>
              </h1>
              <p class="landing-sub">교과·출결·수상 출력물을 올리면 반 전체 고입 내신(200점)이 계산되고,<br>상담에서는 태블릿으로 3학년에 필요한 점수를 학생과 함께 봐요.</p>
              <div class="landing-actions">
                <a class="landing-cta" href="#manage">${saved ? '이어서 하기' : '내신 계산 시작하기'} <span aria-hidden="true">→</span></a>
                ${saved ? `<p class="landing-saved">저장된 자료 · ${esc(d.cls || '우리 반')} ${d.students.length}명 · ${esc(formatTime(d.uploadedAt))}</p>` : ''}
              </div>
            </div>
            ${preview()}
          </section>
          <section class="landing-route" aria-label="사용 순서">
            <ol class="route">
              ${STEPS.map(([title, line], i) => `
                <li><span class="route-num">${i + 1}</span><span class="route-title">${title}</span><span class="route-line">${line}</span></li>`).join('')}
            </ol>
            <p class="landing-note">자료는 이 컴퓨터의 브라우저에만 저장되고 어디로도 보내지 않아요.</p>
          </section>
        </main>
      </div>`;
  }

  root.LandingView = {
    mount(el) {
      document.title = '내신나침반';
      render(el);
    },
    unmount() {},
  };
})(window);
