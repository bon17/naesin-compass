/*
 * 내신나침반 — 커트라인 표 PDF 읽기(이 컴퓨터 안에서만, 인터넷 없이)
 * 글자로 된 PDF(한글·엑셀에서 저장)는 들어 있는 글자를 줄 단위로 꺼내고,
 * 스캔한 쪽(글자가 없음)은 그림으로 그려 사진 글자 읽기(assets/ocr.js)로 읽는다.
 * PDF 도구(약 1.6MB)는 처음 쓸 때만 불러온다.
 */
(function (root) {
  'use strict';

  const BASE = 'assets/vendor/pdf/';
  const MAX_PAGES = 10;
  let ready = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`${src}를 불러오지 못했어요`));
      document.head.appendChild(s);
    });
  }

  // 작업자 스크립트도 <script>로 읽어 두면 pdf.js가 화면 안에서 돌린다(file://에서 Worker를 못 띄워도 됨)
  function lib() {
    if (!ready) {
      ready = (async () => {
        if (!root.pdfjsLib) await loadScript(`${BASE}pdf.min.js`);
        if (!root.pdfjsWorker) await loadScript(`${BASE}pdf.worker.min.js`);
        if (!root.NaesinPdfCMaps) await loadScript(`${BASE}pdf-cmaps-ko.js`);
        return root.pdfjsLib;
      })().catch((e) => { ready = null; throw e; });
    }
    return ready;
  }

  function bytesOf(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }

  // 한글 CMap을 파일 대신 메모리에서 준다(file://는 fetch가 막힌다)
  class InlineCMaps {
    async fetch({ name }) {
      const b64 = (root.NaesinPdfCMaps || {})[name];
      if (!b64) throw new Error(`CMap ${name} 없음`);
      return { cMapData: bytesOf(b64), compressionType: 1 };
    }
  }

  // 글자 조각을 같은 높이끼리 한 줄로 모으고, 칸 사이가 벌어진 곳엔 빈칸을 둔다
  async function pageText(page) {
    const tc = await page.getTextContent();
    const items = tc.items
      .filter((it) => it.str && it.str.trim())
      .map((it) => ({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0, h: Math.abs(it.transform[3]) || it.height || 10 }));
    const lines = [];
    items.forEach((it) => {
      const line = lines.find((l) => Math.abs(l.y - it.y) <= Math.max(2, it.h * 0.5));
      if (line) line.items.push(it);
      else lines.push({ y: it.y, items: [it] });
    });
    return lines
      .sort((a, b) => b.y - a.y)
      .map((l) => l.items.sort((a, b) => a.x - b.x).reduce((acc, it, i, arr) => {
        if (i === 0) return it.s;
        const prev = arr[i - 1];
        const gap = it.x - (prev.x + prev.w);
        return acc + (gap > prev.h * 0.3 ? '  ' : '') + it.s;
      }, ''))
      .join('\n');
  }

  async function render(page, width) {
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(4, width / base.width) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas;
  }

  function preview(canvas) {
    const w = Math.min(900, canvas.width);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = Math.round((canvas.height * w) / canvas.width);
    c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  }

  /**
   * PDF에서 글자를 꺼낸다. 돌려주는 값: { text, previews: [쪽 그림 dataURL], scanned: 스캔한 쪽 수, pages, skippedPages }
   */
  async function read(file, status, progress) {
    if (status) status('PDF 읽기 도구를 불러오는 중이에요…');
    const pdfjs = await lib();
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjs.getDocument({ data, CMapReaderFactory: InlineCMaps, cMapUrl: 'inline/', cMapPacked: true, isEvalSupported: false }).promise;
    const total = doc.numPages;
    const pages = Math.min(total, MAX_PAGES);
    const texts = [];
    const previews = [];
    let scanned = 0;
    for (let n = 1; n <= pages; n += 1) {
      const page = await doc.getPage(n);
      if (status) status(`PDF ${n}/${pages}쪽에서 글자를 꺼내는 중이에요…`);
      let text = await pageText(page);
      if (text.replace(/\s/g, '').length < 10) {
        // 글자가 없는 쪽 = 스캔한 그림. 크게 그려서 사진처럼 읽는다
        scanned += 1;
        const canvas = await render(page, 2000);
        previews.push(preview(canvas));
        text = await root.Ocr.readImage(canvas, (s) => status && status(`스캔한 쪽이라 그림에서 글자를 읽는 중이에요 (${n}/${pages}쪽)…`), (p) => progress && progress((n - 1 + p) / pages));
      } else {
        previews.push(preview(await render(page, 1400)));
      }
      texts.push(text);
      if (progress) progress(n / pages);
    }
    await doc.destroy();
    return { text: texts.join('\n'), previews, scanned, pages, skippedPages: total - pages };
  }

  root.PdfRead = { read, isPdf: (f) => !!f && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '')) };
})(window);
