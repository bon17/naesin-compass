/*
 * 내신나침반 — PC → 태블릿 QR 전송
 * 자료(JSON) → 압축(deflate-raw) → 4자리 암호로 잠금(PBKDF2 + AES-GCM) → Base45 → QR 여러 장
 * Base45 글자는 QR 영숫자 모드에 그대로 들어가서, 기기 내장 인식기와 jsQR 모두 글자가 깨지지 않는다.
 */
(function (root) {
  'use strict';

  const B45 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
  const PREFIX = 'NC1';
  const ITERATIONS = 150000;

  function b45encode(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 2) {
      if (i + 1 < bytes.length) {
        let x = bytes[i] * 256 + bytes[i + 1];
        const e = Math.floor(x / 2025); x %= 2025;
        const d = Math.floor(x / 45);
        out += B45[x % 45] + B45[d] + B45[e];
      } else {
        const x = bytes[i];
        out += B45[x % 45] + B45[Math.floor(x / 45)];
      }
    }
    return out;
  }

  function b45decode(str) {
    const out = [];
    for (let i = 0; i < str.length; i += 3) {
      const c = B45.indexOf(str[i]);
      const d = B45.indexOf(str[i + 1]);
      if (c < 0 || d < 0) throw new Error('b45');
      if (i + 2 < str.length) {
        const e = B45.indexOf(str[i + 2]);
        if (e < 0) throw new Error('b45');
        const x = c + d * 45 + e * 2025;
        if (x > 0xffff) throw new Error('b45');
        out.push(x >> 8, x & 0xff);
      } else {
        const x = c + d * 45;
        if (x > 0xff) throw new Error('b45');
        out.push(x);
      }
    }
    return new Uint8Array(out);
  }

  async function pipe(bytes, stream) {
    const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
    return new Uint8Array(await res.arrayBuffer());
  }

  // 브라우저 내장 압축이 없으면(iPadOS 16.4 미만 등) 함께 넣은 fflate로 대신한다
  function hasNative(Stream) {
    try { return typeof Stream === 'function' && !!new Stream('deflate-raw'); } catch (e) { return false; }
  }
  const nativeZip = hasNative(root.CompressionStream) && hasNative(root.DecompressionStream);
  const deflate = (bytes) => (nativeZip ? pipe(bytes, new CompressionStream('deflate-raw')) : Promise.resolve(root.fflate.deflateSync(bytes)));
  const inflate = (bytes) => (nativeZip ? pipe(bytes, new DecompressionStream('deflate-raw')) : Promise.resolve(root.fflate.inflateSync(bytes)));

  async function deriveKey(pin, salt) {
    const base = await root.crypto.subtle.importKey('raw', new TextEncoder().encode(String(pin)), 'PBKDF2', false, ['deriveKey']);
    return root.crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  // [1바이트 판][16 salt][12 iv][암호문+태그]
  async function seal(obj, pin) {
    const plain = await deflate(new TextEncoder().encode(JSON.stringify(obj)));
    const salt = root.crypto.getRandomValues(new Uint8Array(16));
    const iv = root.crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(pin, salt);
    const ct = new Uint8Array(await root.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
    const out = new Uint8Array(1 + 16 + 12 + ct.length);
    out[0] = 1; out.set(salt, 1); out.set(iv, 17); out.set(ct, 29);
    return out;
  }

  // 암호가 틀리면 AES-GCM 태그 검사에서 실패한다
  async function unseal(bytes, pin) {
    if (bytes[0] !== 1) throw new Error('version');
    const key = await deriveKey(pin, bytes.slice(1, 17));
    let plain;
    try {
      plain = new Uint8Array(await root.crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(17, 29) }, key, bytes.slice(29)));
    } catch (e) {
      throw new Error('pin');
    }
    return JSON.parse(new TextDecoder().decode(await inflate(plain)));
  }

  function newSetId() {
    const a = root.crypto.getRandomValues(new Uint8Array(4));
    return Array.from(a, (x) => B45[x % 36]).join('');
  }

  // 'NC1:묶음ID:2/3:데이터' — 장 수를 정하면 고르게 나눈다
  function split(bytes, maxChars) {
    const text = b45encode(bytes);
    const total = Math.max(1, Math.ceil(text.length / maxChars));
    const size = Math.ceil(text.length / total);
    const id = newSetId();
    const parts = [];
    for (let i = 0; i < total; i += 1) {
      parts.push(`${PREFIX}:${id}:${i + 1}/${total}:${text.slice(i * size, (i + 1) * size)}`);
    }
    return parts;
  }

  function parsePart(raw) {
    const s = String(raw || '').trim();
    const m = s.match(/^NC1:([0-9A-Z]{4}):(\d+)\/(\d+):([\s\S]*)$/);
    if (!m) return null;
    const index = Number(m[2]);
    const total = Number(m[3]);
    if (!total || index < 1 || index > total) return null;
    return { id: m[1], index, total, data: m[4] };
  }

  // 찍은 순서와 상관없이 같은 묶음의 장을 모은다. 다른 묶음 QR이 오면 새로 시작한다.
  function Assembler() {
    this.reset();
  }
  Assembler.prototype.reset = function () {
    this.id = null; this.total = 0; this.parts = {};
  };
  Assembler.prototype.add = function (raw) {
    const p = parsePart(raw);
    if (!p) return { ok: false, reason: 'not-ours' };
    let restarted = false;
    if (this.id !== p.id) {
      restarted = this.id !== null;
      this.id = p.id; this.total = p.total; this.parts = {};
    }
    const duplicate = !!this.parts[p.index];
    this.parts[p.index] = p.data;
    return { ok: true, index: p.index, total: this.total, count: this.count(), duplicate, restarted };
  };
  Assembler.prototype.count = function () {
    return Object.keys(this.parts).length;
  };
  Assembler.prototype.missing = function () {
    const out = [];
    for (let i = 1; i <= this.total; i += 1) if (!this.parts[i]) out.push(i);
    return out;
  };
  Assembler.prototype.complete = function () {
    return this.total > 0 && this.count() === this.total;
  };
  Assembler.prototype.bytes = function () {
    let text = '';
    for (let i = 1; i <= this.total; i += 1) text += this.parts[i];
    return b45decode(text);
  };

  const api = { b45encode, b45decode, seal, unseal, split, parsePart, Assembler, nativeZip };
  root.Transfer = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
