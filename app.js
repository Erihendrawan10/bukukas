const BULAN = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const EXEMPT_THRESHOLD = 500000000;
const PPH_RATE = 0.005;

let state = { businessName: "Buku Kas Bulanan Kurasin Toren", entries: [], assets: [] };
let editingId = null;
let pendingNewFiles = []; // File[] belum diunggah
let existingBukti = [];   // bukti milik entry yang sedang diedit (sudah ada di Drive)

function fmtRp(n){ n = Math.round(n||0); return "Rp " + n.toLocaleString("id-ID"); }
function toNum(str){ const d=(str||"").toString().replace(/[^0-9]/g,""); return d?parseInt(d,10):0; }
function showToast(msg){
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.add("show");
  setTimeout(()=>t.classList.remove("show"),2200);
}

// Semua panggilan lewat POST + text/plain agar tidak memicu CORS preflight,
// karena Google Apps Script Web App tidak menangani permintaan OPTIONS.
async function callApi(action, payload){
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, payload: payload || {} })
  });
  const data = await res.json();
  if(data && data.error) throw new Error(data.error);
  return data;
}

function fileToBase64(file){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = ()=> resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function loadState(){
  if(!API_URL || API_URL.indexOf("PASTE_URL") === 0){
    document.getElementById("configWarning").style.display = "block";
    return;
  }
  try{
    state = await callApi("getState");
  }catch(e){
    showToast("Tidak bisa terhubung ke backend: " + e.message);
    return;
  }
  document.getElementById("bizName").value = state.businessName;
  buildYearOptions();
  buildMonthOptions();
  render();
  renderAssets();
  updateDataStatus();
}

function updateDataStatus(){
  const years = Array.from(new Set(state.entries.map(e=>e.tahun))).sort((a,b)=>a-b);
  document.getElementById("dataStatus").textContent = years.length ? "Tersimpan di Google Sheet: " + years.join(", ") : "Belum ada catatan tersimpan.";
  if(typeof SPREADSHEET_URL !== "undefined" && SPREADSHEET_URL){
    const btn = document.getElementById("openSheetBtn");
    btn.href = SPREADSHEET_URL;
    btn.style.display = "inline-block";
  }
}

function currentYear(){
  const sel = document.getElementById("yearSelect");
  return sel && sel.value ? parseInt(sel.value,10) : new Date().getFullYear();
}

function buildYearOptions(){
  const sel = document.getElementById("yearSelect");
  const prevVal = sel.value;
  const now = new Date().getFullYear();
  const years = new Set([now]);
  state.entries.forEach(e=>years.add(e.tahun));
  const sorted = Array.from(years).sort((a,b)=>b-a);
  sel.innerHTML = "";
  sorted.forEach(y=>{
    const opt = document.createElement("option");
    opt.value = y; opt.textContent = y;
    sel.appendChild(opt);
  });
  sel.value = prevVal && years.has(parseInt(prevVal,10)) ? prevVal : now;
  sel.onchange = ()=>{ buildMonthOptions(); render(); };
}

function buildMonthOptions(){
  const sel = document.getElementById("fBulan");
  const prev = sel.value;
  sel.innerHTML = "";
  const year = currentYear();
  BULAN.forEach((nm,i)=>{
    const exists = state.entries.some(e=>e.tahun===year && e.bulan===i+1);
    const opt = document.createElement("option");
    opt.value = i+1;
    opt.textContent = nm + (exists ? " — sudah tercatat" : "");
    sel.appendChild(opt);
  });
  if(prev) sel.value = prev;
}

function entriesForYear(year){
  return state.entries.filter(e=>e.tahun===year).sort((a,b)=>a.bulan-b.bulan);
}

function computePph(yearEntries){
  let cum = 0;
  return yearEntries.map(e=>{
    const before = cum;
    cum += e.omzet;
    const exemptLeft = Math.max(0, EXEMPT_THRESHOLD - before);
    const taxable = Math.max(0, e.omzet - exemptLeft);
    return { ...e, pph: taxable * PPH_RATE };
  });
}

function render(){
  const year = currentYear();
  document.getElementById("tableYearLabel").textContent = year;
  const yearEntries = computePph(entriesForYear(year));

  const tbody = document.getElementById("tbody");
  tbody.innerHTML = "";
  if(yearEntries.length===0){
    tbody.innerHTML = '<tr class="empty-row"><td colspan="7">Belum ada catatan untuk '+year+'. Isi formulir di atas untuk bulan pertama.</td></tr>';
  }
  let tOmzet=0,tBiaya=0,tLaba=0,tPph=0;
  yearEntries.forEach(e=>{
    const biaya = e.transport+e.komisi+e.lain;
    const laba = e.omzet - biaya;
    tOmzet+=e.omzet; tBiaya+=biaya; tLaba+=laba; tPph+=e.pph;
    const bukti = e.bukti||[];
    const tr = document.createElement("tr");
    tr.innerHTML = `<td style="text-align:left;font-family:'Inter',sans-serif;">${BULAN[e.bulan-1]}</td>
      <td>${fmtRp(e.omzet)}</td>
      <td>${fmtRp(biaya)}</td>
      <td>${fmtRp(laba)}</td>
      <td>${fmtRp(e.pph)}</td>
      <td style="text-align:center;font-family:'Inter',sans-serif;">${bukti.length ? '<button class="bukti-badge" data-toggle="'+e.id+'">'+bukti.length+' file</button>' : '<span style="color:var(--muted);">—</span>'}</td>
      <td class="row-actions">
        <button class="btn-ghost" data-edit="${e.id}">Edit</button>
        <button class="btn-ghost" data-del="${e.id}">Hapus</button>
      </td>`;
    tbody.appendChild(tr);

    if(bukti.length){
      const detailTr = document.createElement("tr");
      detailTr.className = "bukti-row hidden";
      detailTr.id = "bukti-detail-"+e.id;
      const links = bukti.map(b=>'<span class="bukti-chip"><a href="'+b.url+'" target="_blank">'+b.name+'</a></span>').join("");
      detailTr.innerHTML = '<td colspan="7">'+links+'</td>';
      tbody.appendChild(detailTr);
    }
  });
  document.getElementById("fOmzetTot").textContent = fmtRp(tOmzet);
  document.getElementById("fBiayaTot").textContent = fmtRp(tBiaya);
  document.getElementById("fLabaTot").textContent = fmtRp(tLaba);
  document.getElementById("fPphTot").textContent = fmtRp(tPph);
  document.getElementById("sumOmzet").textContent = fmtRp(tOmzet);
  document.getElementById("sumBiaya").textContent = fmtRp(tBiaya);
  document.getElementById("sumLaba").textContent = fmtRp(tLaba);
  document.getElementById("sumPph").textContent = fmtRp(tPph);

  const count = yearEntries.length;
  document.getElementById("tankCount").textContent = count + " / 12";
  const waterEl = document.getElementById("tankWater");
  const maxH = 108, maxY = 128;
  const h = Math.round((count/12)*maxH);
  waterEl.setAttribute("height", h);
  waterEl.setAttribute("y", maxY - h);

  tbody.querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>startEdit(b.getAttribute("data-edit")));
  tbody.querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>deleteEntry(b.getAttribute("data-del")));
  tbody.querySelectorAll("[data-toggle]").forEach(b=>b.onclick=()=>{
    const row = document.getElementById("bukti-detail-"+b.getAttribute("data-toggle"));
    if(row) row.classList.toggle("hidden");
  });

  buildMonthOptions();
}

