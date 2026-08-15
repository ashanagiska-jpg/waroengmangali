/* Warung Mang Ali — app.js (sinkron dengan index.html + Code.gs) */
let products=[], cart=[], salesHistory=[], kasbonList=[], expenses=[];
let activeCategory='Semua', reportFilter='all', currentPage='dashboard';
let html5QrCode=null, scanCallback=null, scannerTorchOn=false, lastReceiptData=null;

/** GANTI URL INI setelah Deploy Web App baru di Apps Script */
const WEB_APP_URL='https://script.google.com/macros/s/AKfycbxXMQ0zmVzz2uBTR8Nv0kK6Kxto_zM7XmqINYn4-o8FL_64HZVvzyqtSQM8ZLLk1TNFQA/exec';

const PAGE_TITLES={dashboard:'Dashboard',pos:'Kasir (POS)',pertalite:'Pertalite (BBM)',stok:'Stok Barang',kasbon:'Catatan Kasbon',pengeluaran:'Pengeluaran',laporan:'Laporan Keuangan'};
const FUEL_PRODUCT_ID='FUEL-PERTALITE';
const FUEL_BARCODE='PERTALITE';
let fuelMode='rp'; // 'rp' | 'liter'
const PLACEHOLDER_IMG='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect fill="#e8f6ee" width="120" height="120"/><text x="60" y="68" text-anchor="middle" font-size="40">🛒</text></svg>');

window.onload=async function(){
  lucide.createIcons();
  if(window.self!==window.top){const b=document.getElementById('embedBanner');b.classList.remove('hidden');b.style.display='flex';}
  openDoaModal(); startLiveClock();
  initHardwareScanner();
  await loadAllData();
  renderCurrentPage();
  switchTab('dashboard');
};

async function apiGet(action){
  const res=await fetch(WEB_APP_URL+'?action='+encodeURIComponent(action));
  if(!res.ok) throw new Error('HTTP '+res.status);
  return res.json();
}
async function apiPost(action, payload){
  const res=await fetch(WEB_APP_URL,{method:'POST',body:JSON.stringify({action,payload})});
  if(!res.ok) throw new Error('HTTP '+res.status);
  return res.json();
}

async function loadAllData(showOverlay=true){
  const overlay=document.getElementById('loadingOverlay');
  if(showOverlay) overlay.classList.remove('hidden');
  try{
    const data=await apiGet('getData');
    products=(data.products||[]).map(normalizeProduct);
    await ensureFuelProduct(true);
    salesHistory=data.sales||[];
    kasbonList=data.kasbon||[];
    expenses=data.expenses||[];
  }catch(err){
    alert('Gagal memuat data dari Google Sheet.\n\n'+err.message+'\n\nCek WEB_APP_URL & deploy Apps Script.');
  }finally{ if(showOverlay) overlay.classList.add('hidden'); }
}
function normalizeProduct(p){return{...p,image:p.image||p.photo||p.gambar||'',minStock:p.minStock!=null?p.minStock:5};}

function extractDriveFileId(url){
  if(!url) return '';
  const s=String(url);
  let m=s.match(/[?&]id=([a-zA-Z0-9_-]+)/); if(m) return m[1];
  m=s.match(/\/d\/([a-zA-Z0-9_-]+)/); if(m) return m[1];
  m=s.match(/lh3\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/); if(m) return m[1];
  return '';
}
function normalizeImageUrl(url){
  if(!url) return '';
  const u=String(url).trim();
  if(!u||u.startsWith('data:')||u.startsWith('blob:')) return u;
  const fid=extractDriveFileId(u);
  if(fid) return 'https://drive.google.com/thumbnail?id='+fid+'&sz=w1000';
  return u;
}
function productImage(p){
  const raw=(p&&(p.image||p.photo||p.gambar))||'';
  return normalizeImageUrl(raw)||PLACEHOLDER_IMG;
}
function onImgError(img){
  const tried=img.getAttribute('data-tried')||'0';
  const src=img.getAttribute('src')||'';
  const fid=extractDriveFileId(src)||extractDriveFileId(img.getAttribute('data-orig')||'');
  if(tried==='0'&&fid){img.setAttribute('data-tried','1');img.src='https://lh3.googleusercontent.com/d/'+fid+'=w1000';return;}
  if(tried==='1'&&fid){img.setAttribute('data-tried','2');img.src='https://drive.google.com/thumbnail?id='+fid+'&sz=w400';return;}
  img.onerror=null; img.src=PLACEHOLDER_IMG;
}

async function refreshAllData(silent=false){
  const btn=document.getElementById('refreshBtn');
  if(btn&&!silent) btn.classList.add('animate-spin');
  await loadAllData(!silent);
  renderCurrentPage();
  if(btn) btn.classList.remove('animate-spin');
}
function renderCurrentPage(){
  renderDashboard(); renderCategoryFilters(); renderPosProducts();
  renderStockTable(); renderKasbonTable(); renderExpenseTable(); updateFinancialReports();
  if(typeof renderFuelPage==='function' && getFuelProduct()) renderFuelPage();
}

function switchTab(tabId){
  currentPage=tabId;
  document.querySelectorAll('.tab-content').forEach(el=>el.classList.add('hidden'));
  document.querySelectorAll('.nav-item').forEach(btn=>btn.classList.remove('active'));
  document.querySelectorAll('.mobile-nav button').forEach(btn=>btn.classList.remove('active'));
  const tab=document.getElementById('tab-'+tabId); if(tab) tab.classList.remove('hidden');
  const nav=document.getElementById('nav-'+tabId); if(nav) nav.classList.add('active');
  const navm=document.getElementById('navm-'+tabId); if(navm) navm.classList.add('active');
  const titleEl=document.getElementById('pageTitle'); if(titleEl) titleEl.textContent=PAGE_TITLES[tabId]||tabId;
  document.body.classList.toggle('page-pos', tabId==='pos');
  if(tabId!=='pos') closeMobileCart();
  window.scrollTo({top:0,behavior:'instant'});
  if(tabId==='dashboard') renderDashboard();
  else if(tabId==='pos'){ renderCategoryFilters(); renderPosProducts(); renderCart(); }
  else if(tabId==='pertalite'){ ensureFuelProduct().then(function(){ renderFuelPage(); }); }
  else if(tabId==='stok') renderStockTable();
  else if(tabId==='kasbon') renderKasbonTable();
  else if(tabId==='pengeluaran') renderExpenseTable();
  else if(tabId==='laporan') updateFinancialReports();
  lucide.createIcons();
}
function startLiveClock(){
  setInterval(()=>{
    const now=new Date();
    const full=now.toLocaleDateString('id-ID',{weekday:'short',day:'numeric',month:'short'})+' '+now.toLocaleTimeString('id-ID');
    const el=document.getElementById('liveClockFull'); if(el) el.textContent=full;
  },1000);
}
function openDoaModal(){document.getElementById('doaModal').classList.remove('hidden');}
function closeDoaModal(){document.getElementById('doaModal').classList.add('hidden');}
function openInNewTab(){window.open(WEB_APP_URL,'_blank');}

/* ===== SCANNER ===== */
let scannerStarting=false;

async function stopScannerFully(){
  scannerTorchOn=false;
  const inst=html5QrCode;
  html5QrCode=null;
  if(!inst) return;
  try{
    // getState: 1=NOT_STARTED, 2=SCANNING, 3=PAUSED — stop only if scanning
    if(typeof inst.getState==='function'){
      const st=inst.getState();
      if(st===2 || st===3) await inst.stop();
    } else {
      try{ await inst.stop(); }catch(e){}
    }
  }catch(e){}
  try{ inst.clear(); }catch(e){}
  // kosongkan elemen agar instance baru bersih
  const region=document.getElementById('scannerRegion');
  if(region) region.innerHTML='';
}

