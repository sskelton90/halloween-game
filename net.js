// Connects the TV page and the phone controllers directly to each other (PeerJS).
// The TV "hosts" under a short 4-letter code; phones "join" that code.
window.Net = (() => {
  const LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ";
  const newCode = () => Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join("");
  const peerId = (game, code) => `familyparty-${game}-${code}`.toLowerCase();

  function host(game, { onMessage, onJoin, onLeave, onReady, onProblem } = {}) {
    const conns = new Set();
    let peer;
    function start() {
      const code = newCode();
      peer = new Peer(peerId(game, code));
      peer.on("open", () => onReady && onReady(code));
      peer.on("connection", (c) => {
        c.on("open", () => { conns.add(c); onJoin && onJoin(c); });
        c.on("data", (d) => { if (d && typeof d === "object") onMessage && onMessage(d, c); });
        const gone = () => { if (conns.delete(c)) onLeave && onLeave(c); };
        c.on("close", gone); c.on("error", gone);
      });
      peer.on("disconnected", () => setTimeout(() => { try { if (!peer.destroyed) peer.reconnect(); } catch (e) {} }, 2000));
      peer.on("error", (e) => {
        if (e.type === "unavailable-id") { peer.destroy(); start(); return; }
        onProblem && onProblem(e.type);
      });
    }
    start();
    return {
      broadcast(m) { conns.forEach((c) => { try { c.send(m); } catch (e) {} }); },
      send(c, m) { try { c.send(m); } catch (e) {} },
      count() { return conns.size; },
    };
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
      c.on("data", (d) => { if (d && typeof d === "object") onMessage && onMessage(d); });
      const drop = () => { if (conn !== c) return; open = false; status("lost"); retry(2000); };
      c.on("close", drop); c.on("error", drop);
    }
    peer.on("open", connect);
    peer.on("disconnected", () => setTimeout(() => { try { if (!peer.destroyed) peer.reconnect(); } catch (e) {} }, 1500));
    peer.on("error", (e) => {
      if (e.type === "peer-unavailable") { open = false; status("notfound"); retry(3000); }
      else { open = false; status("lost"); retry(3000); }
    });
    return {
      send(m) { if (conn && open) { try { conn.send(m); } catch (e) {} } },
      isOpen() { return open; },
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
.codebox { position: fixed; inset: 0; z-index: 9; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1rem;
  padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px));
  background: #1b0f33; color: #fff6e6; font-family: "Baloo 2", system-ui, sans-serif; text-align: center; }
.codebox h2 { margin: 0; font-size: 1.8rem; }
.codebox input { width: 6.2em; max-width: 100%; font: 800 3rem "Baloo 2", system-ui, sans-serif; letter-spacing: .2em; text-align: center; text-transform: uppercase;
  padding: .2rem .4rem; border-radius: 18px; border: 3px solid #ff8a1f; background: rgba(255,246,230,.1); color: #fff6e6; }
.codebox button { font: 800 1.6rem "Baloo 2", system-ui, sans-serif; padding: .4rem 2.4rem; border-radius: 999px; border: 0; background: #ff8a1f; color: #1b0f33; }
.codebox p { margin: 0; max-width: 30ch; opacity: .85; }
body.on-screen .moon { display: none; }
`;
  document.head.appendChild(css);

  return { host, join, joinCard, setCount, askCode, codeFromUrl };
})();
