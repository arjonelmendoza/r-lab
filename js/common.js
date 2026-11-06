// Small helpers shared by both pages.
import { APP_NAME, COURSE_LABEL } from "./config.js";

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Tiny markdown: ```blocks```, `code`, **bold**, - bullets, paragraphs. */
export function md(src) {
  const blocks = [];
  let s = String(src || "").replace(/```[a-zA-Z]*\n?([\s\S]*?)```/g, (_, code) => {
    blocks.push(`<pre>${esc(code.replace(/\n$/, ""))}</pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  s = esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  const out = s.split(/\n{2,}/).map(par => {
    const lines = par.split("\n");
    if (lines.every(l => /^\s*[-*] /.test(l) || !l.trim()))
      return "<ul>" + lines.filter(l => l.trim()).map(l => `<li>${l.replace(/^\s*[-*] /, "")}</li>`).join("") + "</ul>";
    if (/^\u0000\d+\u0000$/.test(par.trim())) return par.trim();
    return `<p>${lines.join("<br>")}</p>`;
  }).join("");
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[+i]);
}

/** Same seed for the same student + activity, on both the student and instructor side. */
export function seedFor(uid, aid) {
  let h = 2166136261;
  for (const ch of uid + "|" + aid) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return 100000 + ((h >>> 0) % 900000);
}

/** Test lines: "points | description | R expression"  (lines starting with # are ignored) */
export function parseTests(text) {
  return String(text || "").split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#")).map(l => {
    const parts = l.split("|");
    if (parts.length < 3) return { points: 1, desc: l, expr: l };
    return {
      points: Math.max(0, Number(parts[0].trim()) || 1),
      desc: parts[1].trim(),
      expr: parts.slice(2).join("|").trim(),
    };
  });
}

export function toast(msg, kind = "info", ms = 3500) {
  let box = $("#toasts");
  if (!box) { box = document.createElement("div"); box.id = "toasts"; document.body.append(box); }
  const t = document.createElement("div");
  t.className = "toast " + kind;
  t.textContent = msg;
  box.append(t);
  setTimeout(() => t.remove(), ms);
}

/** Promise-based modal (no native alert/confirm: those steal focus and trip the blur detector). */
export function modal({ title, html = "", ok = "OK", cancel = "Cancel", danger = false }) {
  return new Promise(res => {
    const wrap = document.createElement("div");
    wrap.className = "modal-back";
    wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
      <h3>${esc(title)}</h3><div class="modal-body">${html}</div>
      <div class="modal-actions">
        ${cancel ? `<button data-v="0">${esc(cancel)}</button>` : ""}
        <button class="${danger ? "danger" : "primary"}" data-v="1">${esc(ok)}</button>
      </div></div>`;
    wrap.addEventListener("click", e => {
      const v = e.target.closest("button")?.dataset.v;
      if (v === undefined) return;
      wrap.remove(); res(v === "1");
    });
    document.body.append(wrap);
    wrap.querySelector("button.primary,button.danger")?.focus();
  });
}

export const ms = t => (t?.toMillis ? t.toMillis() : (typeof t === "number" ? t : null));
export function fmtClock(msLeft) {
  const s = Math.max(0, Math.floor(msLeft / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0");
}
export function fmtTime(t) {
  const v = ms(t); if (!v) return "—";
  return new Date(v).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}
export function fmtDateTime(t) {
  const v = ms(t); if (!v) return "—";
  return new Date(v).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
export function randomCode(n = 6) {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = ""; const r = crypto.getRandomValues(new Uint32Array(n));
  for (const x of r) s += a[x % a.length];
  return s;
}

export function brand() {
  $$("[data-app-name]").forEach(e => (e.textContent = APP_NAME));
  $$("[data-course]").forEach(e => (e.textContent = COURSE_LABEL));
  document.title = APP_NAME + (document.title ? " · " + document.title : "");
}

export const EMPTY_COUNTS = { tab: 0, tabSec: 0, blur: 0, blurSec: 0, fs: 0, paste: 0, copy: 0, burst: 0, offline: 0 };

/** 0–100 integrity risk, used for the Low / Medium / High label. */
export function riskOf(a, starterLens = []) {
  const c = { ...EMPTY_COUNTS, ...(a.counts || {}) };
  let r = c.tab * 8 + c.fs * 8 + c.paste * 10 + c.copy * 6 + c.burst * 10 + c.blur * 3 + c.offline * 3
        + Math.min(20, c.tabSec / 15) + Math.min(10, c.blurSec / 20);
  if (a.env?.extended) r += 10;
  untyped(a, starterLens).forEach(() => (r += 15));
  return Math.min(100, Math.round(r));
}
/** Problems whose final code is much longer than what the student actually typed. */
export function untyped(a, starterLens = []) {
  const out = [];
  for (const [k, code] of Object.entries(a.code || {})) {
    const typed = a.typing?.[k]?.typed || 0;
    const grown = (code || "").length - (starterLens[+k] || 0);
    if (grown > 60 && grown > typed * 1.3 + 40) out.push(+k);
  }
  return out;
}
export const riskLabel = r => (r >= 40 ? ["High", "st-fail"] : r >= 15 ? ["Medium", "st-rem"] : ["Low", "st-pass"]);