async function openScanner(callback){
  if(window.self!==window.top){
    if(confirm('Scan tidak bisa di Google Sites. Buka tab baru?')) openInNewTab();
    return;
  }
  if(scannerStarting) return;
  scannerStarting=true;
  scanCallback=callback;
  scannerTorchOn=false;

  // Pastikan scanner lama benar-benar mati dulu (hindari "already under transition")
  await stopScannerFully();

  document.getElementById('scannerModal').classList.remove('hidden');
  const torchBtn=document.getElementById('scannerTorchBtn');
  if(torchBtn) torchBtn.textContent='Senter: Mati';
  lucide.createIcons();

  const config={
    fps:10,
    qrbox:function(vw,vh){
      const w=Math.floor(vw*0.88);
      const h=Math.floor(Math.min(vh*0.35,w*0.45));
      return{width:Math.max(200,w),height:Math.max(80,h)};
    },
    aspectRatio:1.777,
    experimentalFeatures:{useBarCodeDetectorIfSupported:true}
  };

  try{
    html5QrCode=new Html5Qrcode('scannerRegion',{
      formatsToSupport:[
        Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A, Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.CODABAR, Html5QrcodeSupportedFormats.ITF,
        Html5QrcodeSupportedFormats.QR_CODE
      ],
      verbose:false
    });

    // Mulai dengan constraint sederhana dulu (lebih stabil di Android/Brave)
    try{
      await html5QrCode.start(
        { facingMode: 'environment' },
        config,
        function(t){ onScanSuccess(t); },
        function(){}
      );
    }catch(e1){
      // fallback kamera depan / default
      await html5QrCode.start(
        { facingMode: 'user' },
        config,
        function(t){ onScanSuccess(t); },
        function(){}
      );
    }
    tryApplyFocusContinuous();
  }catch(e){
    alert('Tidak bisa akses kamera.\n\nPastikan:\n• Izin kamera di browser diizinkan\n• Buka lewat HTTPS (bukan HTTP)\n• Tutup app lain yang memakai kamera\n\nDetail: '+e);
    closeScanner();
  }finally{
    scannerStarting=false;
  }
}

function tryApplyFocusContinuous(){
  try{
    const video=document.querySelector('#scannerRegion video');
    if(!video||!video.srcObject) return;
    const track=video.srcObject.getVideoTracks()[0];
    if(!track||!track.getCapabilities) return;
    const caps=track.getCapabilities();
    const c={};
    if(caps.focusMode&&caps.focusMode.includes('continuous')) c.focusMode='continuous';
    else if(caps.focusMode&&caps.focusMode.includes('auto')) c.focusMode='auto';
    if(caps.zoom) c.zoom=Math.min((caps.zoom.min||1)+0.5, caps.zoom.max||2);
    if(Object.keys(c).length) track.applyConstraints({advanced:[c]}).catch(function(){});
  }catch(e){}
}

async function toggleScannerTorch(){
  try{
    const video=document.querySelector('#scannerRegion video');
    if(!video||!video.srcObject) return;
    const track=video.srcObject.getVideoTracks()[0];
    const caps=track.getCapabilities?track.getCapabilities():{};
    if(!caps.torch){ alert('Senter tidak didukung.'); return; }
    scannerTorchOn=!scannerTorchOn;
    await track.applyConstraints({advanced:[{torch:scannerTorchOn}]});
    const btn=document.getElementById('scannerTorchBtn');
    if(btn) btn.textContent=scannerTorchOn?'Senter: Nyala':'Senter: Mati';
  }catch(e){ alert(e.message); }
}

function playScanBeep(){
  try{
    const ctx=new (window.AudioContext||window.webkitAudioContext)();
    const osc=ctx.createOscillator();
    const gain=ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type='sine'; osc.frequency.value=1500;
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime+0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+0.18);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime+0.2);
    if(navigator.vibrate) navigator.vibrate(80);
  }catch(e){}
}

/** Suara krecing koin / kasir saat transaksi berhasil */
function playCoinSound(){
  try{
    const ctx=new (window.AudioContext||window.webkitAudioContext)();
    const now=ctx.currentTime;
    // beberapa "ting" koin beruntun
    const notes=[1800, 2400, 3000, 2200];
    notes.forEach(function(freq, i){
      const osc=ctx.createOscillator();
      const gain=ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type='square';
      osc.frequency.value=freq;
      const t0=now + i*0.07;
      gain.gain.setValueAtTime(0.001, t0);
      gain.gain.exponentialRampToValueAtTime(0.22, t0+0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t0+0.12);
      osc.start(t0); osc.stop(t0+0.14);
    });
    // dengung rendah seperti laci kasir
    const osc2=ctx.createOscillator();
    const g2=ctx.createGain();
    osc2.connect(g2); g2.connect(ctx.destination);
    osc2.type='triangle';
    osc2.frequency.setValueAtTime(120, now);
    osc2.frequency.exponentialRampToValueAtTime(60, now+0.35);
    g2.gain.setValueAtTime(0.001, now);
    g2.gain.exponentialRampToValueAtTime(0.15, now+0.02);
    g2.gain.exponentialRampToValueAtTime(0.001, now+0.4);
    osc2.start(now); osc2.stop(now+0.42);
    if(navigator.vibrate) navigator.vibrate([40, 40, 80]);
  }catch(e){}
}

function onScanSuccess(decodedText){
  playScanBeep();
  const cb=scanCallback;
  closeScanner();
  if(cb) cb(decodedText);
}

function closeScanner(){
  document.getElementById('scannerModal').classList.add('hidden');
  // stop di background, jangan blok UI
  stopScannerFully();
}
function handleProductScan(code){
  const el=document.getElementById('prodBarcode');
  if(el){ el.value=String(code||'').trim(); el.focus(); }
}

/** Cari produk by barcode (normalisasi: trim, tanpa spasi) */
function findProductByBarcode(code){
  const raw=String(code||'').trim();
  if(!raw) return null;
  const norm=raw.replace(/\s+/g,'');
  // exact
  let prod=products.find(p=>p.barcode && String(p.barcode).trim()===raw);
  if(prod) return prod;
  prod=products.find(p=>p.barcode && String(p.barcode).replace(/\s+/g,'')===norm);
  if(prod) return prod;
  // kadang scanner kirim leading zero beda
  prod=products.find(p=>{
    if(!p.barcode) return false;
    const b=String(p.barcode).replace(/\s+/g,'');
    return b===norm || b.replace(/^0+/,'')===norm.replace(/^0+/,'');
  });
  return prod||null;
}

function showScanToast(msg, isError){
  let t=document.getElementById('scanToast');
  if(!t){
    t=document.createElement('div');
    t.id='scanToast';
    t.style.cssText='position:fixed;top:72px;left:50%;transform:translateX(-50%);z-index:90;padding:10px 18px;border-radius:12px;font-weight:800;font-size:13px;font-family:var(--font);box-shadow:0 8px 24px rgba(0,0,0,.15);max-width:90vw;text-align:center;transition:opacity .2s';
    document.body.appendChild(t);
  }
  t.textContent=msg;
  t.style.background=isError?'#ffe4e6':'#dcfce7';
  t.style.color=isError?'#e11d48':'#15803d';
  t.style.opacity='1';
  clearTimeout(t._hide);
  t._hide=setTimeout(function(){ t.style.opacity='0'; }, 1800);
}

function handlePosScan(code){
  const raw=String(code||'').trim();
  if(!raw) return;
  const prod=findProductByBarcode(raw);
  if(!prod){
    playScanBeep();
    showScanToast('Barcode tidak ditemukan: '+raw, true);
    // isi search agar user bisa cek
    const s=document.getElementById('posSearch');
    if(s){ s.value=raw; renderPosProducts(); }
    return;
  }
  if(prod.stock<=0){
    showScanToast(prod.name+' — stok habis', true);
    return;
  }
  addToCart(prod.id);
  playScanBeep();
  showScanToast('+ '+prod.name);
  // kosongkan search agar siap scan berikutnya
  const s=document.getElementById('posSearch');
  if(s){ s.value=''; renderPosProducts(); }
}

/**
 * Scanner fisik USB/Bluetooth (keyboard wedge):
 * mengetik karakter sangat cepat lalu Enter.
 * Deteksi buffer cepat → proses sebagai barcode.
 */
let hwScanBuffer='';
let hwScanLastTime=0;
const HW_SCAN_MAX_GAP=80; // ms antar karakter
const HW_SCAN_MIN_LEN=4;

