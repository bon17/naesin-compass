/*
 * 내신나침반 — 태블릿으로 보내기(학교 PC): 암호 4자리를 정하면 반 전체 상담 자료를 QR 여러 장으로 보여 준다
 * 인터넷을 쓰지 않는다. 태블릿 앱이 QR을 찍어 모으고 같은 암호로 푼다.
 */
(function (root) {
  'use strict';

  const { esc, formatTime, computeAll, validCutoffs, cutYears, brandMark, guideButton, BASIS } = root.UI;

  const TOUR = [
    { target: '#pinForm', title: '암호 4자리를 정해요',
      body: ['태블릿에서 상담 자료를 열 때마다 누르는 숫자예요.', '화면에 다시 보여 주지 않으니 <strong>꼭 기억해 두세요.</strong>'] },
    { target: '.send-side .steps', title: '태블릿에서 이렇게 찍어요',
      body: ['태블릿에서 <strong>내신나침반-태블릿.html</strong>을 열어요.', '아이패드는 ‘카메라로 찍기’, 갤럭시탭은 ‘사진으로 찍기’로 QR을 한 장씩 찍고 암호를 눌러요.'] },
    { target: '.qr-stage', title: 'QR을 한 장씩 넘겨요',
      body: ['‘다음 QR’이나 키보드 → 로 넘겨요. 찍는 순서는 상관없어요.', '태블릿 자료는 30일 뒤 저절로 지워지고, 자료를 고치면 QR을 새로 만들어요.'] },
  ];

  const QR_CHARS = 1100; // 한 장에 담는 글자 수(버전 21 안팎). 아이패드·갤럭시탭 시험판에서 읽힌 크기
  let host = null;
  let unsub = null;
  let onKey = null;
  let parts = null; // 만든 QR 글자들
  let index = 0;
  let madeSig = '';
  let madeAt = '';
  let making = false;

  // 보낼 자료: 담임이 넣은 임원 기록까지 더한 학생 + 유효한 커트라인
  function packState(s, made) {
    const students = computeAll(s).map((x) => x.student);
    return root.Payload.pack(students, validCutoffs(s), { basis: BASIS, cls: s.dataset.cls, made, years: cutYears(s) });
  }

  // 자료 지문: 만든 시각을 뺀 자료가 같으면 같은 값
  function signature(s) {
    if (!s.dataset || !s.dataset.students.length || !root.Payload) return '';
    const text = JSON.stringify(packState(s, '-'));
    let h = 5381;
    for (let i = 0; i < text.length; i += 1) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
    return `${text.length}:${h.toString(36)}`;
  }

  function qrSvg(text) {
    const qr = root.qrcode(0, 'M');
    qr.addData(text, 'Alphanumeric');
    qr.make();
    const n = qr.getModuleCount();
    const quiet = 4;
    let d = '';
    for (let r = 0; r < n; r += 1) {
      for (let c = 0; c < n; c += 1) if (qr.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }
    const size = n + quiet * 2;
    return `<svg class="qr-svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="상담 자료 QR ${index + 1}번"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }

  function addDays(iso, days) {
    const d = new Date(iso);
    d.setDate(d.getDate() + days);
    return `${d.getMonth() + 1}월 ${d.getDate()}일`;
  }

  function stage(s) {
    if (!parts) {
      return `
        <div class="qr-empty">
          <p class="qr-empty-title">암호를 정하면 여기에 QR이 나와요</p>
          <p class="desc">QR은 2~4장이에요. 태블릿으로 한 장씩 찍으면 돼요.</p>
        </div>`;
    }
    const stale = madeSig !== signature(s);
    const dots = parts.map((p, i) => `<span class="qr-dot${i === index ? ' is-on' : ''}"></span>`).join('');
    return `
      ${stale ? '<div class="msg msg-warn" role="alert"><p class="msg-title">QR을 만든 뒤 자료가 바뀌었어요</p><p class="msg-text">암호를 다시 적고 QR을 새로 만들어 주세요.</p></div>' : ''}
      <p class="qr-count">QR <strong>${index + 1}</strong> / ${parts.length}</p>
      <div class="qr-box">${qrSvg(parts[index])}</div>
      <div class="qr-nav">
        <button type="button" class="btn btn-quiet" id="qrPrev"${index === 0 ? ' disabled' : ''}>‹ 이전</button>
        <span class="qr-dots" aria-hidden="true">${dots}</span>
        <button type="button" class="btn btn-primary" id="qrNext"${index === parts.length - 1 ? ' disabled' : ''}>다음 QR ›</button>
      </div>
      <p class="desc qr-foot">${esc(formatTime(madeAt))}에 만든 QR · 순서는 상관없어요 · 키보드 ←, → 로도 넘겨요</p>`;
  }

  function side(s) {
    const d = s.dataset;
    const cutoffs = validCutoffs(s);
    return `
      <section class="send-side" aria-labelledby="t-pin">
        <h2 id="t-pin" class="block-title"><span class="step">1</span>암호 4자리 정하기</h2>
        <p class="desc">태블릿에서 상담 자료를 열 때마다 누르는 숫자예요. 화면에 다시 보여 주지 않으니 기억해 두세요.</p>
        <form id="pinForm" class="pin-form" novalidate>
          <input id="sendPin" class="input pin-input" type="text" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="숫자 4자리" aria-label="태블릿 암호 4자리" aria-describedby="pinError">
          <button type="submit" class="btn btn-primary"${making ? ' disabled' : ''}>${making ? '만드는 중…' : parts ? 'QR 다시 만들기' : 'QR 만들기'}</button>
        </form>
        <p class="field-error" id="pinError" hidden>숫자 4자리를 적어 주세요.</p>
        ${cutoffs.length ? '' : '<div class="msg msg-warn"><p class="msg-text">넣은 커트라인이 없어요. 이대로 보내면 태블릿에서 목표 학교를 고를 수 없어요.</p></div>'}

        <h2 class="block-title send-gap"><span class="step">2</span>태블릿에서 찍기</h2>
        <ol class="steps">
          <li>태블릿에서 <strong>내신나침반-태블릿.html</strong> 파일을 열어요. 처음 한 번은 앱 폴더에서 태블릿으로 옮겨 주세요(학생 자료는 들어 있지 않아요).</li>
          <li>아이패드는 ‘카메라로 찍기’, 갤럭시탭은 ‘사진으로 찍기’로 오른쪽 QR을 한 장씩 찍어요.</li>
          <li>다 찍으면 태블릿에서 방금 정한 암호 4자리를 눌러요.</li>
        </ol>

        <div class="callout send-what">
          <p><strong>보내는 자료</strong> ${esc(d.cls || '우리 반')} ${d.students.length}명 · 학교 ${cutoffs.length}곳</p>
          <p class="desc">번호·이름, 과목별 성취도·원점수, 출결, 학기별 수상 개수, 임원 개월 수, 커트라인. 수상명과 엑셀 원본은 보내지 않아요.</p>
          <p class="desc">태블릿에서는 QR을 만든 날부터 30일 뒤${parts ? `(${addDays(madeAt, root.Payload.DAYS)})` : ''} 저절로 지워져요.</p>
        </div>
      </section>`;
  }

  function render() {
    const s = Store.get();
    const head = `
      <header class="work-head">
        <div class="wrap work-head-inner">
          <h1 class="work-title"><a href="#" class="brand">${brandMark()}<span class="brand-name">내신나침반</span></a> <span class="work-sub">태블릿으로 보내기</span></h1>
          <div class="work-actions">${guideButton('guideSend')}<a class="btn-text" href="#manage">입력·관리로 돌아가기</a></div>
        </div>
      </header>`;
    if (!s.dataset || !s.dataset.students.length) {
      host.innerHTML = `${head}
        <main class="wrap layout-single">
          <div class="empty">
            <p class="empty-title">보낼 자료가 없어요</p>
            <p>입력·관리 화면에서 나이스 출력물을 먼저 올려 주세요.</p>
            <a class="btn btn-outline" href="#manage">입력·관리 화면으로 가기</a>
          </div>
        </main>`;
      return;
    }
    const focusId = document.activeElement && document.activeElement.id;
    const pinValue = host.querySelector('#sendPin') ? host.querySelector('#sendPin').value : '';
    host.innerHTML = `${head}
      <main class="wrap layout-send">
        ${side(s)}
        <section class="qr-stage" aria-label="QR" aria-live="polite">${stage(s)}</section>
      </main>`;
    const pinInput = host.querySelector('#sendPin');
    pinInput.value = pinValue;
    if (focusId) {
      const el = host.querySelector(`#${focusId}`);
      if (el && !el.disabled) el.focus({ preventScroll: true });
    }
  }

  async function make(pin) {
    const s = Store.get();
    making = true;
    render();
    try {
      const made = new Date().toISOString();
      const sealed = await root.Transfer.seal(packState(s, made), pin);
      parts = root.Transfer.split(sealed, QR_CHARS);
      index = 0;
      madeAt = made;
      madeSig = signature(s);
      making = false;
      Store.update({ sentAt: made, sentSig: madeSig });
    } catch (e) {
      making = false;
      parts = null;
      render();
      host.querySelector('.qr-stage').innerHTML = `<div class="msg msg-error" role="alert"><p class="msg-title">QR을 만들지 못했어요</p><p class="msg-text">이 브라우저에서 암호 도구를 쓸 수 없어요. 크롬·엣지·웨일 최신판으로 index.html을 열어 주세요. (${esc(e.message)})</p></div>`;
    }
  }

  function move(step) {
    if (!parts) return;
    const next = Math.max(0, Math.min(parts.length - 1, index + step));
    if (next === index) return;
    index = next;
    host.querySelector('.qr-stage').innerHTML = stage(Store.get());
  }

  function bind() {
    host.addEventListener('submit', (e) => {
      if (e.target.id !== 'pinForm') return;
      e.preventDefault();
      const input = host.querySelector('#sendPin');
      const pin = input.value.trim();
      const ok = /^\d{4}$/.test(pin);
      host.querySelector('#pinError').hidden = ok;
      input.setAttribute('aria-invalid', ok ? 'false' : 'true');
      if (!ok) { input.focus(); return; }
      input.value = '';
      make(pin);
    });
    host.addEventListener('input', (e) => {
      if (e.target.id === 'sendPin') e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
    });
    host.addEventListener('click', (e) => {
      if (e.target.closest('#guideSend')) root.Tour.start('send', '태블릿으로 보내기', TOUR);
      if (e.target.closest('#qrPrev')) move(-1);
      if (e.target.closest('#qrNext')) move(1);
    });
  }

  root.SendView = {
    mount(el) {
      host = el;
      document.title = '내신나침반 · 태블릿으로 보내기';
      if (!host.dataset.sendBound) { bind(); host.dataset.sendBound = '1'; }
      render();
      if (unsub) unsub();
      unsub = Store.subscribe(() => render());
      onKey = (e) => {
        if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
        if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); move(1); }
        if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); move(-1); }
      };
      document.addEventListener('keydown', onKey);
      root.Tour.auto('send', '태블릿으로 보내기', TOUR, () => document.body.dataset.view === 'send' && !!host.querySelector('#pinForm'));
    },
    unmount() {
      if (unsub) unsub();
      unsub = null;
      if (onKey) document.removeEventListener('keydown', onKey);
      onKey = null;
      // 화면을 떠나면 QR을 지운다(다시 오면 암호부터)
      parts = null;
      index = 0;
    },
    signature,
  };
})(window);
