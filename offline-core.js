/* ============================================================
   WARUNG MANG ALI — Offline Core
   IndexedDB cache + sync queue. Auto-upload saat online.
   ============================================================ */
(function (global) {
  'use strict';

  const DB_NAME = 'WarungMangAliDB';
  const DB_VERSION = 1;
  const STORE_DATA = 'data';
  const STORE_QUEUE = 'syncQueue';

  let _dbPromise = null;
  let _syncRunning = false;
  let _pendingCount = 0;

  function openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise(function (resolve, reject) {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_DATA)) {
          db.createObjectStore(STORE_DATA);
        }
        if (!db.objectStoreNames.contains(STORE_QUEUE)) {
          const q = db.createObjectStore(STORE_QUEUE, { keyPath: 'id', autoIncrement: true });
          q.createIndex('status', 'status', { unique: false });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return _dbPromise;
  }

  function idbGet(key) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_DATA, 'readonly');
        const req = tx.objectStore(STORE_DATA).get(key);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function idbSet(key, value) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_DATA, 'readwrite');
        tx.objectStore(STORE_DATA).put(value, key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function enqueue(action, payload) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_QUEUE, 'readwrite');
        const item = {
          action: action,
          payload: payload,
          status: 'pending',
          createdAt: Date.now(),
          retries: 0
        };
        const req = tx.objectStore(STORE_QUEUE).add(item);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function getPendingQueue() {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_QUEUE, 'readonly');
        const req = tx.objectStore(STORE_QUEUE).index('status').getAll('pending');
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function markSynced(id) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_QUEUE, 'readwrite');
        const store = tx.objectStore(STORE_QUEUE);
        const getReq = store.get(id);
        getReq.onsuccess = function () {
          const item = getReq.result;
          if (item) {
            item.status = 'synced';
            store.put(item);
          }
          resolve();
        };
        getReq.onerror = function () { reject(getReq.error); };
      });
    });
  }

  function bumpRetry(id) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_QUEUE, 'readwrite');
        const store = tx.objectStore(STORE_QUEUE);
        const getReq = store.get(id);
        getReq.onsuccess = function () {
          const item = getReq.result;
          if (item) {
            item.retries = (item.retries || 0) + 1;
            if (item.retries >= 8) item.status = 'failed';
            store.put(item);
          }
          resolve();
        };
        getReq.onerror = function () { reject(getReq.error); };
      });
    });
  }

  function clearSyncedOld() {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_QUEUE, 'readwrite');
        const store = tx.objectStore(STORE_QUEUE);
        const req = store.openCursor();
        const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
        req.onsuccess = function (e) {
          const cursor = e.target.result;
          if (cursor) {
            const v = cursor.value;
            if (v.status === 'synced' && v.createdAt < cutoff) cursor.delete();
            cursor.continue();
          } else {
            resolve();
          }
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function isOnline() {
    return typeof navigator !== 'undefined' && navigator.onLine !== false;
  }

  function updateBadge(count) {
    _pendingCount = count;
    let badge = document.getElementById('offlineBadge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'offlineBadge';
      badge.setAttribute('role', 'status');
      badge.style.cssText =
        'position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:200;' +
        'padding:8px 16px;border-radius:999px;font-size:12px;font-weight:800;' +
        'font-family:Nunito,system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.18);' +
        'display:none;align-items:center;gap:8px;max-width:92vw;text-align:center;cursor:pointer';
      badge.onclick = function () {
        if (isOnline()) processSyncQueue(true);
      };
      document.body.appendChild(badge);
    }
    if (!isOnline()) {
      badge.style.display = 'flex';
      badge.style.background = '#b45309';
      badge.style.color = '#fff';
      badge.textContent = count > 0
        ? '⚠ Offline · ' + count + ' data menunggu sync (ketuk saat online)'
        : '⚠ Mode Offline — data tersimpan di perangkat';
    } else if (count > 0) {
      badge.style.display = 'flex';
      badge.style.background = '#0284c7';
      badge.style.color = '#fff';
      badge.textContent = '⟳ Menyinkronkan ' + count + ' data… (ketuk untuk coba lagi)';
    } else {
      badge.style.display = 'none';
    }
  }

  async function refreshPendingCount() {
    try {
      const q = await getPendingQueue();
      updateBadge(q.length);
      return q.length;
    } catch (e) {
      return 0;
    }
  }

  /**
   * Kirim antrian ke server. Dipanggil saat online / interval / tombol refresh.
   * @param {boolean} forceShow - tampilkan toast jika sukses
   */
  async function processSyncQueue(forceShow) {
    if (_syncRunning) return { ok: 0, fail: 0 };
    if (!isOnline()) {
      await refreshPendingCount();
      return { ok: 0, fail: 0 };
    }

    _syncRunning = true;
    let ok = 0;
    let fail = 0;

    try {
      const queue = await getPendingQueue();
      updateBadge(queue.length);

      for (let i = 0; i < queue.length; i++) {
        const item = queue[i];
        if (!isOnline()) break;

        try {
          // apiPost harus sudah ada di global (dari app.js)
          if (typeof global.apiPostRaw !== 'function' && typeof global.apiPost !== 'function') {
            throw new Error('apiPost belum siap');
          }
          const postFn = global.apiPostRaw || global.apiPost;
          const res = await postFn(item.action, item.payload);

          if (res && (res.status === 'success' || res.status === 'ok' || res.status === 'duplicate')) {
            await markSynced(item.id);
            ok++;
          } else {
            await bumpRetry(item.id);
            fail++;
            console.warn('[offline] sync gagal', item.action, res);
          }
        } catch (err) {
          await bumpRetry(item.id);
          fail++;
          console.warn('[offline] network error', err);
          // putus koneksi → stop antrian
          if (!isOnline()) break;
        }
      }

      await clearSyncedOld();
      const left = await refreshPendingCount();

      if (forceShow && ok > 0 && typeof global.showScanToast === 'function') {
        global.showScanToast(ok + ' data berhasil di-upload ke Google Sheet');
      }
      if (left === 0 && ok > 0) {
        // setelah sync penuh, tarik data terbaru dari server (opsional)
        if (typeof global.refreshAllData === 'function') {
          try { await global.refreshAllData(true); } catch (e) {}
        }
      }
    } finally {
      _syncRunning = false;
    }

    return { ok: ok, fail: fail };
  }

  /**
   * Simpan cache data master ke IndexedDB
   */
  async function cacheAllData(data) {
    if (!data) return;
    if (data.products) await idbSet('products', data.products);
    if (data.sales) await idbSet('sales', data.sales);
    if (data.kasbon) await idbSet('kasbon', data.kasbon);
    if (data.expenses) await idbSet('expenses', data.expenses);
    await idbSet('cachedAt', Date.now());
  }

  async function loadCache() {
    const products = (await idbGet('products')) || [];
    const sales = (await idbGet('sales')) || [];
    const kasbon = (await idbGet('kasbon')) || [];
    const expenses = (await idbGet('expenses')) || [];
    const cachedAt = await idbGet('cachedAt');
    return { products: products, sales: sales, kasbon: kasbon, expenses: expenses, cachedAt: cachedAt };
  }

  /**
   * apiPost offline-aware:
   * - coba online dulu
   * - jika gagal jaringan → enqueue + return success lokal
   * - aksi baca (getData) tidak di-queue
   */
  async function apiPostOffline(action, payload) {
    const readOnly = action === 'getData';
    if (isOnline()) {
      try {
        const res = await global.apiPostRaw(action, payload);
        return res;
      } catch (err) {
        if (readOnly) throw err;
        // jaringan gagal → antrikan
        console.warn('[offline] post gagal, masuk antrian:', action, err);
        await enqueue(action, payload);
        await refreshPendingCount();
        return { status: 'success', offline: true, message: 'Disimpan offline, akan sync otomatis' };
      }
    }
    // offline total
    if (readOnly) throw new Error('Offline');
    await enqueue(action, payload);
    await refreshPendingCount();
    return { status: 'success', offline: true, message: 'Disimpan offline, akan sync otomatis' };
  }

  function initListeners() {
    window.addEventListener('online', function () {
      console.log('[offline] online — mulai sync');
      updateBadge(_pendingCount);
      processSyncQueue(true);
      // minta Background Sync jika tersedia
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(function (reg) {
          if (reg.sync) {
            reg.sync.register('warung-sync').catch(function () {});
          }
        });
      }
    });

    window.addEventListener('offline', function () {
      console.log('[offline] offline');
      refreshPendingCount();
    });

    // sync berkala setiap 45 detik jika online
    setInterval(function () {
      if (isOnline()) processSyncQueue(false);
    }, 45000);

    // sync saat tab kembali fokus
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && isOnline()) {
        processSyncQueue(false);
      }
    });
  }

  // Public API
  global.OfflineCore = {
    openDB: openDB,
    idbGet: idbGet,
    idbSet: idbSet,
    enqueue: enqueue,
    getPendingQueue: getPendingQueue,
    processSyncQueue: processSyncQueue,
    cacheAllData: cacheAllData,
    loadCache: loadCache,
    apiPostOffline: apiPostOffline,
    refreshPendingCount: refreshPendingCount,
    isOnline: isOnline,
    initListeners: initListeners,
    updateBadge: updateBadge
  };
})(typeof window !== 'undefined' ? window : self);
