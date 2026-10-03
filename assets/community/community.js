// Community runtime shared by community.html, studio.html and profile.html:
// the API client, the sandboxed preview, and the component card.
//
// Security model: community code is untrusted. Every preview is an iframe with
// sandbox="allow-scripts" and no allow-same-origin, so it runs at an opaque
// origin: no cookies, no storage, no access to this page. A CSP inside the
// frame limits network access to esm.sh (React mode imports), and the API
// rejects cookie-authenticated writes whose Origin is not the site, so a
// preview cannot like, publish or spend AI quota as the viewer.
(function () {
  "use strict";

  var API = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
    ? "http://localhost:8787"
    : "https://api.transitions.dev";

  function call(path, method, body) {
    return fetch(API + path, {
      method: method || "GET",
      credentials: "include",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r.text().then(function (t) {
        var data = {};
        try { data = t ? JSON.parse(t) : {}; } catch (e) { data = { error: "bad_response" }; }
        if (!r.ok && !data.error) data.error = "http_" + r.status;
        data.__status = r.status;
        return data;
      });
    }).catch(function () { return { error: "network", __status: 0 }; });
  }

  // POST that answers with newline-delimited JSON: progress events go to
  // onEvent as they arrive, the { type: "result" } line resolves. Early
  // refusals (sign-in, quota, validation) still answer with plain JSON.
  function stream(path, body, onEvent) {
    return fetch(API + path, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (r) {
      if ((r.headers.get("content-type") || "").indexOf("ndjson") < 0 || !r.body) {
        return r.text().then(function (t) {
          var data = {};
          try { data = t ? JSON.parse(t) : {}; } catch (e) { data = { error: "bad_response" }; }
          if (!r.ok && !data.error) data.error = "http_" + r.status;
          return data;
        });
      }
      var reader = r.body.getReader();
      var dec = new TextDecoder();
      var buf = "";
      var result = null;
      function line(l) {
        l = l.trim();
        if (!l) return;
        var m;
        try { m = JSON.parse(l); } catch (e) { return; }
        if (m.type === "result") { delete m.type; result = m; }
        else if (onEvent) { try { onEvent(m); } catch (e) {} }
      }
      return (function pump() {
        return reader.read().then(function (chunk) {
          if (chunk.done) { line(buf); return result || { error: "generation_failed" }; }
          buf += dec.decode(chunk.value, { stream: true });
          var parts = buf.split("\n");
          buf = parts.pop();
          parts.forEach(line);
          return pump();
        });
      })();
    }).catch(function () { return { error: "network" }; });
  }

  var api = {
    feed: function (sort, offset) { return call("/community/feed?sort=" + (sort || "recent") + "&offset=" + (offset || 0)); },
    // view: true counts a visit (the Studio opening it); remix loads pass nothing.
    get: function (id, view) { return call("/community/c/" + encodeURIComponent(id) + (view ? "?view=1" : "")); },
    profile: function (handle) { return call("/community/u/" + encodeURIComponent(handle)); },
    me: function () { return call("/community/me"); },
    updateMe: function (fields) { return call("/community/me", "POST", fields); },
    create: function (c) { return call("/community/c", "POST", c); },
    update: function (id, c) { return call("/community/c/" + encodeURIComponent(id), "POST", c); },
    remove: function (id) { return call("/community/c/" + encodeURIComponent(id) + "/delete", "POST", {}); },
    like: function (id, liked) { return call("/community/c/" + encodeURIComponent(id) + "/like", "POST", { liked: liked }); },
    // A notice under the EU Digital Services Act: { category, reason, good_faith }.
    report: function (id, notice) { return call("/community/c/" + encodeURIComponent(id) + "/report", "POST", notice); },
    // The author of a hidden component asks for a review.
    appeal: function (id, message) { return call("/community/c/" + encodeURIComponent(id) + "/appeal", "POST", { message: message }); },
    // images: [{ media_type, data }] from attachments().items(); onEvent gets
    // the agent's progress ({ type: "status", phase, text, lines? } and
    // { type: "thought", text } pieces of its plan) while it works.
    // target: the element picked with Select ({ selector, tag, text, html }).
    generate: function (prompt, mode, current, context, images, onEvent, target) {
      return stream("/community/generate", { prompt: prompt, mode: mode, current: current || null, context: context || [], images: images || [], target: target || null }, onEvent);
    },
    skills: function () { return call("/community/skills"); },
    saveSkill: function (skill) { return call("/community/skills", "POST", skill); },
    deleteSkill: function (id) { return call("/community/skills/" + encodeURIComponent(id) + "/delete", "POST", {}); },
    designSystems: function () { return call("/community/design-systems"); },
    saveDesignSystem: function (ds) { return call("/community/design-systems", "POST", ds); },
    deleteDesignSystem: function (id) { return call("/community/design-systems/" + encodeURIComponent(id) + "/delete", "POST", {}); },
    // The agent writes a design system from screenshots and notes; streams
    // progress like generate() and resolves { ok, name, content } or { error }.
    extractDesignSystem: function (images, text, onEvent) {
      return stream("/community/design-systems/extract", { images: images || [], text: text || "" }, onEvent);
    },
  };

  // The API answers with paths (/avatar/...); resolve them against its base.
  function apiUrl(u) { return !u ? null : u.charAt(0) === "/" ? API + u : u; }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function siteTheme() {
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  // Signed in? Resolves once pro-client's own /me call has answered, so a
  // signed-in visitor is never shown the sign-in box while it is in flight.
  function auth() {
    var tp = window.TransitionsPro;
    if (!tp) return Promise.resolve({ authenticated: false });
    if (tp.state && tp.state.resolved) return Promise.resolve(tp.state);
    return new Promise(function (resolve) {
      var done = false;
      function finish() { if (done) return; done = true; resolve(tp.state); }
      document.addEventListener("pro:me", finish, { once: true });
      setTimeout(function () {
        if (done) return;
        (tp.refresh ? tp.refresh() : Promise.resolve()).then(finish, finish);
      }, 4000);
    });
  }

  // Run `fn` with an account, opening the community sign-in first if needed.
  function withAccount(fn) {
    var tp = window.TransitionsPro;
    if (!tp || !tp.joinCommunity) { fn(); return; }
    auth().then(function () { tp.joinCommunity(fn); });
  }

  // ── React mode: compile + imports ───────────────────────────────────────────
  // Sucrase only rewrites text (TSX to JS), so it runs here on the page; the
  // result executes inside the sandbox.
  var REACT = "19.1.0";
  var sucraseP = null;
  function loadSucrase() {
    if (!sucraseP) {
      sucraseP = import("https://esm.sh/sucrase@3.35.0?bundle").catch(function (e) {
        sucraseP = null;
        throw e;
      });
    }
    return sucraseP;
  }
  function compileReact(src) {
    return loadSucrase().then(function (s) {
      return s.transform(src, {
        transforms: ["typescript", "jsx"],
        jsxRuntime: "automatic",
        production: true,
        filePath: "Component.tsx",
      }).code;
    });
  }

  function bareImports(code) {
    var specs = {};
    var re = /\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;
    var m;
    while ((m = re.exec(code))) {
      var s = m[1] || m[2] || m[3];
      if (!s || /^(\.|\/|https?:|data:|blob:)/.test(s)) continue;
      specs[s] = true;
    }
    return Object.keys(specs);
  }

  // Preinstalled packages: the libraries.dev libraries, pinned so published
  // components keep working, built against the sandbox's own React (one copy,
  // or hooks break). Keep in sync with assets/community/libraries.json.
  var PREINSTALLED = {
    "border-beam": "1.4.1",
    "thinking-orbs": "0.3.2",
    "liquid-gooey": "0.2.2",
    "voice-glow": "0.2.1",
    "bot-avatars": "0.2.1",
    "metal-fx": "2.0.11",
    "img-fx": "0.5.1",
    "three": "0.170.0",
  };
  var EXTERNALS = { "img-fx": "react,react-dom,three" };

  // The libraries' free tier on libraries.dev: per package, the components
  // with the props and values a free user gets, and the free hooks and
  // helpers. Anything else (a Pro prop, value, component or engine setting)
  // is left out before it reaches the library, with a note in the console.
  // Generated by scripts/build-community-libraries.mjs from its `free` lists;
  // edit them there. Rules: an array lists the allowed values, { min, max } is
  // a number range, { any: [...] } a union, { keys: {...} } an object with
  // only those keys, and a type name ("boolean", "number", "string",
  // "function", "object") or "any".
  // <free-api>
  var FREE_API = {"border-beam":{"default":"BorderBeam","components":{"BorderBeam":{"size":["md","line","pulse-inner","pulse-outside"],"colorVariant":["colorful","mono"],"active":"boolean","theme":["dark","light","auto"]}}},"thinking-orbs":{"components":{"ThinkingOrb":{"state":["working","searching","solving","listening","connecting","composing","breathing"],"size":[64,20],"gravity":{"any":[false,null,{"keys":{"sprite":"object"}}]},"paused":"boolean","theme":["auto","dark","light"]}}},"liquid-gooey":{"components":{"Liquid":{"blur":{"min":0,"max":16},"contrast":{"min":4,"max":40},"fill":["#fff","#ffffff","#202020","#525252"],"shadow":"string","$statics":{"Item":{"effect":["morph","move","bend","melt"],"x":"number","y":"number","transition":{"any":[["snappy","smooth","bouncy"],{"keys":{"duration":"number","ease":"any"}}]},"delay":"number"}}}}},"voice-glow":{"default":"VoiceBeam","components":{"VoiceBeam":{"type":["default","mobile"],"stream":"any","level":"function","processing":"boolean","paused":"boolean","theme":["dark"]}},"allow":["useMicrophone","isAudioSupported"]},"bot-avatars":{"default":"BotAvatar","components":{"BotAvatar":{"type":["clover","flower","star","ghost","mech","circle","hexagon","square"],"state":["default","working"],"size":[96,64,32],"shading":["fabric","plastic"],"paused":"boolean"}}},"metal-fx":{"components":{"MetalFx":{"variant":["circle"],"preset":["chromatic"],"theme":["auto","dark","light"],"strength":[0.9],"innerShadow":"boolean","reflectionTargets":"any","disableGlow":"boolean","paused":"boolean","$require":{"variant":["circle"]}},"MetalText":{"font":"string","color":"string","strength":[0.9],"reflectionTargets":"any"}},"allow":["useMetalBend","useMetalTextReflection","isMetalFxSupported"],"fns":{"setCursorLightConfig":{"keys":{"cursor":[false,true]}}}},"img-fx":{"components":{"ImageGeneration":{"preset":["pixels-organic","pixels-mechanic","sweep-gradient"],"strength":{"min":0,"max":1},"images":{"any":["string","object"]},"autoReveal":"boolean","paused":"boolean"}}}};
  // </free-api>
  var LIB_NAMES = Object.keys(FREE_API);

  // Runs in the sandbox before the component's module: window.__tdevFree
  // wraps a library module so it only hands out its free tier.
  function freeGate() {
    return "(function(){var API=" + JSON.stringify(FREE_API) + ";var seen={};var own=Object.prototype.hasOwnProperty;" +
      "var PASS=/^(children|key|ref|className|style|id|role|tabIndex|title|hidden|aria-.+|data-.+|on[A-Z].*)$/;" +
      "function note(pkg,what){var m=pkg+': '+what+' is not in the libraries.dev free tier (it is a Pro option), so the preview leaves it out.';" +
      "if(seen[m])return;seen[m]=1;console.warn(m)}" +
      "function show(v){try{var s=JSON.stringify(v);return s&&s.length<40?'='+s:''}catch(e){return ''}}" +
      // clean(rule, value): the value if the free tier allows it (objects
      // trimmed to their free keys), or undefined.
      "function clean(r,v,pkg,at){if(r==='any')return{v:v};" +
        "if(Array.isArray(r))return r.indexOf(v)>=0?{v:v}:null;" +
        "if(r&&r.any){for(var i=0;i<r.any.length;i++){var c=clean(r.any[i],v,pkg,at);if(c)return c}return null}" +
        "if(r&&r.keys){if(!v||typeof v!=='object'||Array.isArray(v))return null;var o={};" +
          "for(var k in v){if(!own.call(v,k))continue;var c2=r.keys[k]===undefined?null:clean(r.keys[k],v[k],pkg,at+'.'+k);" +
          "if(c2)o[k]=c2.v;else note(pkg,at+'.'+k+show(v[k]))}return{v:o}}" +
        "if(r&&typeof r==='object')return typeof v==='number'&&v>=r.min&&v<=r.max?{v:v}:null;" +
        "if(r==='object')return v&&typeof v==='object'?{v:v}:null;return typeof v===r?{v:v}:null}" +
      "function wrap(R,pkg,name,C,spec){" +
        "var W=R.forwardRef(function(props,ref){var need=spec.$require||{};" +
        "for(var q in need){if(need[q].indexOf(props[q])<0){note(pkg,name+(props[q]===undefined?' without '+q+'='+JSON.stringify(need[q][0]):' '+q+show(props[q])));" +
        "return R.createElement(R.Fragment,null,props.children)}}" +
        "var p={};for(var k in props){if(!own.call(props,k))continue;" +
        "var v=props[k];if(PASS.test(k)||v===undefined){p[k]=v;continue}" +
        "var r=k.charAt(0)==='$'?undefined:spec[k];var c=r===undefined?null:clean(r,v,pkg,name+' '+k);" +
        "if(!c){note(pkg,name+' '+k+(r===undefined?'':show(v)));continue}p[k]=c.v}" +
        "if(ref)p.ref=ref;return R.createElement(C,p)});" +
        "var st=spec.$statics||{};for(var s in C){if(!own.call(C,s)||s==='displayName'||s==='$$typeof'||s==='render'||s==='propTypes'||s==='defaultProps')continue;" +
        "if(st[s])W[s]=wrap(R,pkg,name+'.'+s,C[s],st[s]);else W[s]=locked(R,pkg,name+'.'+s)}" +
        "W.displayName=name;return W}" +
      "function locked(R,pkg,name){if(/^use[A-Z]/.test(name))return function(){note(pkg,name)};" +
        "if(!/^[A-Z]/.test(name.split('.').pop()))return function(){note(pkg,name)};" +
        "return function(props){note(pkg,name);return R.createElement(R.Fragment,null,props&&props.children)}}" +
      "function fn(pkg,name,f,rule){return function(a){var c=clean(rule,a,pkg,name);if(!c){note(pkg,name+show(a));return}return f(c.v)}}" +
      "window.__tdevFree=function(R,pkg,mod){var api=API[pkg];if(!api)return mod;var out={};var comps=api.components||{};var allow=api.allow||[];var fns=api.fns||{};" +
        "Object.keys(mod).forEach(function(k){if(k==='default')return;var v=mod[k];" +
        "if(comps[k])out[k]=wrap(R,pkg,k,v,comps[k]);" +
        "else if(fns[k])out[k]=fn(pkg,k,v,fns[k]);" +
        "else if(allow.indexOf(k)>=0)out[k]=v;" +
        "else if(typeof v==='function'||(v&&typeof v==='object'&&v.$$typeof))out[k]=locked(R,pkg,k)});" +
        "if(api.default)out.default=out[api.default];return out};" +
    "})();";
  }

  // Routes the component's imports of a library through the free gate: any
  // version, subpath or esm.sh URL of it becomes the pinned package, read
  // through window.__tdevFree.
  function gateImports(code) {
    if (!LIB_NAMES.length) return code;
    var names = LIB_NAMES.map(function (n) { return n.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"); }).join("|");
    code = code.replace(new RegExp("([\"'])(?:https?://esm\\.sh/(?:v\\d+/)?)?(" + names + ")(?:@[^/\"']*)?(?:/[^\"']*)?\\1", "g"), function (all, q, name) {
      return q + name + q;
    });
    var n = 0;
    code = code.replace(new RegExp("\\bimport\\s+([^;'\"]+?)\\s+from\\s*([\"'])(" + names + ")\\2\\s*;?", "g"), function (all, clause, q, name) {
      var ns = "__tdevLib" + n++;
      var out = "import * as " + ns + "$ from " + JSON.stringify(name) + ";import " + ns + "R from \"react\";" +
        "const " + ns + "=window.__tdevFree(" + ns + "R," + JSON.stringify(name) + "," + ns + "$);";
      var rest = clause.trim();
      var def = /^([\w$]+)\s*(,|$)/.exec(rest);
      if (def) { out += "const " + def[1] + "=" + ns + ".default;"; rest = rest.slice(def[0].length).trim(); }
      var star = /^\*\s+as\s+([\w$]+)/.exec(rest);
      if (star) out += "const " + star[1] + "=" + ns + ";";
      var named = /\{([^}]*)\}/.exec(rest);
      if (named && named[1].trim()) out += "const {" + named[1].replace(/\bas\b/g, ":") + "}=" + ns + ";";
      return out;
    });
    return code.replace(new RegExp("\\bimport\\(\\s*([\"'])(" + names + ")\\1\\s*\\)", "g"), function (all, q, name) {
      return "Promise.all([import(" + JSON.stringify(name) + "),import(\"react\")]).then(function(a){return window.__tdevFree(a[1].default||a[1]," + JSON.stringify(name) + ",a[0])})";
    });
  }

  // "pkg", "pkg/sub", "@scope/pkg@1.2/sub" -> an esm.sh URL. Preinstalled
  // packages get their pinned version unless the import names one.
  function esmUrl(spec) {
    var m = spec.match(/^((?:@[^/]+\/)?[^/@]+)(@[^/]+)?(\/.*)?$/);
    if (!m) return "https://esm.sh/" + spec + "?external=react,react-dom";
    var name = m[1];
    var ver = m[2] ? m[2].slice(1) : PREINSTALLED[name];
    return "https://esm.sh/" + name + (ver ? "@" + ver : "") + (m[3] || "") +
      "?external=" + (EXTERNALS[name] || "react,react-dom");
  }

  function importMap(code) {
    var map = {
      "react": "https://esm.sh/react@" + REACT,
      "react/jsx-runtime": "https://esm.sh/react@" + REACT + "/jsx-runtime",
      "react-dom": "https://esm.sh/react-dom@" + REACT + "?external=react",
      "react-dom/client": "https://esm.sh/react-dom@" + REACT + "/client?external=react",
      "three": "https://esm.sh/three@" + PREINSTALLED.three,
    };
    bareImports(code).forEach(function (s) {
      if (!map[s]) map[s] = esmUrl(s);
    });
    return { imports: map };
  }

  // ── Sandbox document ────────────────────────────────────────────────────────
  // The stage fonts, Inter and Roboto Mono, are self-hosted (assets/fonts) like
  // on the rest of the site, so a preview never contacts Google. The frame runs
  // at an opaque origin, so the font URLs are absolute (this site's origin) and
  // font-src allows exactly that origin.
  var FONT_BASE = location.origin + "/assets/fonts/";
  var FONT_SUBSETS = [
    ["latin-ext", "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, " +
      "U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF"],
    ["latin", "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, " +
      "U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD"],
  ];
  function fontFaces(family, file, weights) {
    return weights.map(function (w) {
      return FONT_SUBSETS.map(function (s) {
        return "@font-face{font-family:'" + family + "';font-style:normal;font-weight:" + w + ";font-display:swap;" +
          "src:url('" + FONT_BASE + file + "-" + s[0] + ".woff2') format('woff2');unicode-range:" + s[1] + "}";
      }).join("");
    }).join("");
  }
  var FONT_CSS = fontFaces("Inter", "inter", [400, 500, 600]) + fontFaces("Roboto Mono", "roboto-mono", [400, 500]);

  var CSP = [
    "default-src 'none'",
    "script-src 'unsafe-inline' 'unsafe-eval' blob: https://esm.sh",
    "style-src 'unsafe-inline'",
    "font-src data: " + location.origin,
    "img-src data: blob: https://images.unsplash.com",
    "media-src data: blob:",
    "connect-src https://esm.sh",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");

  // Matches the library card stage, so a preview blends into the card.
  var STAGE_CSS =
    ":root{--stage-bg:#f9f9f9;--stage-fg:#0d0d0d;--stage-muted:#6c6c6c;--stage-border:rgba(0,0,0,.08);" +
    "--stage-surface:#fff;--stage-accent:#0073e5;--stage-on-accent:#fff;color-scheme:light}" +
    "html[data-theme=dark]{--stage-bg:#131313;--stage-fg:#f2f2f2;--stage-muted:rgba(202,202,202,.7);" +
    "--stage-border:rgba(255,255,255,.08);--stage-surface:#1d1d1d;--stage-accent:#55cfff;--stage-on-accent:#04131a;color-scheme:dark}" +
    "html,body{margin:0;height:100%}" +
    "body{background:var(--stage-bg);color:var(--stage-fg);display:grid;place-items:center;overflow:hidden;" +
    "font:14px/1.45 Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
    "-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}";

  // Reports errors (and, in the studio, console output) to the page, and
  // follows the site's light/dark switch without a reload.
  var BRIDGE =
    "(function(){function s(m){try{m.__tdev=1;parent.postMessage(m,'*')}catch(e){}}" +
    "window.__tdevSend=s;" +
    "addEventListener('error',function(e){s({type:'error',message:String(e.message||'Error'),line:e.lineno||0})});" +
    "addEventListener('unhandledrejection',function(e){var r=e.reason;s({type:'error',message:String(r&&r.message||r)})});" +
    "['log','warn','error'].forEach(function(k){var o=console[k];console[k]=function(){try{s({type:'console',level:k," +
    "text:[].map.call(arguments,function(a){try{return typeof a==='string'?a:JSON.stringify(a)}catch(e){return String(a)}}).join(' ').slice(0,2000)})}catch(e){}" +
    "return o.apply(console,arguments)}});" +
    // Select mode (Studio): hover outlines an element, a click picks it and
    // reports a selector, its text and markup. Clicks go nowhere else then.
    "var SEL=false,BOX=null,PICK=null;" +
    "function box(c){var b=document.createElement('div');b.setAttribute('data-tdev','');" +
    "b.style.cssText='position:fixed;z-index:2147483647;pointer-events:none;box-sizing:border-box;border-radius:4px;display:none;border:1.5px solid '+c+';background:'+c+'14';" +
    "document.documentElement.appendChild(b);return b}" +
    "function put(b,el){var r=el.getBoundingClientRect();b.style.display='block';b.style.left=(r.left-2)+'px';b.style.top=(r.top-2)+'px';b.style.width=(r.width+4)+'px';b.style.height=(r.height+4)+'px'}" +
    "function path(el){var p=[];while(el&&el.nodeType===1&&el!==document.body&&p.length<6){var t=el.tagName.toLowerCase();" +
    "if(el.id){p.unshift(t+'#'+el.id);break}" +
    "var c=[].filter.call(el.classList,function(x){return !/^(is|has)-/.test(x)}).slice(0,2);if(c.length)t+='.'+c.join('.');" +
    "var sib=el.parentElement?[].filter.call(el.parentElement.children,function(x){return x.tagName===el.tagName}):[];" +
    "if(sib.length>1)t+=':nth-of-type('+(sib.indexOf(el)+1)+')';p.unshift(t);el=el.parentElement}return p.join(' > ')}" +
    "function pick(on){SEL=on;document.documentElement.style.cursor=on?'crosshair':'';if(!BOX)BOX=box('#2f6bff');if(!on)BOX.style.display='none'}" +
    "addEventListener('mousemove',function(e){if(!SEL)return;var t=e.target;if(t&&t.nodeType===1&&!t.hasAttribute('data-tdev'))put(BOX,t)},true);" +
    "['click','mousedown','mouseup','pointerdown','pointerup','touchstart'].forEach(function(n){addEventListener(n,function(e){if(!SEL)return;" +
    "e.preventDefault();e.stopPropagation();if(n!=='click')return;var t=e.target;if(!PICK)PICK=box('#ff8a00');put(PICK,t);" +
    "s({type:'selected',selector:path(t),tag:t.tagName.toLowerCase(),text:(t.innerText||t.textContent||'').trim().replace(/\\s+/g,' ').slice(0,80),html:t.outerHTML.slice(0,1500)});pick(false)},true)});" +
    // Snapshot (Studio's Draw): the preview as a JPEG, via html-to-image.
    "function snap(){import('https://esm.sh/html-to-image@1.11.11').then(function(m){" +
    "return m.toJpeg(document.body,{quality:.92,pixelRatio:2,skipFonts:true,width:innerWidth,height:innerHeight," +
    "backgroundColor:getComputedStyle(document.body).backgroundColor,filter:function(n){return !(n.hasAttribute&&n.hasAttribute('data-tdev'))}})})" +
    ".then(function(u){s({type:'snapshot',url:u})},function(e){s({type:'snapshot',error:String(e&&e.message||e)})})}" +
    "addEventListener('message',function(e){var d=e.data;if(!d||!d.__tdev)return;" +
    "if(d.type==='theme')document.documentElement.setAttribute('data-theme',d.theme);" +
    "if(d.type==='css'){var st=document.getElementById('tdev-css');if(st)st.textContent=d.css}" +
    "if(d.type==='select'){pick(!!d.on);if(d.clear&&PICK)PICK.style.display='none'}" +
    "if(d.type==='snapshot')snap()});" +
    "})();";

  function scriptSafe(s) { return String(s).replace(/<\/script/gi, "<\\/script"); }

  function srcdoc(c, compiled, theme) {
    var head =
      '<!doctype html><html data-theme="' + (theme || "light") + '"><head><meta charset="utf-8">' +
      '<meta http-equiv="Content-Security-Policy" content="' + CSP + '">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      // The stage font, Inter, as on the site (self-hosted, see FONT_CSS).
      "<style>" + FONT_CSS + "</style>" +
      "<style>" + STAGE_CSS + "</style><script>" + BRIDGE + "</script>";
    if (c.mode === "react") {
      compiled = gateImports(compiled);
      return head +
        "<script>" + freeGate() + "</script>" +
        '<script type="importmap">' + scriptSafe(JSON.stringify(importMap(compiled))) + "</script>" +
        '<style id="tdev-css">' + scriptSafe(c.css || "") + "</style></head><body><div id=\"root\"></div>" +
        '<script type="module">' +
        "import React from 'react';import {createRoot} from 'react-dom/client';" +
        "const code=" + scriptSafe(JSON.stringify(compiled)) + ";" +
        "try{const u=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));const m=await import(u);" +
        "const C=m.default||Object.values(m).find(v=>typeof v==='function');" +
        "if(!C)throw new Error('Export a component: export default function MyComponent() { ... }');" +
        "createRoot(document.getElementById('root')).render(React.createElement(C));window.__tdevSend({type:'ready'});" +
        "}catch(e){window.__tdevSend({type:'error',message:String(e&&e.message||e)})}" +
        "</script></body></html>";
    }
    // A meta refresh would navigate the frame to a page without our CSP.
    var html = String(c.html || "").replace(/<meta\b[^>]*http-equiv[^>]*>/gi, "");
    return head +
      '<style id="tdev-css">' + scriptSafe(c.css || "") + "</style></head><body>" + html +
      "<script>" + scriptSafe(c.js || "") + "\n;window.__tdevSend({type:'ready'})</script></body></html>";
  }

  // Frames listen for theme changes; one observer serves every preview.
  var frames = new Set();
  new MutationObserver(function () {
    var t = siteTheme();
    frames.forEach(function (f) {
      if (!f.isConnected) { frames.delete(f); return; }
      try { f.contentWindow.postMessage({ __tdev: 1, type: "theme", theme: t }, "*"); } catch (e) {}
    });
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  // Messages from previews: only trusted when they come from a frame we made.
  var handlers = new WeakMap();
  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || !d.__tdev) return;
    frames.forEach(function (f) {
      if (f.contentWindow === e.source) {
        var h = handlers.get(f);
        if (h) h(d);
      }
    });
  });

  // Renders a component into `host` (replacing any previous preview).
  // opts.onMessage receives {type:'ready'|'error'|'console', ...}.
  function mountPreview(host, c, opts) {
    opts = opts || {};
    var token = (host.__cmToken || 0) + 1;
    host.__cmToken = token;
    var ready = c.mode === "react"
      ? compileReact(c.js || "").then(function (code) { return { code: code }; }, function (e) { return { err: e }; })
      : Promise.resolve({ code: "" });
    return ready.then(function (res) {
      if (host.__cmToken !== token) return null;
      var old = host.querySelector("iframe.cm-frame");
      var f = document.createElement("iframe");
      f.className = "cm-frame";
      f.setAttribute("sandbox", "allow-scripts");
      f.setAttribute("title", (c.title || "Component") + " preview");
      f.setAttribute("referrerpolicy", "no-referrer");
      // A preview gets exactly one document. A second load means the code
      // navigated the frame somewhere else (a page our CSP no longer
      // covers), so the frame is dropped instead of shown.
      var loads = 0;
      f.addEventListener("load", function () {
        loads++;
        if (loads === 1) { f.classList.add("is-loaded"); return; }
        frames.delete(f);
        f.remove();
        host.setAttribute("data-state", "error");
        if (opts.onMessage) opts.onMessage({ type: "error", message: "Previews cannot navigate to another page." });
      });
      handlers.set(f, function (m) {
        if (m.type === "ready") host.setAttribute("data-state", "ready");
        if (m.type === "error") host.setAttribute("data-state", "error");
        if (opts.onMessage) opts.onMessage(m);
      });
      frames.add(f);
      if (res.err) {
        var msg = String(res.err && res.err.message || res.err);
        f.srcdoc = srcdoc({ mode: "html", html: "", css: "", js: "" }, "", siteTheme());
        setTimeout(function () { if (opts.onMessage) opts.onMessage({ type: "error", message: msg }); }, 0);
        host.setAttribute("data-state", "error");
      } else {
        f.srcdoc = srcdoc(c, res.code, siteTheme());
      }
      host.appendChild(f);
      if (old) {
        // Swap only once the new frame has painted, so edits do not flash.
        f.addEventListener("load", function () { if (old.parentNode) old.remove(); frames.delete(old); }, { once: true });
        setTimeout(function () { if (old.parentNode) old.remove(); frames.delete(old); }, 1500);
      }
      return f;
    });
  }

  // Swap the preview's stylesheet in place, without reloading the frame: the
  // Motion tab drags durations and curves at frame rate this way.
  function pushCss(host, css) {
    var f = host && host.querySelector("iframe.cm-frame:last-of-type");
    if (!f || !f.contentWindow) return false;
    try { f.contentWindow.postMessage({ __tdev: 1, type: "css", css: String(css || "") }, "*"); return true; } catch (e) { return false; }
  }

  // Any message to the live preview frame (select mode, snapshot).
  function tellPreview(host, msg) {
    var f = host && host.querySelector("iframe.cm-frame:last-of-type");
    if (!f || !f.contentWindow) return false;
    try { msg.__tdev = 1; f.contentWindow.postMessage(msg, "*"); return true; } catch (e) { return false; }
  }

  function unmountPreview(host) {
    host.__cmToken = (host.__cmToken || 0) + 1;
    host.querySelectorAll("iframe.cm-frame").forEach(function (f) { frames.delete(f); f.remove(); });
    host.removeAttribute("data-state");
  }

  // Grid previews mount near the viewport and unmount far from it, so a long
  // feed never keeps dozens of live documents running at once.
  var lazy = new WeakMap();
  var io = "IntersectionObserver" in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      var c = lazy.get(en.target);
      if (!c) return;
      if (en.isIntersecting) {
        if (!en.target.querySelector("iframe.cm-frame")) mountPreview(en.target, c);
      } else {
        unmountPreview(en.target);
      }
    });
  }, { rootMargin: "400px 0px" }) : null;

  function lazyPreview(host, c) {
    lazy.set(host, c);
    if (io) io.observe(host); else mountPreview(host, c);
  }

  // ── Card ────────────────────────────────────────────────────────────────────
  function initials(a) {
    var n = (a && (a.display_name || a.handle)) || "?";
    return n.trim().charAt(0).toUpperCase();
  }

  function studioUrl(c) { return "studio.html?id=" + encodeURIComponent(c.id); }
  function profileUrl(handle) { return "profile.html?u=" + encodeURIComponent(handle); }

  // The library card (index / library pages): stage, title, subtitle, and the
  // bottom-right slot where the copy button sits, here the view count.
  var EYE = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M1.6 8.3C2.9 5.6 5.2 4 8 4s5.1 1.6 6.4 4.3a.7.7 0 0 1 0 .6C13.1 11.4 10.8 13 8 13s-5.1-1.6-6.4-4.1a.7.7 0 0 1 0-.6Z" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8.6" r="2" stroke="currentColor" stroke-width="1.4"/></svg>';
  function compact(n) {
    n = n || 0;
    return n < 1000 ? String(n) : n < 10000 ? (Math.round(n / 100) / 10) + "k" : Math.round(n / 1000) + "k";
  }
  function card(c, opts) {
    opts = opts || {};
    var el = document.createElement("article");
    el.className = "card cm-card";
    el.setAttribute("data-id", c.id);
    var a = c.author || {};
    // Subtitle: the author in the feed; on a profile (author known) the
    // status for the owner's drafts, otherwise the format.
    var sub = !c.published ? "Draft" : c.hidden ? "Hidden by moderation"
      : !opts.hideAuthor && a.handle ? (a.display_name || a.handle)
      : (c.mode === "react" ? "React" : "HTML/CSS");
    var subHtml = !opts.hideAuthor && a.handle && c.published && !c.hidden
      ? '<a class="card-subtitle cm-sub" href="' + esc(profileUrl(a.handle)) + '">' + esc(sub) + "</a>"
      : '<div class="card-subtitle cm-sub">' + esc(sub) + "</div>";
    // AI Act transparency: work the Studio's agent built or changed says so.
    if (c.ai) subHtml = subHtml.replace(/<\/(a|div)>$/, ' <span class="cm-ai-tag" title="Built or changed with the Studio\'s AI agent">AI-assisted</span></$1>');
    el.innerHTML =
      '<div class="card-stage cm-stage" data-cm-stage></div>' +
      '<div class="card-meta cm-meta">' +
        '<a class="card-title cm-title" href="' + esc(studioUrl(c)) + '">' + esc(c.title) + "</a>" +
        subHtml +
      "</div>" +
      (c.published && !c.hidden
        ? '<span class="cm-views" title="' + (c.views || 0) + (c.views === 1 ? " view" : " views") + '">' + EYE +
            '<span class="sr-only">Views: </span>' + compact(c.views) + "</span>"
        : "");
    lazyPreview(el.querySelector("[data-cm-stage]"), c);
    return el;
  }

  function toast(msg, kind) {
    var t = document.createElement("div");
    t.className = "cm-toast" + (kind ? " cm-toast--" + kind : "");
    t.setAttribute("role", "status");
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add("is-open"); });
    setTimeout(function () {
      t.classList.remove("is-open");
      setTimeout(function () { t.remove(); }, 250);
    }, 2600);
  }

  // ── Dropdowns: the nav's 3-dot menu (.tl-menu.t-dropdown) ──────────────────
  // Same behavior as the nav menu: is-open scales in over 250ms, is-closing
  // fades out over 150ms, outside click and Escape close it. Opening one
  // closes the others. Returns set(open).
  var DROPDOWN_CLOSE_MS = 150;
  var dropdowns = [];
  function dropdown(btn, menu) {
    var open = false, timer = null;
    function set(next) {
      next = !!next;
      if (next === open) return;
      open = next;
      clearTimeout(timer);
      btn.setAttribute("aria-expanded", String(open));
      if (open) {
        dropdowns.forEach(function (d) { if (d !== set) d(false); });
        menu.classList.remove("is-closing");
        void menu.offsetWidth; // commit the closed frame, then enter
        menu.classList.add("is-open");
      } else {
        menu.classList.remove("is-open");
        menu.classList.add("is-closing");
        timer = setTimeout(function () { menu.classList.remove("is-closing"); }, DROPDOWN_CLOSE_MS);
      }
    }
    btn.addEventListener("click", function (e) { e.stopPropagation(); set(!open); });
    document.addEventListener("click", function (e) {
      if (open && !menu.contains(e.target) && !btn.contains(e.target)) set(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && open) { set(false); btn.focus(); }
    });
    dropdowns.push(set);
    return set;
  }

  // ── In-page dialogs ─────────────────────────────────────────────────────────
  // Native confirm() / prompt() are blocked in embedded browsers (they return
  // false without showing anything), so every question asks in-page.
  // opts: { title, body?, ok?, cancel?, danger?, input?, placeholder? }
  // Resolves true / the typed text, or false / null when dismissed.
  function dialog(opts) {
    return new Promise(function (resolve) {
      var last = document.activeElement;
      var wrap = document.createElement("div");
      wrap.className = "st-dialog cm-ask";
      wrap.innerHTML =
        '<form class="st-dialog-card cm-ask-card" role="dialog" aria-modal="true" aria-labelledby="cm-ask-title" novalidate>' +
          '<h2 id="cm-ask-title">' + esc(opts.title) + "</h2>" +
          (opts.body ? '<p class="cm-ask-body">' + esc(opts.body) + "</p>" : "") +
          (opts.input ? '<textarea class="cm-ask-input" rows="3" maxlength="' + (opts.max || 500) + '" placeholder="' + esc(opts.placeholder || "") + '"></textarea>' : "") +
          '<div class="cm-ask-row">' +
            (opts.cancel === false ? "" : '<button type="button" class="cm-btn cm-btn--ghost" data-no>' + esc(opts.cancel || "Cancel") + "</button>") +
            '<button type="submit" class="cm-btn ' + (opts.danger ? "cm-btn--danger" : "cm-btn--primary") + '">' + esc(opts.ok || "OK") + "</button>" +
          "</div>" +
        "</form>";
      document.body.appendChild(wrap);
      var form = wrap.querySelector("form");
      var input = wrap.querySelector(".cm-ask-input");
      if (input && opts.value) input.value = opts.value;
      var done = false;
      function finish(value) {
        if (done) return;
        done = true;
        wrap.classList.remove("is-open");
        document.removeEventListener("keydown", onKey, true);
        setTimeout(function () { wrap.remove(); if (last && last.focus) last.focus(); }, 200);
        resolve(value);
      }
      function onKey(e) {
        if (e.key === "Escape") { e.stopPropagation(); finish(opts.input ? null : false); }
      }
      document.addEventListener("keydown", onKey, true);
      wrap.addEventListener("mousedown", function (e) { if (e.target === wrap) finish(opts.input ? null : false); });
      var no = wrap.querySelector("[data-no]");
      if (no) no.addEventListener("click", function () { finish(opts.input ? null : false); });
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        finish(opts.input ? input.value.trim() : true);
      });
      requestAnimationFrame(function () { wrap.classList.add("is-open"); });
      setTimeout(function () { (input || form.querySelector("[type=submit]")).focus(); }, 30);
    });
  }

  // ── Library picker ──────────────────────────────────────────────────────────
  // The library transitions anyone can remix, each with a static thumbnail
  // (light and dark), in the search modal component (the nav's ⌘K palette:
  // .cmdk-overlay / .cmdk-panel / .cmdk-search). Typing filters, arrows move,
  // Enter picks, Escape closes. pickLibrary() resolves the chosen item, or null.
  var libP = null;
  function library() {
    if (!libP) libP = fetch("assets/community/library.json?v=5").then(function (r) { return r.json(); }).catch(function () { libP = null; return []; });
    return libP;
  }
  function thumbUrl(slug, dark) {
    return "assets/community/thumbs/" + encodeURIComponent(slug) + (dark ? "-dark" : "") + ".jpg";
  }
  var CLOSE_SVG = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  // The homepage's categories (Pro transitions are not remixable).
  var LIB_GROUPS = [["essential", "Essential"], ["ai", "AI Agents"], ["effects", "Effects"], ["texts", "Texts"]];
  var picker = null;
  function buildPicker() {
    var overlay = document.createElement("div");
    overlay.className = "cmdk-overlay cm-lib";
    overlay.setAttribute("data-open", "false");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Remix a library transition");
    overlay.innerHTML =
      '<div class="cmdk-panel cm-lib-panel">' +
        '<div class="cmdk-search">' +
          '<svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="5"/><path d="M14 14l-3.5-3.5"/></svg>' +
          '<input class="cmdk-input" type="text" placeholder="Search transitions to remix…" aria-label="Search transitions" autocomplete="off" spellcheck="false" />' +
          '<span class="cmdk-esc">esc</span>' +
        "</div>" +
        // The homepage's category pills (.cards-filter).
        '<div class="cards-filters cm-lib-filters" role="tablist" aria-label="Filter transitions by category">' +
          [["all", "All"]].concat(LIB_GROUPS).map(function (g, i) {
            return '<button type="button" class="cards-filter" data-filter="' + g[0] + '" data-active="' + (i === 0) + '" role="tab" aria-selected="' + (i === 0) + '">' +
              '<span class="cards-filter-label">' + g[1] + "</span></button>";
          }).join("") +
        "</div>" +
        '<div class="cmdk-list cm-lib-list" role="listbox" aria-label="Library transitions"></div>' +
      "</div>";
    document.body.appendChild(overlay);
    var input = overlay.querySelector(".cmdk-input");
    var list = overlay.querySelector(".cm-lib-list");
    var filters = overlay.querySelector(".cm-lib-filters");
    var shown = [], active = 0, done = null, last = null, cat = "all";

    function paint() {
      library().then(function (items) {
        var q = input.value.trim().toLowerCase();
        shown = [];
        var html = "";
        LIB_GROUPS.forEach(function (g) {
          if (cat !== "all" && cat !== g[0]) return;
          var rows = items.filter(function (t) {
            var cats = String(t.cat || "essential").split(/\s+/);
            // All: each transition once, under its first category.
            var inGroup = cat === "all" ? cats[0] === g[0] : cats.indexOf(g[0]) >= 0;
            return inGroup && (!q || (t.title + " " + (t.desc || "") + " " + g[1]).toLowerCase().indexOf(q) >= 0);
          });
          if (!rows.length) return;
          html += '<div class="cmdk-group-label">' + g[1] + '</div><div class="cm-lib-grid">';
          rows.forEach(function (t) {
            var i = shown.length;
            shown.push(t);
            html += '<button type="button" class="cmdk-item cm-lib-item" role="option" data-i="' + i + '" data-active="' + (i === active) + '">' +
              '<span class="cm-lib-thumb">' +
                '<img class="is-light" src="' + thumbUrl(t.slug) + '" alt="" width="296" height="260" loading="lazy" decoding="async" />' +
                '<img class="is-dark" src="' + thumbUrl(t.slug, true) + '" alt="" width="296" height="260" loading="lazy" decoding="async" />' +
              "</span>" +
              '<span class="cm-lib-name">' + esc(t.title) + "</span>" +
            "</button>";
          });
          html += "</div>";
        });
        if (active >= shown.length) active = 0;
        list.innerHTML = html || '<div class="cmdk-empty">No transitions match</div>';
      });
    }
    function setActive(i, scroll) {
      if (!shown.length) return;
      active = Math.max(0, Math.min(shown.length - 1, i));
      list.querySelectorAll(".cm-lib-item").forEach(function (el) {
        var on = +el.getAttribute("data-i") === active;
        el.setAttribute("data-active", String(on));
        if (on && scroll) el.scrollIntoView({ block: "nearest" });
      });
    }
    function close(value) {
      if (!done) return;
      var d = done;
      done = null;
      overlay.setAttribute("data-open", "false");
      if (last && last.focus) last.focus();
      d(value);
    }
    input.addEventListener("input", function () { active = 0; paint(); });
    filters.addEventListener("click", function (e) {
      var b = e.target.closest(".cards-filter");
      if (!b) return;
      cat = b.getAttribute("data-filter");
      filters.querySelectorAll(".cards-filter").forEach(function (x) {
        var on = x === b;
        x.setAttribute("data-active", String(on));
        x.setAttribute("aria-selected", String(on));
      });
      active = 0;
      list.scrollTop = 0;
      paint();
      input.focus();
    });
    // Up and down move a row: the grid's column count (3, or 2 on phones).
    function cols() {
      var g = list.querySelector(".cm-lib-grid");
      return g ? getComputedStyle(g).gridTemplateColumns.split(" ").length : 1;
    }
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight") { e.preventDefault(); setActive(active + 1, true); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); setActive(active - 1, true); }
      else if (e.key === "ArrowDown") { e.preventDefault(); setActive(active + cols(), true); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActive(active - cols(), true); }
      else if (e.key === "Enter") { e.preventDefault(); if (shown[active]) close(shown[active]); }
    });
    overlay.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(null); }
    });
    overlay.addEventListener("mousedown", function (e) { if (e.target === overlay) close(null); });
    list.addEventListener("click", function (e) {
      var b = e.target.closest(".cm-lib-item");
      if (b) close(shown[+b.getAttribute("data-i")] || null);
    });
    list.addEventListener("mousemove", function (e) {
      var b = e.target.closest(".cm-lib-item");
      if (b && +b.getAttribute("data-i") !== active) setActive(+b.getAttribute("data-i"), false);
    });
    return function open(resolve) {
      if (done) done(null);
      done = resolve;
      last = document.activeElement;
      input.value = "";
      active = 0;
      paint();
      overlay.setAttribute("data-open", "true");
      setTimeout(function () { input.focus(); }, 20);
    };
  }
  function pickLibrary() {
    return new Promise(function (resolve) {
      if (!picker) picker = buildPicker();
      picker(resolve);
    });
  }

  // ── Images for the agent ────────────────────────────────────────────────────
  // Screenshots and mockups the agent reads with the prompt. Each one is
  // scaled down here to 1568px on the long edge (the most the model reads
  // in detail) and re-encoded as JPEG, which keeps a few of them small enough
  // for one request and for the hand-off from community.html to the Studio.
  var IMAGE_TYPES = /^image\/(png|jpeg|webp|gif)$/;
  var IMAGE_EDGE = 1568;
  var IMAGE_CHARS = 1500000; // base64 characters per image; the API takes up to 1.6M
  var MAX_IMAGES = 4;
  function readImage(file) {
    return new Promise(function (resolve, reject) {
      if (!IMAGE_TYPES.test(file.type)) { reject(new Error("image_type")); return; }
      if (file.size > 25 * 1024 * 1024) { reject(new Error("image_too_large")); return; }
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var w0 = img.naturalWidth, h0 = img.naturalHeight;
        var s = Math.min(1, IMAGE_EDGE / Math.max(w0, h0));
        var w = Math.max(1, Math.round(w0 * s)), h = Math.max(1, Math.round(h0 * s));
        var cv = document.createElement("canvas");
        cv.width = w;
        cv.height = h;
        var g = cv.getContext("2d");
        g.fillStyle = "#ffffff"; // JPEG has no alpha: transparent areas read as white
        g.fillRect(0, 0, w, h);
        g.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        var q = 0.86;
        var out = cv.toDataURL("image/jpeg", q);
        while (out.length > IMAGE_CHARS && q > 0.5) { q -= 0.12; out = cv.toDataURL("image/jpeg", q); }
        if (out.length > IMAGE_CHARS) { reject(new Error("image_too_large")); return; }
        resolve({ media_type: "image/jpeg", data: out.slice(out.indexOf(",") + 1), name: file.name || "Image" });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("image_unreadable")); };
      img.src = url;
    });
  }
  function hasFiles(e) {
    var t = e.dataTransfer && e.dataTransfer.types;
    return !!t && Array.prototype.indexOf.call(t, "Files") >= 0;
  }
  // A file dropped anywhere else would open in the tab and lose the page.
  var dropGuard = false;
  function guardDrops() {
    if (dropGuard) return;
    dropGuard = true;
    window.addEventListener("dragover", function (e) {
      if (!hasFiles(e) || e.defaultPrevented) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "none";
    });
    window.addEventListener("drop", function (e) { if (hasFiles(e)) e.preventDefault(); });
  }

  // The images attached to one input: thumbnails with a remove button in
  // opts.list, files from a picker (add), drag and drop onto opts.drop (which
  // gets .is-drop while a file hovers it), and pasting into opts.paste.
  // opts.onChange runs after every change.
  function attachments(opts) {
    var items = [];
    guardDrops();
    function changed() {
      opts.list.hidden = !items.length;
      if (opts.onChange) opts.onChange();
    }
    function remove(it) {
      var i = items.indexOf(it);
      if (i < 0) return;
      items.splice(i, 1);
      it.el.remove();
      changed();
    }
    function add(fileList) {
      var files = Array.prototype.slice.call(fileList || []);
      if (!files.length) return;
      var images = files.filter(function (f) { return IMAGE_TYPES.test(f.type); });
      if (images.length < files.length) toast("Images only: PNG, JPEG, WebP or GIF.", "err");
      var room = MAX_IMAGES - items.length;
      if (images.length > room) {
        toast("Up to " + MAX_IMAGES + " images per message.", "err");
        images = images.slice(0, Math.max(0, room));
      }
      images.forEach(function (f) {
        var it = { el: document.createElement("span"), ready: false };
        it.el.className = "cm-img is-loading";
        it.el.innerHTML = '<button type="button" class="cm-img-x" aria-label="Remove ' + esc(f.name || "image") + '">' + CLOSE_SVG + "</button>";
        it.el.querySelector("button").addEventListener("click", function () { remove(it); });
        items.push(it);
        opts.list.appendChild(it.el);
        changed();
        readImage(f).then(function (im) {
          if (items.indexOf(it) < 0) return;
          it.media_type = im.media_type;
          it.data = im.data;
          it.ready = true;
          var img = document.createElement("img");
          img.alt = im.name;
          img.src = "data:" + im.media_type + ";base64," + im.data;
          it.el.insertBefore(img, it.el.firstChild);
          it.el.classList.remove("is-loading");
          changed();
        }, function (err) {
          toast(errorText(err.message), "err");
          remove(it);
        });
      });
    }
    if (opts.drop) {
      var depth = 0;
      var target = opts.drop;
      target.addEventListener("dragenter", function (e) {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth++;
        target.classList.add("is-drop");
      });
      target.addEventListener("dragover", function (e) {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      });
      target.addEventListener("dragleave", function (e) {
        if (!hasFiles(e)) return;
        depth = Math.max(0, depth - 1);
        if (!depth) target.classList.remove("is-drop");
      });
      target.addEventListener("drop", function (e) {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth = 0;
        target.classList.remove("is-drop");
        add(e.dataTransfer.files);
      });
    }
    if (opts.paste) {
      opts.paste.addEventListener("paste", function (e) {
        var files = Array.prototype.filter.call((e.clipboardData && e.clipboardData.files) || [], function (f) { return IMAGE_TYPES.test(f.type); });
        if (!files.length) return;
        e.preventDefault();
        add(files);
      });
    }
    changed();
    return {
      add: add,
      count: function () { return items.length; },
      busy: function () { return items.some(function (it) { return !it.ready; }); },
      // What the API takes: [{ media_type, data }]
      items: function () {
        return items.filter(function (it) { return it.ready; }).map(function (it) { return { media_type: it.media_type, data: it.data }; });
      },
      clear: function () {
        items.forEach(function (it) { it.el.remove(); });
        items = [];
        changed();
      },
    };
  }
  // Thumbnails for images already sent (the Studio transcript).
  function imageStrip(images) {
    return '<span class="cm-imgs cm-imgs--sent">' + (images || []).map(function (im) {
      return '<span class="cm-img"><img alt="Attached image" src="data:' + esc(im.media_type) + ";base64," + esc(im.data) + '" /></span>';
    }).join("") + "</span>";
  }

  var ERRORS = {
    unauthenticated: "Sign in to continue.",
    bad_origin: "This action has to come from transitions.dev.",
    quota_exceeded: "You have used this month’s AI drafts. They reset on the 1st.",
    capacity: "AI drafts are busy today. Try again tomorrow.",
    busy: "The AI is busy right now. Try again in a minute.",
    refused: "That request could not be drafted. Try describing it differently.",
    too_long: "That draft ran too long. Try a smaller component.",
    generation_failed: "The draft did not come through. Try again.",
    ai_unavailable: "AI drafts are not available right now.",
    code_too_large: "That code is over the 100 KB limit.",
    too_many_components: "You have reached the component limit.",
    handle_taken: "That handle is taken.",
    invalid_handle: "Handles are 3 to 24 lowercase letters, numbers or dashes.",
    rate_limited: "Too many requests. Slow down for a moment.",
    network: "Network error. Check your connection.",
    context_too_large: "Too many skills and libraries attached. Turn some off and try again.",
    too_many_skills: "You can keep up to 10 skills.",
    skill_too_large: "Skills are limited to 20,000 characters.",
    invalid_skill_name: "Give the skill a name (up to 60 characters).",
    empty_skill: "The skill is empty.",
    image_type: "Images only: PNG, JPEG, WebP or GIF.",
    image_too_large: "That image is too large. Try a smaller one.",
    image_unreadable: "That image could not be read.",
    invalid_image: "One of the images could not be read. Try attaching it again.",
    too_many_images: "Up to 4 images per message.",
    empty_prompt: "Describe what you want, or attach an image.",
    pro_required: "The Transitions Pro skill needs a Pro or Business plan.",
    too_many_design_systems: "You can keep up to 10 design systems.",
    design_system_too_large: "Design systems are limited to 20,000 characters.",
    invalid_design_system_name: "Give the design system a name (up to 60 characters).",
    empty_design_system: "Add the design system’s values first.",
    design_system_pro: "Custom design systems need a Pro or Business plan.",
    report_reason: "Say what is wrong with it.",
    report_good_faith: "Confirm the report is accurate and complete.",
    appeal_message: "Tell us why it should be visible again.",
    appeal_open: "You already asked for a review. We will email you the outcome.",
    not_hidden: "This component is not hidden.",
    design_system_missing: "That design system was deleted. Pick another one in the Design system tab.",
  };
  function errorText(code) { return ERRORS[code] || "Something went wrong. Please try again."; }

  window.Community = {
    api: api,
    esc: esc,
    apiUrl: apiUrl,
    auth: auth,
    withAccount: withAccount,
    mountPreview: mountPreview,
    pushCss: pushCss,
    tellPreview: tellPreview,
    preinstalled: PREINSTALLED,
    unmountPreview: unmountPreview,
    lazyPreview: lazyPreview,
    compileReact: compileReact,
    card: card,
    toast: toast,
    dropdown: dropdown,
    library: library,
    pickLibrary: pickLibrary,
    thumbUrl: thumbUrl,
    attachments: attachments,
    imageStrip: imageStrip,
    confirm: function (opts) { return dialog(opts); },
    ask: function (opts) { return dialog(Object.assign({ input: true }, opts)); },
    errorText: errorText,
    studioUrl: studioUrl,
    profileUrl: profileUrl,
    initials: initials,
    siteTheme: siteTheme,
  };
})();
