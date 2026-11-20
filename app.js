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
    berita: [], bLoaded: false, bError: null, bLimit: 8, bOpen: {}, bEdit: null, bConfirmDel: null, bSaving: false
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
    $("#exports").hidden = !(state.loaded && !state.loadError);
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
    { id: "keuangan", label: "Keuangan" }
  ];
  function activeTab() {
    var t = (location.hash || "").slice(1);
    return TABS.some(function (x) { return x.id === t; }) ? t : "beranda";
  }
  function renderTabs(cur) {
    var nav = $("#tabs");
    nav.textContent = "";
    TABS.forEach(function (t) {
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
    if (cur === "keuangan") renderFinance(); else renderBerita();
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

  // ---------- mulai ----------
  resetForm(false);
  resetBForm();
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
