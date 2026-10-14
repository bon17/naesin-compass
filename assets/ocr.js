/*
 * 내신나침반 — 커트라인 표 사진에서 글자 읽기(이 컴퓨터 안에서만, 인터넷 없이)와 글자를 학교별 커트라인으로 정리하기
 * 글자 읽기 도구(약 6MB)는 처음 쓸 때만 불러온다.
 */
(function (root) {
  'use strict';

  const BASE = 'assets/vendor/ocr/';
  let engine = null; // 한 번 만든 작업자를 다시 쓴다
  let onProgress = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`${src}를 불러오지 못했어요`));
      document.head.appendChild(s);
    });
  }

  // 한국어 자료를 작업자 안에 넣고, 작업자가 자료를 받으러 갈 때(fetch) 그 자료를 돌려주게 한다
  const SHIM = `(function(){var b=atob(self.__korB64);var u=new Uint8Array(b.length);for(var i=0;i<b.length;i++)u[i]=b.charCodeAt(i);self.__korB64=null;var f=self.fetch;self.fetch=function(url,o){return String(url).indexOf('kor.traineddata')>=0?Promise.resolve(new Response(u)):f.call(self,url,o);};})();\n`;

  function getEngine(status) {
    if (!engine) {
      engine = (async () => {
        if (status) status('글자 읽기 도구를 불러오는 중이에요… (처음 한 번만)');
        if (!root.Tesseract) await loadScript(`${BASE}tesseract.min.js`);
        const parts = root.NaesinOcrParts || {};
        if (!parts.core) await loadScript(`${BASE}ocr-engine.js`);
        if (!parts.kor) await loadScript(`${BASE}ocr-kor.js`);
        const P = root.NaesinOcrParts;
        const blob = new Blob([`self.__korB64=${JSON.stringify(P.kor)};\n`, SHIM, P.core, '\n', P.worker], { type: 'text/javascript' });
        const worker = await root.Tesseract.createWorker('kor', 1, {
          workerPath: URL.createObjectURL(blob),
          workerBlobURL: false,
          corePath: 'local',
          langPath: 'https://local.invalid',
          cacheMethod: 'none',
          gzip: true,
          logger: (m) => { if (onProgress && m.status === 'recognizing text') onProgress(m.progress); },
        });
        return worker;
      })().catch((e) => { engine = null; throw e; });
    }
    return engine;
  }

  // 종이 밝기 고르게 하기: 32px 칸마다 가장 밝은 값(=종이)을 재어 부드럽게 펴고, 그 밝기로 나눠 종이를 흰색으로 만든다.
  // 회색 종이·그늘진 사진에서도 글자만 어둡게 남는다. 돌려주는 값은 0~255 밝기 배열
  function flatten(ctx, w, h) {
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const lum = new Float32Array(w * h);
    for (let i = 0, p = 0; p < w * h; i += 4, p += 1) lum[p] = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
    const B = 32;
    const bw = Math.ceil(w / B);
    const bh = Math.ceil(h / B);
    const block = new Float32Array(bw * bh);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const k = Math.floor(y / B) * bw + Math.floor(x / B);
        if (lum[y * w + x] > block[k]) block[k] = lum[y * w + x];
      }
    }
    // 글자가 꽉 찬 칸이 있어도 옆 칸의 종이 밝기를 쓰게 한 칸씩 넓힌다
    const grown = new Float32Array(bw * bh);
    for (let by = 0; by < bh; by += 1) {
      for (let bx = 0; bx < bw; bx += 1) {
        let m = 0;
        for (let yy = Math.max(0, by - 1); yy <= Math.min(bh - 1, by + 1); yy += 1) {
          for (let xx = Math.max(0, bx - 1); xx <= Math.min(bw - 1, bx + 1); xx += 1) m = Math.max(m, block[yy * bw + xx]);
        }
        grown[by * bw + bx] = Math.max(m, 1);
      }
    }
    // 칸 값을 부드럽게 이어(쌍선형) 나눈다
    const out = new Uint8ClampedArray(w * h);
    for (let y = 0; y < h; y += 1) {
      const fy = Math.min(bh - 1, Math.max(0, (y + 0.5) / B - 0.5));
      const y0 = Math.floor(fy);
      const y1 = Math.min(bh - 1, y0 + 1);
      const ty = fy - y0;
      for (let x = 0; x < w; x += 1) {
        const fx = Math.min(bw - 1, Math.max(0, (x + 0.5) / B - 0.5));
        const x0 = Math.floor(fx);
        const x1 = Math.min(bw - 1, x0 + 1);
        const tx = fx - x0;
        const bg = (grown[y0 * bw + x0] * (1 - tx) + grown[y0 * bw + x1] * tx) * (1 - ty)
          + (grown[y1 * bw + x0] * (1 - tx) + grown[y1 * bw + x1] * tx) * ty;
        const v = (lum[y * w + x] * 255) / bg;
        out[y * w + x] = v > 235 ? 255 : v;
      }
    }
    return out;
  }

  // 표의 칸 선(가로·세로로 길게 이어진 줄)을 지운다. 칸 선이 있으면 표 안 글자를 통째로 건너뛰기 쉽다.
  // - 종이를 흰색으로 편 밝기에서, 아주 연한 회색 선도 잡도록 232 미만을 본다
  // - 사진·스캔이 조금 기울어도 선이 끊겨 보이지 않게, 옆 두 줄까지 함께 보고 이어진 길이를 잰다
  // - 가로선은 그림 너비의 1/4 넘게 이어져야 한다(흐린 글자 줄을 선으로 보지 않게)
  // - 선은 얇다: 위아래(좌우) 6px 바깥까지 어두우면 글자 덩어리로 보고 지우지 않는다
  function eraseLines(gray, w, h) {
    const dark = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p += 1) dark[p] = gray[p] < 232 ? 1 : 0;
    const T = 6;
    const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? dark[y * w + x] : 0);
    const marks = [];
    // 가로선
    const minH = Math.max(80, w * 0.25);
    for (let y = 0; y < h; y += 1) {
      let start = -1;
      for (let x = 0; x <= w; x += 1) {
        const on = x < w && (at(x, y) || at(x, y - 1) || at(x, y + 1));
        if (on && start < 0) start = x;
        if (!on && start >= 0) {
          if (x - start >= minH) {
            let filled = 0;
            for (let k = start; k < x; k += 1) if (at(k, y - T) && at(k, y + T)) filled += 1;
            if (filled < (x - start) * 0.5) for (let k = start; k < x; k += 1) if (at(k, y)) marks.push(y * w + k);
          }
          start = -1;
        }
      }
    }
    // 세로선: 글자 획(키운 그림에서 40px 안팎)보다 훨씬 길어야 지운다
    const minV = Math.max(100, w * 0.06);
    for (let x = 0; x < w; x += 1) {
      let start = -1;
      for (let y = 0; y <= h; y += 1) {
        const on = y < h && (at(x, y) || at(x - 1, y) || at(x + 1, y));
        if (on && start < 0) start = y;
        if (!on && start >= 0) {
          if (y - start >= minV) {
            let filled = 0;
            for (let k = start; k < y; k += 1) if (at(x - T, k) && at(x + T, k)) filled += 1;
            if (filled < (y - start) * 0.5) for (let k = start; k < y; k += 1) if (at(x, k)) marks.push(k * w + x);
          }
          start = -1;
        }
      }
    }
    // 가로·세로를 다 찾은 뒤 지운다(먼저 지우면 다른 방향 판단이 흔들린다)
    marks.forEach((p) => { gray[p] = 255; });
  }

  // 기울기 재기: 어두운 점들을 여러 각도(-4°~4°)로 가로줄에 모아 보고, 줄이 가장 또렷하게 몰리는 각도를 고른다
  function estimateSkew(gray, w, h) {
    const step = Math.max(1, Math.floor(w / 700));
    const xs = [];
    const ys = [];
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) if (gray[y * w + x] < 140) { xs.push(x); ys.push(y); }
    }
    if (xs.length < 300) return 0;
    const pad = Math.ceil((w * Math.tan((4 * Math.PI) / 180)) / step) + 2;
    const size = Math.ceil(h / step) + pad * 2;
    let best = 0;
    let bestScore = -1;
    for (let deg = -4; deg <= 4.001; deg += 0.2) {
      const t = Math.tan((deg * Math.PI) / 180);
      const hist = new Float32Array(size);
      for (let i = 0; i < xs.length; i += 1) hist[Math.round((ys[i] - xs[i] * t) / step) + pad] += 1;
      let score = 0;
      for (let k = 0; k < size; k += 1) score += hist[k] * hist[k];
      if (score > bestScore) { bestScore = score; best = deg; }
    }
    return best;
  }

  function grayOf(ctx, w, h) {
    const d = ctx.getImageData(0, 0, w, h).data;
    const gray = new Uint8ClampedArray(w * h);
    for (let i = 0, p = 0; p < w * h; i += 4, p += 1) gray[p] = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
    return gray;
  }

  function putGray(ctx, gray, w, h) {
    const img = ctx.createImageData(w, h);
    for (let p = 0, i = 0; p < w * h; p += 1, i += 4) {
      img.data[i] = gray[p]; img.data[i + 1] = gray[p]; img.data[i + 2] = gray[p]; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  // 그림 정리: 종이 밝기 고르기 → 기울기 바로잡기 → 칸 선 지우기
  function cleanUp(ctx, w, h) {
    let gray = flatten(ctx, w, h);
    const deg = estimateSkew(gray, w, h);
    if (Math.abs(deg) >= 0.15) {
      putGray(ctx, gray, w, h);
      const copy = document.createElement('canvas');
      copy.width = w;
      copy.height = h;
      copy.getContext('2d').drawImage(ctx.canvas, 0, 0);
      ctx.save();
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.translate(w / 2, h / 2);
      ctx.rotate((-deg * Math.PI) / 180);
      ctx.drawImage(copy, -w / 2, -h / 2);
      ctx.restore();
      gray = grayOf(ctx, w, h);
    }
    eraseLines(gray, w, h);
    // 지우고 남은 아주 옅은 자국은 흰색으로
    for (let p = 0; p < w * h; p += 1) if (gray[p] > 215) gray[p] = 255;
    putGray(ctx, gray, w, h);
  }

  // 작은 사진은 키워서 읽는다(글자가 작으면 잘 못 읽음)
  async function prepare(file) {
    const img = await (root.createImageBitmap ? root.createImageBitmap(file) : new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = URL.createObjectURL(file);
    }));
    const w = img.width || img.naturalWidth;
    const h = img.height || img.naturalHeight;
    const scale = w < 1600 ? Math.min(3, 1600 / w) : w > 3200 ? 3200 / w : 1;
    const c = document.createElement('canvas');
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    cleanUp(ctx, c.width, c.height);
    return c;
  }

  // '학교 이름 + 소수점 숫자'가 있는 줄 수 — 읽은 결과가 쓸 만한지 견주는 잣대
  const score = (text) => String(text).split('\n').filter((l) => /[가-힣]{2,}.*\d{2,3}[.,]\d/.test(l)).length;

  /**
   * 그림에서 글자를 읽는다. psm: 글자 배치를 보는 방식.
   * 기본은 자동(3)으로 읽고, 표 줄을 하나도 못 찾으면 한 덩어리(6)로 한 번 더 읽어 나은 쪽을 쓴다.
   * (칸 선 있는 표는 3이, 칸 선 없는 작은 표는 6이 잘 읽혔다)
   */
  async function readImage(file, status, progress, psm) {
    const worker = await getEngine(status);
    if (status) status('사진에서 글자를 읽는 중이에요…');
    try {
      const canvas = await prepare(file);
      const run = async (mode, from, to) => {
        onProgress = progress ? (p) => progress(from + p * (to - from)) : null;
        await worker.setParameters({ tessedit_pageseg_mode: String(mode), preserve_interword_spaces: '1' });
        const { data } = await worker.recognize(canvas);
        return data.text || '';
      };
      if (psm) return await run(psm, 0, 1);
      const first = await run(3, 0, 0.5);
      if (score(first) > 0) { if (progress) progress(1); return first; }
      if (status) status('표 모양을 바꿔 한 번 더 읽는 중이에요…');
      const second = await run(6, 0.5, 1);
      return score(second) > score(first) ? second : first;
    } finally {
      onProgress = null;
    }
  }

  // ---------- 글자 → 학교별 커트라인 ----------

  const SCHOOL = /[가-힣A-Za-z]{1,20}?\s?(?:여자고등학교|고등학교|고교|고)(?![가-힣])/g;
  const NUMBER = /\d+(?:[.,·]\d+)?/g;

  // 학교 이름 뒤 숫자들을 칸으로 바꾼다. { n, guess }
  // - 커트라인처럼 생겼는데 0~200 밖이면(잘못 읽음) 빈칸(n: null)으로 자리만 지킨다
  // - 소수점을 놓친 4~5자리 수(18310, 1823)는 앞 세 자리 뒤에 점을 넣어 살리고 guess로 표시한다
  function cells(segment) {
    const out = [];
    (segment.match(NUMBER) || []).forEach((t) => {
      const n = Number(t.replace(/[,·]/, '.'));
      const decimal = /[.,·]/.test(t);
      if (!decimal && n >= 1990 && n <= 2100) return; // 연도
      if (n > 0 && n <= 200 && (decimal || n >= 50)) { out.push({ n }); return; }
      if (!decimal && /^\d{4,5}$/.test(t)) {
        const fixed = Number(`${t.slice(0, 3)}.${t.slice(3)}`);
        if (fixed >= 100 && fixed <= 200) { out.push({ n: fixed, guess: true }); return; }
      }
      if (decimal) out.push({ n: null });
    });
    return out;
  }

  const normName = (s) => String(s || '').replace(/\s+/g, '').replace(/(여자)?고등학교$/, (m, girl) => (girl ? '여고' : '고')).replace(/고교$/, '고');

  // 머리글의 연도: 2024, 2024학년도, 24학년도, '24
  function yearsIn(line, latest) {
    const out = [];
    const re = /(?:20(\d{2})|'(\d{2})|(\d{2})(?=\s*학년도))/g;
    let m;
    while ((m = re.exec(line))) {
      const y = 2000 + Number(m[1] || m[2] || m[3]);
      if (y >= latest - 10 && y <= latest + 1) out.push(y);
    }
    return out;
  }

  /**
   * 표 글자를 학교별 커트라인으로 정리한다.
   * years: 화면의 네 해 [오래된 해, …, 최근 해]. order: 'auto' | 'asc'(왼쪽이 오래된 해) | 'desc'(왼쪽이 최근 해)
   * 숫자가 하나면 최근 해, 둘이면 최근 두 해로 본다.
   */
  function parseCutoffs(text, years, order) {
    const latest = years[years.length - 1];
    const lines = String(text || '').split(/\r?\n/).map((l) => l.replace(/[|｜]/g, ' ').trim()).filter(Boolean);
    let header = null;
    for (const line of lines) {
      const ys = yearsIn(line, latest);
      if (ys.length >= 2) { header = ys; break; }
    }
    const desc = order === 'desc' || (order !== 'asc' && header && header[0] > header[header.length - 1]);
    const rows = [];
    const skipped = [];
    for (const line of lines) {
      const clean = line.replace(/(?:20\d{2}|\d{2})\s*학년도/g, ' ');
      const matches = Array.from(clean.matchAll(SCHOOL));
      if (!matches.length) {
        // 커트라인 같은 소수가 있는데 학교 이름을 못 찾은 줄만 알린다(제목·설명 줄은 빼고)
        if (/\d{2,3}[.,]\d/.test(line) && !yearsIn(line, latest).length) skipped.push(line);
        continue;
      }
      matches.forEach((m, i) => {
        const start = m.index + m[0].length;
        const end = i + 1 < matches.length ? matches[i + 1].index : clean.length;
        const nums = cells(clean.slice(start, end));
        if (!nums.some((c) => c.n != null)) { skipped.push(line); return; }
        const seq = desc ? nums.slice(0, years.length).reverse() : nums.slice(-years.length);
        const values = {};
        const unsure = [];
        const guessed = [];
        const ys = years.slice(years.length - seq.length);
        seq.forEach((c, k) => {
          if (c.n == null) { unsure.push(ys[k]); return; }
          values[ys[k]] = c.n;
          if (c.guess) guessed.push(ys[k]);
        });
        // 맨 앞 '1'을 놓친 값(183.10 → 83.1): 같은 줄 다른 해가 100 넘고 +100이 그 근처면 살리고 guess로 표시
        const others = Object.keys(values).map((y) => values[y]).filter((n) => n >= 100);
        if (others.length) {
          const lo = Math.min(...others) - 15;
          const hi = Math.max(...others) + 15;
          Object.keys(values).forEach((y) => {
            const n = values[y];
            if (n < 100 && n + 100 >= lo && n + 100 <= hi) {
              values[y] = Math.round((n + 100) * 1000) / 1000;
              if (guessed.indexOf(Number(y)) < 0) guessed.push(Number(y));
            }
          });
        }
        rows.push({ school: m[0].replace(/\s+/g, ''), key: normName(m[0]), values, unsure, guessed });
      });
    }
    return { rows: mergeRows(rows), skipped, header };
  }

  // 같은 학교가 두 번 나오면 뒤의 값으로 합친다
  function mergeRows(rows) {
    const merged = [];
    rows.forEach((r) => {
      const prev = merged.find((x) => x.key === r.key);
      if (prev) {
        Object.assign(prev.values, r.values);
        prev.unsure = prev.unsure.filter((y) => !(y in r.values)).concat(r.unsure);
        prev.guessed = prev.guessed.filter((y) => !(y in r.values)).concat(r.guessed);
      } else merged.push(r);
    });
    return merged;
  }

  /**
   * 엑셀 표(줄마다 칸 배열)를 학교별 커트라인으로 정리한다. 머리글의 연도로 열을 맞춘다.
   * years: 화면의 네 해. 머리글 연도 줄을 못 찾으면 null(글자로 정리하게 한다)
   * 반환 { rows, skipped, outside: 화면 밖이라 뺀 해 }
   */
  function parseCutoffTable(grid, years) {
    const latest = years[years.length - 1];
    const text = (v) => String(v == null ? '' : v).trim();
    let h = -1;
    let yearCol = {};
    for (let i = 0; i < grid.length && h < 0; i += 1) {
      const found = {};
      grid[i].forEach((v, j) => {
        const ys = yearsIn(text(v), latest);
        if (ys.length === 1 && !Object.values(found).includes(ys[0])) found[j] = ys[0];
      });
      if (Object.keys(found).length >= 2) { h = i; yearCol = found; }
    }
    if (h < 0) return null;
    const isSchool = (v) => { SCHOOL.lastIndex = 0; return SCHOOL.test(text(v)); };
    // 학교 열: 머리글에 '학교'가 있는 열, 없으면 학교 이름이 가장 많은 열
    const cols = Math.max(...grid.map((r) => r.length));
    let schoolCol = grid[h].findIndex((v, j) => !(j in yearCol) && /학교|교명/.test(text(v)));
    if (schoolCol < 0) {
      let best = 0;
      for (let j = 0; j < cols; j += 1) {
        if (j in yearCol) continue;
        const n = grid.slice(h + 1).filter((r) => isSchool(r[j])).length;
        if (n > best) { best = n; schoolCol = j; }
      }
    }
    if (schoolCol < 0) return null;
    const rows = [];
    const skipped = [];
    grid.slice(h + 1).forEach((r) => {
      const school = text(r[schoolCol]).replace(/\s+/g, ' ');
      if (!school) return;
      const values = {};
      const unsure = [];
      Object.keys(yearCol).forEach((j) => {
        const y = yearCol[j];
        if (years.indexOf(y) < 0) return;
        const raw = r[j];
        const t = text(raw).replace(/\s+/g, ' ');
        if (!t || /^[-–—]$/.test(t)) return;
        // '미달', '147근처' 같은 글은 메모로 그대로 둔다. 숫자인데 0~200 밖이면 확인
        if (typeof raw !== 'number' && !/^[-+]?[\d.,]+$/.test(t)) { values[y] = t; return; }
        const n = typeof raw === 'number' ? raw : Number(t.replace(/,/g, ''));
        if (isFinite(n) && n > 0 && n <= 200) values[y] = Math.round(n * 1000) / 1000;
        else unsure.push(y);
      });
      if (!Object.keys(values).length && !unsure.length) {
        if (isSchool(school)) skipped.push(school);
        return;
      }
      rows.push({ school, key: normName(school), values, unsure, guessed: [] });
    });
    const outside = Object.values(yearCol).filter((y) => years.indexOf(y) < 0).sort();
    return { rows: mergeRows(rows), skipped, outside };
  }

  root.Ocr = { readImage, parseCutoffs, parseCutoffTable, normName, preload: () => getEngine() };
  if (typeof module !== 'undefined') module.exports = root.Ocr;
})(typeof window !== 'undefined' ? window : globalThis);
