/* ============================================================
   WARUNG MANG ALI — Offline Core v2
   IndexedDB cache + sync queue (anti double-transaksi)
   ============================================================ */
(function (global) {
  'use strict';

  const DB_NAME = 'WarungMangAliDB';
  const DB_VERSION = 2; // bump: fingerprint index
  const STORE_DATA = 'data';
  const STORE_QUEUE = 'syncQueue';
  const STORE_DONE = 'doneKeys'; // kunci bisnis yang sudah sukses sync (anti-replay)

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
          q.createIndex('fingerprint', 'fingerprint', { unique: false });
        } else if (e.oldVersion < 2) {
          try {
            const tx = e.target.transaction;
            const q = tx.objectStore(STORE_QUEUE);
            if (!q.indexNames.contains('fingerprint')) {
              q.createIndex('fingerprint', 'fingerprint', { unique: false });
            }
          } catch (err) { console.warn(err); }
        }
        if (!db.objectStoreNames.contains(STORE_DONE)) {
          db.createObjectStore(STORE_DONE, { keyPath: 'key' });
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

  /** Kunci unik bisnis per aksi (supaya tidak enqueue 2x / replay) */
  function makeFingerprint(action, payload) {
    payload = payload || {};
    try {
      if (action === 'saveSale' && payload.sale && payload.sale.id) {
        return 'sale:' + String(payload.sale.id);
      }
      if (action === 'saveKasbon' && payload.id) {
        return 'kasbon:' + String(payload.id);
      }
      if (action === 'payKasbon' && payload.id) {
        return 'payKasbon:' + String(payload.id);
      }
      if (action === 'saveExpense' && payload.id) {
        return 'expense:' + String(payload.id);
      }
      if (action === 'saveProduct' && payload.id) {
        return 'product:' + String(payload.id) + ':' + String(payload.stock) + ':' + String(payload.price);
      }
      if (action === 'deleteProduct' && payload.id) {
        return 'delProduct:' + String(payload.id);
      }
      if (action === 'saveStockLog' && payload.id) {
        return 'stocklog:' + String(payload.id);
      }
      if (action === 'saveFuel') {
        var sm = payload.stockMode || 'set';
        if (sm === 'leave') {
          return 'fuel:leave:' + String(payload.price) + ':' + String(payload.cost);
        }
        // set: fingerprint tetap per nilai stok, tapi enqueue akan mengganti pending lama
        return 'fuel:set:' + String(payload.stock) + ':' + String(payload.price);
      }
      // fallback: hash kasar isi payload
      return action + ':' + JSON.stringify(payload).slice(0, 180);
    } catch (e) {
      return action + ':' + Date.now();
    }
  }

  function isDoneKey(key) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_DONE, 'readonly');
        const req = tx.objectStore(STORE_DONE).get(key);
        req.onsuccess = function () { resolve(!!req.result); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function markDoneKey(key) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_DONE, 'readwrite');
        tx.objectStore(STORE_DONE).put({ key: key, at: Date.now() });
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function findPendingByFingerprint(fp) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_QUEUE, 'readonly');
        const store = tx.objectStore(STORE_QUEUE);
        if (!store.indexNames.contains('fingerprint')) {
          resolve(null);
          return;
        }
        const req = store.index('fingerprint').getAll(fp);
        req.onsuccess = function () {
          const list = (req.result || []).filter(function (x) { return x.status === 'pending'; });
          resolve(list.length ? list[0] : null);
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  /**
   * Masukkan antrian HANYA jika:
   * - belum pernah sukses (doneKeys)
   * - belum ada pending dengan fingerprint sama
   */
  async function enqueue(action, payload) {
    const fp = makeFingerprint(action, payload);

    if (await isDoneKey(fp)) {
      console.log('[offline] skip enqueue, sudah done:', fp);
      return null;
    }

    const existing = await findPendingByFingerprint(fp);
    if (existing) {
      console.log('[offline] skip enqueue, sudah pending:', fp);
      return existing.id;
    }

    // saveFuel stockMode=set: buang antrian saveFuel lama (stok usang) supaya tidak menaikkan stok lagi
    if (action === 'saveFuel' && (payload.stockMode || 'set') === 'set') {
      try { await removePendingByAction('saveFuel'); } catch (e) {}
    }

    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_QUEUE, 'readwrite');
        const item = {
          action: action,
          payload: payload,
          fingerprint: fp,
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
        const store = tx.objectStore(STORE_QUEUE);
        // Ambil semua lalu filter pending (lebih andal daripada index saja)
        const req = store.getAll();
        req.onsuccess = function () {
          const all = req.result || [];
          const pending = all
            .filter(function (x) { return x.status === 'pending'; })
            .sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
          resolve(pending);
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  /** Hapus item dari antrian (setelah sukses / duplicate) */
  function removeFromQueue(id) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_QUEUE, 'readwrite');
        tx.objectStore(STORE_QUEUE).delete(id);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function removePendingByAction(actionName) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_QUEUE, 'readwrite');
        const store = tx.objectStore(STORE_QUEUE);
        const req = store.openCursor();
        req.onsuccess = function (e) {
          const cursor = e.target.result;
          if (cursor) {
            const v = cursor.value;
            if (v.status === 'pending' && v.action === actionName) {
              cursor.delete();
            }
            cursor.continue();
          } else {
            resolve();
          }
        };
        req.onerror = function () { reject(req.error); };
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
            if (item.retries >= 10) {
              // gagal terus → buang supaya tidak spam Sheet
              store.delete(id);
            } else {
              store.put(item);
            }
          }
          resolve();
        };
        getReq.onerror = function () { reject(getReq.error); };
      });
    });
  }

  /** Bersihkan antrian lama berstatus synced/failed (legacy v1) */
  function purgeNonPending() {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_QUEUE, 'readwrite');
        const store = tx.objectStore(STORE_QUEUE);
        const req = store.openCursor();
        req.onsuccess = function (e) {
          const cursor = e.target.result;
          if (cursor) {
            const v = cursor.value;
            if (v.status && v.status !== 'pending') {
              cursor.delete();
            }
            cursor.continue();
          } else {
            resolve();
          }
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  /** Hapus doneKeys lebih dari 30 hari */
  function purgeOldDoneKeys() {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_DONE, 'readwrite');
        const store = tx.objectStore(STORE_DONE);
        const req = store.openCursor();
        req.onsuccess = function (e) {
          const cursor = e.target.result;
          if (cursor) {
            if ((cursor.value.at || 0) < cutoff) cursor.delete();
            cursor.continue();
          } else resolve();
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

  function isSuccessStatus(res) {
    if (!res) return false;
    const s = res.status;
    return s === 'success' || s === 'ok' || s === 'duplicate';
  }

  /**
   * Kirim antrian ke server. Setelah sukses/duplicate → HAPUS dari queue + catat doneKey.
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
      await purgeNonPending();

      let queue = await getPendingQueue();

      // Dedupe dalam memori: fingerprint sama hanya proses sekali
      const seenFp = {};
      const unique = [];
      for (let i = 0; i < queue.length; i++) {
        const it = queue[i];
        const fp = it.fingerprint || makeFingerprint(it.action, it.payload);
        if (seenFp[fp]) {
          // hapus duplikat di antrian
          try { await removeFromQueue(it.id); } catch (e) {}
          continue;
        }
        seenFp[fp] = true;
        unique.push(it);
      }
      queue = unique;
      updateBadge(queue.length);

      for (let i = 0; i < queue.length; i++) {
        const item = queue[i];
        if (!isOnline()) break;

        const fp = item.fingerprint || makeFingerprint(item.action, item.payload);

        // Sudah pernah sukses di perangkat ini → jangan kirim lagi
        if (await isDoneKey(fp)) {
          try { await removeFromQueue(item.id); } catch (e) {}
          ok++;
          continue;
        }

        try {
          const postFn = global.apiPostRaw || global.apiPost;
          if (typeof postFn !== 'function') throw new Error('apiPost belum siap');

          const res = await postFn(item.action, item.payload);

          if (isSuccessStatus(res)) {
            await markDoneKey(fp);
            await removeFromQueue(item.id);
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
          if (!isOnline()) break;
        }
      }

      try { await purgeOldDoneKeys(); } catch (e) {}
      const left = await refreshPendingCount();

      if (forceShow && ok > 0 && typeof global.showScanToast === 'function') {
        global.showScanToast(ok + ' data berhasil di-upload ke Google Sheet');
      }
      // Jangan auto refreshAllData setelah sync — bisa memicu kebingungan stok.
      // User bisa tekan refresh manual.
      void left;
    } finally {
      _syncRunning = false;
    }

    return { ok: ok, fail: fail };
  }

  async function cacheAllData(data) {
    if (!data) return;
    if (data.products) await idbSet('products', data.products);
    if (data.sales) await idbSet('sales', data.sales);
    if (data.kasbon) await idbSet('kasbon', data.kasbon);
    if (data.expenses) await idbSet('expenses', data.expenses);
    if (data.stockLog) await idbSet('stockLog', data.stockLog);
    await idbSet('cachedAt', Date.now());
  }

  async function loadCache() {
    const products = (await idbGet('products')) || [];
    const sales = (await idbGet('sales')) || [];
    const kasbon = (await idbGet('kasbon')) || [];
    const expenses = (await idbGet('expenses')) || [];
    const stockLog = (await idbGet('stockLog')) || [];
    const cachedAt = await idbGet('cachedAt');
    return { products: products, sales: sales, kasbon: kasbon, expenses: expenses, stockLog: stockLog, cachedAt: cachedAt };
  }

  /**
   * Online: kirim ke server.
   *   - sukses → catat doneKey (supaya tidak bisa di-enqueue ulang)
   *   - gagal parse/jaringan → enqueue (tapi cek doneKey dulu)
   * Offline: enqueue saja.
   *
   * PENTING: tidak pernah enqueue jika fingerprint sudah done.
   */
  async function apiPostOffline(action, payload) {
    const readOnly = action === 'getData';
    const fp = makeFingerprint(action, payload);

    if (isOnline()) {
      try {
        const res = await global.apiPostRaw(action, payload);
        if (!readOnly && isSuccessStatus(res)) {
          try { await markDoneKey(fp); } catch (e) {}
          // Jika kebetulan ada pending sama, bersihkan
          try {
            const ex = await findPendingByFingerprint(fp);
            if (ex) await removeFromQueue(ex.id);
          } catch (e) {}
        }
        return res;
      } catch (err) {
        if (readOnly) throw err;
        console.warn('[offline] post gagal, coba antrikan:', action, err);
        await enqueue(action, payload);
        await refreshPendingCount();
        return { status: 'success', offline: true, message: 'Disimpan offline, akan sync otomatis' };
      }
    }

    if (readOnly) throw new Error('Offline');
    await enqueue(action, payload);
    await refreshPendingCount();
    return { status: 'success', offline: true, message: 'Disimpan offline, akan sync otomatis' };
  }

  /** Tombol darurat: kosongkan seluruh antrian (jika sudah yakin data di Sheet benar) */
  async function clearAllPendingQueue() {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_QUEUE, 'readwrite');
        tx.objectStore(STORE_QUEUE).clear();
        tx.oncomplete = function () {
          refreshPendingCount();
          resolve();
        };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function initListeners() {
    window.addEventListener('online', function () {
      console.log('[offline] online — mulai sync');
      updateBadge(_pendingCount);
      processSyncQueue(true);
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

    // Interval lebih longgar agar tidak spam
    setInterval(function () {
      if (isOnline()) processSyncQueue(false);
    }, 90000);

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && isOnline()) {
        processSyncQueue(false);
      }
    });

    // Bersihkan legacy "synced" yang menumpuk
    purgeNonPending().catch(function () {});
  }

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
    clearAllPendingQueue: clearAllPendingQueue,
    isOnline: isOnline,
    initListeners: initListeners,
    updateBadge: updateBadge
  };
})(typeof window !== 'undefined' ? window : self);
