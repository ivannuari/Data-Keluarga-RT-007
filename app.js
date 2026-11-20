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
    wf: { q: "", umur: "", min: "", max: "", gang: "", mukim: "", rumah: "", ktp: "", sort: "nama" }
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
    badge.textContent = state.admin ? "Pengurus: " + state.email : state.email + " (bukan pengurus)";
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
    state.admin = false;
    if (state.signedIn) {
      var r = await sb.rpc("is_admin");
      state.admin = r.data === true;
    }
    // Data warga hanya dimuat untuk pengurus. Pengunjung biasa tidak pernah meminta tabel ini.
    if (state.admin) { if (!state.wLoaded) loadWarga(); } else { clearWarga(); }
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
    { id: "keuangan", label: "Keuangan" },
    { id: "warga", label: "Data Warga", admin: true }
  ];
  function tabsFor() { return TABS.filter(function (t) { return !t.admin || state.admin; }); }
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
    TABS.forEach(function (t) { $("#tab-" + t.id).hidden = t.id !== cur; });
    if (cur === "keuangan") renderFinance();
    else if (cur === "warga") renderWarga();
    else renderBerita();
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

  function postEl(b) {
    var isi = b.isi || "";
    var isLong = isi.length > LONG_CHARS || isi.split("\n").length > 8;
    var open = !!state.bOpen[b.id];
    var editing = state.bEdit && state.bEdit.id === b.id;
    var body = h("div", { class: "postbody" },
      h("p", { class: "postdate" }, longDate(b.tanggal)),
      h("h3", {}, b.judul),
      isi ? h("p", { class: "posttext" + (isLong && !open ? " clamp" : "") }, isi) : null);
    if (isLong) {
      body.append(h("button", {
        type: "button", class: "linkbtn more", "aria-expanded": String(open),
        onclick: function () { state.bOpen[b.id] = !open; renderBerita(); }
      }, open ? "Tutup" : "Baca selengkapnya"));
    }
    if (state.admin) {
      var act = h("div", { class: "rowact left" });
      if (state.bConfirmDel === b.id) {
        act.append(
          h("button", { type: "button", class: "btn danger small", onclick: function () { deleteBerita(b); } }, "Ya, hapus berita"),
          h("button", { type: "button", class: "btn ghost small", onclick: function () { state.bConfirmDel = null; renderBerita(); } }, "Batal"));
      } else {
        act.append(
          h("button", { type: "button", class: "btn ghost small", onclick: function () { openBForm(b); } }, "Ubah"),
          h("button", { type: "button", class: "btn danger ghost small", onclick: function () { state.bConfirmDel = b.id; renderBerita(); } }, "Hapus"));
      }
      body.append(act);
    }
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
    $("#btn-badd").hidden = !state.admin;
    if (!state.admin && !$("#bPanel").hidden) { resetBForm(); $("#bPanel").hidden = true; }
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
      wrap.append(h("p", { class: "empty card" }, state.admin
        ? "Belum ada berita. Klik Tulis berita untuk menerbitkan yang pertama."
        : "Belum ada berita."));
      return;
    }
    var ol = h("ol", { class: "timeline" });
    var last = "";
    all.slice(0, state.bLimit).forEach(function (b) {
      var m = b.tanggal.slice(0, 7);
      if (m !== last) { ol.append(h("li", { class: "monthmark" }, monthLabel(m))); last = m; }
      ol.append(postEl(b));
    });
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
    if (state.bSaving || !sb || !state.admin) return;
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
    if (!sb || !state.admin) return;
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
      h("td", {}, h("strong", {}, w.nama), ids ? h("div", { class: "sub2" }, ids) : null),
      h("td", { class: "date" }, a == null ? "-" : a + " th",
        h("div", { class: "sub2" }, (info ? info.label + " · " : "") + (w.tanggal_lahir ? dateLabel(w.tanggal_lahir) : ""))),
      h("td", {}, w.gang || h("span", { class: "muted" }, "-"), w.no_rumah ? h("div", { class: "sub2" }, "No. " + w.no_rumah) : null),
      h("td", {}, h("div", { class: "chips" },
        h("span", { class: "chip" + (w.status_mukim === "mukim" ? "" : " alt") }, w.status_mukim === "mukim" ? "Mukim" : "Tidak mukim"),
        h("span", { class: "chip" + (w.status_rumah === "milik" ? "" : " alt") }, w.status_rumah === "milik" ? "Milik sendiri" : "Sewa"),
        h("span", { class: "chip" + (w.domisili_ktp === "sarimukti" ? "" : " alt") }, w.domisili_ktp === "sarimukti" ? "KTP Sarimukti" : "KTP luar"))),
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
        h("button", { type: "button", class: "btn danger ghost small", onclick: function () { state.wConfirmDel = w.id; renderWargaList(); } }, "Hapus"));
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
    $("#wform-title").textContent = "Tambah warga";
    $("#w-submit").textContent = "Simpan warga";
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
    }
    $("#wPanel").hidden = false;
    renderWargaList();
    $("#wPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    $("#w-nama").focus();
  }
  function closeWForm() { resetWForm(false); $("#wPanel").hidden = true; $("#w-msg").textContent = ""; renderWargaList(); }
  async function onWargaSubmit(ev) {
    ev.preventDefault();
    if (state.wSaving || !sb || !state.admin) return;
    var msg = $("#w-msg");
    var nama = $("#w-nama").value.trim().replace(/\s+/g, " ");
    var kk = digits($("#w-kk").value), ktp = digits($("#w-ktp").value);
    var lahir = $("#w-lahir").value;
    var telp = normPhone($("#w-telp").value);
    var gang = canonGang($("#w-gang").value);
    var rumah = $("#w-rumah").value.trim();
    if (!nama) { msg.textContent = "Isi nama lengkap."; return; }
    if (kk && kk.length !== 16) { msg.textContent = "Nomor KK harus 16 digit. Terisi " + kk.length + " digit."; return; }
    if (ktp && ktp.length !== 16) { msg.textContent = "Nomor KTP harus 16 digit. Terisi " + ktp.length + " digit."; return; }
    if (!lahir) { msg.textContent = "Isi tanggal lahir."; return; }
    if (lahir > todayISO()) { msg.textContent = "Tanggal lahir tidak boleh di masa depan."; return; }
    if (telp && !/^\+?[0-9]{8,15}$/.test(telp)) { msg.textContent = "Nomor telepon tidak valid. Gunakan 8 sampai 15 digit."; return; }
    if (!gang) { msg.textContent = "Isi nama gang."; return; }
    if (!rumah) { msg.textContent = "Isi nomor rumah."; return; }
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
    state.wSaving = true;
    var btn = $("#w-submit");
    btn.disabled = true; btn.textContent = "Menyimpan...";
    msg.textContent = "";
    try {
      var r = ed ? await sb.from("warga").update(row).eq("id", ed.id).select()
                 : await sb.from("warga").insert(row).select();
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
    var list = filtered(), nik = $("#wf-nik").checked;
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
    var list = filtered(), nik = $("#wf-nik").checked;
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

  // warga
  $("#btn-wadd").addEventListener("click", function () { openWForm(null); });
  $("#wform").addEventListener("submit", onWargaSubmit);
  $("#w-cancel").addEventListener("click", closeWForm);
  ["#w-kk", "#w-ktp"].forEach(function (s) { $(s).addEventListener("input", function (e) { e.target.value = digits(e.target.value).slice(0, 16); }); });
  var FILTER_IDS = { q: "#wf-q", min: "#wf-min", max: "#wf-max", gang: "#wf-gang", mukim: "#wf-mukim", rumah: "#wf-rumah", ktp: "#wf-ktp", sort: "#wf-sort" };
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

  // ---------- mulai ----------
  resetForm(false);
  resetBForm();
  resetWForm(false);
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
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && !state.saving && !state.editing && !state.bSaving && !state.bEdit) { loadAll(); loadBerita(); }
  });
})();