function renderBuktiChips(){
  const box = document.getElementById("buktiList");
  box.innerHTML = "";
  existingBukti.forEach(b=>{
    const chip = document.createElement("span");
    chip.className = "bukti-chip";
    chip.innerHTML = '<a href="'+b.url+'" target="_blank">'+b.name+'</a>';
    const rm = document.createElement("button");
    rm.textContent = "×";
    rm.onclick = async ()=>{
      try{
        const res = await callApi("deleteBukti", { entryId: editingId, buktiId: b.id });
        existingBukti = res.bukti || [];
        renderBuktiChips();
        await loadState();
        showToast("Bukti dihapus.");
      }catch(err){ showToast(err.message); }
    };
    chip.appendChild(rm);
    box.appendChild(chip);
  });
  pendingNewFiles.forEach((f,idx)=>{
    const chip = document.createElement("span");
    chip.className = "bukti-chip";
    chip.textContent = f.name + " (belum diunggah) ";
    const rm = document.createElement("button");
    rm.textContent = "×";
    rm.onclick = ()=>{ pendingNewFiles.splice(idx,1); renderBuktiChips(); };
    chip.appendChild(rm);
    box.appendChild(chip);
  });
}

document.getElementById("fBukti").addEventListener("change", (ev)=>{
  pendingNewFiles = pendingNewFiles.concat(Array.from(ev.target.files||[]));
  renderBuktiChips();
  ev.target.value = "";
});

