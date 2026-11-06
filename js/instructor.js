// Instructor page: build activities, monitor live, grade, check integrity.
import {
  auth, db, onAuthStateChanged, signInGoogle, logout, checkInstructor,
  doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp,
} from "./firebase.js";
import { loadR, ensurePackages, gradeCode, runCode } from "./rengine.js";
import {
  $, $$, esc, seedFor, parseTests, toast, modal, ms, fmtClock, fmtTime, fmtDateTime, randomCode, brand,
  EMPTY_COUNTS, riskOf, riskLabel, untyped,
} from "./common.js";
import { SAMPLE } from "./sample.js";

brand();
const S = { user: null, acts: [], aid: null, act: null, priv: null, attempts: [], unsubA: null, unsubAtt: null, isNew: false, tab: "setup" };

/* ---------------- Auth ---------------- */
onAuthStateChanged(auth, async user => {
  S.user = user;
  $("#who").innerHTML = user ? `${esc(user.displayName || "")}<br>${esc(user.email)}` : "";
  $("#logoutBtn").hidden = !user;
  if (!user) { $("#vApp").hidden = true; $("#vSignin").hidden = false; return; }
  if (!(await checkInstructor(user))) {
    $("#signinErr").innerHTML = `<b>${esc(user.email)}</b> is not registered as an instructor. In the Firebase console, add a document with ID <code>${esc(user.email.toLowerCase())}</code> to the <code>instructors</code> collection, then sign in again.`;
    $("#signinErr").hidden = false; $("#vSignin").hidden = false; $("#vApp").hidden = true;
    return;
  }
  $("#vSignin").hidden = true; $("#vApp").hidden = false;
  S.unsubA?.();
  S.unsubA = onSnapshot(query(collection(db, "activities"), orderBy("updatedAt", "desc")), snap => {
    S.acts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderList();
  });
});
$("#signinBtn").onclick = async () => {
  $("#signinErr").hidden = true;
  try { await signInGoogle(false); } catch (e) { $("#signinErr").textContent = "Sign-in failed: " + (e.code || e.message); $("#signinErr").hidden = false; }
};
$("#logoutBtn").onclick = () => logout();

const statusPill = s => ({ open: `<span class="pill st-pass">Open</span>`, closed: `<span class="pill st-fail">Closed</span>` }[s] || `<span class="pill st-inc">Draft</span>`);

function renderList() {
  const box = $("#alist");
  if (!S.acts.length) { box.innerHTML = `<p class="small muted">No activities yet.</p>`; return; }
  box.innerHTML = S.acts.map(a => `<button class="aitem${a.id === S.aid ? " on" : ""}" data-id="${esc(a.id)}">
    <b>${esc(a.title || a.id)}</b><span class="row small muted">${esc(a.id)} ${statusPill(a.status)}</span></button>`).join("");
  $$(".aitem", box).forEach(b => (b.onclick = () => openAct(b.dataset.id)));
  if (S.aid && !S.isNew) {
    const a = S.acts.find(x => x.id === S.aid);
    if (a) { S.act = a; $("#aStatus").innerHTML = statusPill(a.status); }
  }
}