function initHardwareScanner(){
  document.addEventListener('keydown', function(e){
    // Abaikan jika user mengetik di input biasa (kecuali posSearch & prodBarcode)
    const tag=(e.target && e.target.tagName||'').toLowerCase();
    const id=e.target && e.target.id || '';
    const isScanField = id==='posSearch' || id==='prodBarcode' || id==='hwScanInput';
    const isTypingInForm = (tag==='input'||tag==='textarea'||tag==='select') && !isScanField;

    // Saat di halaman POS, izinkan scan global (kecuali form modal)
    const onPos = currentPage==='pos';
    const modalOpen = document.querySelector('.modal-bg:not(.hidden)');

    if(isTypingInForm && !onPos) return;
    if(modalOpen && id!=='prodBarcode') {
      // di modal produk, hanya terima di field barcode
      if(id!=='prodBarcode') return;
    }

    const now=Date.now();

    if(e.key==='Enter'){
      if(hwScanBuffer.length>=HW_SCAN_MIN_LEN){
        e.preventDefault();
        const code=hwScanBuffer;
        hwScanBuffer='';
        hwScanLastTime=0;
        if(id==='prodBarcode' || (modalOpen && document.getElementById('productModal') && !document.getElementById('productModal').classList.contains('hidden'))){
          handleProductScan(code);
        } else {
          // pastikan di mode kasir
          if(currentPage!=='pos') switchTab('pos');
          handlePosScan(code);
        }
        return;
      }
      // Enter di posSearch: coba barcode exact dulu
      if(id==='posSearch'){
        const v=(e.target.value||'').trim();
        if(v && findProductByBarcode(v)){
          e.preventDefault();
          handlePosScan(v);
          return;
        }
      }
      hwScanBuffer='';
      return;
    }

    // karakter printable
    if(e.key.length===1 && !e.ctrlKey && !e.altKey && !e.metaKey){
      if(now-hwScanLastTime > HW_SCAN_MAX_GAP) hwScanBuffer='';
      hwScanBuffer += e.key;
      hwScanLastTime = now;
      // jika buffer sudah panjang & gap cepat, cegah masuk ke search (opsional)
      // biarkan tetap masuk ke focused input — Enter yang memproses
    } else if(e.key==='Tab' || e.key==='Escape'){
      hwScanBuffer='';
    }
  }, true);
}

/** Input khusus fokus scan (tersembunyi di POS) — untuk scanner yang butuh target input */
function focusScanInput(){
  let el=document.getElementById('hwScanInput');
  if(!el) return;
  el.value='';
  el.focus();
}

function todayStr(){return new Date().toLocaleDateString('id-ID');}
function filterSalesToday(){const t=todayStr();return salesHistory.filter(s=>s.time&&s.time.includes(t));}
function filterExpensesToday(){const t=todayStr();return expenses.filter(e=>e.date===t);}
function parseItemsSummary(summary){const map={};if(!summary)return map;String(summary).split(',').forEach(part=>{const m=part.trim().match(/^(.+?)\s*\((\d+)\)\s*$/);if(m){const name=m[1].trim();const qty=parseInt(m[2],10)||0;map[name]=(map[name]||0)+qty;}});return map;}
function computeTopProducts(salesList,limit){const counts={};salesList.forEach(s=>{const map=parseItemsSummary(s.itemsSummary);Object.keys(map).forEach(name=>{counts[name]=(counts[name]||0)+map[name];});});return Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,limit||5);}
function paymentBreakdown(salesList){const map={};salesList.forEach(s=>{const m=s.method||'Lainnya';map[m]=(map[m]||0)+(s.total||0);});return Object.entries(map).sort((a,b)=>b[1]-a[1]);}

function renderDashboard(){
  const todaySales=filterSalesToday();
  const todayOmset=todaySales.reduce((s,x)=>s+(x.total||0),0);
  const todayTx=todaySales.length;
  const todayHpp=todaySales.reduce((s,x)=>s+(x.costTotal||0),0);
  const todayProfit=todayOmset-todayHpp-filterExpensesToday().reduce((s,e)=>s+e.amount,0);
  const unpaidKasbon=kasbonList.filter(k=>k.status==='Belum Lunas');
  const unpaidTotal=unpaidKasbon.reduce((s,k)=>s+k.total,0);
  const lowStock=products.filter(p=>p.stock<=(p.minStock||5));
  const allOmset=salesHistory.reduce((s,x)=>s+(x.total||0),0);
  const allHpp=salesHistory.reduce((s,x)=>s+(x.costTotal||0),0);
  const allExp=expenses.reduce((s,e)=>s+e.amount,0);
  const allProfit=allOmset-allHpp-allExp;
  const avgTicket=todayTx?Math.round(todayOmset/todayTx):0;
  const stockValue=products.reduce((s,p)=>s+(p.cost||0)*(p.stock||0),0);
  const sellValue=products.reduce((s,p)=>s+(p.price||0)*(p.stock||0),0);
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  set('dashOmset','Rp '+todayOmset.toLocaleString('id-ID'));
  set('dashTx',todayTx+' transaksi');
  set('dashProfitToday','Rp '+todayProfit.toLocaleString('id-ID'));
  set('dashAvgTicket','Rp '+avgTicket.toLocaleString('id-ID'));
  set('dashKasbon','Rp '+unpaidTotal.toLocaleString('id-ID'));
  set('dashKasbonCount',unpaidKasbon.length+' pelanggan');
  set('dashLowStock',lowStock.length+' item');
  set('dashProdCount',products.length+' produk terdaftar');
  set('dashAllOmset','Rp '+allOmset.toLocaleString('id-ID'));
  set('dashAllProfit','Rp '+allProfit.toLocaleString('id-ID'));
  set('dashStockValue','Rp '+stockValue.toLocaleString('id-ID'));
  set('dashSellValue','Rp '+sellValue.toLocaleString('id-ID'));
  const topBox=document.getElementById('dashTopProducts');
  if(topBox){const top=computeTopProducts(todaySales.length?todaySales:salesHistory,5);if(!top.length)topBox.innerHTML='<div class="empty">Belum ada data</div>';else{const max=top[0][1]||1;topBox.innerHTML=top.map(([name,qty])=>`<div class="bar-row"><div class="name" title="${name}">${name}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(8,(qty/max)*100)}%"></div></div><div class="val">${qty} pcs</div></div>`).join('');}}
  const payBox=document.getElementById('dashPayments');
  if(payBox){const list=paymentBreakdown(todaySales.length?todaySales:salesHistory);const maxP=list.length?list[0][1]:1;if(!list.length)payBox.innerHTML='<div class="empty">Belum ada data</div>';else payBox.innerHTML=list.map(([m,total])=>`<div class="bar-row"><div class="name">${m}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(8,(total/maxP)*100)}%;background:linear-gradient(90deg,#38bdf8,#0284c7)"></div></div><div class="val">Rp ${(total/1000).toFixed(0)}k</div></div>`).join('');}
  const alertBox=document.getElementById('dashAlerts');
  if(alertBox){if(!lowStock.length)alertBox.innerHTML='<div class="empty">Semua stok aman ✓</div>';else alertBox.innerHTML=lowStock.slice(0,6).map(p=>`<div class="alert-item warn"><img src="${productImage(p)}" alt="" style="width:36px;height:36px;border-radius:8px;object-fit:cover" data-orig="${productImage(p)}" onerror="onImgError(this)"><div style="flex:1;min-width:0"><div class="name">${p.name}</div><div class="meta">${p.category} · Stok: ${p.stock}</div></div><button class="btn btn-sm btn-ghost" onclick="switchTab('stok');openRestockModal('${p.id}')">+Stok</button></div>`).join('');}
  const recent=document.getElementById('dashRecent');
  if(recent){const last=[...salesHistory].slice(-6).reverse();if(!last.length)recent.innerHTML='<div class="empty">Belum ada transaksi</div>';else recent.innerHTML=last.map(s=>`<div class="alert-item"><div style="flex:1;min-width:0"><div class="name font-mono">${s.id}</div><div class="meta">${s.time} · ${s.method}</div></div><div class="font-bold text-accent" style="font-size:13px">Rp ${s.total.toLocaleString('id-ID')}</div></div>`).join('');}
}

