(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var ALL = "all";
  var BUCKET = "bukti";

  var conf = window.APP_CONFIG || {};
  var configured = !!(conf.SUPABASE_URL && conf.SUPABASE_KEY &&
    conf.SUPABASE_URL.indexOf("GANTI") < 0 && conf.SUPABASE_KEY.indexOf("GANTI") < 0);
  var sb = (configured && window.supabase && window.supabase.createClient)
    ? window.supabase.createClient(conf.SUPABASE_URL, conf.SUPABASE_KEY) : null;

  var state = {
    tx: [], cfg: { namaRT: "", saldoAwal: 0 }, period: null, periodChosen: false,
    loaded: false, loadError: false,
    admin: false, email: "", signedIn: false,
    editing: null, confirmDel: null, saving: false, opener: null,
    berita: [], bLoaded: false, bError: null, bLimit: 8, bOpen: {}, bEdit: null, bConfirmDel: null, bSaving: false,
    warga: [], wLoaded: false, wError: null, wEdit: null, wConfirmDel: null, wSaving: false, wLimit: 100,
    wf: { q: "", umur: "", min: "", max: "", gang: "", mukim: "", rumah: "", ktp: "", ronda: "", sort: "nama" }
  };

  // ---------- helpers ----------
  function h(tag, props) {
    var e = document.createElement(tag);
    var p = props || {};
    Object.keys(p).forEach(function (k) {
      var v = p[k];
      if (k === "class") e.className = v;
      else if (k.indexOf("on") === 0) e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, "");
      else if (v !== false && v != null) e.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) {
      [].concat(arguments[i]).forEach(function (kid) {
        if (kid == null || kid === false) return;
        e.append(typeof kid === "object" ? kid : String(kid));
      });
    }
    return e;
  }
  function pad(n) { return String(n).padStart(2, "0"); }
  function isoDate(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function todayISO() { return isoDate(new Date()); }
  function rp(n) { return (n < 0 ? "-" : "") + "Rp " + Math.abs(n).toLocaleString("id-ID"); }
  function digits(v) { return String(v || "").replace(/\D/g, ""); }
  function fmtInput(v) { var d = digits(v).replace(/^0+(?=\d)/, ""); return d ? Number(d).toLocaleString("id-ID") : ""; }
  function monthLabel(key) {
    if (key === ALL) return "Semua periode";
    var p = key.split("-").map(Number);
    return new Date(p[0], p[1] - 1, 1).toLocaleDateString("id-ID", { month: "long", year: "numeric" });
  }
  function dateLabel(s) {
    var p = s.split("-").map(Number);
    return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
  }
  function longDate(s) {
    var p = s.split("-").map(Number);
    return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }
  function ncmp(a, b) { return String(a || "").localeCompare(String(b || ""), "id", { numeric: true, sensitivity: "base" }); }
  function mask(s) { return s ? "••••" + String(s).slice(-4) : ""; }
  function pick(name) { var r = document.querySelector('input[name="' + name + '"]:checked'); return r ? r.value : ""; }
  function setPick(name, val) { var r = document.querySelector('input[name="' + name + '"][value="' + val + '"]'); if (r) r.checked = true; }
  function rnd(n) { var a = new Uint32Array(1); window.crypto.getRandomValues(a); return a[0] % n; }
  function flash(msg, kind) {
    var el = $("#flash");
    if (!msg) { el.hidden = true; return; }
    el.className = "notice" + (kind ? " " + kind : "");
    el.textContent = msg;
    el.hidden = false;
  }
  function flashTemp(msg, kind) {
    flash(msg, kind);
    setTimeout(function () { var el = $("#flash"); if (el.textContent === msg) flash(""); }, 3500);
  }
  function proofUrl(path) { return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; }
  function setOptions(sel, opts, keep) {
    var cur = keep ? sel.value : "";
    sel.textContent = "";
    opts.forEach(function (o) { sel.append(h("option", { value: o[0] }, o[1])); });
    if (keep && opts.some(function (o) { return o[0] === cur; })) sel.value = cur;
  }

  // ---------- keuangan: perhitungan ----------
  function validTx() {
    return state.tx.filter(function (t) {
      return t && typeof t.tanggal === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.tanggal) &&
        isFinite(t.nominal) && (t.jenis === "masuk" || t.jenis === "keluar");
    });
  }
  function months() {
    var set = {};
    validTx().forEach(function (t) { set[t.tanggal.slice(0, 7)] = 1; });
    return Object.keys(set).sort().reverse();
  }
  function compute(period) {
    var base = Number(state.cfg.saldoAwal) || 0;
    var sorted = validTx().slice().sort(function (a, b) {
      return a.tanggal.localeCompare(b.tanggal) || (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0);
    });
    var run = base;
    var all = sorted.map(function (t) {
      run += t.jenis === "masuk" ? t.nominal : -t.nominal;
      return Object.assign({}, t, { saldo: run });
    });
    var rows = period === ALL ? all : all.filter(function (t) { return t.tanggal.slice(0, 7) === period; });
    var opening = base;
    if (period !== ALL) {
      all.forEach(function (t) {
        if (t.tanggal.slice(0, 7) < period) opening += t.jenis === "masuk" ? t.nominal : -t.nominal;
      });
    }
    var masuk = 0, keluar = 0;
    rows.forEach(function (t) { if (t.jenis === "masuk") masuk += t.nominal; else keluar += t.nominal; });
    return { rows: rows, opening: opening, masuk: masuk, keluar: keluar, closing: opening + masuk - keluar };
  }

  // ======================================================================
  // KEUANGAN
  // ======================================================================
  function renderPeriod() {
    var ms = months();
    if (!state.periodChosen || (state.period !== ALL && ms.indexOf(state.period) < 0)) {
      state.period = ms[0] || ALL;
    }
    var sel = $("#period");
    sel.textContent = "";
    sel.append(h("option", { value: ALL }, "Semua periode"));
    ms.forEach(function (m) { sel.append(h("option", { value: m }, monthLabel(m))); });
    sel.value = state.period;
  }
  function renderSummary(c) {
    $("#s-open").textContent = rp(c.opening);
    $("#s-in").textContent = rp(c.masuk);
    $("#s-out").textContent = rp(c.keluar);
    $("#s-close").textContent = rp(c.closing);
  }
  function proofCell(t) {
    if (!t.bukti_path) return h("span", { class: "muted" }, "-");
    if (t.bukti_tipe && t.bukti_tipe.indexOf("image/") === 0) {
      return h("button", { type: "button", class: "linkbtn", onclick: function (ev) { openProof(t, ev.currentTarget); } }, "Lihat");
    }
    return h("a", { class: "linkbtn", href: proofUrl(t.bukti_path), target: "_blank", rel: "noopener" }, "Lihat PDF");
  }
  function rowEl(t) {
    var isIn = t.jenis === "masuk";
    var tr = h("tr", { class: state.editing && state.editing.id === t.id ? "editing" : "" },
      h("td", { class: "date" }, dateLabel(t.tanggal)),
      h("td", {}, t.keterangan || h("span", { class: "muted" }, "-")),
      h("td", {}, t.pihak || h("span", { class: "muted" }, "-"), h("div", { class: "sub2" }, isIn ? "Sumber dana" : "Tujuan dana")),
      h("td", { class: "r in" }, isIn ? rp(t.nominal) : ""),
      h("td", { class: "r out" }, isIn ? "" : rp(t.nominal)),
      h("td", { class: "r" }, rp(t.saldo)),
      h("td", {}, proofCell(t))
    );
    if (state.admin) {
      var act = h("div", { class: "rowact" });
      if (state.confirmDel === t.id) {
        act.append(
          h("button", { type: "button", class: "btn danger small", onclick: function () { doDelete(t); } }, "Ya, hapus"),
          h("button", { type: "button", class: "btn ghost small", onclick: function () { state.confirmDel = null; renderAll(); } }, "Batal")
        );
      } else {
        act.append(
          h("button", { type: "button", class: "btn ghost small", onclick: function () { startEdit(t); } }, "Ubah"),
          h("button", { type: "button", class: "btn danger ghost small", onclick: function () { state.confirmDel = t.id; renderAll(); } }, "Hapus")
        );
      }
      tr.append(h("td", { class: "r" }, act));
    }
    return tr;
  }
  function renderTable(c) {
    var wrap = $("#tablewrap");
    wrap.textContent = "";
    $("#ledger-title").textContent = "Buku kas " + monthLabel(state.period).toLowerCase();
    $("#ledger-count").textContent = state.loaded && !state.loadError ? c.rows.length + " transaksi" : "";
    if (!sb) {
      wrap.append(h("p", { class: "empty" }, "Portal belum terhubung ke Supabase. Isi file config.js sesuai panduan di README."));
      return;
    }
    if (state.loadError) { wrap.append(h("p", { class: "empty" }, "Data belum bisa dimuat. Periksa koneksi internet lalu muat ulang halaman.")); return; }
    if (!state.loaded) { wrap.append(h("p", { class: "empty" }, "Memuat data keuangan...")); return; }
    if (!c.rows.length) {
      wrap.append(h("p", { class: "empty" },
        state.admin && !validTx().length
          ? "Belum ada transaksi. Catat pemasukan atau pengeluaran pertama lewat formulir di atas."
          : "Belum ada transaksi pada periode ini."));
      return;
    }
    var head = ["Tanggal", "Keterangan", "Sumber / tujuan dana", "Masuk", "Keluar", "Saldo", "Bukti"];
    var tr = h("tr", {});
    head.forEach(function (t, i) { tr.append(h("th", { class: i >= 3 && i <= 5 ? "r" : "" }, t)); });
    if (state.admin) tr.append(h("th", { class: "r" }, "Aksi"));
    var tbody = h("tbody", {});
    c.rows.forEach(function (t) { tbody.append(rowEl(t)); });
    wrap.append(h("table", {}, h("thead", {}, tr), tbody));
  }
  function renderPihakList() {
    var jenis = currentJenis();
    var seen = {};
    validTx().forEach(function (t) { if (t.jenis === jenis && t.pihak) seen[t.pihak] = 1; });
    var dl = $("#pihak-list");
    dl.textContent = "";
    Object.keys(seen).sort().forEach(function (p) { dl.append(h("option", { value: p })); });
  }
  function renderFinance() {
    renderPeriod();
    var c = compute(state.period);
    renderSummary(c);
    renderTable(c);
    renderPihakList();
    $("#exportbar").hidden = !(state.loaded && !state.loadError);
    $("#btn-pdf").hidden = !(window.jspdf && window.jspdf.jsPDF);
  }
  function applyAuthUi() {
    $("#adminPanel").hidden = !state.admin;
    $("#settings").hidden = !state.admin;
    $("#btn-login").hidden = state.signedIn || !sb;
    $("#btn-logout").hidden = !state.signedIn;
    var badge = $("#roleBadge");
    badge.hidden = !state.signedIn;
    badge.textContent = state.staff ? state.label + ": " + state.email : state.email + " (bukan pengurus)";
    $("#wf-nik").closest("label").hidden = !state.admin;
    if (!state.admin) $("#wf-nik").checked = false;
    var wl = $("#welcome");
    wl.hidden = !state.staff;
    if (state.staff) {
      var pr = state.profile || {};
      $("#welcome-role").textContent = state.label;
      $("#welcome-sub").textContent = (pr.nama ? pr.nama + " · " : "") + (state.admin
        ? "Akses penuh: keuangan, berita, pengumuman, info penting, laporan, data warga, dan daftar pengurus."
        : "Akses Anda: menulis berita dan menginput data warga.");
    }
    if (state.signedIn) $("#loginPanel").hidden = true;
  }

  // ---------- bukti ----------
  function openProof(t, opener) {
    state.opener = opener || null;
    var url = proofUrl(t.bukti_path);
    $("#proof").setAttribute("aria-label", "Bukti transaksi");
    $("#proof-img").alt = "Bukti transaksi";
    $("#proof-img").src = url;
    $("#proof-open").href = url;
    $("#proof-cap").textContent = dateLabel(t.tanggal) + " · " + (t.pihak || "") + " · " + rp(t.nominal);
    $("#proof").hidden = false;
    $("#proof-x").focus();
  }
  function closeProof() {
    $("#proof").hidden = true;
    $("#proof-img").removeAttribute("src");
    if (state.opener) state.opener.focus();
  }

  // ---------- data keuangan ----------
  async function fetchTx() {
    var out = [], from = 0, size = 1000;
    for (;;) {
      var r = await sb.from("transaksi").select("*")
        .order("tanggal", { ascending: true }).order("created_at", { ascending: true })
        .range(from, from + size - 1);
      if (r.error) throw r.error;
      out = out.concat(r.data);
      if (r.data.length < size) break;
      from += size;
    }
    return out;
  }
  async function loadAll() {
    if (!sb) { renderAll(); return; }
    try {
      var res = await Promise.all([fetchTx(), sb.from("pengaturan").select("*").eq("id", 1).maybeSingle()]);
      if (res[1].error) throw res[1].error;
      state.tx = res[0];
      var d = res[1].data || {};
      state.cfg = { namaRT: d.nama_rt || "", saldoAwal: Number(d.saldo_awal) || 0 };
      if (state.loadError) flash("");
      state.loadError = false;
      state.loaded = true;
      fillSettings();
    } catch (e) {
      state.loadError = true;
      state.loaded = true;
      console.error("Gagal memuat data:", e);
      var code = e && e.code ? String(e.code) : "";
      var hint = "Periksa koneksi internet atau pengaturan Supabase.";
      if (code === "42501") hint = "Izin akses tabel belum diberikan. Jalankan ulang supabase-setup.sql versi terbaru di SQL Editor.";
      else if (code === "42P01" || code === "PGRST205") hint = "Tabel belum dibuat. Jalankan supabase-setup.sql di SQL Editor.";
      var detail = e && (e.code || e.message) ? " [" + [e.code, e.message].filter(Boolean).join(": ") + "]" : "";
      flash("Data belum bisa dimuat. " + hint + detail, "err");
    }
    renderAll();
  }
  function fillSettings() {
    if (!state.admin) return;
    if (document.activeElement !== $("#c-nama")) $("#c-nama").value = state.cfg.namaRT;
    if (document.activeElement !== $("#c-saldo")) $("#c-saldo").value = state.cfg.saldoAwal ? fmtInput(state.cfg.saldoAwal) : "";
  }

  // ---------- login ----------
  async function refreshAuth(session) {
    state.signedIn = !!(session && session.user);
    state.email = state.signedIn ? (session.user.email || "") : "";
    state.admin = false; state.staff = false; state.role = ""; state.label = ""; state.profile = null;
    if (state.signedIn) {
      var r = await sb.rpc("profil_saya");
      if (r.error) {
        // supabase-tahap4.sql belum dijalankan: pakai pemeriksa lama supaya pengurus tidak terkunci.
        var r0 = await sb.rpc("is_admin");
        if (r0.data === true) state.profile = { peran: "ketua", label: "Pengurus", nama: null, gang: null };
      } else if (r.data && typeof r.data === "object") {
        state.profile = r.data;
      }
    }
    if (state.profile) {
      state.staff = true;
      state.role = state.profile.peran;
      state.label = state.profile.label || "Pengurus";
      state.admin = state.role === "ketua" || state.role === "wakil";
    }
    // Data warga hanya dimuat untuk pengurus. Pengunjung biasa tidak pernah meminta tabel ini.
    if (state.staff) { if (!state.wLoaded) loadWarga(); } else { clearWarga(); }
    if (state.admin) { if (!state.gLoaded) loadPengurus(); } else { clearPengurus(); }
    if (!state.admin) clearRondaAdmin();
    if (state.admin) { if (!state.iAdmLoaded) loadIklanAdmin(); } else { clearIklanAdmin(); }
    loadRonda();
    // Pengurus membaca tabel laporan lengkap, warga membaca tampilan publik.
    if (state.lSrc && state.lSrc !== (state.admin ? "laporan" : "laporan_publik")) { state.lManage = null; state.lDraft = null; loadLaporan(); }
    applyAuthUi();
    fillSettings();
    renderAll();
  }
  async function onLogin(ev) {
    ev.preventDefault();
    var msg = $("#l-msg");
    var email = $("#l-email").value.trim();
    var pass = $("#l-pass").value;
    if (!email || !pass) { msg.textContent = "Isi email dan kata sandi."; return; }
    var btn = $("#l-submit");
    btn.disabled = true; msg.textContent = "Memeriksa...";
    var r = await sb.auth.signInWithPassword({ email: email, password: pass });
    btn.disabled = false;
    if (r.error) { msg.textContent = "Email atau kata sandi salah."; return; }
    msg.textContent = "";
    $("#l-pass").value = "";
    $("#loginPanel").hidden = true;
  }
  async function onLogout() { await sb.auth.signOut(); resetForm(false); }

  // ---------- form transaksi ----------
  function currentJenis() {
    var r = document.querySelector('input[name="jenis"]:checked');
    return r ? r.value : "masuk";
  }
  function syncJenisLabels() {
    var masuk = currentJenis() === "masuk";
    $("#l-pihak").textContent = masuk ? "Sumber dana" : "Tujuan dana";
    $("#f-pihak").placeholder = masuk ? "Contoh: Iuran warga Blok A" : "Contoh: Petugas kebersihan";
    renderPihakList();
  }
  function resetForm(keepDate) {
    var date = keepDate ? $("#f-tanggal").value : todayISO();
    $("#form").reset();
    $("#f-tanggal").value = date || todayISO();
    state.editing = null;
    $("#form-title").textContent = "Catat transaksi";
    $("#f-submit").textContent = "Simpan transaksi";
    $("#f-cancel").hidden = true;
    $("#bukti-note").hidden = true;
    syncJenisLabels();
  }
  function startEdit(t) {
    state.editing = t;
    state.confirmDel = null;
    document.getElementById(t.jenis === "masuk" ? "jenis-masuk" : "jenis-keluar").checked = true;
    $("#f-tanggal").value = t.tanggal;
    $("#f-pihak").value = t.pihak || "";
    $("#f-nominal").value = fmtInput(t.nominal);
    $("#f-ket").value = t.keterangan || "";
    $("#f-bukti").value = "";
    var note = $("#bukti-note");
    note.textContent = t.bukti_path ? "Bukti saat ini: " + (t.bukti_nama || "terlampir") + ". Pilih file baru untuk menggantinya." : "Transaksi ini belum punya bukti.";
    note.hidden = false;
    $("#form-title").textContent = "Ubah transaksi";
    $("#f-submit").textContent = "Simpan perubahan";
    $("#f-cancel").hidden = false;
    $("#f-msg").textContent = "";
    syncJenisLabels();
    renderAll();
    $("#adminPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  var EXT_TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf" };
  var OK_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
  var TYPE_EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };
  function fileType(f) {
    if (OK_TYPES.indexOf(f.type) >= 0) return f.type;
    var m = /\.([a-z0-9]+)$/i.exec(f.name || "");
    return m ? EXT_TYPES[m[1].toLowerCase()] || null : null;
  }
  async function prepareFile(file, type) {
    if (type.indexOf("image/") !== 0 || file.size < 500 * 1024) return { blob: file, type: type };
    try {
      var bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      var max = 1800, scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
      var cv = document.createElement("canvas");
      cv.width = Math.round(bmp.width * scale);
      cv.height = Math.round(bmp.height * scale);
      var ctx = cv.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
      var blob = await new Promise(function (res) { cv.toBlob(res, "image/jpeg", 0.82); });
      if (blob && blob.size < file.size) return { blob: blob, type: "image/jpeg" };
    } catch (e) { /* pakai file asli */ }
    return { blob: file, type: type };
  }
  function errText(e, fallback) {
    var code = e && (e.code || e.statusCode || e.status);
    var m = e && e.message ? String(e.message).toLowerCase() : "";
    if (String(code) === "23505") return "Data ini sudah ada (nomor yang sama sudah terdaftar).";
    if (String(code) === "42501" || String(code) === "403" || m.indexOf("row-level security") >= 0 || m.indexOf("not allowed") >= 0) {
      return "Anda tidak punya izin menyimpan data. Masuk dengan akun pengurus.";
    }
    if (m.indexOf("exceeded") >= 0 || String(code) === "413") return "File terlalu besar. Batasnya 10 MB.";
    if (m.indexOf("mime") >= 0) return "Format file tidak didukung. Gunakan JPG, PNG, WebP, atau PDF.";
    return fallback;
  }
  async function onSubmit(ev) {
    ev.preventDefault();
    if (state.saving || !sb || !state.admin) return;
    var msg = $("#f-msg");
    var tanggal = $("#f-tanggal").value;
    var pihak = $("#f-pihak").value.trim();
    var nominal = Number(digits($("#f-nominal").value));
    var jenis = currentJenis();
    if (!tanggal) { msg.textContent = "Isi tanggal transaksi."; return; }
    if (!pihak) { msg.textContent = jenis === "masuk" ? "Isi sumber dana." : "Isi tujuan dana."; return; }
    if (!nominal) { msg.textContent = "Isi nominal lebih dari nol."; return; }
    var file = $("#f-bukti").files[0];
    var type = null;
    if (file) {
      type = fileType(file);
      if (!type) { msg.textContent = "Format file tidak didukung. Gunakan JPG, PNG, WebP, atau PDF. Foto HEIC dari iPhone perlu diubah ke JPG."; return; }
    }
    state.saving = true;
    var btn = $("#f-submit");
    btn.disabled = true;
    btn.textContent = "Menyimpan...";
    msg.textContent = "";
    var uploadedPath = null;
    try {
      var ed = state.editing;
      var bukti = ed ? { bukti_path: ed.bukti_path || null, bukti_tipe: ed.bukti_tipe || null, bukti_nama: ed.bukti_nama || null }
                     : { bukti_path: null, bukti_tipe: null, bukti_nama: null };
      var oldPath = null;
      if (file) {
        var prep = await prepareFile(file, type);
        uploadedPath = (window.crypto.randomUUID ? window.crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)) + "." + TYPE_EXT[prep.type];
        var up = await sb.storage.from(BUCKET).upload(uploadedPath, prep.blob, { contentType: prep.type, upsert: false });
        if (up.error) throw up.error;
        oldPath = ed && ed.bukti_path ? ed.bukti_path : null;
        bukti = { bukti_path: uploadedPath, bukti_tipe: prep.type, bukti_nama: file.name };
      }
      var row = Object.assign({ tanggal: tanggal, jenis: jenis, pihak: pihak, nominal: nominal, keterangan: $("#f-ket").value.trim() }, bukti);
      var r;
      if (ed) r = await sb.from("transaksi").update(row).eq("id", ed.id).select();
      else r = await sb.from("transaksi").insert(row).select();
      if (r.error) throw r.error;
      if (!r.data || !r.data.length) throw { code: "42501" };
      if (oldPath) sb.storage.from(BUCKET).remove([oldPath]);
      state.period = tanggal.slice(0, 7);
      state.periodChosen = true;
      var wasEdit = !!ed;
      resetForm(true);
      msg.textContent = wasEdit ? "Perubahan tersimpan." : "Transaksi tersimpan.";
      await loadAll();
    } catch (e) {
      if (uploadedPath) sb.storage.from(BUCKET).remove([uploadedPath]);
      msg.textContent = errText(e, "Gagal menyimpan. Periksa koneksi lalu coba lagi.");
    } finally {
      state.saving = false;
      btn.disabled = false;
      btn.textContent = state.editing ? "Simpan perubahan" : "Simpan transaksi";
    }
  }
  async function doDelete(t) {
    try {
      var r = await sb.from("transaksi").delete().eq("id", t.id).select();
      if (r.error) throw r.error;
      if (!r.data || !r.data.length) throw { code: "42501" };
      if (t.bukti_path) sb.storage.from(BUCKET).remove([t.bukti_path]);
      state.confirmDel = null;
      if (state.editing && state.editing.id === t.id) resetForm(false);
      flashTemp("Transaksi dihapus.", "ok");
      await loadAll();
    } catch (e) {
      flash(errText(e, "Gagal menghapus. Coba lagi."), "err");
    }
  }
  async function saveConfig() {
    var msg = $("#c-msg");
    try {
      var r = await sb.from("pengaturan").update({
        nama_rt: $("#c-nama").value.trim(),
        saldo_awal: Number(digits($("#c-saldo").value)) || 0
      }).eq("id", 1).select();
      if (r.error) throw r.error;
      if (!r.data || !r.data.length) throw { code: "42501" };
      msg.textContent = "Pengaturan tersimpan.";
      await loadAll();
    } catch (e) {
      msg.textContent = errText(e, "Gagal menyimpan pengaturan.");
    }
  }

  // ---------- unduhan keuangan ----------
  function fileStem() {
    var nama = (state.cfg.namaRT || "rt").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "rt";
    return "laporan-keuangan-" + nama + "-" + (state.period === ALL ? "semua-periode" : state.period);
  }
  function downloadBlob(blob, name) {
    var a = h("a", { href: URL.createObjectURL(blob), download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  function csvCell(v) { return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"'; }
  function pdfFooter(doc) {
    var pages = doc.getNumberOfPages();
    var w = doc.internal.pageSize.getWidth(), ht = doc.internal.pageSize.getHeight();
    doc.setFontSize(8);
    for (var i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.text("Halaman " + i + " dari " + pages, w - 40, ht - 24, { align: "right" });
    }
  }
  function exportPdf() {
    if (!(window.jspdf && window.jspdf.jsPDF)) return;
    var c = compute(state.period);
    var doc = new window.jspdf.jsPDF({ unit: "pt", format: "a4" });
    var nama = state.cfg.namaRT || "RT 007/016";
    doc.setFont("helvetica", "bold"); doc.setFontSize(16);
    doc.text("Laporan Keuangan " + nama, 40, 50);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    doc.text("Periode: " + monthLabel(state.period), 40, 68);
    doc.text("Dicetak: " + new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }), 40, 82);
    doc.autoTable({
      startY: 98, margin: { left: 40, right: 40 }, tableWidth: 280, theme: "grid",
      head: [["Ringkasan", "Jumlah"]],
      body: [["Saldo awal", rp(c.opening)], ["Total pemasukan", rp(c.masuk)], ["Total pengeluaran", rp(c.keluar)], ["Saldo akhir", rp(c.closing)]],
      styles: { fontSize: 9 }, headStyles: { fillColor: [217, 80, 10] }, columnStyles: { 1: { halign: "right" } }
    });
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 20, margin: { left: 40, right: 40 }, theme: "grid",
      head: [["Tanggal", "Keterangan", "Sumber / tujuan", "Masuk", "Keluar", "Saldo", "Bukti"]],
      body: c.rows.map(function (t) {
        return [dateLabel(t.tanggal), t.keterangan || "-", t.pihak || "-",
          t.jenis === "masuk" ? rp(t.nominal) : "", t.jenis === "keluar" ? rp(t.nominal) : "", rp(t.saldo), t.bukti_path ? "Ada" : "-"];
      }),
      foot: [["", "", "Total", rp(c.masuk), rp(c.keluar), "", ""]], showFoot: "lastPage",
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [217, 80, 10] }, footStyles: { fillColor: [235, 232, 222], textColor: 20, fontStyle: "bold" },
      columnStyles: { 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "center", cellWidth: 36 } }
    });
    pdfFooter(doc);
    doc.save(fileStem() + ".pdf");
  }
  function exportCsv() {
    var c = compute(state.period);
    var lines = [["Tanggal", "Jenis", "Sumber/Tujuan dana", "Keterangan", "Masuk", "Keluar", "Saldo", "Bukti"].map(csvCell).join(",")];
    c.rows.forEach(function (t) {
      lines.push([t.tanggal, t.jenis === "masuk" ? "Pemasukan" : "Pengeluaran", t.pihak, t.keterangan,
        t.jenis === "masuk" ? t.nominal : "", t.jenis === "keluar" ? t.nominal : "", t.saldo, t.bukti_path ? "Ada" : ""].map(csvCell).join(","));
    });
    downloadBlob(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }), fileStem() + ".csv");
  }

  // ---------- tab ----------
  var TABS = [
    { id: "beranda", label: "Beranda" },
    { id: "laporan", label: "Laporan" },
    { id: "ronda", label: "Ronda" },
    { id: "info", label: "Info Penting" },
    { id: "keuangan", label: "Keuangan" },
    { id: "warga", label: "Data Warga", staff: true },
    { id: "atur", label: "Atur Ronda", admin: true },
    { id: "iklan", label: "Iklan", admin: true },
    { id: "pengurus", label: "Pengurus", admin: true }
  ];
  function tabsFor() { return TABS.filter(function (t) { return (!t.admin || state.admin) && (!t.staff || state.staff); }); }
  function activeTab() {
    var t = (location.hash || "").slice(1);
    return tabsFor().some(function (x) { return x.id === t; }) ? t : "beranda";
  }
  function renderTabs(cur) {
    var nav = $("#tabs");
    nav.textContent = "";
    tabsFor().forEach(function (t) {
      nav.append(h("button", {
        type: "button", class: "tab", role: "tab", "aria-selected": String(t.id === cur),
        onclick: function () { if (location.hash === "#" + t.id) renderAll(); else location.hash = t.id; }
      }, t.label));
    });
  }
  function renderAll() {
    var cur = activeTab();
    renderTabs(cur);
    adReset();
    TABS.forEach(function (t) { $("#tab-" + t.id).hidden = t.id !== cur; });
    renderPinned();
    if (cur === "keuangan") renderFinance();
    else if (cur === "warga") renderWarga();
    else if (cur === "pengurus") renderPengurus();
    else if (cur === "laporan") renderLaporan();
    else if (cur === "ronda") renderRonda();
    else if (cur === "atur") renderAtur();
    else if (cur === "iklan") renderIklanAdmin();
    else if (cur === "info") { renderInfo(); renderInfoAds(); }
    else { renderBerita(); renderPengAdmin(); }
  }

  // ======================================================================
  // BERITA (Beranda)
  // ======================================================================
  var FOTO_DIR = "berita/";
  var LONG_CHARS = 420;

  async function fetchBerita() {
    var out = [], from = 0, size = 1000;
    for (;;) {
      var r = await sb.from("berita").select("*")
        .order("tanggal", { ascending: false }).order("created_at", { ascending: false })
        .range(from, from + size - 1);
      if (r.error) throw r.error;
      out = out.concat(r.data);
      if (r.data.length < size) break;
      from += size;
    }
    return out;
  }
  async function loadBerita() {
    if (!sb) return;
    try {
      state.berita = await fetchBerita();
      state.bError = null;
    } catch (e) {
      console.error("Gagal memuat berita:", e);
      state.bError = e || {};
    }
    state.bLoaded = true;
    renderAll();
  }
  function bErrText(e) {
    var c = e && e.code ? String(e.code) : "";
    if (c === "42P01" || c === "PGRST205") return "Tabel berita belum dibuat. Jalankan supabase-berita.sql di SQL Editor Supabase.";
    if (c === "42501") return "Izin akses tabel berita belum diberikan. Jalankan supabase-berita.sql di SQL Editor Supabase.";
    return "Berita belum bisa dimuat. " + (e && e.message ? "[" + (c ? c + ": " : "") + e.message + "]" : "Periksa koneksi internet.");
  }

  function openPhoto(b, opener) {
    state.opener = opener || null;
    var url = proofUrl(b.foto_path);
    $("#proof").setAttribute("aria-label", "Foto berita");
    $("#proof-img").src = url;
    $("#proof-img").alt = "Foto: " + b.judul;
    $("#proof-open").href = url;
    $("#proof-cap").textContent = b.judul;
    $("#proof").hidden = false;
    $("#proof-x").focus();
  }

  // ---------- bagikan ke WhatsApp ----------
  // Memakai tautan resmi wa.me: tidak butuh server, dan pengguna sendiri yang memilih
  // grup atau kontak tujuan di WhatsApp. Tidak ada data yang dikirim ke pihak lain.
  function portalUrl() { return window.location.origin + window.location.pathname + "#beranda"; }
  function waClean(t) { return String(t || "").replace(/[*_~`]/g, "").replace(/\s+/g, " ").trim(); }
  function waCut(t, max) {
    t = String(t || "").replace(/\r\n/g, "\n").trim();
    if (t.length <= max) return t;
    var c = t.slice(0, max), i = c.lastIndexOf(" ");
    return (i > max * 0.6 ? c.slice(0, i) : c).trim() + "...";
  }
  function waShareLink(text, label) {
    return h("a", {
      class: "btn ghost small share", href: "https://wa.me/?text=" + encodeURIComponent(text),
      target: "_blank", rel: "noopener", "aria-label": label
    }, "Bagikan ke WhatsApp");
  }
  function beritaShareText(b) {
    var parts = ["*" + waClean(b.judul) + "*", longDate(b.tanggal)];
    if (b.isi) parts.push("", waCut(b.isi, 400));
    parts.push("", "Selengkapnya di Portal Data Warga 007/016:", portalUrl());
    return parts.join("\n");
  }
  function pengShareText(p) {
    var parts = ["*PENGUMUMAN: " + waClean(p.judul) + "*"];
    if (p.acara_tanggal) parts.push("Tanggal: " + longDate(p.acara_tanggal));
    if (p.acara_jam) parts.push("Jam: " + waClean(p.acara_jam));
    if (p.tempat) parts.push("Tempat: " + waClean(p.tempat));
    if (p.isi) parts.push("", waCut(p.isi, 400));
    parts.push("", "Info lengkap di Portal Data Warga 007/016:", portalUrl());
    return parts.join("\n");
  }

  // Ketua dan Wakil boleh mengubah semua berita; PIC hanya berita miliknya sendiri.
  function canEditBerita(b) {
    return state.admin || (state.staff && !!b.oleh_email && b.oleh_email === String(state.email || "").toLowerCase());
  }
  function postEl(b) {
    var isi = b.isi || "";
    var isLong = isi.length > LONG_CHARS || isi.split("\n").length > 8;
    var open = !!state.bOpen[b.id];
    var editing = state.bEdit && state.bEdit.id === b.id;
    var body = h("div", { class: "postbody" },
      h("p", { class: "postdate" }, longDate(b.tanggal), b.oleh_label ? h("span", { class: "postby" }, " · Diposting oleh " + b.oleh_label) : null),
      h("h3", {}, b.judul),
      isi ? h("p", { class: "posttext" + (isLong && !open ? " clamp" : "") }, isi) : null);
    if (isLong) {
      body.append(h("button", {
        type: "button", class: "linkbtn more", "aria-expanded": String(open),
        onclick: function () { state.bOpen[b.id] = !open; renderBerita(); }
      }, open ? "Tutup" : "Baca selengkapnya"));
    }
    var act = h("div", { class: "rowact left" }, waShareLink(beritaShareText(b), "Bagikan berita ke WhatsApp: " + b.judul));
    if (canEditBerita(b)) {
      if (state.bConfirmDel === b.id) {
        act.append(
          h("button", { type: "button", class: "btn danger small", onclick: function () { deleteBerita(b); } }, "Ya, hapus berita"),
          h("button", { type: "button", class: "btn ghost small", onclick: function () { state.bConfirmDel = null; renderBerita(); } }, "Batal"));
      } else {
        act.append(
          h("button", { type: "button", class: "btn ghost small", onclick: function () { openBForm(b); } }, "Ubah"),
          h("button", { type: "button", class: "btn danger ghost small", onclick: function () { state.bConfirmDel = b.id; renderBerita(); } }, "Hapus"));
      }
    }
    body.append(act);
    var card = h("article", { class: "postcard" + (editing ? " editing" : "") });
    if (b.foto_path) {
      card.append(h("button", {
        type: "button", class: "postimg", "aria-label": "Perbesar foto: " + b.judul,
        onclick: function (ev) { openPhoto(b, ev.currentTarget); }
      }, h("img", { src: proofUrl(b.foto_path), alt: "", loading: "lazy" })));
    }
    card.append(body);
    return h("li", { class: "post" }, card);
  }

  function renderBerita() {
    var wrap = $("#b-list");
    wrap.textContent = "";
    var err = $("#b-error");
    $("#btn-badd").hidden = !state.staff;
    if (!state.staff && !$("#bPanel").hidden) { resetBForm(); $("#bPanel").hidden = true; }
    $("#b-more-wrap").hidden = true;
    if (!sb) {
      err.hidden = true;
      wrap.append(h("p", { class: "empty card" }, "Portal belum terhubung ke Supabase. Isi file config.js sesuai panduan di README."));
      return;
    }
    if (state.bError) { err.textContent = bErrText(state.bError); err.hidden = false; return; }
    err.hidden = true;
    if (!state.bLoaded) { wrap.append(h("p", { class: "empty card" }, "Memuat berita...")); return; }
    var all = state.berita.filter(function (b) { return b && typeof b.tanggal === "string" && /^\d{4}-\d{2}-\d{2}/.test(b.tanggal); });
    if (!all.length) {
      wrap.append(h("p", { class: "empty card" }, state.staff
        ? "Belum ada berita. Klik Tulis berita untuk menerbitkan yang pertama."
        : "Belum ada berita."));
      return;
    }
    var ol = h("ol", { class: "timeline" });
    var last = "";
    all.slice(0, state.bLimit).forEach(function (b) {
      var m = b.tanggal.slice(0, 7);
      if (m !== last) { ol.append(h("li", { class: "monthmark" }, monthLabel(m))); last = m; }
      var pe = postEl(b); pe.setAttribute("data-post", "1");
      ol.append(pe);
    });
    adsInTimeline(ol, [].slice.call(ol.querySelectorAll("li[data-post]")));
    wrap.append(ol);
    $("#b-more-wrap").hidden = all.length <= state.bLimit;
  }

  // ---------- form berita ----------
  var previewUrl = null;
  function setPreview(src) {
    var wrapEl = $("#b-preview-wrap"), img = $("#b-preview");
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
    if (!src) { img.removeAttribute("src"); wrapEl.hidden = true; return; }
    img.src = src;
    wrapEl.hidden = false;
  }
  function resetBForm() {
    $("#bform").reset();
    $("#b-tanggal").value = todayISO();
    state.bEdit = null;
    $("#bform-title").textContent = "Tulis berita";
    $("#b-submit").textContent = "Terbitkan";
    $("#b-hapusfoto-wrap").hidden = true;
    $("#b-count").textContent = "0 / 5000";
    setPreview(null);
  }
  function openBForm(b) {
    resetBForm();
    $("#b-msg").textContent = "";
    state.bConfirmDel = null;
    if (b) {
      state.bEdit = b;
      $("#bform-title").textContent = "Ubah berita";
      $("#b-submit").textContent = "Simpan perubahan";
      $("#b-judul").value = b.judul || "";
      $("#b-tanggal").value = b.tanggal;
      $("#b-isi").value = b.isi || "";
      $("#b-count").textContent = (b.isi || "").length + " / 5000";
      if (b.foto_path) { setPreview(proofUrl(b.foto_path)); $("#b-hapusfoto-wrap").hidden = false; }
    }
    $("#bPanel").hidden = false;
    renderBerita();
    $("#bPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    $("#b-judul").focus();
  }
  function closeBForm() {
    resetBForm();
    $("#bPanel").hidden = true;
    $("#b-msg").textContent = "";
    renderBerita();
  }
  async function onBeritaSubmit(ev) {
    ev.preventDefault();
    if (state.bSaving || !sb || !state.staff) return;
    var msg = $("#b-msg");
    var judul = $("#b-judul").value.trim().replace(/\s+/g, " ");
    var isi = $("#b-isi").value.replace(/\r\n/g, "\n").trim();
    var tanggal = $("#b-tanggal").value;
    if (!judul) { msg.textContent = "Isi judul berita."; return; }
    if (!isi) { msg.textContent = "Isi berita tidak boleh kosong."; return; }
    if (!tanggal) { msg.textContent = "Isi tanggal berita."; return; }
    var file = $("#b-foto").files[0], type = null;
    if (file) {
      type = fileType(file);
      if (!type || type === "application/pdf") { msg.textContent = "Foto harus berformat JPG, PNG, atau WebP. Foto HEIC dari iPhone perlu diubah ke JPG."; return; }
    }
    state.bSaving = true;
    var btn = $("#b-submit");
    btn.disabled = true; btn.textContent = "Menyimpan...";
    msg.textContent = "";
    var uploadedPath = null;
    try {
      var ed = state.bEdit;
      var foto = ed ? { foto_path: ed.foto_path || null, foto_tipe: ed.foto_tipe || null } : { foto_path: null, foto_tipe: null };
      var oldPath = null;
      if (file) {
        var prep = await prepareFile(file, type);
        uploadedPath = FOTO_DIR + (window.crypto.randomUUID ? window.crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)) + "." + TYPE_EXT[prep.type];
        var up = await sb.storage.from(BUCKET).upload(uploadedPath, prep.blob, { contentType: prep.type, upsert: false });
        if (up.error) throw up.error;
        oldPath = ed && ed.foto_path ? ed.foto_path : null;
        foto = { foto_path: uploadedPath, foto_tipe: prep.type };
      } else if (ed && ed.foto_path && $("#b-hapusfoto").checked) {
        oldPath = ed.foto_path;
        foto = { foto_path: null, foto_tipe: null };
      }
      var row = Object.assign({ tanggal: tanggal, judul: judul, isi: isi }, foto);
      var r = ed ? await sb.from("berita").update(row).eq("id", ed.id).select()
                 : await sb.from("berita").insert(row).select();
      if (r.error) throw r.error;
      if (!r.data || !r.data.length) throw { code: "42501" };
      if (oldPath) sb.storage.from(BUCKET).remove([oldPath]);
      var wasEdit = !!ed;
      resetBForm();
      $("#bPanel").hidden = true;
      flashTemp(wasEdit ? "Perubahan tersimpan." : "Berita diterbitkan.", "ok");
      await loadBerita();
    } catch (e) {
      if (uploadedPath) sb.storage.from(BUCKET).remove([uploadedPath]);
      msg.textContent = errText(e, "Gagal menyimpan. Periksa koneksi lalu coba lagi.");
    } finally {
      state.bSaving = false;
      btn.disabled = false;
      btn.textContent = state.bEdit ? "Simpan perubahan" : "Terbitkan";
    }
  }
  async function deleteBerita(b) {
    try {
      var r = await sb.from("berita").delete().eq("id", b.id).select("id");
      if (r.error) throw r.error;
      if (!r.data || !r.data.length) throw { code: "42501" };
      if (b.foto_path) sb.storage.from(BUCKET).remove([b.foto_path]);
      state.bConfirmDel = null;
      if (state.bEdit && state.bEdit.id === b.id) closeBForm();
      flashTemp("Berita dihapus.", "ok");
      await loadBerita();
    } catch (e) {
      flash(errText(e, "Gagal menghapus. Coba lagi."), "err");
    }
  }


  // ======================================================================
  // DATA WARGA (hanya pengurus)
  // ======================================================================
  var AGE = [
    { id: "balita", label: "Balita", range: "0-4 th" },
    { id: "anak", label: "Anak", range: "5-12 th" },
    { id: "remaja", label: "Remaja", range: "13-17 th" },
    { id: "dewasa", label: "Dewasa", range: "18-59 th" },
    { id: "lansia", label: "Lansia", range: "60+ th" }
  ];
  function ageInfo(id) { return AGE.filter(function (g) { return g.id === id; })[0]; }
  function ageOf(iso) {
    if (!iso) return null;
    var p = iso.split("-").map(Number), n = new Date();
    var a = n.getFullYear() - p[0];
    var m = n.getMonth() + 1 - p[1];
    if (m < 0 || (m === 0 && n.getDate() < p[2])) a--;
    return a < 0 ? null : a;
  }
  function ageGroup(a) {
    if (a == null) return "x";
    if (a < 5) return "balita";
    if (a <= 12) return "anak";
    if (a <= 17) return "remaja";
    if (a < 60) return "dewasa";
    return "lansia";
  }
  // Samakan huruf besar/kecil nama gang dengan yang sudah ada, supaya
  // "gang mawar" dan "Gang Mawar" tidak dihitung dua gang berbeda.
  function canonGang(v) {
    v = v.trim().replace(/\s+/g, " ");
    var k = v.toLowerCase();
    for (var i = 0; i < state.warga.length; i++) {
      var g = state.warga[i].gang;
      if (g && g.toLowerCase() === k) return g;
    }
    return v;
  }

  async function fetchWarga() {
    var out = [], from = 0, size = 1000;
    for (;;) {
      var r = await sb.from("warga").select("*").order("nama", { ascending: true }).range(from, from + size - 1);
      if (r.error) throw r.error;
      out = out.concat(r.data);
      if (r.data.length < size) break;
      from += size;
    }
    return out;
  }
  async function loadWarga() {
    if (!sb || !state.staff) return;
    try {
      state.warga = await fetchWarga();
      state.wError = null;
    } catch (e) {
      console.error("Gagal memuat data warga:", e);
      state.wError = e || {};
    }
    state.wLoaded = true;
    renderAll();
  }
  function clearWarga() {
    state.warga = []; state.wLoaded = false; state.wError = null; state.wEdit = null; state.wConfirmDel = null;
    resetWForm(false);
    $("#wPanel").hidden = true;
    $("#w-table").textContent = "";
    $("#w-agechips").textContent = "";
  }
  function wErrText(e) {
    var c = e && e.code ? String(e.code) : "";
    if (c === "42501") return "Izin akses tabel warga belum diberikan. Jalankan supabase-warga.sql di SQL Editor Supabase.";
    if (c === "42P01" || c === "PGRST205") return "Tabel warga belum dibuat. Jalankan supabase-warga.sql di SQL Editor Supabase.";
    return "Data warga belum bisa dimuat. " + (e && e.message ? "[" + (c ? c + ": " : "") + e.message + "]" : "Periksa koneksi internet.");
  }

  function filtered() {
    var f = state.wf, q = f.q.trim().toLowerCase();
    var min = f.min === "" ? null : Number(f.min), max = f.max === "" ? null : Number(f.max);
    var list = state.warga.filter(function (w) {
      var a = ageOf(w.tanggal_lahir);
      if (q && (w.nama || "").toLowerCase().indexOf(q) < 0 && (w.no_telepon || "").indexOf(q) < 0 &&
          (w.no_kk || "").indexOf(q) < 0 && (w.no_ktp || "").indexOf(q) < 0) return false;
      if (f.umur && ageGroup(a) !== f.umur) return false;
      if (min != null && (a == null || a < min)) return false;
      if (max != null && (a == null || a > max)) return false;
      if (f.gang && (w.gang || "").toLowerCase() !== f.gang) return false;
      if (f.mukim && w.status_mukim !== f.mukim) return false;
      if (f.rumah && w.status_rumah !== f.rumah) return false;
      if (f.ktp && w.domisili_ktp !== f.ktp) return false;
      if (f.ronda === "ya" && !ikutRonda(w)) return false;
      if (f.ronda === "tidak" && ikutRonda(w)) return false;
      return true;
    });
    var s = f.sort;
    list.sort(function (a, b) {
      if (s === "gang") return ncmp(a.gang, b.gang) || ncmp(a.no_rumah, b.no_rumah) || ncmp(a.nama, b.nama);
      if (s === "tua" || s === "muda") {
        var x = ageOf(a.tanggal_lahir), y = ageOf(b.tanggal_lahir);
        if (x == null && y == null) return ncmp(a.nama, b.nama);
        if (x == null) return 1;
        if (y == null) return -1;
        return (s === "tua" ? y - x : x - y) || ncmp(a.nama, b.nama);
      }
      return ncmp(a.nama, b.nama);
    });
    return list;
  }

  function renderAgeChips() {
    var box = $("#w-agechips");
    box.textContent = "";
    var count = { balita: 0, anak: 0, remaja: 0, dewasa: 0, lansia: 0 };
    state.warga.forEach(function (w) { var g = ageGroup(ageOf(w.tanggal_lahir)); if (count[g] != null) count[g]++; });
    function chip(id, label, n) {
      box.append(h("button", {
        type: "button", class: "chipbtn", "aria-pressed": String(state.wf.umur === id),
        onclick: function () {
          state.wf.umur = state.wf.umur === id ? "" : id;
          state.wf.min = ""; state.wf.max = ""; $("#wf-min").value = ""; $("#wf-max").value = "";
          state.wLimit = 100;
          renderAgeChips(); renderWargaList();
        }
      }, label, h("span", { class: "n" }, String(n))));
    }
    chip("", "Semua umur", state.warga.length);
    AGE.forEach(function (g) { chip(g.id, g.label + " (" + g.range + ")", count[g.id]); });
  }
  function renderWargaFilters() {
    var seen = {}, opts = [["", "Semua gang"]];
    state.warga.forEach(function (w) { var k = (w.gang || "").toLowerCase(); if (k && !seen[k]) seen[k] = w.gang; });
    var keys = Object.keys(seen).sort(ncmp);
    keys.forEach(function (k) { opts.push([k, seen[k]]); });
    setOptions($("#wf-gang"), opts, true);
    var dl = $("#gang-list");
    dl.textContent = "";
    keys.forEach(function (k) { dl.append(h("option", { value: seen[k] })); });
    state.wf.gang = $("#wf-gang").value;
    renderAgeChips();
  }
  function renderWargaCounts() {
    var n = state.warga.length, mk = state.warga.filter(function (w) { return w.status_mukim === "mukim"; }).length;
    $("#w-summary").textContent = state.wLoaded && !state.wError
      ? "Total " + n + " warga · " + mk + " mukim · " + (n - mk) + " tidak mukim" : "";
  }
  function wRow(w) {
    var a = ageOf(w.tanggal_lahir);
    var ids = [w.no_kk ? "KK " + mask(w.no_kk) : "", w.no_ktp ? "KTP " + mask(w.no_ktp) : ""].filter(Boolean).join(" · ");
    var info = ageInfo(ageGroup(a));
    var tr = h("tr", { class: state.wEdit && state.wEdit.id === w.id ? "editing" : "" },
      h("td", {}, h("strong", {}, w.nama), ids ? h("div", { class: "sub2" }, ids) : null,
        w.oleh_label ? h("div", { class: "sub2" }, "Dicatat oleh " + w.oleh_label) : null),
      h("td", { class: "date" }, a == null ? "-" : a + " th",
        h("div", { class: "sub2" }, (info ? info.label + " · " : "") + (w.tanggal_lahir ? dateLabel(w.tanggal_lahir) : ""))),
      h("td", {}, w.gang || h("span", { class: "muted" }, "-"), w.no_rumah ? h("div", { class: "sub2" }, "No. " + w.no_rumah) : null),
      h("td", {}, h("div", { class: "chips" },
        h("span", { class: "chip" + (w.status_mukim === "mukim" ? "" : " alt") }, w.status_mukim === "mukim" ? "Mukim" : "Tidak mukim"),
        h("span", { class: "chip" + (w.status_rumah === "milik" ? "" : " alt") }, w.status_rumah === "milik" ? "Milik sendiri" : "Sewa"),
        h("span", { class: "chip" + (w.domisili_ktp === "sarimukti" ? "" : " alt") }, w.domisili_ktp === "sarimukti" ? "KTP Sarimukti" : "KTP luar"),
        ikutRonda(w) ? h("span", { class: "chip alt" }, "Ikut ronda") : null,
        w.kepala_keluarga ? h("span", { class: "chip" }, "Kepala keluarga") : null)),
      h("td", {}, w.no_telepon ? h("a", { class: "linkbtn", href: "tel:" + w.no_telepon }, w.no_telepon) : h("span", { class: "muted" }, "-"))
    );
    var act = h("div", { class: "rowact" });
    if (state.wConfirmDel === w.id) {
      act.append(
        h("button", { type: "button", class: "btn danger small", onclick: function () { deleteWarga(w); } }, "Ya, hapus"),
        h("button", { type: "button", class: "btn ghost small", onclick: function () { state.wConfirmDel = null; renderWargaList(); } }, "Batal"));
    } else {
      act.append(
        h("button", { type: "button", class: "btn ghost small", onclick: function () { openWForm(w); } }, "Ubah"),
        state.admin ? h("button", { type: "button", class: "btn danger ghost small", onclick: function () { state.wConfirmDel = w.id; renderWargaList(); } }, "Hapus") : null);
    }
    tr.append(h("td", { class: "r" }, act));
    return tr;
  }
  function renderWargaList() {
    var wrap = $("#w-table");
    wrap.textContent = "";
    var err = $("#w-error");
    if (state.wError) { err.textContent = wErrText(state.wError); err.hidden = false; } else err.hidden = true;
    renderWargaCounts();
    if (state.wError) { $("#w-count").textContent = ""; $("#w-more-wrap").hidden = true; return; }
    if (!state.wLoaded) { wrap.append(h("p", { class: "empty" }, "Memuat data warga...")); $("#w-more-wrap").hidden = true; return; }
    var list = filtered();
    $("#w-count").textContent = "Menampilkan " + Math.min(list.length, state.wLimit) + " dari " + list.length + " warga" +
      (list.length !== state.warga.length ? " (difilter dari " + state.warga.length + ")" : "");
    if (!list.length) {
      wrap.append(h("p", { class: "empty" }, state.warga.length ? "Tidak ada warga yang cocok dengan filter." : "Belum ada data warga. Klik Tambah warga untuk mulai."));
      $("#w-more-wrap").hidden = true;
      return;
    }
    var tr = h("tr", {});
    ["Nama", "Umur", "Gang / rumah", "Status", "Telepon", ""].forEach(function (t) { tr.append(h("th", {}, t)); });
    var tbody = h("tbody", {});
    list.slice(0, state.wLimit).forEach(function (w) { tbody.append(wRow(w)); });
    wrap.append(h("table", { class: "wide" }, h("thead", {}, tr), tbody));
    $("#w-more-wrap").hidden = list.length <= state.wLimit;
  }
  function renderWarga() {
    state.wHasRonda = state.warga.length ? ("wajib_ronda" in state.warga[0]) : null;
    state.wHasJk = state.warga.length ? ("jenis_kelamin" in state.warga[0]) : null;
    $("#w-ronda").closest(".field").hidden = state.wHasRonda === false;
    $("#w-jk-field").hidden = state.wHasJk === false;
    $("#w-kk-field").hidden = state.wHasJk === false;
    $("#wf-ronda").closest(".field").hidden = state.wHasRonda === false;
    renderWargaFilters();
    renderWargaList();
  }

  // ---------- form warga ----------
  function normPhone(v) { return String(v || "").replace(/[\s().-]/g, ""); }
  // keepFamily: setelah menyimpan, KK, gang, nomor rumah, dan status tetap terisi
  // karena anggota keluarga berikutnya biasanya sama.
  function resetWForm(keepFamily) {
    var keep = keepFamily ? {
      kk: $("#w-kk").value, gang: $("#w-gang").value, rumah: $("#w-rumah").value,
      mukim: pick("w-mukim"), rst: pick("w-rumah-st"), dom: pick("w-ktp-dom")
    } : null;
    $("#wform").reset();
    if (keep) {
      $("#w-kk").value = keep.kk; $("#w-gang").value = keep.gang; $("#w-rumah").value = keep.rumah;
      setPick("w-mukim", keep.mukim); setPick("w-rumah-st", keep.rst); setPick("w-ktp-dom", keep.dom);
    }
    state.wEdit = null;
    state.wRondaTouched = false;
    syncWajibDefault();
    $("#wform-title").textContent = "Tambah warga";
    $("#w-submit").textContent = "Simpan warga";
  }
  // "Ikut jadwal ronda" hanya untuk warga mukim yang laki-laki dewasa atau kepala keluarga.
  // Bila memenuhi syarat, awalnya tercentang; pengurus bebas mengubahnya.
  function layakRonda(w) {
    if (!w || w.status_mukim !== "mukim") return false;
    if (w.kepala_keluarga) return true;
    var a = ageOf(w.tanggal_lahir);
    return w.jenis_kelamin === "L" && a != null && a >= 18;
  }
  function ikutRonda(w) { return !!w.wajib_ronda && layakRonda(w); }
  function syncWajibDefault() {
    var cb = $("#w-ronda");
    var layak = layakRonda({ status_mukim: pick("w-mukim"), kepala_keluarga: $("#w-kepala").checked, jenis_kelamin: pick("w-jk"), tanggal_lahir: $("#w-lahir").value });
    cb.disabled = !layak;
    if (!layak) cb.checked = false;
    else if (!state.wRondaTouched) cb.checked = true;
  }
  function openWForm(w) {
    resetWForm(false);
    $("#w-msg").textContent = "";
    state.wConfirmDel = null;
    if (w) {
      state.wEdit = w;
      $("#wform-title").textContent = "Ubah data warga";
      $("#w-submit").textContent = "Simpan perubahan";
      $("#w-nama").value = w.nama || "";
      $("#w-kk").value = w.no_kk || "";
      $("#w-ktp").value = w.no_ktp || "";
      $("#w-lahir").value = w.tanggal_lahir || "";
      $("#w-telp").value = w.no_telepon || "";
      $("#w-gang").value = w.gang || "";
      $("#w-rumah").value = w.no_rumah || "";
      setPick("w-mukim", w.status_mukim); setPick("w-rumah-st", w.status_rumah); setPick("w-ktp-dom", w.domisili_ktp);
      setPick("w-jk", w.jenis_kelamin || "");
      $("#w-kepala").checked = !!w.kepala_keluarga;
      state.wRondaTouched = true;
      syncWajibDefault();
      $("#w-ronda").checked = ikutRonda(w);
    } else if (state.role === "pic" && state.profile && state.profile.gang) {
      // PIC biasanya menginput warga di gangnya sendiri.
      $("#w-gang").value = canonGang(state.profile.gang);
    }
    $("#wPanel").hidden = false;
    renderWargaList();
    $("#wPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    $("#w-nama").focus();
  }
  function closeWForm() { resetWForm(false); $("#wPanel").hidden = true; $("#w-msg").textContent = ""; renderWargaList(); }
  async function onWargaSubmit(ev) {
    ev.preventDefault();
    if (state.wSaving || !sb || !state.staff) return;
    var msg = $("#w-msg");
    var nama = $("#w-nama").value.trim().replace(/\s+/g, " ");
    var kk = digits($("#w-kk").value), ktp = digits($("#w-ktp").value);
    var lahir = $("#w-lahir").value;
    var telp = normPhone($("#w-telp").value);
    var gang = canonGang($("#w-gang").value);
    var rumah = $("#w-rumah").value.trim();
    var jk = pick("w-jk") || null;
    if (!nama) { msg.textContent = "Isi nama lengkap."; return; }
    if (kk && kk.length !== 16) { msg.textContent = "Nomor KK harus 16 digit. Terisi " + kk.length + " digit."; return; }
    if (ktp && ktp.length !== 16) { msg.textContent = "Nomor KTP harus 16 digit. Terisi " + ktp.length + " digit."; return; }
    if (!lahir) { msg.textContent = "Isi tanggal lahir."; return; }
    if (lahir > todayISO()) { msg.textContent = "Tanggal lahir tidak boleh di masa depan."; return; }
    if (telp && !/^\+?[0-9]{8,15}$/.test(telp)) { msg.textContent = "Nomor telepon tidak valid. Gunakan 8 sampai 15 digit."; return; }
    if (!gang) { msg.textContent = "Isi nama gang."; return; }
    if (!rumah) { msg.textContent = "Isi nomor rumah."; return; }
    if (state.wHasJk !== false && !jk) { msg.textContent = "Pilih jenis kelamin."; return; }
    var ed = state.wEdit;
    if (ktp) {
      var dup = state.warga.filter(function (w) { return w.no_ktp === ktp && (!ed || w.id !== ed.id); })[0];
      if (dup) { msg.textContent = "Nomor KTP ini sudah terdaftar atas nama " + dup.nama + "."; return; }
    }
    var row = {
      nama: nama, no_kk: kk || null, no_ktp: ktp || null, tanggal_lahir: lahir,
      status_mukim: pick("w-mukim"), status_rumah: pick("w-rumah-st"), domisili_ktp: pick("w-ktp-dom"),
      no_telepon: telp || null, gang: gang, no_rumah: rumah
    };
    // Kolom baru dari supabase-tahap5.sql. Jika belum dijalankan, simpan tanpa kolom ini.
    if (state.wHasRonda !== false) row.wajib_ronda = !$("#w-ronda").disabled && $("#w-ronda").checked;
    if (state.wHasJk !== false) { row.jenis_kelamin = jk; row.kepala_keluarga = $("#w-kepala").checked; }
    state.wSaving = true;
    var btn = $("#w-submit");
    btn.disabled = true; btn.textContent = "Menyimpan...";
    msg.textContent = "";
    try {
      var save = function () {
        return ed ? sb.from("warga").update(row).eq("id", ed.id).select() : sb.from("warga").insert(row).select();
      };
      var r = await save();
      if (r.error && /wajib_ronda|jenis_kelamin|kepala_keluarga/.test(r.error.message || "")) {
        delete row.wajib_ronda; delete row.jenis_kelamin; delete row.kepala_keluarga; state.wHasRonda = false; state.wHasJk = false;
        r = await save();
      }
      if (r.error) throw r.error;
      if (!r.data || !r.data.length) throw { code: "42501" };
      if (ed) {
        var ix = state.warga.indexOf(ed);
        if (ix >= 0) state.warga[ix] = r.data[0];
        resetWForm(false);
        $("#wPanel").hidden = true;
        flashTemp("Perubahan tersimpan.", "ok");
      } else {
        state.warga.push(r.data[0]);
        $("#w-gang").value = gang;
        resetWForm(true);
        msg.textContent = "Tersimpan. Isi anggota keluarga berikutnya, atau tutup formulir.";
        $("#w-nama").focus();
      }
      renderWarga();
    } catch (e) {
      msg.textContent = errText(e, "Gagal menyimpan. Periksa koneksi lalu coba lagi.");
    } finally {
      state.wSaving = false;
      btn.disabled = false;
      btn.textContent = state.wEdit ? "Simpan perubahan" : "Simpan warga";
    }
  }
  async function deleteWarga(w) {
    try {
      var r = await sb.from("warga").delete().eq("id", w.id).select("id");
      if (r.error) throw r.error;
      if (!r.data || !r.data.length) throw { code: "42501" };
      state.warga = state.warga.filter(function (x) { return x.id !== w.id; });
      state.wConfirmDel = null;
      if (state.wEdit && state.wEdit.id === w.id) closeWForm();
      flashTemp("Data warga dihapus.", "ok");
      renderWarga();
    } catch (e) {
      flash(errText(e, "Gagal menghapus. Coba lagi."), "err");
    }
  }

  // ---------- unduhan daftar warga ----------
  function filterDesc() {
    var f = state.wf, out = [];
    if (f.q.trim()) out.push("Pencarian: " + f.q.trim());
    if (f.umur) { var g = ageInfo(f.umur); out.push("Kelompok umur: " + g.label + " (" + g.range + ")"); }
    if (f.min !== "" || f.max !== "") out.push("Umur: " + (f.min !== "" ? f.min : "0") + " sampai " + (f.max !== "" ? f.max : "...") + " tahun");
    if (f.gang) out.push("Gang: " + $("#wf-gang").selectedOptions[0].textContent);
    if (f.mukim) out.push(f.mukim === "mukim" ? "Mukim" : "Tidak mukim");
    if (f.rumah) out.push(f.rumah === "milik" ? "Rumah milik sendiri" : "Rumah sewa");
    if (f.ktp) out.push(f.ktp === "sarimukti" ? "KTP Sarimukti Cibitung" : "KTP luar");
    return out.length ? out.join(" · ") : "Semua warga";
  }
  function wStatus(w) {
    return [w.status_mukim === "mukim" ? "Mukim" : "Tidak mukim", w.status_rumah === "milik" ? "Milik sendiri" : "Sewa", w.domisili_ktp === "sarimukti" ? "KTP Sarimukti" : "KTP luar"];
  }
  function exportWargaPdf() {
    if (!(window.jspdf && window.jspdf.jsPDF)) { flash("Pustaka PDF gagal dimuat. Muat ulang halaman.", "err"); return; }
    var list = filtered(), nik = state.admin && $("#wf-nik").checked;
    var doc = new window.jspdf.jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
    doc.setFont("helvetica", "bold"); doc.setFontSize(15);
    doc.text("Daftar Warga " + (state.cfg.namaRT || "RT 007/016"), 40, 44);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    doc.text("Filter: " + filterDesc(), 40, 60, { maxWidth: 760 });
    doc.text("Jumlah: " + list.length + " warga · Dicetak " + new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }), 40, 74);
    if (nik) { doc.setTextColor(180, 40, 30); doc.text("RAHASIA: dokumen ini memuat nomor KK dan KTP. Simpan dengan hati-hati.", 40, 88); doc.setTextColor(0, 0, 0); }
    var head = ["No", "Nama", "Umur", "Tgl lahir", "Gang / No. rumah", "Status", "Telepon"].concat(nik ? ["No. KK", "No. KTP"] : []);
    doc.autoTable({
      startY: nik ? 98 : 88, margin: { left: 40, right: 40 }, theme: "grid",
      head: [head],
      body: list.map(function (w, i) {
        var a = ageOf(w.tanggal_lahir), info = ageInfo(ageGroup(a));
        return [i + 1, w.nama, a == null ? "-" : a + " th" + (info ? " (" + info.label + ")" : ""), w.tanggal_lahir ? dateLabel(w.tanggal_lahir) : "-",
          (w.gang || "-") + (w.no_rumah ? " / " + w.no_rumah : ""), wStatus(w).join(", "), w.no_telepon || "-"]
          .concat(nik ? [w.no_kk || "-", w.no_ktp || "-"] : []);
      }),
      styles: { fontSize: 8, cellPadding: 4 }, headStyles: { fillColor: [217, 80, 10] },
      columnStyles: { 0: { cellWidth: 26 }, 3: { cellWidth: 62 } }
    });
    pdfFooter(doc);
    doc.save("daftar-warga-" + todayISO() + (nik ? "-lengkap" : "") + ".pdf");
  }
  // Nomor panjang ditulis sebagai ="..." supaya Excel tidak membuang angka 0 di depan atau mengubahnya jadi 3,2E+15.
  function csvNum(v) { return v ? '="' + v + '"' : ""; }
  function csvText(v) { v = String(v == null ? "" : v); return /^[=+\-@\t\r]/.test(v) ? "'" + v : v; }
  function exportWargaCsv() {
    var list = filtered(), nik = state.admin && $("#wf-nik").checked;
    var head = ["Nama", "Umur", "Tanggal lahir", "Kelompok umur", "Gang", "No rumah", "Tempat tinggal", "Status rumah", "Alamat KTP", "Telepon"].concat(nik ? ["No KK", "No KTP"] : []);
    var lines = [head.map(csvCell).join(",")];
    list.forEach(function (w) {
      var a = ageOf(w.tanggal_lahir), st = wStatus(w), info = ageInfo(ageGroup(a));
      var cells = [csvText(w.nama), a == null ? "" : a, w.tanggal_lahir || "", info ? info.label : "", csvText(w.gang), csvText(w.no_rumah), st[0], st[1], st[2], csvNum(w.no_telepon)];
      if (nik) cells.push(csvNum(w.no_kk), csvNum(w.no_ktp));
      lines.push(cells.map(csvCell).join(","));
    });
    downloadBlob(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }), "daftar-warga-" + todayISO() + (nik ? "-lengkap" : "") + ".csv");
  }

  // ======================================================================
  // TAHAP 3: PENGUMUMAN, INFO PENTING, LAPORAN WARGA
  // ======================================================================
  Object.assign(state, {
    peng: [], pLoaded: false, pError: null, pEdit: null, pConfirmDel: null, pSaving: false,
    kontak: [], kLoaded: false, kError: null, kEdit: null, kConfirmDel: null, kSaving: false,
    lap: [], lLoaded: false, lError: null, lFilter: "all", lLimit: 15, lManage: null, lConfirmDel: null,
    lDraft: null, lSaving: false, lSending: false, lSrc: null
  });
  var lSeq = 0;

  function secErr(e, what, label) {
    var c = e && e.code ? String(e.code) : "";
    if (c === "42P01" || c === "PGRST205" || c === "42501") {
      return "Tabel " + what + " belum siap. Jalankan supabase-tahap3.sql di SQL Editor Supabase.";
    }
    return label + " belum bisa dimuat. " + (e && e.message ? "[" + (c ? c + ": " : "") + e.message + "]" : "Periksa koneksi internet.");
  }
  async function fetchRows(table, order) {
    var out = [], from = 0, size = 1000;
    for (;;) {
      var q = sb.from(table).select("*");
      q = order(q);
      var r = await q.range(from, from + size - 1);
      if (r.error) throw r.error;
      out = out.concat(r.data);
      if (r.data.length < size) break;
      from += size;
    }
    return out;
  }
  function tsDate(ts) { return dateLabel(isoDate(new Date(ts))); }
  function daysUntil(iso) {
    var p = iso.split("-").map(Number), t = new Date();
    var a = new Date(p[0], p[1] - 1, p[2]), b = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    return Math.round((a - b) / 86400000);
  }
  function phoneTel(v) { return String(v || "").replace(/[^\d+]/g, ""); }
  function waLink(v) {
    var d = digits(v);
    if (/^0/.test(d)) d = "62" + d.slice(1);
    return /^62\d{8,13}$/.test(d) ? "https://wa.me/" + d : null;
  }
  function validPhone(v) { var n = digits(v).length; return n >= 3 && n <= 16 && /^[\d\s+().-]+$/.test(v); }
  function newId() { return window.crypto.randomUUID ? window.crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2); }

  // ---------- pengumuman ----------
  async function loadPengumuman() {
    if (!sb) return;
    try {
      state.peng = await fetchRows("pengumuman", function (q) {
        return q.order("acara_tanggal", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false });
      });
      state.pError = null;
    } catch (e) {
      console.error("Gagal memuat pengumuman:", e);
      state.pError = e || {};
    }
    state.pLoaded = true;
    renderAll();
  }
  function pEnd(p) { return p.tampil_sampai || p.acara_tanggal || ""; }
  function pActive(p) { var e = pEnd(p); return !e || e >= todayISO(); }
  function pSorted(list) {
    return list.slice().sort(function (a, b) {
      if (a.acara_tanggal && b.acara_tanggal) return a.acara_tanggal < b.acara_tanggal ? -1 : a.acara_tanggal > b.acara_tanggal ? 1 : 0;
      if (a.acara_tanggal) return -1;
      if (b.acara_tanggal) return 1;
      return String(b.created_at).localeCompare(String(a.created_at));
    });
  }
  function pinEl(p) {
    var n = p.acara_tanggal ? daysUntil(p.acara_tanggal) : null;
    var when = n === null ? null : n === 0 ? "Hari ini" : n === 1 ? "Besok" : n > 1 ? n + " hari lagi" : null;
    var meta = h("dl", { class: "pinmeta" });
    [["Tanggal", p.acara_tanggal ? longDate(p.acara_tanggal) : ""], ["Jam", p.acara_jam], ["Tempat", p.tempat]].forEach(function (kv) {
      if (kv[1]) meta.append(h("div", {}, h("dt", {}, kv[0]), h("dd", {}, kv[1])));
    });
    return h("article", { class: "pin" },
      h("div", { class: "pinhead" },
        h("span", { class: "pinlabel" }, "Pengumuman"),
        when ? h("span", { class: "pinwhen" + (n === 0 ? " today" : "") }, when) : null),
      h("h2", { class: "pintitle" }, p.judul),
      meta.children.length ? meta : null,
      p.isi ? h("p", { class: "pintext" }, p.isi) : null,
      h("div", { class: "pinfoot" },
        waShareLink(pengShareText(p), "Bagikan pengumuman ke WhatsApp: " + p.judul),
        p.oleh_label ? h("span", { class: "pinby" }, "Diumumkan oleh " + p.oleh_label) : null));
  }
  function renderPinned() {
    var box = $("#pinned");
    box.textContent = "";
    var list = (state.pLoaded && !state.pError) ? pSorted(state.peng.filter(pActive)) : [];
    list.forEach(function (p) { box.append(pinEl(p)); });
    box.hidden = !list.length;
  }
  function renderPengAdmin() {
    $("#btn-aadd").hidden = !state.admin;
    var err = $("#a-error"), panel = $("#a-admin");
    if (!state.admin) {
      err.hidden = true; panel.hidden = true;
      if (!$("#aPanel").hidden) { resetAForm(); $("#aPanel").hidden = true; }
      return;
    }
    if (state.pError) { err.textContent = secErr(state.pError, "pengumuman", "Pengumuman"); err.hidden = false; } else err.hidden = true;
    var ul = $("#a-admin-list");
    ul.textContent = "";
    var all = pSorted(state.peng);
    panel.hidden = !state.pLoaded || !!state.pError;
    if (!all.length) { ul.append(h("li", { class: "hint" }, "Belum ada pengumuman. Klik Buat pengumuman untuk menyematkan yang pertama.")); return; }
    all.forEach(function (p) {
      var act = h("div", { class: "rowact left" });
      if (state.pConfirmDel === p.id) {
        act.append(
          h("button", { type: "button", class: "btn danger small", onclick: function () { deletePeng(p); } }, "Ya, hapus"),
          h("button", { type: "button", class: "btn ghost small", onclick: function () { state.pConfirmDel = null; renderPengAdmin(); } }, "Batal"));
      } else {
        act.append(
          h("button", { type: "button", class: "btn ghost small", onclick: function () { openAForm(p); } }, "Ubah"),
          h("button", { type: "button", class: "btn danger ghost small", onclick: function () { state.pConfirmDel = p.id; renderPengAdmin(); } }, "Hapus"));
      }
      var sub = [];
      if (p.acara_tanggal) sub.push(dateLabel(p.acara_tanggal) + (p.acara_jam ? ", " + p.acara_jam : ""));
      var e = pEnd(p);
      sub.push(!e ? "Tampil sampai dihapus" : pActive(p) ? "Tampil sampai " + dateLabel(e) : "Sudah berakhir");
      ul.append(h("li", { class: "arow" + (pActive(p) ? "" : " ended") },
        h("div", { class: "agrow" }, h("strong", {}, p.judul), h("span", { class: "hint" }, sub.join(" · "))), act));
    });
  }
  function resetAForm() {
    $("#aform").reset();
    state.pEdit = null;
    $("#aform-title").textContent = "Buat pengumuman";
    $("#a-submit").textContent = "Terbitkan";
    $("#a-count").textContent = "0 / 2000";
  }
  function openAForm(p) {
    resetAForm();
    $("#a-msg").textContent = "";
    state.pConfirmDel = null;
    if (p) {
      state.pEdit = p;
      $("#aform-title").textContent = "Ubah pengumuman";
      $("#a-submit").textContent = "Simpan perubahan";
      $("#a-judul").value = p.judul || "";
      $("#a-tanggal").value = p.acara_tanggal || "";
      $("#a-jam").value = p.acara_jam || "";
      $("#a-tempat").value = p.tempat || "";
      $("#a-isi").value = p.isi || "";
      $("#a-sampai").value = p.tampil_sampai || "";
      $("#a-count").textContent = (p.isi || "").length + " / 2000";
    }
    $("#aPanel").hidden = false;
    renderPengAdmin();
    $("#aPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    $("#a-judul").focus();
  }
  function closeAForm() { resetAForm(); $("#aPanel").hidden = true; $("#a-msg").textContent = ""; renderPengAdmin(); }
  async function onPengSubmit(ev) {
    ev.preventDefault();
    if (state.pSaving || !sb || !state.admin) return;
    var msg = $("#a-msg");
    var judul = $("#a-judul").value.trim().replace(/\s+/g, " ");
    var tanggal = $("#a-tanggal").value, sampai = $("#a-sampai").value;
    if (!judul) { msg.textContent = "Isi judul pengumuman."; return; }
    var end = sampai || tanggal;
    if (end && end < todayISO()) { msg.textContent = "Tanggal tampil sudah lewat, jadi pengumuman tidak akan terlihat oleh warga."; return; }
    var row = {
      judul: judul,
      isi: $("#a-isi").value.replace(/\r\n/g, "\n").trim(),
      acara_tanggal: tanggal || null,
      acara_jam: $("#a-jam").value.trim() || null,
      tempat: $("#a-tempat").value.trim() || null,
      tampil_sampai: sampai || null
    };
    state.pSaving = true;
    var btn = $("#a-submit");
    btn.disabled = true; btn.textContent = "Menyimpan..."; msg.textContent = "";
    try {
      var ed = state.pEdit;
      var r = ed ? await sb.from("pengumuman").update(row).eq("id", ed.id).select()
                 : await sb.from("pengumuman").insert(row).select();
      if (r.error) throw r.error;
      if (!r.data || !r.data.length) throw { code: "42501" };
      var wasEdit = !!ed;
      resetAForm();
      $("#aPanel").hidden = true;
      flashTemp(wasEdit ? "Perubahan tersimpan." : "Pengumuman diterbitkan.", "ok");
      await loadPengumuman();
    } catch (e) {
      var pc = e && e.code ? String(e.code) : "";
      msg.textContent = (pc === "42P01" || pc === "PGRST205") ? "Tabel pengumuman belum dibuat. Jalankan supabase-tahap3.sql di SQL Editor Supabase."
        : errText(e, "Gagal menyimpan. Periksa koneksi lalu coba lagi.");
    } finally {
      state.pSaving = false;
      btn.disabled = false;
      btn.textContent = state.pEdit ? "Simpan perubahan" : "Terbitkan";
    }
  }
  async function deletePeng(p) {
    try {
      var r = await sb.from("pengumuman").delete().eq("id", p.id).select("id");
      if (r.error) throw r.error;
      if (!r.data || !r.data.length) throw { code: "42501" };
      state.pConfirmDel = null;
      if (state.pEdit && state.pEdit.id === p.id) closeAForm();
      flashTemp("Pengumuman dihapus.", "ok");
      await loadPengumuman();
    } catch (e) { flash(errText(e, "Gagal menghapus. Coba lagi."), "err"); }
  }

  // ---------- info penting ----------
  var KCATS = [["darurat", "Darurat"], ["pengurus", "Pengurus RT dan RW"], ["keamanan", "Keamanan"], ["lainnya", "Lainnya"]];
  async function loadKontak() {
    if (!sb) return;
    try {
      state.kontak = await fetchRows("kontak", function (q) { return q.order("urutan", { ascending: true }).order("nama", { ascending: true }); });
      state.kError = null;
    } catch (e) {
      console.error("Gagal memuat kontak:", e);
      state.kError = e || {};
    }
    state.kLoaded = true;
    renderAll();
  }
  var KFOTO_DIR = "kontak/";
  var ICON_TEL = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.8a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>';
  var ICON_WA = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" focusable="false"><path d="M12.04 2a9.9 9.9 0 0 0-8.5 14.9L2 22l5.25-1.38A9.9 9.9 0 1 0 12.04 2zm0 1.8a8.1 8.1 0 1 1-4.3 15l-.3-.18-3.1.82.83-3.03-.2-.31A8.1 8.1 0 0 1 12.04 3.8zM8.6 7.4c-.2 0-.5.07-.75.35-.25.27-.97.95-.97 2.3s1 2.7 1.13 2.88c.14.18 1.93 3.07 4.77 4.18 2.36.93 2.84.75 3.35.7.52-.04 1.66-.68 1.9-1.33.23-.66.23-1.22.16-1.34-.07-.12-.25-.2-.52-.33-.27-.14-1.6-.79-1.85-.88-.25-.09-.43-.14-.6.14-.18.27-.7.88-.86 1.06-.16.18-.32.2-.59.07-.27-.14-1.15-.42-2.2-1.35-.81-.72-1.36-1.62-1.52-1.89-.16-.27-.02-.42.12-.55.12-.12.27-.32.4-.48.14-.16.18-.27.27-.45.09-.18.05-.34-.02-.48-.07-.14-.6-1.5-.84-2.05-.22-.52-.45-.45-.6-.46h-.5z"/></svg>';
  function icoBtn(cls, href, svg, label, ext) {
    var a = h("a", { class: "iconbtn " + cls, href: href, "aria-label": label, title: label });
    if (ext) { a.target = "_blank"; a.rel = "noopener"; }
    var s = h("span", { class: "ico", "aria-hidden": "true" });
    s.innerHTML = svg;
    a.append(s);
    return a;
  }
  var HONOR = /^(bapak|bpk|pak|ibu|bu|haji|hj|h|dr|drs|ir|ustaz|ustadz|ustadzah|kh|kak|mas|mbak|om|tante)\.?$/i;
  function inisial(nama) {
    var w = String(nama || "").replace(/[^\p{L}\p{N}\s.'-]/gu, " ").split(/\s+/).filter(Boolean);
    var core = w.filter(function (x) { return !HONOR.test(x); });
    if (!core.length) core = w;
    var out = core.slice(0, 2).map(function (x) { return Array.from(x.replace(/^[.'-]+/, ""))[0] || ""; }).join("");
    return (out || "?").toLocaleUpperCase("id-ID");
  }
  function avatarTone(nama) {
    var n = 0, t = String(nama || "");
    for (var i = 0; i < t.length; i++) n = (n * 31 + t.charCodeAt(i)) >>> 0;
    return n % 4;
  }
  function kAvatar(k) {
    var box = h("div", { class: "kavatar tone" + avatarTone(k.nama) });
    var ini = h("span", { class: "kini", "aria-hidden": "true" }, inisial(k.nama));
    box.append(ini);
    if (k.foto_path) {
      var img = h("img", { src: proofUrl(k.foto_path), alt: "Foto " + k.nama, loading: "lazy", decoding: "async", width: "96", height: "96" });
      img.addEventListener("error", function () { img.remove(); box.classList.add("noimg"); });
      box.append(img);
    }
    return box;
  }
  function kRow(k) {
    var tel = phoneTel(k.telepon), wa = waLink(k.telepon);
    var calls = h("div", { class: "kcall" },
      icoBtn("tel", "tel:" + tel, ICON_TEL, "Telepon " + k.nama),
      wa ? icoBtn("wa", wa, ICON_WA, "WhatsApp " + k.nama, true) : null);
    var links = null;
    if (state.admin) {
      links = h("div", { class: "rowact left" });
      if (state.kConfirmDel === k.id) {
        links.append(
          h("button", { type: "button", class: "btn danger small", onclick: function () { deleteKontak(k); } }, "Ya, hapus"),
          h("button", { type: "button", class: "btn ghost small", onclick: function () { state.kConfirmDel = null; renderInfo(); } }, "Batal"));
      } else {
        links.append(
          h("button", { type: "button", class: "btn ghost small", onclick: function () { openKForm(k); } }, "Ubah"),
          h("button", { type: "button", class: "btn danger ghost small", onclick: function () { state.kConfirmDel = k.id; renderInfo(); } }, "Hapus"));
      }
    }
    return h("li", { class: "kcard kc" + (state.kEdit && state.kEdit.id === k.id ? " editing" : "") },
      kAvatar(k),
      h("div", { class: "kbody" },
        h("div", { class: "kmain" },
          h("strong", { class: "kname" }, k.nama),
          k.peran ? h("span", { class: "kperan" }, k.peran) : null,
          h("span", { class: "kphone num" }, k.telepon),
          k.catatan ? h("span", { class: "hint" }, k.catatan) : null),
        calls, links));
  }
  var kPreviewUrl = null;
  function setKPreview(src) {
    if (kPreviewUrl) { URL.revokeObjectURL(kPreviewUrl); kPreviewUrl = null; }
    var img = $("#k-preview"), wrapEl = $("#k-preview-wrap");
    if (!src) { img.removeAttribute("src"); wrapEl.hidden = true; return; }
    img.src = src; wrapEl.hidden = false;
  }
  // Foto kontak dipotong persegi di bagian tengah dan dikecilkan supaya ringan.
  async function prepareAvatar(file, type) {
    try {
      var bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      var side = Math.min(bmp.width, bmp.height), size = Math.min(480, side);
      var cv = document.createElement("canvas");
      cv.width = size; cv.height = size;
      var ctx = cv.getContext("2d");
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, size, size);
      ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
      var blob = await new Promise(function (res) { cv.toBlob(res, "image/jpeg", 0.85); });
      if (blob) return { blob: blob, type: "image/jpeg" };
    } catch (e) { /* pakai file asli */ }
    return { blob: file, type: type };
  }
  function renderInfo() {
    $("#btn-kadd").hidden = !state.admin;
    if (!state.admin && !$("#kPanel").hidden) { resetKForm(); $("#kPanel").hidden = true; }
    var wrap = $("#k-list"), err = $("#k-error");
    wrap.textContent = "";
    if (!sb) { err.hidden = true; wrap.append(h("p", { class: "empty card" }, "Portal belum terhubung ke Supabase. Isi file config.js sesuai panduan di README.")); return; }
    if (state.kError) { err.textContent = secErr(state.kError, "kontak", "Info penting"); err.hidden = false; return; }
    err.hidden = true;
    if (!state.kLoaded) { wrap.append(h("p", { class: "empty card" }, "Memuat info penting...")); return; }
    if (!state.kontak.length) {
      wrap.append(h("p", { class: "empty card" }, state.admin ? "Belum ada kontak. Klik Tambah kontak untuk mengisi nomor ketua RT, ambulans, dan lainnya." : "Belum ada info yang dipublikasikan."));
      return;
    }
    KCATS.forEach(function (c) {
      var items = state.kontak.filter(function (k) { return (KCATS.some(function (x) { return x[0] === k.kategori; }) ? k.kategori : "lainnya") === c[0]; });
      if (!items.length) return;
      var ul = h("ul", { class: "plain kgrid" });
      items.forEach(function (k) { ul.append(kRow(k)); });
      wrap.append(h("section", { class: "kgroup" }, h("h3", {}, c[1]), ul));
    });
  }
  function resetKForm() {
    $("#kform").reset();
    state.kEdit = null;
    setOptions($("#k-kategori"), KCATS);
    $("#kform-title").textContent = "Tambah kontak";
    $("#k-submit").textContent = "Simpan";
    $("#k-urutan").value = "0";
    $("#k-hapusfoto-wrap").hidden = true;
    setKPreview(null);
  }
  function openKForm(k) {
    resetKForm();
    $("#k-msg").textContent = "";
    state.kConfirmDel = null;
    if (k) {
      state.kEdit = k;
      $("#kform-title").textContent = "Ubah kontak";
      $("#k-submit").textContent = "Simpan perubahan";
      $("#k-kategori").value = k.kategori;
      $("#k-nama").value = k.nama || "";
      $("#k-peran").value = k.peran || "";
      $("#k-telp").value = k.telepon || "";
      $("#k-catatan").value = k.catatan || "";
      $("#k-urutan").value = String(k.urutan || 0);
      if (k.foto_path) { setKPreview(proofUrl(k.foto_path)); $("#k-hapusfoto-wrap").hidden = false; }
    }
    $("#kPanel").hidden = false;
    renderInfo();
    $("#kPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    $("#k-nama").focus();
  }
  function closeKForm() { resetKForm(); $("#kPanel").hidden = true; $("#k-msg").textContent = ""; renderInfo(); }
  async function onKontakSubmit(ev) {
    ev.preventDefault();
    if (state.kSaving || !sb || !state.admin) return;
    var msg = $("#k-msg");
    var nama = $("#k-nama").value.trim().replace(/\s+/g, " "), telp = $("#k-telp").value.trim();
    if (!nama) { msg.textContent = "Isi nama."; return; }
    if (!telp) { msg.textContent = "Isi nomor telepon."; return; }
    if (!validPhone(telp)) { msg.textContent = "Nomor telepon hanya boleh berisi angka, spasi, tanda + dan -, sepanjang 3 sampai 16 angka."; return; }
    var urutan = parseInt($("#k-urutan").value, 10);
    var kfile = $("#k-foto").files[0], ktype = null;
    if (kfile) {
      ktype = fileType(kfile);
      if (!ktype || ktype === "application/pdf") { msg.textContent = "Foto harus berformat JPG, PNG, atau WebP. Foto HEIC dari iPhone perlu diubah ke JPG."; return; }
    }
    var row = {
      kategori: $("#k-kategori").value, nama: nama, peran: $("#k-peran").value.trim() || null,
      telepon: telp, catatan: $("#k-catatan").value.trim() || null, urutan: isNaN(urutan) ? 0 : Math.max(0, Math.min(999, urutan))
    };
    state.kSaving = true;
    var btn = $("#k-submit");
    btn.disabled = true; btn.textContent = "Menyimpan..."; msg.textContent = "";
    var kUploaded = null, kOld = null;
    try {
      var ed = state.kEdit;
      if (kfile) {
        var prep = await prepareAvatar(kfile, ktype);
        kUploaded = KFOTO_DIR + newId() + "." + TYPE_EXT[prep.type];
        var up = await sb.storage.from(BUCKET).upload(kUploaded, prep.blob, { contentType: prep.type, upsert: false });
        if (up.error) throw up.error;
        row.foto_path = kUploaded;
        kOld = ed && ed.foto_path ? ed.foto_path : null;
      } else if (ed && ed.foto_path && $("#k-hapusfoto").checked) {
        row.foto_path = null; kOld = ed.foto_path;
      }
      var r = ed ? await sb.from("kontak").update(row).eq("id", ed.id).select()
                 : await sb.from("kontak").insert(row).select();
      if (r.error && "foto_path" in row && /foto_path/.test(r.error.message || "")) {
        if (kfile) throw { code: "KOLOM", message: "Kolom foto belum ada. Jalankan supabase-tahap6.sql di SQL Editor Supabase." };
        delete row.foto_path; kOld = null;
        r = ed ? await sb.from("kontak").update(row).eq("id", ed.id).select() : await sb.from("kontak").insert(row).select();
      }
      if (r.error) throw r.error;
      if (!r.data || !r.data.length) throw { code: "42501" };
      if (kOld) sb.storage.from(BUCKET).remove([kOld]);
      var wasEdit = !!ed;
      resetKForm();
      $("#kPanel").hidden = true;
      flashTemp(wasEdit ? "Perubahan tersimpan." : "Kontak ditambahkan.", "ok");
      await loadKontak();
    } catch (e) {
      if (kUploaded) sb.storage.from(BUCKET).remove([kUploaded]);
      msg.textContent = e && e.code === "KOLOM" ? e.message : errText(e, "Gagal menyimpan. Periksa koneksi lalu coba lagi.");
    } finally {
      state.kSaving = false;
      btn.disabled = false;
      btn.textContent = state.kEdit ? "Simpan perubahan" : "Simpan";
    }
  }
  async function deleteKontak(k) {
    try {
      var r = await sb.from("kontak").delete().eq("id", k.id).select("id");
      if (r.error) throw r.error;
      if (!r.data || !r.data.length) throw { code: "42501" };
      if (k.foto_path) sb.storage.from(BUCKET).remove([k.foto_path]);
      state.kConfirmDel = null;
      if (state.kEdit && state.kEdit.id === k.id) closeKForm();
      flashTemp("Kontak dihapus.", "ok");
      await loadKontak();
    } catch (e) { flash(errText(e, "Gagal menghapus. Coba lagi."), "err"); }
  }

  // ---------- laporan warga ----------
  var LKAT = [["jalan", "Jalan rusak"], ["lampu", "Lampu jalan"], ["sampah", "Sampah"], ["saluran", "Saluran air atau selokan"],
              ["keamanan", "Keamanan"], ["fasilitas", "Fasilitas umum"], ["lainnya", "Lainnya"]];
  var LSTAT = [["dilaporkan", "Dilaporkan"], ["dikerjakan", "Dikerjakan"], ["selesai", "Selesai"]];
  var LFOTO_DIR = "laporan/";
  function labelOf(list, id) { var f = list.filter(function (x) { return x[0] === id; })[0]; return f ? f[1] : id; }

  async function loadLaporan() {
    if (!sb) return;
    var seq = ++lSeq;
    var table = state.admin ? "laporan" : "laporan_publik";
    state.lSrc = table;
    var rows = null, error = null;
    try {
      rows = await fetchRows(table, function (q) { return q.order("created_at", { ascending: false }); });
    } catch (e) {
      console.error("Gagal memuat laporan:", e);
      error = e || {};
    }
    if (seq !== lSeq) return;
    if (error) state.lError = error; else { state.lap = rows; state.lError = null; }
    state.lLoaded = true;
    renderAll();
  }
  function lErrText(e) {
    var c = e && e.code ? String(e.code) : "";
    if (c === "P0001" && e.message) return e.message;
    if (c === "42P01" || c === "PGRST205") return "Fitur laporan belum diaktifkan oleh pengurus.";
    var m = e && e.message ? String(e.message).toLowerCase() : "";
    if (m.indexOf("exceeded") >= 0 || String(c) === "413") return "Foto terlalu besar. Pilih foto yang lebih kecil.";
    return "Gagal mengirim laporan. Periksa koneksi internet lalu coba lagi.";
  }
  function renderLapChips() {
    var box = $("#l-chips");
    box.textContent = "";
    var counts = { all: state.lap.length };
    LSTAT.forEach(function (s) { counts[s[0]] = state.lap.filter(function (r) { return r.status === s[0]; }).length; });
    [["all", "Semua"]].concat(LSTAT).forEach(function (s) {
      box.append(h("button", {
        type: "button", class: "chipbtn", "aria-pressed": String(state.lFilter === s[0]),
        onclick: function () { state.lFilter = s[0]; state.lLimit = 15; renderLaporan(); }
      }, s[1], h("span", { class: "n" }, String(counts[s[0]]))));
    });
  }
  function stepsEl(r) {
    var idx = { dilaporkan: 0, dikerjakan: 1, selesai: 2 }[r.status];
    var ol = h("ol", { class: "steps", "aria-label": "Perkembangan laporan" });
    [["Dilaporkan", r.created_at], ["Dikerjakan", r.dikerjakan_pada], ["Selesai", r.selesai_pada]].forEach(function (s, i) {
      ol.append(h("li", { class: i < idx ? "done" : i === idx ? "now" : "" },
        h("span", { class: "stepname" }, s[0]),
        h("span", { class: "stepdate" }, s[1] ? tsDate(s[1]) : "-")));
    });
    return ol;
  }
  function manageEl(r) {
    var d = state.lDraft && state.lDraft.id === r.id ? state.lDraft : { id: r.id, status: r.status, note: r.catatan_pengurus || "" };
    state.lDraft = d;
    var sel = h("select", { id: "lm-status" });
    LSTAT.forEach(function (s) { sel.append(h("option", { value: s[0] }, s[1])); });
    sel.value = d.status;
    sel.addEventListener("input", function () { d.status = sel.value; });
    var note = h("textarea", { id: "lm-note", rows: "3", maxlength: "1000", placeholder: "Contoh: Sudah dihubungi PLN, perbaikan dijadwalkan Senin." });
    note.value = d.note;
    note.addEventListener("input", function () { d.note = note.value; });
    var act = h("div", { class: "rowact left" },
      h("button", { type: "button", class: "btn small", id: "lm-save", onclick: function () { saveLaporan(r); } }, "Simpan status"),
      h("button", { type: "button", class: "btn ghost small", onclick: function () { toggleTampil(r); } }, r.tampil ? "Sembunyikan dari warga" : "Tampilkan lagi"));
    if (state.lConfirmDel === r.id) {
      act.append(
        h("button", { type: "button", class: "btn danger small", onclick: function () { deleteLaporan(r); } }, "Ya, hapus laporan"),
        h("button", { type: "button", class: "btn ghost small", onclick: function () { state.lConfirmDel = null; renderLaporan(); } }, "Batal"));
    } else {
      act.append(h("button", { type: "button", class: "btn danger ghost small", onclick: function () { state.lConfirmDel = r.id; renderLaporan(); } }, "Hapus"));
    }
    return h("div", { class: "manage" },
      h("div", { class: "field" }, h("label", { for: "lm-status" }, "Status"), sel),
      h("div", { class: "field" }, h("label", { for: "lm-note" }, "Catatan untuk warga (tampil di bawah laporan)"), note),
      act);
  }
  function laporEl(r) {
    var body = h("div", { class: "postbody" },
      h("div", { class: "lhead" },
        h("span", { class: "status st-" + r.status }, labelOf(LSTAT, r.status)),
        h("span", { class: "chip" }, labelOf(LKAT, r.kategori)),
        state.admin && r.tampil === false ? h("span", { class: "chip alt" }, "Disembunyikan") : null),
      h("h3", {}, r.judul),
      h("p", { class: "postdate" }, "Kejadian " + longDate(r.tanggal_kejadian) + (r.lokasi ? " · " + r.lokasi : "")),
      r.isi ? h("p", { class: "posttext" }, r.isi) : null,
      stepsEl(r),
      r.catatan_pengurus ? h("p", { class: "pnote" }, h("strong", {}, "Catatan pengurus: "), r.catatan_pengurus) : null);
    if (state.admin) {
      var who = [r.nama_pelapor, r.kontak_pelapor].filter(Boolean).join(" · ");
      body.append(h("p", { class: "hint" }, "Pelapor (hanya terlihat pengurus): " + (who || "tidak dicantumkan")));
      if (state.lManage === r.id) body.append(manageEl(r));
      body.append(h("div", { class: "rowact left" },
        h("button", {
          type: "button", class: "btn ghost small", "aria-expanded": String(state.lManage === r.id),
          onclick: function () { state.lManage = state.lManage === r.id ? null : r.id; state.lConfirmDel = null; state.lDraft = null; renderLaporan(); }
        }, state.lManage === r.id ? "Tutup" : "Kelola")));
    }
    var card = h("article", { class: "postcard" + (state.lManage === r.id ? " editing" : "") });
    if (r.foto_path) {
      card.append(h("button", {
        type: "button", class: "postimg", "aria-label": "Perbesar foto: " + r.judul,
        onclick: function (ev) { openPhoto({ foto_path: r.foto_path, judul: r.judul }, ev.currentTarget); }
      }, h("img", { src: proofUrl(r.foto_path), alt: "", loading: "lazy" })));
    }
    card.append(body);
    return h("li", { class: "post lap" }, card);
  }
  function renderLaporan() {
    var wrap = $("#l-list"), err = $("#l-error");
    wrap.textContent = "";
    $("#l-more-wrap").hidden = true;
    $("#l-chips").hidden = true;
    if (!sb) { err.hidden = true; wrap.append(h("p", { class: "empty card" }, "Portal belum terhubung ke Supabase. Isi file config.js sesuai panduan di README.")); $("#btn-ladd").hidden = true; return; }
    $("#btn-ladd").hidden = false;
    if (state.lError) { err.textContent = secErr(state.lError, "laporan", "Laporan"); err.hidden = false; return; }
    err.hidden = true;
    if (!state.lLoaded) { wrap.append(h("p", { class: "empty card" }, "Memuat laporan...")); return; }
    if (!state.lap.length) { wrap.append(h("p", { class: "empty card" }, "Belum ada laporan. Klik Buat laporan bila ada yang perlu ditangani.")); return; }
    $("#l-chips").hidden = false;
    renderLapChips();
    var rows = state.lap.filter(function (r) { return state.lFilter === "all" || r.status === state.lFilter; });
    if (!rows.length) { wrap.append(h("p", { class: "empty card" }, "Tidak ada laporan dengan status ini.")); return; }
    var ol = h("ol", { class: "timeline" });
    rows.slice(0, state.lLimit).forEach(function (r) { ol.append(laporEl(r)); });
    wrap.append(ol);
    $("#l-more-wrap").hidden = rows.length <= state.lLimit;
  }

  // ---------- admin: kelola laporan ----------
  async function patchLaporan(r, patch, okMsg) {
    if (state.lSaving || !state.admin) return;
    state.lSaving = true;
    try {
      var res = await sb.from("laporan").update(patch).eq("id", r.id).select();
      if (res.error) throw res.error;
      if (!res.data || !res.data.length) throw { code: "42501" };
      flashTemp(okMsg, "ok");
      state.lDraft = null;
      await loadLaporan();
    } catch (e) {
      flash(errText(e, "Gagal menyimpan. Coba lagi."), "err");
    } finally { state.lSaving = false; }
  }
  function saveLaporan(r) {
    var d = state.lDraft && state.lDraft.id === r.id ? state.lDraft : { status: r.status, note: r.catatan_pengurus || "" };
    return patchLaporan(r, { status: d.status, catatan_pengurus: d.note.trim() || null }, "Laporan diperbarui.");
  }
  function toggleTampil(r) {
    return patchLaporan(r, { tampil: !r.tampil }, r.tampil ? "Laporan disembunyikan dari warga." : "Laporan ditampilkan kembali.");
  }
  async function deleteLaporan(r) {
    try {
      var res = await sb.from("laporan").delete().eq("id", r.id).select("id");
      if (res.error) throw res.error;
      if (!res.data || !res.data.length) throw { code: "42501" };
      if (r.foto_path) sb.storage.from(BUCKET).remove([r.foto_path]);
      state.lConfirmDel = null; state.lManage = null; state.lDraft = null;
      flashTemp("Laporan dihapus.", "ok");
      await loadLaporan();
    } catch (e) { flash(errText(e, "Gagal menghapus. Coba lagi."), "err"); }
  }

  // ---------- warga: kirim laporan ----------
  var lPreviewUrl = null;
  function setLPreview(src) {
    var w = $("#l-preview-wrap"), img = $("#l-preview");
    if (lPreviewUrl) { URL.revokeObjectURL(lPreviewUrl); lPreviewUrl = null; }
    if (!src) { img.removeAttribute("src"); w.hidden = true; return; }
    img.src = src; w.hidden = false;
  }
  function resetLForm() {
    $("#lform").reset();
    setOptions($("#l-kategori"), LKAT);
    $("#l-tanggal").value = todayISO();
    $("#l-tanggal").max = todayISO();
    $("#l-count").textContent = "0 / 2000";
    setLPreview(null);
  }
  function openLForm() {
    resetLForm();
    $("#l-msg").textContent = "";
    $("#lPanel").hidden = false;
    $("#lPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    $("#l-judul").focus();
  }
  function closeLForm() { resetLForm(); $("#lPanel").hidden = true; $("#l-msg").textContent = ""; }
  function lastSent() { try { return Number(localStorage.getItem("laporan_terakhir")) || 0; } catch (e) { return 0; } }
  function markSent() { try { localStorage.setItem("laporan_terakhir", String(Date.now())); } catch (e) { /* abaikan */ } }
  async function onLaporSubmit(ev) {
    ev.preventDefault();
    if (state.lSending || !sb) return;
    var msg = $("#l-msg");
    if ($("#l-website").value) { closeLForm(); flashTemp("Laporan terkirim. Terima kasih.", "ok"); return; } // jebakan untuk robot
    var judul = $("#l-judul").value.trim().replace(/\s+/g, " ");
    var lokasi = $("#l-lokasi").value.trim().replace(/\s+/g, " ");
    var tanggal = $("#l-tanggal").value;
    var kontak = $("#l-kontak").value.trim();
    if (!judul) { msg.textContent = "Isi apa yang dilaporkan."; return; }
    if (!lokasi) { msg.textContent = "Isi lokasi kejadian supaya pengurus mudah menemukannya."; return; }
    if (!tanggal) { msg.textContent = "Isi tanggal kejadian."; return; }
    if (tanggal > todayISO()) { msg.textContent = "Tanggal kejadian tidak boleh di masa depan."; return; }
    if (kontak && !validPhone(kontak)) { msg.textContent = "Nomor telepon tidak valid. Kosongkan jika tidak ingin dihubungi."; return; }
    if (Date.now() - lastSent() < 60000) { msg.textContent = "Mohon tunggu satu menit sebelum mengirim laporan berikutnya."; return; }
    var file = $("#l-foto").files[0], type = null;
    if (file) {
      type = fileType(file);
      if (!type || type === "application/pdf") { msg.textContent = "Foto harus berformat JPG, PNG, atau WebP. Foto HEIC dari iPhone perlu diubah ke JPG."; return; }
    }
    state.lSending = true;
    var btn = $("#l-submit");
    btn.disabled = true; btn.textContent = "Mengirim..."; msg.textContent = "";
    var uploadedPath = null;
    try {
      var foto = { foto_path: null, foto_tipe: null };
      if (file) {
        var prep = await prepareFile(file, type);
        if (prep.blob.size > 5 * 1024 * 1024) { msg.textContent = "Foto terlalu besar. Pilih foto yang lebih kecil dari 5 MB."; return; }
        uploadedPath = LFOTO_DIR + newId() + "." + TYPE_EXT[prep.type];
        var up = await sb.storage.from(BUCKET).upload(uploadedPath, prep.blob, { contentType: prep.type, upsert: false });
        if (up.error) throw up.error;
        foto = { foto_path: uploadedPath, foto_tipe: prep.type };
      }
      var row = Object.assign({
        kategori: $("#l-kategori").value, judul: judul, isi: $("#l-isi").value.replace(/\r\n/g, "\n").trim(),
        lokasi: lokasi, tanggal_kejadian: tanggal,
        nama_pelapor: $("#l-nama").value.trim() || null, kontak_pelapor: kontak || null
      }, foto);
      var r = await sb.from("laporan").insert(row); // tanpa .select(): warga tidak boleh membaca tabel aslinya
      if (r.error) throw r.error;
      uploadedPath = null;
      markSent();
      closeLForm();
      state.lFilter = "all";
      flashTemp("Laporan terkirim. Terima kasih, pengurus akan menindaklanjuti.", "ok");
      await loadLaporan();
    } catch (e) {
      if (uploadedPath) sb.storage.from(BUCKET).remove([uploadedPath]);
      msg.textContent = lErrText(e);
    } finally {
      state.lSending = false;
      btn.disabled = false;
      btn.textContent = "Kirim laporan";
    }
  }

  function loadTahap3() { loadPengumuman(); loadKontak(); loadLaporan(); loadRonda(); loadIklan(); }
  function tahap3Idle() {
    return $("#aPanel").hidden && $("#kPanel").hidden && $("#lPanel").hidden && !state.lSending && !state.pSaving && !state.kSaving && !state.lManage;
  }

  // ======================================================================
  // TAHAP 4: DAFTAR PENGURUS DAN PERAN (hanya Ketua dan Wakil)
  // ======================================================================
  Object.assign(state, { pgs: [], gLoaded: false, gError: null, gEdit: null, gConfirmDel: null, gSaving: false });
  var PERAN = [["ketua", "Ketua RT"], ["wakil", "Wakil Ketua RT"], ["pic", "PIC (penanggung jawab gang)"], ["ibu", "Ibu RT"]];
  function peranLabel(g) {
    if (g.peran === "ketua") return "Ketua RT";
    if (g.peran === "wakil") return "Wakil Ketua RT";
    if (g.peran === "ibu") return "Ibu RT";
    return "PIC" + (g.gang && g.gang.trim() ? " " + g.gang.trim() : "");
  }
  function clearPengurus() {
    state.pgs = []; state.gLoaded = false; state.gError = null; state.gEdit = null; state.gConfirmDel = null;
    $("#gPanel").hidden = true;
    $("#g-list").textContent = "";
  }
  async function loadPengurus() {
    if (!sb || !state.admin) return;
    try {
      state.pgs = await fetchRows("pengurus", function (q) { return q.order("peran", { ascending: true }).order("email", { ascending: true }); });
      state.gError = null;
    } catch (e) {
      console.error("Gagal memuat pengurus:", e);
      state.gError = e || {};
    }
    state.gLoaded = true;
    renderAll();
  }
  function gErrText(e, fallback) {
    var c = e && e.code ? String(e.code) : "";
    if (c === "P0001" && e.message) return e.message;
    if (c === "23505") return "Email ini sudah terdaftar sebagai pengurus.";
    if (c === "23514") return "Isian tidak sesuai aturan. Periksa email, peran, dan nama gang.";
    return errText(e, fallback);
  }
  function renderPengurus() {
    $("#btn-gadd").hidden = !state.admin;
    if (!state.admin) { if (!$("#gPanel").hidden) { resetGForm(); $("#gPanel").hidden = true; } return; }
    var wrap = $("#g-list"), err = $("#g-error");
    wrap.textContent = "";
    if (state.gError) { err.textContent = secErr(state.gError, "pengurus", "Daftar pengurus").replace("supabase-tahap3.sql", "supabase-tahap4.sql"); err.hidden = false; return; }
    err.hidden = true;
    if (!state.gLoaded) { wrap.append(h("p", { class: "empty card" }, "Memuat daftar pengurus...")); return; }
    if (!state.pgs.length) { wrap.append(h("p", { class: "empty card" }, "Belum ada pengurus.")); return; }
    var me = String(state.email || "").toLowerCase();
    var ul = h("ul", { class: "plain kgrid" });
    state.pgs.forEach(function (g) {
      var self = g.email === me;
      var full = g.peran === "ketua" || g.peran === "wakil";
      var act = h("div", { class: "rowact left" });
      if (state.gConfirmDel === g.email) {
        act.append(
          h("button", { type: "button", class: "btn danger small", onclick: function () { deletePengurus(g); } }, "Ya, hapus akun dari daftar"),
          h("button", { type: "button", class: "btn ghost small", onclick: function () { state.gConfirmDel = null; renderPengurus(); } }, "Batal"));
      } else {
        act.append(h("button", { type: "button", class: "btn ghost small", onclick: function () { openGForm(g); } }, "Ubah"));
        if (!self) act.append(h("button", { type: "button", class: "btn danger ghost small", onclick: function () { state.gConfirmDel = g.email; renderPengurus(); } }, "Hapus"));
      }
      ul.append(h("li", { class: "kcard" + (state.gEdit && state.gEdit.email === g.email ? " editing" : "") + (g.aktif ? "" : " ended") },
        h("div", { class: "kmain" },
          h("strong", { class: "kname" }, peranLabel(g)),
          g.nama ? h("span", { class: "kperan" }, g.nama) : null,
          h("span", { class: "hint" }, g.email + (self ? " (Anda)" : "")),
          h("div", { class: "chips" },
            h("span", { class: "chip" + (full ? " alt" : "") }, full ? "Admin penuh" : "Berita dan data warga"),
            g.aktif ? null : h("span", { class: "chip" }, "Nonaktif"))),
        act));
    });
    wrap.append(ul);
  }
  function syncGangField() {
    var pic = $("#g-peran").value === "pic";
    $("#g-gang-wrap").hidden = !pic;
  }
  function resetGForm() {
    $("#gform").reset();
    setOptions($("#g-peran"), PERAN);
    state.gEdit = null;
    $("#gform-title").textContent = "Tambah pengurus";
    $("#g-submit").textContent = "Simpan";
    $("#g-email").disabled = false;
    $("#g-aktif").checked = true;
    $("#g-selfnote").hidden = true;
    $("#g-peran").disabled = false; $("#g-aktif").disabled = false;
    syncGangField();
  }
  function openGForm(g) {
    resetGForm();
    $("#g-msg").textContent = "";
    state.gConfirmDel = null;
    if (g) {
      state.gEdit = g;
      $("#gform-title").textContent = "Ubah pengurus";
      $("#g-submit").textContent = "Simpan perubahan";
      $("#g-email").value = g.email; $("#g-email").disabled = true;
      $("#g-nama").value = g.nama || "";
      $("#g-peran").value = g.peran;
      $("#g-gang").value = g.gang || "";
      $("#g-aktif").checked = !!g.aktif;
      if (g.email === String(state.email || "").toLowerCase()) {
        // Akun sendiri: boleh bertukar antara Ketua dan Wakil (keduanya admin penuh),
        // tetapi tidak boleh diturunkan menjadi PIC atau dinonaktifkan.
        setOptions($("#g-peran"), PERAN.slice(0, 2));
        $("#g-peran").value = g.peran;
        $("#g-aktif").disabled = true; $("#g-selfnote").hidden = false;
      }
      syncGangField();
    }
    $("#gPanel").hidden = false;
    renderPengurus();
    $("#gPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    (g ? $("#g-nama") : $("#g-email")).focus();
  }
  function closeGForm() { resetGForm(); $("#gPanel").hidden = true; $("#g-msg").textContent = ""; renderPengurus(); }
  async function onPengurusSubmit(ev) {
    ev.preventDefault();
    if (state.gSaving || !sb || !state.admin) return;
    var msg = $("#g-msg");
    var ed = state.gEdit;
    var email = ed ? ed.email : $("#g-email").value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.textContent = "Isi email yang valid."; return; }
    var peran = $("#g-peran").value;
    var isSelf = !!ed && ed.email === String(state.email || "").toLowerCase();
    if (isSelf && peran !== "ketua" && peran !== "wakil") { msg.textContent = "Akun Anda sendiri hanya bisa berperan Ketua RT atau Wakil Ketua RT."; return; }
    var gang = peran === "pic" ? $("#g-gang").value.trim().replace(/\s+/g, " ") : "";
    if (peran === "pic" && !gang) { msg.textContent = "Isi nama gang yang dipegang PIC, misalnya Gang Nuri. Nama ini tampil di setiap postingannya."; return; }
    var row = { nama: $("#g-nama").value.trim().replace(/\s+/g, " ") || null, peran: peran, gang: gang || null, aktif: ed && $("#g-aktif").disabled ? ed.aktif : $("#g-aktif").checked };
    state.gSaving = true;
    var btn = $("#g-submit");
    btn.disabled = true; btn.textContent = "Menyimpan..."; msg.textContent = "";
    try {
      var r = ed ? await sb.from("pengurus").update(row).eq("email", ed.email).select()
                 : await sb.from("pengurus").insert(Object.assign({ email: email }, row)).select();
      if (r.error) throw r.error;
      if (!r.data || !r.data.length) throw { code: "42501" };
      var wasEdit = !!ed;
      resetGForm();
      $("#gPanel").hidden = true;
      flashTemp(wasEdit ? "Perubahan tersimpan." : "Pengurus ditambahkan. Pastikan akun login-nya sudah dibuat di Supabase.", "ok");
      if (isSelf) await reloadProfil();
      await loadPengurus();
    } catch (e) {
      var c = e && e.code ? String(e.code) : "";
      msg.textContent = (c === "42P01" || c === "PGRST205") ? "Tabel pengurus belum dibuat. Jalankan supabase-tahap4.sql di SQL Editor Supabase."
        : gErrText(e, "Gagal menyimpan. Periksa koneksi lalu coba lagi.");
    } finally {
      state.gSaving = false;
      btn.disabled = false;
      btn.textContent = state.gEdit ? "Simpan perubahan" : "Simpan";
    }
  }
  // Setelah peran akun sendiri berubah, muat ulang profil supaya sambutan dan label ikut berubah.
  async function reloadProfil() {
    try {
      if (!sb.auth.getSession) return;
      var r = await sb.auth.getSession();
      await refreshAuth(r && r.data ? r.data.session : null);
    } catch (e) { /* label akan diperbarui saat halaman dimuat ulang */ }
  }
  async function deletePengurus(g) {
    try {
      var r = await sb.from("pengurus").delete().eq("email", g.email).select("email");
      if (r.error) throw r.error;
      if (!r.data || !r.data.length) throw { code: "42501" };
      state.gConfirmDel = null;
      if (state.gEdit && state.gEdit.email === g.email) closeGForm();
      flashTemp("Pengurus dihapus dari daftar.", "ok");
      await loadPengurus();
    } catch (e) { flash(gErrText(e, "Gagal menghapus. Coba lagi."), "err"); }
  }

  // ======================================================================
  // TAHAP 5: JADWAL RONDA
  // Warga: tab "Ronda" (jadwal bulan berjalan + status kehadiran).
  // Ketua/Wakil: mencatat kehadiran di tab yang sama, dan menyusun jadwal
  // bulan mana pun lewat tab "Atur Ronda" (seret dan lepas).
  // ======================================================================
  Object.assign(state, {
    rdPub: [], rdJ: [], rdA: [], rdSrc: null, rdLoaded: false, rdError: null, rdSaveErr: "", rdSaving: {},
    pKey: null, pLoadedKey: null, pLoading: false, pError: null, pSaved: {}, pDraft: {}, pSel: {}, pSaving: false,
    pAsk: null, pMsg: "", pQ: ""
  });
  var rSeq = 0, pSeq = 0;
  var RSTAT = [["hadir", "Ronda"], ["tukar", "Tukar"], ["izin", "Izin"], ["tidak", "Tidak ronda"]];

  function jakartaToday() { return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }); }
  function monthStart(iso) { return iso.slice(0, 7) + "-01"; }
  function addMonths(key, n) {
    var p = key.split("-").map(Number), d = new Date(p[0], p[1] - 1 + n, 1);
    return isoDate(d);
  }
  function sabtuKe(key, ke) {
    var p = key.split("-").map(Number), first = new Date(p[0], p[1] - 1, 1);
    var off = (6 - first.getDay() + 7) % 7;
    return isoDate(new Date(p[0], p[1] - 1, 1 + off + 7 * (ke - 1)));
  }
  function rondaErr(e) {
    var c = e && e.code ? String(e.code) : "";
    if (c === "42P01" || c === "PGRST205" || c === "42501" || c === "PGRST200") {
      return "Jadwal ronda belum siap. Jalankan supabase-tahap5.sql di SQL Editor Supabase.";
    }
    return "Jadwal ronda belum bisa dimuat. " + (e && e.message ? "[" + (c ? c + ": " : "") + e.message + "]" : "Periksa koneksi internet.");
  }
  function pName(w) { return w ? w.nama : "(warga dihapus)"; }

  // ---------- tab Ronda ----------
  async function loadRonda() {
    if (!sb) return;
    var my = ++rSeq, admin = state.admin, key = monthStart(jakartaToday());
    try {
      if (admin) {
        var dates = [1, 2, 3, 4].map(function (k) { return sabtuKe(key, k); });
        var a = await sb.from("ronda_jadwal").select("*").eq("bulan", key);
        if (a.error) throw a.error;
        var b = await sb.from("ronda_absen").select("*").gte("tanggal", dates[0]).lte("tanggal", dates[3]);
        if (b.error) throw b.error;
        if (my !== rSeq) return;
        state.rdJ = a.data || []; state.rdA = b.data || []; state.rdPub = [];
      } else {
        var r = await sb.from("ronda_publik").select("*").order("tanggal", { ascending: true }).order("nama", { ascending: true });
        if (r.error) throw r.error;
        if (my !== rSeq) return;
        state.rdPub = r.data || []; state.rdJ = []; state.rdA = [];
      }
      state.rdSrc = admin ? "admin" : "publik";
      state.rdError = null;
    } catch (e) {
      if (my !== rSeq) return;
      console.error("Gagal memuat jadwal ronda:", e);
      state.rdError = e || {};
    }
    state.rdLoaded = true;
    renderAll();
  }
  function clearRondaAdmin() {
    state.pKey = null; state.pLoadedKey = null; state.pSaved = {}; state.pDraft = {}; state.pSel = {};
    state.pAsk = null; state.pMsg = ""; state.pError = null;
    if (state.rdSrc === "admin") { state.rdJ = []; state.rdA = []; state.rdSrc = null; state.rdLoaded = false; }
  }
  function rondaRows() {
    var key = monthStart(jakartaToday());
    if (state.admin && state.rdSrc === "admin") {
      var byId = {}; state.warga.forEach(function (w) { byId[w.id] = w; });
      var ab = {}; state.rdA.forEach(function (x) { ab[x.tanggal + "|" + x.warga_id] = x; });
      return state.rdJ.map(function (j) {
        var w = byId[j.warga_id], tgl = sabtuKe(key, j.kelompok), x = ab[tgl + "|" + j.warga_id];
        return { id: j.warga_id, kelompok: j.kelompok, tanggal: tgl, nama: pName(w), no_rumah: w ? w.no_rumah : "",
          status: x ? x.status : "", catatan: x ? (x.catatan || "") : "" };
      });
    }
    return state.rdPub.map(function (p) {
      return { id: null, kelompok: p.kelompok, tanggal: p.tanggal, nama: p.nama, no_rumah: p.no_rumah, status: p.status || "", catatan: p.catatan || "" };
    });
  }
  async function saveAbsen(row, status, catatan, card) {
    var k = row.tanggal + "|" + row.id;
    if (state.rdSaving[k]) return;
    state.rdSaving[k] = true;
    try {
      var res;
      if (!status) {
        res = await sb.from("ronda_absen").delete().eq("tanggal", row.tanggal).eq("warga_id", row.id);
      } else {
        res = await sb.from("ronda_absen").upsert({ tanggal: row.tanggal, warga_id: row.id, status: status, catatan: catatan ? catatan.slice(0, 120) : null, dicatat_pada: new Date().toISOString() }, { onConflict: "tanggal,warga_id" });
      }
      if (res.error) throw res.error;
      state.rdA = state.rdA.filter(function (x) { return !(x.tanggal === row.tanggal && x.warga_id === row.id); });
      if (status) state.rdA.push({ tanggal: row.tanggal, warga_id: row.id, status: status, catatan: catatan || null });
      state.rdSaveErr = "";
    } catch (e) {
      console.error("Gagal menyimpan kehadiran:", e);
      state.rdSaveErr = "Kehadiran belum tersimpan. " + errText(e, "Periksa koneksi lalu coba lagi.");
    } finally {
      delete state.rdSaving[k];
      renderAll();
    }
  }
  function renderRonda() {
    var grid = $("#r-grid"), err = $("#r-error");
    var key = monthStart(jakartaToday());
    $("#r-title").textContent = "Jadwal ronda " + monthLabel(key);
    grid.textContent = "";
    $("#r-legend").hidden = true;
    if (state.rdError) { err.textContent = rondaErr(state.rdError); err.hidden = false; return; }
    err.textContent = state.rdSaveErr || ""; err.hidden = !state.rdSaveErr;
    if (!state.rdLoaded) { grid.append(h("p", { class: "empty card" }, "Memuat jadwal ronda...")); return; }
    var rows = rondaRows();
    if (!rows.length) {
      grid.append(h("p", { class: "empty card" }, state.admin
        ? "Jadwal bulan ini belum disusun. Buka tab Atur Ronda untuk menyusunnya."
        : "Jadwal ronda bulan ini belum disusun oleh pengurus."));
      return;
    }
    $("#r-legend").hidden = false;
    var today = jakartaToday(), nextDone = false;
    [1, 2, 3, 4].forEach(function (k) {
      var tgl = sabtuKe(key, k);
      var list = rows.filter(function (r) { return r.kelompok === k; }).sort(function (a, b) { return ncmp(a.nama, b.nama); });
      var past = tgl < today, isNext = !past && !nextDone;
      if (isNext) nextDone = true;
      var cnt = {}; list.forEach(function (r) { if (r.status) cnt[r.status] = (cnt[r.status] || 0) + 1; });
      var sum = RSTAT.filter(function (s) { return cnt[s[0]]; }).map(function (s) { return s[1] + " " + cnt[s[0]]; }).join(" · ");
      var card = h("section", { class: "rcard" + (isNext ? " next" : "") + (past ? " past" : ""), "data-k": String(k) },
        h("header", { class: "rhead" },
          h("div", {}, h("h3", {}, "Kelompok " + k), h("p", { class: "hint" }, longDate(tgl))),
          isNext ? h("span", { class: "chip" }, "Berikutnya") : (past ? h("span", { class: "chip alt" }, "Sudah lewat") : null)),
        sum ? h("p", { class: "rsum" }, sum) : null);
      if (!list.length) card.append(h("p", { class: "empty" }, "Belum ada anggota."));
      var ul = h("ul", { class: "plain rlist" });
      list.forEach(function (r) {
        var li = h("li", { class: "rrow" },
          h("div", { class: "rwho" }, h("strong", {}, r.nama), h("span", { class: "sub2" }, r.no_rumah ? "No. " + r.no_rumah : "")));
        if (state.admin && r.id) {
          var sel = h("select", { "aria-label": "Status " + r.nama, class: "rsel st-" + (r.status || "none") },
            h("option", { value: "" }, "Belum dicatat"),
            RSTAT.map(function (s) { return h("option", { value: s[0] }, s[1]); }));
          sel.value = r.status || "";
          var note = h("input", { type: "text", maxlength: "120", class: "rnote", "aria-label": "Catatan untuk " + r.nama, placeholder: "Catatan (misal: tukar dengan Pak Budi)" });
          note.value = r.catatan || "";
          if (state.rdSaving[r.tanggal + "|" + r.id]) { sel.disabled = true; note.disabled = true; }
          sel.addEventListener("change", function () { saveAbsen(r, sel.value, note.value.trim()); });
          note.addEventListener("change", function () { if (sel.value) saveAbsen(r, sel.value, note.value.trim()); });
          li.append(h("div", { class: "rctl" }, sel, note));
        } else {
          li.append(h("div", { class: "rctl" },
            r.status ? h("span", { class: "rstat st-" + r.status }, (RSTAT.filter(function (s) { return s[0] === r.status; })[0] || ["", r.status])[1]) : null,
            r.catatan ? h("span", { class: "sub2" }, r.catatan) : null));
        }
        ul.append(li);
      });
      card.append(ul);
      grid.append(card);
    });
  }

  // ---------- tab Atur Ronda ----------
  function pEligible() { return state.warga.filter(ikutRonda); }
  function pCopy(o) { var c = {}; Object.keys(o).forEach(function (k) { c[k] = o[k]; }); return c; }
  function pDirty() {
    var a = state.pSaved, b = state.pDraft, k;
    for (k in a) if (b[k] !== a[k]) return true;
    for (k in b) if (a[k] !== b[k]) return true;
    return false;
  }
  function pSelIds() { return Object.keys(state.pSel).filter(function (k) { return state.pSel[k]; }); }
  async function loadAtur() {
    if (!sb || !state.admin || state.pLoading) return;
    var my = ++pSeq, key = state.pKey;
    state.pLoading = true;
    try {
      var r = await sb.from("ronda_jadwal").select("*").eq("bulan", key);
      if (r.error) throw r.error;
      if (my !== pSeq) return;
      var m = {}; (r.data || []).forEach(function (j) { m[j.warga_id] = j.kelompok; });
      state.pSaved = m; state.pDraft = pCopy(m); state.pSel = {}; state.pError = null; state.pAsk = null;
    } catch (e) {
      if (my !== pSeq) return;
      console.error("Gagal memuat jadwal ronda:", e);
      state.pError = e || {};
    }
    state.pLoading = false;
    state.pLoadedKey = key;
    renderAll();
  }
  function pMove(ids, k) {
    ids.forEach(function (id) { if (k) state.pDraft[id] = k; else delete state.pDraft[id]; });
    state.pSel = {}; state.pAsk = null; state.pMsg = "";
    renderAtur();
  }
  function pSizes() { var s = [0, 0, 0, 0, 0]; pEligible().forEach(function (w) { var k = state.pDraft[w.id]; if (k) s[k]++; }); return s; }
  function pFill() {
    var s = pSizes(), n = 0;
    pEligible().filter(function (w) { return !state.pDraft[w.id]; })
      .sort(function (a, b) { return ncmp(a.gang, b.gang) || ncmp(a.no_rumah, b.no_rumah) || ncmp(a.nama, b.nama); })
      .forEach(function (w) {
        var best = 1; for (var k = 2; k <= 4; k++) if (s[k] < s[best]) best = k;
        state.pDraft[w.id] = best; s[best]++; n++;
      });
    return n;
  }
  function pAuto() {
    state.pDraft = {};
    pEligible().sort(function (a, b) { return ncmp(a.gang, b.gang) || ncmp(a.no_rumah, b.no_rumah) || ncmp(a.nama, b.nama); })
      .forEach(function (w, i) { state.pDraft[w.id] = (i % 4) + 1; });
  }
  async function pCopyPrev() {
    var r = await sb.from("ronda_jadwal").select("*").eq("bulan", addMonths(state.pKey, -1));
    if (r.error) throw r.error;
    var elig = {}; pEligible().forEach(function (w) { elig[w.id] = true; });
    var d = {}, n = 0;
    (r.data || []).forEach(function (j) { if (elig[j.warga_id]) { d[j.warga_id] = (j.kelompok % 4) + 1; n++; } });
    state.pDraft = d;
    return n;
  }
  async function pSave() {
    if (state.pSaving || !pDirty()) return;
    state.pSaving = true; state.pMsg = ""; renderAtur();
    var key = state.pKey, up = [], del = [];
    Object.keys(state.pDraft).forEach(function (id) { if (state.pSaved[id] !== state.pDraft[id]) up.push({ bulan: key, warga_id: id, kelompok: state.pDraft[id] }); });
    Object.keys(state.pSaved).forEach(function (id) { if (!state.pDraft[id]) del.push(id); });
    try {
      if (up.length) { var a = await sb.from("ronda_jadwal").upsert(up, { onConflict: "bulan,warga_id" }); if (a.error) throw a.error; }
      if (del.length) { var b = await sb.from("ronda_jadwal").delete().eq("bulan", key).in("warga_id", del); if (b.error) throw b.error; }
      state.pSaved = pCopy(state.pDraft);
      state.pMsg = "Jadwal " + monthLabel(key) + " tersimpan.";
      state.pError = null;
      loadRonda();
    } catch (e) {
      console.error("Gagal menyimpan jadwal ronda:", e);
      state.pMsg = "Jadwal belum tersimpan. " + errText(e, "Periksa koneksi lalu coba lagi.");
    }
    state.pSaving = false;
    renderAtur();
  }
  function pChip(w) {
    var id = w.id, k = state.pDraft[id] || 0, moved = (state.pSaved[id] || 0) !== k, on = !!state.pSel[id];
    var c = h("div", {
      class: "pchip" + (on ? " sel" : "") + (moved ? " moved" : ""), role: "button", tabindex: "0", draggable: "true",
      "aria-pressed": String(on), "data-id": id,
      "aria-label": w.nama + ", rumah " + (w.no_rumah || "-") + ", " + (k ? "kelompok " + k : "belum dijadwalkan")
    },
      h("strong", {}, w.nama),
      h("span", { class: "sub2" }, (w.gang ? w.gang + " · " : "") + "No. " + (w.no_rumah || "-")));
    function toggle() { state.pSel[id] = !state.pSel[id]; renderAtur(); }
    c.addEventListener("click", toggle);
    c.addEventListener("keydown", function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); toggle(); } });
    c.addEventListener("dragstart", function (ev) {
      var ids = state.pSel[id] ? pSelIds() : [id];
      ev.dataTransfer.setData("text/plain", JSON.stringify(ids));
      ev.dataTransfer.effectAllowed = "move";
      c.classList.add("drag");
    });
    c.addEventListener("dragend", function () { c.classList.remove("drag"); Array.prototype.forEach.call(document.querySelectorAll(".bcol.over"), function (x) { x.classList.remove("over"); }); });
    return c;
  }
  function renderAtur() {
    if (!state.admin) return;
    if (!state.pKey) state.pKey = addMonths(monthStart(jakartaToday()), 1);
    var err = $("#p-error"), board = $("#p-board"), note = $("#p-notice");
    $("#p-month").textContent = monthLabel(state.pKey);
    var cur = monthStart(jakartaToday());
    var busy = state.pSaving || state.pLoading;
    board.textContent = "";
    if (state.pLoadedKey !== state.pKey && !state.pLoading && !state.pError) { loadAtur(); }
    var bad = state.pError ? rondaErr(state.pError)
      : (state.wLoaded && state.warga.length && !("jenis_kelamin" in state.warga[0]) ? "Kolom jenis kelamin dan kepala keluarga belum ada. Jalankan supabase-tahap5.sql di SQL Editor Supabase." : "");
    err.textContent = bad; err.hidden = !bad;
    var msg = state.pMsg || (state.pKey === cur ? "Ini bulan yang sedang berjalan: perubahan langsung terlihat oleh warga." : (state.pKey < cur ? "Ini bulan yang sudah lewat." : ""));
    note.textContent = msg; note.hidden = !msg;
    var dirty = pDirty(), n = pSelIds().length;
    $("#p-save").disabled = !dirty || busy || !!bad;
    $("#p-save").textContent = state.pSaving ? "Menyimpan..." : "Simpan jadwal";
    $("#p-reset").hidden = !dirty;
    ["#p-auto", "#p-fill", "#p-copy"].forEach(function (s) { $(s).disabled = busy || !!bad; });
    $("#p-auto").textContent = state.pAsk === "auto" ? "Yakin? Klik lagi untuk menimpa" : "Susun otomatis";
    $("#p-copy").textContent = state.pAsk === "copy" ? "Yakin? Klik lagi untuk menimpa" : "Salin dan putar dari bulan lalu";
    var cf = $("#p-confirm"); cf.hidden = !state.pAsk;
    cf.textContent = state.pAsk ? "Susunan yang sekarang di layar akan diganti (belum disimpan sampai Anda menekan Simpan jadwal)." : "";
    if (bad) { $("#p-status").textContent = ""; return; }
    if (!state.wLoaded || state.pLoadedKey !== state.pKey) { $("#p-status").textContent = "Memuat..."; return; }
    var elig = pEligible(), q = (state.pQ || "").toLowerCase();
    var unk = state.warga.filter(function (w) { var a = ageOf(w.tanggal_lahir); return w.status_mukim === "mukim" && a != null && a >= 18 && !w.jenis_kelamin && !w.kepala_keluarga; }).length;
    var sizes = pSizes(), un = elig.length - sizes[1] - sizes[2] - sizes[3] - sizes[4];
    $("#p-status").textContent = elig.length + " warga ikut jadwal ronda · " + un + " belum dijadwalkan" + (n ? " · " + n + " dipilih" : "") +
      (unk ? " · " + unk + " warga mukim dewasa belum diisi jenis kelaminnya di Data Warga" : "") +
      (dirty ? " · ada perubahan yang belum disimpan" : "");
    // jadwal lama untuk warga yang tidak lagi ikut ronda tetap ditampilkan agar bisa dirapikan
    var byId = {}; state.warga.forEach(function (w) { byId[w.id] = w; });
    var people = elig.slice();
    Object.keys(state.pDraft).forEach(function (id) { if (byId[id] && !ikutRonda(byId[id])) people.push(byId[id]); });
    var cols = [[0, "Belum dijadwalkan", ""], [1, "Kelompok 1", sabtuKe(state.pKey, 1)], [2, "Kelompok 2", sabtuKe(state.pKey, 2)],
      [3, "Kelompok 3", sabtuKe(state.pKey, 3)], [4, "Kelompok 4", sabtuKe(state.pKey, 4)]];
    cols.forEach(function (c) {
      var k = c[0];
      var mem = people.filter(function (w) { return (state.pDraft[w.id] || 0) === k; })
        .sort(function (a, b) { return ncmp(a.gang, b.gang) || ncmp(a.no_rumah, b.no_rumah) || ncmp(a.nama, b.nama); });
      var col = h("section", { class: "bcol" + (k ? "" : " unassigned"), "data-k": String(k), "aria-label": c[1] },
        h("header", {}, h("h3", {}, c[1]), h("span", { class: "chip" }, String(mem.length))),
        c[2] ? h("p", { class: "hint" }, "Sabtu ke-" + k + ": " + longDate(c[2])) : h("p", { class: "hint" }, "Tidak ikut ronda bulan ini"));
      if (n) col.append(h("button", { type: "button", class: "btn small ghost", onclick: function () { pMove(pSelIds(), k); } },
        k ? "Pindahkan " + n + " ke sini" : "Keluarkan " + n + " dari jadwal"));
      var body = h("div", { class: "bbody" });
      mem.forEach(function (w) {
        var chip = pChip(w);
        if (q && (w.nama + " " + (w.no_rumah || "") + " " + (w.gang || "")).toLowerCase().indexOf(q) < 0) chip.hidden = true;
        body.append(chip);
      });
      if (!mem.length) body.append(h("p", { class: "empty" }, k ? "Seret nama ke sini" : "Semua sudah dijadwalkan"));
      col.append(body);
      col.addEventListener("dragover", function (ev) { ev.preventDefault(); ev.dataTransfer.dropEffect = "move"; col.classList.add("over"); });
      col.addEventListener("dragleave", function (ev) { if (!col.contains(ev.relatedTarget)) col.classList.remove("over"); });
      col.addEventListener("drop", function (ev) {
        ev.preventDefault(); col.classList.remove("over");
        var ids = [];
        try { ids = JSON.parse(ev.dataTransfer.getData("text/plain") || "[]"); } catch (e) { ids = []; }
        if (Array.isArray(ids) && ids.length) pMove(ids.filter(function (x) { return typeof x === "string"; }), k);
      });
      board.append(col);
    });
  }
  function pShift(n) {
    if (pDirty()) { state.pMsg = "Simpan atau batalkan perubahan dulu sebelum pindah bulan."; renderAtur(); return; }
    state.pKey = addMonths(state.pKey, n); state.pMsg = ""; state.pSel = {}; state.pAsk = null; state.pError = null;
    renderAtur();
  }
  async function pAction(kind) {
    var has = Object.keys(state.pDraft).length > 0;
    if (has && state.pAsk !== kind) { state.pAsk = kind; renderAtur(); return; }
    state.pAsk = null; state.pSel = {};
    try {
      if (kind === "auto") { pAuto(); state.pMsg = "Disusun otomatis: warga dibagi rata, anggota satu rumah diusahakan beda kelompok."; }
      else if (kind === "fill") { var n = pFill(); state.pMsg = n ? n + " warga dimasukkan ke kelompok yang paling sedikit." : "Semua warga yang ikut ronda sudah dijadwalkan."; }
      else if (kind === "copy") {
        var c = await pCopyPrev();
        if (!c) { state.pMsg = "Bulan lalu belum ada jadwal untuk disalin."; }
        else { var f = pFill(); state.pMsg = c + " warga disalin dari bulan lalu dengan kelompok digeser satu" + (f ? ", " + f + " warga baru ditambahkan." : "."); }
      }
    } catch (e) { state.pMsg = "Gagal menyalin jadwal bulan lalu. " + errText(e, "Coba lagi."); }
    renderAtur();
  }

  // ======================================================================
  // TAHAP 7: IKLAN WARGA (UMKM warga RT)
  // Warga membaca tampilan iklan_publik; Ketua dan Wakil mengelola di tab Iklan.
  // Statistik hanya tiga angka: tayangan, klik iklan, klik hubungi penjual.
  // ======================================================================
  Object.assign(state, {
    iklan: [], iLoaded: false, iError: null,
    iAdm: [], iStat: {}, iAdmLoaded: false, iAdmError: null, iEdit: null, iSaving: false, iConfirmDel: null, iEndTouched: false
  });
  var IKLAN_DIR = "iklan/";
  var IPOSISI = [["semua", "Beranda dan Info Penting"], ["beranda", "Hanya di antara berita (Beranda)"], ["info", "Hanya di Info Penting"]];
  var adSeen = {}, adObs = null, adOrder = [], adSig = "";

  function iklanErr(e, what) {
    var c = e && e.code ? String(e.code) : "";
    if (c === "42P01" || c === "PGRST205" || c === "42501" || c === "PGRST202" || c === "PGRST200") {
      return "Fitur iklan belum siap. Jalankan supabase-tahap7.sql di SQL Editor Supabase.";
    }
    return what + " belum bisa dimuat. " + (e && e.message ? "[" + (c ? c + ": " : "") + e.message + "]" : "Periksa koneksi internet.");
  }
  async function loadIklan() {
    if (!sb) return;
    try {
      var r = await sb.from("iklan_publik").select("*");
      if (r.error) throw r.error;
      state.iklan = r.data || [];
      state.iError = null;
    } catch (e) {
      console.error("Gagal memuat iklan:", e);
      state.iError = e || {};
      state.iklan = [];
    }
    state.iLoaded = true;
    renderAll();
  }
  // Urutan acak: dikocok setiap kali daftar iklan berubah atau halaman dibuka ulang,
  // jadi iklan yang tampil pertama berbeda-beda dan tidak itu-itu saja.
  function adPool(pos) {
    var sig = state.iklan.map(function (a) { return a.id; }).sort().join(",");
    if (sig !== adSig) {
      adSig = sig;
      adOrder = state.iklan.map(function (a) { return a.id; });
      for (var i = adOrder.length - 1; i > 0; i--) { var j = rnd(i + 1), t = adOrder[i]; adOrder[i] = adOrder[j]; adOrder[j] = t; }
    }
    var byId = {}; state.iklan.forEach(function (a) { byId[a.id] = a; });
    return adOrder.map(function (id) { return byId[id]; }).filter(function (a) { return a && (a.posisi === pos || a.posisi === "semua"); });
  }
  function adCatat(id, jenis) {
    if (!sb || state.staff) return; // tampilan pengurus tidak menambah hitungan
    try { Promise.resolve(sb.rpc("iklan_catat", { p_id: id, p_jenis: jenis })).catch(function () {}); } catch (e) { /* abaikan */ }
  }
  function adReset() { if (adObs) { adObs.disconnect(); adObs = null; } }
  // Tayangan dihitung bila iklan terlihat minimal 50% selama 1 detik, paling banyak sekali per kunjungan.
  function adWatch(el, id) {
    if (state.staff || adSeen[id + ":t"] || !("IntersectionObserver" in window)) return;
    if (!adObs) {
      adObs = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          var node = en.target, aid = node.getAttribute("data-ad");
          if (en.isIntersecting && en.intersectionRatio >= 0.5) {
            if (node._adt) return;
            node._adt = setTimeout(function () {
              node._adt = null;
              if (adSeen[aid + ":t"]) return;
              adSeen[aid + ":t"] = true;
              adCatat(aid, "tayang");
              if (adObs) adObs.unobserve(node);
            }, 1000);
          } else if (node._adt) { clearTimeout(node._adt); node._adt = null; }
        });
      }, { threshold: [0, 0.5, 1] });
    }
    adObs.observe(el);
  }
  function adMedia(a, cls) {
    var box = h("div", { class: cls + " tone" + avatarTone(a.nama_usaha) });
    box.append(h("span", { class: "adini", "aria-hidden": "true" }, inisial(a.nama_usaha)));
    if (a.foto_path) {
      var img = h("img", { src: proofUrl(a.foto_path), alt: "Foto " + a.nama_usaha, loading: "lazy", decoding: "async" });
      img.addEventListener("error", function () { img.remove(); });
      box.append(img);
    }
    return box;
  }
  function adEl(a) {
    var wa = waLink(a.whatsapp);
    var desc = h("p", { class: "addesc clamp" }, a.deskripsi || "");
    var more = a.deskripsi && a.deskripsi.length > 90
      ? h("button", { type: "button", class: "linkbtn more", "aria-expanded": "false" }, "Lihat detail") : null;
    var media = adMedia(a, "admedia");
    function open() {
      var on = desc.classList.toggle("clamp") === false;
      if (more) { more.textContent = on ? "Tutup" : "Lihat detail"; more.setAttribute("aria-expanded", String(on)); }
      card.classList.toggle("open", on);
      if (on && !adSeen[a.id + ":k"]) { adSeen[a.id + ":k"] = true; adCatat(a.id, "klik"); }
    }
    if (more) more.addEventListener("click", open);
    media.addEventListener("click", function () {
      if (!adSeen[a.id + ":k"]) { adSeen[a.id + ":k"] = true; adCatat(a.id, "klik"); }
      media.classList.toggle("zoom");
    });
    var btn = null;
    if (wa) {
      btn = h("a", {
        class: "btn small adwa", href: wa + "?text=" + encodeURIComponent("Halo, saya lihat iklan " + a.nama_usaha + " di Portal RT 007/016."),
        target: "_blank", rel: "noopener", "aria-label": "Hubungi penjual " + a.nama_usaha + " lewat WhatsApp"
      });
      var ic = h("span", { class: "ico", "aria-hidden": "true" }); ic.innerHTML = ICON_WA;
      btn.append(ic, "Hubungi penjual");
      btn.addEventListener("click", function () { adCatat(a.id, "wa"); });
    }
    var card = h("article", { class: "adcard", "data-ad": a.id, "aria-label": "Iklan warga: " + a.nama_usaha },
      media,
      h("div", { class: "adbody" },
        h("span", { class: "adlabel" }, "Iklan warga"),
        h("h3", {}, a.nama_usaha), desc, more, btn));
    adWatch(card, a.id);
    return card;
  }
  // Beranda: iklan disisipkan setelah berita ke-2, ke-6, ke-10 (paling banyak 3), berganti acak.
  function adsInTimeline(ol, items) {
    var pool = adPool("beranda");
    if (!pool.length || !items.length) return;
    var slots = [], n = 0, posts = items.length;
    for (var p = 2; p <= posts && slots.length < 3; p += 4) slots.push(p);
    if (!slots.length) slots.push(posts);
    var shown = {};
    slots.forEach(function (after, k) {
      var a = pool[k % pool.length];
      if (shown[a.id]) return;
      shown[a.id] = true;
      var li = items[after - 1];
      if (li && li.parentNode === ol) li.after(h("li", { class: "adslot" }, adEl(a)));
    });
  }
  function renderInfoAds() {
    var box = $("#k-ads");
    box.textContent = "";
    var pool = adPool("info").slice(0, 2);
    if (!pool.length || state.kError) return;
    var wrap = h("section", { class: "kgroup" },
      h("h3", {}, "Usaha warga"),
      h("p", { class: "hint" }, "Iklan usaha tetangga RT 007/016."));
    var ul = h("div", { class: "adgrid" });
    pool.forEach(function (a) { ul.append(adEl(a)); });
    wrap.append(ul);
    box.append(wrap);
  }

  // ---------- tab Iklan (Ketua dan Wakil) ----------
  function iStatus(a) {
    var t = jakartaToday();
    if (!a.aktif) return ["Nonaktif", "off"];
    if (!a.dibayar) return ["Belum dibayar", "st-dilaporkan"];
    if (t < a.mulai) return ["Belum mulai", "st-dikerjakan"];
    if (t > a.berakhir) return ["Berakhir", "off"];
    return ["Tayang", "st-selesai"];
  }
  function clearIklanAdmin() {
    state.iAdm = []; state.iStat = {}; state.iAdmLoaded = false; state.iAdmError = null; state.iEdit = null; state.iConfirmDel = null;
    $("#iPanel").hidden = true; $("#i-list").textContent = "";
  }
  async function loadIklanAdmin() {
    if (!sb || !state.admin) return;
    try {
      state.iAdm = await fetchRows("iklan", function (q) { return q.order("mulai", { ascending: false }).order("created_at", { ascending: false }); });
      var s = await sb.rpc("iklan_ringkasan");
      if (s.error) throw s.error;
      var m = {}; (s.data || []).forEach(function (x) { m[x.iklan_id] = x; });
      state.iStat = m;
      state.iAdmError = null;
    } catch (e) {
      console.error("Gagal memuat daftar iklan:", e);
      state.iAdmError = e || {};
    }
    state.iAdmLoaded = true;
    renderAll();
  }
  function periodEnd(mulai) {
    if (!mulai) return "";
    var p = mulai.split("-").map(Number), nd = Math.min(p[2], new Date(p[0], p[1] + 1, 0).getDate()), d = new Date(p[0], p[1], nd - 1); // 1 bulan penuh: tanggal yang sama bulan depan dikurangi sehari
    return isoDate(d);
  }
  function setIPreview(src) {
    var img = $("#i-preview"), wrapEl = $("#i-preview-wrap");
    if (!src) { img.removeAttribute("src"); wrapEl.hidden = true; return; }
    img.src = src; wrapEl.hidden = false;
  }
  function resetIForm() {
    $("#iform").reset();
    state.iEdit = null; state.iEndTouched = false;
    setOptions($("#i-posisi"), IPOSISI);
    $("#iform-title").textContent = "Tambah iklan";
    $("#i-submit").textContent = "Simpan iklan";
    $("#i-mulai").value = todayISO();
    $("#i-berakhir").value = periodEnd(todayISO());
    $("#i-tarif").value = "50000";
    $("#i-aktif").checked = true;
    $("#i-dibayar").checked = false;
    $("#i-hapusfoto-wrap").hidden = true;
    setIPreview(null);
  }
  function openIForm(a) {
    resetIForm();
    $("#i-msg").textContent = "";
    state.iConfirmDel = null;
    if (a) {
      state.iEdit = a; state.iEndTouched = true;
      $("#iform-title").textContent = "Ubah iklan";
      $("#i-submit").textContent = "Simpan perubahan";
      $("#i-nama").value = a.nama_usaha || "";
      $("#i-deskripsi").value = a.deskripsi || "";
      $("#i-wa").value = a.whatsapp || "";
      $("#i-posisi").value = a.posisi;
      $("#i-mulai").value = a.mulai; $("#i-berakhir").value = a.berakhir;
      $("#i-tarif").value = String(a.tarif || 0);
      $("#i-pemilik").value = a.pemilik || ""; $("#i-rumah").value = a.no_rumah || "";
      $("#i-aktif").checked = !!a.aktif; $("#i-dibayar").checked = !!a.dibayar;
      if (a.foto_path) { setIPreview(proofUrl(a.foto_path)); $("#i-hapusfoto-wrap").hidden = false; }
    }
    $("#iPanel").hidden = false;
    renderIklanAdmin();
    $("#iPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    $("#i-nama").focus();
  }
  function closeIForm() { resetIForm(); $("#iPanel").hidden = true; $("#i-msg").textContent = ""; renderIklanAdmin(); }
  async function iUpdate(a, patch, okMsg) {
    try {
      var r = await sb.from("iklan").update(patch).eq("id", a.id).select();
      if (r.error) throw r.error;
      if (!r.data || !r.data.length) throw { code: "42501" };
      flashTemp(okMsg, "ok");
      await loadIklanAdmin(); loadIklan();
    } catch (e) { flash(errText(e, "Gagal menyimpan. Coba lagi."), "err"); }
  }
  async function deleteIklan(a) {
    try {
      var r = await sb.from("iklan").delete().eq("id", a.id).select("id");
      if (r.error) throw r.error;
      if (!r.data || !r.data.length) throw { code: "42501" };
      if (a.foto_path) sb.storage.from(BUCKET).remove([a.foto_path]);
      state.iConfirmDel = null;
      if (state.iEdit && state.iEdit.id === a.id) closeIForm();
      flashTemp("Iklan dihapus.", "ok");
      await loadIklanAdmin(); loadIklan();
    } catch (e) { flash(errText(e, "Gagal menghapus. Coba lagi."), "err"); }
  }
  function iRow(a) {
    var st = iStatus(a), s = state.iStat[a.id] || {};
    var stat = function (label, v) { return h("div", { class: "istat" }, h("strong", { class: "num" }, Number(v || 0).toLocaleString("id-ID")), h("span", {}, label)); };
    var acts = h("div", { class: "rowact left" });
    if (state.iConfirmDel === a.id) {
      acts.append(
        h("button", { type: "button", class: "btn danger small", onclick: function () { deleteIklan(a); } }, "Ya, hapus"),
        h("button", { type: "button", class: "btn ghost small", onclick: function () { state.iConfirmDel = null; renderIklanAdmin(); } }, "Batal"));
    } else {
      if (!a.dibayar) acts.append(h("button", { type: "button", class: "btn small", onclick: function () { iUpdate(a, { dibayar: true }, "Ditandai sudah dibayar."); } }, "Tandai sudah dibayar"));
      acts.append(
        h("button", { type: "button", class: "btn ghost small", onclick: function () { openIForm(a); } }, "Ubah"),
        h("button", { type: "button", class: "btn ghost small", onclick: function () { iUpdate(a, { aktif: !a.aktif }, a.aktif ? "Iklan dinonaktifkan." : "Iklan diaktifkan."); } }, a.aktif ? "Nonaktifkan" : "Aktifkan"),
        h("button", { type: "button", class: "btn danger ghost small", onclick: function () { state.iConfirmDel = a.id; renderIklanAdmin(); } }, "Hapus"));
    }
    var pos = (IPOSISI.filter(function (x) { return x[0] === a.posisi; })[0] || ["", a.posisi])[1];
    return h("li", { class: "kcard adrow" + (state.iEdit && state.iEdit.id === a.id ? " editing" : "") },
      adMedia(a, "adthumb"),
      h("div", { class: "kbody" },
        h("div", { class: "kmain" },
          h("div", { class: "lhead" }, h("strong", { class: "kname" }, a.nama_usaha), h("span", { class: st[1] === "off" ? "chip" : "status " + st[1] }, st[0])),
          h("span", { class: "hint" }, (a.pemilik || "-") + (a.no_rumah ? " · No. " + a.no_rumah : "") + " · " + a.whatsapp),
          h("span", { class: "hint" }, dateLabel(a.mulai) + " sampai " + dateLabel(a.berakhir) + " · " + rp(a.tarif || 0) + " · " + pos)),
        h("div", { class: "istats" }, stat("Tayangan", s.tayang), stat("Klik iklan", s.klik), stat("Klik hubungi penjual", s.wa)),
        acts));
  }
  function renderIklanAdmin() {
    if (!state.admin) return;
    var wrap = $("#i-list"), err = $("#i-error");
    wrap.textContent = "";
    $("#i-summary").textContent = "";
    if (state.iAdmError) { err.textContent = iklanErr(state.iAdmError, "Daftar iklan"); err.hidden = false; return; }
    err.hidden = true;
    if (!state.iAdmLoaded) { wrap.append(h("p", { class: "empty card" }, "Memuat daftar iklan...")); return; }
    if (!state.iAdm.length) { wrap.append(h("p", { class: "empty card" }, "Belum ada iklan. Klik Tambah iklan untuk memulai.")); return; }
    var live = state.iAdm.filter(function (a) { return iStatus(a)[0] === "Tayang"; }).length;
    var tot = { t: 0, k: 0, w: 0 };
    Object.keys(state.iStat).forEach(function (id) { var s = state.iStat[id]; tot.t += Number(s.tayang || 0); tot.k += Number(s.klik || 0); tot.w += Number(s.wa || 0); });
    $("#i-summary").textContent = live + " iklan sedang tayang dari " + state.iAdm.length + " · total " + tot.t.toLocaleString("id-ID") + " tayangan, " + tot.k.toLocaleString("id-ID") + " klik, " + tot.w.toLocaleString("id-ID") + " klik hubungi penjual";
    var ul = h("ul", { class: "plain adlist" });
    state.iAdm.forEach(function (a) { ul.append(iRow(a)); });
    wrap.append(ul);
  }
  async function onIklanSubmit(ev) {
    ev.preventDefault();
    if (state.iSaving || !sb || !state.admin) return;
    var msg = $("#i-msg");
    var nama = $("#i-nama").value.trim().replace(/\s+/g, " ");
    var wa = normPhone($("#i-wa").value);
    var mulai = $("#i-mulai").value, akhir = $("#i-berakhir").value;
    var tarif = parseInt(digits($("#i-tarif").value), 10);
    if (!nama) { msg.textContent = "Isi nama usaha."; return; }
    if (!wa || !/^\+?[0-9]{8,15}$/.test(wa)) { msg.textContent = "Nomor WhatsApp tidak valid. Gunakan 8 sampai 15 digit, contoh 081234567890."; return; }
    if (!mulai || !akhir) { msg.textContent = "Isi tanggal mulai dan berakhir."; return; }
    if (akhir < mulai) { msg.textContent = "Tanggal berakhir tidak boleh sebelum tanggal mulai."; return; }
    var file = $("#i-foto").files[0], type = null;
    if (file) {
      type = fileType(file);
      if (!type || type === "application/pdf") { msg.textContent = "Foto harus berformat JPG, PNG, atau WebP. Foto HEIC dari iPhone perlu diubah ke JPG."; return; }
    }
    var row = {
      nama_usaha: nama, deskripsi: $("#i-deskripsi").value.replace(/\r\n/g, "\n").trim(), whatsapp: wa, posisi: $("#i-posisi").value,
      mulai: mulai, berakhir: akhir, tarif: isNaN(tarif) ? 0 : tarif,
      pemilik: $("#i-pemilik").value.trim() || null, no_rumah: $("#i-rumah").value.trim() || null,
      aktif: $("#i-aktif").checked, dibayar: $("#i-dibayar").checked
    };
    state.iSaving = true;
    var btn = $("#i-submit");
    btn.disabled = true; btn.textContent = "Menyimpan..."; msg.textContent = "";
    var up = null, old = null;
    try {
      var ed = state.iEdit;
      if (file) {
        var prep = await prepareFile(file, type);
        up = IKLAN_DIR + newId() + "." + TYPE_EXT[prep.type];
        var u = await sb.storage.from(BUCKET).upload(up, prep.blob, { contentType: prep.type, upsert: false });
        if (u.error) throw u.error;
        row.foto_path = up; row.foto_tipe = prep.type;
        old = ed && ed.foto_path ? ed.foto_path : null;
      } else if (ed && ed.foto_path && $("#i-hapusfoto").checked) {
        row.foto_path = null; row.foto_tipe = null; old = ed.foto_path;
      }
      var r = ed ? await sb.from("iklan").update(row).eq("id", ed.id).select() : await sb.from("iklan").insert(row).select();
      if (r.error) throw r.error;
      if (!r.data || !r.data.length) throw { code: "42501" };
      if (old) sb.storage.from(BUCKET).remove([old]);
      var wasEdit = !!ed;
      resetIForm();
      $("#iPanel").hidden = true;
      flashTemp(wasEdit ? "Perubahan tersimpan." : "Iklan ditambahkan.", "ok");
      await loadIklanAdmin(); loadIklan();
    } catch (e) {
      if (up) sb.storage.from(BUCKET).remove([up]);
      var c = e && e.code ? String(e.code) : "";
      msg.textContent = (c === "42P01" || c === "PGRST205") ? "Fitur iklan belum siap. Jalankan supabase-tahap7.sql di SQL Editor Supabase." : errText(e, "Gagal menyimpan. Periksa koneksi lalu coba lagi.");
    } finally {
      state.iSaving = false;
      btn.disabled = false;
      btn.textContent = state.iEdit ? "Simpan perubahan" : "Simpan iklan";
    }
  }

  // ======================================================================
  // PEMASANGAN EVENT
  // ======================================================================
  $("#period").addEventListener("change", function (e) { state.period = e.target.value; state.periodChosen = true; state.confirmDel = null; renderAll(); });
  $("#form").addEventListener("submit", onSubmit);
  $("#f-cancel").addEventListener("click", function () { resetForm(false); $("#f-msg").textContent = ""; renderAll(); });
  Array.prototype.forEach.call(document.querySelectorAll('input[name="jenis"]'), function (r) { r.addEventListener("change", syncJenisLabels); });
  ["#f-nominal", "#c-saldo"].forEach(function (s) { $(s).addEventListener("input", function (e) { e.target.value = fmtInput(e.target.value); }); });
  $("#c-save").addEventListener("click", saveConfig);
  $("#btn-pdf").addEventListener("click", exportPdf);
  $("#btn-csv").addEventListener("click", exportCsv);
  $("#proof-x").addEventListener("click", closeProof);
  $("#proof").addEventListener("click", function (e) { if (e.target === e.currentTarget) closeProof(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("#proof").hidden) closeProof(); });
  $("#btn-login").addEventListener("click", function () { $("#loginPanel").hidden = false; $("#l-email").focus(); });
  $("#l-cancel").addEventListener("click", function () { $("#loginPanel").hidden = true; });
  $("#loginForm").addEventListener("submit", onLogin);
  $("#btn-logout").addEventListener("click", onLogout);
  window.addEventListener("hashchange", renderAll);

  // berita
  $("#btn-badd").addEventListener("click", function () { openBForm(null); });
  $("#bform").addEventListener("submit", onBeritaSubmit);
  $("#b-cancel").addEventListener("click", closeBForm);
  $("#b-more").addEventListener("click", function () { state.bLimit += 8; renderBerita(); });
  $("#b-isi").addEventListener("input", function (e) { $("#b-count").textContent = e.target.value.length + " / 5000"; });
  $("#b-foto").addEventListener("change", function (e) {
    var f = e.target.files[0];
    if (f && /^image\//.test(f.type)) { var u = URL.createObjectURL(f); setPreview(null); previewUrl = u; $("#b-preview").src = u; $("#b-preview-wrap").hidden = false; }
    else setPreview(state.bEdit && state.bEdit.foto_path ? proofUrl(state.bEdit.foto_path) : null);
  });

  $("#k-foto").addEventListener("change", function (e) {
    var f = e.target.files[0];
    if (f && /^image\//.test(f.type)) { var u = URL.createObjectURL(f); setKPreview(null); kPreviewUrl = u; $("#k-preview").src = u; $("#k-preview-wrap").hidden = false; }
    else setKPreview(state.kEdit && state.kEdit.foto_path ? proofUrl(state.kEdit.foto_path) : null);
  });

  // warga
  $("#btn-wadd").addEventListener("click", function () { openWForm(null); });
  $("#wform").addEventListener("submit", onWargaSubmit);
  $("#w-cancel").addEventListener("click", closeWForm);
  ["#w-kk", "#w-ktp"].forEach(function (s) { $(s).addEventListener("input", function (e) { e.target.value = digits(e.target.value).slice(0, 16); }); });
  var FILTER_IDS = { q: "#wf-q", min: "#wf-min", max: "#wf-max", gang: "#wf-gang", mukim: "#wf-mukim", rumah: "#wf-rumah", ktp: "#wf-ktp", ronda: "#wf-ronda", sort: "#wf-sort" };
  $("#w-lahir").addEventListener("input", syncWajibDefault);
  [].forEach.call(document.querySelectorAll('input[name="w-mukim"], input[name="w-jk"]'), function (r) { r.addEventListener("change", syncWajibDefault); });
  $("#w-kepala").addEventListener("change", syncWajibDefault);
  $("#w-ronda").addEventListener("change", function () { state.wRondaTouched = true; });
  Object.keys(FILTER_IDS).forEach(function (k) {
    $(FILTER_IDS[k]).addEventListener("input", function (e) {
      state.wf[k] = e.target.value;
      state.wLimit = 100;
      if (k === "min" || k === "max") { state.wf.umur = ""; renderAgeChips(); }
      renderWargaList();
    });
  });
  $("#wf-reset").addEventListener("click", function () {
    Object.keys(FILTER_IDS).forEach(function (k) { state.wf[k] = k === "sort" ? "nama" : ""; $(FILTER_IDS[k]).value = state.wf[k]; });
    state.wf.umur = "";
    state.wLimit = 100;
    renderAgeChips(); renderWargaList();
  });
  $("#w-more").addEventListener("click", function () { state.wLimit += 100; renderWargaList(); });
  $("#btn-wpdf").addEventListener("click", exportWargaPdf);
  $("#btn-wcsv").addEventListener("click", exportWargaCsv);

  // pengumuman, info penting, laporan
  $("#btn-aadd").addEventListener("click", function () { openAForm(null); });
  $("#aform").addEventListener("submit", onPengSubmit);
  $("#a-cancel").addEventListener("click", closeAForm);
  $("#a-isi").addEventListener("input", function (e) { $("#a-count").textContent = e.target.value.length + " / 2000"; });
  $("#btn-kadd").addEventListener("click", function () { openKForm(null); });
  $("#kform").addEventListener("submit", onKontakSubmit);
  $("#k-cancel").addEventListener("click", closeKForm);
  $("#btn-ladd").addEventListener("click", openLForm);
  $("#lform").addEventListener("submit", onLaporSubmit);
  $("#l-cancel").addEventListener("click", closeLForm);
  $("#l-more").addEventListener("click", function () { state.lLimit += 15; renderLaporan(); });
  $("#l-isi").addEventListener("input", function (e) { $("#l-count").textContent = e.target.value.length + " / 2000"; });
  $("#l-foto").addEventListener("change", function (e) {
    var f = e.target.files[0];
    if (f && /^image\//.test(f.type)) { var u = URL.createObjectURL(f); setLPreview(null); lPreviewUrl = u; $("#l-preview").src = u; $("#l-preview-wrap").hidden = false; }
    else setLPreview(null);
  });

  // pengurus
  $("#btn-gadd").addEventListener("click", function () { openGForm(null); });
  $("#gform").addEventListener("submit", onPengurusSubmit);
  $("#g-cancel").addEventListener("click", closeGForm);
  $("#g-peran").addEventListener("change", syncGangField);

  // iklan
  $("#btn-iadd").addEventListener("click", function () { openIForm(null); });
  $("#iform").addEventListener("submit", onIklanSubmit);
  $("#i-cancel").addEventListener("click", closeIForm);
  $("#i-mulai").addEventListener("change", function () { if (!state.iEndTouched) $("#i-berakhir").value = periodEnd($("#i-mulai").value); });
  $("#i-berakhir").addEventListener("change", function () { state.iEndTouched = true; });
  $("#i-foto").addEventListener("change", function (e) {
    var f = e.target.files[0];
    if (f && /^image\//.test(f.type)) setIPreview(URL.createObjectURL(f));
    else setIPreview(state.iEdit && state.iEdit.foto_path ? proofUrl(state.iEdit.foto_path) : null);
  });

  // ronda
  $("#p-prev").addEventListener("click", function () { pShift(-1); });
  $("#p-next").addEventListener("click", function () { pShift(1); });
  $("#p-auto").addEventListener("click", function () { pAction("auto"); });
  $("#p-fill").addEventListener("click", function () { pAction("fill"); });
  $("#p-copy").addEventListener("click", function () { pAction("copy"); });
  $("#p-reset").addEventListener("click", function () { state.pDraft = pCopy(state.pSaved); state.pSel = {}; state.pAsk = null; state.pMsg = ""; renderAtur(); });
  $("#p-save").addEventListener("click", pSave);
  $("#p-q").addEventListener("input", function () { state.pQ = $("#p-q").value; renderAtur(); });

  // ---------- mulai ----------
  resetForm(false);
  resetGForm();
  resetBForm();
  resetWForm(false);
  resetAForm();
  resetKForm();
  resetLForm();
  resetIForm();
  renderAll();

  if (!sb) {
    flash(configured
      ? "Pustaka Supabase gagal dimuat. Periksa koneksi internet lalu muat ulang halaman."
      : "Portal belum dikonfigurasi. Isi file config.js dengan Project URL dan kunci dari Supabase (lihat README.md).", "err");
    applyAuthUi();
    return;
  }
  sb.auth.onAuthStateChange(function (event, session) {
    // Jangan memanggil Supabase langsung di dalam callback ini.
    setTimeout(function () { refreshAuth(session); }, 0);
  });
  loadAll();
  loadBerita();
  loadTahap3();
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && !state.saving && !state.editing && !state.bSaving && !state.bEdit) { loadAll(); loadBerita(); }
    if (document.visibilityState === "visible" && tahap3Idle()) loadTahap3();
  });
})();
