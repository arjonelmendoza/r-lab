// Student page: join an activity, write R code, get monitored, submit.
import {
  auth, db, onAuthStateChanged, signInGoogle, logout, isSchoolEmail,
  doc, collection, getDoc, setDoc, updateDoc, addDoc, onSnapshot, serverTimestamp,
} from "./firebase.js";
import { loadR, ensurePackages, runCode, gradeCode } from "./rengine.js";
import {
  $, $$, esc, md, seedFor, parseTests, toast, modal, ms, fmtClock, fmtDateTime, brand, EMPTY_COUNTS,
} from "./common.js";
import { SCHOOL_DOMAIN, SAVE_INTERVAL_SEC, SNAPSHOT_INTERVAL_SEC, HEARTBEAT_SEC } from "./config.js";

brand();
$("#domainLbl").textContent = "@" + SCHOOL_DOMAIN;

const S = {
  user: null, aid: null, act: null, attempt: null, attemptRef: null,
  cur: 0, docs: [], code: {}, explain: {}, typing: {}, counts: { ...EMPTY_COUNTS }, env: {},
  lastSnap: {}, dirty: false, lastWrite: 0, saving: false, active: false, startLocal: 0,
  internalClip: "", hiddenAt: 0, blurAt: 0, blurCounted: false, offAt: 0,
  sample: {}, rReady: false, timers: [], unsubs: [], cm: null,
};

const views = ["vSignin", "vJoin", "vIntro", "vExam", "vDone"];
function show(id) {
  views.forEach(v => ($("#" + v).hidden = v !== id));
  const exam = id === "vExam";
  ["#timer", "#submitBtn", "#flagCount"].forEach(s => ($(s).hidden = !exam));
  $("#logoutBtn").hidden = exam || !S.user;
  if (!exam) $("#examTitle").textContent = "";
}

/* ---------------- Auth ---------------- */
onAuthStateChanged(auth, async user => {
  if (user && !isSchoolEmail(user.email)) {
    await logout();
    $("#signinErr").textContent = `Please use your @${SCHOOL_DOMAIN} account (you signed in as ${user.email}).`;
    $("#signinErr").hidden = false;
    return;
  }
  S.user = user;
  $("#who").innerHTML = user ? `${esc(user.displayName || "")}<br>${esc(user.email)}` : "";
  if (!user) return show("vSignin");
  const fromUrl = new URLSearchParams(location.search).get("code");
  if (fromUrl) { $("#codeIn").value = fromUrl; openActivity(fromUrl); } else show("vJoin");
});
$("#signinBtn").onclick = async () => {
  $("#signinErr").hidden = true;
  try { await signInGoogle(true); }
  catch (e) { $("#signinErr").textContent = "Sign-in failed: " + (e.code || e.message); $("#signinErr").hidden = false; }
};
$("#logoutBtn").onclick = () => logout();

/* ---------------- Join ---------------- */
$("#joinForm").onsubmit = e => { e.preventDefault(); openActivity($("#codeIn").value); };
$("#backBtn").onclick = () => show("vJoin");
$("#doneBtn").onclick = () => { history.replaceState(null, "", location.pathname); show("vJoin"); };
$("#agree").onchange = () => ($("#startBtn").disabled = !$("#agree").checked || S.blockStart);