/* ===== POS ===== */
function renderCategoryFilters(){const categories=['Semua',...new Set(products.map(p=>p.category))];const c=document.getElementById('categoryFilters');if(!c)return;c.innerHTML=categories.map(cat=>`<button onclick="filterCategory('${cat}')" class="chip ${activeCategory===cat?'active':''}">${cat}</button>`).join('');}
function filterCategory(cat){activeCategory=cat;renderCategoryFilters();renderPosProducts();}
function renderPosProducts(){
  const search=(document.getElementById('posSearch')?.value||'').toLowerCase();
  const grid=document.getElementById('posProductGrid'); if(!grid) return;
  const filtered=products.filter(p=>{if(p.id===FUEL_PRODUCT_ID||p.category==='BBM')return false;const matchesCat=activeCategory==='Semua'||p.category===activeCategory;const matchesSearch=p.name.toLowerCase().includes(search)||p.category.toLowerCase().includes(search)||(p.barcode||'').toLowerCase().includes(search);return matchesCat&&matchesSearch;});
  if(!filtered.length){grid.innerHTML='<div class="empty" style="grid-column:1/-1">Produk tidak ditemukan</div>';return;}
  grid.innerHTML=filtered.map(p=>`<div onclick="addToCart('${p.id}')" class="prod-card">${p.stock<=(p.minStock||5)?'<span class="low-badge">TIPIS</span>':''}<div class="thumb"><img src="${productImage(p)}" alt="" loading="lazy" data-orig="${productImage(p)}" onerror="onImgError(this)"></div><div class="body"><span class="cat">${p.category}</span><div class="name">${p.name}</div><div class="price">Rp ${p.price.toLocaleString('id-ID')}</div><div class="stock ${p.stock===0?'zero':''}">Stok: ${p.stock}</div></div></div>`).join('');
}
function addToCart(productId){const prod=products.find(p=>p.id===productId);if(!prod||prod.stock<=0){alert('Stok habis!');return;}const existing=cart.find(i=>i.id===productId);if(existing){if(existing.qty+1>prod.stock){alert('Melebihi stok!');return;}existing.qty++;}else cart.push({...prod,qty:1});renderCart();}
function updateCartQty(productId,delta){const item=cart.find(i=>i.id===productId);if(!item)return;const prod=products.find(p=>p.id===productId);if(delta>0&&item.qty+delta>prod.stock){alert('Stok tidak cukup!');return;}item.qty+=delta;if(item.qty<=0)cart=cart.filter(i=>i.id!==productId);renderCart();}
function clearCart(){cart=[];renderCart();}
function openMobileCart(){
  const panel=document.getElementById('posCartPanel');
  const bd=document.getElementById('posCartBackdrop');
  if(panel) panel.classList.add('open');
  if(bd) bd.classList.add('open');
  lucide.createIcons();
}
function closeMobileCart(){
  const panel=document.getElementById('posCartPanel');
  const bd=document.getElementById('posCartBackdrop');
  if(panel) panel.classList.remove('open');
  if(bd) bd.classList.remove('open');
}
function updatePosMobileBar(total, count){
  const c=document.getElementById('posBarCount');
  const t=document.getElementById('posBarTotal');
  const badge=document.getElementById('cartBadgeCount');
  if(c) c.textContent=String(count);
  if(t) t.textContent='Rp '+(total||0).toLocaleString('id-ID');
  if(badge) badge.textContent=String(count);
}
function renderCart(){
  const list=document.getElementById('cartItemsList'); if(!list) return;
  const count=cart.reduce((s,i)=>s+i.qty,0);
  if(!cart.length){
    list.innerHTML='<div class="empty">Keranjang kosong</div>';
    const totalEl=document.getElementById('cartTotalText');
    if(totalEl) totalEl.textContent='Rp 0';
    updatePosMobileBar(0,0);
    calculateChange();
    return;
  }
  let total=0;
  list.innerHTML=cart.map(item=>{
    const sub=item.price*item.qty; total+=sub;
    return `<div class="cart-item"><div class="thumb-sm"><img src="${productImage(item)}" alt="" data-orig="${productImage(item)}" onerror="onImgError(this)"></div><div class="info"><div class="name">${item.name}</div><div class="meta">Rp ${item.price.toLocaleString('id-ID')} × ${item.qty}</div><div class="sub">Rp ${sub.toLocaleString('id-ID')}</div></div><div class="qty-ctrl"><button onclick="updateCartQty('${item.id}',-1)">−</button><span>${item.qty}</span><button class="plus" onclick="updateCartQty('${item.id}',1)">+</button></div></div>`;
  }).join('');
  const totalEl=document.getElementById('cartTotalText');
  if(totalEl) totalEl.textContent='Rp '+total.toLocaleString('id-ID');
  updatePosMobileBar(total, count);
  calculateChange();
}
function toggleKasbonInput(){const method=document.getElementById('posPaymentMethod').value;const k=document.getElementById('kasbonFormGroup');const c=document.getElementById('cashFormGroup');if(method==='Kasbon'){k.classList.remove('hidden');c.classList.add('hidden');}else if(method==='QRIS/Transfer'){k.classList.add('hidden');c.classList.add('hidden');}else{k.classList.add('hidden');c.classList.remove('hidden');}}
function calculateChange(){const total=cart.reduce((s,i)=>s+i.price*i.qty,0);const cash=parseFloat(document.getElementById('cashAmountInput').value)||0;const change=cash-total;const el=document.getElementById('changeAmountText');if(change>=0){el.textContent='Rp '+change.toLocaleString('id-ID');el.className='val';}else{el.textContent='Kurang Rp '+Math.abs(change).toLocaleString('id-ID');el.className='val neg';}}
async function processTransaction(){
  if(!cart.length){alert('Keranjang kosong!');return;}
  const total=cart.reduce((s,i)=>s+i.price*i.qty,0);const totalCost=cart.reduce((s,i)=>s+(i.cost||0)*i.qty,0);
  const method=document.getElementById('posPaymentMethod').value;const now=new Date();
  const timeStr=now.toLocaleDateString('id-ID')+' '+now.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
  const transId='TRX-'+Date.now().toString().slice(-6); let kasbonEntry=null;
  if(method==='Tunai'){const cash=parseFloat(document.getElementById('cashAmountInput').value)||0;if(cash<total){alert('Uang kurang!');return;}}
  else if(method==='Kasbon'){const name=document.getElementById('kasbonCustomerName').value.trim();if(!name){alert('Nama pelanggan wajib!');return;}kasbonEntry={id:'KSB-'+Date.now().toString().slice(-5),customer:name,total,time:timeStr,status:'Belum Lunas'};}
  const sale={id:transId,time:timeStr,itemsSummary:cart.map(i=>`${i.name} (${i.qty})`).join(', '),total,costTotal:totalCost,method};
  const payBtn=document.getElementById('processPaymentBtn'); if(payBtn){payBtn.disabled=true;document.getElementById('processPaymentBtnText').textContent='Memproses...';}
  try{
    const result=await apiPost('saveSale',{sale,items:cart.map(i=>({id:i.id,qty:i.qty})),kasbon:kasbonEntry});
    if(result.status!=='success') throw new Error(result.message||'Gagal');
    playCoinSound();
    closeMobileCart();
    showReceipt(transId,timeStr,total,method,cart.slice());
    cart.forEach(i=>{const prod=products.find(p=>p.id===i.id);if(prod)prod.stock-=i.qty;});
    salesHistory.push(sale); if(kasbonEntry) kasbonList.push(kasbonEntry);
    renderPosProducts();renderStockTable();renderKasbonTable();updateFinancialReports();renderDashboard();
    clearCart(); document.getElementById('cashAmountInput').value=''; document.getElementById('kasbonCustomerName').value='';
  }catch(err){alert('Gagal simpan transaksi: '+err.message);}
  finally{if(payBtn){payBtn.disabled=false;document.getElementById('processPaymentBtnText').textContent='Simpan Transaksi';}}
}
function escapeHtml(str){return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function showReceipt(id,time,total,method,items){
  lastReceiptData={id,time,total,method,items:items||[]};
  const itemsHtml=(items||[]).map(i=>`<div style="display:flex;justify-content:space-between;gap:8px"><span>${escapeHtml(i.name)} x${i.qty}</span><span>Rp ${(i.price*i.qty).toLocaleString('id-ID')}</span></div>`).join('');
  document.getElementById('receiptDetails').innerHTML=`<div style="text-align:center;border-bottom:1px solid var(--border);padding-bottom:8px;margin-bottom:8px;font-weight:800">WARUNG MANG ALI</div><div>ID: ${id}</div><div>Waktu: ${time}</div><div>Metode: ${method}</div><div style="margin:8px 0;border-top:1px dashed var(--border);padding-top:8px">${itemsHtml}</div><div style="border-top:1px solid var(--border);padding-top:8px;font-weight:800;display:flex;justify-content:space-between"><span>Total</span><span>Rp ${total.toLocaleString('id-ID')}</span></div>`;
  document.getElementById('receiptModal').classList.remove('hidden'); lucide.createIcons();
}
function closeReceiptModal(){document.getElementById('receiptModal').classList.add('hidden');}
function printReceipt(){
  const d=lastReceiptData; if(!d){alert('Tidak ada struk.');return;}
  const lines=(d.items||[]).map(i=>'<tr><td>'+escapeHtml(String(i.name).substring(0,18)+' x'+i.qty)+'</td><td style="text-align:right">Rp '+(i.price*i.qty).toLocaleString('id-ID')+'</td></tr>').join('');
  const html='<!DOCTYPE html><html><head><meta charset="utf-8"><style>@page{size:58mm auto;margin:2mm}body{font-family:monospace;font-size:11px;width:54mm;padding:2mm}.c{text-align:center}.sep{border-top:1px dashed #000;margin:6px 0}table{width:100%}@media print{.no-print{display:none}}</style></head><body><div class="c" style="font-weight:700">WARUNG MANG ALI</div><div class="sep"></div><div>ID: '+escapeHtml(d.id)+'</div><div>'+escapeHtml(d.time)+'</div><div>Bayar: '+escapeHtml(d.method)+'</div><div class="sep"></div><table>'+lines+'</table><div class="sep"></div><div style="font-weight:700;display:flex;justify-content:space-between"><span>TOTAL</span><span>Rp '+d.total.toLocaleString('id-ID')+'</span></div><div class="sep"></div><div class="c">Terima kasih</div><div class="no-print c" style="margin-top:12px"><button onclick="window.print()">Cetak</button></div><script>setTimeout(function(){window.print()},300)<\\/script></body></html>';
  const w=window.open('','blank','width=320,height=600'); if(!w){alert('Izinkan popup');return;} w.document.write(html); w.document.close();
}

/* ===== STOCK + IMAGE ===== */
function renderStockTable(){
  const search=(document.getElementById('stockSearch')?.value||'').toLowerCase();
  const filtered=products.filter(p=>p.name.toLowerCase().includes(search)||p.category.toLowerCase().includes(search)||(p.barcode||'').includes(search));
  const tbody=document.getElementById('stockTableBody');
  if(tbody) tbody.innerHTML=filtered.map(p=>`<tr><td><img class="stock-thumb" src="${productImage(p)}" alt="" data-orig="${productImage(p)}" onerror="onImgError(this)"></td><td class="font-mono">${p.id}</td><td class="font-bold">${p.name}</td><td><span class="badge badge-muted">${p.category}</span></td><td>Rp ${p.cost.toLocaleString('id-ID')}</td><td class="font-bold text-accent">Rp ${p.price.toLocaleString('id-ID')}</td><td class="font-bold ${p.stock<=(p.minStock||5)?'text-danger':''}">${p.stock}</td><td style="text-align:center"><button onclick="openRestockModal('${p.id}')" class="btn btn-sm btn-ghost">+Stok</button> <button onclick="editProduct('${p.id}')" class="btn btn-sm btn-ghost">Edit</button> <button onclick="deleteProduct('${p.id}')" class="btn btn-sm btn-danger">Hapus</button></td></tr>`).join('');
  const cards=document.getElementById('stockCardsMobile');
  if(cards) cards.innerHTML=filtered.map(p=>`<div class="m-item"><div class="flex items-center gap-2" style="gap:12px"><img src="${productImage(p)}" alt="" style="width:48px;height:48px;border-radius:12px;object-fit:cover" data-orig="${productImage(p)}" onerror="onImgError(this)"><div style="flex:1;min-width:0"><div class="font-bold" style="font-size:14px">${p.name}</div><span class="badge badge-muted">${p.category}</span><div style="margin-top:4px;font-size:12px" class="${p.stock<=(p.minStock||5)?'text-danger':'text-muted'}">Stok: ${p.stock}</div></div></div><div class="flex gap-2" style="margin-top:10px;justify-content:flex-end"><button onclick="openRestockModal('${p.id}')" class="btn btn-sm btn-ghost">+Stok</button><button onclick="editProduct('${p.id}')" class="btn btn-sm btn-ghost">Edit</button><button onclick="deleteProduct('${p.id}')" class="btn btn-sm btn-danger">Hapus</button></div></div>`).join('');
}
function setProductImagePreview(url){
  const wrap=document.getElementById('prodImagePreview'); const clearBtn=document.getElementById('prodImageClearBtn'); if(!wrap) return;
  if(!url){wrap.innerHTML='<div class="ph">Belum ada foto<br><small>Ambil dari kamera atau galeri</small></div>';if(clearBtn)clearBtn.classList.add('hidden');return;}
  const safe=normalizeImageUrl(url).replace(/"/g,'');
  wrap.innerHTML='<img src="'+safe+'" alt="Preview" data-orig="'+safe+'" onerror="onImgError(this)">';
  if(clearBtn) clearBtn.classList.remove('hidden');
}
function clearProductImage(){document.getElementById('prodImage').value='';const f1=document.getElementById('prodImageFile');const f2=document.getElementById('prodImageGallery');if(f1)f1.value='';if(f2)f2.value='';setProductImagePreview('');setImageStatus('');}
function setImageStatus(msg,isError){const el=document.getElementById('prodImageStatus');if(!el)return;el.textContent=msg||'';el.style.color=isError?'var(--rose)':'var(--muted)';}
function compressImageFile(file,maxWidth,quality){
  maxWidth=maxWidth||900; quality=quality||0.72;
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onerror=()=>reject(new Error('Gagal baca file'));
    reader.onload=()=>{const img=new Image();img.onerror=()=>reject(new Error('Bukan gambar valid'));img.onload=()=>{let w=img.width,h=img.height;if(w>maxWidth){h=Math.round(h*(maxWidth/w));w=maxWidth;}const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;canvas.getContext('2d').drawImage(img,0,0,w,h);const dataUrl=canvas.toDataURL('image/jpeg',quality);resolve({dataUrl,base64:dataUrl.split(',')[1],mimeType:'image/jpeg'});};img.src=reader.result;};
    reader.readAsDataURL(file);
  });
}
async function onProductImageSelected(event){
  const file=event.target.files&&event.target.files[0]; if(!file) return;
  if(!file.type||!file.type.startsWith('image/')){alert('Pilih gambar saja.');return;}
  if(file.size>12*1024*1024){alert('Foto terlalu besar (maks ~12MB).');return;}
  setImageStatus('Memproses foto...');
  try{
    const compressed=await compressImageFile(file,900,0.72);
    setProductImagePreview(compressed.dataUrl);
    setImageStatus('Mengunggah ke Google Drive...');
    const result=await apiPost('uploadProductImage',{base64:compressed.base64,mimeType:compressed.mimeType,fileName:'produk_'+Date.now()+'.jpg'});
    if(!result||result.status!=='success'||!result.url) throw new Error((result&&result.message)||'Upload gagal');
    let finalUrl=normalizeImageUrl(result.url);
    if(result.fileId) finalUrl='https://drive.google.com/thumbnail?id='+result.fileId+'&sz=w1000';
    document.getElementById('prodImage').value=finalUrl;
    setProductImagePreview(finalUrl);
    setImageStatus('Foto berhasil diunggah ✓');
  }catch(err){setImageStatus('Gagal: '+err.message,true);alert('Gagal upload foto.\n\n'+err.message+'\n\nPastikan Code.gs sudah di-deploy ulang.');}
  finally{event.target.value='';}
}
function openProductModal(prodId=null){
  document.getElementById('productModal').classList.remove('hidden');
  const f1=document.getElementById('prodImageFile');const f2=document.getElementById('prodImageGallery');if(f1)f1.value='';if(f2)f2.value='';setImageStatus('');
  if(prodId){const p=products.find(i=>i.id===prodId);document.getElementById('productModalTitle').textContent='Edit Barang';document.getElementById('prodId').value=p.id;document.getElementById('prodName').value=p.name;document.getElementById('prodBarcode').value=p.barcode||'';document.getElementById('prodCategory').value=p.category;document.getElementById('prodStock').value=p.stock;document.getElementById('prodCost').value=p.cost;document.getElementById('prodPrice').value=p.price;document.getElementById('prodImage').value=p.image||'';setProductImagePreview(p.image||'');}
  else{document.getElementById('productModalTitle').textContent='Tambah Barang Baru';document.getElementById('productForm').reset();document.getElementById('prodId').value='';document.getElementById('prodImage').value='';setProductImagePreview('');}
  lucide.createIcons();
}
function closeProductModal(){document.getElementById('productModal').classList.add('hidden');}
async function saveProduct(e){
  e.preventDefault();
  const id=document.getElementById('prodId').value,name=document.getElementById('prodName').value,barcode=document.getElementById('prodBarcode').value.trim(),category=document.getElementById('prodCategory').value,stock=parseInt(document.getElementById('prodStock').value),cost=parseFloat(document.getElementById('prodCost').value),price=parseFloat(document.getElementById('prodPrice').value),image=document.getElementById('prodImage').value.trim();
  if(barcode&&products.some(p=>p.barcode===barcode&&p.id!==id)){alert('Barcode sudah dipakai!');return;}
  const submitBtn=e.target.querySelector('button[type="submit"]'); if(submitBtn){submitBtn.disabled=true;submitBtn.textContent='Menyimpan...';}
  try{
    const result=await apiPost('saveProduct',{id:id||null,name,barcode,category,stock,cost,price,minStock:5,image});
    if(result.status!=='success') throw new Error(result.message||'Gagal');
    closeProductModal();
    if(id){const prod=products.find(p=>p.id===id);if(prod)Object.assign(prod,{name,barcode,category,stock,cost,price,minStock:5,image});renderStockTable();renderPosProducts();renderCategoryFilters();renderDashboard();}
    else await refreshAllData(true);
  }catch(err){alert('Gagal simpan: '+err.message);}
  finally{if(submitBtn){submitBtn.disabled=false;submitBtn.textContent='Simpan Barang';}}
}
function editProduct(id){openProductModal(id);}
async function deleteProduct(id){if(!confirm('Hapus barang ini?'))return;try{const result=await apiPost('deleteProduct',{id});if(result.status!=='success')throw new Error(result.message||'Gagal');products=products.filter(p=>p.id!==id);renderStockTable();renderPosProducts();renderCategoryFilters();renderDashboard();}catch(err){alert(err.message);}}
function openRestockModal(id){const p=products.find(x=>x.id===id);if(!p)return;document.getElementById('restockId').value=id;document.getElementById('restockName').textContent=p.name;document.getElementById('restockCurrent').textContent=p.stock;document.getElementById('restockQty').value='';document.getElementById('restockModal').classList.remove('hidden');lucide.createIcons();}
function closeRestockModal(){document.getElementById('restockModal').classList.add('hidden');}
async function saveRestock(e){
  e.preventDefault(); const id=document.getElementById('restockId').value; const addQty=parseInt(document.getElementById('restockQty').value);
  if(!addQty||addQty<1){alert('Masukkan jumlah');return;} const prod=products.find(p=>p.id===id); if(!prod)return;
  const newStock=prod.stock+addQty; const submitBtn=e.target.querySelector('button[type="submit"]'); if(submitBtn){submitBtn.disabled=true;submitBtn.textContent='Menyimpan...';}
  try{const result=await apiPost('saveProduct',{id:prod.id,name:prod.name,barcode:prod.barcode||'',category:prod.category,stock:newStock,cost:prod.cost,price:prod.price,minStock:prod.minStock||5,image:prod.image||''});if(result.status!=='success')throw new Error(result.message||'Gagal');prod.stock=newStock;closeRestockModal();renderStockTable();renderPosProducts();renderDashboard();}catch(err){alert(err.message);}finally{if(submitBtn){submitBtn.disabled=false;submitBtn.textContent='Tambah Stok';}}
}

