/* Orion Pad — runs your own copy of Master of Orion II (DOS) in js-dos on iPad.
 * No game files are part of this app: the user loads their own zip once,
 * it is kept in IndexedDB on the device, and saves are kept alongside it.
 */
(() => {
  "use strict";

  // ---------------------------------------------------------------- helpers
  const $ = (sel) => document.querySelector(sel);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const fmtMB = (n) => (n / 1048576).toFixed(0) + " MB";

  function toast(msg, ms = 2200) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("show"), ms);
  }

  // ---------------------------------------------------------------- settings
  const DEFAULTS = { scale: "sharp", cycles: "auto", longpress: "450", rbtn: "1", launch: "game" };
  function loadSettings() {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem("orionpad.settings") || "{}") }; }
    catch { return { ...DEFAULTS }; }
  }
  function saveSettings() {
    try { localStorage.setItem("orionpad.settings", JSON.stringify(settings)); } catch { /* private mode */ }
  }
  const settings = loadSettings();

  function applyScale() {
    document.body.classList.toggle("px-sharp", settings.scale === "sharp");
    document.body.classList.toggle("px-smooth", settings.scale === "smooth");
  }

  // ---------------------------------------------------------------- IndexedDB
  const DB_NAME = "orionpad";
  const STORE = "kv";
  let dbPromise = null;

  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }
  async function idbGet(key) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const req = d.transaction(STORE, "readonly").objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbSet(key, value) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  async function idbDel(key) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ---------------------------------------------------------------- zip scan
  // Reads the zip's central directory (no decompression) to find ORION2.EXE.
  function listZipNames(buf) {
    const dv = new DataView(buf);
    const len = buf.byteLength;
    const minPos = Math.max(0, len - 65557);
    let eocd = -1;
    for (let i = len - 22; i >= minPos; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("This file is not a valid .zip.");
    let count = dv.getUint16(eocd + 10, true);
    let off = dv.getUint32(eocd + 16, true);
    if (off === 0xffffffff || count === 0xffff) {
      throw new Error("Zip64 archives aren't supported. Zip the game folder with a standard zip tool.");
    }
    const dec = new TextDecoder("utf-8");
    const names = [];
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(off, true) !== 0x02014b50) break;
      const nameLen = dv.getUint16(off + 28, true);
      const extraLen = dv.getUint16(off + 30, true);
      const commentLen = dv.getUint16(off + 32, true);
      names.push(dec.decode(new Uint8Array(buf, off + 46, nameLen)));
      off += 46 + nameLen + extraLen + commentLen;
    }
    return names;
  }

  const DOS_83 = /^[A-Z0-9_\-!#$%&'(){}@^~]{1,8}(\.[A-Z0-9_\-!#$%&'(){}@^~]{1,3})?$/;

  function findGameDir(names) {
    const hits = names
      .map((n) => n.replace(/\\/g, "/"))
      .filter((n) => !n.startsWith("__MACOSX/"))
      .filter((n) => n.split("/").pop().toUpperCase() === "ORION2.EXE")
      .sort((a, b) => a.split("/").length - b.split("/").length);
    if (!hits.length) {
      throw new Error("ORION2.EXE was not found in this zip. Zip the contents of the game folder (the files themselves).");
    }
    const parts = hits[0].split("/").slice(0, -1);
    for (const p of parts) {
      if (!DOS_83.test(p.toUpperCase())) {
        throw new Error(
          `The game is inside the folder "${p}", whose name is too long for DOS. ` +
          "Open the game folder, select all files inside it and zip those instead."
        );
      }
    }
    return parts.map((p) => p.toUpperCase()).join("\\"); // "" when at the zip root
  }

  // ---------------------------------------------------------------- dosbox.conf
  function buildConf(dir) {
    const cycles =
      settings.cycles === "auto" ? "auto" :
      settings.cycles === "max" ? "max" : `fixed ${settings.cycles}`;
    const run =
      settings.launch === "game150" ? "ORION150.EXE" :
      settings.launch === "setup" ? "SETSOUND.EXE" :
      settings.launch === "prompt" ? "" : "ORION2.EXE";
    return [
      "[sdl]",
      "autolock=false",
      "fullscreen=false",
      "",
      "[dosbox]",
      "machine=svga_s3",
      "memsize=32",
      "",
      "[render]",
      "aspect=false",
      "",
      "[cpu]",
      "core=auto",
      "cputype=auto",
      `cycles=${cycles}`,
      "",
      "[mixer]",
      "rate=44100",
      "blocksize=2048",
      "prebuffer=40",
      "",
      "[sblaster]",
      "sbtype=sb16",
      "sbbase=220",
      "irq=7",
      "dma=1",
      "hdma=5",
      "oplmode=auto",
      "",
      "[dos]",
      "xms=true",
      "ems=true",
      "umb=true",
      "",
      "[autoexec]",
      "mount c .",
      "c:",
      dir ? `cd \\${dir}` : "",
      run,
      "",
    ].join("\n");
  }

  // ---------------------------------------------------------------- state
  let game = null;        // { name, size, dir, stored }
  let dosProps = null;    // js-dos instance
  let ci = null;          // js-dos CommandInterface
  let autosaveTimer = null;
  let playing = false;

  // ---------------------------------------------------------------- home UI
  async function refreshStatus() {
    const st = $("#status");
    try {
      game = await idbGet("game-meta");
      const saves = await idbGet("saves-meta");
      if (game) {
        let txt = `Game ready: ${game.name} (${fmtMB(game.size)})` +
          (game.dir ? ` · folder ${game.dir}` : "");
        txt += saves ? ` · saves stored ${new Date(saves.at).toLocaleString()}` : " · no saves yet";
        st.textContent = txt;
        st.className = "status ok";
        $("#play-btn").disabled = false;
        $("#load-text").textContent = "Replace game .zip";
      } else {
        st.textContent = "No game loaded yet. Tap “Load game .zip” and pick your MOO2 zip from the Files app.";
        st.className = "status";
        $("#play-btn").disabled = true;
        $("#load-text").textContent = "Load game .zip";
      }
    } catch (e) {
      st.textContent = "Storage is unavailable: " + e.message + " (Private Browsing doesn't keep data.)";
      st.className = "status err";
    }
  }

  async function onZipChosen(file) {
    if (!file) return;
    const st = $("#status");
    st.textContent = `Reading ${file.name}…`;
    st.className = "status";
    try {
      const buf = await file.arrayBuffer();
      const dir = findGameDir(listZipNames(buf));
      st.textContent = "Storing on this iPad…";
      await idbSet("game-zip", buf);
      await idbSet("game-meta", { name: file.name, size: buf.byteLength, dir, at: Date.now() });
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
      toast("Game stored. Tap Play.");
    } catch (e) {
      st.textContent = e.message;
      st.className = "status err";
      return;
    }
    await refreshStatus();
  }

  // ---------------------------------------------------------------- saves
  async function saveNow(quiet = true) {
    if (!ci || typeof ci.persist !== "function") return false;
    try {
      const changes = await ci.persist(true);
      if (changes && changes.byteLength) {
        // copy into a standalone buffer before storing
        await idbSet("saves-zip", changes.slice().buffer);
        await idbSet("saves-meta", { at: Date.now(), size: changes.byteLength });
        if (!quiet) toast("Saved to iPad");
        return true;
      }
      if (!quiet) toast("Nothing new to save");
    } catch (e) {
      if (!quiet) toast("Save failed: " + e.message, 3500);
    }
    return false;
  }

  async function exportSaves() {
    const buf = await idbGet("saves-zip");
    if (!buf) { toast("No saves stored yet"); return; }
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    const file = new File([buf], `orionpad-saves-${stamp}.zip`, { type: "application/zip" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: "Orion Pad saves" }); return; }
      catch (e) { if (e.name === "AbortError") return; }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  async function importSaves(file) {
    if (!file) return;
    if (!confirm("Replace the saves stored on this iPad with this file?")) return;
    try {
      const buf = await file.arrayBuffer();
      listZipNames(buf); // validates it is a zip
      await idbSet("saves-zip", buf);
      await idbSet("saves-meta", { at: Date.now(), size: buf.byteLength });
      toast("Saves imported");
    } catch (e) {
      toast("Import failed: " + e.message, 3500);
    }
    await refreshStatus();
  }

  // ---------------------------------------------------------------- boot / quit
  async function play() {
    if (playing) return;
    if (typeof window.Dos !== "function") {
      toast("The emulator hasn't loaded. Check your connection once and try again.", 4000);
      return;
    }
    const meta = await idbGet("game-meta");
    const zip = await idbGet("game-zip");
    if (!meta || !zip) { await refreshStatus(); return; }
    const saves = await idbGet("saves-zip");

    playing = true;
    $("#home").hidden = true;
    $("#stage").hidden = false;
    updateOrientation();
    applyScale();

    const initFs = [new Uint8Array(zip)];
    if (saves) initFs.push(new Uint8Array(saves));

    ci = null;
    dosProps = window.Dos($("#dos"), {
      dosboxConf: buildConf(meta.dir),
      initFs,
      autoStart: true,
      kiosk: true,
      noCloud: true,
      mouseCapture: false,
      onEvent: (event, arg) => {
        if (event === "ci-ready") {
          ci = arg;
          clearInterval(autosaveTimer);
          autosaveTimer = setInterval(() => saveNow(true), 90000);
        }
      },
    });
  }

  async function quit() {
    closeMenu();
    toast("Saving…");
    await saveNow(true);
    clearInterval(autosaveTimer);
    try { if (dosProps && dosProps.stop) await dosProps.stop(); } catch { /* ignore */ }
    dosProps = null;
    ci = null;
    playing = false;
    releaseAll();
    $("#dos").innerHTML = "";
    $("#stage").hidden = true;
    $("#home").hidden = false;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    updateOrientation();
    await refreshStatus();
  }

  // ---------------------------------------------------------------- input → DOSBox
  // js-dos/DOSBox mouse buttons: 0 = left, then right/middle (configurable).
  const BTN_LEFT = 0;
  const btnRight = () => Number(settings.rbtn) || 1;
  const btnMiddle = () => (btnRight() === 1 ? 2 : 1);

  function mapBrowserButton(b) {
    if (b === 0) return BTN_LEFT;
    if (b === 2) return btnRight();
    if (b === 1) return btnMiddle();
    return null;
  }

  // Converts screen coordinates to 0..1 coordinates of the 4:3 game picture.
  function toGame(clientX, clientY) {
    const canvas = $("#dos canvas");
    const r = (canvas || $("#dos")).getBoundingClientRect();
    const fw = Math.min(r.width, (r.height * 4) / 3);
    const fh = (fw * 3) / 4;
    const ox = r.left + (r.width - fw) / 2;
    const oy = r.top + (r.height - fh) / 2;
    return [clamp01((clientX - ox) / fw), clamp01((clientY - oy) / fh)];
  }

  function moveTo(x, y) {
    if (!ci) return;
    const [gx, gy] = toGame(x, y);
    ci.sendMouseMotion(gx, gy);
  }
  function button(b, down) {
    if (ci && b !== null) ci.sendMouseButton(b, down);
  }

  // Touch gesture state
  const touches = new Map(); // pointerId -> {x0, y0, x, y}
  let longTimer = null;
  let leftHeld = false;
  let rightHeld = false;
  let multi = false;
  let multiStart = 0;
  let multiMoved = false;
  const mouseHeld = new Set();
  const DRAG_PX = 12;

  function releaseAll() {
    clearTimeout(longTimer);
    if (leftHeld) button(BTN_LEFT, false);
    if (rightHeld) button(btnRight(), false);
    for (const b of mouseHeld) button(b, false);
    mouseHeld.clear();
    touches.clear();
    leftHeld = rightHeld = multi = false;
  }

  function onDown(e) {
    e.preventDefault();
    const layer = e.currentTarget;
    try { layer.setPointerCapture(e.pointerId); } catch { /* ignore */ }

    if (e.pointerType === "mouse") {
      moveTo(e.clientX, e.clientY);
      const b = mapBrowserButton(e.button);
      if (b !== null) { mouseHeld.add(b); button(b, true); }
      return;
    }

    // touch or pencil
    touches.set(e.pointerId, { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY });

    if (touches.size >= 2) {
      // Second finger: this becomes a two-finger gesture, cancel single-finger actions.
      clearTimeout(longTimer);
      if (leftHeld) { button(BTN_LEFT, false); leftHeld = false; }
      if (rightHeld) { button(btnRight(), false); rightHeld = false; }
      if (!multi) { multi = true; multiStart = performance.now(); multiMoved = false; }
      return;
    }

    moveTo(e.clientX, e.clientY);
    clearTimeout(longTimer);
    longTimer = setTimeout(() => {
      if (!leftHeld && !multi && touches.size === 1) {
        rightHeld = true;
        button(btnRight(), true);
        if (navigator.vibrate) navigator.vibrate(10);
      }
    }, Number(settings.longpress) || 450);
  }

  function onMove(e) {
    e.preventDefault();
    if (e.pointerType === "mouse") { moveTo(e.clientX, e.clientY); return; }

    const t = touches.get(e.pointerId);
    if (!t) return;
    t.x = e.clientX;
    t.y = e.clientY;
    const dist = Math.hypot(t.x - t.x0, t.y - t.y0);

    if (multi) { if (dist > 20) multiMoved = true; return; }

    if (!leftHeld && !rightHeld && dist > DRAG_PX) {
      // Start a left-button drag from where the finger went down (sliders, scrollbars).
      clearTimeout(longTimer);
      moveTo(t.x0, t.y0);
      leftHeld = true;
      button(BTN_LEFT, true);
    }
    if (leftHeld || rightHeld) moveTo(t.x, t.y);
  }

  async function onUp(e) {
    e.preventDefault();
    if (e.pointerType === "mouse") {
      moveTo(e.clientX, e.clientY);
      const b = mapBrowserButton(e.button);
      if (b !== null && mouseHeld.has(b)) { mouseHeld.delete(b); button(b, false); }
      return;
    }

    const t = touches.get(e.pointerId);
    touches.delete(e.pointerId);
    if (!t) return;

    if (multi) {
      if (touches.size === 0) {
        multi = false;
        if (!multiMoved && performance.now() - multiStart < 350) sendKey(KEY.Escape);
      }
      return;
    }

    clearTimeout(longTimer);
    if (rightHeld) {
      button(btnRight(), false);
      rightHeld = false;
    } else if (leftHeld) {
      moveTo(t.x, t.y);
      button(BTN_LEFT, false);
      leftHeld = false;
    } else {
      // Plain tap: hold the button briefly so the DOS game's polling sees it.
      moveTo(t.x, t.y);
      button(BTN_LEFT, true);
      await sleep(60);
      button(BTN_LEFT, false);
    }
  }

  function onCancel() { releaseAll(); }

  // ---------------------------------------------------------------- keyboard → DOSBox
  // js-dos uses GLFW key codes.
  const KEY = { Escape: 256, Enter: 257 };
  const CODE_MAP = (() => {
    const m = {
      Space: 32, Quote: 39, Comma: 44, Minus: 45, Period: 46, Slash: 47,
      Semicolon: 59, Equal: 61, BracketLeft: 91, Backslash: 92, BracketRight: 93, Backquote: 96,
      Escape: 256, Enter: 257, Tab: 258, Backspace: 259, Insert: 260, Delete: 261,
      ArrowRight: 262, ArrowLeft: 263, ArrowDown: 264, ArrowUp: 265,
      PageUp: 266, PageDown: 267, Home: 268, End: 269, CapsLock: 280,
      ShiftLeft: 340, ControlLeft: 341, AltLeft: 342,
      ShiftRight: 344, ControlRight: 345, AltRight: 346,
      NumpadDecimal: 330, NumpadDivide: 331, NumpadMultiply: 332,
      NumpadSubtract: 333, NumpadAdd: 334, NumpadEnter: 335,
    };
    for (let i = 0; i < 10; i++) { m["Digit" + i] = 48 + i; m["Numpad" + i] = 320 + i; }
    for (let i = 0; i < 26; i++) m["Key" + String.fromCharCode(65 + i)] = 65 + i;
    for (let i = 1; i <= 12; i++) m["F" + i] = 289 + i;
    return m;
  })();

  function sendKey(code) {
    if (!ci) return;
    if (typeof ci.simulateKeyPress === "function") ci.simulateKeyPress(code);
    else { ci.sendKeyEvent(code, true); setTimeout(() => ci && ci.sendKeyEvent(code, false), 60); }
  }

  function onKey(e) {
    if (!playing || !ci || !$("#menu").hidden) return;
    const code = CODE_MAP[e.code];
    if (code === undefined) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type === "keydown" && e.repeat && code >= 340) return;
    ci.sendKeyEvent(code, e.type === "keydown");
  }

  // ---------------------------------------------------------------- menu
  function openMenu() { releaseAll(); $("#menu").hidden = false; }
  function closeMenu() { $("#menu").hidden = true; }

  function toggleFullscreen() {
    const el = document.documentElement;
    const isFs = document.fullscreenElement || document.webkitFullscreenElement;
    if (isFs) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else {
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (req) req.call(el).catch?.(() => toast("Fullscreen isn't available here — use Add to Home Screen."));
      else toast("Use Share → Add to Home Screen for fullscreen.");
    }
  }

  async function onMenuAction(act) {
    switch (act) {
      case "esc": closeMenu(); sendKey(KEY.Escape); break;
      case "enter": closeMenu(); sendKey(KEY.Enter); break;
      case "fullscreen": closeMenu(); toggleFullscreen(); break;
      case "save": await saveNow(false); break;
      case "quit": await quit(); break;
      default: closeMenu();
    }
  }

  // ---------------------------------------------------------------- orientation
  function updateOrientation() {
    const portrait = window.innerHeight > window.innerWidth;
    document.body.classList.toggle("portrait", playing && portrait);
  }

  // ---------------------------------------------------------------- wiring
  function bindSetting(id, key, onChange) {
    const el = $(id);
    el.value = settings[key];
    el.addEventListener("change", () => {
      settings[key] = el.value;
      saveSettings();
      if (onChange) onChange();
    });
  }

  function init() {
    applyScale();
    bindSetting("#set-scale", "scale", applyScale);
    bindSetting("#set-cycles", "cycles");
    bindSetting("#set-longpress", "longpress");
    bindSetting("#set-rbtn", "rbtn");
    bindSetting("#set-launch", "launch");

    $("#zip-input").addEventListener("change", (e) => { onZipChosen(e.target.files[0]); e.target.value = ""; });
    $("#import-input").addEventListener("change", (e) => { importSaves(e.target.files[0]); e.target.value = ""; });
    $("#play-btn").addEventListener("click", play);
    $("#export-btn").addEventListener("click", exportSaves);
    $("#forget-btn").addEventListener("click", async () => {
      if (!confirm("Remove the game zip from this iPad? Saves are kept unless you also clear them.")) return;
      await idbDel("game-zip");
      await idbDel("game-meta");
      if (confirm("Also delete the stored saves? (Export them first if you want to keep them.)")) {
        await idbDel("saves-zip");
        await idbDel("saves-meta");
      }
      await refreshStatus();
    });

    const layer = $("#touch-layer");
    layer.addEventListener("pointerdown", onDown);
    layer.addEventListener("pointermove", onMove);
    layer.addEventListener("pointerup", onUp);
    layer.addEventListener("pointercancel", onCancel);
    layer.addEventListener("contextmenu", (e) => e.preventDefault());
    // Stop iOS from scrolling, zooming or selecting during play
    ["touchstart", "touchmove", "gesturestart"].forEach((t) =>
      layer.addEventListener(t, (e) => e.preventDefault(), { passive: false }));

    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);

    $("#menu-btn").addEventListener("click", openMenu);
    $("#menu").addEventListener("click", (e) => {
      const act = e.target.closest("button")?.dataset.act;
      if (act) onMenuAction(act);
      else if (e.target.id === "menu") closeMenu();
    });

    window.addEventListener("resize", updateOrientation);
    window.addEventListener("orientationchange", updateOrientation);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden" && playing) saveNow(true);
    });
    window.addEventListener("pagehide", () => { if (playing) saveNow(true); });

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }

    refreshStatus();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