async function openActivity(raw) {
  const code = String(raw || "").trim().toUpperCase();
  $("#joinErr").hidden = true;
  if (!code) return;
  let snap;
  try { snap = await getDoc(doc(db, "activities", code)); } catch { snap = null; }
  if (!snap || !snap.exists()) {
    show("vJoin");
    $("#joinErr").textContent = "No open activity with that code. Check the code with your instructor.";
    $("#joinErr").hidden = false;
    return;
  }
  S.aid = code; S.act = snap.data();
  S.attemptRef = doc(db, "activities", code, "attempts", S.user.uid);
  let att = null;
  try { const a = await getDoc(S.attemptRef); att = a.exists() ? a.data() : null; } catch {}
  S.attempt = att;

  const a = S.act;
  $("#iTitle").textContent = a.title || code;
  $("#iMeta").innerHTML = [
    `<span class="pill st-inc">${a.problems?.length || 0} problem${a.problems?.length === 1 ? "" : "s"}</span>`,
    `<span class="pill st-inc">${a.durationMin} minutes</span>`,
    a.allowPaste ? "" : `<span class="pill st-fail">Paste disabled</span>`,
    (a.packages || []).length ? `<span class="pill st-inc">R packages: ${esc(a.packages.join(", "))}</span>` : "",
  ].join("");
  $("#iInstr").innerHTML = md(a.instructions || "");
  const msg = $("#iMsg"); msg.hidden = true; S.blockStart = false;
  $("#startBtn").textContent = "Start in fullscreen";
  if (att?.status === "submitted") {
    S.blockStart = true; msg.hidden = false;
    msg.innerHTML = `<span class="pill st-pass">Submitted</span> You already submitted this activity on ${fmtDateTime(att.submittedAt)}.`;
  } else if (a.status !== "open") {
    S.blockStart = true; msg.hidden = false;
    msg.innerHTML = `<span class="pill st-fail">Closed</span> This activity is not accepting work right now.`;
  } else if (att) {
    $("#startBtn").textContent = "Resume in fullscreen";
    msg.hidden = false;
    msg.innerHTML = `<span class="pill st-rem">In progress</span> You started on ${fmtDateTime(att.startedAt)}. The timer has kept running.`;
  }
  $("#agree").checked = false; $("#startBtn").disabled = true;
  show("vIntro");
  // Warm up R and install packages while the student reads the instructions.
  if (!S.blockStart) loadR().then(() => ensurePackages(a.packages || [])).catch(() => {});
}

/* ---------------- Start / resume ---------------- */
$("#startBtn").onclick = async () => {
  enterFullscreen(); // must happen inside the click
  $("#startBtn").disabled = true;
  const a = S.act, u = S.user;
  S.env = {
    ua: navigator.userAgent.slice(0, 200), w: screen.width, h: screen.height,
    extended: !!screen.isExtended, fsSupported: !!document.fullscreenEnabled,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
  };
  a.problems.forEach((p, i) => (S.code[i] = p.starter || ""));
  try {
    if (!S.attempt) {
      S.startLocal = Date.now();
      await setDoc(S.attemptRef, {
        uid: u.uid, email: u.email, name: u.displayName || u.email,
        startedAt: serverTimestamp(), lastSeen: serverTimestamp(), status: "in_progress",
        code: S.code, explain: {}, typing: {}, counts: { ...EMPTY_COUNTS }, env: S.env,
      });
    } else {
      const t = S.attempt;
      S.startLocal = ms(t.startedAt) || Date.now();
      Object.assign(S.code, t.code || {});
      S.explain = { ...(t.explain || {}) };
      S.typing = { ...(t.typing || {}) };
      for (const k in EMPTY_COUNTS) S.counts[k] = Math.max(S.counts[k], t.counts?.[k] || 0);
      S.env = { ...S.env, extended: S.env.extended || !!t.env?.extended };
    }
  } catch (e) {
    toast("Could not start: " + (e.code || e.message), "warn", 6000);
    exitFullscreen(); $("#startBtn").disabled = false; return;
  }
  for (const k in S.code) S.lastSnap[k] = S.code[k];
  const isNew = !S.attempt;
  beginExam();
  addEvent(isNew ? "start" : "resume", "");
  if (S.env.extended) addEvent("multi_monitor", "second screen detected at start");
};