/* ===== KASBON / EXPENSE / LAPORAN ===== */
function openKasbonModal(){document.getElementById('kasbonModal').classList.remove('hidden');lucide.createIcons();}
function closeKasbonModal(){document.getElementById('kasbonModal').classList.add('hidden');document.getElementById('kasbonForm').reset();}
async function saveKasbonManual(e){
  e.preventDefault(); const name=document.getElementById('kasbonModalCustomer').value.trim(); const total=parseFloat(document.getElementById('kasbonModalTotal').value); const note=document.getElementById('kasbonModalNote').value.trim();
  const now=new Date(); const timeStr=now.toLocaleDateString('id-ID')+' '+now.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
  const entry={id:'KSB-'+Date.now().toString().slice(-5),customer:note?`${name} (${note})`:name,total,time:timeStr,status:'Belum Lunas'};
  const submitBtn=e.target.querySelector('button[type="submit"]'); if(submitBtn){submitBtn.disabled=true;submitBtn.textContent='Menyimpan...';}
  try{const result=await apiPost('saveKasbon',entry);if(result.status!=='success')throw new Error(result.message||'Gagal');kasbonList.push(entry);renderKasbonTable();renderDashboard();closeKasbonModal();}catch(err){alert(err.message);}finally{if(submitBtn){submitBtn.disabled=false;submitBtn.textContent='Simpan';}}
}
function renderKasbonTable(){
  const search=(document.getElementById('kasbonSearch')?.value||'').toLowerCase();
  const filtered=kasbonList.filter(k=>k.customer.toLowerCase().includes(search)||(k.status||'').toLowerCase().includes(search));
  let unpaid=0; kasbonList.forEach(k=>{if(k.status==='Belum Lunas')unpaid+=k.total;});
  const u=document.getElementById('totalUnpaidKasbonText'); if(u) u.textContent='Rp '+unpaid.toLocaleString('id-ID');
  const tbody=document.getElementById('kasbonTableBody');
  if(tbody) tbody.innerHTML=filtered.map(k=>`<tr><td class="text-muted" style="font-size:12px">${k.time}</td><td class="font-bold">${k.customer}</td><td class="font-bold text-accent">Rp ${k.total.toLocaleString('id-ID')}</td><td><span class="badge ${k.status==='Lunas'?'badge-success':'badge-danger'}">${k.status}</span></td><td style="text-align:center">${k.status==='Belum Lunas'?`<button onclick="payKasbon('${k.id}')" class="btn btn-sm btn-primary">Tandai Lunas</button>`:'<span class="text-muted" style="font-size:12px">Selesai</span>'}</td></tr>`).join('');
  const cards=document.getElementById('kasbonCardsMobile');
  if(cards) cards.innerHTML=filtered.map(k=>`<div class="m-item"><div class="flex justify-between items-center gap-2"><div><div class="font-bold" style="font-size:14px">${k.customer}</div><div class="text-muted" style="font-size:12px">${k.time}</div></div><span class="badge ${k.status==='Lunas'?'badge-success':'badge-danger'}">${k.status}</span></div><div class="flex justify-between items-center" style="margin-top:10px"><span class="font-bold text-accent">Rp ${k.total.toLocaleString('id-ID')}</span>${k.status==='Belum Lunas'?`<button onclick="payKasbon('${k.id}')" class="btn btn-sm btn-primary">Tandai Lunas</button>`:''}</div></div>`).join('');
}
async function payKasbon(kasbonId){const item=kasbonList.find(k=>k.id===kasbonId);if(!item||!confirm(`Tandai ${item.customer} Rp ${item.total.toLocaleString('id-ID')} Lunas?`))return;try{const result=await apiPost('payKasbon',{id:kasbonId});if(result.status!=='success')throw new Error(result.message||'Gagal');item.status='Lunas';renderKasbonTable();renderDashboard();}catch(err){alert(err.message);}}
function renderExpenseTable(){
  const tbody=document.getElementById('expenseTableBody');
  if(tbody) tbody.innerHTML=expenses.map(e=>`<tr><td class="text-muted" style="font-size:12px">${e.date}</td><td class="font-bold">${e.category}</td><td>${e.desc}</td><td class="font-bold text-danger">Rp ${e.amount.toLocaleString('id-ID')}</td></tr>`).join('');
  const cards=document.getElementById('expenseCardsMobile');
  if(cards) cards.innerHTML=expenses.map(e=>`<div class="m-item"><div class="flex justify-between items-center gap-2"><div><div class="font-bold" style="font-size:14px">${e.category}</div><div class="text-muted" style="font-size:12px">${e.date}</div></div><span class="font-bold text-danger">Rp ${e.amount.toLocaleString('id-ID')}</span></div><p class="text-muted" style="font-size:12px;margin-top:6px">${e.desc}</p></div>`).join('');
}
function openExpenseModal(){document.getElementById('expenseModal').classList.remove('hidden');lucide.createIcons();}
function closeExpenseModal(){document.getElementById('expenseModal').classList.add('hidden');}
async function saveExpense(e){
  e.preventDefault(); const category=document.getElementById('expCategory').value,desc=document.getElementById('expDesc').value,amount=parseFloat(document.getElementById('expAmount').value),date=new Date().toLocaleDateString('id-ID');
  const entry={id:'EXP-'+Date.now(),date,category,desc,amount}; const submitBtn=e.target.querySelector('button[type="submit"]'); if(submitBtn){submitBtn.disabled=true;submitBtn.textContent='Menyimpan...';}
  try{const result=await apiPost('saveExpense',entry);if(result.status!=='success')throw new Error(result.message||'Gagal');expenses.push(entry);renderExpenseTable();updateFinancialReports();renderDashboard();closeExpenseModal();document.getElementById('expenseForm').reset();}catch(err){alert(err.message);}finally{if(submitBtn){submitBtn.disabled=false;submitBtn.textContent='Simpan';}}
}
function setReportFilter(f){reportFilter=f;document.querySelectorAll('.filter-pill').forEach(el=>el.classList.remove('active'));const btn=document.getElementById('filter-'+f);if(btn)btn.classList.add('active');updateFinancialReports();}
function updateFinancialReports(){
  const t=todayStr(); let sales=salesHistory,exps=expenses;
  if(reportFilter==='today'){sales=salesHistory.filter(s=>s.time&&s.time.includes(t));exps=expenses.filter(e=>e.date===t);}
  else if(reportFilter==='week'){sales=salesHistory.slice(-50);exps=expenses.slice(-30);}
  const totalOmset=sales.reduce((s,x)=>s+x.total,0),totalHpp=sales.reduce((s,x)=>s+(x.costTotal||0),0),totalExpense=exps.reduce((s,e)=>s+e.amount,0),netProfit=totalOmset-totalHpp-totalExpense,txCount=sales.length,avg=txCount?Math.round(totalOmset/txCount):0,margin=totalOmset?Math.round(((totalOmset-totalHpp)/totalOmset)*100):0;
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  set('reportOmset','Rp '+totalOmset.toLocaleString('id-ID')); set('reportHpp','Rp '+totalHpp.toLocaleString('id-ID')); set('reportExpense','Rp '+totalExpense.toLocaleString('id-ID')); set('reportProfit','Rp '+netProfit.toLocaleString('id-ID')); set('reportTxCount',txCount+' transaksi'); set('reportAvg','Rp '+avg.toLocaleString('id-ID')); set('reportMargin',margin+'%');
  const topBox=document.getElementById('reportTopProducts');
  if(topBox){const top=computeTopProducts(sales,8);if(!top.length)topBox.innerHTML='<div class="empty">Belum ada data</div>';else{const max=top[0][1]||1;topBox.innerHTML=top.map(([name,qty])=>`<div class="bar-row"><div class="name" title="${name}">${name}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(8,(qty/max)*100)}%"></div></div><div class="val">${qty} pcs</div></div>`).join('');}}
  const payBox=document.getElementById('reportPayments');
  if(payBox){const list=paymentBreakdown(sales);const maxP=list.length?list[0][1]:1;if(!list.length)payBox.innerHTML='<div class="empty">Belum ada data</div>';else payBox.innerHTML=list.map(([m,total])=>`<div class="bar-row"><div class="name">${m}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(8,(total/maxP)*100)}%;background:linear-gradient(90deg,#a78bfa,#7c3aed)"></div></div><div class="val">Rp ${total.toLocaleString('id-ID')}</div></div>`).join('');}
  const display=reportFilter==='all'?salesHistory:sales;
  const tbody=document.getElementById('salesHistoryTableBody');
  if(tbody) tbody.innerHTML=[...display].reverse().map(s=>`<tr><td class="font-mono">${s.id}</td><td class="text-muted" style="font-size:12px">${s.time}</td><td style="font-size:12px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${s.itemsSummary}</td><td class="font-bold text-accent">Rp ${s.total.toLocaleString('id-ID')}</td><td><span class="badge badge-muted">${s.method}</span></td></tr>`).join('');
  const cards=document.getElementById('salesHistoryCardsMobile');
  if(cards) cards.innerHTML=[...display].reverse().map(s=>`<div class="m-item"><div class="flex justify-between items-center gap-2"><div><div class="font-mono text-muted">${s.id}</div><div class="text-muted" style="font-size:12px">${s.time}</div></div><span class="badge badge-muted">${s.method}</span></div><p style="font-size:12px;color:var(--text-2);margin-top:6px">${s.itemsSummary}</p><div class="font-bold text-accent" style="margin-top:4px">Rp ${s.total.toLocaleString('id-ID')}</div></div>`).join('');
}


