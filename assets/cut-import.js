/*
 * 내신나침반 — 커트라인 표 엑셀·사진·PDF(또는 복사한 글자)를 학교별 커트라인으로 정리해 넣기
 * 파일은 이 컴퓨터 안에서만 읽는다(SheetJS, assets/ocr.js, assets/pdf-read.js). 넣기 전에 원본과 비교해 고칠 수 있는 표를 보여 준다.
 * 다 넣으면 document에 'cutimport' 이벤트({ added, changed })를 보낸다.
 */
(function (root) {
  'use strict';

  const { esc, cutYears, cutYearTexts, cutNumber, isCutNote } = root.UI;

  let dlg = null;
  // { phase: 'pick'|'reading'|'review', images: [원본 그림 주소], source: 'excel'|'image'|'pdf-text'|'pdf-scan'|'text', table: 엑셀 머리글로 열을 맞췄는지, note, text, order, rows, skipped, status, progress, error }
  let st = null;

  const SOURCE_NOTE = {
    excel: '엑셀 표를 머리글의 학년도에 맞춰 옮겼어요. 학교와 해가 맞는지 확인해 주세요.',
    image: '사진에서 읽은 글자예요. 숫자를 사진과 꼭 비교해 주세요.',
    'pdf-text': 'PDF에 들어 있는 글자를 그대로 꺼냈어요. 학교와 해가 맞게 나뉘었는지 확인해 주세요.',
    'pdf-scan': '스캔한 PDF라 그림에서 글자를 읽었어요. 숫자를 원본과 꼭 비교해 주세요.',
    text: '붙여 넣은 글자로 정리했어요.',
  };

  const thumbs = (cls) => st.images.map((src, i) => `<img class="${cls}" src="${src}" alt="올린 자료 ${st.images.length > 1 ? `${i + 1}쪽` : ''}">`).join('');

  const validNum = (v) => { const n = cutNumber(v); return typeof n === 'number' && !isNaN(n); };
  // 넣을 수 있는 값: 커트라인 숫자 또는 '미달' 같은 메모
  const keepable = (v) => validNum(v) || isCutNote(v);
  const sameCut = (a, b) => (validNum(a) && validNum(b) ? cutNumber(a) === cutNumber(b) : String(a == null ? '' : a).trim() === String(b == null ? '' : b).trim());
  const usable = (r) => r.use && r.school.trim() && Object.keys(r.values).some((y) => keepable(r.values[y]));

  function existingOf(school) {
    const key = root.Ocr.normName(school);
    return (Store.get().cutoffs || []).find((c) => c.school && root.Ocr.normName(c.school) === key);
  }

  function stateText(r, years) {
    if (Object.keys(r.values).some((y) => r.values[y] !== '' && r.values[y] != null && !keepable(r.values[y]))) return '<span class="tone-bad">숫자 확인</span>';
    const missing = r.unsure.filter((y) => r.values[y] == null || r.values[y] === '');
    if (missing.length) return `<span class="tone-bad">${missing.join('·')} 칸을 원본에서 확인</span>`;
    if (r.guessed.length) return `<span class="tone-warn">${r.guessed.join('·')} 소수점을 넣었어요 · 확인</span>`;
    const old = existingOf(r.school);
    if (!old) return '<span class="tag tag-edit">새 학교</span>';
    const texts = cutYearTexts(old, years[years.length - 1]);
    const diffs = years.filter((y) => keepable(r.values[y]) && !sameCut(texts[y], r.values[y]));
    if (!diffs.length) return '<span class="desc">같음</span>';
    return `<span class="tag tag-soft">바꿈</span> <span class="desc">${diffs.map((y) => `${y} ${texts[y] ? esc(texts[y]) : '없음'}→${esc(r.values[y])}`).join(', ')}</span>`;
  }

  function head() {
    return `
      <div class="dialog-head">
        <h2 id="ciTitle" class="dialog-title">커트라인 표 엑셀·사진·PDF로 넣기</h2>
        <button type="button" class="tour-x" data-ci="close" aria-label="닫기">✕</button>
      </div>`;
  }

  function render() {
    const years = cutYears(Store.get());
    const body = dlg.querySelector('.dialog-body');
    if (st.phase === 'pick') {
      body.innerHTML = `${head()}
        <p class="desc">학교 이름과 학년도별 커트라인이 있는 엑셀, 사진, 캡처, PDF를 고르세요. <strong>이 컴퓨터 안에서만</strong> 읽고 어디로도 보내지 않아요.</p>
        <div class="drop ci-drop" data-ci-drop>
          <p class="drop-text">파일을 여기에 끌어다 놓거나</p>
          <button type="button" class="btn btn-primary" data-ci="pick">엑셀·사진·PDF 고르기</button>
          <p class="desc">엑셀(.xlsx·.xls, 머리글에 학년도가 있으면 그 열에 맞춰 넣어요), jpg·png 사진, PDF(한글·엑셀에서 저장한 것도, 스캔한 것도) · 화면을 캡처한 뒤 이 창에서 Ctrl+V로 붙여 넣어도 돼요</p>
        </div>
        <input type="file" accept=".xlsx,.xls,image/*,application/pdf,.pdf" hidden data-ci-file>
        ${st.error ? `<div class="msg msg-error" role="alert"><p class="msg-text">${esc(st.error)}</p></div>` : ''}
        <details class="guide">
          <summary>사진 대신 글자로 붙여 넣기</summary>
          <p class="desc">한글·엑셀·PDF의 표를 복사해 붙여 넣어도 돼요. 한 줄에 학교 하나, 학교 이름과 커트라인 숫자가 있으면 돼요.</p>
          <textarea class="input ci-text" rows="6" data-ci-text placeholder="학교명  ${years.join('  ')}&#10;가온고  181.70  182.35  183.10  181.92">${esc(st.text || '')}</textarea>
          <button type="button" class="btn btn-quiet" data-ci="parse">정리하기</button>
        </details>`;
      return;
    }
    if (st.phase === 'reading') {
      body.innerHTML = `${head()}
        <div class="ci-reading">
          ${st.images.length ? `<div class="ci-thumbs">${thumbs('ci-thumb')}</div>` : ''}
          <div>
            <p class="ci-status" data-ci-status>${esc(st.status || '준비하는 중이에요…')}</p>
            <div class="ci-bar" aria-hidden="true"><i data-ci-bar style="width:${Math.round((st.progress || 0) * 100)}%"></i></div>
            <p class="desc">처음 한 번은 글자 읽기 도구를 불러오느라 10초쯤 걸릴 수 있어요.</p>
          </div>
        </div>`;
      return;
    }
    const count = st.rows.filter(usable).length;
    body.innerHTML = `${head()}
      <p class="desc">읽은 내용을 원본과 비교해 고친 뒤 넣으세요. 빈칸은 넣지 않고, 이미 있는 학교는 적은 해의 값만 바꿔요.</p>
      ${st.source ? `<p class="ci-source">${esc(SOURCE_NOTE[st.source])}${st.note ? ` ${esc(st.note)}` : ''}</p>` : ''}
      <div class="ci-review${st.images.length ? ' has-photo' : ''}">
        ${st.images.length ? `<figure class="ci-photo">${thumbs('')}</figure>` : ''}
        <div class="ci-main">
          ${st.table ? '' : `<div class="ci-tools">
            <label class="tool-field"><span class="tool-label">숫자 순서</span>
              <select class="select" data-ci-order>
                <option value="auto"${st.order === 'auto' ? ' selected' : ''}>자동(머리글 연도대로)</option>
                <option value="asc"${st.order === 'asc' ? ' selected' : ''}>왼쪽이 오래된 해</option>
                <option value="desc"${st.order === 'desc' ? ' selected' : ''}>왼쪽이 최근 해</option>
              </select>
            </label>
            <span class="desc">바꾸면 읽은 글자로 다시 정리해요</span>
          </div>`}
          <div class="table-wrap"><table class="table mini ci-table">
            <thead><tr><th scope="col"><span class="sr-only">넣기</span></th><th scope="col">학교명</th>${years.map((y) => `<th scope="col">${y}</th>`).join('')}<th scope="col">상태</th></tr></thead>
            <tbody>${st.rows.map((r, i) => `
              <tr data-i="${i}">
                <td><input type="checkbox" class="ci-check" data-ci-use${r.use ? ' checked' : ''} aria-label="${esc(r.school)} 넣기"></td>
                <td><input class="input ci-school" data-ci-school value="${esc(r.school)}" aria-label="학교명"></td>
                ${years.map((y) => {
                  const unsure = r.unsure.indexOf(y) >= 0 && (r.values[y] == null || r.values[y] === '');
                  const guess = r.guessed.indexOf(y) >= 0;
                  return `<td><input class="input num ci-num${unsure ? ' is-unsure' : guess ? ' is-guess' : ''}" data-ci-year="${y}" inputmode="decimal" value="${r.values[y] != null ? esc(r.values[y]) : ''}" placeholder="${unsure ? '?' : '—'}" aria-label="${esc(r.school)} ${y}학년도${unsure ? ', 잘못 읽어 확인 필요' : guess ? ', 소수점을 넣은 값이라 확인 필요' : ''}"></td>`;
                }).join('')}
                <td class="ci-state" data-ci-state>${stateText(r, years)}</td>
              </tr>`).join('')}</tbody>
          </table></div>
          ${st.rows.length ? '' : '<p class="empty-line">학교와 커트라인을 찾지 못했어요. 아래 ‘읽은 글자’를 고쳐 다시 정리하거나, 표가 사진을 가득 채우게 다시 찍어 보세요.</p>'}
          ${st.skipped.length ? `<p class="desc">정리하지 못한 줄 ${st.skipped.length}개: ${esc(st.skipped.slice(0, 3).join(' / '))}${st.skipped.length > 3 ? ' …' : ''}</p>` : ''}
          <details class="guide">
            <summary>읽은 글자 보기·고치기</summary>
            <textarea class="input ci-text" rows="8" data-ci-text>${esc(st.text || '')}</textarea>
            <button type="button" class="btn btn-quiet" data-ci="parse">다시 정리하기</button>
          </details>
        </div>
      </div>
      <div class="dialog-foot">
        <button type="button" class="btn-text" data-ci="again">다른 파일로</button>
        <span class="dialog-actions">
          <button type="button" class="btn btn-quiet" data-ci="close">닫기</button>
          <button type="button" class="btn btn-primary" data-ci="apply"${count ? '' : ' disabled'}>커트라인에 넣기 (${count}곳)</button>
        </span>
      </div>`;
  }

  function showRows(res) {
    st.rows = res.rows.map((r) => ({ school: r.school, values: Object.assign({}, r.values), unsure: r.unsure || [], guessed: r.guessed || [], use: true }));
    st.skipped = res.skipped;
    st.phase = 'review';
    render();
  }

  function parse(text) {
    const years = cutYears(Store.get());
    st.text = text;
    st.table = false;
    showRows(root.Ocr.parseCutoffs(text, years, st.order));
  }

  const isExcel = (file) => /\.(xlsx|xls)$/i.test(file.name || '') || /spreadsheetml|ms-excel/.test(file.type || '');

  // 엑셀: 시트마다 머리글 학년도로 열을 맞추고, 머리글을 못 찾으면 글자로 바꿔 정리한다
  async function readExcel(file) {
    dropImages();
    st.source = 'excel';
    st.error = '';
    st.note = '';
    let wb;
    try {
      wb = root.XLSX.read(await file.arrayBuffer(), { type: 'array' });
    } catch (e) {
      st.phase = 'pick';
      st.error = '엑셀 파일을 열지 못했어요. 암호가 걸려 있거나 손상된 파일인지 확인해 주세요.';
      render();
      return;
    }
    if (!dlg.open) return;
    const years = cutYears(Store.get());
    const grids = wb.SheetNames.map((n) => root.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }));
    const text = grids.map((g) => g.map((r) => r.map((v) => String(v).trim()).join('  ').trim()).filter(Boolean).join('\n')).join('\n');
    const found = grids.map((g) => root.Ocr.parseCutoffTable(g, years)).filter((res) => res && res.rows.length);
    if (!found.length) { parse(text); return; }
    const outside = Array.from(new Set([].concat(...found.map((res) => res.outside)))).sort();
    if (outside.length) st.note = `${outside.join('·')}학년도 열은 화면의 네 해(${years[0]}~${years[years.length - 1]}) 밖이라 뺐어요.`;
    st.text = text;
    st.table = true;
    showRows({ rows: [].concat(...found.map((res) => res.rows)), skipped: [].concat(...found.map((res) => res.skipped)) });
  }

  function dropImages() {
    st.images.forEach((u) => { if (u.indexOf('blob:') === 0) URL.revokeObjectURL(u); });
    st.images = [];
  }

  async function readFile(file) {
    if (file && root.XLSX && isExcel(file)) { readExcel(file); return; }
    const pdf = root.PdfRead && root.PdfRead.isPdf(file);
    if (!file || (!pdf && !/^image\//.test(file.type))) {
      st.error = '엑셀(.xlsx·.xls), 사진(jpg·png 등), PDF만 읽을 수 있어요.';
      st.phase = 'pick';
      render();
      return;
    }
    dropImages();
    if (!pdf) st.images = [URL.createObjectURL(file)];
    st.phase = 'reading';
    st.error = '';
    st.note = '';
    st.progress = 0;
    render();
    const status = (s) => {
      st.status = s;
      const el = dlg.querySelector('[data-ci-status]');
      if (el) el.textContent = s;
    };
    const progress = (p) => {
      st.progress = p;
      const bar = dlg.querySelector('[data-ci-bar]');
      if (bar) bar.style.width = `${Math.round(p * 100)}%`;
    };
    try {
      let text;
      if (pdf) {
        const res = await root.PdfRead.read(file, status, progress);
        st.images = res.previews;
        st.source = res.scanned ? 'pdf-scan' : 'pdf-text';
        if (res.skippedPages) st.note = `앞 ${res.pages}쪽만 읽었어요(전체 ${res.pages + res.skippedPages}쪽).`;
        text = res.text;
      } else {
        st.source = 'image';
        text = await root.Ocr.readImage(file, status, progress);
      }
      if (!dlg.open) return;
      parse(text);
    } catch (e) {
      st.phase = 'pick';
      st.error = pdf
        ? `PDF를 읽지 못했어요. 암호가 걸린 PDF인지, index.html 옆 assets/vendor/pdf 폴더가 그대로 있는지 확인해 주세요. 표를 복사해 붙여 넣어도 돼요. (${e.message || e})`
        : `글자 읽기 도구를 쓰지 못했어요. index.html 옆 assets/vendor/ocr 폴더가 그대로 있는지 확인해 주세요. 표를 글자로 복사해 붙여 넣어도 돼요. (${e.message || e})`;
      render();
    }
  }

  function apply() {
    const use = st.rows.filter(usable);
    let added = 0;
    let changed = 0;
    Store.update((s) => {
      const years = cutYears(s);
      const list = (s.cutoffs || []).map((c) => ({ id: c.id, school: c.school, years: Object.assign({}, cutYearTexts(c, years[years.length - 1])) }));
      use.forEach((r, i) => {
        const vals = {};
        years.forEach((y) => {
          const v = r.values[y];
          if (validNum(v)) vals[y] = String(cutNumber(v));
          else if (isCutNote(v)) vals[y] = String(v).replace(/\s+/g, ' ').trim();
        });
        const key = root.Ocr.normName(r.school);
        const found = list.find((c) => c.school && root.Ocr.normName(c.school) === key);
        if (found) { Object.assign(found.years, vals); changed += 1; }
        else { list.push({ id: `c${Date.now().toString(36)}${i}`, school: r.school.trim(), years: vals }); added += 1; }
      });
      return { cutoffs: list };
    });
    close();
    document.dispatchEvent(new CustomEvent('cutimport', { detail: { added, changed } }));
  }

  function close() {
    if (dlg && dlg.open) dlg.close();
  }

  function build() {
    dlg = document.createElement('dialog');
    dlg.className = 'dialog';
    dlg.setAttribute('aria-labelledby', 'ciTitle');
    dlg.innerHTML = '<div class="dialog-body"></div>';
    document.body.appendChild(dlg);

    dlg.addEventListener('close', () => {
      if (st) dropImages();
      st = null;
    });
    dlg.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ci]');
      if (!b) return;
      const act = b.dataset.ci;
      if (act === 'close') close();
      if (act === 'pick') dlg.querySelector('[data-ci-file]').click();
      if (act === 'again') { dropImages(); st.source = ''; st.phase = 'pick'; st.error = ''; render(); }
      if (act === 'parse') {
        const t = dlg.querySelector('[data-ci-text]').value;
        if (!t.trim()) return;
        if (st.phase === 'pick') { dropImages(); st.source = 'text'; st.note = ''; }
        parse(t);
      }
      if (act === 'apply') apply();
    });
    dlg.addEventListener('change', (e) => {
      if (e.target.matches('[data-ci-file]')) { const f = e.target.files[0]; e.target.value = ''; if (f) readFile(f); }
      if (e.target.matches('[data-ci-order]')) { st.order = e.target.value; parse(st.text || ''); }
    });
    // 표 칸을 고치면 그 줄의 상태와 넣을 학교 수만 다시 쓴다(커서가 튀지 않게)
    dlg.addEventListener('input', (e) => {
      const tr = e.target.closest('tr[data-i]');
      if (!tr || !st || st.phase !== 'review') return;
      const r = st.rows[Number(tr.dataset.i)];
      if (e.target.matches('[data-ci-school]')) r.school = e.target.value;
      if (e.target.matches('[data-ci-year]')) {
        // 손으로 고친 칸은 '확인' 표시를 뗀다
        const y = Number(e.target.dataset.ciYear);
        r.values[y] = e.target.value.trim();
        r.guessed = r.guessed.filter((x) => x !== y);
        r.unsure = r.unsure.filter((x) => x !== y);
        e.target.classList.remove('is-guess', 'is-unsure');
      }
      if (e.target.matches('[data-ci-use]')) r.use = e.target.checked;
      tr.querySelector('[data-ci-state]').innerHTML = stateText(r, cutYears(Store.get()));
      const n = st.rows.filter(usable).length;
      const btn = dlg.querySelector('[data-ci="apply"]');
      btn.disabled = !n;
      btn.textContent = `커트라인에 넣기 (${n}곳)`;
    });
    ['dragenter', 'dragover'].forEach((t) => dlg.addEventListener(t, (e) => {
      const z = e.target.closest('[data-ci-drop]');
      if (!z) return;
      e.preventDefault();
      z.classList.add('is-over');
    }));
    ['dragleave', 'drop'].forEach((t) => dlg.addEventListener(t, (e) => {
      const z = e.target.closest('[data-ci-drop]');
      if (z) z.classList.remove('is-over');
    }));
    dlg.addEventListener('drop', (e) => {
      if (!e.target.closest('[data-ci-drop]')) return;
      e.preventDefault();
      readFile(e.dataTransfer.files[0]);
    });
    // 캡처한 그림을 Ctrl+V로 붙여 넣기
    dlg.addEventListener('paste', (e) => {
      if (!st || st.phase === 'reading') return;
      const item = Array.from((e.clipboardData && e.clipboardData.items) || []).find((x) => x.kind === 'file' && (/^image\//.test(x.type) || x.type === 'application/pdf'));
      if (item) { e.preventDefault(); readFile(item.getAsFile()); }
    });
  }

  root.CutImport = {
    open() {
      if (!dlg) build();
      st = { phase: 'pick', order: 'auto', rows: [], skipped: [], text: '', images: [], source: '', note: '' };
      render();
      dlg.showModal();
    },
  };
})(window);