function beginExam() {
  S.active = true;
  const a = S.act;
  show("vExam");
  $("#examTitle").textContent = a.title;
  $("#explainBox").hidden = !a.requireExplain;
  const wm = `${S.user.displayName || ""} · ${S.user.email} · ${S.aid}`;
  $("#watermark").innerHTML = Array.from({ length: 90 }, () => `<span>${esc(wm)}</span>`).join("");

  // Editor: one CodeMirror document per problem keeps each problem's undo history.
  if (!S.cm) {
    S.cm = CodeMirror($("#editorWrap"), {
      mode: "r", lineNumbers: true, matchBrackets: true, autoCloseBrackets: true,
      indentUnit: 2, tabSize: 2, lineWrapping: false, dragDrop: false, spellcheck: false,
      autocorrect: false, autocapitalize: false,
      extraKeys: { "Ctrl-Enter": () => run(), "Cmd-Enter": () => run(), Tab: cm => cm.execCommand("insertSoftTab") },
    });
    S.cm.on("beforeChange", onBeforeChange);
    S.cm.on("change", onChange);
    const wrap = S.cm.getWrapperElement();
    ["copy", "cut"].forEach(t => wrap.addEventListener(t, () => (S.internalClip = norm(S.cm.getSelection())), true));
  }
  S.docs = a.problems.map((p, i) => CodeMirror.Doc(S.code[i] ?? "", "r"));
  renderTabs(); selectProblem(0);

  // R engine
  $("#rStatus").textContent = "Loading R…";
  loadR(s => ($("#rStatus").textContent = s))
    .then(() => ensurePackages(a.packages || [], s => ($("#rStatus").textContent = s)))
    .then(() => { S.rReady = true; $("#rStatus").textContent = "R ready"; })
    .catch(e => { $("#rStatus").textContent = "R failed to load. Refresh the page."; console.error(e); });

  // Live updates: instructor extra time, activity closed
  S.unsubs.push(onSnapshot(S.attemptRef, s => {
    if (!s.exists()) return;
    S.attempt = s.data();
    if (S.attempt.startedAt) S.startLocal = ms(S.attempt.startedAt);
  }));
  S.unsubs.push(onSnapshot(doc(db, "activities", S.aid), s => {
    const d = s.data(); if (!d) return;
    S.act.durationMin = d.durationMin;
    if (d.status !== "open" && S.active) endExam("closed");
  }));

  addMonitors();
  S.timers.push(setInterval(tick, 1000));
  S.timers.push(setInterval(() => save(false), SAVE_INTERVAL_SEC * 1000));
  S.timers.push(setInterval(snapshots, SNAPSHOT_INTERVAL_SEC * 1000));
  updateFlagCount();
  tick();
  // If the browser refused fullscreen at start, block the work until the student enters it.
  setTimeout(() => { if (S.active && document.fullscreenEnabled && !document.fullscreenElement) lock(true); }, 1500);
}

/* ---------------- Problems ---------------- */
function renderTabs() {
  $("#ptabs").innerHTML = S.act.problems.map((p, i) =>
    `<button class="ptab sm${i === S.cur ? " on" : ""}" data-i="${i}"><span class="dot ${S.sample[i] || ""}"></span>P${i + 1}</button>`).join("");
  $$("#ptabs .ptab").forEach(b => (b.onclick = () => selectProblem(+b.dataset.i)));
}
function selectProblem(i) {
  S.cur = i;
  const p = S.act.problems[i];
  S.cm.swapDoc(S.docs[i]);
  $("#pNum").textContent = `Problem ${i + 1} of ${S.act.problems.length}` + (p.points ? ` · ${p.points} pts` : "");
  $("#pTitle").textContent = p.title || `Problem ${i + 1}`;
  $("#pPrompt").innerHTML = md(p.prompt);
  const n = parseTests(p.sampleTests).length;
  $("#pHidden").textContent = (n ? `${n} sample test${n > 1 ? "s" : ""} you can check. ` : "") +
    (p.hiddenCount ? `Your instructor will also run ${p.hiddenCount} hidden test${p.hiddenCount > 1 ? "s" : ""}.` : "");
  $("#checkBtn").disabled = !n;
  $("#explainIn").value = S.explain[i] || "";
  renderTabs();
  setTimeout(() => { S.cm.refresh(); S.cm.focus(); }, 0);
}
$("#resetBtn").onclick = async () => {
  if (!(await modal({ title: "Reset this problem?", html: "<p>Your code for this problem will be replaced with the starter code.</p>", ok: "Reset", danger: true }))) return;
  S.cm.setValue(S.act.problems[S.cur].starter || "");
};
$("#explainIn").addEventListener("input", e => { S.explain[S.cur] = e.target.value; S.dirty = true; });

