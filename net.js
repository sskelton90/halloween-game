// Connects the TV page and the phone controllers directly to each other (PeerJS).
// The TV "hosts" under a short 4-letter code that it keeps for the whole visit,
// so when the TV switches game (or goes back to the games list) the phones follow it.
window.Net = (() => {
  const LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ";
  const newCode = () => Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join("");
  const peerId = (game, code) => `familyparty-${game}-${code}`.toLowerCase();
  const GAMES = ["bubble", "pumpkin", "race", "knock", "potion", "peek", "monster"];
  const KEY = "familyparty-tv-code";

  function savedCode() { try { const c = sessionStorage.getItem(KEY); return c && /^[A-Z]{4}$/.test(c) ? c : null; } catch (e) { return null; } }
  function saveCode(c) { try { sessionStorage.setItem(KEY, c); } catch (e) {} }
  const isTv = () => !!savedCode();

  function pageFor(target, code, asTv) {
    const file = target === "menu" ? "index.html" : `${target}.html`;
    return `${file}?${asTv ? "tv=1" : "join=" + code}`;
  }

  let current = null; // the TV's host connection, if this page is the TV

  function host(game, { onMessage, onJoin, onLeave, onReady, onProblem } = {}) {
    const conns = new Set();
    let peer, code = savedCode() || newCode(), tries = 0;
    function start() {
      peer = new Peer(peerId(game, code));
      peer.on("open", () => { tries = 0; saveCode(code); onReady && onReady(code); });
      peer.on("connection", (c) => {
        c.on("open", () => { conns.add(c); onJoin && onJoin(c); });
        c.on("data", (d) => {
          if (!d || typeof d !== "object") return;
          if (d.t === "menu" && game !== "menu") { api.goto("menu"); return; }
          onMessage && onMessage(d, c);
        });
        const gone = () => { if (conns.delete(c)) onLeave && onLeave(c); };
        c.on("close", gone); c.on("error", gone);
      });
      peer.on("disconnected", () => setTimeout(() => { try { if (!peer.destroyed) peer.reconnect(); } catch (e) {} }, 2000));
      peer.on("error", (e) => {
        if (e.type === "unavailable-id") {
          // The old page may still be letting go of this code: try it again for a bit, then pick a new one.
          peer.destroy();
          if (++tries > 6) { code = newCode(); tries = 0; }
          setTimeout(start, 1500);
          return;
        }
        onProblem && onProblem(e.type);
      });
    }
    start();
    const api = {
      broadcast(m) { conns.forEach((c) => { try { c.send(m); } catch (e) {} }); },
      send(c, m) { try { c.send(m); } catch (e) {} },
      count() { return conns.size; },
      // Send every phone to `target` ("menu" or a game), then take the TV there too.
      goto(target) {
        if (target !== "menu" && !GAMES.includes(target)) return;
        api.broadcast({ t: "goto", to: target });
        setTimeout(() => { try { peer.destroy(); } catch (e) {} location.href = pageFor(target, code, true); }, 400);
      },
    };
    current = api;
    return api;
  }

  function join(game, code, { onMessage, onStatus } = {}) {
    const peer = new Peer();
    let conn = null, open = false, timer = 0;
    const status = (s) => onStatus && onStatus(s);
    function retry(ms) { clearTimeout(timer); timer = setTimeout(connect, ms); }
    function connect() {
      if (peer.destroyed) return;
      if (peer.disconnected) { try { peer.reconnect(); } catch (e) {} return; }
      status("connecting");
      const c = peer.connect(peerId(game, code), { reliable: true });
      conn = c;
      c.on("open", () => { if (conn !== c) return; open = true; status("open"); });
      c.on("data", (d) => {
        if (!d || typeof d !== "object") return;
        if (d.t === "goto" && (d.to === "menu" || GAMES.includes(d.to))) {
          try { peer.destroy(); } catch (e) {}
          location.href = pageFor(d.to, code, false); return;
        }
        onMessage && onMessage(d);
      });
      const drop = () => { if (conn !== c) return; open = false; status("lost"); retry(1500); };
      c.on("close", drop); c.on("error", drop);
    }
    peer.on("open", connect);
    peer.on("disconnected", () => setTimeout(() => { try { if (!peer.destroyed) peer.reconnect(); } catch (e) {} }, 1500));
    peer.on("error", (e) => {
      open = false;
      if (e.type === "peer-unavailable") { status("notfound"); retry(1500); }
      else { status("lost"); retry(2500); }
    });
    return {
      send(m) { if (conn && open) { try { conn.send(m); } catch (e) {} } },
      isOpen() { return open; },
      menu() { if (conn && open) { try { conn.send({ t: "menu" }); } catch (e) {} } },
    };
  }

  function joinUrl(code) {
    const u = new URL(location.href);
    u.search = "?join=" + code; u.hash = "";
    return u.toString();
  }
  function qrSvg(text) {
    const q = qrcode(0, "M"); q.addData(text); q.make();
    return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }
  function codeFromUrl() {
    const v = new URLSearchParams(location.search).get("join");
    return v && /^[A-Za-z]{4}$/.test(v) ? v.toUpperCase() : null;
  }
  const tvFromUrl = () => new URLSearchParams(location.search).get("tv") === "1";

  // Corner card on the TV: QR code + code letters
  function joinCard(code) {
    let card = document.getElementById("joinCard");
    if (!card) { card = document.createElement("div"); card.id = "joinCard"; document.body.appendChild(card); }
    card.innerHTML = `<div class="jc-qr">${qrSvg(joinUrl(code))}</div><div class="jc-text"><div class="jc-label">Scan to play</div><div class="jc-code">${code}</div><div class="jc-count" id="jcCount">No phones yet</div></div>`;
  }
  function setCount(n) {
    const el = document.getElementById("jcCount");
    if (el) el.textContent = n ? `${n} phone${n > 1 ? "s" : ""} joined` : "No phones yet";
  }

  // "Back to the games" button for the TV: phones follow automatically.
  function tvMenuButton() {
    const bar = document.querySelector(".topbar");
    if (!bar || document.getElementById("menuBtn")) return;
    const b = document.createElement("button");
    b.id = "menuBtn"; b.className = "menu-btn"; b.textContent = "← Games";
    b.onclick = () => { if (current) current.goto("menu"); else location.href = "index.html"; };
    bar.insertBefore(b, bar.firstChild);
  }
  // Same thing from a phone: asks the TV to go back to the games.
  function padMenuButton(link) {
    const bar = document.querySelector(".pad-top");
    if (!bar || document.getElementById("gamesBtn")) return;
    const b = document.createElement("button");
    b.id = "gamesBtn"; b.className = "games-btn"; b.textContent = "🎮"; b.setAttribute("aria-label", "Change game");
    b.onclick = () => link.menu();
    bar.appendChild(b);
  }

  // Phone screen asking for the code when the QR wasn't scanned
  function askCode(onCode) {
    const box = document.createElement("section");
    box.className = "codebox";
    box.innerHTML = `<h2>Type the code on the TV</h2>
      <input id="codeInput" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text" aria-label="Code from the TV">
      <button id="codeGo">Join</button>
      <p id="codeErr" hidden>The code is 4 letters, shown under the QR code on the TV.</p>`;
    document.body.appendChild(box);
    const input = box.querySelector("#codeInput");
    const go = () => {
      const v = input.value.trim().toUpperCase();
      if (!/^[A-Z]{4}$/.test(v)) { box.querySelector("#codeErr").hidden = false; return; }
      box.remove(); onCode(v);
    };
    box.querySelector("#codeGo").onclick = go;
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    setTimeout(() => input.focus(), 50);
  }

  const css = document.createElement("style");
  css.textContent = `
#joinCard { position: fixed; z-index: 4; top: calc(12px + env(safe-area-inset-top, 0px)); right: max(12px, env(safe-area-inset-right, 0px));
  display: flex; align-items: center; gap: .8rem; padding: .6rem .9rem .6rem .6rem; border-radius: 22px;
  background: rgba(27, 15, 51, .75); border: 2px solid rgba(255, 246, 230, .3); color: #fff6e6; font-family: "Baloo 2", system-ui, sans-serif; }
#joinCard .jc-qr { width: clamp(90px, 11vw, 150px); background: #fff; border-radius: 12px; padding: 4px; line-height: 0; }
#joinCard .jc-qr svg { width: 100%; height: auto; display: block; }
#joinCard .jc-label { font-size: clamp(.9rem, 1.4vw, 1.2rem); opacity: .85; }
#joinCard .jc-code { font-size: clamp(1.8rem, 3.6vw, 3rem); font-weight: 800; letter-spacing: .12em; line-height: 1.05; color: #ffd23f; }
#joinCard .jc-count { font-size: clamp(.8rem, 1.2vw, 1rem); opacity: .8; }
.menu-btn { pointer-events: auto; font: 800 clamp(1rem, 1.8vw, 1.5rem) "Baloo 2", system-ui, sans-serif; color: #fff6e6; cursor: pointer;
  padding: .3rem 1.1rem; border-radius: 999px; border: 2px solid rgba(255, 246, 230, .4); background: rgba(27, 15, 51, .6); }
.menu-btn:focus-visible, .games-btn:focus-visible { outline: 4px solid #fff3b8; outline-offset: 3px; }
.games-btn { flex: none; font-size: 1.3rem; line-height: 1; padding: .35rem .6rem; border-radius: 999px; border: 1px solid rgba(255, 246, 230, .32); background: rgba(255, 246, 230, .12); cursor: pointer; }
.codebox { position: fixed; inset: 0; z-index: 9; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1rem;
  padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px));
  background: #1b0f33; color: #fff6e6; font-family: "Baloo 2", system-ui, sans-serif; text-align: center; }
.codebox h2 { margin: 0; font-size: 1.8rem; }
.codebox input { width: 6.2em; max-width: 100%; font: 800 3rem "Baloo 2", system-ui, sans-serif; letter-spacing: .2em; text-align: center; text-transform: uppercase;
  padding: .2rem .4rem; border-radius: 18px; border: 3px solid #ff8a1f; background: rgba(255,246,230,.1); color: #fff6e6; }
.codebox button { font: 800 1.6rem "Baloo 2", system-ui, sans-serif; padding: .4rem 2.4rem; border-radius: 999px; border: 0; background: #ff8a1f; color: #1b0f33; }
.codebox p { margin: 0; max-width: 30ch; opacity: .85; }
body.on-screen .moon { display: none; }
body.on-screen .topbar { justify-content: flex-start; align-items: center; gap: 1rem; box-sizing: border-box; padding-right: clamp(250px, 30vw, 400px); }
`;
  document.head.appendChild(css);

  return { host, join, joinCard, setCount, askCode, codeFromUrl, tvFromUrl, isTv, savedCode, tvMenuButton, padMenuButton, GAMES };
})();