/* ---------------- Tabs ---------------- */
$$(".tabs button").forEach(b => (b.onclick = () => setTab(b.dataset.tab)));
function setTab(t) {
  S.tab = t;
  $$(".tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === t));
  $("#tSetup").hidden = t !== "setup"; $("#tMonitor").hidden = t !== "monitor"; $("#tResults").hidden = t !== "results";
  if (t === "monitor") renderMonitor();
  if (t === "results") renderResults();
}

/* ---------------- Open / new ---------------- */
$("#newBtn").onclick = () => {
  S.isNew = true; S.aid = randomCode(6);
  S.act = { title: "", instructions: "", durationMin: 60, packages: [], allowPaste: false, requireExplain: true, status: "draft", problems: [] };
  S.priv = { problems: [] };
  S.attempts = []; S.unsubAtt?.(); S.unsubAtt = null;
  showAct(); addProblem(); setTab("setup");
};
async function openAct(id) {
  S.isNew = false; S.aid = id;
  S.act = S.acts.find(a => a.id === id);
  const p = await getDoc(doc(db, "activities", id, "private", "key")).catch(() => null);
  S.priv = p?.exists() ? p.data() : { problems: [] };
  S.unsubAtt?.();
  S.unsubAtt = onSnapshot(collection(db, "activities", id, "attempts"), snap => {
    S.attempts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (S.tab === "monitor") renderMonitor();
    if (S.tab === "results") renderResults();
    if (S.drawerUid) refreshDrawerHead();
  });
  showAct(); renderList();
}
function showAct() {
  $("#empty").hidden = true; $("#act").hidden = false;
  const a = S.act;
  $("#aTitle").textContent = a.title || "New activity";
  $("#aCodeLbl").textContent = S.aid;
  $("#aStatus").innerHTML = statusPill(a.status);
  $("#fCode").value = S.aid; $("#fCode").disabled = !S.isNew;
  $("#fTitle").value = a.title || ""; $("#fStatus").value = a.status || "draft";
  $("#fDur").value = a.durationMin || 60; $("#fPkgs").value = (a.packages || []).join(", ");
  $("#fInstr").value = a.instructions || ""; $("#fPaste").checked = !!a.allowPaste; $("#fExplain").checked = a.requireExplain !== false;
  $$(".tabs button").forEach(b => (b.disabled = S.isNew && b.dataset.tab !== "setup"));
  renderLink();
  $("#probs").innerHTML = "";
  (a.problems || []).forEach((p, i) => addProblem({ ...p, ...(S.priv.problems?.[i] || {}) }));
  $("#saveMsg").textContent = S.isNew ? "Not saved yet" : "";
}
function renderLink() {
  const url = new URL("index.html?code=" + S.aid, location.href).href;
  const box = $("#linkBox");
  box.hidden = S.isNew;
  box.innerHTML = `<b>Student link:</b> <a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>
    <button class="sm" id="copyLink">Copy</button><br>Or students open the site and type the code <b>${esc(S.aid)}</b>.`;
  $("#copyLink", box)?.addEventListener("click", () => navigator.clipboard.writeText(url).then(() => toast("Link copied", "ok")));
}

/* ---------------- Problem editor ---------------- */
$("#addProbBtn").onclick = () => addProblem();
$("#sampleBtn").onclick = async () => {
  if ($$(".prob").some(p => $("[data-k=prompt]", p).value.trim()) &&
      !(await modal({ title: "Replace problems?", html: "<p>The sample problems will replace what's here.</p>", ok: "Replace", danger: true }))) return;
  $("#probs").innerHTML = "";
  SAMPLE.problems.forEach(p => addProblem(p));
  if (!$("#fTitle").value) $("#fTitle").value = SAMPLE.title;
  if (!$("#fInstr").value) $("#fInstr").value = SAMPLE.instructions;
  if (!$("#fPkgs").value) $("#fPkgs").value = SAMPLE.packages.join(", ");
  toast("Sample problems loaded. Remember to save.", "ok");
};

function addProblem(p = {}) {
  const el = document.createElement("details");
  el.className = "prob"; el.open = !p.title;
  el.innerHTML = `
    <summary><span class="pnum"></span><span class="ptitle grow">${esc(p.title || "Untitled problem")}</span><span class="ppts small muted"></span></summary>
    <div class="body">
      <label class="field"><span>Title</span><input data-k="title"></label>
      <label class="field"><span>Problem statement (supports \`code\`, **bold**, - bullets, \`\`\` blocks)</span><textarea data-k="prompt" rows="5"></textarea></label>
      <div class="grid2">
        <label class="field"><span>Setup code (runs before student code; use .seed)</span><textarea class="code" data-k="setup" rows="6"></textarea></label>
        <label class="field"><span>Starter code (what students see)</span><textarea class="code" data-k="starter" rows="6"></textarea></label>
      </div>
      <label class="field"><span>Sample tests (visible to students)</span><textarea class="code" data-k="sampleTests" rows="3" placeholder="1 | total exists | exists(&quot;total&quot;)"></textarea></label>
      <div class="private stack">
        <div class="lbl" style="color:var(--accent)">Private: only instructors can read these</div>
        <label class="field"><span>Hidden tests</span><textarea class="code" data-k="hiddenTests" rows="4"></textarea></label>
        <label class="field"><span>Reference solution</span><textarea class="code" data-k="solution" rows="5"></textarea></label>
      </div>
      <div class="row">
        <button class="sm" data-act="test">▶ Test with solution</button>
        <span class="grow"></span>
        <button class="sm ghost" data-act="up">↑</button><button class="sm ghost" data-act="down">↓</button>
        <button class="sm ghost" data-act="del" style="color:var(--fail)">Delete</button>
      </div>
      <div class="testout stack"></div>
    </div>`;
  $$("[data-k]", el).forEach(i => {
    i.value = p[i.dataset.k] || "";
    i.addEventListener("input", () => { updateProbHeads(); $("#saveMsg").textContent = "Unsaved changes"; });
    if (i.tagName === "TEXTAREA" && i.classList.contains("code"))
      i.addEventListener("keydown", e => { if (e.key === "Tab") { e.preventDefault(); document.execCommand("insertText", false, "  "); } });
  });
  el.addEventListener("click", async e => {
    const act = e.target.closest("[data-act]")?.dataset.act; if (!act) return;
    if (act === "del") { if (await modal({ title: "Delete this problem?", ok: "Delete", danger: true })) { el.remove(); updateProbHeads(); } }
    if (act === "up" && el.previousElementSibling) el.parentNode.insertBefore(el, el.previousElementSibling);
    if (act === "down" && el.nextElementSibling) el.parentNode.insertBefore(el.nextElementSibling, el);
    if (act === "test") testProblem(el);
    updateProbHeads();
  });
  $("#probs").append(el);
  updateProbHeads();
}
function readProb(el) { const o = {}; $$("[data-k]", el).forEach(i => (o[i.dataset.k] = i.value)); return o; }
function updateProbHeads() {
  $$(".prob").forEach((el, i) => {
    const p = readProb(el);
    $(".pnum", el).textContent = `P${i + 1}`;
    $(".ptitle", el).textContent = p.title || "Untitled problem";
    const pts = [...parseTests(p.sampleTests), ...parseTests(p.hiddenTests)].reduce((s, t) => s + t.points, 0);
    $(".ppts", el).textContent = `${pts} pts · ${parseTests(p.sampleTests).length} sample + ${parseTests(p.hiddenTests).length} hidden tests`;
  });
}
const pkgList = () => $("#fPkgs").value.split(",").map(s => s.trim()).filter(Boolean);
async function rReady(statusEl) {
  const say = s => statusEl && (statusEl.textContent = s);
  await loadR(say); await ensurePackages(pkgList(), say);
}
async function testProblem(el) {
  const out = $(".testout", el);
  const p = readProb(el);
  out.innerHTML = `<span class="small muted">Loading R…</span>`;
  try { await rReady(out.firstElementChild); } catch (e) { out.innerHTML = `<span class="small" style="color:var(--fail)">R failed to load: ${esc(e.message)}</span>`; return; }
  const tests = [...parseTests(p.sampleTests).map(t => ({ ...t, kind: "sample" })), ...parseTests(p.hiddenTests).map(t => ({ ...t, kind: "hidden" }))];
  const seed = 123456;
  const run = await runCode({ setup: p.setup, code: p.solution, seed });
  const g = await gradeCode({ setup: p.setup, code: p.solution, tests: tests.map(t => t.expr), seed });
  const pass = g.pass.filter(Boolean).length;
  out.innerHTML = `
    <div class="row"><b>Reference solution: ${pass} / ${tests.length} tests pass</b>
      <span class="pill ${pass === tests.length ? "st-pass" : "st-fail"}">${pass === tests.length ? "Ready" : "Check your tests"}</span></div>
    ${g.error ? `<pre class="console"><span class="stderr">Solution error: ${esc(g.error)}</span></pre>` : ""}
    <ul class="tests">${tests.map((t, k) => `<li class="${g.pass[k] ? "ok" : "no"}">${g.pass[k] ? "✓" : "✗"} [${t.kind}, ${t.points} pt] ${esc(t.desc)}</li>`).join("")}</ul>
    <div class="lbl">Output (seed ${seed})</div>
    <pre class="console">${run.lines.map(l => `<span class="${l.type === "stderr" ? "stderr" : ""}">${esc(l.text)}</span>`).join("\n") || "(no output)"}</pre>
    <div class="plots"></div>`;
  for (const img of run.images) {
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    c.getContext("2d").drawImage(img, 0, 0); $(".plots", out).append(c);
  }
}

/* ---------------- Save ---------------- */
$("#saveBtn").onclick = save;
async function save() {
  const code = $("#fCode").value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
  if (code.length < 4) return toast("Activity code must be at least 4 letters/numbers", "warn");
  const probs = $$(".prob").map(readProb);
  if (!probs.length) return toast("Add at least one problem", "warn");
  const pub = {
    title: $("#fTitle").value.trim() || "Untitled activity",
    instructions: $("#fInstr").value,
    durationMin: Math.max(1, Math.round(Number($("#fDur").value) || 60)),
    packages: pkgList(),
    allowPaste: $("#fPaste").checked,
    requireExplain: $("#fExplain").checked,
    status: $("#fStatus").value,
    problems: probs.map(p => ({
      title: p.title, prompt: p.prompt, starter: p.starter, setup: p.setup, sampleTests: p.sampleTests,
      hiddenCount: parseTests(p.hiddenTests).length,
      points: [...parseTests(p.sampleTests), ...parseTests(p.hiddenTests)].reduce((s, t) => s + t.points, 0),
    })),
    updatedAt: serverTimestamp(),
  };
  const priv = { problems: probs.map(p => ({ hiddenTests: p.hiddenTests, solution: p.solution })) };
  $("#saveBtn").disabled = true;
  try {
    if (S.isNew) {
      const ex = await getDoc(doc(db, "activities", code));
      if (ex.exists()) { toast("That code is already used. Pick another.", "warn"); return; }
      pub.createdAt = serverTimestamp(); pub.owner = S.user.email;
    } else {
      pub.createdAt = S.act.createdAt || serverTimestamp(); pub.owner = S.act.owner || S.user.email;
    }
    const target = S.isNew ? code : S.aid;
    await setDoc(doc(db, "activities", target, "private", "key"), priv);
    await setDoc(doc(db, "activities", target), pub);
    toast("Activity saved", "ok");
    $("#saveMsg").textContent = "Saved " + new Date().toLocaleTimeString();
    if (S.isNew) { S.isNew = false; S.acts = [{ id: target, ...pub }, ...S.acts.filter(a => a.id !== target)]; await openAct(target); }
    else { S.act = { ...S.act, ...pub }; S.priv = priv; $("#aTitle").textContent = pub.title; $("#aStatus").innerHTML = statusPill(pub.status); }
  } catch (e) {
    toast("Save failed: " + (e.code || e.message), "warn", 6000);
  } finally { $("#saveBtn").disabled = false; }
}

/* ---------------- Monitor ---------------- */
$("#mSearch").addEventListener("input", renderMonitor);
setInterval(() => { if (S.tab === "monitor" && !$("#act").hidden) renderMonitor(); }, 5000);
const starterLens = () => (S.act?.problems || []).map(p => (p.starter || "").length);

function attemptStatus(a) {
  if (a.status === "submitted") return ["Submitted", "st-pass"];
  const end = ms(a.startedAt) + ((S.act.durationMin || 0) + (a.extraMin || 0)) * 60000;
  if (Date.now() > end) return ["Time over", "st-inc"];
  const seen = ms(a.lastSeen) || 0;
  if (Date.now() - seen > 2.5 * 60000) return ["No signal", "st-fail"];
  return ["Working", "st-rem"];
}
function flagChips(a) {
  const c = { ...EMPTY_COUNTS, ...(a.counts || {}) };
  const ch = (n, label, title) => n ? `<span class="chip bad" title="${esc(title)}">${label} ${n}</span>` : "";
  const ut = untyped(a, starterLens());
  return [
    ch(c.tab, "Tab", `Switched tabs ${c.tab}× (${c.tabSec}s away)`),
    ch(c.blur, "Focus", `Left the window ${c.blur}× (${c.blurSec}s)`),
    ch(c.fs, "Fullscreen", "Exited fullscreen"),
    ch(c.paste, "Paste", "Paste/drag-drop attempts (blocked)"),
    ch(c.copy, "Copy", "Tried to copy problem text"),
    ch(c.burst, "Burst", "Large text inserted at once"),
    ch(c.offline, "Offline", "Disconnected"),
    a.env?.extended ? `<span class="chip bad" title="Second monitor detected">2 screens</span>` : "",
    ut.length ? `<span class="chip bad" title="Final code much longer than what was typed">Not typed: P${ut.map(i => i + 1).join(",P")}</span>` : "",
    a.env && a.env.fsSupported === false ? `<span class="chip" title="Browser can't enforce fullscreen (e.g. iPhone)">No FS support</span>` : "",
  ].join("") || `<span class="small muted">none</span>`;
}
function renderMonitor() {
  if (!S.act) return;
  const q = $("#mSearch").value.toLowerCase();
  const list = S.attempts.filter(a => !q || (a.name + " " + a.email).toLowerCase().includes(q))
    .sort((a, b) => riskOf(b, starterLens()) - riskOf(a, starterLens()) || String(a.name).localeCompare(b.name));
  const n = s => S.attempts.filter(a => attemptStatus(a)[0] === s).length;
  const high = S.attempts.filter(a => riskOf(a, starterLens()) >= 40).length;
  $("#mStats").innerHTML = [
    ["Joined", S.attempts.length], ["Working", n("Working")], ["Submitted", n("Submitted")], ["No signal", n("No signal")], ["High risk", high],
  ].map(([k, v]) => `<div class="stat"><span class="lbl">${k}</span><b>${v}</b></div>`).join("");
  if (!list.length) { $("#mTable").innerHTML = `<tr><td class="muted">No students have joined yet. Set the activity to Open and share the code.</td></tr>`; return; }
  $("#mTable").innerHTML = `<thead><tr><th>Student</th><th>Status</th><th>Time left</th><th>Last seen</th><th>Integrity</th><th>Flags</th></tr></thead><tbody>` +
    list.map(a => {
      const [st, cls] = attemptStatus(a);
      const end = ms(a.startedAt) + ((S.act.durationMin || 0) + (a.extraMin || 0)) * 60000;
      const left = a.status === "submitted" ? "—" : fmtClock(end - Date.now());
      const r = riskOf(a, starterLens()); const [rl, rc] = riskLabel(r);
      return `<tr class="click" data-uid="${esc(a.id)}"><td><b>${esc(a.name)}</b><br><span class="small muted">${esc(a.email)}</span></td>
        <td><span class="pill ${cls}">${st}</span></td><td class="num">${left}</td><td class="small">${fmtTime(a.lastSeen)}</td>
        <td><span class="pill ${rc}">${rl} · ${r}</span></td><td>${flagChips(a)}</td></tr>`;
    }).join("") + "</tbody>";
  $$("#mTable tr.click").forEach(tr => (tr.onclick = () => openDrawer(tr.dataset.uid)));
}

/* ---------------- Student drawer ---------------- */
const EVT = {
  start: "Started", resume: "Resumed", submit: "Submitted", auto_submit: "Auto-submitted (time up)",
  tab_hidden: "Switched away from the tab", tab_return: "Returned to tab", blur: "Window lost focus", focus_return: "Returned to window",
  fs_exit: "Exited fullscreen", paste_blocked: "Paste blocked", drop_blocked: "Drag-and-drop blocked", copy_blocked: "Copy blocked",
  burst: "Large insertion", offline: "Was offline", multi_monitor: "Second screen",
};
const BAD = new Set(["tab_hidden", "blur", "fs_exit", "paste_blocked", "drop_blocked", "copy_blocked", "burst", "offline", "multi_monitor"]);
async function openDrawer(uid) {
  S.drawerUid = uid;
  const d = $("#drawer"); d.hidden = false;
  d.innerHTML = `<div class="dhead"><div class="grow" id="dName"></div><button id="dClose">Close</button></div><div class="dbody" id="dBody"><p class="muted">Loading…</p></div>`;
  $("#dClose").onclick = closeDrawer;
  refreshDrawerHead();
  const evs = await getDocs(query(collection(db, "activities", S.aid, "attempts", uid, "events"), orderBy("t"))).catch(() => null);
  S.drawerEvents = evs ? evs.docs.map(x => x.data()) : [];
  renderDrawerBody();
}
function closeDrawer() { $("#drawer").hidden = true; S.drawerUid = null; }
document.addEventListener("keydown", e => { if (e.key === "Escape" && S.drawerUid) closeDrawer(); });
function refreshDrawerHead() {
  const a = S.attempts.find(x => x.id === S.drawerUid); if (!a) return;
  const [st, cls] = attemptStatus(a);
  $("#dName").innerHTML = `<b>${esc(a.name)}</b> <span class="pill ${cls}">${st}</span><br><span class="small muted">${esc(a.email)}</span>`;
}
function renderDrawerBody() {
  const a = S.attempts.find(x => x.id === S.drawerUid); if (!a) return;
  const c = { ...EMPTY_COUNTS, ...(a.counts || {}) };
  const r = riskOf(a, starterLens()); const [rl, rc] = riskLabel(r);
  const used = ((ms(a.submittedAt) || Date.now()) - ms(a.startedAt)) / 60000;
  const evs = S.drawerEvents.filter(e => e.type !== "snap");
  const body = $("#dBody");
  body.innerHTML = `
    <div class="stats">
      <div class="stat"><span class="lbl">Integrity</span><b><span class="pill ${rc}" style="font-size:15px">${rl} · ${r}</span></b></div>
      <div class="stat"><span class="lbl">Started</span><b style="font-size:17px">${fmtDateTime(a.startedAt)}</b></div>
      <div class="stat"><span class="lbl">Time used</span><b style="font-size:17px">${Math.round(used)} min</b></div>
      <div class="stat"><span class="lbl">Seed</span><b style="font-size:17px">${seedFor(a.uid, S.aid)}</b></div>
    </div>
    <div class="card stack">
      <h3>Flags</h3>
      <div class="grid2 small">
        <div>Tab switches: <b>${c.tab}</b> (${c.tabSec}s away)</div><div>Left window: <b>${c.blur}</b> (${c.blurSec}s)</div>
        <div>Fullscreen exits: <b>${c.fs}</b></div><div>Blocked pastes: <b>${c.paste}</b></div>
        <div>Blocked copies: <b>${c.copy}</b></div><div>Large insertions: <b>${c.burst}</b></div>
        <div>Offline: <b>${c.offline}</b></div><div>Second screen: <b>${a.env?.extended ? "Yes" : "No"}</b></div>
      </div>
      <p class="small muted">${esc(a.env?.ua || "")} · screen ${a.env?.w}×${a.env?.h}${a.env?.fsSupported === false ? " · fullscreen not supported on this device" : ""}</p>
      <div class="row">
        <button class="sm" data-x="5">+5 min</button><button class="sm" data-x="10">+10 min</button>
        <span class="small muted">Extra time: ${a.extraMin || 0} min</span><span class="grow"></span>
        <button class="sm danger" id="dReset">Allow retake (delete attempt)</button>
      </div>
    </div>
    <div class="card stack"><h3>Timeline</h3>
      <ul class="timeline">${evs.map(e => `<li class="${BAD.has(e.type) ? "bad" : ""}"><time>${fmtTime(e.t || e.clientT)}</time>
        <span>${esc(EVT[e.type] || e.type)}${e.detail ? ` · ${esc(e.detail)}` : ""} <span class="muted">(P${(e.p ?? 0) + 1})</span></span></li>`).join("") || "<li>No events</li>"}</ul></div>
    ${(S.act.problems || []).map((p, i) => problemCard(a, p, i)).join("")}`;
  $$("[data-x]", body).forEach(b => (b.onclick = async () => {
    await updateDoc(doc(db, "activities", S.aid, "attempts", a.id), { extraMin: (a.extraMin || 0) + Number(b.dataset.x) });
    toast(`Gave ${b.dataset.x} more minutes`, "ok"); setTimeout(renderDrawerBody, 600);
  }));
  $("#dReset").onclick = async () => {
    if (!(await modal({ title: `Delete ${a.name}'s attempt?`, html: "<p>Their code, flags and grade for this activity will be removed so they can start over. This can't be undone.</p>", ok: "Delete attempt", danger: true }))) return;
    await deleteDoc(doc(db, "activities", S.aid, "attempts", a.id)); closeDrawer(); toast("Attempt deleted", "ok");
  };
  $$(".replay input[type=range]", body).forEach(sl => {
    const i = +sl.dataset.p; const snaps = replaySnaps(a, i);
    const pre = sl.closest(".replay").querySelector("pre"); const lbl = sl.closest(".replay").querySelector(".rlbl");
    const upd = () => { const s = snaps[+sl.value]; pre.textContent = s.code || "(empty)"; lbl.textContent = `${+sl.value + 1}/${snaps.length} · ${s.when}`; };
    sl.oninput = upd; upd();
  });
}
function replaySnaps(a, i) {
  const st = { code: S.act.problems[i].starter || "", when: "starter code" };
  const snaps = S.drawerEvents.filter(e => e.type === "snap" && e.p === i).map(e => ({ code: e.code, when: fmtTime(e.t || e.clientT) }));
  const fin = { code: a.code?.[i] ?? "", when: a.status === "submitted" ? "final (submitted)" : "latest autosave" };
  return [st, ...snaps, fin];
}
function problemCard(a, p, i) {
  const t = a.typing?.[i] || {};
  const g = a.grade?.problems?.[i];
  const nSnaps = replaySnaps(a, i).length;
  const ut = untyped(a, starterLens()).includes(i);
  return `<div class="card stack">
    <div class="row"><h3 class="grow">P${i + 1}. ${esc(p.title)}</h3>${g ? `<span class="pill ${g.score === g.max ? "st-pass" : g.score ? "st-rem" : "st-fail"}">${g.score} / ${g.max}</span>` : ""}</div>
    <div class="small muted">Typed ${t.typed || 0} chars · deleted ${t.deleted || 0} · ran code ${t.runs || 0}× · final length ${(a.code?.[i] || "").length}
      ${ut ? ` · <span class="chip bad">final code much longer than what was typed</span>` : ""}</div>
    <div class="replay stack"><div class="row small"><b>Code replay</b><input type="range" min="0" max="${nSnaps - 1}" value="${nSnaps - 1}" data-p="${i}" class="grow" style="padding:0"><span class="rlbl muted"></span></div><pre></pre></div>
    ${S.act.requireExplain ? `<div><div class="lbl">Explanation</div><p class="small" style="white-space:pre-wrap">${esc(a.explain?.[i] || "(none)")}</p></div>` : ""}
    ${g ? `${g.error ? `<pre class="console"><span class="stderr">Error: ${esc(g.error)}</span></pre>` : ""}
      <ul class="tests">${(g.tests || []).map(x => `<li class="${x.pass ? "ok" : "no"}">${x.pass ? "✓" : "✗"} [${x.points} pt${x.hidden ? ", hidden" : ""}] ${esc(x.desc)}</li>`).join("")}</ul>` : `<p class="small muted">Not graded yet.</p>`}
  </div>`;
}

/* ---------------- Grading ---------------- */
$("#gradeBtn").onclick = gradeAll;
async function gradeAll() {
  const all = $("#gradeAll").checked, re = $("#regrade").checked;
  const todo = S.attempts.filter(a => (all || a.status === "submitted") && (re || !a.grade));
  if (!todo.length) return toast(all ? "Nothing to grade" : "No new submissions to grade. Tick the boxes to include more.", "info", 5000);
  const prog = $("#gradeProg"), bar = $("i", prog), lbl = $("span", prog);
  prog.hidden = false; $("#gradeBtn").disabled = true;
  try {
    await loadR(s => (lbl.textContent = s));
    await ensurePackages(S.act.packages || [], s => (lbl.textContent = s));
    const pk = await getDoc(doc(db, "activities", S.aid, "private", "key"));
    const priv = pk.exists() ? pk.data() : { problems: [] };
    let k = 0;
    for (const a of todo) {
      lbl.textContent = `Grading ${a.name} (${k + 1} of ${todo.length})…`;
      const seed = seedFor(a.uid, S.aid);
      const problems = [];
      for (const [i, p] of S.act.problems.entries()) {
        const tests = [...parseTests(p.sampleTests).map(t => ({ ...t, hidden: false })), ...parseTests(priv.problems?.[i]?.hiddenTests).map(t => ({ ...t, hidden: true }))];
        const code = a.code?.[i] ?? "";
        const r = await gradeCode({ setup: p.setup || "", code, tests: tests.map(t => t.expr), seed });
        const res = tests.map((t, j) => ({ desc: t.desc, points: t.points, hidden: t.hidden, pass: !!r.pass[j] }));
        problems.push({
          score: res.reduce((s, x) => s + (x.pass ? x.points : 0), 0),
          max: res.reduce((s, x) => s + x.points, 0), error: r.error || "", tests: res,
        });
      }
      const grade = { total: problems.reduce((s, x) => s + x.score, 0), max: problems.reduce((s, x) => s + x.max, 0), problems, gradedAt: Date.now() };
      await updateDoc(doc(db, "activities", S.aid, "attempts", a.id), { grade });
      k++; bar.style.width = (100 * k / todo.length) + "%";
    }
    lbl.textContent = `Done: graded ${k} submission${k > 1 ? "s" : ""}.`;
    toast("Grading complete", "ok");
  } catch (e) {
    lbl.textContent = "Grading stopped: " + (e.message || e); toast("Grading failed", "warn");
  } finally { $("#gradeBtn").disabled = false; }
}

function renderResults() {
  if (!S.act) return;
  const P = S.act.problems || [];
  const list = [...S.attempts].sort((a, b) => String(a.name).localeCompare(b.name));
  if (!list.length) { $("#rTable").innerHTML = `<tr><td class="muted">No attempts yet.</td></tr>`; return; }
  $("#rTable").innerHTML = `<thead><tr><th>Student</th><th>Status</th>${P.map((p, i) => `<th title="${esc(p.title)}">P${i + 1}</th>`).join("")}<th>Total</th><th>%</th><th>Integrity</th></tr></thead><tbody>` +
    list.map(a => {
      const g = a.grade; const r = riskOf(a, starterLens()); const [rl, rc] = riskLabel(r);
      const [st, cls] = attemptStatus(a);
      return `<tr class="click" data-uid="${esc(a.id)}"><td><b>${esc(a.name)}</b><br><span class="small muted">${esc(a.email)}</span></td>
        <td><span class="pill ${cls}">${st}</span></td>
        ${P.map((p, i) => `<td class="num">${g?.problems?.[i] ? `${g.problems[i].score}/${g.problems[i].max}` : "—"}</td>`).join("")}
        <td class="num"><b>${g ? `${g.total}/${g.max}` : "—"}</b></td><td class="num">${g?.max ? Math.round(100 * g.total / g.max) + "%" : "—"}</td>
        <td><span class="pill ${rc}">${rl} · ${r}</span></td></tr>`;
    }).join("") + "</tbody>";
  $$("#rTable tr.click").forEach(tr => (tr.onclick = () => openDrawer(tr.dataset.uid)));
}

/* ---------------- Similarity ---------------- */
const R_WORDS = new Set("if else for while repeat function return next break TRUE FALSE NULL NA in".split(" "));
function fingerprint(code) {
  const src = String(code || "")
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '"S"')
    .replace(/#[^\n]*/g, "");
  const toks = src.match(/[A-Za-z._][A-Za-z0-9._]*|\d+\.?\d*|%[^%]*%|<-|->|[^\sA-Za-z0-9]/g) || [];
  const norm = toks.map((t, i) => {
    if (/^[A-Za-z._]/.test(t) && !R_WORDS.has(t)) return toks[i + 1] === "(" || toks[i + 1] === "::" || toks[i - 1] === "$" ? t : "V";
    if (/^\d/.test(t)) return "N";
    return t;
  });
  const sh = new Set();
  for (let i = 0; i + 4 <= norm.length; i++) sh.add(norm.slice(i, i + 4).join(" "));
  return sh;
}
const jaccard = (a, b) => { if (!a.size || !b.size) return 0; let n = 0; for (const x of a) if (b.has(x)) n++; return n / (a.size + b.size - n); };
$("#simBtn").onclick = () => {
  const P = S.act.problems || [];
  const rows = [];
  P.forEach((p, i) => {
    const st = (p.starter || "").length;
    const subs = S.attempts.map(a => ({ a, code: a.code?.[i] || "" })).filter(x => x.code.length - st > 40).map(x => ({ ...x, fp: fingerprint(x.code) }));
    for (let x = 0; x < subs.length; x++) for (let y = x + 1; y < subs.length; y++) {
      const s = jaccard(subs[x].fp, subs[y].fp);
      if (s >= 0.8) rows.push({ p: i, s, a: subs[x].a, b: subs[y].a });
    }
  });
  rows.sort((x, y) => y.s - x.s);
  const box = $("#simBox"); box.hidden = false;
  box.innerHTML = `<div class="row"><h3 class="grow">Code similarity (≥ 80%)</h3><button class="sm ghost" id="simClose">Hide</button></div>
    <p class="small muted">Compares the structure of code with variable names, numbers, strings and comments ignored. Short or very standard answers can look alike; use this as a lead, not proof.</p>
    ${rows.length ? `<div class="tablewrap"><table class="t"><thead><tr><th>Problem</th><th>Similarity</th><th>Student A</th><th>Student B</th></tr></thead><tbody>
      ${rows.slice(0, 100).map(r => `<tr><td>P${r.p + 1}</td><td><span class="pill ${r.s >= 0.95 ? "st-fail" : "st-rem"}">${Math.round(r.s * 100)}%</span></td>
        <td>${esc(r.a.name)}<br><span class="small muted">${esc(r.a.email)}</span></td><td>${esc(r.b.name)}<br><span class="small muted">${esc(r.b.email)}</span></td></tr>`).join("")}
      </tbody></table></div>` : `<p>No highly similar pairs found.</p>`}`;
  $("#simClose").onclick = () => (box.hidden = true);
};

/* ---------------- CSV ---------------- */
$("#csvBtn").onclick = () => {
  const P = S.act.problems || [];
  const head = ["Name", "Email", "Status", "Started", "Submitted", ...P.map((p, i) => `P${i + 1} (${p.points || ""})`), "Total", "Max", "Percent",
    "Integrity score", "Integrity", "Tab switches", "Seconds away (tab)", "Window focus lost", "Seconds away (window)", "Fullscreen exits",
    "Blocked pastes", "Blocked copies", "Large insertions", "Offline", "Second screen"];
  const rows = [...S.attempts].sort((a, b) => String(a.name).localeCompare(b.name)).map(a => {
    const g = a.grade, c = { ...EMPTY_COUNTS, ...(a.counts || {}) }, r = riskOf(a, starterLens());
    return [a.name, a.email, attemptStatus(a)[0], fmtDateTime(a.startedAt), fmtDateTime(a.submittedAt),
      ...P.map((p, i) => g?.problems?.[i]?.score ?? ""), g?.total ?? "", g?.max ?? "", g?.max ? Math.round(100 * g.total / g.max) : "",
      r, riskLabel(r)[0], c.tab, c.tabSec, c.blur, c.blurSec, c.fs, c.paste, c.copy, c.burst, c.offline, a.env?.extended ? "Yes" : "No"];
  });
  const csv = [head, ...rows].map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
  const el = document.createElement("a"); el.href = url; el.download = `${S.aid}-results.csv`; el.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};