/* ---------------- Editor tracking ---------------- */
const norm = s => String(s || "").replace(/\r\n?/g, "\n");
function onBeforeChange(cm, ch) {
  if (!S.active) return;
  if (ch.origin === "paste") {
    const text = norm(ch.text.join("\n"));
    if (S.act.allowPaste || (S.internalClip && text === S.internalClip)) { ch._internal = true; return; }
    ch.cancel();
    flag("paste_blocked", `${text.length} chars`, "paste");
  } else if (ch.origin === "drop") {
    ch.cancel();
    flag("drop_blocked", `${norm(ch.text.join("\n")).length} chars`, "paste");
  }
}
function onChange(cm, ch) {
  const i = S.cur;
  S.code[i] = cm.getValue();
  S.dirty = true;
  const t = (S.typing[i] ||= { typed: 0, deleted: 0, runs: 0 });
  const ins = ch.text.join("\n").length;
  const del = ch.removed ? ch.removed.join("\n").length : 0;
  if (ch.origin === "+input") {
    t.typed += ins;
    if (ins > 40 && S.active) flag("burst", `${ins} chars inserted at once`, "burst");
  } else if (ch.origin === "+delete" || ch.origin === "cut") t.deleted += del;
  $("#saveStatus").textContent = "";
}

/* ---------------- Monitoring ---------------- */
let monitorsOn = false;
function addMonitors() {
  if (monitorsOn) return; monitorsOn = true;
  document.addEventListener("visibilitychange", () => {
    if (!S.active) return;
    if (document.hidden) { S.hiddenAt = Date.now(); flag("tab_hidden", "", "tab", true); }
    else if (S.hiddenAt) {
      const sec = Math.round((Date.now() - S.hiddenAt) / 1000); S.hiddenAt = 0;
      S.counts.tabSec += sec; addEvent("tab_return", `away ${sec}s`);
      toast(`Tab switch recorded (away ${sec}s)`, "warn");
      save(true);
    }
  });
  window.addEventListener("blur", () => {
    if (!S.active || document.hidden) return;
    S.blurAt = Date.now(); S.blurCounted = false;
    setTimeout(() => {
      if (S.blurAt && !document.hidden && !document.hasFocus()) { S.blurCounted = true; flag("blur", "window lost focus", "blur", true); }
    }, 400);
  });
  window.addEventListener("focus", () => {
    if (S.blurAt && S.blurCounted && S.active) {
      const sec = Math.round((Date.now() - S.blurAt) / 1000);
      S.counts.blurSec += sec; addEvent("focus_return", `away ${sec}s`);
      toast(`Leaving the window was recorded (${sec}s)`, "warn");
      save(true);
    }
    S.blurAt = 0; S.blurCounted = false;
  });
  document.addEventListener("fullscreenchange", () => {
    if (!S.active) return;
    if (!document.fullscreenElement) { flag("fs_exit", "", "fs", true); lock(true); }
    else lock(false);
  });
  document.addEventListener("copy", e => {
    if (!S.active) return;
    if (S.cm.getWrapperElement().contains(e.target)) return; // copying own code is fine
    const sel = String(document.getSelection() || "");
    e.preventDefault();
    if (sel.length) flag("copy_blocked", `${sel.length} chars`, "copy");
  });
  $("#explainIn").addEventListener("paste", e => {
    if (!S.active || S.act.allowPaste) return;
    const t = norm(e.clipboardData?.getData("text"));
    if (S.internalClip && t === S.internalClip) return;
    e.preventDefault(); flag("paste_blocked", `${t.length} chars (explanation)`, "paste");
  });
  $("#explainIn").addEventListener("copy", () => (S.internalClip = norm(String(document.getSelection() || ""))));
  document.addEventListener("contextmenu", e => { if (S.active) e.preventDefault(); });
  document.addEventListener("keydown", e => {
    if (!S.active) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && ["p", "s", "u"].includes(k)) e.preventDefault();
  });
  window.addEventListener("offline", () => { if (S.active) S.offAt = Date.now(); });
  window.addEventListener("online", () => {
    if (!S.active || !S.offAt) return;
    const sec = Math.round((Date.now() - S.offAt) / 1000); S.offAt = 0;
    flag("offline", `disconnected ${sec}s`, "offline");
  });
  if (screen.addEventListener && "isExtended" in screen) {
    screen.addEventListener("change", () => {
      if (S.active && screen.isExtended && !S.env.extended) {
        S.env.extended = true; S.dirty = true;
        addEvent("multi_monitor", "second screen connected during activity");
        toast("A second screen was detected and recorded", "warn");
      }
    });
  }
  window.addEventListener("beforeunload", e => {
    if (!S.active) return;
    save(true);
    e.preventDefault(); e.returnValue = "";
  });
}

