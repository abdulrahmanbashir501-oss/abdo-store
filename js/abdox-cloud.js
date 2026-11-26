/* ABDO X Cloud: one Google sign-in for the whole site, data kept in each user's own
   Google Drive hidden app folder (scope drive.appdata). Vanilla JS, no dependencies.
   API: ABDOX.auth.signIn/signOut/user/isSignedIn/onChange
        ABDOX.drive.read(ns)/write(ns,obj)
        ABDOX.sync.localStorage(ns,[keys],opts)   // zero-change sync for apps that use localStorage
        ABDOX.sync.object(ns,adapter)             // for apps with their own store
        ABDOX.widget()                            // small account pill */
(function () {
  "use strict";
  if (window.ABDOX) return;
  var SCOPE = "https://www.googleapis.com/auth/drive.appdata openid email profile";
  var AK = "abdox.auth";
  var subs = [], fids = {}, tc = null, tcId = "";
  function cid() { try { return (localStorage.getItem("abdox.clientId") || (window.ABDOX_CONFIG && ABDOX_CONFIG.clientId) || "").trim(); } catch (e) { return ""; } }
  function rd() { try { return JSON.parse(localStorage.getItem(AK)); } catch (e) { return null; } }
  function wr(o) { try { if (o) localStorage.setItem(AK, JSON.stringify(o)); else localStorage.removeItem(AK); } catch (e) {} fire(); }
  function fire() { subs.forEach(function (f) { try { f(); } catch (e) {} }); }
  window.addEventListener("storage", function (e) { if (e.key === AK) fire(); });
  function valid() { var a = rd(); return !!(a && a.token && Date.now() < a.exp); }
  function loadGsi() {
    return new Promise(function (res, rej) {
      if (window.google && google.accounts && google.accounts.oauth2) return res();
      var s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client";
      s.onload = res; s.onerror = function () { rej(new Error("offline")); }; document.head.appendChild(s);
    });
  }
  var auth = {
    configured: function () { return !!cid(); },
    isSignedIn: valid,
    user: function () { var a = rd(); return a ? { email: a.email, name: a.name } : null; },
    hadSession: function () { var a = rd(); return !!(a && a.email); },
    onChange: function (f) { subs.push(f); },
    signIn: function () {
      if (!cid()) return Promise.reject(new Error("no-client-id"));
      return loadGsi().then(function () {
        return new Promise(function (res, rej) {
          if (!tc || tcId !== cid()) {
            tcId = cid();
            tc = google.accounts.oauth2.initTokenClient({
              client_id: tcId, scope: SCOPE,
              callback: function (r) {
                if (r.error) return tc._rej(new Error(r.error));
                var prev = rd() || {};
                var a = { token: r.access_token, exp: Date.now() + ((r.expires_in || 3600) - 60) * 1000, email: prev.email, name: prev.name };
                wr(a);
                fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: "Bearer " + a.token } })
                  .then(function (x) { return x.ok ? x.json() : {}; })
                  .then(function (u) { a.email = u.email || a.email; a.name = u.name || a.name; wr(a); tc._res(a); })
                  .catch(function () { tc._res(a); });
              },
              error_callback: function (e) { tc._rej(new Error((e && e.type) || "error")); }
            });
          }
          tc._res = res; tc._rej = rej;
          var prev = rd();
          tc.requestAccessToken({ prompt: prev && prev.email ? "" : "consent", hint: prev && prev.email });
        });
      });
    },
    signOut: function () {
      var a = rd(); try { if (a && a.token && window.google) google.accounts.oauth2.revoke(a.token, function () {}); } catch (e) {}
      fids = {}; wr(null);
    }
  };
  function api(url, opt) {
    var a = rd(); if (!valid()) return Promise.reject(new Error("auth"));
    opt = opt || {}; opt.headers = Object.assign({ Authorization: "Bearer " + a.token }, opt.headers || {});
    return fetch(url, opt).then(function (r) {
      if (r.status === 401) { var x = rd(); if (x) { x.exp = 0; wr(x); } throw new Error("auth"); }
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r;
    });
  }
  var fname = function (ns) { return "abdox-" + ns + ".json"; };
  function findId(ns) {
    if (fids[ns]) return Promise.resolve(fids[ns]);
    var q = encodeURIComponent("name='" + fname(ns) + "'");
    return api("https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=" + q + "&fields=files(id)")
      .then(function (r) { return r.json(); }).then(function (j) { fids[ns] = j.files && j.files[0] ? j.files[0].id : null; return fids[ns]; });
  }
  var drive = {
    read: function (ns) {
      return findId(ns).then(function (id) {
        if (!id) return null;
        return api("https://www.googleapis.com/drive/v3/files/" + id + "?alt=media").then(function (r) { return r.json(); });
      });
    },
    write: function (ns, obj) {
      var body = JSON.stringify(obj);
      return findId(ns).then(function (id) {
        if (id) return api("https://www.googleapis.com/upload/drive/v3/files/" + id + "?uploadType=media", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: body });
        var b = "abdoxb" + Date.now();
        var mp = "--" + b + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify({ name: fname(ns), parents: ["appDataFolder"] }) +
          "\r\n--" + b + "\r\nContent-Type: application/json\r\n\r\n" + body + "\r\n--" + b + "--";
        return api("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", { method: "POST", headers: { "Content-Type": "multipart/related; boundary=" + b }, body: mp })
          .then(function (r) { return r.json(); }).then(function (j) { fids[ns] = j.id; });
      });
    }
  };
  /* generic adapter sync: adapter = {get(): obj, set(obj), updatedAt(): n, empty(): bool} */
  var state = {}; // per ns status
  function st(ns) { return state[ns] || (state[ns] = { s: "idle", last: 0, msg: "", timer: null }); }
  var sync = {
    status: function (ns) { return st(ns); },
    object: function (ns, ad) {
      var S = st(ns);
      function run() {
        if (!valid()) { S.s = "off"; fire(); return Promise.resolve("off"); }
        S.s = "busy"; fire();
        return drive.read(ns).then(function (remote) {
          var out;
          if (remote && (remote.updatedAt || 0) > (ad.updatedAt() || 0) || (remote && ad.empty())) { ad.set(remote); out = "pulled"; }
          else if (!remote && ad.empty()) { out = "nothing"; }
          else return drive.write(ns, ad.get()).then(function () { return "pushed"; });
          return out;
        }).then(function (o) { S.s = "ok"; S.last = Date.now(); S.msg = ""; fire(); return o; })
          .catch(function (e) { S.s = "err"; S.msg = e.message; fire(); return "err"; });
      }
      var api2 = {
        now: run,
        changed: function () { if (!valid()) return; clearTimeout(S.timer); S.timer = setTimeout(run, 4000); }
      };
      auth.onChange(function () { if (valid() && S.s !== "busy" && !S.started) { S.started = true; run(); } if (!valid()) S.started = false; });
      if (valid()) { S.started = true; run(); }
      return api2;
    },
    /* sync plain localStorage keys with zero changes to the app */
    localStorage: function (ns, keys, opts) {
      opts = opts || {};
      var TS = "abdox.ts." + ns, SY = "abdox.synced." + ns, BK = "abdox.bak." + ns;
      var ts = function () { return Number(localStorage.getItem(TS) || 0); };
      var has = function () { return keys.some(function (k) { return localStorage.getItem(k) != null; }); };
      var S = st(ns), t = null, applying = false, pending = valid(), dirtyEarly = false;
      var origSet = Storage.prototype.setItem, origRem = Storage.prototype.removeItem;
      var setTs = function (n) { try { origSet.call(localStorage, TS, String(n)); } catch (e) {} };
      function touched() {
        if (applying) return;
        if (pending) { dirtyEarly = true; return; }
        setTs(Math.max(Date.now(), ts() + 1)); if (valid()) { clearTimeout(t); t = setTimeout(run, 5000); }
      }
      Storage.prototype.setItem = function (k, v) { origSet.call(this, k, v); if (this === window.localStorage && keys.indexOf(k) >= 0) touched(); };
      Storage.prototype.removeItem = function (k) { origRem.call(this, k); if (this === window.localStorage && keys.indexOf(k) >= 0) touched(); };
      function payload() { var items = {}; keys.forEach(function (k) { var v = localStorage.getItem(k); if (v != null) items[k] = v; }); return { updatedAt: ts() || Date.now(), items: items }; }
      function run() {
        if (!valid()) { S.s = "off"; fire(); return Promise.resolve(); }
        S.s = "busy"; fire();
        return drive.read(ns).then(function (remote) {
          var firstEver = !localStorage.getItem(SY);
          var usable = remote && remote.items && Object.keys(remote.items).length;
          if (usable && ((remote.updatedAt || 0) > ts() || !has() || firstEver)) {
            if (has() && firstEver) { var bak = {}; keys.forEach(function (k) { var v = localStorage.getItem(k); if (v != null) bak[k] = v; }); origSet.call(localStorage, BK, JSON.stringify(bak)); }
            applying = true;
            try { Object.keys(remote.items).forEach(function (k) { if (keys.indexOf(k) >= 0) origSet.call(localStorage, k, remote.items[k]); }); setTs(remote.updatedAt || Date.now()); } finally { applying = false; }
            dirtyEarly = false; origSet.call(localStorage, SY, "1");
            if (opts.onRemote) opts.onRemote(); else banner();
          } else {
            if (dirtyEarly) { setTs(Date.now()); dirtyEarly = false; }
            origSet.call(localStorage, SY, "1");
            if (has()) return drive.write(ns, payload());
          }
        }).then(function () { pending = false; S.s = "ok"; S.last = Date.now(); S.msg = ""; fire(); })
          .catch(function (e) { pending = false; S.s = "err"; S.msg = e.message; fire(); });
      }
      function banner() {
        var d = document.createElement("div");
        d.style.cssText = "position:fixed;top:10px;inset-inline:10px;margin:auto;max-width:420px;z-index:2147483000;background:#E32636;color:#fff;font:600 14px Cairo,Tahoma,sans-serif;padding:10px 14px;border-radius:12px;text-align:center;cursor:pointer;box-shadow:0 8px 30px #0008";
        d.textContent = "\u2601 بياناتك اتحدّثت من Google Drive. اضغط لإعادة التحميل"; d.onclick = function () { location.reload(); };
        document.body.appendChild(d);
      }
      auth.onChange(function () { if (valid() && !S.started) { S.started = true; pending = true; run(); } if (!valid()) S.started = false; });
      if (valid()) { S.started = true; run(); }
      return { now: run };
    }
  };
  /* small account pill */
  function widget(ns) {
    if (!cid() || document.getElementById("abdoxPill")) return;
    var b = document.createElement("button"); b.id = "abdoxPill";
    b.style.cssText = "position:fixed;bottom:12px;inset-inline-start:12px;z-index:2147482000;background:#14141c;color:#fff;border:1px solid #E32636;border-radius:99px;padding:7px 13px;font:600 12px Cairo,Tahoma,sans-serif;cursor:pointer;box-shadow:0 6px 24px #0007;max-width:70vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
    function paint() {
      var u = auth.user(), S = ns ? st(ns) : null;
      b.textContent = valid() ? "☁ " + (u && u.email ? u.email : "متصل") + (S && S.s === "busy" ? " · ..." : S && S.s === "err" ? " · ⚠" : "") : (auth.hadSession() ? "☁ سجّل دخول تاني" : "☁ سجّل دخول بجوجل");
    }
    b.onclick = function () {
      if (valid()) { if (confirm("تسجيل الخروج من ABDO X؟")) auth.signOut(); }
      else auth.signIn().catch(function () {});
    };
    auth.onChange(paint); paint(); document.body.appendChild(b);
  }
  window.ABDOX = { auth: auth, drive: drive, sync: sync, widget: widget, _cid: cid };
})();
