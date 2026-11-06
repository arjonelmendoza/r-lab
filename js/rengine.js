// R engine: webR running in the browser (WebAssembly). No server needed.
import { WEBR_URL } from "./config.js";

const HARNESS = String.raw`
.rlab_env <- function(setup, seed) {
  e <- new.env(parent = globalenv())
  assign(".seed", seed, envir = e)
  if (nzchar(setup)) eval(parse(text = setup), envir = e)
  e
}
.rlab_run <- function(code, e) {
  tryCatch({
    setTimeLimit(elapsed = 20, transient = TRUE)
    withCallingHandlers(
      source(exprs = parse(text = code), local = e, print.eval = TRUE, echo = FALSE),
      warning = function(w) { message("Warning: ", conditionMessage(w)); invokeRestart("muffleWarning") }
    )
  }, error = function(x) message("Error: ", conditionMessage(x)))
  setTimeLimit(elapsed = Inf)
  invisible(NULL)
}
.rlab_grade <- function(setup, code, tests, seed) {
  ref <- .rlab_env(setup, seed)
  e <- .rlab_env(setup, seed)
  grDevices::pdf(NULL)
  on.exit(try(grDevices::dev.off(), silent = TRUE), add = TRUE)
  err <- ""
  out <- utils::capture.output({
    err <- tryCatch({
      setTimeLimit(elapsed = 15, transient = TRUE)
      source(exprs = parse(text = code), local = e, print.eval = TRUE, echo = FALSE)
      ""
    }, error = function(x) conditionMessage(x))
  }, type = "output")
  setTimeLimit(elapsed = Inf)
  assign(".ref", ref, envir = e)
  assign(".output", paste(out, collapse = "\n"), envir = e)
  assign(".code", code, envir = e)
  pass <- vapply(as.character(tests), function(t) {
    isTRUE(tryCatch(eval(parse(text = t), envir = e), error = function(x) FALSE))
  }, logical(1), USE.NAMES = FALSE)
  list(error = err, pass = pass)
}
`;

let webR = null;
let readyP = null;
let queue = Promise.resolve();
const installed = new Set();

export function loadR(onStatus = () => {}) {
  if (readyP) return readyP;
  readyP = (async () => {
    onStatus("Loading R engine (first time can take ~20 s)…");
    const { WebR } = await import(WEBR_URL);
    webR = new WebR();
    await webR.init();
    await webR.evalRVoid(HARNESS);
    onStatus("R is ready");
    return webR;
  })();
  readyP.catch(() => { readyP = null; });
  return readyP;
}

const pkgPromises = new Map();
export function ensurePackages(pkgs = [], onStatus = () => {}) {
  const key = pkgs.map(p => p.trim()).filter(Boolean).sort().join(",");
  if (!pkgPromises.has(key)) {
    const p = installPkgs(pkgs, onStatus);
    pkgPromises.set(key, p);
    p.catch(() => pkgPromises.delete(key));
  }
  return pkgPromises.get(key);
}
async function installPkgs(pkgs, onStatus) {
  await loadR(onStatus);
  const need = pkgs.map(p => p.trim()).filter(p => p && !installed.has(p));
  if (!need.length) return;
  onStatus("Installing R packages: " + need.join(", ") + "…");
  await serial(async () => {
    await webR.installPackages(need, { quiet: true });
    for (const p of need) {
      await webR.evalRVoid(`suppressPackageStartupMessages(library(${p}))`);
      installed.add(p);
    }
  });
  onStatus("R is ready");
}

function serial(fn) {
  const p = queue.then(fn, fn);
  queue = p.catch(() => {});
  return p;
}

/** Run code like the R console. Returns { lines:[{type,text}], images:[ImageBitmap] } */
export function runCode({ setup = "", code = "", seed = 1 }) {
  return serial(async () => {
    const sh = await new webR.Shelter();
    try {
      await webR.evalRVoid('assign(".rlab_cur", .rlab_env(setup, seed), envir = globalenv())',
        { env: { setup, seed } });
      const r = await sh.captureR(".rlab_run(code, .rlab_cur)", {
        env: { code }, withAutoprint: false, captureStreams: true, captureConditions: false,
        captureGraphics: { width: 640, height: 420 },
      });
      return {
        lines: r.output.map(o => ({ type: o.type, text: String(o.data) })),
        images: r.images || [],
      };
    } catch (e) {
      return { lines: [{ type: "stderr", text: "Error: " + (e?.message || e) }], images: [] };
    } finally {
      try { await sh.purge(); } catch {}
    }
  });
}

/** Grade code against test expressions. Returns { error, pass:[bool] } */
export function gradeCode({ setup = "", code = "", tests = [], seed = 1 }) {
  return serial(async () => {
    if (!tests.length) return { error: "", pass: [] };
    const sh = await new webR.Shelter();
    try {
      const r = await sh.evalR(".rlab_grade(setup, code, tests, seed)",
        { env: { setup, code, tests, seed } });
      const js = await r.toJs();
      const err = js.values[0].values[0] || "";
      const pass = (js.values[1].values || []).map(Boolean);
      return { error: err, pass };
    } catch (e) {
      return { error: String(e?.message || e), pass: tests.map(() => false) };
    } finally {
      try { await sh.purge(); } catch {}
    }
  });
}
