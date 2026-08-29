/**
 * WARUNG MANG ALI - Google Apps Script Backend (sinkron dengan frontend)
 *
 * PASANG:
 * 1. script.google.com -> New project
 * 2. Tempel SELURUH file ini, Simpan
 * 3. Deploy -> New deployment -> Web app
 *    Execute as: Me | Who has access: Anyone
 * 4. Copy URL -> paste ke WEB_APP_URL di app.js
 * 5. Jalankan setupDatabase() sekali dari editor (opsional)
 */

var SPREADSHEET_NAME = 'Database Warung Mang Ali';
var PHOTO_FOLDER_NAME = 'WarungMangAli_Produk';
var SHEET = { PRODUCTS: 'Products', SALES: 'Sales', KASBON: 'Kasbon', EXPENSES: 'Expenses', STOCKLOG: 'StockLog' };
var HEAD = {
  PRODUCTS: ['id', 'name', 'barcode', 'category', 'stock', 'cost', 'price', 'minStock', 'image'],
  SALES: ['id', 'time', 'itemsSummary', 'total', 'costTotal', 'method'],
  KASBON: ['id', 'customer', 'total', 'time', 'status'],
  EXPENSES: ['id', 'date', 'category', 'desc', 'amount'],
  STOCKLOG: ['id', 'time', 'productId', 'productName', 'type', 'qtyBefore', 'qtyAfter', 'delta', 'note', 'refId']
};

function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : '';
    if (action === 'getData') return json_(getData());
    if (action === 'imageUrl' && e.parameter.id) {
      var fid = String(e.parameter.id);
      return json_({
        status: 'success',
        url: 'https://drive.google.com/thumbnail?id=' + fid + '&sz=w1000',
        urlAlt: 'https://lh3.googleusercontent.com/d/' + fid + '=w1000'
      });
    }
    return json_({ status: 'ok', message: 'Warung Mang Ali API' });
  } catch (err) {
    return json_({ status: 'error', message: String(err) });
  }
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return json_({ status: 'error', message: 'Body kosong' });
    var body = JSON.parse(e.postData.contents);
    var action = body.action;
    var payload = body.payload || {};
    var result;
    switch (action) {
      case 'getData': result = getData(); break;
      case 'saveProduct': result = saveProduct(payload); break;
      case 'deleteProduct': result = deleteProduct(payload); break;
      case 'saveSale': result = saveSale(payload); break;
      case 'saveKasbon': result = saveKasbon(payload); break;
      case 'payKasbon': result = payKasbon(payload); break;
      case 'saveExpense': result = saveExpense(payload); break;
      case 'uploadProductImage': result = uploadProductImage(payload); break;
      case 'saveFuel': result = saveFuel(payload); break;
      case 'saveStockLog': result = saveStockLog(payload); break;
      default: result = { status: 'error', message: 'Action tidak dikenal: ' + action };
    }
    return json_(result);
  } catch (err) {
    return json_({ status: 'error', message: String(err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SPREADSHEET_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) {}
  }
  var files = DriveApp.getFilesByName(SPREADSHEET_NAME);
  if (files.hasNext()) {
    var file = files.next();
    props.setProperty('SPREADSHEET_ID', file.getId());
    return SpreadsheetApp.openById(file.getId());
  }
  var ss = SpreadsheetApp.create(SPREADSHEET_NAME);
  props.setProperty('SPREADSHEET_ID', ss.getId());
  ensureSheets_(ss);
  return ss;
}

function ensureSheets_(ss) {
  ensureSheet_(ss, SHEET.PRODUCTS, HEAD.PRODUCTS);
  ensureSheet_(ss, SHEET.SALES, HEAD.SALES);
  ensureSheet_(ss, SHEET.KASBON, HEAD.KASBON);
  ensureSheet_(ss, SHEET.EXPENSES, HEAD.EXPENSES);
  ensureSheet_(ss, SHEET.STOCKLOG, HEAD.STOCKLOG);
  var def = ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1) {
    try { ss.deleteSheet(def); } catch (e) {}
  }
}

function ensureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  var existing = sh.getRange(1, 1, 1, headers.length).getValues()[0];
  if (existing.join('') === '') {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function getSheet_(name, headers) {
  var ss = getSpreadsheet_();
  ensureSheets_(ss);
  return ensureSheet_(ss, name, headers);
}

function getData() {
  return {
    status: 'success',
    products: readProducts_(),
    sales: readSales_(),
    kasbon: readKasbon_(),
    expenses: readExpenses_(),
    stockLog: readStockLog_()
  };
}

function readProducts_() {
  var sh = getSheet_(SHEET.PRODUCTS, HEAD.PRODUCTS);
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    if (!r[0]) continue;
    out.push({
      id: String(r[0]), name: String(r[1] || ''), barcode: String(r[2] || ''),
      category: String(r[3] || 'Sembako'), stock: Number(r[4]) || 0,
      cost: Number(r[5]) || 0, price: Number(r[6]) || 0,
      minStock: Number(r[7]) || 5, image: String(r[8] || '')
    });
  }
  return out;
}

function readSales_() {
  var sh = getSheet_(SHEET.SALES, HEAD.SALES);
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    if (!r[0]) continue;
    out.push({
      id: String(r[0]), time: String(r[1] || ''), itemsSummary: String(r[2] || ''),
      total: Number(r[3]) || 0, costTotal: Number(r[4]) || 0, method: String(r[5] || '')
    });
  }
  return out;
}

function readKasbon_() {
  var sh = getSheet_(SHEET.KASBON, HEAD.KASBON);
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    if (!r[0]) continue;
    out.push({
      id: String(r[0]), customer: String(r[1] || ''), total: Number(r[2]) || 0,
      time: String(r[3] || ''), status: String(r[4] || 'Belum Lunas')
    });
  }
  return out;
}

function readExpenses_() {
  var sh = getSheet_(SHEET.EXPENSES, HEAD.EXPENSES);
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    if (!r[0]) continue;
    out.push({
      id: String(r[0]), date: String(r[1] || ''), category: String(r[2] || ''),
      desc: String(r[3] || ''), amount: Number(r[4]) || 0
    });
  }
  return out;
}

function saveProduct(payload) {
  if (!payload || !payload.name) return { status: 'error', message: 'Nama barang wajib' };
  var sh = getSheet_(SHEET.PRODUCTS, HEAD.PRODUCTS);
  var id = payload.id ? String(payload.id) : '';
  var barcode = String(payload.barcode || '');
  var rowData = [
    id, String(payload.name || ''), barcode,
    String(payload.category || 'Sembako'), Number(payload.stock) || 0,
    Number(payload.cost) || 0, Number(payload.price) || 0,
    payload.minStock != null ? Number(payload.minStock) : 5,
    String(payload.image || '')
  ];
  var values = sh.getDataRange().getValues();
  var foundRow = -1;
  // 1) cari by id
  if (id) {
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][0]) === id) { foundRow = i; break; }
    }
  }
  // 2) fallback: cari by barcode (untuk sinkron BBM / data lama)
  if (foundRow < 0 && barcode) {
    for (var j = 1; j < values.length; j++) {
      if (String(values[j][2] || '') === barcode) {
        foundRow = j;
        // pakai id yang ada di sheet agar konsisten
        if (!id) id = String(values[j][0]);
        rowData[0] = String(values[j][0]);
        id = rowData[0];
        break;
      }
    }
  }
  if (foundRow >= 0) {
    // pastikan kolom id di rowData = id baris tersebut
    rowData[0] = String(values[foundRow][0]);
    if (id) rowData[0] = id;
    // jika payload bawa id khusus (FUEL-PERTALITE), tulis id itu
    if (payload.id) rowData[0] = String(payload.id);
    sh.getRange(foundRow + 1, 1, 1, HEAD.PRODUCTS.length).setValues([rowData]);
    id = rowData[0];
  } else {
    if (!id) id = 'PRD-' + new Date().getTime().toString().slice(-8);
    rowData[0] = id;
    sh.appendRow(rowData);
  }
  return { status: 'success', id: id };
}

function deleteProduct(payload) {
  var id = payload && payload.id ? String(payload.id) : '';
  if (!id) return { status: 'error', message: 'ID kosong' };
  var sh = getSheet_(SHEET.PRODUCTS, HEAD.PRODUCTS);
  var values = sh.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === id) {
      sh.deleteRow(i + 1);
      return { status: 'success' };
    }
  }
  return { status: 'error', message: 'Produk tidak ditemukan' };
}

