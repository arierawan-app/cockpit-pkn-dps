(function () {
  "use strict";

  const sheetId = "1bKnSu28XEAfk55WygUjLLvR0uyZXmOZ6tbMQOzW0DKo";
  const sheetNames = ["Capaian", "K1", "K2", "K3", "IGT", "ActionPlan"];
  const k3ProblemColumnIndex = 10;
  const k3ProblemColumnName = "Permasalahan K3 2025";
  const cachePrefix = "sertifDashboardSheet:";
  const emptyFilterValue = "__EMPTY__";
  let activeK3FilterColumn = "";
  let activeK3FilterSearch = "";

  const state = {
    sheets: {
      Capaian: { headers: [], rows: [] },
      K1: { headers: [], rows: [] },
      K2: { headers: [], rows: [] },
      K3: { headers: [], rows: [] },
      IGT: { headers: [], rows: [] },
      ActionPlan: { headers: [], rows: [] },
    },
    filters: {
      K1: "",
      K2: "",
      K3: "",
      IGT: "",
      ActionPlan: "",
      k3Problem: "",
      k3Columns: {},
    },
  };

  const els = {
    syncDot: document.getElementById("syncDot"),
    lastUpdated: document.getElementById("lastUpdated"),
    errorBox: document.getElementById("errorBox"),
    totalTarget: document.getElementById("totalTarget"),
    totalQ2Consolidation: document.getElementById("totalQ2Consolidation"),
    totalConsolidationPct: document.getElementById("totalConsolidationPct"),
    kpiK1Total: document.getElementById("kpiK1Total"),
    kpiK2Total: document.getElementById("kpiK2Total"),
    kpiK3Total: document.getElementById("kpiK3Total"),
    kpiK1Note: document.getElementById("kpiK1Note"),
    kpiK2Note: document.getElementById("kpiK2Note"),
    kpiK3Note: document.getElementById("kpiK3Note"),
    kpiK1Bar: document.getElementById("kpiK1Bar"),
    kpiK2Bar: document.getElementById("kpiK2Bar"),
    kpiK3Bar: document.getElementById("kpiK3Bar"),
    kpiIgtTotal: document.getElementById("kpiIgtTotal"),
    kpiIgtBar: document.getElementById("kpiIgtBar"),
    kpiIgtNote: document.getElementById("kpiIgtNote"),
    compositionTotal: document.getElementById("compositionTotal"),
    compositionChart: document.getElementById("compositionChart"),
    overviewCount: document.getElementById("overviewCount"),
    overviewTable: document.getElementById("overviewTable"),
    refreshButton: document.getElementById("refreshButton"),
    searchK1: document.getElementById("searchK1"),
    searchK2: document.getElementById("searchK2"),
    searchK3: document.getElementById("searchK3"),
    countK1: document.getElementById("countK1"),
    countK2: document.getElementById("countK2"),
    countK3: document.getElementById("countK3"),
    tableK1: document.getElementById("tableK1"),
    tableK2: document.getElementById("tableK2"),
    tableK3: document.getElementById("tableK3"),
    k3PivotList: document.getElementById("k3PivotList"),
    clearK3Filter: document.getElementById("clearK3Filter"),
    searchIGT: document.getElementById("searchIGT"),
    countIGT: document.getElementById("countIGT"),
    tableIGT: document.getElementById("tableIGT"),
    searchActionPlan: document.getElementById("searchActionPlan"),
    countActionPlan: document.getElementById("countActionPlan"),
    tableActionPlan: document.getElementById("tableActionPlan"),
  };

  function buildUrl(sheetName, callbackName) {
    const base = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq`;
    const params = new URLSearchParams({
      tqx: callbackName ? `out:json;responseHandler:${callbackName}` : "out:json",
      sheet: sheetName,
      cacheBust: String(Date.now()),
    });
    return `${base}?${params.toString()}`;
  }

  async function loadSheet(sheetName) {
    const response = await loadSheetWithFallback(sheetName);
    if (response.status && response.status !== "ok") {
      const detail = (response.errors || []).map((item) => item.detailed_message || item.message).join(" ");
      throw new Error(detail || `Google Sheet ${sheetName} tidak dapat dibaca.`);
    }
    if (!response.table) {
      throw new Error(`Sheet ${sheetName} tidak mengembalikan tabel data.`);
    }
    return normalizeGvizTable(response.table);
  }

  async function loadSheetWithFallback(sheetName) {
    try {
      return await loadSheetWithFetch(sheetName);
    } catch (fetchError) {
      try {
        return await loadSheetWithJsonp(sheetName);
      } catch (jsonpError) {
        throw new Error(
          `Sheet ${sheetName} gagal dimuat. Fetch: ${fetchError.message}. JSONP: ${jsonpError.message}.`
        );
      }
    }
  }

  async function loadSheetWithFetch(sheetName) {
    const response = await fetch(buildUrl(sheetName), { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const text = await response.text();
    const jsonText = extractGvizJson(text);
    return JSON.parse(jsonText);
  }

  function extractGvizJson(text) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end < 0 || end <= start) {
      throw new Error("Format respons Google Sheet tidak dikenali.");
    }
    return text.slice(start, end + 1);
  }

  function loadSheetWithJsonp(sheetName) {
    return new Promise((resolve, reject) => {
      const callbackName = `sertifDashboardCallback_${sheetName}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      const script = document.createElement("script");
      let settled = false;

      function cleanup() {
        settled = true;
        delete window[callbackName];
        script.remove();
      }

      const timeout = window.setTimeout(() => {
        if (settled) return;
        cleanup();
        reject(new Error(`Waktu memuat sheet ${sheetName} habis.`));
      }, 25000);

      window[callbackName] = (payload) => {
        if (settled) return;
        window.clearTimeout(timeout);
        cleanup();
        resolve(payload);
      };

      script.onerror = () => {
        if (settled) return;
        window.clearTimeout(timeout);
        cleanup();
        reject(new Error(`Koneksi ke Google Sheet ${sheetName} gagal.`));
      };

      script.async = true;
      script.src = buildUrl(sheetName, callbackName);
      document.head.appendChild(script);
    });
  }

  function normalizeGvizTable(table) {
    const rawHeaders = (table.cols || []).map((col, index) => cleanHeader(col.label || col.id || `Kolom ${index + 1}`));
    const rawRows = (table.rows || []).map((row) => {
      return (row.c || []).map((cell) => {
        if (!cell) return "";
        if (cell.f !== undefined && cell.f !== null) return String(cell.f).trim();
        if (cell.v === undefined || cell.v === null) return "";
        return String(cell.v).trim();
      });
    });

    let headers = makeUniqueHeaders(rawHeaders);
    let rows = rawRows;

    if (headersNeedRowFallback(headers) && rawRows.length) {
      headers = makeUniqueHeaders(rawRows[0].map((value, index) => cleanHeader(value || `Kolom ${index + 1}`)));
      rows = rawRows.slice(1);
    }

    const width = Math.max(headers.length, ...rows.map((row) => row.length), 0);
    headers = makeUniqueHeaders(Array.from({ length: width }, (_, index) => headers[index] || `Kolom ${index + 1}`));

    const objects = rows
      .map((row) => {
        const item = {};
        headers.forEach((header, index) => {
          item[header] = row[index] || "";
        });
        return item;
      })
      .filter((row) => Object.values(row).some((value) => String(value).trim() !== ""));

    return { headers, rows: objects };
  }

  function normalizeOverviewTable(table) {
    const rawRows = (table.rows || [])
      .map((row) => (row.c || []).map((cell) => formatCellValue(cell)))
      .filter((row) => row.some((value) => cleanHeader(value)));
    const width = Math.max(table.cols ? table.cols.length : 0, ...rawRows.map((row) => row.length), 0);
    const headers = Array.from({ length: width }, (_, index) => columnName(index));
    const rows = rawRows.map((row) => {
      const item = {};
      headers.forEach((header, index) => {
        item[header] = row[index] || "";
      });
      return item;
    });
    return { headers, rows, rawRows };
  }

  function formatCellValue(cell) {
    if (!cell) return "";
    if (cell.f !== undefined && cell.f !== null) return String(cell.f).trim();
    if (cell.v === undefined || cell.v === null) return "";
    return String(cell.v).trim();
  }

  function columnName(index) {
    let value = "";
    let current = index + 1;
    while (current > 0) {
      const remainder = (current - 1) % 26;
      value = String.fromCharCode(65 + remainder) + value;
      current = Math.floor((current - 1) / 26);
    }
    return value;
  }

  function cleanHeader(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function makeUniqueHeaders(headers) {
    const seen = new Map();
    return headers.map((header, index) => {
      const base = cleanHeader(header) || `Kolom ${index + 1}`;
      const count = seen.get(base) || 0;
      seen.set(base, count + 1);
      return count ? `${base} ${count + 1}` : base;
    });
  }

  function headersNeedRowFallback(headers) {
    if (!headers.length) return true;
    return headers.every((header) => /^([A-Z]+|Kolom \d+|[a-z])$/i.test(header));
  }

  async function loadAllData() {
    setStatus("loading", "Memuat Google Sheet...");
    els.errorBox.hidden = true;
    els.errorBox.textContent = "";

    const results = await Promise.all(sheetNames.map((name) => loadSheetSafely(name)));
    const loaded = results.filter((result) => result.data);
    const failed = results.filter((result) => !result.data);
    const fromCache = results.filter((result) => result.source === "cache");

    loaded.forEach((result) => {
      state.sheets[result.name] = result.data;
    });

    if (loaded.length) {
      setStatus("ok", `Terakhir dimuat ${formatDateTime(new Date())}`);
      const importantFailed = failed;
      const importantCache = fromCache;
      if (importantFailed.length || importantCache.length) {
        const notes = [];
        if (importantCache.length) notes.push(`${importantCache.map((item) => item.name).join(", ")} memakai data terakhir tersimpan`);
        if (importantFailed.length) notes.push(`${importantFailed.map((item) => item.name).join(", ")} belum dapat dimuat`);
        showError(`Sebagian data belum live sepenuhnya: ${notes.join("; ")}. Klik Muat ulang untuk mencoba lagi.`);
      }
      renderAll();
      return;
    }

    const firstError = failed[0] && failed[0].error ? ` Detail: ${failed[0].error.message}` : "";
    setStatus("error", "Data belum dapat dimuat");
    showError(
      `Data Google Sheet belum dapat dimuat. Pastikan file sudah dipublish/share publik dan koneksi ke docs.google.com tidak diblokir. Jika masih gagal, coba refresh paksa halaman atau buka melalui server lokal/hosting web.${firstError}`
    );
    console.error(failed.map((result) => ({ sheet: result.name, error: result.error })));
    renderAll();
  }

  async function loadSheetSafely(name) {
    try {
      const data = await loadSheetWithRetry(name, 3);
      if (name !== "Capaian") {
        saveCachedSheet(name, data);
      }
      return { name, data, source: "live" };
    } catch (error) {
      if (name === "Capaian") {
        return { name, data: null, source: "failed", error };
      }
      const cached = loadCachedSheet(name);
      if (cached) {
        return { name, data: cached, source: "cache", error };
      }
      return { name, data: null, source: "failed", error };
    }
  }

  async function loadSheetWithRetry(name, attempts) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await loadSheet(name);
      } catch (error) {
        lastError = error;
        if (attempt < attempts) {
          await wait(600 * attempt);
        }
      }
    }
    throw lastError;
  }

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function saveCachedSheet(name, data) {
    try {
      localStorage.setItem(`${cachePrefix}${name}`, JSON.stringify({ savedAt: Date.now(), data }));
    } catch (error) {
      console.warn(`Cache sheet ${name} tidak dapat disimpan.`, error);
    }
  }

  function loadCachedSheet(name) {
    try {
      const raw = localStorage.getItem(`${cachePrefix}${name}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && parsed.data ? parsed.data : null;
    } catch (error) {
      console.warn(`Cache sheet ${name} tidak dapat dibaca.`, error);
      return null;
    }
  }

  function setStatus(kind, message) {
    els.syncDot.className = `sync-dot ${kind === "ok" ? "ok" : kind === "error" ? "error" : ""}`;
    els.lastUpdated.textContent = message;
  }

  function showError(message) {
    els.errorBox.textContent = message;
    els.errorBox.hidden = false;
  }

  function formatDateTime(date) {
    return new Intl.DateTimeFormat("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  }

  function renderAll() {
    renderKpis();
    renderOverview();
    renderTarget("K1", els.searchK1.value);
    renderTarget("K2", els.searchK2.value);
    renderK3Pivot();
    renderTarget("K3", els.searchK3.value);
    renderTarget("IGT", els.searchIGT.value);
    renderTarget("ActionPlan", els.searchActionPlan.value);
  }

  function renderKpis() {
    const overview = getOverviewCapaianData();
    const summaries = getCapaianSummaries();
    const total = overview ? overview.totalBidang : summaries.reduce((sum, item) => sum + item.total, 0);
    els.totalTarget.textContent = overview ? formatNumber(overview.konsolidasiBidang) : formatNumber(total);
    els.totalQ2Consolidation.textContent = overview ? formatDisplayValue(overview.konsolidasiQ1) : "-";
    els.totalConsolidationPct.textContent = overview ? formatDisplayValue(overview.konsolidasiPct) : "-";
    if (els.compositionTotal) {
      els.compositionTotal.textContent = `${formatNumber(total)} bidang`;
    }

    summaries.forEach((summary) => {
      const totalEl = els[`kpi${summary.name}Total`];
      const noteEl = els[`kpi${summary.name}Note`];
      const barEl = els[`kpi${summary.name}Bar`];
      totalEl.textContent = formatNumber(summary.total);
      noteEl.textContent = summary.note || (summary.total ? `${summary.percent}% dari komposisi capaian` : "Belum ada data");
      barEl.style.width = `${summary.percent}%`;
    });

    renderCompositionChart(summaries, total);
    renderIgtKpi();
  }

  function renderIgtKpi() {
    const data = state.sheets.IGT;
    if (!data.rows.length) {
      els.kpiIgtTotal.textContent = "-";
      els.kpiIgtBar.style.width = "0%";
      els.kpiIgtNote.textContent = "Belum ada data";
      return;
    }

    const pctHeader = data.headers.find(function (h) {
      var lower = h.toLowerCase();
      return lower.includes("%") && lower.includes("capaian");
    });
    const row = data.rows[0];
    const pctValue = pctHeader ? (row[pctHeader] || "") : "";
    els.kpiIgtTotal.textContent = pctValue || "-";

    var numericPct = parseFloat(String(pctValue).replace(/%/g, "").replace(",", ".")) || 0;
    numericPct = Math.min(numericPct, 100);
    els.kpiIgtBar.style.width = numericPct + "%";
    els.kpiIgtNote.textContent = data.rows.length ? data.rows.length + " baris" : "";
  }

  function getCapaianSummaries() {
    const overview = getOverviewCapaianData();
    if (overview) {
      return [
        { name: "K1", total: overview.k1Bidang, percent: overview.totalBidang ? Math.round((overview.k1Bidang / overview.totalBidang) * 100) : 0, note: `${formatNumber(overview.k1Nup)} NUP` },
        { name: "K2", total: overview.k2Bidang, percent: overview.totalBidang ? Math.round((overview.k2Bidang / overview.totalBidang) * 100) : 0, note: `${formatNumber(overview.k2Nup)} NUP` },
        { name: "K3", total: overview.k3Bidang, percent: overview.totalBidang ? Math.round((overview.k3Bidang / overview.totalBidang) * 100) : 0, note: `${formatNumber(overview.k3Nup)} NUP` },
      ];
    }
    return ["K1", "K2", "K3"].map((name) => getTargetSummary(name));
  }

  function getOverviewCapaianData() {
    const data = state.sheets.Capaian;
    const capaianRow = data.rows[0];
    if (capaianRow) {
      const k1NupHeader = findOverviewHeader(data.headers, ["total capaian k1", "nup"]);
      const k1BidangHeader = getNextHeader(data.headers, k1NupHeader);
      const k2NupHeader = findOverviewHeader(data.headers, ["k2 nup"]);
      const k2BidangHeader = getNextHeader(data.headers, k2NupHeader);
      const k3NupHeader = findOverviewHeader(data.headers, ["k3 nup"]);
      const k3BidangHeader = getNextHeader(data.headers, k3NupHeader);
      const k4NupHeader = findOverviewHeader(data.headers, ["k4 nup"]);
      const k4BidangHeader = getNextHeader(data.headers, k4NupHeader);
      const totalHeader = findOverviewHeader(data.headers, ["jumlah komponen a capaian"]);
      const totalPctHeader = getNextHeader(data.headers, totalHeader);
      const konsolidasiHeader = data.headers[14] || findOverviewHeader(data.headers, ["konsolidasi"]);
      const konsolidasiQ2Header = data.headers[15] || getNextHeader(data.headers, konsolidasiHeader);
      const konsolidasiPctHeader = data.headers[16] || getOffsetHeader(data.headers, konsolidasiHeader, 2);

      return {
        row: capaianRow,
        k1Nup: numberFromValue(capaianRow[k1NupHeader]),
        k1Bidang: numberFromValue(capaianRow[k1BidangHeader]),
        k2Nup: numberFromValue(capaianRow[k2NupHeader]),
        k2Bidang: numberFromValue(capaianRow[k2BidangHeader]),
        k3Nup: numberFromValue(capaianRow[k3NupHeader]),
        k3Bidang: numberFromValue(capaianRow[k3BidangHeader]),
        k4Nup: numberFromValue(capaianRow[k4NupHeader]),
        k4Bidang: numberFromValue(capaianRow[k4BidangHeader]),
        totalBidang: numberFromValue(capaianRow[totalHeader]),
        totalQ1: "",
        totalPct: capaianRow[totalPctHeader] || "",
        konsolidasiBidang: numberFromValue(capaianRow[konsolidasiHeader]),
        konsolidasiQ1: capaianRow[konsolidasiQ2Header] || "",
        konsolidasiPct: capaianRow[konsolidasiPctHeader] || "",
      };
    }

    const rawRow = getOverviewDataRow(data.rawRows || []);
    if (rawRow) {
      return {
        row: rawRow,
        k1Nup: numberFromValue(rawRow[25]),
        k1Bidang: numberFromValue(rawRow[26]),
        k2Nup: numberFromValue(rawRow[32]),
        k2Bidang: numberFromValue(rawRow[33]),
        k3Nup: numberFromValue(rawRow[34]),
        k3Bidang: numberFromValue(rawRow[35]),
        k4Nup: numberFromValue(rawRow[36]),
        k4Bidang: numberFromValue(rawRow[37]),
        totalBidang: numberFromValue(rawRow[38]),
        totalQ1: rawRow[39] || "",
        totalPct: rawRow[40] || "",
        hukumBidang: numberFromValue(rawRow[41]),
        hukumQ1: rawRow[42] || "",
        hukumPct: rawRow[43] || "",
        penatausahaanBidang: numberFromValue(rawRow[44]),
        penatausahaanQ1: rawRow[45] || "",
        penatausahaanPct: rawRow[46] || "",
        konsolidasiBidang: numberFromValue(rawRow[47]),
        konsolidasiQ1: rawRow[48] || "",
        konsolidasiPct: rawRow[49] || "",
      };
    }

    const row = getReadableOverviewRows(data.rows)[0];
    if (!row) return null;

    const k1Header = findOverviewHeader(data.headers, ["total capaian k1"]);
    const k2Header = findOverviewHeaderLast(data.headers, ["k2 nup"]);
    const k3Header = findOverviewHeaderLast(data.headers, ["k3 nup"]);
    const k4Header = findOverviewHeaderLast(data.headers, ["k4 nup"]);
    const totalHeader = findOverviewHeader(data.headers, ["jumlah komponen a capaian"]);
    const hukumHeader = findOverviewHeader(data.headers, ["permasalahan hukum"]);
    const penatausahaanHeader = findOverviewHeader(data.headers, ["permasalahan penatausahaan"]);
    const konsolidasiHeader = findOverviewHeader(data.headers, ["konsolidasi"]);

    return {
      row,
      k1Nup: numberFromValue(row[k1Header]),
      k1Bidang: numberFromValue(row[getNextHeader(data.headers, k1Header)]),
      k2Nup: numberFromValue(row[k2Header]),
      k2Bidang: numberFromValue(row[getNextHeader(data.headers, k2Header)]),
      k3Nup: numberFromValue(row[k3Header]),
      k3Bidang: numberFromValue(row[getNextHeader(data.headers, k3Header)]),
      k4Nup: numberFromValue(row[k4Header]),
      k4Bidang: numberFromValue(row[getNextHeader(data.headers, k4Header)]),
      totalBidang: numberFromValue(row[totalHeader]),
      totalQ1: row[getNextHeader(data.headers, totalHeader)] || "",
      totalPct: row[getOffsetHeader(data.headers, totalHeader, 2)] || "",
      hukumBidang: numberFromValue(row[hukumHeader]),
      hukumQ1: row[getNextHeader(data.headers, hukumHeader)] || "",
      hukumPct: row[getOffsetHeader(data.headers, hukumHeader, 2)] || "",
      penatausahaanBidang: numberFromValue(row[penatausahaanHeader]),
      penatausahaanQ1: row[getNextHeader(data.headers, penatausahaanHeader)] || "",
      penatausahaanPct: row[getOffsetHeader(data.headers, penatausahaanHeader, 2)] || "",
      konsolidasiBidang: numberFromValue(row[konsolidasiHeader]),
      konsolidasiQ1: row[getNextHeader(data.headers, konsolidasiHeader)] || "",
      konsolidasiPct: row[getOffsetHeader(data.headers, konsolidasiHeader, 2)] || "",
    };
  }

  function getOverviewDataRow(rows) {
    return rows.find((row) => {
      const firstCell = cleanHeader(row[0]);
      const secondCell = cleanHeader(row[1]);
      const hasSatkerCode = /^\d{4,}$/.test(firstCell);
      const hasOfficeName = secondCell.length > 0;
      return hasSatkerCode && hasOfficeName;
    }) || rows.find((row) => numberFromValue(row[38]) > 0) || null;
  }

  function findOverviewHeader(headers, tokens) {
    const normalizedTokens = tokens.map((token) => token.toLowerCase());
    return headers.find((header) => normalizedTokens.every((token) => header.toLowerCase().includes(token))) || "";
  }

  function findOverviewHeaderLast(headers, tokens) {
    const normalizedTokens = tokens.map((token) => token.toLowerCase());
    return headers.filter((header) => normalizedTokens.every((token) => header.toLowerCase().includes(token))).pop() || "";
  }

  function getNextHeader(headers, header) {
    return getOffsetHeader(headers, header, 1);
  }

  function getOffsetHeader(headers, header, offset) {
    const index = headers.indexOf(header);
    return index >= 0 ? headers[index + offset] || "" : "";
  }

  function numberFromValue(value) {
    const cleaned = String(value || "")
      .replace(/\./g, "")
      .replace(",", ".")
      .replace(/[^\d.-]/g, "");
    return Number(cleaned) || 0;
  }

  function getTargetSummary(name) {
    const rows = state.sheets[name].rows;
    const completed = rows.filter((row) => isCompletedRow(row)).length;
    const total = rows.length;
    return {
      name,
      total,
      completed,
      percent: total ? Math.round((completed / total) * 100) : 0,
    };
  }

  function isCompletedRow(row) {
    const priorityHeaders = Object.keys(row).filter((header) => {
      const normalized = header.toLowerCase();
      return ["status", "capaian", "realisasi", "progress", "progres", "sertifikat"].some((token) =>
        normalized.includes(token)
      );
    });
    const values = (priorityHeaders.length ? priorityHeaders : Object.keys(row)).map((header) => row[header]);
    const joined = values.join(" ").toLowerCase();
    return /(selesai|terbit|bersertifikat|sertifikat terbit|sudah|valid|rampung|100%)/i.test(joined);
  }

  function renderCompositionChart(summaries, total) {
    if (!els.compositionChart) return;
    if (!total) {
      els.compositionChart.innerHTML = '<div class="empty-cell">Komposisi capaian belum tersedia.</div>';
      return;
    }

    els.compositionChart.innerHTML = summaries
      .map((item) => {
        const width = Math.max(3, Math.round((item.total / total) * 100));
        return `
          <div class="bar-row">
            <span class="bar-label">${escapeHtml(item.name)}</span>
            <span class="bar-track"><span class="bar-fill" style="width:${width}%"></span></span>
            <span class="bar-value">${formatNumber(item.total)}</span>
          </div>
        `;
      })
      .join("");
  }

  function renderOverview() {
    const data = state.sheets.Capaian;
    const headers = getInformativeHeaders(data.headers, data.rows).map((header, index) => ({
      key: header,
      label: compactCapaianHeader(header, index),
    }));
    els.overviewCount.textContent = `${formatNumber(data.rows.length)} baris`;
    renderCapaianTable(headers, data.rows);
  }

  function renderCapaianTable(headers, rows) {
    if (!headers.length) {
      els.overviewTable.className = "capaian-table";
      els.overviewTable.innerHTML = '<tbody><tr><td class="empty-cell">Sheet Capaian belum berisi data.</td></tr></tbody>';
      return;
    }

    const colGroupHtml = buildCapaianColGroup(headers.length);
    const groupHeaderHtml = buildCapaianGroupHeader(headers.length);
    const headerHtml = headers.map((header) => `<th scope="col">${escapeHtml(header.label)}</th>`).join("");
    const bodyHtml = rows.length
      ? rows
          .map((row) => {
            const cells = headers.map((header) => `<td>${escapeHtml(row[header.key] || "")}</td>`).join("");
            return `<tr>${cells}</tr>`;
          })
          .join("")
      : `<tr><td class="empty-cell" colspan="${headers.length}">Sheet Capaian belum berisi data.</td></tr>`;

    els.overviewTable.className = "capaian-table";
    els.overviewTable.innerHTML = `${colGroupHtml}<thead>${groupHeaderHtml}<tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody>`;
  }

  function buildCapaianColGroup(columnCount) {
    const columnClasses = [
      "capaian-col-a",
      "capaian-col-a",
      "capaian-col-a",
      "capaian-col-a",
      "capaian-col-a",
      "capaian-col-a",
      "capaian-col-a",
      "capaian-col-a",
      "capaian-col-a-wide",
      "capaian-col-a-percent",
      "capaian-col-b",
      "capaian-col-b-percent",
      "capaian-col-c",
      "capaian-col-c-percent",
      "capaian-col-final",
      "capaian-col-final-percent",
      "capaian-col-final-percent",
    ];
    const cols = Array.from({ length: columnCount }, (_, index) => {
      const className = columnClasses[index] || "capaian-col-default";
      return `<col class="${className}" />`;
    }).join("");
    return `<colgroup>${cols}</colgroup>`;
  }

  function buildCapaianGroupHeader(columnCount) {
    const groups = [
      { label: "Komponen A", span: 10 },
      { label: "Komponen B", span: 2 },
      { label: "Komponen C", span: 2 },
      { label: "Konsolidasi", span: 3 },
    ];

    let remaining = columnCount;
    const cells = groups
      .filter((group) => remaining > 0)
      .map((group) => {
        const span = Math.min(group.span, remaining);
        remaining -= span;
        return `<th scope="colgroup" colspan="${span}">${escapeHtml(group.label)}</th>`;
      })
      .join("");
    return `<tr class="capaian-group-row">${cells}</tr>`;
  }

  function compactCapaianHeader(header, index) {
    const explicitLabels = [
      "K1 NUP",
      "K1 Bidang",
      "K2 NUP",
      "K2 Bidang",
      "K3 NUP",
      "K3 Bidang",
      "K4 NUP",
      "K4 Bidang",
      "Jumlah Capaian",
      "% Capaian",
      "Permasalahan Hukum",
      "% Capaian Hukum",
      "Permasalahan Penatausahaan",
      "% Capaian Penatausahaan",
      "Konsolidasi",
      "% Q2 Konsolidasi",
      "% Konsolidasi",
    ];
    return explicitLabels[index] || cleanHeader(header)
      .replace(/TOTAL CAPAIAN K1 NUP/i, "K1 NUP")
      .replace(/JUMLAH KOMPONEN A Capaian/i, "Jumlah Capaian")
      .replace(/Permasalahan hukum Bidang/i, "Permasalahan Hukum")
      .replace(/Permasalahan Penatausahaan Bidang/i, "Permasalahan Penatausahaan")
      .replace(/Konsolidasi Bidang/i, "Konsolidasi")
      .replace(/\s+/g, " ")
      .trim();
  }

  function renderOverviewSheet(rawRows) {
    if (!rawRows.length) {
      els.overviewTable.className = "overview-data-table overview-sheet-table";
      els.overviewTable.innerHTML = '<tbody><tr><td class="empty-cell">Sheet Overview belum berisi data.</td></tr></tbody>';
      return;
    }

    const width = Math.max(...rawRows.map((row) => row.length), 0);
    const colHeaders = Array.from({ length: width }, (_, index) => `<th scope="col">${columnName(index)}</th>`).join("");
    const bodyHtml = rawRows
      .map((row, rowIndex) => {
        const cells = Array.from({ length: width }, (_, colIndex) => {
          const value = row[colIndex] || "";
          return `<td>${escapeHtml(value)}</td>`;
        }).join("");
        return `<tr class="${getOverviewRowClass(rowIndex, row)}"><th scope="row">${rowIndex + 1}</th>${cells}</tr>`;
      })
      .join("");

    els.overviewTable.className = "overview-data-table overview-sheet-table";
    els.overviewTable.innerHTML = `<thead><tr><th scope="col">#</th>${colHeaders}</tr></thead><tbody>${bodyHtml}</tbody>`;
  }

  function getOverviewRowClass(rowIndex, row) {
    if (rowIndex < 3) return "overview-header-row";
    if (isOverviewIndexRow(row.map((value) => cleanHeader(value)))) return "overview-formula-row";
    if (getOverviewDataRow([row])) return "overview-data-row";
    return "";
  }

  function getReadableOverviewRows(rows) {
    return rows.filter((row) => {
      const values = Object.values(row).map((value) => cleanHeader(value));
      if (!values.some(Boolean)) return false;
      return !isOverviewIndexRow(values);
    });
  }

  function isOverviewIndexRow(values) {
    const filled = values.filter(Boolean);
    if (filled.length < 6) return false;
    const formulaLike = filled.filter((value) => /[=+\-*/]/.test(value));
    if (formulaLike.length >= 2) return true;
    const firstNumbers = filled.slice(0, 8).map((value) => Number(value));
    const looksLikeColumnNumberRow = firstNumbers.length >= 4 && firstNumbers.every((value, index) => value === index + 1);
    return looksLikeColumnNumberRow;
  }

  function getReadableOverviewHeaders(headers, rows) {
    return headers.filter((header) => {
      const cleaned = cleanHeader(header);
      if (!cleaned) return false;
      const hasValue = rows.some((row) => cleanHeader(row[header]));
      if (!hasValue) return false;
      return !/^[A-Z]{2,3}$/.test(cleaned);
    });
  }

  function renderOverviewReadable(headers, rows) {
    if (!rows.length || !headers.length) {
      els.overviewReadable.innerHTML = '<div class="empty-cell">Ringkasan Overview belum tersedia.</div>';
      return;
    }

    const primaryRow = rows[0];
    const groups = buildOverviewGroups(headers, primaryRow);
    els.overviewReadable.innerHTML = groups
      .map((group) => {
        const items = group.items
          .map(
            (item) => `
              <div class="overview-metric">
                <span>${escapeHtml(item.label)}</span>
                <strong>${escapeHtml(item.value || "-")}</strong>
              </div>
            `
          )
          .join("");
        return `
          <section class="overview-group">
            <h3>${escapeHtml(group.title)}</h3>
            <div class="overview-metrics">${items}</div>
          </section>
        `;
      })
      .join("");
  }

  function renderOverviewFromTargetDetails() {
    const summaries = ["K1", "K2", "K3"].map((name) => getTargetSummary(name));
    const total = summaries.reduce((sum, item) => sum + item.total, 0);
    const k3Counts = getK3ProblemCounts();
    const topProblem = k3Counts[0];

    const groups = [
      {
        title: "Ringkasan Detail",
        items: [
          { label: "Total Data K1, K2, K3", value: formatNumber(total) },
          { label: "Data K1", value: formatNumber(summaries[0].total) },
          { label: "Data K2", value: formatNumber(summaries[1].total) },
          { label: "Data K3", value: formatNumber(summaries[2].total) },
        ],
      },
      {
        title: "Fokus K3",
        items: [
          { label: "Jumlah Jenis Permasalahan", value: formatNumber(k3Counts.length) },
          { label: "Permasalahan Terbanyak", value: topProblem ? topProblem[0] : "-" },
          { label: "Jumlah pada Permasalahan Terbanyak", value: topProblem ? formatNumber(topProblem[1]) : "-" },
          { label: "Total Baris K3", value: formatNumber(state.sheets.K3.rows.length) },
        ],
      },
    ];

    els.overviewReadable.innerHTML = groups
      .map((group) => {
        const items = group.items
          .map(
            (item) => `
              <div class="overview-metric">
                <span>${escapeHtml(item.label)}</span>
                <strong>${escapeHtml(item.value || "-")}</strong>
              </div>
            `
          )
          .join("");
        return `
          <section class="overview-group">
            <h3>${escapeHtml(group.title)}</h3>
            <div class="overview-metrics">${items}</div>
          </section>
        `;
      })
      .join("");
  }

  function buildOverviewGroups(headers, row) {
    const data = getOverviewCapaianData();
    if (!data) return [];

    return [
      {
        title: "Capaian Sertifikasi",
        items: [
          { label: "Jumlah Komponen A Capaian", value: formatNumber(data.totalBidang) },
          { label: "Capaian K1", value: `${formatNumber(data.k1Bidang)} bidang / ${formatNumber(data.k1Nup)} NUP` },
          { label: "Capaian K2", value: `${formatNumber(data.k2Bidang)} bidang / ${formatNumber(data.k2Nup)} NUP` },
          { label: "Capaian K3", value: `${formatNumber(data.k3Bidang)} bidang / ${formatNumber(data.k3Nup)} NUP` },
          { label: "Capaian K4", value: `${formatNumber(data.k4Bidang)} bidang / ${formatNumber(data.k4Nup)} NUP` },
        ],
      },
      {
        title: "Persentase Capaian",
        items: [
          { label: "Capaian terhadap Q1", value: data.totalQ1 || "-" },
          { label: "Capaian Total", value: data.totalPct || "-" },
        ],
      },
      {
        title: "Capaian Permasalahan",
        items: [
          { label: "Permasalahan Hukum", value: formatMetricWithPct(data.hukumBidang, data.hukumQ1, data.hukumPct) },
          { label: "Permasalahan Penatausahaan", value: formatMetricWithPct(data.penatausahaanBidang, data.penatausahaanQ1, data.penatausahaanPct) },
          { label: "Konsolidasi", value: formatMetricWithPct(data.konsolidasiBidang, data.konsolidasiQ1, data.konsolidasiPct) },
        ],
      },
    ];
  }

  function formatMetricWithPct(value, q1, pct) {
    const details = [q1, pct].filter(Boolean).join(" / ");
    return details ? `${formatNumber(value)} bidang (${details})` : `${formatNumber(value)} bidang`;
  }

  function collectOverviewGroupItems(headers, row, tokens, used) {
    const items = [];
    headers.forEach((header, index) => {
      if (!tokens.some((token) => header.toLowerCase().includes(token.toLowerCase()))) return;
      used.add(header);
      items.push({ label: compactOverviewLabel(header, index), value: row[header] });

      const nextHeader = headers[index + 1];
      if (nextHeader && !used.has(nextHeader) && isPairOverviewHeader(nextHeader) && row[nextHeader]) {
        used.add(nextHeader);
        items.push({
          label: `${compactOverviewLabel(header, index)} - ${compactOverviewLabel(nextHeader, index + 1)}`,
          value: row[nextHeader],
        });
      }
    });
    return items;
  }

  function isPairOverviewHeader(header) {
    return /^(Bidang|NUP|Luas|%|Q1)/i.test(cleanHeader(header));
  }

  function isGenericOverviewHeader(header) {
    return /^(Bidang|NUP|%|Q1)(\s+\d+)?$/i.test(cleanHeader(header));
  }

  function compactOverviewLabel(header, index) {
    const label = cleanHeader(header)
      .replace(/TARGET SERTIPIKASI BMN & KKKS TA 2026 PADA KANWIL DJKN\/KPKNL\s*/i, "")
      .replace(/PBT\/PRODUK LAINNYA \(K3\)/i, "K3")
      .replace(/UPDATE & VALIDASI DATA \(K4\)/i, "K4")
      .replace(/B\. TARGET PENYELESAIAN /i, "")
      .replace(/C\. TARGET PENYELESAIAN /i, "")
      .replace(/\s+/g, " ")
      .trim();
    return label || `Kolom ${index + 1}`;
  }

  function renderTarget(name, searchTerm) {
    const data = state.sheets[name];
    const headers = name === "ActionPlan" ? data.headers : getInformativeHeaders(data.headers, data.rows);
    let rows = filterRowsBySearch(data.rows, searchTerm);

    if (name === "K3" && state.filters.k3Problem) {
      rows = rows.filter((row) => getK3ProblemValue(row) === state.filters.k3Problem);
    }

    const filterOptions = name === "K3" ? getColumnFilterOptions(headers, rows) : null;
    if (name === "K3") {
      rows = filterRowsByColumnFilters(rows, headers, state.filters.k3Columns);
    }

    renderTable(els[`table${name}`], headers, rows, {
      emptyText: `Tidak ada data ${name} yang sesuai filter.`,
      filterable: name === "K3",
      columnFilters: state.filters.k3Columns,
      filterOptions,
    });
    els[`count${name}`].textContent = `${formatNumber(rows.length)} dari ${formatNumber(data.rows.length)} baris`;
  }

  function getInformativeHeaders(headers, rows) {
    return headers.filter((header) => {
      if (!cleanHeader(header)) return false;
      return rows.some((row) => cleanHeader(row[header]));
    });
  }

  function filterRowsBySearch(rows, searchTerm) {
    const query = String(searchTerm || "").trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => Object.values(row).join(" ").toLowerCase().includes(query));
  }

  function filterRowsByColumnFilters(rows, headers, columnFilters) {
    const activeFilters = getActiveColumnFilters(headers, columnFilters);
    if (!activeFilters.length) return rows;

    return rows.filter((row) => {
      return activeFilters.every(([header, values]) => values.has(getFilterValue(row[header])));
    });
  }

  function getRowsForColumnFilterOptions(column) {
    const data = state.sheets.K3;
    const headers = getInformativeHeaders(data.headers, data.rows);
    let rows = filterRowsBySearch(data.rows, els.searchK3.value);

    if (state.filters.k3Problem) {
      rows = rows.filter((row) => getK3ProblemValue(row) === state.filters.k3Problem);
    }

    const filtersWithoutColumn = getActiveColumnFilters(headers, state.filters.k3Columns, column);
    if (!filtersWithoutColumn.length) return rows;

    return rows.filter((row) => {
      return filtersWithoutColumn.every(([header, values]) => values.has(getFilterValue(row[header])));
    });
  }

  function getActiveColumnFilters(headers, columnFilters, skipHeader = "") {
    const activeFilters = headers
      .filter((header) => header !== skipHeader && hasColumnFilter(columnFilters, header))
      .map((header) => [header, new Set(getColumnFilterValues(columnFilters, header))]);
    return activeFilters;
  }

  function getColumnFilterOptions(headers, rows) {
    const options = {};
    headers.forEach((header) => {
      const values = new Map();
      rows.forEach((row) => {
        const value = getFilterValue(row[header]);
        values.set(value, value === emptyFilterValue ? "Tidak Diisi" : value);
      });
      options[header] = Array.from(values.entries())
        .sort((a, b) => a[1].localeCompare(b[1], "id", { numeric: true, sensitivity: "base" }))
        .map(([value, label]) => ({ value, label }));
    });
    return options;
  }

  function hasColumnFilter(columnFilters, header) {
    return Object.prototype.hasOwnProperty.call(columnFilters, header);
  }

  function getColumnFilterValues(columnFilters, header) {
    const value = columnFilters[header];
    if (Array.isArray(value)) return value;
    if (value) return [value];
    return [];
  }

  function getFilterValue(value) {
    return cleanHeader(value) || emptyFilterValue;
  }

  function renderTable(table, headers, rows, options = {}) {
    if (!headers.length) {
      table.innerHTML = `<tbody><tr><td class="empty-cell">${escapeHtml(options.emptyText || "Belum ada data.")}</td></tr></tbody>`;
      return;
    }

    table.className = options.className || "";
    const headerHtml = headers
      .map((header) => {
        if (!options.filterable) {
          return `<th scope="col">${escapeHtml(header)}</th>`;
        }
        const selectedCount = hasColumnFilter(options.columnFilters || {}, header)
          ? getColumnFilterValues(options.columnFilters, header).length
          : 0;
        const buttonLabel = hasColumnFilter(options.columnFilters || {}, header)
          ? `${formatNumber(selectedCount)} dipilih`
          : "Semua";
        const activeClass = hasColumnFilter(options.columnFilters || {}, header) ? " active" : "";
        const expanded = activeK3FilterColumn === header ? "true" : "false";
        return `
          <th scope="col">
            <span class="column-title">${escapeHtml(header)}</span>
            <button class="column-filter-button${activeClass}" type="button" data-column="${escapeAttribute(header)}" aria-haspopup="dialog" aria-expanded="${expanded}">
              ${escapeHtml(buttonLabel)}
            </button>
          </th>
        `;
      })
      .join("");
    const bodyHtml = rows.length
      ? rows
          .map((row) => {
            const cells = headers.map((header) => `<td>${escapeHtml(row[header] || "")}</td>`).join("");
            return `<tr>${cells}</tr>`;
          })
          .join("")
      : `<tr><td class="empty-cell" colspan="${headers.length}">${escapeHtml(options.emptyText || "Belum ada data.")}</td></tr>`;

    table.innerHTML = `<thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody>`;
  }

  function ensureK3FilterMenu() {
    let menu = document.getElementById("k3FilterMenu");
    if (menu) return menu;

    menu = document.createElement("div");
    menu.id = "k3FilterMenu";
    menu.className = "column-filter-menu";
    menu.hidden = true;
    document.body.appendChild(menu);
    return menu;
  }

  function openK3FilterMenu(column, button) {
    activeK3FilterColumn = column;
    activeK3FilterSearch = "";
    renderK3FilterMenu();
    positionK3FilterMenu(button);
    renderTarget("K3", els.searchK3.value);

    const menu = ensureK3FilterMenu();
    window.setTimeout(() => {
      const search = menu.querySelector(".filter-search");
      if (search) search.focus();
    }, 0);
  }

  function closeK3FilterMenu() {
    activeK3FilterColumn = "";
    activeK3FilterSearch = "";
    ensureK3FilterMenu().hidden = true;
    renderTarget("K3", els.searchK3.value);
  }

  function positionK3FilterMenu(button) {
    const menu = ensureK3FilterMenu();
    const rect = button.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 24);
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const top = Math.min(rect.bottom + 8, window.innerHeight - 120);

    menu.style.width = `${width}px`;
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.maxHeight = `${Math.max(180, window.innerHeight - top - 12)}px`;
  }

  function renderK3FilterMenu() {
    if (!activeK3FilterColumn) return;

    const menu = ensureK3FilterMenu();
    const data = state.sheets.K3;
    const headers = getInformativeHeaders(data.headers, data.rows);
    const rows = getRowsForColumnFilterOptions(activeK3FilterColumn);
    const options = getColumnFilterOptions(headers, rows)[activeK3FilterColumn] || [];
    const hasFilter = hasColumnFilter(state.filters.k3Columns, activeK3FilterColumn);
    const selected = new Set(getColumnFilterValues(state.filters.k3Columns, activeK3FilterColumn));
    const optionHtml = options.length
      ? options
          .map((item) => {
            const checked = !hasFilter || selected.has(item.value) ? " checked" : "";
            return `
              <label class="filter-option" data-filter-label="${escapeAttribute(item.label.toLowerCase())}">
                <input type="checkbox" data-filter-value="${escapeAttribute(item.value)}"${checked} />
                <span>${escapeHtml(item.label)}</span>
              </label>
            `;
          })
          .join("")
      : '<div class="filter-empty">Tidak ada pilihan</div>';

    menu.hidden = false;
    menu.innerHTML = `
      <div class="filter-menu-head">
        <strong>${escapeHtml(activeK3FilterColumn)}</strong>
        <button class="filter-close" type="button" data-filter-action="close" aria-label="Tutup filter">Tutup</button>
      </div>
      <input class="filter-search" type="search" placeholder="Cari" aria-label="Cari pilihan filter ${escapeAttribute(activeK3FilterColumn)}" value="${escapeAttribute(activeK3FilterSearch)}" />
      <div class="filter-menu-actions">
        <button type="button" data-filter-action="all">Semua</button>
        <button type="button" data-filter-action="none">Kosongkan</button>
      </div>
      <div class="filter-option-list">${optionHtml}</div>
    `;
    updateK3FilterMenuSearch();
  }

  function updateK3FilterMenuSearch() {
    const query = activeK3FilterSearch.trim().toLowerCase();
    ensureK3FilterMenu()
      .querySelectorAll(".filter-option")
      .forEach((option) => {
        const label = option.dataset.filterLabel || "";
        option.hidden = Boolean(query) && !label.includes(query);
      });
  }

  function updateK3ColumnFilterValue(value, checked) {
    if (!activeK3FilterColumn) return;

    const data = state.sheets.K3;
    const headers = getInformativeHeaders(data.headers, data.rows);
    const options = getColumnFilterOptions(headers, getRowsForColumnFilterOptions(activeK3FilterColumn))[activeK3FilterColumn] || [];
    const allValues = options.map((item) => item.value);
    const selected = hasColumnFilter(state.filters.k3Columns, activeK3FilterColumn)
      ? new Set(getColumnFilterValues(state.filters.k3Columns, activeK3FilterColumn))
      : new Set(allValues);

    if (checked) {
      selected.add(value);
    } else {
      selected.delete(value);
    }

    if (selected.size === allValues.length) {
      delete state.filters.k3Columns[activeK3FilterColumn];
    } else {
      state.filters.k3Columns[activeK3FilterColumn] = Array.from(selected);
    }

    renderTarget("K3", els.searchK3.value);
    renderK3FilterMenu();
  }

  function renderK3Pivot() {
    const items = getK3ProblemCounts();

    if (!items.length) {
      els.k3PivotList.innerHTML = '<div class="empty-cell">Data K3 belum tersedia.</div>';
      return;
    }

    els.k3PivotList.innerHTML = items
      .map(([problem, count]) => {
        const active = problem === state.filters.k3Problem ? " active" : "";
        return `
          <button class="pivot-item${active}" type="button" data-problem="${escapeAttribute(problem)}" title="${escapeAttribute(problem)}">
            <span class="pivot-name">${escapeHtml(problem)}</span>
            <span class="pivot-count">${formatNumber(count)}</span>
          </button>
        `;
      })
      .join("");
  }

  function getK3ProblemCounts() {
    const counts = new Map();
    state.sheets.K3.rows.forEach((row) => {
      const problem = getK3ProblemValue(row);
      counts.set(problem, (counts.get(problem) || 0) + 1);
    });

    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "id"));
  }

  function getK3ProblemValue(row) {
    const headers = state.sheets.K3.headers;
    const exactHeader = headers.find((header) => header.toLowerCase() === k3ProblemColumnName.toLowerCase());
    const fuzzyHeader = headers.find((header) => {
      const normalized = header.toLowerCase();
      return normalized.includes("permasalahan") && normalized.includes("k3");
    });
    const fallbackHeader = headers[k3ProblemColumnIndex];
    const value = row[exactHeader || fuzzyHeader || fallbackHeader] || "";
    return cleanHeader(value) || "Tidak Diisi";
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("id-ID").format(Number(value) || 0);
  }

  function formatDisplayValue(value) {
    return cleanHeader(value) || "-";
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, "&#096;");
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function bindEvents() {
    document.querySelectorAll(".tab-button").forEach((button) => {
      button.addEventListener("click", () => {
        const tab = button.dataset.tab;
        document.querySelectorAll(".tab-button").forEach((item) => item.classList.toggle("active", item === button));
        document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.remove("active"));
        document.getElementById(`panel-${tab}`).classList.add("active");
      });
    });

    els.refreshButton.addEventListener("click", loadAllData);
    els.searchK1.addEventListener("input", () => renderTarget("K1", els.searchK1.value));
    els.searchK2.addEventListener("input", () => renderTarget("K2", els.searchK2.value));
    els.searchK3.addEventListener("input", () => {
      renderTarget("K3", els.searchK3.value);
      renderK3FilterMenu();
    });
    els.searchIGT.addEventListener("input", () => renderTarget("IGT", els.searchIGT.value));
    els.searchActionPlan.addEventListener("input", () => renderTarget("ActionPlan", els.searchActionPlan.value));
    els.tableK3.addEventListener("click", (event) => {
      const button = event.target.closest(".column-filter-button");
      if (!button) return;
      const column = button.dataset.column;
      if (!column) return;

      if (activeK3FilterColumn === column) {
        closeK3FilterMenu();
      } else {
        openK3FilterMenu(column, button);
      }
    });

    ensureK3FilterMenu().addEventListener("input", (event) => {
      if (!event.target.matches(".filter-search")) return;
      activeK3FilterSearch = event.target.value;
      updateK3FilterMenuSearch();
    });

    ensureK3FilterMenu().addEventListener("change", (event) => {
      const checkbox = event.target.closest("[data-filter-value]");
      if (!checkbox) return;
      updateK3ColumnFilterValue(checkbox.dataset.filterValue, checkbox.checked);
    });

    ensureK3FilterMenu().addEventListener("click", (event) => {
      event.stopPropagation();
      const actionButton = event.target.closest("[data-filter-action]");
      if (!actionButton || !activeK3FilterColumn) return;

      const action = actionButton.dataset.filterAction;
      if (action === "close") {
        closeK3FilterMenu();
        return;
      }
      if (action === "all") {
        delete state.filters.k3Columns[activeK3FilterColumn];
      }
      if (action === "none") {
        state.filters.k3Columns[activeK3FilterColumn] = [];
      }
      renderTarget("K3", els.searchK3.value);
      renderK3FilterMenu();
    });

    document.addEventListener("click", (event) => {
      const menu = ensureK3FilterMenu();
      const clickedFilterButton = event.target.closest(".column-filter-button");
      if (!activeK3FilterColumn || menu.contains(event.target) || clickedFilterButton) return;
      closeK3FilterMenu();
    });

    window.addEventListener("resize", () => {
      if (!activeK3FilterColumn) return;
      const button = els.tableK3.querySelector(`.column-filter-button[data-column="${cssEscape(activeK3FilterColumn)}"]`);
      if (button) positionK3FilterMenu(button);
    });

    els.k3PivotList.addEventListener("click", (event) => {
      const button = event.target.closest(".pivot-item");
      if (!button) return;
      state.filters.k3Problem = button.dataset.problem || "";
      renderK3Pivot();
      renderTarget("K3", els.searchK3.value);
      renderK3FilterMenu();
    });

    els.clearK3Filter.addEventListener("click", () => {
      state.filters.k3Problem = "";
      renderK3Pivot();
      renderTarget("K3", els.searchK3.value);
      renderK3FilterMenu();
    });
  }

  bindEvents();
  loadAllData();
})();