function startEdit(id){
  const e = state.entries.find(x=>x.id===id);
  if(!e) return;
  editingId = id;
  document.getElementById("yearSelect").value = e.tahun;
  document.getElementById("fBulan").value = e.bulan;
  document.getElementById("fOmzet").value = e.omzet;
  document.getElementById("fTransport").value = e.transport;
  document.getElementById("fKomisi").value = e.komisi;
  document.getElementById("fLain").value = e.lain;
  document.getElementById("fCatatan").value = e.catatan||"";
  existingBukti = (e.bukti||[]).map(b=>({...b}));
  pendingNewFiles = [];
  renderBuktiChips();
  document.getElementById("formTitle").textContent = "Edit " + BULAN[e.bulan-1] + " " + e.tahun;
  document.getElementById("formHint").textContent = "Kamu sedang mengedit catatan yang sudah tersimpan.";
  document.getElementById("cancelEdit").style.display = "inline-block";
  document.getElementById("saveBtn").textContent = "Simpan perubahan";
  window.scrollTo({top:0,behavior:"smooth"});
}

function resetForm(){
  editingId = null;
  ["fOmzet","fTransport","fKomisi","fLain","fCatatan"].forEach(id=>document.getElementById(id).value="");
  existingBukti = [];
  pendingNewFiles = [];
  renderBuktiChips();
  document.getElementById("formTitle").textContent = "Catat bulan ini";
  document.getElementById("formHint").textContent = "Pilih bulan yang sudah tercatat untuk mengeditnya.";
  document.getElementById("cancelEdit").style.display = "none";
  document.getElementById("saveBtn").textContent = "Simpan bulan ini";
}

async function deleteEntry(id){
  try{
    await callApi("deleteEntry", { id });
    await loadState();
    showToast("Catatan dihapus.");
  }catch(err){ showToast(err.message); }
}

async function saveEntry(){
  const year = currentYear();
  const bulan = parseInt(document.getElementById("fBulan").value,10);
  const payload = {
    id: editingId || undefined,
    tahun: year, bulan,
    omzet: toNum(document.getElementById("fOmzet").value),
    transport: toNum(document.getElementById("fTransport").value),
    komisi: toNum(document.getElementById("fKomisi").value),
    lain: toNum(document.getElementById("fLain").value),
    catatan: document.getElementById("fCatatan").value.trim()
  };
  try{
    const entry = await callApi("upsertEntry", payload);
    if(pendingNewFiles.length){
      const files = await Promise.all(pendingNewFiles.map(async f=>({
        name: f.name, mimeType: f.type || "application/octet-stream", dataBase64: await fileToBase64(f)
      })));
      await callApi("uploadBukti", { entryId: entry.id, files });
    }
    await loadState();
    document.getElementById("yearSelect").value = year;
    resetForm();
    render();
    showToast("Tersimpan untuk " + BULAN[bulan-1] + " " + year + ".");
  }catch(err){ showToast(err.message); }
}

