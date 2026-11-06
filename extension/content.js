// X Queue Replies: adds a Draft button to every post on X. Claude writes 3-5 replies,
// you pick or edit one, and it goes into X's reply box. You press Reply on X yourself.
(() => {
  if (window.__xqLoaded) return;
  window.__xqLoaded = true;

  const LIMIT = 280;
  const ICON =
    '<svg viewBox="0 0 24 24" width="18.75" height="18.75" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5z"/><path d="M12 6.4l.9 2.2 2.2.9-2.2.9-.9 2.2-.9-2.2-2.2-.9 2.2-.9z" fill="currentColor" stroke-width="1"/></svg>';

  // ---------- reading posts ----------

  function readPost(article) {
    const timeEl = article.querySelector('a[href*="/status/"] time');
    const link = timeEl ? timeEl.closest("a") : null;
    let m = link ? (link.getAttribute("href") || "").match(/^\/([^/]+)\/status\/(\d+)/) : null;
    if (!m) m = location.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
    if (!m) return null;
    const textEl = article.querySelector('[data-testid="tweetText"]');
    const nameEl = article.querySelector('[data-testid="User-Name"] span');
    return {
      tweet_id: m[2],
      author_username: m[1],
      author_name: nameEl ? nameEl.innerText.trim() : null,
      text: textEl ? textEl.innerText.trim() : "",
      posted_at: timeEl ? timeEl.getAttribute("datetime") : null,
      truncated: !!article.querySelector('[data-testid="tweet-text-show-more-link"]'),
    };
  }

  function findArticle(tweetId) {
    for (const a of document.querySelectorAll('article[data-testid="tweet"]')) {
      const p = readPost(a);
      if (p && p.tweet_id === tweetId) return a;
    }
    return null;
  }

  // ---------- Draft buttons in each post's action bar ----------

  function addButton(article) {
    if (article.dataset.xq) return;
    const groups = article.querySelectorAll('div[role="group"]');
    const bar = groups[groups.length - 1];
    if (!bar || !bar.querySelector('[data-testid="reply"]')) return;
    article.dataset.xq = "1";
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;align-items:center;";
    const b = document.createElement("button");
    b.type = "button";
    b.title = "Draft a reply with Claude";
    b.setAttribute("aria-label", "Draft a reply with Claude");
    b.innerHTML = ICON;
    b.style.cssText =
      "all:unset;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:999px;color:rgb(113,118,123);transition:background .15s,color .15s;";
    b.addEventListener("mouseenter", () => {
      b.style.color = "rgb(29,155,240)";
      b.style.background = "rgba(29,155,240,.1)";
    });
    b.addEventListener("mouseleave", () => {
      b.style.color = "rgb(113,118,123)";
      b.style.background = "transparent";
    });
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const post = readPost(article);
      if (post) openPanel(post);
    });
    wrap.appendChild(b);
    bar.appendChild(wrap);
  }

  function scan() {
    document.querySelectorAll('article[data-testid="tweet"]:not([data-xq])').forEach(addButton);
  }
  new MutationObserver(() => scan()).observe(document.body, { childList: true, subtree: true });
  scan();

  // ---------- panel ----------

  let host, root, state;

  const CSS = `
  :host{all:initial}
  *{box-sizing:border-box}
  .p{position:fixed;top:16px;right:16px;width:380px;max-width:calc(100vw - 32px);max-height:calc(100vh - 32px);overflow:auto;
     background:#101010;color:#ededed;border:1px solid #2a2a2a;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.5);
     font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;z-index:2147483647;padding:14px}
  .h{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}
  .t{font-weight:650;font-size:15px}
  .x{all:unset;cursor:pointer;width:28px;height:28px;display:grid;place-items:center;border-radius:8px;color:#a0a0a0;font-size:18px}
  .x:hover,.x:focus-visible{background:#1f1f1f;color:#fff}
  .post{background:#171717;border-radius:10px;padding:10px 12px;margin-bottom:12px}
  .who{font-size:12.5px;color:#a0a0a0;margin-bottom:4px}
  .txt{display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap}
  .warn{font-size:12px;color:#d6a64a;margin-top:6px}
  .opts{display:flex;flex-direction:column;gap:8px;margin-bottom:12px}
  .opt{all:unset;cursor:pointer;display:block;border:1px solid #2a2a2a;border-radius:10px;padding:9px 11px;white-space:pre-wrap}
  .opt:hover{border-color:#444}
  .opt:focus-visible{outline:2px solid #1d9bf0;outline-offset:1px}
  .opt[aria-checked="true"]{border-color:#1d9bf0;background:rgba(29,155,240,.08)}
  .ang{display:block;font-size:11px;font-weight:650;text-transform:uppercase;letter-spacing:.04em;color:#8a8a8a;margin-bottom:3px}
  .opt[aria-checked="true"] .ang{color:#5cb8f5}
  .lbl{display:flex;justify-content:space-between;font-size:12px;color:#a0a0a0;margin-bottom:4px}
  .over{color:#f4212e}
  textarea,input{width:100%;background:#0b0b0b;color:#ededed;border:1px solid #2a2a2a;border-radius:10px;padding:9px 11px;font:inherit;resize:vertical}
  textarea:focus,input:focus{outline:none;border-color:#1d9bf0}
  .row{display:flex;gap:8px;margin-top:10px}
  .row input{flex:1}
  .btn{all:unset;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:8px 14px;border-radius:999px;
       border:1px solid #333;font-weight:600;font-size:13.5px;white-space:nowrap}
  .btn:hover{background:#1c1c1c}
  .btn:focus-visible{outline:2px solid #1d9bf0;outline-offset:2px}
  .btn[disabled]{opacity:.45;cursor:default;pointer-events:none}
  .pri{background:#ededed;color:#0b0b0b;border-color:#ededed}
  .pri:hover{background:#fff}
  .acts{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
  .msg{font-size:12.5px;color:#a0a0a0;margin-top:10px}
  .err{color:#f4212e}
  .ok{color:#00ba7c}
  .sk{height:58px;border-radius:10px;background:linear-gradient(90deg,#181818,#222,#181818);background-size:200% 100%;animation:s 1.2s infinite}
  @keyframes s{to{background-position:-200% 0}}
  @media (prefers-reduced-motion:reduce){.sk{animation:none}}
  `;

  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v);
    }
    for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  }

  function closePanel() {
    if (host) host.remove();
    host = root = null;
    state = null;
    document.removeEventListener("keydown", onKey, true);
  }

  function onKey(e) {
    if (e.key === "Escape" && host && e.composedPath().includes(host)) closePanel();
  }

  function openPanel(post) {
    closePanel();
    host = document.createElement("div");
    host.id = "xq-panel";
    root = host.attachShadow({ mode: "open" });
    document.body.appendChild(host);
    document.addEventListener("keydown", onKey, true);
    state = { post, id: null, drafts: [], choice: 0, text: "", steer: "", loading: false, error: "", note: "", busy: false, fallback: false };
    if (!post.text) {
      state.error = "This post has no text to reply to.";
      render();
      return;
    }
    draft();
  }

  function send(body) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "xq", body }, (r) => {
          if (chrome.runtime.lastError) resolve({ error: "Extension was reloaded. Refresh this tab." });
          else resolve(r || { error: "No response" });
        });
      } catch {
        resolve({ error: "Extension was reloaded. Refresh this tab." });
      }
    });
  }

  async function draft() {
    const mine = state;
    state.loading = true;
    state.error = "";
    state.note = "";
    render();
    const { truncated, ...post } = mine.post;
    const r = await send({ action: "draft", post, steer: mine.steer });
    if (state !== mine) return; // panel was closed or replaced
    state.loading = false;
    if (r.error) state.error = r.error;
    else {
      state.id = r.id;
      state.drafts = r.drafts || [];
      state.choice = 0;
      state.text = state.drafts[0] ? state.drafts[0].text : "";
    }
    render();
  }

  function count(s) {
    // X counts most emoji and CJK characters as 2.
    let n = 0;
    for (const ch of s) n += /[\u1100-\uffff]/.test(ch) || ch.codePointAt(0) > 0xffff ? 2 : 1;
    return n;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitFor(fn, ms = 4000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(80);
    }
    return null;
  }

  const norm = (t) => (t || "").replace(/[\u200b-\u200d\ufeff]/g, "").replace(/\s+/g, " ").trim();
  const holds = (ed, text) => ed.isConnected && norm(ed.innerText) === norm(text);

  // Opens X's reply box for this post. Returns the editor and its send button,
  // or null when it can't be sure the box belongs to this post.
  async function openComposer(tweetId) {
    const article = findArticle(tweetId);
    if (!article) return null;
    const before = new Set(document.querySelectorAll('[role="dialog"]'));
    const replyBtn = article.querySelector('[data-testid="reply"]');
    if (!replyBtn) return null;
    replyBtn.click();
    const dlg = await waitFor(
      () =>
        Array.from(document.querySelectorAll('[role="dialog"]')).find(
          (d) => !before.has(d) && d.querySelector('[data-testid="tweetTextarea_0"]'),
        ),
      2500,
    );
    if (dlg) {
      return {
        ed: dlg.querySelector('[data-testid="tweetTextarea_0"]'),
        sendBtn: () => dlg.querySelector('[data-testid="tweetButton"]'),
      };
    }
    // On the post's own page X may focus the reply box under it instead of opening a dialog.
    if (location.pathname.includes(`/status/${tweetId}`)) {
      const ed = document.querySelector('[data-testid="tweetTextarea_0"]');
      if (ed) {
        return {
          ed,
          sendBtn: () =>
            document.querySelector('[data-testid="tweetButtonInline"]') || document.querySelector('[data-testid="tweetButton"]'),
        };
      }
    }
    return null;
  }

  function selectAll(ed) {
    ed.focus();
    const r = document.createRange();
    r.selectNodeContents(ed);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }

  // Replaces whatever is in the box with text. Every attempt replaces the whole
  // selection, so the text can never end up in the box twice.
  async function fill(ed, text) {
    selectAll(ed);
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    ed.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    if (await waitFor(() => holds(ed, text), 1500)) return true;
    selectAll(ed);
    const active = document.activeElement;
    if (!(active === ed || ed.contains(active))) return false;
    document.execCommand("insertText", false, text);
    return !!(await waitFor(() => holds(ed, text), 1500));
  }

  // X's other post boxes (the "What's happening" box on the home feed) must never keep
  // a reply. Empties any box outside the reply dialog that holds this text.
  async function clearLeftovers(text) {
    for (const ed of document.querySelectorAll('[data-testid="tweetTextarea_0"]')) {
      if (!holds(ed, text)) continue;
      selectAll(ed);
      document.execCommand("delete");
      if (holds(ed, text)) {
        selectAll(ed);
        document.execCommand("insertText", false, "");
      }
    }
  }

  // After "Edit on X": waits until the reply dialog closes, then records the reply
  // (only if X confirmed it was sent) and tidies up any leftover copy of the text.
  async function watchManualSend(mine, c, text) {
    let sentToast = false;
    const end = Date.now() + 10 * 60 * 1000;
    while (Date.now() < end && c.ed.isConnected && norm(c.ed.innerText) !== "") {
      await sleep(400);
    }
    sentToast = !!(await waitFor(
      () =>
        Array.from(document.querySelectorAll('[data-testid="toast"], [role="alert"]')).some((t) =>
          /sent|posted/i.test(t.innerText || ""),
        ),
      4000,
    ));
    await clearLeftovers(text);
    if (sentToast && mine.id) send({ action: "replied", id: mine.id, text });
    if (state === mine && sentToast) {
      mine.note = "Replied on X.";
      render();
      setTimeout(() => state === mine && closePanel(), 1500);
    }
  }

  async function insert(andSend) {
    const text = state.text.trim();
    if (!text || state.busy) return;
    const mine = state;
    mine.busy = true;
    mine.error = "";
    mine.note = andSend ? "Replying\u2026" : "Opening the reply box\u2026";
    render();

    const fail = (msg) => {
      mine.busy = false;
      mine.note = "";
      mine.error = msg;
      mine.fallback = true;
      if (state === mine) render();
    };

    const c = await openComposer(mine.post.tweet_id);
    if (!c) return fail("Couldn't open X's reply box for this post. Scroll it into view and try again, or use Open on X.");
    if (!(await fill(c.ed, text))) return fail("X didn't accept the text. Try again, or use Copy and paste it in.");

    if (!andSend) {
      mine.busy = false;
      mine.note = "In the reply box. Check it and press Reply on X.";
      if (state === mine) render();
      watchManualSend(mine, c, text);
      return;
    }

    const btn = await waitFor(() => {
      const b = c.sendBtn();
      return b && !b.disabled && b.getAttribute("aria-disabled") !== "true" ? b : null;
    }, 3000);
    if (!btn) return fail("X's Reply button stayed disabled. The text is in the box, press Reply there.");
    if (!holds(c.ed, text)) return fail("The reply box changed before sending. Check it and press Reply on X.");
    btn.click();
    const sent = await waitFor(() => !c.ed.isConnected || norm(c.ed.innerText) === "", 10000);
    if (!sent) return fail("X didn't confirm the reply. Check the reply box before trying again.");

    if (mine.id) send({ action: "replied", id: mine.id, text });
    mine.busy = false;
    await clearLeftovers(text);
    mine.note = "Replied.";
    if (state !== mine) return;
    render();
    setTimeout(() => state === mine && closePanel(), 1500);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(state.text);
      state.note = "Copied.";
    } catch {
      state.note = "Couldn't copy. Select the text instead.";
    }
    render();
  }

  function render() {
    if (!root) return;
    const s = state;
    const len = count(s.text);
    const kids = [];

    kids.push(
      el("div", { class: "h" },
        el("span", { class: "t" }, "Reply drafts"),
        el("button", { class: "x", "aria-label": "Close", title: "Close (Esc)", onclick: closePanel }, "\u00d7"),
      ),
      el("div", { class: "post" },
        el("div", { class: "who" }, `${s.post.author_name ? s.post.author_name + " " : ""}@${s.post.author_username}`),
        el("div", { class: "txt" }, s.post.text || "(no text)"),
        s.post.truncated ? el("div", { class: "warn" }, "X shortened this post. Open it for the full text if the drafts miss the point.") : null,
      ),
    );

    if (s.loading) {
      kids.push(el("div", { class: "opts", "aria-busy": "true" }, el("div", { class: "sk" }), el("div", { class: "sk" }), el("div", { class: "sk" })));
      kids.push(el("div", { class: "msg", role: "status" }, "Claude is writing\u2026"));
    } else if (s.drafts.length) {
      kids.push(
        el("div", { class: "opts", role: "radiogroup", "aria-label": "Reply options" },
          s.drafts.map((d, i) =>
            el("button", {
              class: "opt",
              role: "radio",
              "aria-checked": String(i === s.choice),
              onclick: () => {
                s.choice = i;
                s.text = d.text;
                s.note = "";
                render();
              },
            },
            el("span", { class: "ang" }, d.angle || `Option ${i + 1}`),
            d.text),
          ),
        ),
      );
      const ta = el("textarea", { rows: "3", "aria-label": "Your reply" });
      ta.value = s.text;
      ta.addEventListener("input", () => {
        s.text = ta.value;
        const c = root.querySelector(".cnt");
        c.textContent = `${count(s.text)}/${LIMIT}`;
        c.classList.toggle("over", count(s.text) > LIMIT);
        const bad = !s.text.trim() || count(s.text) > LIMIT;
        root.querySelectorAll(".acts .send").forEach((b) => b.toggleAttribute("disabled", bad));
      });
      kids.push(
        el("label", { class: "lbl" }, el("span", {}, "Your reply"), el("span", { class: `cnt${len > LIMIT ? " over" : ""}` }, `${len}/${LIMIT}`)),
        ta,
      );
    }

    if (!s.loading && s.post.text) {
      const steer = el("input", { placeholder: "Steer it: shorter, more contrarian, add a stat\u2026", "aria-label": "Note for Claude" });
      steer.value = s.steer;
      steer.addEventListener("input", () => (s.steer = steer.value));
      steer.addEventListener("keydown", (e) => {
        if (e.key === "Enter") draft();
      });
      kids.push(el("div", { class: "row" }, steer, el("button", { class: "btn", onclick: draft }, s.drafts.length ? "Redraft" : "Try again")));
    }

    if (s.drafts.length && !s.loading) {
      const off = !s.text.trim() || len > LIMIT || s.busy ? "" : null;
      kids.push(
        el("div", { class: "acts" },
          el("button", { class: "btn", onclick: copy, disabled: s.busy ? "" : null }, "Copy"),
          el("button", { class: "btn send", onclick: () => insert(false), disabled: off, title: "Put it in X's reply box so you can edit it there" }, "Edit on X"),
          el("button", { class: "btn pri send", onclick: () => insert(true), disabled: off, title: "Post this reply now" }, "Reply"),
        ),
      );
      if (s.fallback && !s.busy) {
        kids.push(
          el("div", { class: "acts" },
            el("a", {
              class: "btn",
              href: `https://x.com/intent/post?in_reply_to=${s.post.tweet_id}&text=${encodeURIComponent(s.text.trim())}`,
              target: "_blank",
              rel: "noopener",
            }, "Open on X"),
          ),
        );
      }
    }

    if (s.error) kids.push(el("div", { class: "msg err", role: "alert" }, s.error));
    if (s.note) kids.push(el("div", { class: "msg ok", role: "status" }, s.note));

    const focusedIdx = Array.from(root.querySelectorAll(".opt")).indexOf(root.activeElement);
    root.replaceChildren(el("style", {}, CSS), el("div", { class: "p", role: "dialog", "aria-label": "Reply drafts" }, kids));
    if (focusedIdx >= 0) root.querySelectorAll(".opt")[focusedIdx]?.focus();
  }
})();
