/**
 * app.js - GitForge Pusher v2 (Premium)
 * Views: Dashboard, Push, History, Settings (bottom navigation).
 * ZIP files are ALWAYS extracted (detected by magic bytes) and pushed file by file.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const TOKEN_KEY = 'gitforge_token';
  const SETTINGS_KEY = 'gitforge_settings';
  const HISTORY_KEY = 'gitforge_history';
  const DEFAULT_SETTINGS = {
    theme: 'dark',
    commitMsg: 'Upload project via GitForge Pusher',
    skipUnchanged: true,
    blockSecrets: true,
    stripRoot: true,
    newRepoPrivate: true
  };
  const VIEW_TITLES = { dashboard: 'Dashboard', push: 'Push Project', history: 'History', settings: 'Settings' };

  const state = {
    gh: null,
    user: null,
    repos: [],
    repo: null,          // { owner, name, fullName, defaultBranch }
    customBranch: false,
    files: [],           // [{ path, data, size, selected, secret, diff }]
    rootName: '',
    stack: null,
    view: 'dashboard',
    settings: Object.assign({}, DEFAULT_SETTINGS),
    history: []
  };

  // ---------------- storage ----------------
  function storageGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function storageSet(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* ignore */ } }
  function storageDel(k) { try { localStorage.removeItem(k); } catch (_) { /* ignore */ } }

  function loadSettings() {
    try {
      const raw = storageGet(SETTINGS_KEY);
      if (raw) state.settings = Object.assign({}, DEFAULT_SETTINGS, JSON.parse(raw));
    } catch (_) { state.settings = Object.assign({}, DEFAULT_SETTINGS); }
  }
  function saveSettings() { storageSet(SETTINGS_KEY, JSON.stringify(state.settings)); }

  function loadHistory() {
    try {
      const raw = storageGet(HISTORY_KEY);
      state.history = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(state.history)) state.history = [];
    } catch (_) { state.history = []; }
  }
  function saveHistory() { storageSet(HISTORY_KEY, JSON.stringify(state.history.slice(0, 200))); }

  // ---------------- helpers ----------------
  let alertTimer = null;
  function showAlert(msg, type) {
    const el = $('alert');
    el.className = 'alert alert-' + (type || 'error');
    el.textContent = msg;
    clearTimeout(alertTimer);
    if (type === 'success' || type === 'info') alertTimer = setTimeout(() => el.classList.add('hidden'), 5000);
  }
  function hideAlert() { $('alert').classList.add('hidden'); }

  function fmtBytes(n) {
    if (!n) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1);
    return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i];
  }

  function ago(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'abhi abhi';
    const m = Math.floor(s / 60);
    if (m < 60) return m + ' min pehle';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' ghante pehle';
    const d = Math.floor(h / 24);
    if (d < 30) return d + ' din pehle';
    return new Date(ts).toLocaleDateString();
  }

  function addLog(msg, type) {
    const box = $('log');
    const d = document.createElement('div');
    d.className = type || 'info';
    d.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
  }

  function setBar(fillId, pctId, done, total) {
    const pct = total ? Math.round((done / total) * 100) : 0;
    $(fillId).style.width = pct + '%';
    if (pctId) $(pctId).textContent = pct + '%';
  }

  // ---------------- theme ----------------
  function applyTheme() {
    let t = state.settings.theme;
    if (t === 'auto') t = (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'light' ? '#f3f5f9' : '#0d1117');
  }

  // ---------------- navigation ----------------
  function go(view) {
    if (!VIEW_TITLES[view]) return;
    state.view = view;
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
    document.querySelectorAll('.nav').forEach(n => n.classList.toggle('active', n.dataset.go === view));
    $('view-title').textContent = VIEW_TITLES[view];
    if (view === 'dashboard') renderDashboard();
    if (view === 'history') renderHistory();
    window.scrollTo(0, 0);
  }

  // ---------------- dashboard ----------------
  function itemEl(icon, title, sub, href) {
    const el = document.createElement(href ? 'a' : 'div');
    el.className = 'item';
    if (href) { el.href = href; el.target = '_blank'; el.rel = 'noopener noreferrer'; }
    const ic = document.createElement('div'); ic.className = 'item-ic'; ic.textContent = icon;
    const main = document.createElement('div'); main.className = 'item-main';
    const t = document.createElement('div'); t.className = 'item-title'; t.textContent = title;
    const s = document.createElement('div'); s.className = 'item-sub'; s.textContent = sub;
    main.appendChild(t); main.appendChild(s);
    el.appendChild(ic); el.appendChild(main);
    return el;
  }

  function histItemTexts(h) {
    return {
      title: h.repo + '  \u2022  ' + h.branch,
      sub: ago(h.t) + '  \u2022  ' + h.uploaded + ' files' + (h.skipped ? ' (+' + h.skipped + ' skip)' : '') + (h.stack ? '  \u2022  ' + h.stack : '') + (h.sha ? '  \u2022  ' + h.sha.substring(0, 7) : '')
    };
  }

  function renderDashboard() {
    const connected = !!state.user;
    $('hero-hi').textContent = connected ? 'Namaste, ' + (state.user.name || state.user.login) + '!' : 'Welcome, Developer';
    $('hero-sub').textContent = connected ? 'Aapka GitHub connected hai. Naya project push karne ke liye tayyar.' : 'GitHub connect karo aur apna project push karo.';
    $('hero-cta').textContent = connected ? '🚀 Naya Push shuru karo' : 'GitHub Connect karo';

    const h = state.history;
    $('st-pushes').textContent = String(h.length);
    $('st-files').textContent = String(h.reduce((a, x) => a + (x.uploaded || 0), 0));
    $('st-repos').textContent = String(new Set(h.map(x => x.repo)).size);
    $('st-last').textContent = h.length ? ago(h[0].t) : '-';

    const list = $('recent-list');
    list.innerHTML = '';
    if (!h.length) {
      const e = document.createElement('div'); e.className = 'empty'; e.textContent = 'Abhi koi push nahi hua. Pehla project push karo!';
      list.appendChild(e);
    } else {
      h.slice(0, 3).forEach(x => {
        const tx = histItemTexts(x);
        list.appendChild(itemEl('✅', tx.title, tx.sub, x.url || null));
      });
    }
  }

  // ---------------- history ----------------
  function renderHistory() {
    const q = $('hist-search').value.trim().toLowerCase();
    const list = $('hist-list');
    list.innerHTML = '';
    $('hist-count').textContent = String(state.history.length);
    const rows = state.history.map((x, i) => ({ x, i })).filter(r => !q || (r.x.repo + ' ' + r.x.branch).toLowerCase().includes(q));
    if (!rows.length) {
      const e = document.createElement('div'); e.className = 'empty';
      e.textContent = state.history.length ? 'Koi match nahi mila.' : 'History khali hai.';
      list.appendChild(e);
      return;
    }
    rows.forEach(r => {
      const tx = histItemTexts(r.x);
      const wrap = document.createElement('div');
      wrap.className = 'item';
      const link = itemEl('✅', tx.title, tx.sub, r.x.url || null);
      link.style.padding = '0'; link.style.border = 'none'; link.style.flex = '1'; link.style.minWidth = '0';
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'item-x'; del.dataset.i = String(r.i); del.textContent = '✕';
      del.setAttribute('aria-label', 'Delete');
      wrap.appendChild(link); wrap.appendChild(del);
      list.appendChild(wrap);
    });
  }

  // ---------------- project analyzer ----------------
  const GITIGNORES = {
    node: 'node_modules/\nnpm-debug.log*\n.env\n.env.*\ndist/\nbuild/\n.cache/\ncoverage/\n.DS_Store\n',
    php: 'vendor/\n.env\n*.log\nstorage/logs/\ncache/\n.DS_Store\n.idea/\n.vscode/\n',
    python: '__pycache__/\n*.py[cod]\n.venv/\nvenv/\n.env\n*.egg-info/\ndist/\nbuild/\n.DS_Store\n',
    android: '*.iml\n.gradle/\n/local.properties\n/.idea/\n.DS_Store\n/build/\n/captures/\n.externalNativeBuild/\n.cxx/\n*.apk\n*.aab\n*.jks\n*.keystore\n',
    flutter: '.dart_tool/\n.packages\nbuild/\n.flutter-plugins\n.flutter-plugins-dependencies\n.idea/\n*.iml\n.DS_Store\n',
    java: 'target/\n*.class\n*.jar\n.idea/\n*.iml\n.gradle/\nbuild/\n.DS_Store\n',
    web: '.env\n.DS_Store\nThumbs.db\n.idea/\n.vscode/\n',
    generic: '.env\n.env.*\n*.log\n.DS_Store\nThumbs.db\n.idea/\n.vscode/\n'
  };

  function analyze(files) {
    const names = files.map(f => f.path.toLowerCase());
    const base = (n) => n.split('/').pop();
    const has = (b) => names.some(n => base(n) === b);
    const count = (ext) => names.filter(n => n.endsWith(ext)).length;
    let key = 'generic', label = 'General Project', icon = '📁';
    if (has('build.gradle') || has('build.gradle.kts') || has('androidmanifest.xml')) { key = 'android'; label = 'Android Project'; icon = '🤖'; }
    else if (has('pubspec.yaml')) { key = 'flutter'; label = 'Flutter Project'; icon = '🐦'; }
    else if (has('package.json')) { key = 'node'; label = 'Node.js / JavaScript'; icon = '🟩'; }
    else if (has('composer.json') || count('.php') > 2) { key = 'php'; label = 'PHP Project'; icon = '🐘'; }
    else if (has('requirements.txt') || has('pyproject.toml') || count('.py') > 2) { key = 'python'; label = 'Python Project'; icon = '🐍'; }
    else if (has('pom.xml')) { key = 'java'; label = 'Java Project'; icon = '☕'; }
    else if (has('index.html')) { key = 'web'; label = 'Website (HTML/CSS/JS)'; icon = '🌐'; }
    return { key, label, icon, ignore: GITIGNORES[key] };
  }

  function rootPrefix() { return state.rootName ? state.rootName + '/' : ''; }
  function gitignorePath() { return rootPrefix() + '.gitignore'; }

  function renderAnalysis() {
    state.stack = analyze(state.files);
    $('analysis-ic').textContent = state.stack.icon;
    $('analysis-title').textContent = state.stack.label;
    const hasIgnore = state.files.some(f => f.path === gitignorePath());
    $('analysis-sub').textContent = state.files.length + ' files  \u2022  ' + (hasIgnore ? '.gitignore pehle se hai' : '.gitignore nahi mili, jod sakte ho');
    $('btn-add-gitignore').classList.toggle('hidden', hasIgnore);
  }

  function addGitignore() {
    const text = state.stack ? state.stack.ignore : GITIGNORES.generic;
    const data = new TextEncoder().encode(text);
    state.files.push({ path: gitignorePath(), data, size: data.length, selected: true, secret: false, diff: null });
    renderFiles();
    showAlert('.gitignore jod di gayi (' + state.stack.label + ')', 'success');
  }

  // ---------------- secret scanner ----------------
  const SECRET_NAMES = [/^\.env(\..+)?$/i, /id_rsa$/i, /id_ed25519$/i, /\.pem$/i, /\.pfx$/i, /\.p12$/i, /\.keystore$/i, /\.jks$/i, /credentials\.json$/i, /secrets?\.json$/i, /service[_-]?account.*\.json$/i, /google-services\.json$/i];
  const SECRET_CONTENT = [/AKIA[0-9A-Z]{16}/, /gh[pousr]_[A-Za-z0-9_]{36,}/, /github_pat_[A-Za-z0-9_]{50,}/, /sk_live_[0-9a-zA-Z]{24}/, /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/];

  function scanSecret(f) {
    const name = f.path.split('/').pop();
    if (SECRET_NAMES.some(r => r.test(name))) return true;
    if (f.size > 0 && f.size < 1024 * 1024) {
      const probe = f.data.subarray(0, Math.min(f.size, 2000));
      for (let i = 0; i < probe.length; i++) if (probe[i] === 0) return false;
      const text = new TextDecoder('utf-8').decode(f.data);
      return SECRET_CONTENT.some(r => r.test(text));
    }
    return false;
  }

  // ---------------- connect ----------------
  function renderAccount() {
    const u = state.user;
    $('acct-box').classList.toggle('hidden', !u);
    $('btn-connect').classList.toggle('hidden', !!u);
    $('btn-disconnect').classList.toggle('hidden', !u);
    $('card-need-connect').classList.toggle('hidden', !!u);
    $('card-repo').classList.toggle('disabled', !u);
    const pill = $('user-pill');
    if (u) {
      pill.textContent = '@' + u.login;
      pill.className = 'pill pill-on';
      $('acct-name').textContent = u.name || u.login;
      $('acct-login').textContent = '@' + u.login;
      $('acct-avatar').src = u.avatar_url || '';
    } else {
      pill.textContent = 'Not connected';
      pill.className = 'pill pill-off';
    }
  }

  async function connect(token, silent) {
    hideAlert();
    const btn = $('btn-connect');
    btn.disabled = true; btn.textContent = 'Connecting...';
    try {
      const gh = new GitPusher.GitHub(token);
      const user = await gh.user();
      state.gh = gh; state.user = user;
      if ($('remember').checked) storageSet(TOKEN_KEY, token); else storageDel(TOKEN_KEY);
      $('token').value = '';
      renderAccount();
      renderDashboard();
      if (!silent) showAlert('Connected: @' + user.login, 'success');
      await loadRepos();
    } catch (e) {
      state.gh = null; state.user = null;
      renderAccount();
      showAlert(e.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Connect';
      updatePushState();
    }
  }

  function disconnect() {
    state.gh = null; state.user = null; state.repo = null; state.repos = [];
    storageDel(TOKEN_KEY);
    $('token').value = '';
    $('remember').checked = false;
    $('repo-select').innerHTML = '';
    $('branch-select').innerHTML = '';
    renderAccount();
    renderDashboard();
    updatePushState();
    showAlert('Disconnect ho gaya.', 'info');
  }

  async function loadRepos(selectFullName) {
    const sel = $('repo-select');
    sel.innerHTML = '<option>Repos load ho rahe hain...</option>';
    try {
      state.repos = await state.gh.repos();
      renderRepos(selectFullName);
    } catch (e) {
      showAlert('Repos load nahi hue: ' + e.message, 'error');
    }
  }

  function renderRepos(selectFullName) {
    const q = $('repo-search').value.trim().toLowerCase();
    const sel = $('repo-select');
    sel.innerHTML = '';
    const list = state.repos.filter(r => !q || r.full_name.toLowerCase().includes(q));
    if (!list.length) {
      sel.innerHTML = '<option value="">Koi repo nahi mila</option>';
      state.repo = null;
      $('branch-select').innerHTML = '';
      updatePushState();
      return;
    }
    list.forEach(r => {
      const o = document.createElement('option');
      o.value = r.full_name;
      o.textContent = r.full_name + (r.private ? '  (Private)' : '  (Public)');
      sel.appendChild(o);
    });
    if (selectFullName) sel.value = selectFullName;
    onRepoChange();
  }

  async function onRepoChange() {
    clearDiff();
    const full = $('repo-select').value;
    const r = state.repos.find(x => x.full_name === full);
    if (!r) { state.repo = null; updatePushState(); return; }
    state.repo = { owner: r.owner.login, name: r.name, fullName: r.full_name, defaultBranch: r.default_branch };
    const bs = $('branch-select');
    bs.innerHTML = '<option>Branches load ho rahi hain...</option>';
    try {
      const branches = await state.gh.branches(state.repo.owner, state.repo.name);
      bs.innerHTML = '';
      if (!branches.length) {
        const o = document.createElement('option');
        o.value = state.repo.defaultBranch || 'main';
        o.textContent = (state.repo.defaultBranch || 'main') + ' (khali repo)';
        bs.appendChild(o);
      } else {
        branches.forEach(b => {
          const o = document.createElement('option');
          o.value = b.name;
          o.textContent = b.name + (b.name === state.repo.defaultBranch ? ' (default)' : '');
          bs.appendChild(o);
        });
        bs.value = state.repo.defaultBranch;
      }
    } catch (e) {
      const d = state.repo.defaultBranch || 'main';
      bs.innerHTML = '';
      const o = document.createElement('option'); o.value = d; o.textContent = d; bs.appendChild(o);
    }
    updatePushState();
  }

  async function createRepo() {
    const name = $('new-repo-name').value.trim();
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(name)) return showAlert('Repo ka naam sirf letters, numbers, - _ . ho sakta hai.', 'error');
    const btn = $('btn-create-repo');
    btn.disabled = true;
    try {
      const r = await state.gh.createRepo(name, $('new-repo-private').checked, 'Created with GitForge Pusher');
      state.repos.unshift(r);
      $('repo-search').value = '';
      renderRepos(r.full_name);
      $('new-repo-name').value = '';
      showAlert('Repo ban gaya: ' + r.full_name, 'success');
    } catch (e) {
      showAlert('Repo nahi bana: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  function currentBranch() {
    return state.customBranch ? $('branch-custom').value.trim() : $('branch-select').value;
  }

  // ---------------- files ----------------
  async function handleIncoming(fileList) {
    if (!fileList || !fileList.length) return;
    hideAlert();
    $('result').classList.add('hidden');
    $('extract-progress').classList.remove('hidden');
    setBar('extract-fill', null, 0, 1);

    try {
      const incoming = [];
      let zipCount = 0;
      const items = Array.from(fileList);

      for (let n = 0; n < items.length; n++) {
        const file = items[n];
        const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());

        if (ZipReader.isZipBytes(head)) {
          zipCount++;
          $('extract-text').textContent = 'ZIP extract ho rahi hai: ' + file.name;
          const data = new Uint8Array(await file.arrayBuffer());
          const extracted = await ZipReader.extractAll(data, (done, total, path) => {
            setBar('extract-fill', null, done, total);
            $('extract-text').textContent = 'Extract: ' + done + '/' + total + '  ' + path;
          });
          extracted.forEach(f => incoming.push(f));
        } else {
          const rel = (file.webkitRelativePath || file.name).replace(/\\/g, '/').replace(/^\/+/, '');
          if (ZipReader.isIgnoredPath(rel)) continue;
          $('extract-text').textContent = 'File padh raha hu: ' + rel;
          const data = new Uint8Array(await file.arrayBuffer());
          incoming.push({ path: rel, data, size: data.length });
          setBar('extract-fill', null, n + 1, items.length);
        }
      }

      if (!incoming.length) throw new Error('Koi usable file nahi mili.');

      const map = new Map(state.files.map(f => [f.path, f]));
      incoming.forEach(f => {
        f.secret = scanSecret(f);
        f.selected = !(f.secret && state.settings.blockSecrets);
        f.diff = null;
        map.set(f.path, f);
      });
      state.files = Array.from(map.values());

      renderFiles();
      showAlert(incoming.length + ' files tayyar hain' + (zipCount ? ' (' + zipCount + ' ZIP extract hui)' : '') + '.', 'success');
    } catch (e) {
      showAlert('File process error: ' + e.message, 'error');
    } finally {
      $('extract-progress').classList.add('hidden');
      ['pick-files', 'pick-folder'].forEach(id => { $(id).value = ''; });
      updatePushState();
    }
  }

  function computeRoot() {
    if (!state.files.length) return '';
    const first = state.files[0].path.split('/');
    if (first.length < 2) return '';
    const root = first[0];
    return state.files.every(f => { const p = f.path.split('/'); return p.length > 1 && p[0] === root; }) ? root : '';
  }

  function finalPath(f) {
    let p = f.path;
    if (state.rootName && $('strip-root').checked) p = p.slice(state.rootName.length + 1);
    const sub = $('subdir').value.trim().replace(/^\/+|\/+$/g, '');
    return sub ? sub + '/' + p : p;
  }

  function clearDiff() {
    let had = false;
    state.files.forEach(f => { if (f.diff) { f.diff = null; had = true; } });
    $('diff-bar').classList.add('hidden');
    if (had) renderFiles();
  }

  function renderFiles() {
    const area = $('files-area');
    if (!state.files.length) {
      area.classList.add('hidden');
      $('count-pill').textContent = '0 files';
      state.rootName = '';
      updatePushState();
      return;
    }
    area.classList.remove('hidden');
    state.rootName = computeRoot();
    $('strip-wrap').classList.toggle('hidden', !state.rootName);
    $('root-name').textContent = state.rootName;
    $('secret-warning').classList.toggle('hidden', !state.files.some(f => f.secret));
    renderAnalysis();

    const list = $('file-list');
    list.innerHTML = '';
    const frag = document.createDocumentFragment();
    state.files.forEach((f, i) => {
      const row = document.createElement('label');
      row.className = 'file-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = f.selected; cb.dataset.i = String(i);
      const path = document.createElement('span');
      path.className = 'path';
      path.textContent = '📄 ' + f.path;
      row.appendChild(cb); row.appendChild(path);
      if (f.secret) { const t = document.createElement('span'); t.className = 'tag secret'; t.textContent = 'SECRET'; row.appendChild(t); }
      if (f.diff) { const t = document.createElement('span'); t.className = 'tag ' + f.diff; t.textContent = f.diff; row.appendChild(t); }
      const sz = document.createElement('span');
      sz.className = 'size'; sz.textContent = fmtBytes(f.size);
      row.appendChild(sz);
      frag.appendChild(row);
    });
    list.appendChild(frag);
    updateCounts();
  }

  function updateCounts() {
    const sel = state.files.filter(f => f.selected);
    $('count-pill').textContent = sel.length + '/' + state.files.length + ' files';
    $('total-size').textContent = 'Selected: ' + fmtBytes(sel.reduce((a, f) => a + f.size, 0));
    const badge = $('nav-badge');
    badge.textContent = String(sel.length);
    badge.classList.toggle('hidden', sel.length === 0);
    updatePushState();
  }

  function updatePushState() {
    const ok = !!state.gh && !!state.repo && state.files.some(f => f.selected) && !!currentBranch();
    $('btn-push').disabled = !ok;
  }

  // ---------------- diff ----------------
  async function runDiff() {
    hideAlert();
    const picked = state.files.filter(f => f.selected);
    if (!state.gh || !state.repo) return showAlert('Pehle GitHub connect karo aur repo chuno.', 'error');
    if (!picked.length) return showAlert('Koi file select nahi hai.', 'error');
    const btn = $('btn-diff');
    btn.disabled = true; btn.textContent = 'Compare ho raha hai...';
    try {
      const mapped = picked.map(f => ({ ref: f, path: finalPath(f), data: f.data }));
      const res = await GitPusher.diff({ gh: state.gh, owner: state.repo.owner, repo: state.repo.name, branch: currentBranch() || state.repo.defaultBranch, files: mapped });
      state.files.forEach(f => { f.diff = null; });
      mapped.forEach(m => { m.ref.diff = res.status.get(m.path); });
      $('d-new').textContent = res.counts.NEW + ' New';
      $('d-mod').textContent = res.counts.MODIFIED + ' Modified';
      $('d-same').textContent = res.counts.SAME + ' Same';
      $('diff-bar').classList.remove('hidden');
      renderFiles();
    } catch (e) {
      showAlert('Compare fail: ' + e.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = '🔍 GitHub se changes compare karo';
    }
  }

  // ---------------- push ----------------
  async function doPush() {
    hideAlert();
    const picked = state.files.filter(f => f.selected);
    if (!state.gh || !state.repo) return showAlert('Pehle GitHub connect karo aur repo chuno.', 'error');
    if (!picked.length) return showAlert('Koi file select nahi hai.', 'error');
    const branch = currentBranch();
    if (!branch) return showAlert('Branch ka naam likho.', 'error');
    if (!/^[A-Za-z0-9._\/-]+$/.test(branch)) return showAlert('Branch naam mein sirf letters, numbers, - _ . / allowed hain.', 'error');

    const files = picked.map(f => ({ path: finalPath(f), data: f.data }));
    const seen = new Set();
    for (const f of files) {
      if (seen.has(f.path)) return showAlert('Duplicate path: ' + f.path + ' (root folder hatane se do files same jagah aa rahi hain).', 'error');
      seen.add(f.path);
    }

    const btn = $('btn-push');
    btn.disabled = true;
    $('result').classList.add('hidden');
    $('push-progress').classList.remove('hidden');
    $('log').innerHTML = '';
    $('push-stage').textContent = 'Shuru ho raha hai...';
    $('push-count').textContent = '';
    setBar('push-fill', 'push-pct', 0, 1);

    try {
      const res = await GitPusher.push({
        gh: state.gh,
        owner: state.repo.owner,
        repo: state.repo.name,
        branch,
        files,
        skipUnchanged: state.settings.skipUnchanged,
        message: $('commit-msg').value.trim() || state.settings.commitMsg,
        log: addLog,
        progress: (done, total) => {
          $('push-stage').textContent = 'Files upload ho rahi hain...';
          $('push-count').textContent = 'Uploaded: ' + done + ' / ' + total;
          setBar('push-fill', 'push-pct', done, total);
        }
      });

      setBar('push-fill', 'push-pct', 1, 1);
      const commitUrl = 'https://github.com/' + state.repo.fullName + '/commit/' + res.commitSha;
      $('push-stage').textContent = res.nothing ? 'Koi change nahi' : 'Complete!';
      $('result-title').textContent = res.nothing
        ? 'ℹ️ Sab files pehle se GitHub par same hain'
        : '✅ ' + res.uploaded + ' files push ho gayi' + (res.skipped ? ' (' + res.skipped + ' same thi, skip)' : '');
      $('link-repo').href = 'https://github.com/' + state.repo.fullName + '/tree/' + res.branch;
      $('link-commit').href = commitUrl;
      $('result').classList.remove('hidden');

      if (!res.nothing) {
        state.history.unshift({
          t: Date.now(), repo: state.repo.fullName, branch: res.branch, sha: res.commitSha,
          uploaded: res.uploaded, skipped: res.skipped || 0, stack: state.stack ? state.stack.label : '', url: commitUrl
        });
        saveHistory();
      }
      showAlert(res.nothing ? 'Koi nayi file nahi thi.' : 'GitHub par push ho gaya!', 'success');
      clearDiff();
      onRepoChange();
    } catch (e) {
      addLog('ERROR: ' + e.message, 'error');
      showAlert('Push fail: ' + e.message, 'error');
    } finally {
      updatePushState();
    }
  }

  // ---------------- settings UI ----------------
  function fillSettingsUI() {
    const s = state.settings;
    $('set-theme').value = s.theme;
    $('set-commit').value = s.commitMsg;
    $('set-skip').checked = s.skipUnchanged;
    $('set-secrets').checked = s.blockSecrets;
    $('set-strip').checked = s.stripRoot;
    $('set-private').checked = s.newRepoPrivate;
    $('commit-msg').value = s.commitMsg;
    $('strip-root').checked = s.stripRoot;
    $('new-repo-private').checked = s.newRepoPrivate;
  }

  function wireSettings() {
    $('set-theme').addEventListener('change', (e) => { state.settings.theme = e.target.value; saveSettings(); applyTheme(); });
    $('set-commit').addEventListener('input', (e) => {
      state.settings.commitMsg = e.target.value.trim() || DEFAULT_SETTINGS.commitMsg;
      saveSettings();
      $('commit-msg').value = state.settings.commitMsg;
    });
    $('set-skip').addEventListener('change', (e) => { state.settings.skipUnchanged = e.target.checked; saveSettings(); });
    $('set-secrets').addEventListener('change', (e) => { state.settings.blockSecrets = e.target.checked; saveSettings(); });
    $('set-strip').addEventListener('change', (e) => { state.settings.stripRoot = e.target.checked; saveSettings(); $('strip-root').checked = e.target.checked; });
    $('set-private').addEventListener('change', (e) => { state.settings.newRepoPrivate = e.target.checked; saveSettings(); $('new-repo-private').checked = e.target.checked; });

    $('btn-clear-history').addEventListener('click', () => {
      if (!state.history.length) return showAlert('History pehle se khali hai.', 'info');
      if (!window.confirm('Poori push history delete karni hai?')) return;
      state.history = []; saveHistory(); renderDashboard(); renderHistory();
      showAlert('History saaf ho gayi.', 'success');
    });
    $('btn-reset').addEventListener('click', () => {
      if (!window.confirm('Token, settings aur history sab delete ho jayega. Pakka?')) return;
      [TOKEN_KEY, SETTINGS_KEY, HISTORY_KEY].forEach(storageDel);
      state.settings = Object.assign({}, DEFAULT_SETTINGS);
      state.history = [];
      fillSettingsUI(); applyTheme();
      if (state.user) disconnect();
      state.files = []; renderFiles();
      renderDashboard(); renderHistory();
      showAlert('Sab reset ho gaya.', 'success');
    });
  }

  // ---------------- splash ----------------
  function hideSplash() {
    const sp = $('splash');
    if (!sp) return;
    sp.classList.add('hide');
    setTimeout(() => { if (sp.parentNode) sp.parentNode.removeChild(sp); }, 600);
  }

  // ---------------- wiring ----------------
  document.addEventListener('DOMContentLoaded', () => {
    const splashStart = Date.now();
    loadSettings();
    loadHistory();
    applyTheme();
    fillSettingsUI();
    wireSettings();
    renderAccount();
    renderDashboard();
    updatePushState();

    $('brand-logo').addEventListener('error', () => { $('brand-logo').style.display = 'none'; });

    // navigation (bottom bar, quick actions, any [data-go])
    document.addEventListener('click', (e) => {
      const el = e.target.closest ? e.target.closest('[data-go]') : null;
      if (el) go(el.dataset.go);
    });
    $('user-pill').addEventListener('click', () => go('settings'));
    $('hero-cta').addEventListener('click', () => go(state.user ? 'push' : 'settings'));

    // account
    $('btn-eye').addEventListener('click', () => { const t = $('token'); t.type = t.type === 'password' ? 'text' : 'password'; });
    $('btn-connect').addEventListener('click', () => {
      const tok = $('token').value.trim();
      if (!tok) return showAlert('GitHub token paste karo.', 'error');
      connect(tok, false);
    });
    $('btn-disconnect').addEventListener('click', disconnect);

    // repo / branch
    $('repo-search').addEventListener('input', () => renderRepos());
    $('repo-select').addEventListener('change', onRepoChange);
    $('btn-create-repo').addEventListener('click', createRepo);
    $('branch-select').addEventListener('change', () => { clearDiff(); updatePushState(); });
    $('branch-custom').addEventListener('input', () => { clearDiff(); updatePushState(); });
    $('btn-branch-toggle').addEventListener('click', () => {
      state.customBranch = !state.customBranch;
      $('branch-select').classList.toggle('hidden', state.customBranch);
      $('branch-custom').classList.toggle('hidden', !state.customBranch);
      $('btn-branch-toggle').textContent = state.customBranch ? 'List' : 'Nayi';
      clearDiff();
      updatePushState();
    });
    $('subdir').addEventListener('input', clearDiff);
    $('strip-root').addEventListener('change', clearDiff);

    // files
    $('pick-files').addEventListener('change', (e) => handleIncoming(e.target.files));
    $('pick-folder').addEventListener('change', (e) => handleIncoming(e.target.files));
    if (!/Android/i.test(navigator.userAgent) && 'webkitdirectory' in $('pick-folder')) $('folder-label').classList.remove('hidden');

    const dz = $('dropzone');
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
    dz.addEventListener('drop', (e) => { if (e.dataTransfer && e.dataTransfer.files) handleIncoming(e.dataTransfer.files); });

    $('file-list').addEventListener('change', (e) => {
      const cb = e.target;
      if (cb && cb.dataset && cb.dataset.i !== undefined) {
        state.files[parseInt(cb.dataset.i, 10)].selected = cb.checked;
        updateCounts();
      }
    });
    $('btn-all').addEventListener('click', () => { state.files.forEach(f => { f.selected = true; }); renderFiles(); });
    $('btn-none').addEventListener('click', () => { state.files.forEach(f => { f.selected = false; }); renderFiles(); });
    $('btn-clear').addEventListener('click', () => { state.files = []; $('diff-bar').classList.add('hidden'); renderFiles(); });
    $('btn-add-gitignore').addEventListener('click', addGitignore);
    $('btn-diff').addEventListener('click', runDiff);
    $('btn-push').addEventListener('click', doPush);

    // history
    $('hist-search').addEventListener('input', renderHistory);
    $('hist-list').addEventListener('click', (e) => {
      const b = e.target.closest ? e.target.closest('.item-x') : null;
      if (!b) return;
      state.history.splice(parseInt(b.dataset.i, 10), 1);
      saveHistory(); renderHistory(); renderDashboard();
    });

    // auto reconnect
    const saved = storageGet(TOKEN_KEY);
    if (saved) {
      $('remember').checked = true;
      connect(saved, true);
    }

    // splash: keep visible at least ~1.8s
    setTimeout(hideSplash, Math.max(300, 1800 - (Date.now() - splashStart)));
  });
})();