function flag(type, detail, countKey, quiet = false) {
  if (countKey) S.counts[countKey] = (S.counts[countKey] || 0) + 1;
  addEvent(type, detail);
  updateFlagCount();
  if (!quiet) {
    const msg = { paste_blocked: "Paste is disabled. Attempt recorded.", drop_blocked: "Drag-and-drop is disabled. Attempt recorded.",
      copy_blocked: "Copying is disabled. Attempt recorded.", burst: "Large text insertion recorded.", offline: "Lost connection. Recorded." }[type];
    if (msg) toast(msg, "warn");
  }
  S.dirty = true;
  clearTimeout(flag._t); flag._t = setTimeout(() => save(true), 1500);
}
function updateFlagCount() {
  const c = S.counts;
  const n = c.tab + c.blur + c.fs + c.paste + c.copy + c.burst;
  const el = $("#flagCount");
  el.innerHTML = n ? `<span class="pill st-fail" title="Tab switches, focus losses, fullscreen exits, paste/copy attempts">${n} flag${n > 1 ? "s" : ""} recorded</span>` : "";
}
function addEvent(type, detail, extra = {}) {
  if (!S.attemptRef) return;
  addDoc(collection(S.attemptRef, "events"), {
    type, detail: String(detail || "").slice(0, 300), p: S.cur, clientT: Date.now(), t: serverTimestamp(), ...extra,
  }).catch(err => console.warn("event not saved", err));
}

/* Fullscreen */
function enterFullscreen() {
  const el = document.documentElement;
  if (!document.fullscreenEnabled || document.fullscreenElement) return;
  el.requestFullscreen?.({ navigationUI: "hide" }).catch(() => { if (S.active) lock(true); });
}
function exitFullscreen() { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); }
function lock(on) {
  if (!document.fullscreenEnabled) return; // e.g. iPhone Safari: cannot enforce; instructor sees env
  $("#lock").hidden = !on;
}
$("#lockBtn").onclick = () => enterFullscreen();