function saveSale(payload) {
  if (!payload || !payload.sale) return { status: 'error', message: 'Data transaksi kosong' };
  var sale = payload.sale;
  var items = payload.items || [];
  var kasbon = payload.kasbon || null;
  var salesSh = getSheet_(SHEET.SALES, HEAD.SALES);
  var saleId = String(sale.id || ('TRX-' + new Date().getTime().toString().slice(-6)));
  // Idempotent: jika ID sudah ada, anggap sukses (hindari dobel saat retry offline)
  var existing = salesSh.getDataRange().getValues();
  for (var ei = 1; ei < existing.length; ei++) {
    if (String(existing[ei][0]) === saleId) {
      return { status: 'duplicate', id: saleId, message: 'Transaksi sudah tercatat' };
    }
  }
  salesSh.appendRow([
    saleId,
    String(sale.time || ''), String(sale.itemsSummary || ''),
    Number(sale.total) || 0, Number(sale.costTotal) || 0, String(sale.method || '')
  ]);
  if (items.length) {
    var prodSh = getSheet_(SHEET.PRODUCTS, HEAD.PRODUCTS);
    var values = prodSh.getDataRange().getValues();
    var indexById = {};
    for (var i = 1; i < values.length; i++) indexById[String(values[i][0])] = i;
    for (var j = 0; j < items.length; j++) {
      var it = items[j];
      var pid = String(it.id);
      var qty = Number(it.qty) || 0;
      if (!indexById.hasOwnProperty(pid) || qty <= 0) continue;
      var rowIdx = indexById[pid];
      var currentStock = Number(values[rowIdx][4]) || 0;
      var newStock = Math.max(0, currentStock - qty);
      prodSh.getRange(rowIdx + 1, 5).setValue(newStock);
      values[rowIdx][4] = newStock;
    }
  }
  if (kasbon && kasbon.customer) saveKasbon(kasbon);
  return { status: 'success', id: saleId };
}

function saveKasbon(payload) {
  if (!payload || !payload.customer) return { status: 'error', message: 'Nama pelanggan wajib' };
  var sh = getSheet_(SHEET.KASBON, HEAD.KASBON);
  var id = payload.id ? String(payload.id) : ('KSB-' + new Date().getTime().toString().slice(-5));
  // Idempotent: jangan append jika ID sudah ada
  var values = sh.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === id) {
      return { status: 'duplicate', id: id, message: 'Kasbon sudah tercatat' };
    }
  }
  sh.appendRow([id, String(payload.customer || ''), Number(payload.total) || 0, String(payload.time || ''), String(payload.status || 'Belum Lunas')]);
  return { status: 'success', id: id };
}

function payKasbon(payload) {
  var id = payload && payload.id ? String(payload.id) : '';
  if (!id) return { status: 'error', message: 'ID kosong' };
  var sh = getSheet_(SHEET.KASBON, HEAD.KASBON);
  var values = sh.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === id) {
      if (String(values[i][4]) === 'Lunas') {
        return { status: 'duplicate', id: id, message: 'Kasbon sudah lunas' };
      }
      sh.getRange(i + 1, 5).setValue('Lunas');
      return { status: 'success' };
    }
  }
  return { status: 'error', message: 'Kasbon tidak ditemukan' };
}

function saveExpense(payload) {
  if (!payload) return { status: 'error', message: 'Data kosong' };
  var sh = getSheet_(SHEET.EXPENSES, HEAD.EXPENSES);
  var id = payload.id ? String(payload.id) : ('EXP-' + new Date().getTime());
  // Idempotent
  var values = sh.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === id) {
      return { status: 'duplicate', id: id, message: 'Pengeluaran sudah tercatat' };
    }
  }
  sh.appendRow([id, String(payload.date || ''), String(payload.category || ''), String(payload.desc || ''), Number(payload.amount) || 0]);
  return { status: 'success', id: id };
}

function getOrCreatePhotoFolder_() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('PHOTO_FOLDER_ID');
  if (folderId) {
    try { return DriveApp.getFolderById(folderId); } catch (e) {}
  }
  var folders = DriveApp.getFoldersByName(PHOTO_FOLDER_NAME);
  if (folders.hasNext()) {
    var f = folders.next();
    props.setProperty('PHOTO_FOLDER_ID', f.getId());
    return f;
  }
  var created = DriveApp.createFolder(PHOTO_FOLDER_NAME);
  props.setProperty('PHOTO_FOLDER_ID', created.getId());
  return created;
}


/**
 * Simpan / update khusus BBM Pertalite.
 * Selalu pakai id FUEL-PERTALITE & barcode PERTALITE agar lintas perangkat sinkron.
 */