/* ===== PERTALITE / BBM ===== */
async function ensureFuelProduct(saveIfNew){
  if(saveIfNew===undefined) saveIfNew=true;
  let p=products.find(x=>x.id===FUEL_PRODUCT_ID || (x.barcode&&x.barcode.toUpperCase()===FUEL_BARCODE));
  if(p){
    // pastikan id konsisten
    if(p.id!==FUEL_PRODUCT_ID) p.id=FUEL_PRODUCT_ID;
    return p;
  }
  // default produk
  const neu={
    id:FUEL_PRODUCT_ID,
    name:'Pertalite',
    barcode:FUEL_BARCODE,
    category:'BBM',
    stock:0,
    cost:12500,
    price:13000,
    minStock:10,
    image:''
  };
  products.push(neu);
  if(saveIfNew){
    try{
      await apiPost('saveProduct',{id:FUEL_PRODUCT_ID,name:neu.name,barcode:neu.barcode,category:neu.category,stock:neu.stock,cost:neu.cost,price:neu.price,minStock:neu.minStock,image:''});
    }catch(e){ console.warn('Gagal init produk Pertalite', e); }
  }
  return neu;
}

function getFuelProduct(){
  return products.find(x=>x.id===FUEL_PRODUCT_ID || (x.barcode&&String(x.barcode).toUpperCase()===FUEL_BARCODE));
}