/* ---------------- Save / snapshots / timer ---------------- */
async function save(force) {
  if (!S.attemptRef || S.saving) return;
  const due = Date.now() - S.lastWrite > HEARTBEAT_SEC * 1000;
  if (!S.dirty && !due && !force) return;
  if (!S.active && !force) return;
  S.saving = true; S.dirty = false;
  try {
    await updateDoc(S.attemptRef, {
      code: S.code, explain: S.explain, typing: S.typing, counts: S.counts, env: S.env, lastSeen: serverTimestamp(),
    });
    S.lastWrite = Date.now();
    $("#saveStatus").textContent = "Saved " + new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch (e) {
    S.dirty = true;
    $("#saveStatus").textContent = "Not saved: retrying";
    if (e.code === "permission-denied" && S.active) checkEnded();
  } finally { S.saving = false; }
}
function snapshots() {
  for (const k of Object.keys(S.code)) {
    if (S.code[k] !== S.lastSnap[k]) {
      S.lastSnap[k] = S.code[k];
      addEvent("snap", "", { p: +k, code: String(S.code[k]).slice(0, 19000) });
    }
  }
}
function deadline() {
  const extra = S.attempt?.extraMin || 0;
  return (S.startLocal || Date.now()) + (Number(S.act.durationMin) + extra) * 60000;
}
function tick() {
  if (!S.active) return;
  const left = deadline() - Date.now();
  const t = $("#timer");
  t.textContent = fmtClock(left);
  t.classList.toggle("low", left < 5 * 60000);
  if (left <= 0) endExam("time");
}
function checkEnded() {
  if (S.act.status !== "open") endExam("closed");
  else if (deadline() - Date.now() <= 0) endExam("time");
}

/* ---------------- Run / check ---------------- */
async function run() {
  if (!S.rReady) return toast("R is still loading…");
  const i = S.cur, p = S.act.problems[i];
  setBusy(true);
  $("#output").innerHTML = `<pre class="console"><span class="info">Running…</span></pre>`;
  (S.typing[i] ||= { typed: 0, deleted: 0, runs: 0 }).runs++;
  const r = await runCode({ setup: p.setup || "", code: S.code[i] || "", seed: seedFor(S.user.uid, S.aid) });
  renderOutput(r);
  setBusy(false);
}
$("#runBtn").onclick = run;
$("#checkBtn").onclick = async () => {
  if (!S.rReady) return toast("R is still loading…");
  const i = S.cur, p = S.act.problems[i];
  const tests = parseTests(p.sampleTests);
  setBusy(true);
  $("#output").innerHTML = `<pre class="console"><span class="info">Checking…</span></pre>`;
  const r = await gradeCode({ setup: p.setup || "", code: S.code[i] || "", tests: tests.map(t => t.expr), seed: seedFor(S.user.uid, S.aid) });
  const ok = r.pass.filter(Boolean).length;
  S.sample[i] = ok === tests.length ? "ok" : ok ? "part" : "";
  renderTabs();
  $("#output").innerHTML = `
    <div class="row"><b>Sample tests: ${ok} / ${tests.length} passed</b></div>
    ${r.error ? `<pre class="console"><span class="stderr">Your code stopped with an error: ${esc(r.error)}</span></pre>` : ""}
    <ul class="tests">${tests.map((t, k) => `<li class="${r.pass[k] ? "ok" : "no"}">${r.pass[k] ? "✓" : "✗"} ${esc(t.desc)}</li>`).join("")}</ul>
    <p class="small muted">Passing the samples doesn't guarantee full marks. Hidden tests use the same rules.</p>`;
  setBusy(false);
};
function setBusy(b) { $("#runBtn").disabled = b; $("#checkBtn").disabled = b || !parseTests(S.act.problems[S.cur].sampleTests).length; }
function renderOutput(r) {
  const out = $("#output");
  const lines = r.lines.map(l => `<span class="${l.type === "stderr" ? "stderr" : ""}">${esc(l.text)}</span>`).join("\n");
  out.innerHTML = `<pre class="console">${lines || '<span class="info">(no output)</span>'}</pre><div class="plots"></div>`;
  const box = out.querySelector(".plots");
  for (const img of r.images) {
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    c.getContext("2d").drawImage(img, 0, 0);
    box.append(c);
  }
}

/* ---------------- Submit / end ---------------- */
$("#submitBtn").onclick = async () => {
  const unanswered = S.act.problems.map((p, i) => (S.code[i] || "").trim() === (p.starter || "").trim() ? i + 1 : 0).filter(Boolean);
  const html = `<p>You can't change your answers after submitting.</p>` +
    (unanswered.length ? `<p style="color:var(--fail)">Unchanged from starter code: Problem ${unanswered.join(", ")}</p>` : "");
  if (!(await modal({ title: "Submit your work?", html, ok: "Submit" }))) return;
  endExam("submit");
};

async function endExam(reason) {
  if (!S.active) return;
  S.active = false;
  S.timers.forEach(clearInterval); S.timers = [];
  S.unsubs.forEach(u => u()); S.unsubs = [];
  $("#lock").hidden = true;
  snapshots();
  let ok = true;
  if (reason !== "closed") {
    try {
      await updateDoc(S.attemptRef, {
        code: S.code, explain: S.explain, typing: S.typing, counts: S.counts, env: S.env,
        lastSeen: serverTimestamp(), status: "submitted", submittedAt: serverTimestamp(),
      });
      addEvent(reason === "time" ? "auto_submit" : "submit", "");
    } catch { ok = false; }
  }
  exitFullscreen();
  const msg = {
    submit: ok ? "Your work was submitted. You may close this page." : "Submission could not be saved, but your last autosave was kept. Tell your instructor.",
    time: ok ? "Time is up. Your work was submitted automatically." : "Time is up. Your last autosaved work was kept.",
    closed: "Your instructor closed this activity. Your last autosaved work was kept.",
  }[reason];
  $("#dTitle").textContent = reason === "closed" ? "Activity closed" : reason === "time" ? "Time's up" : "Submitted";
  $("#dMsg").textContent = msg;
  show("vDone");
}