function saveFuel(payload) {
  try {
    var sh = getSheet_(SHEET.PRODUCTS, HEAD.PRODUCTS);
    var id = 'FUEL-PERTALITE';
    var barcode = 'PERTALITE';
    var name = (payload && payload.name) ? String(payload.name) : 'Pertalite';
    var cost = payload && payload.cost != null ? Number(payload.cost) : 0;
    var price = payload && payload.price != null ? Number(payload.price) : 13000;
    var minStock = payload && payload.minStock != null ? Number(payload.minStock) : 10;
    var image = payload && payload.image ? String(payload.image) : '';
    // stockMode: 'set' = tulis stok dari client | 'leave' = pertahankan stok di Sheet
    // Default 'set' untuk kompatibilitas, tapi client penjualan BBM tidak boleh memanggil ini.
    var stockMode = (payload && payload.stockMode) ? String(payload.stockMode) : 'set';
    var stockFromClient = payload && payload.stock != null ? Number(payload.stock) : 0;

    var values = sh.getDataRange().getValues();
    var foundRow = -1;
    var existingStock = 0;

    for (var i = 1; i < values.length; i++) {
      var rid = String(values[i][0] || '');
      var rbc = String(values[i][2] || '').toUpperCase();
      var rcat = String(values[i][3] || '');
      if (rid === id || rbc === 'PERTALITE' || (rcat === 'BBM' && String(values[i][1] || '').toLowerCase().indexOf('pertalite') >= 0)) {
        foundRow = i;
        existingStock = Number(values[i][4]) || 0;
        break;
      }
    }

    var stock = (stockMode === 'leave' && foundRow >= 0) ? existingStock : stockFromClient;
    var rowData = [id, name, barcode, 'BBM', stock, cost, price, minStock, image];

    if (foundRow >= 0) {
      sh.getRange(foundRow + 1, 1, 1, HEAD.PRODUCTS.length).setValues([rowData]);
    } else {
      sh.appendRow(rowData);
    }

    return { status: 'success', id: id, stock: stock, price: price, stockMode: stockMode };
  } catch (err) {
    return { status: 'error', message: String(err) };
  }
}



function readStockLog_() {
  var sh = getSheet_(SHEET.STOCKLOG, HEAD.STOCKLOG);
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var out = [];
  // ambil max 300 baris terakhir
  var start = Math.max(1, values.length - 300);
  for (var i = start; i < values.length; i++) {
    var r = values[i];
    if (!r[0]) continue;
    out.push({
      id: String(r[0]),
      time: String(r[1] || ''),
      productId: String(r[2] || ''),
      productName: String(r[3] || ''),
      type: String(r[4] || ''),
      qtyBefore: Number(r[5]) || 0,
      qtyAfter: Number(r[6]) || 0,
      delta: Number(r[7]) || 0,
      note: String(r[8] || ''),
      refId: String(r[9] || '')
    });
  }
  return out;
}

function saveStockLog(payload) {
  if (!payload) return { status: 'error', message: 'Data log kosong' };
  var sh = getSheet_(SHEET.STOCKLOG, HEAD.STOCKLOG);
  var id = payload.id ? String(payload.id) : ('LOG-' + new Date().getTime());
  // idempotent by id
  var values = sh.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === id) {
      return { status: 'duplicate', id: id };
    }
  }
  sh.appendRow([
    id,
    String(payload.time || ''),
    String(payload.productId || ''),
    String(payload.productName || ''),
    String(payload.type || ''),
    Number(payload.qtyBefore) || 0,
    Number(payload.qtyAfter) || 0,
    Number(payload.delta) || 0,
    String(payload.note || ''),
    String(payload.refId || '')
  ]);
  return { status: 'success', id: id };
}

function uploadProductImage(payload) {
  try {
    if (!payload || !payload.base64) return { status: 'error', message: 'Data gambar kosong' };
    var mimeType = payload.mimeType || 'image/jpeg';
    var fileName = payload.fileName || ('produk_' + new Date().getTime() + '.jpg');
    var raw = Utilities.base64Decode(payload.base64);
    var blob = Utilities.newBlob(raw, mimeType, fileName);
    var folder = getOrCreatePhotoFolder_();
    var file = folder.createFile(blob);
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
    var fileId = file.getId();
    var thumbUrl = 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w1000';
    return {
      status: 'success',
      url: thumbUrl,
      urlAlt: 'https://lh3.googleusercontent.com/d/' + fileId + '=w1000',
      fileId: fileId
    };
  } catch (err) {
    return { status: 'error', message: String(err) };
  }
}

function setupDatabase() {
  var ss = getSpreadsheet_();
  ensureSheets_(ss);
  Logger.log('Spreadsheet: ' + ss.getUrl());
  return ss.getUrl();
}

function testGetData() {
  Logger.log(JSON.stringify(getData()));
}