function setFuelMode(mode){
  fuelMode=mode;
  document.getElementById('fuelModeRp').classList.toggle('active', mode==='rp');
  document.getElementById('fuelModeLiter').classList.toggle('active', mode==='liter');
  document.getElementById('fuelInputRpWrap').classList.toggle('hidden', mode!=='rp');
  document.getElementById('fuelInputLiterWrap').classList.toggle('hidden', mode!=='liter');
  calcFuelPreview();
}

function setFuelRp(n){
  fuelMode='rp';
  setFuelMode('rp');
  document.getElementById('fuelAmountRp').value=n;
  calcFuelPreview();
}

function calcFuelPreview(){
  const p=getFuelProduct();
  const price=p?Number(p.price)||13000:13000;
  let liters=0, total=0;
  if(fuelMode==='rp'){
    total=parseFloat(document.getElementById('fuelAmountRp').value)||0;
    liters=price>0 ? total/price : 0;
  }else{
    liters=parseFloat(document.getElementById('fuelAmountLiter').value)||0;
    total=liters*price;
  }
  const elL=document.getElementById('fuelPreviewLiter');
  const elT=document.getElementById('fuelPreviewTotal');
  if(elL) elL.textContent=liters.toLocaleString('id-ID',{maximumFractionDigits:3})+' L';
  if(elT) elT.textContent='Rp '+Math.round(total).toLocaleString('id-ID');
}

function toggleFuelKasbon(){
  const m=document.getElementById('fuelPayMethod').value;
  document.getElementById('fuelKasbonWrap').classList.toggle('hidden', m!=='Kasbon');
}