function renderAssets(){
  const tbody = document.getElementById("assetBody");
  tbody.innerHTML = "";
  if(!state.assets.length){
    tbody.innerHTML = '<tr class="empty-row"><td colspan="5">Belum ada aset tercatat.</td></tr>';
  }
  let total = 0;
  state.assets.forEach(a=>{
    total += a.nilai;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td style="text-align:left;font-family:'Inter',sans-serif;">${a.nama}</td>
      <td>${a.tahun}</td>
      <td>${fmtRp(a.nilai)}</td>
      <td style="text-align:left;font-family:'Inter',sans-serif;">${a.keterangan||"—"}</td>
      <td class="row-actions"><button class="btn-ghost" data-adel="${a.id}">Hapus</button></td>`;
    tbody.appendChild(tr);
  });
  document.getElementById("assetTotal").textContent = fmtRp(total);
  tbody.querySelectorAll("[data-adel]").forEach(b=>b.onclick=async ()=>{
    try{
      await callApi("deleteAsset", { id: b.getAttribute("data-adel") });
      await loadState();
      showToast("Aset dihapus.");
    }catch(err){ showToast(err.message); }
  });
}

async function addAsset(){
  const nama = document.getElementById("aNama").value.trim();
  if(!nama){ showToast("Isi nama aset dulu."); return; }
  const payload = {
    nama,
    tahun: toNum(document.getElementById("aTahun").value),
    nilai: toNum(document.getElementById("aNilai").value),
    keterangan: document.getElementById("aKet").value.trim()
  };
  try{
    await callApi("upsertAsset", payload);
    ["aNama","aTahun","aNilai","aKet"].forEach(id=>document.getElementById(id).value="");
    await loadState();
    showToast("Aset ditambahkan.");
  }catch(err){ showToast(err.message); }
}

async function copySummary(){
  const year = currentYear();
  const yearEntries = computePph(entriesForYear(year));
  let lines = [(state.businessName||"Usaha") + " — Ringkasan " + year + " untuk Coretax", ""];
  let tOmzet=0,tBiaya=0,tLaba=0,tPph=0;
  yearEntries.forEach(e=>{
    const biaya = e.transport+e.komisi+e.lain;
    const laba = e.omzet-biaya;
    tOmzet+=e.omzet; tBiaya+=biaya; tLaba+=laba; tPph+=e.pph;
    lines.push(BULAN[e.bulan-1]+": omset "+fmtRp(e.omzet)+", biaya "+fmtRp(biaya)+", laba "+fmtRp(laba)+", PPh final "+fmtRp(e.pph));
  });
  lines.push("", "Total omset: "+fmtRp(tOmzet), "Total biaya: "+fmtRp(tBiaya), "Total laba bersih: "+fmtRp(tLaba), "Total PPh Final terutang: "+fmtRp(tPph));
  try{
    await navigator.clipboard.writeText(lines.join("\n"));
    showToast("Ringkasan disalin ke clipboard.");
  }catch(e){ showToast("Tidak bisa menyalin otomatis — pilih teks secara manual."); }
}

document.getElementById("saveBtn").addEventListener("click", saveEntry);
document.getElementById("cancelEdit").addEventListener("click", resetForm);
document.getElementById("copyBtn").addEventListener("click", copySummary);
document.getElementById("addAssetBtn").addEventListener("click", addAsset);
document.getElementById("bizName").addEventListener("change", async (e)=>{
  try{
    const res = await callApi("setBusinessName", { name: e.target.value });
    state.businessName = res.businessName;
  }catch(err){ showToast(err.message); }
});

loadState();