function renderFuelPage(){
  const p=getFuelProduct();
  if(!p) return;
  const price=Number(p.price)||13000;
  const stock=Number(p.stock)||0;
  const value=stock*price;
  const set=(id,v)=>{const el=document.getElementById(id); if(el) el.textContent=v;};
  set('fuelPriceDisplay','Rp '+price.toLocaleString('id-ID'));
  set('fuelStockLiters', stock.toLocaleString('id-ID',{maximumFractionDigits:2}));
  set('fuelStockValue','Rp '+Math.round(value).toLocaleString('id-ID'));
  var cap=parseFloat(localStorage.getItem('fuelCapacityLiters')||'200')||200;
  var capInput=document.getElementById('fuelCapacity');
  if(capInput && document.activeElement!==capInput) capInput.value=cap;
  var pct=Math.max(0, Math.min(100, (stock/cap)*100));
  var liquid=document.getElementById('fuelTankLiquid');
  var pctEl=document.getElementById('fuelTankPct');
  if(liquid) liquid.style.height=pct+'%';
  if(pctEl) pctEl.textContent=Math.round(pct)+'%';
  set('fuelCapacityLabel', cap.toLocaleString('id-ID')+' L');
  set('fuelFilledLabel', stock.toLocaleString('id-ID',{maximumFractionDigits:2})+' L');
  set('fuelEmptyLabel', Math.max(0, cap-stock).toLocaleString('id-ID',{maximumFractionDigits:2})+' L');
  const ep=document.getElementById('fuelEditPrice');
  const ec=document.getElementById('fuelEditCost');
  if(ep) ep.value=price;
  if(ec) ec.value=Number(p.cost)||0;

  // statistik hari ini dari sales yang mengandung Pertalite
  const t=todayStr();
  const fuelSales=salesHistory.filter(s=>s.time&&s.time.includes(t) && s.itemsSummary && /pertalite/i.test(s.itemsSummary));
  let omset=0, literSold=0;
  fuelSales.forEach(s=>{
    omset+=s.total||0;
    // parse "Pertalite (0.385)" dari summary
    const m=String(s.itemsSummary).match(/pertalite\s*\(([\d.,]+)\)/i);
    if(m) literSold+=parseFloat(m[1].replace(',','.'))||0;
  });
  set('fuelTodayOmset','Rp '+omset.toLocaleString('id-ID'));
  set('fuelTodayLiter', literSold.toLocaleString('id-ID',{maximumFractionDigits:2})+' L');
  set('fuelTodayTx', String(fuelSales.length));
  calcFuelPreview();
  lucide.createIcons();
}

async function saveFuelPrice(){
  const p=await ensureFuelProduct();
  const price=parseFloat(document.getElementById('fuelEditPrice').value);
  const cost=parseFloat(document.getElementById('fuelEditCost').value);
  const capEl=document.getElementById('fuelCapacity');
  if(capEl){
    var cap=parseFloat(capEl.value)||200;
    if(cap<1) cap=200;
    localStorage.setItem('fuelCapacityLiters', String(cap));
  }
  if(!price||price<=0){ alert('Harga per liter tidak valid'); return; }
  try{
    const result=await apiPost('saveProduct',{
      id:p.id, name:p.name, barcode:p.barcode||FUEL_BARCODE, category:'BBM',
      stock:Number(p.stock)||0, cost:cost||0, price:price, minStock:p.minStock||10, image:p.image||''
    });
    if(result.status!=='success') throw new Error(result.message||'Gagal');
    p.price=price; p.cost=cost||0;
    renderFuelPage();
    showScanToast('Harga Pertalite disimpan: Rp '+price.toLocaleString('id-ID'));
    playScanBeep();
  }catch(e){ alert('Gagal simpan harga: '+e.message); }
}

async function addFuelStock(){
  const p=await ensureFuelProduct();
  const add=parseFloat(document.getElementById('fuelAddStock').value);
  if(!add||add<=0){ alert('Masukkan jumlah liter'); return; }
  const newStock=(Number(p.stock)||0)+add;
  try{
    const result=await apiPost('saveProduct',{
      id:p.id, name:p.name, barcode:p.barcode||FUEL_BARCODE, category:'BBM',
      stock:newStock, cost:p.cost, price:p.price, minStock:p.minStock||10, image:p.image||''
    });
    if(result.status!=='success') throw new Error(result.message||'Gagal');
    p.stock=newStock;
    document.getElementById('fuelAddStock').value='';
    renderFuelPage();
    showScanToast('+'+add+' L stok Pertalite');
    playCoinSound();
  }catch(e){ alert(e.message); }
}

async function setFuelStockManual(){
  const p=await ensureFuelProduct();
  const v=prompt('Set stok Pertalite (liter):', String(p.stock||0));
  if(v===null) return;
  const stock=parseFloat(v);
  if(isNaN(stock)||stock<0){ alert('Nilai tidak valid'); return; }
  try{
    const result=await apiPost('saveProduct',{
      id:p.id, name:p.name, barcode:p.barcode||FUEL_BARCODE, category:'BBM',
      stock:stock, cost:p.cost, price:p.price, minStock:p.minStock||10, image:p.image||''
    });
    if(result.status!=='success') throw new Error(result.message||'Gagal');
    p.stock=stock;
    renderFuelPage();
    showScanToast('Stok diset: '+stock+' L');
  }catch(e){ alert(e.message); }
}

async function processFuelSale(){
  const p=await ensureFuelProduct();
  const price=Number(p.price)||13000;
  const cost=Number(p.cost)||0;
  let liters=0, total=0;
  if(fuelMode==='rp'){
    total=parseFloat(document.getElementById('fuelAmountRp').value)||0;
    liters=price>0 ? total/price : 0;
  }else{
    liters=parseFloat(document.getElementById('fuelAmountLiter').value)||0;
    total=liters*price;
  }
  total=Math.round(total);
  liters=Math.round(liters*1000)/1000; // 3 desimal

  if(total<=0 || liters<=0){ alert('Masukkan nominal atau liter'); return; }
  if(liters>(Number(p.stock)||0)+1e-9){
    alert('Stok tidak cukup!\nSisa: '+(p.stock||0)+' L\nDiminta: '+liters+' L');
    return;
  }

  const method=document.getElementById('fuelPayMethod').value;
  let kasbonEntry=null;
  const now=new Date();
  const timeStr=now.toLocaleDateString('id-ID')+' '+now.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
  const transId='BBM-'+Date.now().toString().slice(-6);

  if(method==='Kasbon'){
    const name=(document.getElementById('fuelKasbonName').value||'').trim();
    if(!name){ alert('Nama pelanggan wajib untuk kasbon'); return; }
    kasbonEntry={id:'KSB-'+Date.now().toString().slice(-5),customer:name+' (Pertalite)',total:total,time:timeStr,status:'Belum Lunas'};
  }

  // qty fractional — backend mengurangi stok numerik
  const sale={
    id:transId,
    time:timeStr,
    itemsSummary:'Pertalite ('+liters+')',
    total:total,
    costTotal:Math.round(liters*cost),
    method:method
  };

  const btn=document.getElementById('fuelSellBtn');
  if(btn){ btn.disabled=true; btn.style.opacity='.7'; }

  try{
    const result=await apiPost('saveSale',{
      sale:sale,
      items:[{id:p.id, qty:Number(liters)}],
      kasbon:kasbonEntry
    });
    if(result.status!=='success') throw new Error(result.message||'Gagal');

    p.stock=Math.round(((Number(p.stock)||0)-liters)*1000)/1000;
    // Pastikan stok BBM tersimpan ke Google Sheet (cadangan jika pengurangan desimal gagal)
    try{
      await apiPost('saveProduct',{
        id:p.id, name:p.name, barcode:p.barcode||FUEL_BARCODE, category:'BBM',
        stock:p.stock, cost:p.cost, price:p.price, minStock:p.minStock||10, image:p.image||''
      });
    }catch(eStock){ console.warn('Sync stok BBM', eStock); }
    salesHistory.push(sale);
    if(kasbonEntry) kasbonList.push(kasbonEntry);

    playCoinSound();
    showReceipt(transId, timeStr, total, method, [{name:'Pertalite', qty:liters, price:price}]);
    document.getElementById('fuelAmountRp').value='';
    document.getElementById('fuelAmountLiter').value='';
    calcFuelPreview();
    renderFuelPage();
    renderDashboard();
    renderKasbonTable();
    updateFinancialReports();
    showScanToast('Pertalite '+liters+' L · Rp '+total.toLocaleString('id-ID'));
  }catch(e){
    alert('Gagal transaksi BBM: '+e.message);
  }finally{
    if(btn){ btn.disabled=false; btn.style.opacity='1'; }
  }
}

