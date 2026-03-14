import * as cfg from "./config.js?v=2026.03.14.04";
import { supabase } from "./supabaseClient.js?v=2026.03.14.04";

const DEFAULT_CURRENCY = cfg.DEFAULT_CURRENCY || "MXN";
const APP_VERSION = cfg.APP_VERSION || "2026.03.14.04";
const APP_NAME = cfg.APP_NAME || "FST INV";
const APP_LOGO_URL = cfg.APP_LOGO_URL || "./icons/fst-logo.png";

const $root = document.getElementById("root");

const ROUTE_TITLES = {
  login: "Iniciar sesion",
  capture: "Capturar",
  movements: "Movimientos",
  inventory: "Inventario",
  hypothetical: "Hipotetico",
  cutoffs: "Cortes",
  reports: "Reportes",
  settings: "Ajustes",
};

const NAV_ITEMS = [
  { route: "capture", label: "Capturar", icon: "+" },
  { route: "movements", label: "Movimientos", icon: "LOG" },
  { route: "inventory", label: "Inventario", icon: "KG" },
  { route: "hypothetical", label: "Hipotetico", icon: "SIM" },
  { route: "cutoffs", label: "Cortes", icon: "CUT" },
  { route: "reports", label: "Reportes", icon: "REP" },
  { route: "settings", label: "Ajustes", icon: "CFG" },
];
const MOVEMENTS_PAGE_SIZE = 50;
const UI_YIELD_EVERY = 60;
const SUBMIT_PARSE_YIELD_EVERY = 2;
const RESUME_REFRESH_MS = 15000;
const RENDER_DEBOUNCE_MS = 120;
const MASTER_DATA_TTL_MS = 1000 * 60 * 5;
const MAX_PROOF_DIMENSION = 1280;
const PROOF_COMPRESS_QUALITY = 0.82;
const PROOF_COMPRESS_BYTES_THRESHOLD = 1_200_000;
const PROOF_PICKER_RESET_MS = 45_000;
const MOVEMENT_LINES_PREVIEW_LIMIT = 12;
const DEFAULT_PROOF_STAMP_ROWS = 2;
const CAPTURE_DRAFT_AUTOSAVE_MS = 450;
const CAPTURE_DRAFT_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const CAPTURE_DRAFT_SCHEMA_VERSION = 1;

const ROUTE_ACCESS = {
  employee: new Set(["capture"]),
  manager: null,
};

const MOVEMENT_TYPES = {
  entrada: "Entrada",
  venta: "Venta",
  merma: "Merma",
  traspaso_sku: "Traspaso SKU",
  traspaso_calidad: "Traspaso",
  ajuste: "Ajuste",
};

const MOVEMENT_TYPES_BY_ROLE = {
  manager: ["entrada", "venta", "merma", "traspaso_sku", "traspaso_calidad", "ajuste"],
  employee: ["venta", "merma", "traspaso_sku"],
};
const ROUTE_BY_ROLE = {
  manager: null,
  employee: new Set(["capture"]),
};

const state = {
  session: null,
  products: [],
  qualities: [],
  employees: [],
  skus: [],
  masterLoaded: false,
  actor: {
    workspace_id: null,
    role: "manager",
    employee_id: null,
    merma_limit_kg: null,
    allow_all_traspaso_sku: true,
    display_name: null,
  },
  actorLoaded: false,
  captureSubmitting: false,
};

const IS_MOBILE_DEVICE = typeof navigator !== "undefined" && /Mobi|Android|iPhone|iPad|iPod/i.test(String(navigator.userAgent || ""));
let isProofPickerOpen = false;
let proofPickerOpenedAt = 0;
let proofPickerResetTimer = null;
let masterDataLoadedAt = 0;
let renderTimer = null;
let lastRenderCompleteAt = 0;

const lookups = {
  productsById: new Map(),
  qualitiesById: new Map(),
  employeesById: new Map(),
  skusById: new Map(),
};

const STORAGE_KEYS = {
  captureFixedDatetimeLock: "produce_inventory.capture.fixed_datetime_lock",
  captureFixedDatetimeValue: "produce_inventory.capture.fixed_datetime_value",
  captureBatchMode: "produce_inventory.capture.batch_mode",
  captureBatchCloseTime: "produce_inventory.capture.batch_close_time",
  cutoffLineFixedDatetimeLock: "produce_inventory.cutoff_line.fixed_datetime_lock",
  cutoffLineFixedDatetimeValue: "produce_inventory.cutoff_line.fixed_datetime_value",
  cutoffReportIncludeAdjustments: "produce_inventory.cutoff_report.include_adjustments",
  cutoffReportApplyDiscrepancy: "produce_inventory.cutoff_report.apply_discrepancy",
  hypotheticalAdjustments: "produce_inventory.hypothetical.adjustments",
  captureDraft: "produce_inventory.capture.draft.v1",
};
const NETWORK_TIMEOUT_MS = 45000;

function isAppInForeground() {
  const visibility = String(document?.visibilityState || "visible");
  return visibility === "visible" && !document.hidden;
}

function clearProofPickerOpen({ scheduleRender = false } = {}) {
  if (!isProofPickerOpen) {
    proofPickerOpenedAt = 0;
    return;
  }
  isProofPickerOpen = false;
  proofPickerOpenedAt = 0;
  if (proofPickerResetTimer != null) {
    window.clearTimeout(proofPickerResetTimer);
    proofPickerResetTimer = null;
  }
  if (scheduleRender) scheduleSafeRender();
}

function setProofPickerOpen(active, options = {}) {
  if (!active) return clearProofPickerOpen({ scheduleRender: options.scheduleRender ?? renderPending });

  isProofPickerOpen = true;
  proofPickerOpenedAt = Date.now();
  if (proofPickerResetTimer != null) window.clearTimeout(proofPickerResetTimer);
  proofPickerResetTimer = window.setTimeout(() => {
    clearProofPickerOpen({ scheduleRender: renderPending });
  }, PROOF_PICKER_RESET_MS);
}

function reconcileProofPickerState() {
  if (!isProofPickerOpen) return;
  if (!proofPickerOpenedAt) {
    proofPickerOpenedAt = Date.now();
    return;
  }
  if (Date.now() - proofPickerOpenedAt > PROOF_PICKER_RESET_MS) {
    clearProofPickerOpen({ scheduleRender: renderPending });
  }
}

let pageContextCounter = 0;

function isPageContextActive(pageCtx) {
  if (!pageCtx || typeof pageCtx.isActive !== "function") return true;
  return pageCtx.isActive();
}

function createPageContext(routeName) {
  const id = ++pageContextCounter;
  return {
    id,
    routeName,
    isActive() {
      return pageContextCounter === id && route() === routeName && !isAppHidden && isAppInForeground();
    },
  };
}

function route() {
  const raw = (location.hash || "#/").replace(/^#\/?/, "");
  const r = raw.split("?")[0].trim();
  return r || "capture";
}

function actorRole() {
  const role = String(state.actor?.role || "manager").toLowerCase();
  return role === "employee" ? "employee" : "manager";
}

function isManager() {
  return actorRole() === "manager";
}

function currentActorCanAccessRoute(r) {
  const allowed = ROUTE_BY_ROLE[actorRole()];
  if (!allowed) return true;
  return allowed.has(String(r || ""));
}

function currentRouteAllowed(routeName) {
  return currentActorCanAccessRoute(routeName);
}

function movementTypesForActor() {
  return MOVEMENT_TYPES_BY_ROLE[actorRole()] || MOVEMENT_TYPES_BY_ROLE.manager;
}

function hasProofRequirement() {
  return actorRole() === "employee";
}

function actorEmployeeId() {
  const v = String(state.actor?.employee_id || "").trim();
  return v || null;
}

function getActorDisplayName() {
  const v = String(state.actor?.display_name || "").trim();
  return v || null;
}

function normalizeActorRoleError(message) {
  const code = String(message || "").trim();
  if (!code) return "";

  switch (code) {
    case "employee_only_limited_types":
      return "Este usuario solo puede capturar venta, merma o traspaso entre SKUs.";
    case "proof_required_for_employee":
      return "Los empleados deben adjuntar al menos una evidencia para registrar el movimiento.";
    case "traspaso_sku_not_allowed":
      return "No tienes permiso para este traspaso entre SKUs.";
    case "employee_invalid":
      return "Empleado inválido o inactivo.";
    case "only_manager_can_delete_movement":
      return "Solo el gerente puede eliminar movimientos.";
    case "not_authorized":
      return "No estás autorizado para esta acción.";
    default:
      return code;
  }
}

async function ensureActorContextLoaded() {
  if (!state.session || state.actorLoaded) return;
  await loadActorContext();
}

function yieldToUI() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

async function maybeYield(i, every = UI_YIELD_EVERY) {
  if (!Number.isFinite(i) || i <= 0) return;
  if (i % every !== 0) return;
  await yieldToUI();
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("No se pudo leer la imagen."));
    reader.readAsDataURL(file);
  });
}

async function decodeImageForResize(file) {
  // Prefer createImageBitmap for less memory churn than base64 data URLs.
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => {
          if (typeof bitmap.close === "function") bitmap.close();
        },
      };
    } catch {
      // createImageBitmap not available or file not decodable; continue uncompressed.
    }
  }

  return null;
}

function readImageFromDataURL(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("No se pudo decodificar la imagen."));
    img.src = dataUrl;
  });
}

function canvasToBlob(canvas, options) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => resolve(blob), options?.type || "image/jpeg", options?.quality ?? 0.82);
    } catch (e) {
      reject(e);
    }
  });
}

function proofSafeName(name, useJpeg = true) {
  const base = sanitizeFilename(name || "proof");
  if (!useJpeg) return base;
  if (/\.(jpg|jpeg)$/i.test(base)) return base;
  const trimmed = base.replace(/\.[^/.]+$/, "");
  return `${trimmed || "proof"}.jpg`;
}

async function normalizeProofFile(file, { maxDimension = MAX_PROOF_DIMENSION, quality = PROOF_COMPRESS_QUALITY } = {}) {
  const rawType = String(file?.type || "").toLowerCase();
  const rawName = String(file?.name || "");
  const normalizeSupported =
    /^image\/(jpeg|png|webp)$/i.test(rawType) || /\.(jpg|jpeg|png|webp)$/i.test(rawName);

  if (!file || !normalizeSupported) {
    return { file, normalized: false };
  }

  const originalSize = Number(file.size);
  if (IS_MOBILE_DEVICE) {
    return { file, normalized: false, reason: "mobile-no-compress" };
  }
  if (!Number.isFinite(originalSize) || originalSize <= PROOF_COMPRESS_BYTES_THRESHOLD) {
    return { file, normalized: false };
  }

  try {
    const decoded = await decodeImageForResize(file);
    if (!decoded?.source) return { file, normalized: false };
    const source = decoded?.source;
    const sourceW = decoded?.width || 0;
    const sourceH = decoded?.height || 0;
    try {
      if (!Number.isFinite(sourceW) || !Number.isFinite(sourceH) || sourceW <= 0 || sourceH <= 0) {
        return { file, normalized: false };
      }
      const scale = Math.min(1, maxDimension / sourceW, maxDimension / sourceH);
      if (scale >= 1) {
        return { file, normalized: false };
      }
      const targetW = Math.max(1, Math.floor(sourceW * scale));
      const targetH = Math.max(1, Math.floor(sourceH * scale));
      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return { file, normalized: false };
      ctx.drawImage(source, 0, 0, targetW, targetH);
      const blob = await canvasToBlob(canvas, { type: "image/jpeg", quality });
      if (!blob) return { file, normalized: false };
      const normalized = new File([blob], proofSafeName(file.name, true), {
        type: "image/jpeg",
        lastModified: file.lastModified || Date.now(),
      });
      return { file: normalized, normalized: true };
    } finally {
      decoded.release?.();
    }
  } catch (e) {
    return { file, normalized: false, error: e };
  }
}

async function prepareProofFiles(rawFiles, { label = "evidencia", onProgress } = {}) {
  const out = [];
  const files = Array.from(rawFiles || []);
  for (let i = 0; i < files.length; i++) {
    const idx = i + 1;
    onProgress?.(idx, files.length, label);
    await maybeYield(idx, 1);
    const raw = files[i];
    const result = await normalizeProofFile(raw);
    const file = result.file || raw;
    out.push({
      file,
      original_filename: raw?.name || null,
      original_content_type: raw?.type || null,
      upload_size: Number(file?.size),
      normalized: !!result.normalized,
    });
  }
  return out;
}

function navTo(r) {
  if (route() === String(r || "")) return;
  clearProofPickerOpen();
  location.hash = `#/${r}`;
}

function storageGet(key, fallback = "") {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // ignore
  }
}

function storageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function storageGetJson(key, fallback = null) {
  const raw = storageGet(key, null);
  if (raw == null) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (parsed == null) return fallback;
    return parsed;
  } catch {
    return fallback;
  }
}

function normalizeDraftValue(value, fallback = "") {
  const raw = String(value || "").trim();
  return raw || fallback;
}

function loadCaptureDraft() {
  const data = storageGetJson(STORAGE_KEYS.captureDraft, null);
  if (!data || typeof data !== "object") return null;
  if (data.version !== CAPTURE_DRAFT_SCHEMA_VERSION) return null;
  if (!data.timestamp || Date.now() - Number(data.timestamp) > CAPTURE_DRAFT_TTL_MS) {
    storageRemove(STORAGE_KEYS.captureDraft);
    return null;
  }
  return data;
}

function buildCaptureDraft(payload) {
  return {
    version: CAPTURE_DRAFT_SCHEMA_VERSION,
    timestamp: Date.now(),
    payload,
  };
}

async function withTimeout(promise, ms, label) {
  let t = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        t = setTimeout(() => reject(new Error(`${label} excedio el tiempo de espera.`)), ms);
      }),
    ]);
  } finally {
    if (t) clearTimeout(t);
  }
}

function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (v === false || v === null || v === undefined) continue;
    else el.setAttribute(k, String(v));
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child === null || child === undefined) continue;
    if (typeof child === "string") el.appendChild(document.createTextNode(child));
    else el.appendChild(child);
  }
  return el;
}

function fmtKg(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0.000";
  return v.toFixed(3);
}

function fmtMoney(n, currency = DEFAULT_CURRENCY) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(v);
  } catch {
    return `${v.toFixed(2)} ${currency}`;
  }
}

function isoFromLocalInput(dtLocal) {
  // dtLocal: "YYYY-MM-DDTHH:mm"
  const d = new Date(dtLocal);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function localNowInputValue() {
  const d = new Date();
  const pad = (x) => String(x).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function localDatePartFromInput(dtLocal) {
  const v = String(dtLocal || "").trim();
  if (!v) return "";
  const [datePart] = v.split("T");
  return datePart || "";
}

function batchCloseDefaultTime(dtLocal) {
  const datePart = localDatePartFromInput(dtLocal);
  const d = datePart ? new Date(`${datePart}T00:00`) : new Date();
  if (Number.isNaN(d.getTime())) return "16:00";
  // Mon-Sat 16:00, Sunday 11:45.
  return d.getDay() === 0 ? "11:45" : "16:00";
}

function buildBatchOccurredIso(dtLocal, closeTime) {
  const datePart = localDatePartFromInput(dtLocal);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;
  const rawTime = String(closeTime || "").trim();
  const timePart = /^\d{2}:\d{2}$/.test(rawTime) ? rawTime : batchCloseDefaultTime(dtLocal);
  return isoFromLocalInput(`${datePart}T${timePart}`);
}

function localInputValueFromIso(iso) {
  const d = new Date(iso || "");
  if (Number.isNaN(d.getTime())) return "";
  const pad = (x) => String(x).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function formatOccurredAt(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function movementLabel(mt) {
  switch (mt) {
    case "entrada":
      return "Entrada";
    case "venta":
      return "Venta";
    case "merma":
      return "Merma";
    case "traspaso_sku":
      return "Traspaso SKU";
    case "traspaso_calidad":
      return "Traspaso de Calidad";
    case "ajuste":
      return "Ajuste";
    default:
      return mt;
  }
}

function normalizeId(id) {
  return id == null ? "" : String(id);
}

function rebuildLookups() {
  lookups.productsById.clear();
  lookups.qualitiesById.clear();
  lookups.employeesById.clear();
  lookups.skusById.clear();

  for (const p of state.products) lookups.productsById.set(normalizeId(p.id), p);
  for (const q of state.qualities) lookups.qualitiesById.set(normalizeId(q.id), q);
  for (const e of state.employees) lookups.employeesById.set(normalizeId(e.id), e);
  for (const s of state.skus) lookups.skusById.set(normalizeId(s.id), s);
}

function sanitizeFilename(name) {
  return String(name || "proof")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 80);
}

function productName(id) {
  const key = normalizeId(id);
  return lookups.productsById.get(key)?.name ?? "(Producto desconocido)";
}

function qualityName(id) {
  const key = normalizeId(id);
  return lookups.qualitiesById.get(key)?.name ?? "(Calidad desconocida)";
}

function employeeName(id) {
  const key = normalizeId(id);
  return lookups.employeesById.get(key)?.name ?? "(Empleado desconocido)";
}

function skuById(id) {
  const key = normalizeId(id);
  return lookups.skusById.get(key) || null;
}

function skuLabel(id) {
  const s = skuById(id);
  if (!s) return "";
  const code = Number.isFinite(s.code) ? String(s.code) : "";
  return code ? `${code} ${s.name}` : String(s.name || "");
}

async function loadSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  state.session = data.session;
}

async function loadActorContext() {
  if (!state.session) {
    state.actor = {
      workspace_id: null,
      role: "manager",
      employee_id: null,
      merma_limit_kg: null,
      allow_all_traspaso_sku: true,
      display_name: null,
    };
    state.actorLoaded = true;
    return;
  }

  state.actorLoaded = false;
  try {
    const { data, error } = await withTimeout(supabase.rpc("get_actor_context"), 7000, "Cargando permisos");
    if (error) throw error;

    const actor = {
      workspace_id: data?.workspace_id || null,
      role: String(data?.role || "manager").toLowerCase() === "employee" ? "employee" : "manager",
      employee_id: data?.employee_id || null,
      merma_limit_kg: data?.merma_limit_kg ?? null,
      allow_all_traspaso_sku: data?.allow_all_traspaso_sku !== false,
      display_name: data?.display_name || null,
    };
    state.actor = actor;
  } catch {
    // Backward compatibility: if this DB does not yet support actor context,
    // keep manager mode to avoid blocking old projects.
    state.actor = {
      workspace_id: null,
      role: "manager",
      employee_id: null,
      merma_limit_kg: null,
      allow_all_traspaso_sku: true,
      display_name: null,
    };
  } finally {
    state.actorLoaded = true;
  }
}

async function loadMasterData() {
  if (!state.session) return;

  const [
    { data: products, error: pErr },
    { data: qualities, error: qErr },
    { data: employees, error: eErr },
    { data: skus, error: sErr },
  ] = await Promise.all([
    supabase.from("products").select("id,name,is_active,updated_at").order("name"),
    supabase.from("qualities").select("id,name,sort_order,is_active,updated_at").order("sort_order").order("name"),
    supabase.from("employees").select("id,name,is_active,updated_at").order("name"),
    supabase
      .from("skus")
      .select("id,code,name,product_id,quality_id,default_price_model,is_active,updated_at")
      .order("code"),
  ]);
  if (pErr) throw pErr;
  if (qErr) throw qErr;
  if (eErr) throw eErr;
  if (sErr) throw sErr;

  state.products = (products || []).map((p) => ({
    ...p,
    name: String(p.name),
  }));
  state.qualities = (qualities || []).map((q) => ({
    ...q,
    name: String(q.name),
  }));
  state.employees = (employees || []).map((e) => ({
    ...e,
    name: String(e.name),
  }));
  state.skus = (skus || []).map((s) => ({
    ...s,
    code: Number(s.code),
    name: String(s.name),
  }));
  rebuildLookups();
  state.masterLoaded = true;
  masterDataLoadedAt = Date.now();
}

function layout(pageTitle, contentEl, { showNav } = { showNav: true }) {
  const app = h("div", { class: "app" });

  function blurActiveElement() {
    try {
      const el = document.activeElement;
      if (el && typeof el.blur === "function") el.blur();
    } catch {
      // ignore
    }
  }

  const topbar = h("div", { class: "topbar" }, [
    h("div", { class: "topbar-inner" }, [
      h("div", { class: "brand-block" }, [
        h("img", {
          class: "topbar-logo",
          src: APP_LOGO_URL,
          alt: `${APP_NAME} logo`,
        }),
        h("div", { class: "brand" }, [
          h("div", { class: "brand-title", text: APP_NAME }),
          h("div", { class: "brand-sub", text: pageTitle }),
        ]),
      ]),
      h("div", { class: "topbar-meta right" }, [
        state.session ? h("div", { class: "brand-sub mono", text: state.session.user.email || "" }) : h("div", { class: "brand-sub", text: "" }),
        h("div", { class: "app-version mono", text: `Build ${APP_VERSION}` }),
      ]),
    ]),
  ]);

  const content = h("div", { class: "content" }, [contentEl]);

  app.appendChild(topbar);
  app.appendChild(content);

  if (showNav && state.session) {
    const navItems = NAV_ITEMS.filter((it) => currentRouteAllowed(it.route));
    const r = route();
      const nav = h("div", { class: "bottomnav" }, [
        h(
          "div",
          { class: "bottomnav-inner" },
        navItems.map((it) =>
          h(
            "a",
            {
              class: "navbtn",
              href: `#/${it.route}`,
              "aria-current": it.route === r ? "page" : null,
              // Mobile reliability: blur any focused input (closes keyboard) so taps
              // on the nav always navigate on the first try.
              onpointerdown: () => blurActiveElement(),
              onclick: (e) => {
                e.preventDefault();
                blurActiveElement();
                cleanupStuckBackdrops();
                navTo(it.route);
              },
            },
            [h("div", { class: "icon", text: it.icon }), h("div", { class: "label", text: it.label })]
          )
        )
      ),
    ]);
    app.appendChild(nav);
  }

  $root.replaceChildren(app);
}

function notice(kind, text) {
  return h("div", { class: `notice ${kind || ""}` }, [h("div", { text })]);
}

function field(labelText, inputEl) {
  return h("div", {}, [h("label", { text: labelText }), inputEl]);
}

function tableScroll(tableEl) {
  return h("div", { style: "overflow-x:auto; -webkit-overflow-scrolling: touch" }, [tableEl]);
}

function cleanupStuckBackdrops() {
  for (const el of document.querySelectorAll(".modal-backdrop")) el.remove();
}

function optionList(items, { includeEmpty = true, emptyLabel = "Select..." } = {}) {
  const opts = [];
  if (includeEmpty) opts.push(h("option", { value: "", text: emptyLabel }));
  for (const it of items) {
    opts.push(h("option", { value: it.id, text: it.name }));
  }
  return opts;
}

async function pageLogin() {
  const email = h("input", { type: "email", placeholder: "Email" });
  const password = h("input", { type: "password", placeholder: "Password" });
  const msg = h("div");

  const submit = h(
    "button",
    {
      class: "btn btn-primary",
      onclick: async () => {
        msg.replaceChildren();
        const e = String(email.value || "").trim();
        const p = String(password.value || "");
        if (!e || !p) {
          msg.appendChild(notice("warn", "Ingresa tu email y password."));
          return;
        }
        const { error } = await supabase.auth.signInWithPassword({ email: e, password: p });
        if (error) {
          msg.appendChild(notice("error", error.message));
          if (String(error.message || "").toLowerCase().includes("invalid api key")) {
            msg.appendChild(
              notice(
                "warn",
                "Esto casi siempre significa que tu SUPABASE_URL y SUPABASE_ANON_KEY no corresponden al mismo proyecto, o que el key tiene espacios/saltos de linea. Re-copia ambos desde Supabase: Project Settings -> API (Project URL + anon public key)."
              )
            );
          }
          return;
        }
        navTo("capture");
      },
    },
    ["Iniciar sesion"]
  );

  const card = h("div", { class: "card col" }, [
    h("div", { class: "h1", text: "Iniciar sesion" }),
    h("div", { class: "muted", text: "Usa tu usuario de Supabase Auth (email/password)." }),
    msg,
    field("Email", email),
    field("Password", password),
    h("div", { class: "row-wrap" }, [submit]),
  ]);

  layout(ROUTE_TITLES.login, card, { showNav: false });
}

function movementTypePills({ onChange, allowed = movementTypesForActor(), initial }) {
  const allowedIds = Array.isArray(allowed) ? [...allowed] : movementTypesForActor();
  const starting = String(initial || "").trim();
  const allowedSet = new Set(allowedIds);
  const types = [
    { id: "entrada", label: "Entrada", role: "manager" },
    { id: "venta", label: "Venta", role: "any" },
    { id: "merma", label: "Merma", role: "any" },
    { id: "traspaso_sku", label: "Traspaso SKU", role: "any" },
    { id: "traspaso_calidad", label: "Traspaso", role: "manager" },
    { id: "ajuste", label: "Ajuste", role: "manager" },
  ].filter((t) => allowedSet.has(t.id));

  let current = starting ? starting : (types[0]?.id || "venta");
  if (!allowedSet.has(current)) current = types[0]?.id || "venta";

  const pills = types.map((t) =>
    h(
      "button",
      {
        class: "pill",
        type: "button",
        "aria-pressed": t.id === current ? "true" : "false",
        onclick: () => {
          current = t.id;
          for (const p of pills) p.setAttribute("aria-pressed", "false");
          pills.find((p) => p.textContent === t.label)?.setAttribute("aria-pressed", "true");
          onChange?.(current);
        },
      },
      [t.label]
    )
  );

  return { el: h("div", { class: "pillbar" }, pills), get: () => current };
}

function buildLineRow({ products, qualities, skus, mode, onRemove }) {
  let currentMode = mode;
  const skuSel = h(
    "select",
    {},
    [
      h("option", { value: "", text: "SKU (opcional)..." }),
      ...(skus || []).map((s) =>
        h("option", { value: s.id, text: `${Number(s.code)} ${String(s.name)}` })
      ),
    ]
  );

  const productSel = h("select", {}, optionList(products, { includeEmpty: true, emptyLabel: "Producto..." }));
  const qualitySel = h("select", {}, optionList(qualities, { includeEmpty: true, emptyLabel: "Calidad..." }));
  const weight = h("input", { type: "number", step: "0.001", min: "0", placeholder: "kg" });

  const boxes = h("input", { type: "number", step: "1", min: "0", placeholder: "cajas" });
  const priceModel = h(
    "select",
    {},
    [
      h("option", { value: "", text: "Modelo de precio..." }),
      h("option", { value: "per_kg", text: "Por kg" }),
      h("option", { value: "per_box", text: "Por caja" }),
    ]
  );
  const unitPrice = h("input", { type: "number", step: "0.01", min: "0", placeholder: "precio unitario" });
  const total = h("div", { class: "muted right mono", text: "" });

  skuSel.addEventListener("change", () => {
    const id = String(skuSel.value || "");
    const s = (skus || []).find((x) => x.id === id);
    if (!s) return;
    productSel.value = String(s.product_id || "");
    qualitySel.value = String(s.quality_id || "");
    if (currentMode === "venta" && s.default_price_model) {
      priceModel.value = String(s.default_price_model);
      recalc();
    }
  });

  function recalc() {
    if (currentMode !== "venta") {
      total.textContent = "";
      return;
    }
    const pm = String(priceModel.value || "");
    const w = Number(weight.value);
    const b = Number(boxes.value);
    const up = Number(unitPrice.value);
    if (!pm || !Number.isFinite(up) || up < 0) {
      total.textContent = "";
      return;
    }
    if (pm === "per_kg" && Number.isFinite(w) && w > 0) {
      total.textContent = `Total: ${fmtMoney(w * up)}`;
      return;
    }
    if (pm === "per_box" && Number.isFinite(b) && b > 0) {
      total.textContent = `Total: ${fmtMoney(b * up)}`;
      return;
    }
    total.textContent = "";
  }

  weight.addEventListener("input", recalc);
  boxes.addEventListener("input", recalc);
  priceModel.addEventListener("change", recalc);
  unitPrice.addEventListener("input", recalc);

  const removeBtn = h(
    "button",
    {
      class: "btn btn-ghost",
      type: "button",
      onclick: () => onRemove?.(),
      title: "Eliminar linea",
    },
    ["Eliminar"]
  );

  const row = h("div", { class: "card col" }, [
    h("div", {}, [field("SKU (opcional)", skuSel)]),
    h("div", { class: "row-wrap" }, [
      h("div", { style: "flex: 1; min-width: 200px" }, [field("Producto", productSel)]),
      mode === "traspaso_calidad"
        ? h("div", { style: "display:none" })
        : h("div", { style: "flex: 1; min-width: 180px" }, [field("Calidad", qualitySel)]),
      h("div", { style: "flex: 1; min-width: 140px" }, [field("Peso (kg)", weight)]),
    ]),
    mode === "venta"
      ? h("div", { class: "grid3" }, [
          field("Modelo", priceModel),
          field("Cajas (opcional)", boxes),
          field("Precio unitario", unitPrice),
        ])
      : h("div", { style: "display:none" }),
    mode === "venta" ? h("div", { class: "row" }, [h("div", { class: "spacer" }), total]) : null,
    h("div", { class: "row-wrap" }, [h("div", { class: "spacer" }), removeBtn]),
  ]);

  function get() {
    return {
      sku_id: String(skuSel.value || ""),
      product_id: String(productSel.value || ""),
      quality_id: String(qualitySel.value || ""),
      weight_kg: String(weight.value || ""),
      boxes: String(boxes.value || ""),
      price_model: String(priceModel.value || ""),
      unit_price: String(unitPrice.value || ""),
    };
  }

  function setValues(values = {}) {
    if (values == null || typeof values !== "object") return;
    skuSel.value = String(values.sku_id || "");
    productSel.value = String(values.product_id || "");
    qualitySel.value = String(values.quality_id || "");
    weight.value = String(values.weight_kg != null ? values.weight_kg : "");
    boxes.value = String(values.boxes != null ? values.boxes : "");
    priceModel.value = String(values.price_model || "");
    unitPrice.value = String(values.unit_price != null ? values.unit_price : "");
    recalc();
  }

  function setVisibilityForMode(nextMode) {
    currentMode = nextMode;
    row.querySelectorAll(".grid3").forEach((el) => (el.style.display = nextMode === "venta" ? "" : "none"));
    row.querySelectorAll(".right").forEach((el) => (el.style.display = nextMode === "venta" ? "" : "none"));

	    // Hide quality selector for traspasos (direction comes from movement-level fields).
	    if (nextMode === "traspaso_calidad") {
	      skuSel.value = "";
	      skuSel.closest("div").style.display = "none";
	      productSel.closest("div").style.display = "";
	      qualitySel.value = "";
	      qualitySel.closest("div").style.display = "none";
	      productSel.disabled = false;
	      qualitySel.disabled = false;
	    } else if (nextMode === "traspaso_sku") {
	      // Direction comes from movement-level from/to SKU.
	      skuSel.value = "";
	      skuSel.closest("div").style.display = "none";
	      productSel.closest("div").style.display = "none";
	      qualitySel.closest("div").style.display = "none";
	      productSel.disabled = true;
	      qualitySel.disabled = true;
	    } else {
	      skuSel.closest("div").style.display = "";
	      productSel.closest("div").style.display = "";
	      qualitySel.closest("div").style.display = "";
	      productSel.disabled = false;
	      qualitySel.disabled = false;
	    }
    if (nextMode !== "venta") {
      priceModel.value = "";
      boxes.value = "";
      unitPrice.value = "";
      total.textContent = "";
    } else {
      const id = String(skuSel.value || "");
      const s = (skus || []).find((x) => x.id === id);
      if (s && s.default_price_model && !priceModel.value) {
        priceModel.value = String(s.default_price_model);
      }
      recalc();
    }
    if (nextMode !== "traspaso_calidad" && !qualitySel.value && qualities.length === 1) {
      qualitySel.value = qualities[0].id;
    }
  }

  function setProductQuality(productId, qualityId, { lock } = {}) {
    if (productId) productSel.value = String(productId);
    if (qualityId) qualitySel.value = String(qualityId);
    if (lock != null) {
      productSel.disabled = !!lock;
      qualitySel.disabled = !!lock;
    }
  }

  return { el: row, get, setMode: setVisibilityForMode, setProductQuality, setValues };
}

function buildMovementLinePreviewItems(lines, movementType, currency, maxLines = MOVEMENT_LINES_PREVIEW_LIMIT) {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  const safeMax = Number.isFinite(maxLines) && maxLines > 0 ? Math.floor(maxLines) : 0;
  const visibleCount = safeMax > 0 ? Math.min(lines.length, safeMax) : lines.length;
  const nodes = [];

  for (let i = 0; i < visibleCount; i++) {
    const l = lines[i];
    const skuText = skuLabel(l.sku_id) || `${productName(l.product_id)} | ${qualityName(l.quality_id)}`;
    const d = Number(l.delta_weight_kg || 0);
    const kg = `${d >= 0 ? "+" : "-"}${fmtKg(Math.abs(d))} kg`;
    const pieces = [kg];
    if (l.boxes != null) pieces.push(`${Number(l.boxes || 0)} cajas`);
    if (movementType === "venta" && l.line_total != null) {
      pieces.push(fmtMoney(Number(l.line_total || 0), currency || DEFAULT_CURRENCY));
    }
    nodes.push(
      h("div", { class: "movement-line-item" }, [
        h("div", { class: "mono movement-line-sku", text: skuText }),
        h("div", { class: "spacer" }),
        h("div", { class: "mono movement-line-qty", text: pieces.join(" | ") }),
      ])
    );
  }

  const remaining = lines.length - visibleCount;
  if (remaining > 0) {
    nodes.push(
      h("div", { class: "movement-line-item muted", text: `+ ${remaining} registro(s) más — abre Ver` })
    );
  }

  return h("div", { class: "movement-lines-preview col" }, nodes);
}

async function pageCapture(pageCtx) {
  const products = state.products.filter((p) => p.is_active);
  const qualities = state.qualities.filter((q) => q.is_active).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const skus = state.skus.filter((s) => s.is_active).sort((a, b) => (a.code || 0) - (b.code || 0));
  const employees = state.employees.filter((e) => e.is_active).sort((a, b) => String(a.name).localeCompare(String(b.name)));

  const msg = h("div");

  if (products.length === 0 || qualities.length === 0) {
    const card = h("div", { class: "card col" }, [
      h("div", { class: "h1", text: "Configuracion inicial" }),
      notice("warn", "Ve a Ajustes y usa 'Cargar SKUs base' (recomendado) o crea al menos 1 Producto y 1 Calidad."),
      h("div", { class: "row-wrap" }, [
        h(
          "a",
          { class: "btn btn-primary", href: "#/settings" },
          ["Ir a Ajustes"]
        ),
      ]),
    ]);
    layout(ROUTE_TITLES.capture, card);
    return;
  }

  const fixedDtLockOn = storageGet(STORAGE_KEYS.captureFixedDatetimeLock, "0") === "1";
  const fixedDtSaved = storageGet(STORAGE_KEYS.captureFixedDatetimeValue, "");
  const occurredAt = h("input", {
    type: "datetime-local",
    value: fixedDtLockOn && fixedDtSaved ? fixedDtSaved : localNowInputValue(),
  });
  const lockOccurredAt = h("input", { type: "checkbox" });
  lockOccurredAt.checked = fixedDtLockOn;
  const aggregateMode = h("input", { type: "checkbox" });
  aggregateMode.checked = storageGet(STORAGE_KEYS.captureBatchMode, "0") === "1";
  const aggregateCloseTime = h("input", {
    type: "time",
    value: storageGet(STORAGE_KEYS.captureBatchCloseTime, batchCloseDefaultTime(occurredAt.value)),
  });
  const batchClosePresetWrap = h("div", { class: "col" });
  const batchClosePresetButtons = [];
function setBatchClosePresetState(value) {
    const normalized = String(value || "").trim();
    for (const btn of batchClosePresetButtons) {
      const preset = String(btn.dataset.preset || "").trim();
      const active = preset && preset === normalized;
      btn.setAttribute("aria-pressed", active ? "true" : "false");
      btn.classList.toggle("preset-active", active);
    }
  }
  function setAggregateCloseTime(value, manualOverride = true) {
    aggregateCloseTime.value = String(value || "").trim();
    aggregateCloseTimeEdited = manualOverride;
    storageSet(STORAGE_KEYS.captureBatchCloseTime, String(aggregateCloseTime.value || ""));
    setBatchClosePresetState(aggregateCloseTime.value);
    queueDraftSave();
  }
  const batchClosePreset16 = h(
    "button",
    {
      class: "btn btn-ghost",
      "data-preset": "16:00",
      type: "button",
      onclick: () => setAggregateCloseTime("16:00"),
    },
    ["16:00"]
  );
  batchClosePresetButtons.push(batchClosePreset16);
  const batchClosePreset1145 = h(
    "button",
    {
      class: "btn btn-ghost",
      "data-preset": "11:45",
      type: "button",
      onclick: () => setAggregateCloseTime("11:45"),
    },
    ["11:45"]
  );
  batchClosePresetButtons.push(batchClosePreset1145);
  const batchClosePresetTodayDefault = h(
    "button",
    {
      class: "btn btn-ghost",
      "data-preset": batchCloseDefaultTime(occurredAt.value),
      type: "button",
      onclick: () => setAggregateCloseTime(batchCloseDefaultTime(occurredAt.value), false),
    },
    ["Sugerida"]
  );
  batchClosePresetButtons.push(batchClosePresetTodayDefault);
  batchClosePresetWrap.append(
    h("div", { class: "muted", text: "Atajos de hora de cierre" }),
    h("div", { class: "row-wrap", style: "margin-top: 6px" }, [batchClosePreset16, batchClosePreset1145, batchClosePresetTodayDefault])
  );
  const aggregateNoCutoff = h("input", { type: "checkbox" });
  const aggregateNoCutoffRow = h(
    "label",
    { class: "muted", style: "display:flex; align-items:center; gap:8px; margin-top:-2px" },
    [aggregateNoCutoff, h("span", { text: "Confirmo que este movimiento agregado NO incluye periodo de corte físico." })]
  );
  const batchCloseWrap = h("div", { class: "col" }, [field("Hora de cierre", aggregateCloseTime), batchClosePresetWrap]);
  const batchHint = h("div", { class: "muted" }, [
    "En modo agregado: se registra como un bloque y se marca con [AGREGADO] para rastrear que fue captura consolidada.",
  ]);
  const notes = h("textarea", { placeholder: "Notas (opcional). Ej: cliente, contexto..." });
  const currency = h("input", { type: "text", value: DEFAULT_CURRENCY, placeholder: "Moneda (MXN)" });
  const reportedBy = h("select", {}, optionList(employees, { includeEmpty: true, emptyLabel: "(Opcional)..." }));
  const autoEmpId = actorEmployeeId();
  const actorRequiresEmployee = hasProofRequirement();
  const isActorManager = isManager();
  if (autoEmpId) {
    reportedBy.value = autoEmpId;
    if (!isActorManager) {
      reportedBy.setAttribute("disabled", "true");
    }
  }
  const reportedByField = isActorManager
    ? field("Empleado", reportedBy)
    : [field("Empleado", h("div", { class: "muted", text: getActorDisplayName() || "Empleado asociado" }))];

  const fromQuality = h("select", {}, optionList(qualities, { includeEmpty: true, emptyLabel: "De calidad..." }));
  const toQuality = h("select", {}, optionList(qualities, { includeEmpty: true, emptyLabel: "A calidad..." }));

  const fromSku = h(
    "select",
    {},
    [
      h("option", { value: "", text: "De SKU..." }),
      ...skus.map((s) => h("option", { value: s.id, text: `${Number(s.code)} ${String(s.name)}` })),
    ]
  );
  const toSku = h(
    "select",
    {},
    [
      h("option", { value: "", text: "A SKU..." }),
      ...skus.map((s) => h("option", { value: s.id, text: `${Number(s.code)} ${String(s.name)}` })),
    ]
  );

  const adjustDir = h(
    "select",
    {},
    [
      h("option", { value: "decrease", text: "Disminuir (-kg)" }),
      h("option", { value: "increase", text: "Aumentar (+kg)" }),
    ]
  );

  const proofs = h("input", { type: "file", accept: "image/*", multiple: "multiple" });
  proofs.addEventListener("pointerdown", () => {
    setProofPickerOpen(true);
  });
  proofs.addEventListener("touchstart", () => {
    setProofPickerOpen(true);
  });
  proofs.addEventListener("click", () => {
    setProofPickerOpen(true);
  });
  proofs.addEventListener("focus", () => {
    setProofPickerOpen(true);
  });
  proofs.addEventListener("blur", () => {
    setProofPickerOpen(false);
  });
  proofs.addEventListener("change", () => {
    setProofPickerOpen(false);
    queueDraftSave();
  });
  proofs.addEventListener("cancel", () => {
    setProofPickerOpen(false);
  });

  if (!isActorManager) {
    proofs.setAttribute("capture", "environment");
  }
  const proofsHint = h("div", { class: "muted" }, [
    actorRequiresEmployee
      ? "Evidencia obligatoria (empleado): toma la foto del movimiento antes de guardar."
      : "Evidencia (opcional): foto(s) de WhatsApp o captura de pantalla.",
  ]);

  const availableMovementTypes = movementTypesForActor();
  const pills = movementTypePills({
    allowed: availableMovementTypes,
    initial: availableMovementTypes[0] || "venta",
    onChange: (mt) => updateMode(mt),
  });

  let currentMode = pills.get();
  const linesWrap = h("div", { class: "col" });
  const lineRows = [];
  let draftRestoreInProgress = false;
  let draftSaveTimer = null;
  const MAX_DRAFT_LINES = 200;

  function queueDraftSave() {
    if (state.captureSubmitting || isProofPickerOpen) return;
    if (draftRestoreInProgress) return;
    if (draftSaveTimer) window.clearTimeout(draftSaveTimer);
    draftSaveTimer = window.setTimeout(() => {
      draftSaveTimer = null;
      const draftLines = lineRows.length > MAX_DRAFT_LINES ? lineRows.slice(0, MAX_DRAFT_LINES) : lineRows;
      const payload = {
        movementType: currentMode,
        occurredAt: normalizeDraftValue(occurredAt.value, localNowInputValue()),
        lockOccurredAt: !!lockOccurredAt.checked,
        aggregateMode: !!aggregateMode.checked,
        aggregateCloseTime: normalizeDraftValue(aggregateCloseTime.value),
        notes: normalizeDraftValue(notes.value),
        currency: normalizeDraftValue(currency.value, DEFAULT_CURRENCY) || DEFAULT_CURRENCY,
        fromQuality: normalizeDraftValue(fromQuality.value),
        toQuality: normalizeDraftValue(toQuality.value),
        fromSku: normalizeDraftValue(fromSku.value),
        toSku: normalizeDraftValue(toSku.value),
        adjustDir: normalizeDraftValue(adjustDir.value, "decrease"),
        aggregateNoCutoff: !!aggregateNoCutoff.checked,
        lines: draftLines.map((r) => r.get()),
      };
      storageSet(STORAGE_KEYS.captureDraft, JSON.stringify(buildCaptureDraft(payload)));
    }, CAPTURE_DRAFT_AUTOSAVE_MS);
  }

  function clearCaptureDraft() {
    storageRemove(STORAGE_KEYS.captureDraft);
  }

  function applyCaptureDraft() {
    const wrapped = loadCaptureDraft();
    if (!wrapped?.payload || typeof wrapped.payload !== "object") return;
    const draft = wrapped.payload;
    if (!draft) return;
    const allowed = movementTypesForActor();
    if (draft.movementType && allowed.includes(String(draft.movementType))) {
      currentMode = String(draft.movementType);
    }
    draftRestoreInProgress = true;
    try {
      if (draft.occurredAt) occurredAt.value = String(draft.occurredAt);
      lockOccurredAt.checked = !!draft.lockOccurredAt;
      aggregateMode.checked = !!draft.aggregateMode;
      aggregateCloseTime.value = normalizeDraftValue(draft.aggregateCloseTime, aggregateCloseTime.value);
      notes.value = String(draft.notes || "");
      currency.value = String(draft.currency || DEFAULT_CURRENCY).trim() || DEFAULT_CURRENCY;
      fromQuality.value = normalizeDraftValue(draft.fromQuality, "");
      toQuality.value = normalizeDraftValue(draft.toQuality, "");
      fromSku.value = normalizeDraftValue(draft.fromSku, "");
      toSku.value = normalizeDraftValue(draft.toSku, "");
      adjustDir.value = normalizeDraftValue(draft.adjustDir, "decrease") === "increase" ? "increase" : "decrease";
      aggregateNoCutoff.checked = !!draft.aggregateNoCutoff;

      const draftLines = Array.isArray(draft.lines) ? draft.lines : [];
      if (draftLines.length > 0) {
        while (lineRows.length < Math.min(draftLines.length, MAX_DRAFT_LINES)) addLine();
        while (lineRows.length > Math.min(draftLines.length, MAX_DRAFT_LINES)) {
          const lastRow = lineRows.pop();
          if (lastRow?.el) lastRow.el.remove();
        }
        const target = Math.min(draftLines.length, lineRows.length);
        for (let i = 0; i < target; i++) {
          lineRows[i].setValues(draftLines[i]);
        }
      }

      updateMode(currentMode);
      setBatchClosePresetState(aggregateCloseTime.value);
      aggregateCloseTime.disabled = !aggregateMode.checked;
      batchCloseWrap.style.display = aggregateMode.checked ? "" : "none";
      batchHint.style.display = aggregateMode.checked ? "" : "none";
      aggregateNoCutoff.disabled = !aggregateMode.checked;
      aggregateNoCutoffRow.style.display = aggregateMode.checked ? "" : "none";
      if (aggregateMode.checked) {
        const suggested = batchCloseDefaultTime(occurredAt.value);
        batchClosePresetTodayDefault.dataset.preset = suggested;
        setAggregateCloseTime(aggregateCloseTime.value || suggested, true);
      }
    } finally {
      draftRestoreInProgress = false;
      queueDraftSave();
    }
  }

	  function applyTraspasoSkuBucket() {
	    if (currentMode !== "traspaso_sku") return;
	    const id = String(fromSku.value || "");
	    const s = id ? skuById(id) : null;
	    if (!s) return;
	    for (const row of lineRows) row.setProductQuality(s.product_id, s.quality_id, { lock: true });
	  }

	  const traspasoSkuMeta = h("div", { class: "muted" });
	  function updateTraspasoSkuMeta() {
	    if (currentMode !== "traspaso_sku") return;
	    const fromId = String(fromSku.value || "");
	    const toId = String(toSku.value || "");
	    const f = fromId ? skuById(fromId) : null;
	    const t = toId ? skuById(toId) : null;
	    if (!f && !t) {
	      traspasoSkuMeta.textContent = "";
	      return;
	    }
	    const left = f ? `${skuLabel(f.id)} (${productName(f.product_id)} | ${qualityName(f.quality_id)})` : "(elige De SKU)";
	    const right = t ? `${skuLabel(t.id)} (${productName(t.product_id)} | ${qualityName(t.quality_id)})` : "(elige A SKU)";
	    traspasoSkuMeta.textContent = `Movimiento: ${left} -> ${right}`;
	  }

  function addLine() {
    const row = buildLineRow({
      products,
      qualities,
      skus,
      mode: currentMode,
      onRemove: () => {
        const idx = lineRows.indexOf(row);
        if (idx >= 0) {
          lineRows.splice(idx, 1);
          row.el.remove();
          queueDraftSave();
        }
      },
    });
    lineRows.push(row);
    linesWrap.appendChild(row.el);
    applyTraspasoSkuBucket();
    queueDraftSave();
  }

  function updateMode(mt) {
    currentMode = mt;
    for (const row of lineRows) row.setMode(mt);

    traspasoSection.style.display = mt === "traspaso_calidad" ? "" : "none";
		    traspasoSkuSection.style.display = mt === "traspaso_sku" ? "" : "none";
		    ajusteSection.style.display = mt === "ajuste" ? "" : "none";
		    currencySection.style.display = mt === "venta" ? "" : "none";
		    applyTraspasoSkuBucket();
		    updateTraspasoSkuMeta();
        queueDraftSave();
		  }

  addLine();

  const addLineBtn = h("button", { class: "btn", type: "button", onclick: addLine }, ["Agregar linea"]);

  const traspasoSection = h("div", { class: "grid2" }, [
    field("De calidad", fromQuality),
    field("A calidad", toQuality),
  ]);

	  const traspasoSkuSection = h("div", { class: "col" }, [
	    h("div", { class: "grid2" }, [field("De SKU", fromSku), field("A SKU", toSku)]),
	    traspasoSkuMeta,
	  ]);

  const ajusteSection = h("div", {}, [field("Direccion de ajuste", adjustDir)]);

  const currencySection = h("div", {}, [field("Moneda", currency)]);
  currencySection.style.display = currentMode === "venta" ? "" : "none";
  traspasoSection.style.display = "none";
  traspasoSkuSection.style.display = "none";
  ajusteSection.style.display = "none";

  fromSku.addEventListener("change", () => applyTraspasoSkuBucket());
  fromSku.addEventListener("change", () => updateTraspasoSkuMeta());
  toSku.addEventListener("change", () => updateTraspasoSkuMeta());
  let aggregateCloseTimeEdited = false;
  occurredAt.addEventListener("change", () => {
    if (lockOccurredAt.checked) storageSet(STORAGE_KEYS.captureFixedDatetimeValue, String(occurredAt.value || ""));
    if (aggregateMode.checked && !aggregateCloseTimeEdited) {
      const suggested = batchCloseDefaultTime(occurredAt.value);
      batchClosePresetTodayDefault.dataset.preset = suggested;
      setAggregateCloseTime(suggested, false);
    }
  });
  aggregateCloseTime.addEventListener("change", () => {
    aggregateCloseTimeEdited = true;
    storageSet(STORAGE_KEYS.captureBatchCloseTime, String(aggregateCloseTime.value || ""));
    setBatchClosePresetState(aggregateCloseTime.value);
  });
  lockOccurredAt.addEventListener("change", () => {
    storageSet(STORAGE_KEYS.captureFixedDatetimeLock, lockOccurredAt.checked ? "1" : "0");
    if (lockOccurredAt.checked) {
      if (!occurredAt.value) occurredAt.value = localNowInputValue();
      storageSet(STORAGE_KEYS.captureFixedDatetimeValue, String(occurredAt.value || ""));
    }
  });
  setBatchClosePresetState(aggregateCloseTime.value);
  aggregateCloseTime.disabled = !aggregateMode.checked;
  batchCloseWrap.style.display = aggregateMode.checked ? "" : "none";
  batchHint.style.display = aggregateMode.checked ? "" : "none";
  aggregateNoCutoff.disabled = !aggregateMode.checked;
  aggregateNoCutoffRow.style.display = aggregateMode.checked ? "" : "none";
  aggregateNoCutoff.checked = false;
  aggregateMode.addEventListener("change", () => {
    storageSet(STORAGE_KEYS.captureBatchMode, aggregateMode.checked ? "1" : "0");
    batchCloseWrap.style.display = aggregateMode.checked ? "" : "none";
    batchHint.style.display = aggregateMode.checked ? "" : "none";
    aggregateCloseTime.disabled = !aggregateMode.checked;
    aggregateNoCutoff.disabled = !aggregateMode.checked;
    aggregateNoCutoffRow.style.display = aggregateMode.checked ? "" : "none";
    aggregateCloseTimeEdited = false;
    aggregateNoCutoff.checked = false;
    if (aggregateMode.checked) {
      const suggested = batchCloseDefaultTime(occurredAt.value);
      batchClosePresetTodayDefault.dataset.preset = suggested;
      setAggregateCloseTime(suggested, false);
    }
  });

  function resetCaptureFormAfterSave() {
    clearCaptureDraft();
    notes.value = "";
    proofs.value = "";
    if (lockOccurredAt.checked) {
      storageSet(STORAGE_KEYS.captureFixedDatetimeValue, String(occurredAt.value || ""));
    } else {
      occurredAt.value = localNowInputValue();
    }
    reportedBy.value = "";
    fromQuality.value = "";
    toQuality.value = "";
    fromSku.value = "";
    toSku.value = "";
    adjustDir.value = "decrease";
    aggregateNoCutoff.checked = false;
    linesWrap.replaceChildren();
    lineRows.length = 0;
    addLine();
    updateMode(currentMode);
    queueDraftSave();
  }

  let isSubmitting = false;
  const submitBtn = h(
    "button",
    {
      class: "btn btn-primary",
      type: "button",
      onclick: async () => {
        if (isSubmitting) return;
        msg.replaceChildren();
        clearProofPickerOpen();
        if (draftSaveTimer) {
          window.clearTimeout(draftSaveTimer);
          draftSaveTimer = null;
        }

        if (typeof navigator !== "undefined" && navigator.onLine === false) {
          msg.appendChild(notice("warn", "Sin conexion. Revisa internet e intenta de nuevo."));
          return;
        }

        const dtInputValue = String(occurredAt.value || "");
        const dtIso = isoFromLocalInput(dtInputValue);
        if (!dtIso) {
          msg.appendChild(notice("error", "Fecha/hora invalida."));
          return;
        }
        if (!movementTypesForActor().includes(currentMode)) {
          msg.appendChild(notice("error", "No tienes permiso para ese tipo de movimiento."));
          return;
        }
        const isAggregateMode = aggregateMode.checked;
        const aggregateDtIso = isAggregateMode ? buildBatchOccurredIso(dtInputValue, aggregateCloseTime.value) : null;
        if (isAggregateMode && !aggregateDtIso) {
          msg.appendChild(notice("error", "Hora de cierre invalida para el registro agregado."));
          return;
        }
        if (isAggregateMode && !aggregateNoCutoff.checked) {
          msg.appendChild(notice("error", "Confirma que este registro no se hizo dentro de una toma física de inventario activa."));
          return;
        }
        const noteBase = String(notes.value || "").trim();
        const closeTime = isAggregateMode ? String(aggregateCloseTime.value || batchCloseDefaultTime(dtInputValue)) : "";
        const isMarked = noteBase.toUpperCase().includes("[AGREGADO]");
        const aggregateSuffix = isAggregateMode && !isMarked ? ` [AGREGADO] registrado al cierre ${closeTime}` : "";
        const finalNotes = isAggregateMode ? `${noteBase}${aggregateSuffix}`.trim() : noteBase;

        const files = Array.from(proofs.files || []);
        if (hasProofRequirement() && files.length === 0) {
          msg.appendChild(notice("error", "Como empleado, debes adjuntar evidencia para guardar el movimiento."));
          return;
        }
        const rawLines = lineRows.map((r) => r.get());
        const parsed = [];
        await maybeYield(1, 1);

        const fromSkuId = String(fromSku.value || "");
        const toSkuId = String(toSku.value || "");
        const fromSkuObj = fromSkuId ? skuById(fromSkuId) : null;
        const toSkuObj = toSkuId ? skuById(toSkuId) : null;

        if (currentMode === "traspaso_sku") {
          if (!fromSkuObj || !toSkuObj) {
            msg.appendChild(notice("error", "Traspaso SKU requiere De SKU y A SKU."));
            return;
          }
          if (fromSkuObj.id === toSkuObj.id) {
            msg.appendChild(notice("error", "De SKU y A SKU deben ser diferentes."));
            return;
          }
        }

        for (const [i, ln] of rawLines.entries()) {
          await maybeYield(i + 1, SUBMIT_PARSE_YIELD_EVERY);
          const sku_id = String(ln.sku_id || "").trim();
          const product_id = ln.product_id;
          const quality_id = ln.quality_id;
          const w = Number(ln.weight_kg);
          if (currentMode !== "traspaso_sku" && !product_id) return msg.appendChild(notice("error", `Linea ${i + 1}: elige un producto.`));
          if (currentMode !== "traspaso_calidad" && currentMode !== "traspaso_sku" && !quality_id) {
            return msg.appendChild(notice("error", `Linea ${i + 1}: elige una calidad.`));
          }
          if (!Number.isFinite(w) || w <= 0) return msg.appendChild(notice("error", `Linea ${i + 1}: kg invalido.`));

          const row = { sku_id: sku_id || null, product_id: product_id || null, weight_kg: w };
          if (currentMode !== "traspaso_calidad") row.quality_id = quality_id || null;

          if (currentMode === "venta") {
            const pm = ln.price_model;
            const up = Number(ln.unit_price);
            const b = ln.boxes ? Number(ln.boxes) : null;
            if (!pm) return msg.appendChild(notice("error", `Linea ${i + 1}: elige un modelo de precio.`));
            if (!Number.isFinite(up) || up < 0) return msg.appendChild(notice("error", `Linea ${i + 1}: precio unitario invalido.`));
            if (pm === "per_box") {
              if (!Number.isFinite(b) || b <= 0) return msg.appendChild(notice("error", `Linea ${i + 1}: se requieren cajas para ventas por caja.`));
              row.boxes = Math.trunc(b);
              row.price_model = pm;
              row.unit_price = up;
              row.line_total = row.boxes * up;
            } else if (pm === "per_kg") {
              row.price_model = pm;
              row.unit_price = up;
              row.line_total = w * up;
              if (Number.isFinite(b) && b > 0) row.boxes = Math.trunc(b);
            } else {
              return msg.appendChild(notice("error", `Linea ${i + 1}: modelo de precio invalido.`));
            }
          }

          parsed.push(row);
        }

        if (currentMode === "traspaso_calidad") {
          if (!fromQuality.value || !toQuality.value) {
            msg.appendChild(notice("error", "Traspaso requiere De calidad y A calidad."));
            return;
          }
          if (fromQuality.value === toQuality.value) {
            msg.appendChild(notice("error", "En traspaso, De calidad y A calidad deben ser diferentes."));
            return;
          }
        }

        const userId = state.session?.user?.id;
        if (!userId) {
          msg.appendChild(notice("error", "Falta el user id de la sesion."));
          return;
        }

        const setSubmitting = (on) => {
          isSubmitting = on;
          state.captureSubmitting = on;
          submitBtn.disabled = on;
          submitBtn.textContent = on ? "Guardando..." : "Guardar movimiento";
          if (!on && renderPending) {
            scheduleSafeRender();
          }
        };

        setSubmitting(true);
        msg.replaceChildren(notice("warn", rawLines.length > 1 ? "Validando lineas..." : "Validando linea..."));
        await maybeYield(1, 1);

        let movementId = "";
        const uploaded = [];
        try {
          movementId = crypto.randomUUID();
          if (rawLines.length > 0) {
            msg.replaceChildren(notice("warn", `Validando ${rawLines.length} lineas...`));
          }

          // 1) Prepare proofs (with light compression when needed) and upload first
          // so we can fail fast before writing to DB.
          const preparedFiles = await prepareProofFiles(files, {
            label: "evidencia del movimiento",
            onProgress: (idx, total, label) => {
              msg.replaceChildren(notice("warn", `${label} ${idx}/${total}`));
            },
          });

          for (let i = 0; i < preparedFiles.length; i++) {
            const p = preparedFiles[i];
            const safe = sanitizeFilename(p.file?.name || "proof");
            const path = `${userId}/${movementId}/${Date.now()}_${i}_${safe}`;
            const sourceType = p.file?.type || "application/octet-stream";
            msg.replaceChildren(notice("warn", `Subiendo evidencia ${i + 1}/${preparedFiles.length}...`));
            const { error: upErr } = await withTimeout(
              supabase.storage.from("movement-proofs").upload(path, p.file, {
                cacheControl: "3600",
                upsert: false,
                contentType: sourceType,
              }),
              NETWORK_TIMEOUT_MS,
              `Subida de evidencia ${i + 1}`
            );
            if (upErr) throw upErr;
            uploaded.push({
              storage_bucket: "movement-proofs",
              storage_path: path,
              original_filename: p.original_filename || null,
              content_type: p.original_content_type || sourceType || null,
              size_bytes: Number.isFinite(p.upload_size) ? p.upload_size : null,
            });
            await maybeYield(i + 1, 1);
          }

          // 2) Build DB rows (signed deltas)
          const movement = {
            id: movementId,
            movement_type: currentMode,
            occurred_at: isAggregateMode ? aggregateDtIso : dtIso,
            notes: finalNotes || null,
            currency: currentMode === "venta" ? String(currency.value || DEFAULT_CURRENCY).trim() || DEFAULT_CURRENCY : DEFAULT_CURRENCY,
            reported_by_employee_id: autoEmpId || String(reportedBy.value || "") || null,
            from_sku_id: currentMode === "traspaso_sku" ? fromSkuId : null,
            to_sku_id: currentMode === "traspaso_sku" ? toSkuId : null,
            from_quality_id: currentMode === "traspaso_calidad" ? String(fromQuality.value) : null,
            to_quality_id: currentMode === "traspaso_calidad" ? String(toQuality.value) : null,
          };

          const lines = [];
          for (let iLine = 0; iLine < parsed.length; iLine++) {
            await maybeYield(iLine + 1, SUBMIT_PARSE_YIELD_EVERY);
            const ln = parsed[iLine];
            if (currentMode === "entrada") {
              lines.push({
                sku_id: ln.sku_id,
                product_id: ln.product_id,
                quality_id: ln.quality_id,
                delta_weight_kg: ln.weight_kg,
                boxes: ln.boxes ?? null,
                price_model: null,
                unit_price: null,
                line_total: null,
              });
            } else if (currentMode === "venta") {
              lines.push({
                sku_id: ln.sku_id,
                product_id: ln.product_id,
                quality_id: ln.quality_id,
                delta_weight_kg: -ln.weight_kg,
                boxes: ln.boxes ?? null,
                price_model: ln.price_model,
                unit_price: ln.unit_price,
                line_total: ln.line_total,
              });
            } else if (currentMode === "merma") {
              lines.push({
                sku_id: ln.sku_id,
                product_id: ln.product_id,
                quality_id: ln.quality_id,
                delta_weight_kg: -ln.weight_kg,
                boxes: null,
                price_model: null,
                unit_price: null,
                line_total: null,
              });
            } else if (currentMode === "ajuste") {
              const sign = adjustDir.value === "increase" ? 1 : -1;
              lines.push({
                sku_id: ln.sku_id,
                product_id: ln.product_id,
                quality_id: ln.quality_id,
                delta_weight_kg: sign * ln.weight_kg,
                boxes: null,
                price_model: null,
                unit_price: null,
                line_total: null,
              });
            } else if (currentMode === "traspaso_calidad") {
              const fromQ = String(fromQuality.value);
              const toQ = String(toQuality.value);
              lines.push({
                sku_id: null,
                product_id: ln.product_id,
                quality_id: fromQ,
                delta_weight_kg: -ln.weight_kg,
                boxes: null,
                price_model: null,
                unit_price: null,
                line_total: null,
              });
              lines.push({
                sku_id: null,
                product_id: ln.product_id,
                quality_id: toQ,
                delta_weight_kg: ln.weight_kg,
                boxes: null,
                price_model: null,
                unit_price: null,
                line_total: null,
              });
            } else if (currentMode === "traspaso_sku") {
              lines.push({
                sku_id: fromSkuObj.id,
                product_id: fromSkuObj.product_id,
                quality_id: fromSkuObj.quality_id,
                delta_weight_kg: -ln.weight_kg,
                boxes: null,
                price_model: null,
                unit_price: null,
                line_total: null,
              });
              lines.push({
                sku_id: toSkuObj.id,
                product_id: toSkuObj.product_id,
                quality_id: toSkuObj.quality_id,
                delta_weight_kg: ln.weight_kg,
                boxes: null,
                price_model: null,
                unit_price: null,
                line_total: null,
              });
            }
          }

          // 3) Single RPC to keep DB consistent.
          const { data: newId, error: rpcErr } = await withTimeout(
            supabase.rpc("create_movement_with_lines", {
              movement,
              lines,
              attachments: uploaded,
            }),
            NETWORK_TIMEOUT_MS,
            "Guardado de movimiento"
          );
          if (rpcErr) throw rpcErr;

          msg.replaceChildren(notice("ok", `Movimiento guardado ${String(newId).slice(0, 8)}...`));
          resetCaptureFormAfterSave();
        } catch (e) {
          // If timeout happened but insert actually reached DB, avoid duplicate capture on retry.
          if (movementId) {
            try {
              const { data: existing } = await supabase.from("movements").select("id").eq("id", movementId).maybeSingle();
              if (existing?.id) {
                msg.replaceChildren(notice("ok", `Movimiento guardado ${String(existing.id).slice(0, 8)}...`));
                resetCaptureFormAfterSave();
                return;
              }
            } catch {
              // ignore check failures
            }
          }

          // Best-effort rollback of uploaded objects if DB write failed.
          if (uploaded.length > 0) {
            try {
              await supabase.storage.from("movement-proofs").remove(uploaded.map((a) => a.storage_path));
            } catch {
              // ignore
            }
          }
          msg.replaceChildren(
            notice(
              "error",
              `${normalizeActorRoleError(String((e?.message || e) || "") ) || (e?.message ? String(e.message) : "No se pudo guardar el movimiento.")} Si la red estuvo inestable, espera unos segundos y revisa Movimientos antes de reintentar.`
            )
          );
        } finally {
          setSubmitting(false);
        }
      },
    },
      ["Guardar movimiento"]
  );

  const card = h("div", { class: "col" }, [
    h("div", { class: "card col" }, [
      h("div", { class: "h1", text: "Nuevo movimiento" }),
      h("div", { class: "muted", text: "Todo se registra en kg. Evidencia (WhatsApp) opcional." }),
      h("div", { class: "muted", text: "Nota: el inventario se calcula por (Producto + Calidad). SKUs vinculados comparten saldo (ej: 103 descuenta de 102; 106 descuenta de 101; 301 descuenta de 300)." }),
      msg,
      pills.el,
      h("div", { class: "divider" }),
      h("div", { class: "grid2" }, [field("Fecha/hora", occurredAt), ...(Array.isArray(reportedByField) ? reportedByField : [reportedByField])]),
      h(
        "label",
        { class: "muted", style: "display:flex; align-items:center; gap:8px; margin-top:-2px" },
        [lockOccurredAt, h("span", { text: "Mantener fecha/hora fija despues de guardar." })]
      ),
      h(
        "label",
        { class: "muted", style: "display:flex; align-items:center; gap:8px; margin-top:-2px" },
        [aggregateMode, h("span", { text: "Registro agregado del día (lote). Se usa solo si no hubo corte físico." })]
      ),
      aggregateNoCutoffRow,
      batchCloseWrap,
      batchHint,
      field("Notas", notes),
      currencySection,
      traspasoSection,
      traspasoSkuSection,
      ajusteSection,
      h("div", { class: "divider" }),
      h("div", { class: "row-wrap" }, [h("div", { class: "h1", text: "Lineas" }), h("div", { class: "spacer" }), addLineBtn]),
      linesWrap,
      h("div", { class: "divider" }),
      field("Evidencia (fotos)", proofs),
      proofsHint,
      h("div", { class: "row-wrap" }, [submitBtn]),
    ]),
    h("div", { class: "notice" }, [
      h("div", { class: "muted" }, [
        "Tip: Para papaya de 2da vendida por caja con peso variable, usa Venta + modelo Por caja, e ingresa cajas + kg.",
      ]),
      ]),
  ]);

  applyCaptureDraft();
  card.addEventListener("input", () => queueDraftSave());
  card.addEventListener("change", () => queueDraftSave());
  layout(ROUTE_TITLES.capture, card);
  updateMode(currentMode);
}

async function pageMovements(pageCtx) {
  const isActive = () => isPageContextActive(pageCtx);
  const msg = h("div");
  const listWrap = h("div", { class: "col" });
  let movementsOffset = 0;
  let isLoadingMovements = false;
  let canLoadMoreMovements = false;

  const loadMoreBtn = h("button", { class: "btn", type: "button", onclick: () => load({ append: true }) }, ["Cargar más movimientos"]);
  const refreshBtn = h("button", {
    class: "btn",
    type: "button",
    onclick: async () => {
      movementsOffset = 0;
      await load();
    },
  }, ["Actualizar"]);

  async function load({ append = false } = {}) {
    if (isLoadingMovements || !isActive()) return;
    isLoadingMovements = true;
    loadMoreBtn.disabled = true;
    if (!append) canLoadMoreMovements = false;

    if (!append) {
      movementsOffset = 0;
      listWrap.replaceChildren(notice("warn", "Cargando..."));
    }
    msg.replaceChildren(notice("warn", append ? "Cargando más movimientos..." : "Cargando movimientos..."));

    try {
      const { data, error } = await supabase
        .from("movements")
        .select(
          "id,movement_type,occurred_at,notes,currency,reported_by_employee_id,from_sku_id,to_sku_id,from_quality_id,to_quality_id,created_at," +
            "movement_lines(id,sku_id,product_id,quality_id,delta_weight_kg,boxes,price_model,unit_price,line_total)," +
            "movement_attachments(id,storage_path,original_filename,content_type,size_bytes)"
        )
        .order("occurred_at", { ascending: false })
        .range(movementsOffset, movementsOffset + MOVEMENTS_PAGE_SIZE - 1);
      if (!isActive()) return;
      if (error) {
        msg.replaceChildren(notice("error", error.message));
        return;
      }

      const movementRows = data || [];
      canLoadMoreMovements = movementRows.length >= MOVEMENTS_PAGE_SIZE;
      movementsOffset += movementRows.length;

      if (!append) listWrap.replaceChildren();

      if (movementRows.length === 0 && !append) {
        listWrap.appendChild(notice("warn", "Sin movimientos."));
      }

      const movementCards = document.createDocumentFragment();

      for (let idx = 0; idx < movementRows.length; idx++) {
        if (!isActive()) return;
        const m = movementRows[idx];
        const lines = m.movement_lines || [];
        const att = m.movement_attachments || [];

        let sumDelta = 0;
        let sumAbs = 0;
        for (const l of lines) {
          const d = Number(l.delta_weight_kg || 0);
          sumDelta += d;
          sumAbs += Math.abs(d);
        }

        const isTransfer = m.movement_type === "traspaso_calidad" || m.movement_type === "traspaso_sku";
        const kgLabel = isTransfer ? `${fmtKg(sumAbs / 2)} kg movidos` : `${fmtKg(Math.abs(sumDelta))} kg`;

        const title = `${movementLabel(m.movement_type)} - ${kgLabel}`;
        const subtitleParts = [
          formatOccurredAt(m.occurred_at),
          m.reported_by_employee_id ? employeeName(m.reported_by_employee_id) : null,
          att.length ? `${att.length} evidencia(s)` : "sin evidencia",
        ];
        // Remove null entries
        for (let i = subtitleParts.length - 1; i >= 0; i--) {
          if (!subtitleParts[i]) subtitleParts.splice(i, 1);
        }
        if (m.movement_type === "traspaso_calidad" && m.from_quality_id && m.to_quality_id) {
          subtitleParts.push(`${qualityName(m.from_quality_id)} -> ${qualityName(m.to_quality_id)}`);
        }
        if (m.movement_type === "traspaso_sku" && m.from_sku_id && m.to_sku_id) {
          subtitleParts.push(`${skuLabel(m.from_sku_id)} -> ${skuLabel(m.to_sku_id)}`);
        }
        const subtitle = subtitleParts.join(" | ");

        const btnView = h(
          "button",
          {
            class: "btn",
            type: "button",
            onclick: () => openMovementModal(m, pageCtx),
          },
          ["Ver"]
        );

        const card = h("div", { class: "card col" }, [
          h("div", { class: "row" }, [
            h("div", { class: "col", style: "gap: 4px" }, [
              h("div", { style: "font-weight: 760", text: title }),
              h("div", { class: "muted", text: subtitle }),
            ]),
            h("div", { class: "spacer" }),
            btnView,
          ]),
          m.notes ? h("div", { class: "muted", text: m.notes }) : null,
          buildMovementLinePreviewItems(lines, m.movement_type, m.currency || DEFAULT_CURRENCY),
        ]);
        movementCards.appendChild(card);
        await maybeYield(idx + 1, 10);
      }

      if (!isActive()) return;
      listWrap.appendChild(movementCards);

      msg.replaceChildren();
      if (!canLoadMoreMovements) {
        loadMoreBtn.textContent = "Sin más movimientos";
        loadMoreBtn.disabled = true;
      } else {
        loadMoreBtn.textContent = "Cargar más movimientos";
        loadMoreBtn.disabled = false;
      }
    } finally {
      isLoadingMovements = false;
      if (!isActive()) return;
      if (!canLoadMoreMovements) {
        loadMoreBtn.textContent = "Sin más movimientos";
        loadMoreBtn.disabled = true;
      } else {
        loadMoreBtn.textContent = "Cargar más movimientos";
        loadMoreBtn.disabled = false;
      }
    }
  }

  const top = h("div", { class: "card col" }, [
    h("div", { class: "row-wrap" }, [h("div", { class: "h1", text: "Movimientos recientes" }), h("div", { class: "spacer" }), refreshBtn]),
    msg,
    h("div", { class: "row-wrap" }, [loadMoreBtn]),
  ]);

  const page = h("div", { class: "col" }, [top, listWrap]);
  layout(ROUTE_TITLES.movements, page);
  await load();
}

async function openMovementModal(m, pageCtx) {
  const isActive = () => isPageContextActive(pageCtx);
	  const backdrop = h("div", { class: "modal-backdrop" });
	  const modal = h("div", { class: "modal col" });
	  backdrop.appendChild(modal);

  function close() {
    backdrop.remove();
  }
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });

	  const canDeleteMovement = isManager();
	  const headerButtons = [];

	  if (canDeleteMovement) {
	    headerButtons.push(
	      h(
	        "button",
	        {
	          class: "btn btn-danger",
	          type: "button",
	          onclick: async () => {
	            if (!confirm("Eliminar este movimiento? Esto ajustara el inventario y borrara la evidencia (si existe).")) return;
	            const attachments = m.movement_attachments || [];
	            const paths = attachments.map((a) => a.storage_path).filter(Boolean);
	            const { error: delErr } = await supabase.rpc("delete_movement", { movement_id: m.id });
	            if (delErr) return alert(delErr.message);

	            // Best-effort Storage cleanup (does not affect inventory).
	            if (paths.length > 0) {
	              try {
	                await supabase.storage.from("movement-proofs").remove(paths);
	              } catch {
	                // ignore
	              }
	            }
	            close();
	            scheduleSafeRender();
	          },
	        },
	        ["Eliminar"]
	      )
	    );
	  }

	  headerButtons.push(h("button", { class: "btn btn-ghost", type: "button", onclick: close }, ["Cerrar"]));

	  const header = h("div", { class: "row-wrap modal-header" }, [
	    h("div", { class: "col", style: "gap: 4px" }, [
	      h("div", { style: "font-weight: 820; font-size: 16px", text: movementLabel(m.movement_type) }),
	      h("div", { class: "muted", text: formatOccurredAt(m.occurred_at) }),
	    ]),
	    h("div", { class: "spacer" }),
	    ...headerButtons,
	  ]);

	  const info = h("div", { class: "notice" }, [
	    h("div", { class: "row-wrap" }, [
	      h("div", { class: "muted", text: `ID: ${String(m.id).slice(0, 8)}...` }),
	      h("div", { class: "spacer" }),
      m.movement_type === "venta"
        ? h("div", { class: "muted", text: `Moneda: ${m.currency || DEFAULT_CURRENCY}` })
        : null,
    ]),
	    m.reported_by_employee_id
	      ? h("div", { class: "muted", text: `Empleado: ${employeeName(m.reported_by_employee_id)}` })
	      : null,
	    m.movement_type === "traspaso_sku" && m.from_sku_id && m.to_sku_id
	      ? h("div", { class: "muted", text: `Traspaso SKU: ${skuLabel(m.from_sku_id)} -> ${skuLabel(m.to_sku_id)}` })
	      : null,
	    m.movement_type === "traspaso_calidad" && m.from_quality_id && m.to_quality_id
	      ? h("div", { class: "muted", text: `Traspaso: ${qualityName(m.from_quality_id)} -> ${qualityName(m.to_quality_id)}` })
	      : null,
	    m.notes ? h("div", { text: m.notes }) : h("div", { class: "muted", text: "Sin notas." }),
	  ]);

  const lines = m.movement_lines || [];
  const linesTable = h("table", { class: "table" }, [
    h("thead", {}, [
      h("tr", {}, [
        h("th", { text: "SKU" }),
        h("th", { text: "Producto" }),
        h("th", { text: "Calidad" }),
        h("th", { text: "Delta (kg)" }),
        h("th", { text: "Cajas" }),
        h("th", { text: "Precio" }),
        h("th", { text: "Total" }),
      ]),
    ]),
    h(
      "tbody",
      {},
      lines.map((l) => {
        const pm = l.price_model ? String(l.price_model) : "";
        const up = l.unit_price != null ? Number(l.unit_price) : null;
        const price =
          pm && up != null
            ? pm === "per_box"
              ? `${fmtMoney(up, m.currency || DEFAULT_CURRENCY)} / caja`
              : `${fmtMoney(up, m.currency || DEFAULT_CURRENCY)} / kg`
            : "";
        const total = l.line_total != null ? fmtMoney(Number(l.line_total), m.currency || DEFAULT_CURRENCY) : "";

        return h("tr", {}, [
          h("td", { class: "mono", text: skuLabel(l.sku_id) }),
          h("td", { text: productName(l.product_id) }),
          h("td", { text: qualityName(l.quality_id) }),
          h("td", { class: "mono", text: fmtKg(l.delta_weight_kg) }),
          h("td", { class: "mono", text: l.boxes != null ? String(l.boxes) : "" }),
          h("td", { text: price }),
          h("td", { class: "mono", text: total }),
        ]);
      })
    ),
  ]);

  const attachments = m.movement_attachments || [];
  const proofsWrap = h("div", { class: "col" });

  if (attachments.length === 0) {
    proofsWrap.appendChild(notice("warn", "Sin evidencia."));
  } else {
    proofsWrap.appendChild(notice("", "Cargando evidencia..."));
    const signed = [];
    for (let i = 0; i < attachments.length; i++) {
      const a = attachments[i];
      const { data } = await supabase.storage.from("movement-proofs").createSignedUrl(a.storage_path, 60 * 30);
      if (!isActive() || !document.body.contains(backdrop)) return;
      signed.push({ ...a, signedUrl: data?.signedUrl || null });
      await maybeYield(i + 1, 3);
    }

    if (!isActive() || !document.body.contains(backdrop)) return;
    const visibleSigned = signed.filter((a) => a.signedUrl);
    const extraCount = Math.max(0, visibleSigned.length - 6);
    proofsWrap.replaceChildren(
      h("div", { class: "thumbgrid" }, [
        ...visibleSigned.slice(0, 6).map((a) =>
          h("a", { href: a.signedUrl, target: "_blank", rel: "noreferrer" }, [
            h("img", { class: "thumb", src: a.signedUrl, alt: a.original_filename || "proof" }),
          ])
        ),
      ]),
      extraCount > 0 ? h("div", { class: "muted", text: `+ ${extraCount} evidencia(s) adicional(es)` }) : null,
    );
  }

  modal.appendChild(header);
  modal.appendChild(info);
  modal.appendChild(h("div", { class: "divider" }));
  modal.appendChild(h("div", { class: "h1", text: "Lineas" }));
  modal.appendChild(tableScroll(linesTable));
  modal.appendChild(h("div", { class: "divider" }));
  modal.appendChild(h("div", { class: "h1", text: "Evidencia" }));
  modal.appendChild(proofsWrap);
  modal.appendChild(h("div", { class: "divider" }));
  modal.appendChild(
    h("div", { class: "row-wrap" }, [
      h("div", { class: "spacer" }),
      h("button", { class: "btn", type: "button", onclick: close }, ["Cerrar"]),
    ])
  );

  document.body.appendChild(backdrop);
}

async function pageInventory(pageCtx) {
  const isActive = () => isPageContextActive(pageCtx);
  const msg = h("div");
  let viewMode = "sku"; // "sku" | "product"
  let invMap = new Map(); // key: `${productId}|${qualityId}` -> kg

  function bucketKey(productId, qualityId) {
    return `${String(productId)}|${String(qualityId)}`;
  }

  function choosePrimarySku(list) {
    const sk = (list || []).filter(Boolean);
    if (sk.length === 0) return null;
    const perKg = sk.filter((s) => String(s.default_price_model || "") === "per_kg");
    const candidates = (perKg.length ? perKg : sk).slice().sort((a, b) => Number(a.code || 0) - Number(b.code || 0));
    return candidates[0] || sk[0] || null;
  }

  function setView(next) {
    viewMode = next;
    btnSku.setAttribute("aria-pressed", viewMode === "sku" ? "true" : "false");
    btnProd.setAttribute("aria-pressed", viewMode === "product" ? "true" : "false");
    renderTable();
  }

  const btnSku = h(
    "button",
    { class: "pill", type: "button", "aria-pressed": "true", onclick: () => setView("sku") },
    ["Por SKU"]
  );
  const btnProd = h(
    "button",
    { class: "pill", type: "button", "aria-pressed": "false", onclick: () => setView("product") },
    ["Por producto"]
  );

  const viewPills = h("div", { class: "pillbar" }, [btnSku, btnProd]);

  const card = h("div", { class: "card col" }, [
    h("div", { class: "row-wrap" }, [
      h("div", { class: "h1", text: "Inventario (kg)" }),
      h("div", { class: "spacer" }),
      h(
        "button",
        {
          class: "btn",
          type: "button",
          onclick: () => load(),
        },
        ["Actualizar"]
      ),
    ]),
    viewPills,
    msg,
  ]);

  const tableWrap = h("div", { class: "card col" });

  const page = h("div", { class: "col" }, [card, tableWrap]);
  layout(ROUTE_TITLES.inventory, page);

  function renderSkuView() {
    const skus = (state.skus || []).filter((s) => s.is_active).slice().sort((a, b) => Number(a.code || 0) - Number(b.code || 0));

    // Group SKUs by shared inventory bucket (product+quality).
    const groups = new Map(); // key -> { product_id, quality_id, skus: [] }
    for (const s of skus) {
      const key = bucketKey(s.product_id, s.quality_id);
      if (!groups.has(key)) groups.set(key, { key, product_id: s.product_id, quality_id: s.quality_id, skus: [] });
      groups.get(key).skus.push(s);
    }

    // Also include any buckets present in the inventory view (even if no active SKU points to it).
    for (const key of invMap.keys()) {
      if (!groups.has(key)) {
        const [pid, qid] = String(key).split("|");
        groups.set(key, { key, product_id: pid, quality_id: qid, skus: [] });
      }
    }

    const rows = Array.from(groups.values())
      .map((g) => {
        const skList = (g.skus || []).slice().sort((a, b) => Number(a.code || 0) - Number(b.code || 0));
        const primary = choosePrimarySku(skList);
        const linked = primary ? skList.filter((s) => s.id !== primary.id) : skList;
        const codes = skList.length ? skList.map((s) => String(s.code)).join("/") : "";
        const onHand = Number(invMap.get(g.key) || 0);
        const sortCode = skList.length ? Math.min(...skList.map((s) => Number(s.code || 0))) : 999999;
        const sortLabel = primary ? String(primary.name || "") : `${productName(g.product_id)} | ${qualityName(g.quality_id)}`;
        return { ...g, codes, primary, linked, onHand, sortCode, sortLabel };
      })
      .sort((a, b) => (a.sortCode - b.sortCode) || String(a.sortLabel).localeCompare(String(b.sortLabel)));

    const table = h("table", { class: "table" }, [
      h("thead", {}, [
        h("tr", {}, [
          h("th", { text: "SKU(s)" }),
          h("th", { text: "Descripcion" }),
          h("th", { text: "Stock (kg)" }),
        ]),
      ]),
      h(
        "tbody",
        {},
        rows.map((r) => {
          const desc = r.primary
            ? [
                h("div", { text: `${Number(r.primary.code)} ${String(r.primary.name)}` }),
                r.linked && r.linked.length
                  ? h("div", { class: "muted", text: `Vinculados: ${r.linked.map((s) => `${Number(s.code)} ${String(s.name)}`).join(", ")}` })
                  : null,
              ]
            : [h("div", { class: "muted", text: `${productName(r.product_id)} | ${qualityName(r.quality_id)}` })];

          return h("tr", {}, [
            h("td", { class: "mono", text: r.codes || "" }),
            h("td", {}, desc),
            h("td", { class: "mono", text: fmtKg(r.onHand) }),
          ]);
        })
      ),
    ]);

    tableWrap.replaceChildren(
      h("div", { class: "h1", text: "Inventario por SKU" }),
      h("div", { class: "muted", text: "Los SKUs vinculados comparten el mismo saldo (ej: KG + Caja)." }),
      tableScroll(table)
    );
  }

  function renderProductView() {
    const products = state.products.filter((p) => p.is_active).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const qualities = state.qualities.filter((q) => q.is_active).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

    const map = new Map(); // key: productId -> Map(qualityId -> kg)
    for (const [k, v] of invMap.entries()) {
      const [pid, qid] = String(k).split("|");
      if (!map.has(pid)) map.set(pid, new Map());
      map.get(pid).set(qid, Number(v || 0));
    }

    const thead = h("thead", {}, [
      h("tr", {}, [
        h("th", { text: "Producto" }),
        ...qualities.map((q) => h("th", { text: String(q.name) })),
        h("th", { text: "Total" }),
      ]),
    ]);

    const tbody = h(
      "tbody",
      {},
      products.map((p) => {
        const qm = map.get(p.id) || new Map();
        let total = 0;
        const cells = qualities.map((q) => {
          const v = Number(qm.get(q.id) || 0);
          total += v;
          return h("td", { class: "mono", text: fmtKg(v) });
        });
        return h("tr", {}, [h("td", { text: String(p.name) }), ...cells, h("td", { class: "mono", text: fmtKg(total) })]);
      })
    );

    tableWrap.replaceChildren(
      h("div", { class: "h1", text: "Inventario por producto" }),
      tableScroll(h("table", { class: "table" }, [thead, tbody]))
    );
  }

  function renderTable() {
    if (viewMode === "product") return renderProductView();
    return renderSkuView();
  }

  async function load() {
    if (!isActive()) return;
    msg.replaceChildren(notice("warn", "Cargando..."));
    const { data, error } = await supabase.from("inventory_on_hand").select("product_id,product_name,quality_id,quality_name,on_hand_kg");
    if (!isActive()) return;
    if (error) {
      msg.replaceChildren(notice("error", error.message));
      return;
    }
    msg.replaceChildren();

    invMap = new Map();
    for (const row of data || []) {
      const key = bucketKey(row.product_id, row.quality_id);
      invMap.set(key, Number(row.on_hand_kg || 0));
    }

    if (!isActive()) return;
    renderTable();
  }

  await load();
}

async function pageHypothetical(pageCtx) {
  const isActive = () => isPageContextActive(pageCtx);
  const msg = h("div");
  const summaryWrap = h("div", { class: "col" });
  const tableWrap = h("div", { class: "card col" });
  const bucketToAdjustment = storageGetJson(STORAGE_KEYS.hypotheticalAdjustments, {}) || {};
  let invMap = new Map(); // key: `${productId}|${qualityId}` -> kg
  let rows = [];

  function bucketKey(productId, qualityId) {
    return `${String(productId)}|${String(qualityId)}`;
  }

  function choosePrimarySku(list) {
    const sk = (list || []).filter(Boolean);
    if (sk.length === 0) return null;
    const perKg = sk.filter((s) => String(s.default_price_model || "") === "per_kg");
    const candidates = (perKg.length ? perKg : sk).slice().sort((a, b) => Number(a.code || 0) - Number(b.code || 0));
    return candidates[0] || sk[0] || null;
  }

  function saveAdjustments() {
    storageSet(STORAGE_KEYS.hypotheticalAdjustments, JSON.stringify(bucketToAdjustment));
  }

  function parseAdjust(v) {
    const n = Number(String(v || "").trim());
    return Number.isFinite(n) ? n : 0;
  }

  function getBuckets() {
    const skus = (state.skus || []).filter((s) => s.is_active).slice().sort((a, b) => Number(a.code || 0) - Number(b.code || 0));
    const groups = new Map(); // key -> { product_id, quality_id, skus: [] }

    for (const s of skus) {
      const key = bucketKey(s.product_id, s.quality_id);
      if (!groups.has(key)) groups.set(key, { key, product_id: s.product_id, quality_id: s.quality_id, skus: [] });
      groups.get(key).skus.push(s);
    }

    for (const key of invMap.keys()) {
      if (!groups.has(key)) {
        const [pid, qid] = String(key).split("|");
        groups.set(key, { key, product_id: pid, quality_id: qid, skus: [] });
      }
    }

    return Array.from(groups.values())
      .map((g) => {
        const skList = (g.skus || []).slice().sort((a, b) => Number(a.code || 0) - Number(b.code || 0));
        const primary = choosePrimarySku(skList);
        const linked = primary ? skList.filter((s) => s.id !== primary.id) : skList;
        const codes = skList.length ? skList.map((s) => String(s.code)).join("/") : "";
        const onHand = Number(invMap.get(g.key) || 0);
        const storedAdj = Number(bucketToAdjustment[g.key]);
        const adjust = Number.isFinite(storedAdj) ? storedAdj : 0;
        const sortCode = skList.length ? Math.min(...skList.map((s) => Number(s.code || 0))) : 999999;
        const sortLabel = primary ? String(primary.name || "") : `${productName(g.product_id)} | ${qualityName(g.quality_id)}`;
        return {
          ...g,
          codes,
          primary,
          linked,
          onHand,
          adjust,
          sortCode,
          sortLabel,
        };
      })
      .sort((a, b) => (a.sortCode - b.sortCode) || String(a.sortLabel).localeCompare(String(b.sortLabel)));
  }

  function updateSummary() {
    let totalActual = 0;
    let totalAdjustment = 0;
    let totalHypothetical = 0;

    for (const r of rows) {
      totalActual += Number(r.onHand || 0);
      totalAdjustment += Number(r.adjust || 0);
      totalHypothetical += Number(r.onHand || 0) + Number(r.adjust || 0);
    }

    summaryWrap.replaceChildren(
      h("div", { class: "card col" }, [
        h("div", { class: "h1", text: "Resumen hipotetico" }),
        h("div", { class: "muted", text: "Nota: estos valores son escenario y NO se aplican al inventario real." }),
        h("div", { class: "grid2" }, [
          h("div", { class: "notice" }, [h("div", { class: "muted", text: "Inventario base total (kg)" }), h("div", { class: "mono", text: fmtKg(totalActual) })]),
          h("div", { class: "notice" }, [h("div", { class: "muted", text: "Ajuste total (kg)" }), h("div", { class: "mono", text: fmtKg(totalAdjustment) })]),
          h("div", { class: "notice" }, [h("div", { class: "muted", text: "Inventario hipotetico total (kg)" }), h("div", { class: "mono", text: fmtKg(totalHypothetical) })]),
        ]),
      ])
    );
  }

  function renderTable() {
    const hdr = h("thead", {}, [
      h("tr", {}, [
        h("th", { text: "SKU(s)" }),
        h("th", { text: "Descripcion" }),
        h("th", { text: "Inventario real (kg)" }),
        h("th", { text: "Ajuste/escenario (kg)" }),
        h("th", { text: "Inventario hipotetico (kg)" }),
      ]),
    ]);

    const bodyRows = rows.map((r) => {
      const desc = r.primary
        ? [
            h("div", { text: `${Number(r.primary.code)} ${String(r.primary.name)}` }),
            r.linked && r.linked.length
              ? h("div", { class: "muted", text: `Vinculados: ${r.linked.map((s) => `${Number(s.code)} ${String(s.name)}`).join(", ")}` })
              : null,
          ]
        : [h("div", { class: "muted", text: `${productName(r.product_id)} | ${qualityName(r.quality_id)}` })];

      const input = h("input", {
        type: "number",
        step: "0.001",
        value: String(Number(r.adjust || 0)),
      });
      const hypoCell = h("div", { class: "mono", text: fmtKg(Number(r.onHand || 0) + Number(r.adjust || 0)) });

      input.addEventListener("input", (ev) => {
        const v = parseAdjust(ev.currentTarget.value);
        const normalized = Number.isFinite(v) ? v : 0;
        r.adjust = normalized;
        bucketToAdjustment[r.key] = normalized;
        hypoCell.textContent = fmtKg(Number(r.onHand || 0) + normalized);
        saveAdjustments();
        updateSummary();
      });

      return h("tr", {}, [
        h("td", { class: "mono", text: r.codes || "" }),
        h("td", {}, desc),
        h("td", { class: "mono", text: fmtKg(r.onHand) }),
        h("td", {}, input),
        h("td", {}, hypoCell),
      ]);
    });

    tableWrap.replaceChildren(
      h("div", { class: "h1", text: "Inventario hipotetico por SKU" }),
      h("div", { class: "muted", text: "Ajusta por grupo (SKU base + SKU relacionados) para crear una simulacion rapida." }),
      tableScroll(h("table", { class: "table" }, [hdr, h("tbody", {}, bodyRows)]))
    );
  }

  const refreshBtn = h(
    "button",
    {
      class: "btn",
      type: "button",
      onclick: () => load(),
    },
    ["Actualizar inventario real"]
  );

  const resetBtn = h(
    "button",
    {
      class: "btn btn-ghost",
      type: "button",
      onclick: async () => {
        Object.keys(bucketToAdjustment).forEach((k) => delete bucketToAdjustment[k]);
        saveAdjustments();
        await load();
      },
    },
    ["Reiniciar ajuste"]
  );

  const page = h("div", { class: "col" }, [
    h("div", { class: "card col" }, [
      h("div", { class: "row-wrap" }, [
        h("div", { class: "h1", text: "Inventario Hipotetico" }),
        h("div", { class: "spacer" }),
        refreshBtn,
        resetBtn,
      ]),
      h("div", { class: "muted", text: "Se usa para calcular un escenario rapido; no guarda cambios al sistema." }),
      summaryWrap,
      msg,
    ]),
    tableWrap,
  ]);

  layout(ROUTE_TITLES.hypothetical, page);

  async function load() {
    if (!isActive()) return;
    msg.replaceChildren(notice("warn", "Cargando..."));
    const { data, error } = await supabase.from("inventory_on_hand").select("product_id,quality_id,on_hand_kg");
    if (!isActive()) return;
    if (error) {
      msg.replaceChildren(notice("error", error.message));
      return;
    }
    msg.replaceChildren();

    invMap = new Map();
    for (const row of data || []) {
      const key = bucketKey(row.product_id, row.quality_id);
      invMap.set(key, Number(row.on_hand_kg || 0));
    }

    rows = getBuckets();
    if (!isActive()) return;
    updateSummary();
    renderTable();
  }

  await load();
}

async function pageReports(pageCtx) {
  const isActive = () => isPageContextActive(pageCtx);
  const msg = h("div");
  const start = h("input", { type: "date" });
  const end = h("input", { type: "date" });

  const today = new Date();
  const pad = (x) => String(x).padStart(2, "0");
  const yyyy = today.getFullYear();
  const mm = pad(today.getMonth() + 1);
  const dd = pad(today.getDate());
  start.value = `${yyyy}-${mm}-${dd}`;
  end.value = `${yyyy}-${mm}-${dd}`;

  const out = h("div", { class: "col" });

  const runBtn = h(
    "button",
    {
      class: "btn btn-primary",
      type: "button",
      onclick: async () => {
        if (!isActive()) return;
        msg.replaceChildren();
        out.replaceChildren();
        const s = String(start.value || "");
        const e = String(end.value || "");
        if (!s || !e) {
          msg.appendChild(notice("error", "Elige fechas de inicio y fin."));
          return;
        }
        const startIso = new Date(`${s}T00:00:00`).toISOString();
        const endIso = new Date(`${e}T23:59:59`).toISOString();

        msg.appendChild(notice("warn", "Cargando..."));
        const { data, error } = await supabase
          .from("movements")
          .select(
            "id,movement_type,occurred_at,currency,from_quality_id,to_quality_id," +
              "movement_lines(sku_id,product_id,quality_id,delta_weight_kg,boxes,price_model,unit_price,line_total)"
          )
          .gte("occurred_at", startIso)
          .lte("occurred_at", endIso)
          .order("occurred_at", { ascending: true });
        if (!isActive()) return;
        msg.replaceChildren();
        if (error) {
          msg.appendChild(notice("error", error.message));
          return;
        }

        function bucketKey(productId, qualityId) {
          return `${String(productId)}|${String(qualityId)}`;
        }

        function choosePrimarySku(list) {
          const sk = (list || []).filter(Boolean);
          if (sk.length === 0) return null;
          const perKg = sk.filter((s) => String(s.default_price_model || "") === "per_kg");
          const candidates = (perKg.length ? perKg : sk).slice().sort((a, b) => Number(a.code || 0) - Number(b.code || 0));
          return candidates[0] || sk[0] || null;
        }

        const bucketSkus = new Map(); // key -> sku[]
        for (const s of state.skus || []) {
          const key = bucketKey(s.product_id, s.quality_id);
          if (!bucketSkus.has(key)) bucketSkus.set(key, []);
          bucketSkus.get(key).push(s);
        }
        for (const list of bucketSkus.values()) list.sort((a, b) => Number(a.code || 0) - Number(b.code || 0));

        const perBucket = new Map(); // bucketKey -> stats
        const perSku = new Map(); // skuId|null -> sales stats
        const overall = { entradas: 0, ventas: 0, merma: 0, traspaso: 0, revenue: 0 };

        let reportMovementIndex = 0;
        for (const m of data || []) {
          if (!isActive()) return;
          reportMovementIndex += 1;
          const lines = m.movement_lines || [];
          for (const l of lines) {
            const pid = l.product_id;
            const qid = l.quality_id;
            const key = bucketKey(pid, qid);
            if (!perBucket.has(key)) {
              perBucket.set(key, { key, product_id: pid, quality_id: qid, entradas: 0, ventas: 0, merma: 0, revenue: 0, boxes: 0 });
            }
            const st = perBucket.get(key);

            const skuId = l.sku_id || null;
            if (!perSku.has(skuId)) {
              perSku.set(skuId, { sku_id: skuId, ventas: 0, boxes: 0, revenue: 0 });
            }
            const skuSt = perSku.get(skuId);

            const d = Number(l.delta_weight_kg || 0);
            if (m.movement_type === "entrada") {
              st.entradas += Math.max(0, d);
              overall.entradas += Math.max(0, d);
            } else if (m.movement_type === "venta") {
              st.ventas += Math.max(0, -d);
              overall.ventas += Math.max(0, -d);
              if (l.line_total != null) {
                const lt = Number(l.line_total || 0);
                st.revenue += lt;
                overall.revenue += lt;
                skuSt.revenue += lt;
              }
              skuSt.ventas += Math.max(0, -d);
              if (l.boxes != null) skuSt.boxes += Number(l.boxes || 0);
              if (l.boxes != null) st.boxes += Number(l.boxes || 0);
            } else if (m.movement_type === "merma") {
              st.merma += Math.max(0, -d);
              overall.merma += Math.max(0, -d);
            } else if (m.movement_type === "traspaso_calidad" || m.movement_type === "traspaso_sku") {
              // overall traspaso as moved kg (count positive deltas only)
              if (d > 0) overall.traspaso += d;
            } else if (m.movement_type === "ajuste") {
              // ignore in KPI for now (can be added later)
            }
          }
          await maybeYield(reportMovementIndex, 20);
        }

        const overallMermaPctEntradas = overall.entradas > 0 ? (overall.merma / overall.entradas) * 100 : null;
        const overallMermaPctVentas = overall.ventas > 0 ? (overall.merma / overall.ventas) * 100 : null;

        const summary = h("div", { class: "card col" }, [
          h("div", { class: "h1", text: "Resumen" }),
          h("div", { class: "grid2" }, [
            h("div", { class: "notice" }, [h("div", { class: "muted", text: "Entradas (kg)" }), h("div", { class: "mono", text: fmtKg(overall.entradas) })]),
            h("div", { class: "notice" }, [h("div", { class: "muted", text: "Ventas (kg)" }), h("div", { class: "mono", text: fmtKg(overall.ventas) })]),
            h("div", { class: "notice" }, [h("div", { class: "muted", text: "Merma (kg)" }), h("div", { class: "mono", text: fmtKg(overall.merma) })]),
            h("div", { class: "notice" }, [h("div", { class: "muted", text: "Traspaso (kg movidos)" }), h("div", { class: "mono", text: fmtKg(overall.traspaso) })]),
          ]),
          h("div", { class: "grid2" }, [
            h("div", { class: "notice" }, [
              h("div", { class: "muted", text: "Merma % / Entradas" }),
              h("div", { class: "mono", text: overallMermaPctEntradas != null ? `${overallMermaPctEntradas.toFixed(1)}%` : "" }),
            ]),
            h("div", { class: "notice" }, [
              h("div", { class: "muted", text: "Merma % / Ventas" }),
              h("div", { class: "mono", text: overallMermaPctVentas != null ? `${overallMermaPctVentas.toFixed(1)}%` : "" }),
            ]),
          ]),
          h("div", { class: "notice" }, [
            h("div", { class: "muted", text: "Ingresos (Ventas)" }),
            h("div", { class: "mono", text: fmtMoney(overall.revenue) }),
          ]),
        ]);

        const bucketRows = Array.from(perBucket.values())
          .filter((r) => r.entradas > 0 || r.ventas > 0 || r.merma > 0 || r.revenue > 0 || r.boxes > 0)
          .map((r) => {
            const skList = (bucketSkus.get(r.key) || []).slice().sort((a, b) => Number(a.code || 0) - Number(b.code || 0));
            const primary = choosePrimarySku(skList);
            const linked = primary ? skList.filter((s) => s.id !== primary.id) : skList;
            const codes = skList.length ? skList.map((s) => String(s.code)).join("/") : "";
            const sortCode = skList.length ? Math.min(...skList.map((s) => Number(s.code || 0))) : 999999;
            const sortLabel = primary ? String(primary.name || "") : `${productName(r.product_id)} | ${qualityName(r.quality_id)}`;
            return { ...r, skus: skList, primary, linked, codes, sortCode, sortLabel };
          })
          .sort((a, b) => (a.sortCode - b.sortCode) || String(a.sortLabel).localeCompare(String(b.sortLabel)));

        const bucketTable = h("table", { class: "table" }, [
          h("thead", {}, [
            h("tr", {}, [
              h("th", { text: "SKU(s)" }),
              h("th", { text: "Entradas (kg)" }),
              h("th", { text: "Ventas (kg)" }),
              h("th", { text: "Merma (kg)" }),
              h("th", { text: "Merma % / Entradas" }),
              h("th", { text: "Merma % / Ventas" }),
              h("th", { text: "Cajas" }),
              h("th", { text: "Ingresos" }),
            ]),
          ]),
          h(
            "tbody",
            {},
            bucketRows.map((r) => {
              const mermaPctEntradas = r.entradas > 0 ? (r.merma / r.entradas) * 100 : null;
              const mermaPctVentas = r.ventas > 0 ? (r.merma / r.ventas) * 100 : null;
              const skuCell = r.primary
                ? [
                    h("div", { class: "mono", text: r.codes || "" }),
                    h("div", { text: `${Number(r.primary.code)} ${String(r.primary.name)}` }),
                    r.linked && r.linked.length
                      ? h("div", { class: "muted", text: `Vinculados: ${r.linked.map((s) => `${Number(s.code)} ${String(s.name)}`).join(", ")}` })
                      : null,
                  ]
                : [h("div", { class: "muted", text: `${productName(r.product_id)} | ${qualityName(r.quality_id)}` })];
              return h("tr", {}, [
                h("td", {}, skuCell),
                h("td", { class: "mono", text: fmtKg(r.entradas) }),
                h("td", { class: "mono", text: fmtKg(r.ventas) }),
                h("td", { class: "mono", text: fmtKg(r.merma) }),
                h("td", { class: "mono", text: mermaPctEntradas != null ? `${mermaPctEntradas.toFixed(1)}%` : "" }),
                h("td", { class: "mono", text: mermaPctVentas != null ? `${mermaPctVentas.toFixed(1)}%` : "" }),
                h("td", { class: "mono", text: r.boxes ? String(r.boxes) : "" }),
                h("td", { class: "mono", text: r.revenue ? fmtMoney(r.revenue) : "" }),
              ]);
            })
          ),
        ]);

        const skuRows = Array.from(perSku.values())
          .filter((r) => r.ventas > 0 || r.revenue > 0 || r.boxes > 0)
          .sort((a, b) => {
            const la = a.sku_id ? skuLabel(a.sku_id) : "Sin SKU";
            const lb = b.sku_id ? skuLabel(b.sku_id) : "Sin SKU";
            return la.localeCompare(lb);
          });

        const skuTable = h("table", { class: "table" }, [
          h("thead", {}, [
            h("tr", {}, [
              h("th", { text: "SKU" }),
              h("th", { text: "Ventas (kg)" }),
              h("th", { text: "Cajas" }),
              h("th", { text: "Ingresos" }),
              h("th", { text: "Precio prom/kg" }),
            ]),
          ]),
          h(
            "tbody",
            {},
            skuRows.map((r) => {
              const avgKg = r.ventas > 0 ? r.revenue / r.ventas : null;
              return h("tr", {}, [
                h("td", { class: "mono", text: r.sku_id ? skuLabel(r.sku_id) : "Sin SKU" }),
                h("td", { class: "mono", text: fmtKg(r.ventas) }),
                h("td", { class: "mono", text: r.boxes ? String(r.boxes) : "" }),
                h("td", { class: "mono", text: r.revenue ? fmtMoney(r.revenue) : "" }),
                h("td", { class: "mono", text: avgKg != null ? fmtMoney(avgKg) : "" }),
              ]);
            })
          ),
        ]);

        if (!isActive()) return;
        out.replaceChildren(
          summary,
          h("div", { class: "card col" }, [
            h("div", { class: "h1", text: "Por SKU (inventario)" }),
            h("div", { class: "muted", text: "Agrupado por inventario (SKUs vinculados comparten el mismo saldo)." }),
            tableScroll(bucketTable),
          ]),
          h("div", { class: "card col" }, [
            h("div", { class: "h1", text: "Ventas por SKU (presentacion)" }),
            h("div", { class: "muted", text: "Detalle de ventas por SKU capturado (ej: KG vs Caja)." }),
            tableScroll(skuTable),
          ])
        );
      },
    },
    ["Generar"]
  );

  const page = h("div", { class: "col" }, [
    h("div", { class: "card col" }, [
      h("div", { class: "h1", text: "Reportes" }),
      h("div", { class: "muted", text: "Totales calculados desde el kardex. (Ajustes no se incluyen en KPIs por ahora.)" }),
      msg,
      h("div", { class: "grid2" }, [field("Fecha inicio", start), field("Fecha fin", end)]),
      h("div", { class: "row-wrap" }, [runBtn]),
    ]),
    out,
  ]);

  layout(ROUTE_TITLES.reports, page);
}

async function pageCutoffs(pageCtx) {
  const isActive = () => isPageContextActive(pageCtx);
  const createMsg = h("div");
  const listMsg = h("div");
  const detailsMsg = h("div");
  const reportMsg = h("div");

  const listWrap = h("div", { class: "col" });
  const lineListWrap = h("div", { class: "col" });
  const reportOut = h("div", { class: "col" });

  let cutoffs = [];
  let selectedCutoffId = "";
  let latestKardexRows = [];
  let latestPeriodStartIso = null;
  let latestPeriodEndIso = null;
  let latestComparisonRows = [];
  let latestReportCutoffId = "";
  let applyingCutoffAdjustment = false;

  function bucketKey(productId, qualityId) {
    return `${String(productId)}|${String(qualityId)}`;
  }

  function choosePrimarySku(list) {
    const sk = (list || []).filter(Boolean);
    if (sk.length === 0) return null;
    const perKg = sk.filter((s) => String(s.default_price_model || "") === "per_kg");
    const candidates = (perKg.length ? perKg : sk).slice().sort((a, b) => Number(a.code || 0) - Number(b.code || 0));
    return candidates[0] || sk[0] || null;
  }

  function cutoffAnchorIso(cutoff) {
    return cutoff?.ended_at || cutoff?.started_at || null;
  }

  function cutoffLabel(cutoff) {
    const at = cutoffAnchorIso(cutoff);
    const label = at ? formatOccurredAt(at) : formatOccurredAt(cutoff.created_at);
    return `${label} (${String(cutoff.id).slice(0, 8)}...)`;
  }

  function sortedSkus() {
    return (state.skus || []).slice().sort((a, b) => Number(a.code || 0) - Number(b.code || 0));
  }

  function findCutoff(cutoffId) {
    return cutoffs.find((c) => c.id === cutoffId) || null;
  }

  function findPreviousCutoff(cutoffId) {
    const ordered = cutoffs
      .slice()
      .sort((a, b) => new Date(cutoffAnchorIso(a) || a.started_at).getTime() - new Date(cutoffAnchorIso(b) || b.started_at).getTime());
    const idx = ordered.findIndex((c) => c.id === cutoffId);
    if (idx <= 0) return null;
    return ordered[idx - 1] || null;
  }

  function setSkuSelectOptions(selectEl) {
    const options = sortedSkus().map((s) =>
      h("option", { value: s.id, text: `${Number.isFinite(Number(s.code)) ? String(s.code) : ""} ${String(s.name || "")}`.trim() })
    );
    selectEl.replaceChildren(h("option", { value: "", text: "Elige SKU..." }), ...options);
  }

  function setCutoffSelectOptions(selectEl, { includeEmpty = false } = {}) {
    const opts = [];
    if (includeEmpty) opts.push(h("option", { value: "", text: "Elige corte..." }));
    for (const c of cutoffs) {
      opts.push(h("option", { value: c.id, text: cutoffLabel(c) }));
    }
    selectEl.replaceChildren(...opts);
  }

  const createStarted = h("input", { type: "datetime-local", value: localNowInputValue() });
  const createEnded = h("input", { type: "datetime-local" });
  const createNotes = h("textarea", { placeholder: "Notas del corte (opcional)." });

  const detailCutoffSel = h("select");
  const detailStarted = h("input", { type: "datetime-local" });
  const detailEnded = h("input", { type: "datetime-local" });
  const detailNotes = h("textarea", { placeholder: "Notas del corte (opcional)." });

  const lineSku = h("select");
  const fixedLineDtLockOn = storageGet(STORAGE_KEYS.cutoffLineFixedDatetimeLock, "0") === "1";
  const fixedLineDtSaved = storageGet(STORAGE_KEYS.cutoffLineFixedDatetimeValue, "");
  const lineMeasuredAt = h("input", { type: "datetime-local", value: fixedLineDtLockOn && fixedLineDtSaved ? fixedLineDtSaved : localNowInputValue() });
  const lineMeasuredAtLock = h("input", { type: "checkbox" });
  lineMeasuredAtLock.checked = fixedLineDtLockOn;
  const lineWeight = h("input", { type: "number", step: "0.001", min: "0.001", placeholder: "0.000" });
  const lineNotes = h("textarea", { placeholder: "Notas del pesaje (opcional)." });
  const lineProofs = h("input", { type: "file", accept: "image/*", multiple: true });
  lineProofs.addEventListener("pointerdown", () => {
    setProofPickerOpen(true);
  });
  lineProofs.addEventListener("touchstart", () => {
    setProofPickerOpen(true);
  });
  lineProofs.addEventListener("click", () => {
    setProofPickerOpen(true);
  });
  lineProofs.addEventListener("focus", () => {
    setProofPickerOpen(true);
  });
  lineProofs.addEventListener("blur", () => {
    setProofPickerOpen(false);
  });
  lineProofs.addEventListener("change", () => {
    setProofPickerOpen(false);
  });
  lineProofs.addEventListener("cancel", () => {
    setProofPickerOpen(false);
  });

  const reportCutoffSel = h("select");
  const reportIncludeAdjustments = h("select");
  const reportApplyDiscrepancy = h("select");

  setSkuSelectOptions(lineSku);
  const includeAdjustmentsSaved = storageGet(STORAGE_KEYS.cutoffReportIncludeAdjustments, "with");
  const applyDiscrepancySaved = storageGet(STORAGE_KEYS.cutoffReportApplyDiscrepancy, "without");
  reportIncludeAdjustments.replaceChildren(
    h("option", { value: "with", text: "Con ajustes previos de cortes" }),
    h("option", { value: "without", text: "Sin ajustes previos de cortes" })
  );
  reportApplyDiscrepancy.replaceChildren(
    h("option", { value: "without", text: "Sin aplicar discrepancia actual" }),
    h("option", { value: "with", text: "Aplicar discrepancia actual (snapshot)" })
  );
  reportIncludeAdjustments.value = includeAdjustmentsSaved === "without" ? "without" : "with";
  reportApplyDiscrepancy.value = applyDiscrepancySaved === "with" ? "with" : "without";

  reportIncludeAdjustments.addEventListener("change", () => {
    storageSet(STORAGE_KEYS.cutoffReportIncludeAdjustments, String(reportIncludeAdjustments.value || "with"));
  });
  reportApplyDiscrepancy.addEventListener("change", () => {
    storageSet(STORAGE_KEYS.cutoffReportApplyDiscrepancy, String(reportApplyDiscrepancy.value || "without"));
  });

  lineMeasuredAt.addEventListener("change", () => {
    if (lineMeasuredAtLock.checked) {
      storageSet(STORAGE_KEYS.cutoffLineFixedDatetimeValue, String(lineMeasuredAt.value || ""));
    }
  });

  lineMeasuredAtLock.addEventListener("change", () => {
    storageSet(STORAGE_KEYS.cutoffLineFixedDatetimeLock, lineMeasuredAtLock.checked ? "1" : "0");
    if (lineMeasuredAtLock.checked) {
      if (!lineMeasuredAt.value) lineMeasuredAt.value = localNowInputValue();
      storageSet(STORAGE_KEYS.cutoffLineFixedDatetimeValue, String(lineMeasuredAt.value || ""));
    }
  });

  async function loadCutoffs() {
    if (!isActive()) return;
    listMsg.replaceChildren(notice("warn", "Cargando cortes..."));
    const { data, error } = await supabase
      .from("physical_cutoffs")
      .select("id,started_at,ended_at,notes,created_at")
      .order("started_at", { ascending: false })
      .limit(100);
    if (!isActive()) return;
    if (error) {
      listMsg.replaceChildren(notice("error", error.message));
      return;
    }

    cutoffs = data || [];
    if (selectedCutoffId && !cutoffs.some((c) => c.id === selectedCutoffId)) {
      selectedCutoffId = "";
    }
    if (!selectedCutoffId && cutoffs.length > 0) {
      selectedCutoffId = cutoffs[0].id;
    }

    setCutoffSelectOptions(detailCutoffSel, { includeEmpty: true });
    setCutoffSelectOptions(reportCutoffSel, { includeEmpty: true });
    if (selectedCutoffId) {
      detailCutoffSel.value = selectedCutoffId;
      reportCutoffSel.value = selectedCutoffId;
    }

    renderCutoffList();
    await loadCutoffDetails();
    if (!isActive()) return;
    listMsg.replaceChildren();
  }

  function renderCutoffList() {
    if (cutoffs.length === 0) {
      listWrap.replaceChildren(notice("warn", "Todavia no hay cortes fisicos."));
      return;
    }

    listWrap.replaceChildren(
      ...cutoffs.map((c) => {
        const openBtn = h(
          "button",
          {
            class: "btn",
            type: "button",
            onclick: async () => {
              selectedCutoffId = c.id;
              detailCutoffSel.value = c.id;
              reportCutoffSel.value = c.id;
              await loadCutoffDetails();
            },
          },
          ["Abrir"]
        );
        return h("div", { class: "notice" }, [
          h("div", { class: "row-wrap" }, [
            h("div", { class: "mono", text: cutoffLabel(c) }),
            h("div", { class: "spacer" }),
            openBtn,
          ]),
          c.notes ? h("div", { class: "muted", text: String(c.notes) }) : null,
          h("div", { class: "muted", text: `Inicio: ${formatOccurredAt(c.started_at)}` }),
          c.ended_at ? h("div", { class: "muted", text: `Cierre: ${formatOccurredAt(c.ended_at)}` }) : h("div", { class: "muted", text: "Cierre: pendiente" }),
        ]);
      })
    );
  }

  async function loadCutoffLines(cutoffId) {
    const { data, error } = await supabase
      .from("physical_cutoff_lines")
      .select(
        "id,cutoff_id,sku_id,measured_at,weight_kg,notes,created_at," +
          "physical_cutoff_attachments(id,storage_path,original_filename,content_type,size_bytes)"
      )
      .eq("cutoff_id", cutoffId)
      .order("measured_at", { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async function loadCutoffDetails() {
    if (!isActive()) return;
    detailsMsg.replaceChildren();
    lineListWrap.replaceChildren();

    const cutoffId = String(detailCutoffSel.value || selectedCutoffId || "");
    selectedCutoffId = cutoffId;
    if (!cutoffId) {
      lineListWrap.replaceChildren(notice("warn", "Elige un corte para ver detalle y cargar pesajes."));
      return;
    }

    const cutoff = findCutoff(cutoffId);
    if (!cutoff) {
      lineListWrap.replaceChildren(notice("error", "El corte seleccionado no existe."));
      return;
    }

    detailStarted.value = localInputValueFromIso(cutoff.started_at);
    detailEnded.value = cutoff.ended_at ? localInputValueFromIso(cutoff.ended_at) : "";
    detailNotes.value = String(cutoff.notes || "");

    lineListWrap.replaceChildren(notice("warn", "Cargando pesajes..."));
    try {
      const lines = await loadCutoffLines(cutoffId);
      if (!isActive()) return;
      const totalKg = lines.reduce((acc, l) => acc + Number(l.weight_kg || 0), 0);

      if (lines.length === 0) {
        lineListWrap.replaceChildren(
          h("div", { class: "notice" }, [
            h("div", { class: "muted", text: "Sin pesajes en este corte." }),
            h("div", { class: "mono", text: `Total fisico: ${fmtKg(0)} kg` }),
          ])
        );
        return;
      }

      const table = h("table", { class: "table" }, [
        h("thead", {}, [
          h("tr", {}, [
            h("th", { text: "Fecha/hora" }),
            h("th", { text: "SKU" }),
            h("th", { text: "Kg" }),
            h("th", { text: "Evidencia" }),
            h("th", { text: "Notas" }),
            h("th", { text: "" }),
          ]),
        ]),
        h(
          "tbody",
          {},
          lines.map((ln) => {
            const att = ln.physical_cutoff_attachments || [];
            const viewBtn =
              att.length > 0
                ? h(
                    "button",
                    {
                      class: "btn",
                      type: "button",
                      onclick: async () => {
                        const first = att[0];
                        const { data } = await supabase.storage
                          .from("physical-cutoff-proofs")
                          .createSignedUrl(first.storage_path, 60 * 30);
                        if (!isActive()) return;
                        if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener,noreferrer");
                      },
                    },
                    [`Ver (${att.length})`]
                  )
                : h("span", { class: "muted", text: "Sin evidencia" });

            const deleteBtn = h(
              "button",
              {
                class: "btn btn-danger",
                type: "button",
                onclick: async () => {
                  if (!confirm("Eliminar este pesaje?")) return;
                  const paths = (att || []).map((a) => a.storage_path).filter(Boolean);
                  const { error: delErr } = await supabase.from("physical_cutoff_lines").delete().eq("id", ln.id);
                  if (delErr) {
                    detailsMsg.replaceChildren(notice("error", delErr.message));
                    return;
                  }
                  if (paths.length > 0) {
                    try {
                      await supabase.storage.from("physical-cutoff-proofs").remove(paths);
                    } catch {
                      // ignore
                    }
                  }
                  detailsMsg.replaceChildren(notice("ok", "Pesaje eliminado."));
                  await loadCutoffDetails();
                },
              },
              ["Eliminar"]
            );

            return h("tr", {}, [
              h("td", { class: "mono", text: formatOccurredAt(ln.measured_at) }),
              h("td", { class: "mono", text: skuLabel(ln.sku_id) || "(SKU desconocido)" }),
              h("td", { class: "mono", text: fmtKg(ln.weight_kg) }),
              h("td", {}, [viewBtn]),
              h("td", { text: String(ln.notes || "") }),
              h("td", {}, [deleteBtn]),
            ]);
          })
        ),
      ]);

      lineListWrap.replaceChildren(
        h("div", { class: "row-wrap" }, [
          h("div", { class: "h1", text: "Pesajes del corte" }),
          h("div", { class: "spacer" }),
          h("div", { class: "mono", text: `Total fisico: ${fmtKg(totalKg)} kg` }),
        ]),
        tableScroll(table)
      );
    } catch (e) {
      lineListWrap.replaceChildren(notice("error", e?.message ? String(e.message) : "No se pudieron cargar los pesajes."));
    }
  }

  const createBtn = h(
    "button",
    {
      class: "btn btn-primary",
      type: "button",
      onclick: async () => {
        if (!isActive()) return;
        createMsg.replaceChildren();
        const startedIso = isoFromLocalInput(String(createStarted.value || ""));
        const endedIso = createEnded.value ? isoFromLocalInput(String(createEnded.value || "")) : null;
        if (!startedIso) {
          createMsg.appendChild(notice("error", "Fecha/hora de inicio invalida."));
          return;
        }
        if (createEnded.value && !endedIso) {
          createMsg.appendChild(notice("error", "Fecha/hora de cierre invalida."));
          return;
        }
        if (endedIso && new Date(endedIso).getTime() < new Date(startedIso).getTime()) {
          createMsg.appendChild(notice("error", "Cierre no puede ser antes que inicio."));
          return;
        }

        const { data, error } = await supabase
          .from("physical_cutoffs")
          .insert({
            started_at: startedIso,
            ended_at: endedIso,
            notes: String(createNotes.value || "").trim() || null,
          })
          .select("id")
          .single();
        if (error) {
          createMsg.appendChild(notice("error", error.message));
          return;
        }

        selectedCutoffId = data.id;
        detailCutoffSel.value = data.id;
        reportCutoffSel.value = data.id;
        createNotes.value = "";
        createMsg.appendChild(notice("ok", "Corte creado."));
        await loadCutoffs();
      },
    },
    ["Crear corte"]
  );

  const saveCutoffBtn = h(
    "button",
    {
      class: "btn",
      type: "button",
      onclick: async () => {
        if (!isActive()) return;
        detailsMsg.replaceChildren();
        const cutoffId = String(detailCutoffSel.value || "");
        if (!cutoffId) {
          detailsMsg.appendChild(notice("error", "Elige un corte."));
          return;
        }
        const startedIso = isoFromLocalInput(String(detailStarted.value || ""));
        const endedIso = detailEnded.value ? isoFromLocalInput(String(detailEnded.value || "")) : null;
        if (!startedIso) {
          detailsMsg.appendChild(notice("error", "Inicio invalido."));
          return;
        }
        if (detailEnded.value && !endedIso) {
          detailsMsg.appendChild(notice("error", "Cierre invalido."));
          return;
        }
        if (endedIso && new Date(endedIso).getTime() < new Date(startedIso).getTime()) {
          detailsMsg.appendChild(notice("error", "Cierre no puede ser antes que inicio."));
          return;
        }

        const { error } = await supabase
          .from("physical_cutoffs")
          .update({
            started_at: startedIso,
            ended_at: endedIso,
            notes: String(detailNotes.value || "").trim() || null,
          })
          .eq("id", cutoffId);
        if (error) {
          detailsMsg.appendChild(notice("error", error.message));
          return;
        }
        detailsMsg.appendChild(notice("ok", "Corte actualizado."));
        await loadCutoffs();
      },
    },
    ["Guardar corte"]
  );

  const deleteCutoffBtn = h(
    "button",
    {
      class: "btn btn-danger",
      type: "button",
      onclick: async () => {
        if (!isActive()) return;
        detailsMsg.replaceChildren();
        const cutoffId = String(detailCutoffSel.value || "");
        if (!cutoffId) {
          detailsMsg.appendChild(notice("error", "Elige un corte."));
          return;
        }
        if (!confirm("Eliminar este corte y todos sus pesajes/evidencias?")) return;

        // Best-effort: remove storage objects first, then DB rows.
        try {
          const { data: rows } = await supabase
            .from("physical_cutoff_lines")
            .select("physical_cutoff_attachments(storage_path)")
            .eq("cutoff_id", cutoffId);
          const paths = [];
          for (const r of rows || []) {
            for (const a of r.physical_cutoff_attachments || []) {
              if (a.storage_path) paths.push(a.storage_path);
            }
          }
          if (paths.length > 0) {
            try {
              await supabase.storage.from("physical-cutoff-proofs").remove(paths);
            } catch {
              // ignore
            }
          }
        } catch {
          // ignore
        }

        const { error } = await supabase.from("physical_cutoffs").delete().eq("id", cutoffId);
        if (error) {
          detailsMsg.appendChild(notice("error", error.message));
          return;
        }
        detailsMsg.appendChild(notice("ok", "Corte eliminado."));
        selectedCutoffId = "";
        await loadCutoffs();
      },
    },
    ["Eliminar corte"]
  );

  const addLineBtn = h(
    "button",
    {
      class: "btn btn-primary",
      type: "button",
      onclick: async () => {
        if (!isActive()) return;
        detailsMsg.replaceChildren();
        const cutoffId = String(detailCutoffSel.value || selectedCutoffId || "");
        if (!cutoffId) {
          detailsMsg.appendChild(notice("error", "Elige un corte."));
          return;
        }
        const skuId = String(lineSku.value || "");
        if (!skuId) {
          detailsMsg.appendChild(notice("error", "Elige un SKU."));
          return;
        }
        const measuredIso = isoFromLocalInput(String(lineMeasuredAt.value || ""));
        if (!measuredIso) {
          detailsMsg.appendChild(notice("error", "Fecha/hora de pesaje invalida."));
          return;
        }
        const weight = Number(lineWeight.value);
        if (!Number.isFinite(weight) || weight <= 0) {
          detailsMsg.appendChild(notice("error", "Kg invalidos."));
          return;
        }

        const userId = state.session?.user?.id;
        if (!userId) {
          detailsMsg.appendChild(notice("error", "Sesion invalida."));
          return;
        }

        const files = Array.from(lineProofs.files || []);
        const lineId = crypto.randomUUID();
        const uploaded = [];
        try {
          const { error: lineErr } = await supabase.from("physical_cutoff_lines").insert({
            id: lineId,
            cutoff_id: cutoffId,
            sku_id: skuId,
            measured_at: measuredIso,
            weight_kg: weight,
            notes: String(lineNotes.value || "").trim() || null,
          });
          if (lineErr) throw lineErr;

          const preparedFiles = await prepareProofFiles(files, {
            label: "evidencia de corte",
            onProgress: (idx, total, label) => {
              detailsMsg.replaceChildren(notice("warn", `${label} ${idx}/${total}`));
            },
          });
          if (!isActive()) return;

          for (let i = 0; i < preparedFiles.length; i++) {
            const p = preparedFiles[i];
            const safe = sanitizeFilename(p.file?.name || "proof");
            const path = `${userId}/${cutoffId}/${lineId}/${Date.now()}_${i}_${safe}`;
            const sourceType = p.file?.type || "application/octet-stream";
            detailsMsg.replaceChildren(notice("warn", `Subiendo evidencia ${i + 1}/${preparedFiles.length}...`));
            const { error: upErr } = await withTimeout(
              supabase.storage.from("physical-cutoff-proofs").upload(path, p.file, {
                cacheControl: "3600",
                upsert: false,
                contentType: sourceType,
              }),
              NETWORK_TIMEOUT_MS,
              `Subida de evidencia de corte ${i + 1}`
            );
            if (upErr) throw upErr;
            uploaded.push({
              cutoff_line_id: lineId,
              storage_bucket: "physical-cutoff-proofs",
              storage_path: path,
              original_filename: p.original_filename || null,
              content_type: p.original_content_type || sourceType || null,
              size_bytes: Number.isFinite(p.upload_size) ? p.upload_size : null,
            });
            await maybeYield(i + 1, 1);
            if (!isActive()) return;
          }

          if (uploaded.length > 0) {
            const { error: attErr } = await supabase.from("physical_cutoff_attachments").insert(uploaded);
            if (attErr) throw attErr;
          }
          if (!isActive()) return;

          lineWeight.value = "";
          lineNotes.value = "";
          lineProofs.value = "";
          if (lineMeasuredAtLock.checked) {
            storageSet(STORAGE_KEYS.cutoffLineFixedDatetimeValue, String(lineMeasuredAt.value || ""));
          } else {
            lineMeasuredAt.value = localNowInputValue();
          }
          detailsMsg.appendChild(notice("ok", "Pesaje guardado."));
          await loadCutoffDetails();
        } catch (e) {
          if (uploaded.length > 0) {
            try {
              await supabase.storage
                .from("physical-cutoff-proofs")
                .remove(uploaded.map((u) => u.storage_path));
            } catch {
              // ignore
            }
          }
          detailsMsg.appendChild(notice("error", e?.message ? String(e.message) : "No se pudo guardar el pesaje."));
        }
      },
    },
    ["Guardar pesaje"]
  );

  const exportKardexBtn = h(
    "button",
    {
      class: "btn",
      type: "button",
      onclick: () => {
        reportMsg.replaceChildren();
        if (!latestPeriodEndIso) {
          reportMsg.appendChild(notice("warn", "Genera el reporte antes de exportar."));
          return;
        }
        const header = [
          "movement_id",
          "movement_type",
          "occurred_at",
          "sku",
          "product",
          "quality",
          "delta_weight_kg",
          "boxes",
          "price_model",
          "unit_price",
          "line_total",
          "notes",
        ];
        const lines = [header.join(",")];
        for (const row of latestKardexRows) {
          const csvRow = [
            row.movement_id,
            row.movement_type,
            row.occurred_at,
            row.sku_label,
            row.product_name,
            row.quality_name,
            fmtKg(row.delta_weight_kg),
            row.boxes != null ? String(row.boxes) : "",
            row.price_model || "",
            row.unit_price != null ? String(row.unit_price) : "",
            row.line_total != null ? String(row.line_total) : "",
            String(row.notes || "").replaceAll("\n", " "),
          ];
          lines.push(csvRow.map((v) => `"${String(v ?? "").replaceAll("\"", "\"\"")}"`).join(","));
        }
        const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const startLabel = latestPeriodStartIso ? String(latestPeriodStartIso).slice(0, 10) : "inicio";
        const endLabel = String(latestPeriodEndIso).slice(0, 10);
        const a = h("a", { href: url, download: `kardex_corte_${startLabel}_a_${endLabel}.csv` });
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        reportMsg.appendChild(notice("ok", "Excel (CSV) descargado."));
      },
    },
    ["Exportar Kardex (Excel CSV)"]
  );

  const printBtn = h(
    "button",
    {
      class: "btn",
      type: "button",
      onclick: () => window.print(),
    },
    ["Imprimir reporte"]
  );

  async function generateReport() {
    if (!isActive()) return;
    reportMsg.replaceChildren();
    reportOut.replaceChildren();
    latestKardexRows = [];
    latestPeriodStartIso = null;
    latestPeriodEndIso = null;
    latestComparisonRows = [];
    latestReportCutoffId = "";

    const cutoffId = String(reportCutoffSel.value || selectedCutoffId || "");
    if (!cutoffId) {
      reportMsg.appendChild(notice("error", "Elige un corte."));
      return;
    }
    const cutoff = findCutoff(cutoffId);
    if (!cutoff) {
      reportMsg.appendChild(notice("error", "Corte no encontrado."));
      return;
    }
    const includeAdjustments = reportIncludeAdjustments.value === "with";
    const applyCurrentDiscrepancy = reportApplyDiscrepancy.value === "with";

    const cutoffEndIso = cutoffAnchorIso(cutoff);
    if (!cutoffEndIso) {
      reportMsg.appendChild(notice("error", "El corte no tiene fecha valida para comparar."));
      return;
    }

    const prevCutoff = findPreviousCutoff(cutoffId);
    const periodStartIso = prevCutoff ? cutoffAnchorIso(prevCutoff) : null;

    reportMsg.appendChild(notice("warn", "Generando reporte..."));

    const { data: physicalLines, error: physicalErr } = await supabase
      .from("physical_cutoff_lines")
      .select("id,sku_id,measured_at,weight_kg,notes")
      .eq("cutoff_id", cutoffId)
      .order("measured_at", { ascending: true });
    if (!isActive()) return;
    if (physicalErr) {
      reportMsg.replaceChildren(notice("error", physicalErr.message));
      return;
    }

    const { data: allMoves, error: allMovesErr } = await supabase
      .from("movements")
      .select("id,movement_type,occurred_at,movement_lines(product_id,quality_id,delta_weight_kg)")
      .lte("occurred_at", cutoffEndIso)
      .order("occurred_at", { ascending: true });
    if (!isActive()) return;
    if (allMovesErr) {
      reportMsg.replaceChildren(notice("error", allMovesErr.message));
      return;
    }

    let periodQuery = supabase
      .from("movements")
      .select(
        "id,movement_type,occurred_at,notes,currency," +
          "movement_lines(sku_id,product_id,quality_id,delta_weight_kg,boxes,price_model,unit_price,line_total)"
      )
      .order("occurred_at", { ascending: true });
    if (periodStartIso) periodQuery = periodQuery.gt("occurred_at", periodStartIso);
    periodQuery = periodQuery.lte("occurred_at", cutoffEndIso);
    const { data: periodMoves, error: periodErr } = await periodQuery;
    if (!isActive()) return;
    if (periodErr) {
      reportMsg.replaceChildren(notice("error", periodErr.message));
      return;
    }

    const physicalByBucket = new Map();
    let physicalIndex = 0;
    for (const ln of physicalLines || []) {
      if (!isActive()) return;
      await maybeYield(++physicalIndex, 25);
      const sku = skuById(ln.sku_id);
      if (!sku) continue;
      const key = bucketKey(sku.product_id, sku.quality_id);
      physicalByBucket.set(key, Number(physicalByBucket.get(key) || 0) + Number(ln.weight_kg || 0));
    }

    const expectedByBucket = new Map();
    let allMoveIndex = 0;
    for (const m of allMoves || []) {
      if (!includeAdjustments && String(m.movement_type || "") === "ajuste") continue;
      if (!isActive()) return;
      await maybeYield(++allMoveIndex, 20);
      for (const l of m.movement_lines || []) {
        const key = bucketKey(l.product_id, l.quality_id);
        expectedByBucket.set(key, Number(expectedByBucket.get(key) || 0) + Number(l.delta_weight_kg || 0));
      }
    }

    const bucketSkus = new Map();
    for (const s of state.skus || []) {
      const key = bucketKey(s.product_id, s.quality_id);
      if (!bucketSkus.has(key)) bucketSkus.set(key, []);
      bucketSkus.get(key).push(s);
    }
    for (const skList of bucketSkus.values()) {
      skList.sort((a, b) => Number(a.code || 0) - Number(b.code || 0));
    }

    const keys = new Set([...physicalByBucket.keys(), ...expectedByBucket.keys()]);
    const rows = [];
    let rowBuildIndex = 0;
    for (const key of keys) {
      if (!isActive()) return;
      const skList = (bucketSkus.get(key) || []).slice().sort((a, b) => Number(a.code || 0) - Number(b.code || 0));
      const primary = choosePrimarySku(skList);
      const codes = skList.length ? skList.map((s) => String(s.code)).join("/") : "";
      const expected = Number(expectedByBucket.get(key) || 0);
      const physical = Number(physicalByBucket.get(key) || 0);
      const expectedForView = applyCurrentDiscrepancy ? expected + (physical - expected) : expected;
      const diff = physical - expectedForView;
      const pct = Math.abs(expectedForView) > 0 ? (diff / Math.abs(expectedForView)) * 100 : physical === 0 ? 0 : null;
      const sortCode = skList.length ? Math.min(...skList.map((s) => Number(s.code || 0))) : 999999;
      rows.push({
        key,
        product_id: String(key).split("|")[0] || null,
        quality_id: String(key).split("|")[1] || null,
        expected: expectedForView,
        physical,
        diff,
        pct,
        primary,
        skList,
        codes,
        sortCode,
      });
      await maybeYield(++rowBuildIndex, 20);
    }

    const comparableRows = rows
      .filter((r) => Math.abs(r.expected) > 0 || Math.abs(r.physical) > 0)
      .sort((a, b) => (a.sortCode - b.sortCode) || String(skuLabel(a.primary?.id || "")).localeCompare(String(skuLabel(b.primary?.id || ""))));

    const discrepancyRows = comparableRows.filter((r) => Math.abs(r.diff) > 0.0005);
    const totalExpected = comparableRows.reduce((acc, r) => acc + r.expected, 0);
    const totalPhysical = comparableRows.reduce((acc, r) => acc + r.physical, 0);
    const totalDiff = totalPhysical - totalExpected;
    const totalPct = Math.abs(totalExpected) > 0 ? (totalDiff / Math.abs(totalExpected)) * 100 : null;
    const reportModeTxt = `${includeAdjustments ? "Con" : "Sin"} ajustes previos de cortes; ${
      applyCurrentDiscrepancy ? "Discrepancia actual aplicada (snapshot)" : "Discrepancia actual sin aplicar"
    }`;

    const compareTable = h("table", { class: "table" }, [
      h("thead", {}, [
        h("tr", {}, [
          h("th", { text: "SKU(s)" }),
          h("th", { text: "Descripcion" }),
          h("th", { text: "Fisico (kg)" }),
          h("th", { text: "Sistema (kg)" }),
          h("th", { text: "Diferencia (kg)" }),
          h("th", { text: "Diferencia %" }),
        ]),
      ]),
      h(
        "tbody",
        {},
          comparableRows.map((r) => {
          const diffTxt = `${r.diff > 0 ? "+" : ""}${fmtKg(r.diff)}`;
          const pctTxt = r.pct == null ? "N/A" : `${r.pct > 0 ? "+" : ""}${r.pct.toFixed(2)}%`;
          const desc = r.primary
            ? `${Number(r.primary.code)} ${String(r.primary.name)}`
            : r.skList.length
              ? r.skList.map((s) => String(s.name)).join(", ")
              : "(Sin SKU)";
          return h("tr", {}, [
            h("td", { class: "mono", text: r.codes || "" }),
            h("td", { text: desc }),
            h("td", { class: "mono", text: fmtKg(r.physical) }),
            h("td", { class: "mono", text: fmtKg(r.expected) }),
            h("td", { class: `mono ${r.diff >= 0 ? "delta-pos" : "delta-neg"}`, text: diffTxt }),
            h("td", { class: `mono ${r.pct != null && r.pct >= 0 ? "delta-pos" : "delta-neg"}`, text: pctTxt }),
          ]);
        })
      ),
    ]);

    const kardexRows = [];
    let kardexMovementIndex = 0;
    const periodRowsForReport = (periodMoves || []).filter((m) => includeAdjustments || String(m.movement_type || "") !== "ajuste");
    for (const m of periodRowsForReport) {
      if (!isActive()) return;
      const lines = m.movement_lines || [];
      for (const l of lines) {
        kardexRows.push({
          movement_id: m.id,
          movement_type: m.movement_type,
          occurred_at: m.occurred_at,
          sku_label: skuLabel(l.sku_id) || "",
          product_name: productName(l.product_id),
          quality_name: qualityName(l.quality_id),
          delta_weight_kg: Number(l.delta_weight_kg || 0),
          boxes: l.boxes != null ? Number(l.boxes || 0) : null,
          price_model: l.price_model || "",
          unit_price: l.unit_price != null ? Number(l.unit_price) : null,
          line_total: l.line_total != null ? Number(l.line_total) : null,
          notes: String(m.notes || ""),
          currency: String(m.currency || DEFAULT_CURRENCY),
        });
      }
      await maybeYield(++kardexMovementIndex, 20);
    }

    latestKardexRows = kardexRows;
    latestPeriodStartIso = periodStartIso;
    latestPeriodEndIso = cutoffEndIso;
    latestComparisonRows = comparableRows;
    latestReportCutoffId = cutoffId;

    const kardexTable =
      kardexRows.length > 0
        ? h("table", { class: "table" }, [
            h("thead", {}, [
              h("tr", {}, [
                h("th", { text: "Fecha/hora" }),
                h("th", { text: "Tipo" }),
                h("th", { text: "SKU" }),
                h("th", { text: "Producto" }),
                h("th", { text: "Calidad" }),
                h("th", { text: "Delta (kg)" }),
                h("th", { text: "Cajas" }),
                h("th", { text: "Precio" }),
                h("th", { text: "Total" }),
                h("th", { text: "Notas" }),
              ]),
            ]),
            h(
              "tbody",
              {},
              kardexRows.map((r) => {
                const price =
                  r.unit_price != null && r.price_model
                    ? r.price_model === "per_box"
                      ? `${fmtMoney(r.unit_price, r.currency)} / caja`
                      : `${fmtMoney(r.unit_price, r.currency)} / kg`
                    : "";
                const total = r.line_total != null ? fmtMoney(r.line_total, r.currency) : "";
                return h("tr", {}, [
                  h("td", { class: "mono", text: formatOccurredAt(r.occurred_at) }),
                  h("td", { text: movementLabel(r.movement_type) }),
                  h("td", { class: "mono", text: r.sku_label }),
                  h("td", { text: r.product_name }),
                  h("td", { text: r.quality_name }),
                  h("td", { class: "mono", text: fmtKg(r.delta_weight_kg) }),
                  h("td", { class: "mono", text: r.boxes != null ? String(r.boxes) : "" }),
                  h("td", { text: price }),
                  h("td", { class: "mono", text: total }),
                  h("td", { text: r.notes }),
                ]);
              })
            ),
          ])
        : h("div", { class: "notice" }, [h("div", { class: "muted", text: "Sin movimientos en el periodo entre cortes." })]);

    if (!isActive()) return;
    reportOut.replaceChildren(
      h("div", { class: "card col" }, [
        h("div", { class: "h1", text: "Resumen de corte" }),
        h("div", { class: "muted", text: `Corte actual: ${cutoffLabel(cutoff)}` }),
        h("div", { class: "muted", text: `Modo de comparacion: ${reportModeTxt}` }),
        prevCutoff ? h("div", { class: "muted", text: `Corte previo: ${cutoffLabel(prevCutoff)}` }) : h("div", { class: "muted", text: "Corte previo: no existe (primer corte)." }),
        h("div", { class: "muted", text: `Periodo kardex: ${periodStartIso ? formatOccurredAt(periodStartIso) : "Inicio historico"} -> ${formatOccurredAt(cutoffEndIso)}` }),
        h("div", { class: "grid2" }, [
          h("div", { class: "notice" }, [h("div", { class: "muted", text: "Fisico total (kg)" }), h("div", { class: "mono", text: fmtKg(totalPhysical) })]),
          h("div", { class: "notice" }, [h("div", { class: "muted", text: "Sistema total (kg)" }), h("div", { class: "mono", text: fmtKg(totalExpected) })]),
          h("div", { class: "notice" }, [
            h("div", { class: "muted", text: "Diferencia total (kg)" }),
            h("div", { class: `mono ${totalDiff >= 0 ? "delta-pos" : "delta-neg"}`, text: `${totalDiff > 0 ? "+" : ""}${fmtKg(totalDiff)}` }),
          ]),
          h("div", { class: "notice" }, [
            h("div", { class: "muted", text: "Diferencia total %" }),
            h("div", { class: `mono ${totalPct != null && totalPct >= 0 ? "delta-pos" : "delta-neg"}`, text: totalPct == null ? "N/A" : `${totalPct > 0 ? "+" : ""}${totalPct.toFixed(2)}%` }),
          ]),
        ]),
      ]),
      h("div", { class: "card col" }, [
        h("div", { class: "h1", text: "Comparacion fisico vs sistema por SKU" }),
        h("div", { class: "muted", text: `Discrepancias detectadas: ${discrepancyRows.length}` }),
        tableScroll(compareTable),
      ]),
      h("div", { class: "card col" }, [
        h("div", { class: "h1", text: "Kardex del periodo entre cortes" }),
        h("div", { class: "muted", text: "Este detalle se exporta a Excel (CSV)." }),
        tableScroll(kardexTable),
      ])
    );

    if (!isActive()) return;
    reportMsg.replaceChildren(notice("ok", "Reporte generado."));
  }

  const generateReportBtn = h(
    "button",
    {
      class: "btn btn-primary",
      type: "button",
      onclick: generateReport,
    },
    ["Generar reporte de corte"]
  );

  const applyCutoffBtn = h(
    "button",
    {
      class: "btn btn-primary",
      type: "button",
      onclick: async () => {
        reportMsg.replaceChildren();
        if (applyingCutoffAdjustment) return;
        if (!latestReportCutoffId) {
          reportMsg.appendChild(notice("warn", "Primero genera el reporte del corte a aplicar."));
          return;
        }

        const cutoff = findCutoff(latestReportCutoffId);
        if (!cutoff) {
          reportMsg.appendChild(notice("error", "No se encontro el corte del ultimo reporte."));
          return;
        }

        const diffs = (latestComparisonRows || []).filter((r) => Math.abs(Number(r.diff || 0)) > 0.0005);
        if (diffs.length === 0) {
          reportMsg.appendChild(notice("ok", "No hay discrepancias que aplicar."));
          return;
        }

        const anchorIso = cutoffAnchorIso(cutoff);
        const anchorMs = new Date(anchorIso || "").getTime();
        if (!Number.isFinite(anchorMs)) {
          reportMsg.appendChild(notice("error", "Fecha/hora invalida del corte."));
          return;
        }
        const occurredAt = new Date(anchorMs + 1000).toISOString(); // next instant after cutoff

        const noteToken = `AUTO_CORTE:${latestReportCutoffId}`;
        const note = `Ajuste automatico por corte ${latestReportCutoffId} (${noteToken})`;

        const { data: existing, error: existingErr } = await supabase
          .from("movements")
          .select("id,occurred_at")
          .eq("movement_type", "ajuste")
          .ilike("notes", `%${noteToken}%`)
          .order("occurred_at", { ascending: false })
          .limit(1);
        if (existingErr) {
          reportMsg.appendChild(notice("error", existingErr.message));
          return;
        }
        if ((existing || []).length > 0) {
          reportMsg.appendChild(
            notice(
              "warn",
              `Este corte ya tiene ajuste aplicado (${String(existing[0].id).slice(0, 8)}...). No se aplico de nuevo.`
            )
          );
          return;
        }

        const lines = diffs.map((r) => ({
          sku_id: r.primary?.id || null,
          product_id: r.product_id,
          quality_id: r.quality_id,
          delta_weight_kg: Number(r.diff),
          boxes: null,
          price_model: null,
          unit_price: null,
          line_total: null,
        }));

        const movementId = crypto.randomUUID();
        const setApplying = (on) => {
          applyingCutoffAdjustment = on;
          applyCutoffBtn.disabled = on;
          applyCutoffBtn.textContent = on ? "Aplicando ajuste..." : "Aplicar diferencia al sistema";
        };

        try {
          setApplying(true);
          const { data: newId, error } = await withTimeout(
            supabase.rpc("create_movement_with_lines", {
              movement: {
                id: movementId,
                movement_type: "ajuste",
                occurred_at: occurredAt,
                notes: note,
                currency: DEFAULT_CURRENCY,
              },
              lines,
              attachments: [],
            }),
            NETWORK_TIMEOUT_MS,
            "Aplicacion de ajuste por corte"
          );
          if (error) throw error;

          reportMsg.appendChild(
            notice(
              "ok",
              `Ajuste aplicado (${String(newId).slice(0, 8)}...). Se usara como base para periodos posteriores a este corte.`
            )
          );
        } catch (e) {
          reportMsg.appendChild(
            notice("error", e?.message ? String(e.message) : "No se pudo aplicar el ajuste automatico del corte.")
          );
        } finally {
          setApplying(false);
        }
      },
    },
    ["Aplicar diferencia al sistema"]
  );

  detailCutoffSel.addEventListener("change", () => {
    selectedCutoffId = String(detailCutoffSel.value || "");
    if (selectedCutoffId) reportCutoffSel.value = selectedCutoffId;
    loadCutoffDetails();
  });

  const lineMeasuredAtLockRow = h("div", { class: "muted" }, [
    h("label", { class: "row-wrap", style: "align-items:center; justify-content:flex-start; gap: 8px;" }, [
      lineMeasuredAtLock,
      h("span", { text: "Fijar fecha/hora para siguientes pesajes." }),
    ]),
  ]);

  const page = h("div", { class: "col" }, [
    h("div", { class: "card col no-print" }, [
      h("div", { class: "h1", text: "Nuevo corte fisico" }),
      h("div", { class: "muted", text: "Registra un corte para comparar inventario fisico vs sistema." }),
      createMsg,
      h("div", { class: "grid2" }, [field("Inicio", createStarted), field("Cierre (opcional)", createEnded)]),
      field("Notas", createNotes),
      h("div", { class: "row-wrap" }, [createBtn]),
    ]),
    h("div", { class: "grid2" }, [
      h("div", { class: "card col no-print" }, [h("div", { class: "h1", text: "Cortes" }), listMsg, listWrap]),
      h("div", { class: "card col no-print" }, [
        h("div", { class: "h1", text: "Detalle del corte" }),
        detailsMsg,
        field("Corte", detailCutoffSel),
        h("div", { class: "grid2" }, [field("Inicio", detailStarted), field("Cierre", detailEnded)]),
        field("Notas", detailNotes),
        h("div", { class: "row-wrap" }, [saveCutoffBtn, deleteCutoffBtn]),
        h("div", { class: "divider" }),
        h("div", { class: "h1", text: "Agregar pesaje por SKU" }),
        h("div", { class: "grid2" }, [field("SKU", lineSku), field("Fecha/hora pesaje", lineMeasuredAt)]),
        lineMeasuredAtLockRow,
        h("div", { class: "grid2" }, [field("Peso (kg)", lineWeight), field("Evidencia (opcional)", lineProofs)]),
        field("Notas del pesaje", lineNotes),
        h("div", { class: "row-wrap" }, [addLineBtn]),
        h("div", { class: "divider" }),
        lineListWrap,
      ]),
    ]),
    h("div", { class: "card col no-print" }, [
      h("div", { class: "h1", text: "Reporte de corte" }),
      h("div", { class: "muted", text: "Compara inventario fisico vs sistema y exporta kardex del periodo entre cortes." }),
      h("div", { class: "muted", text: "Aplicar diferencia al sistema crea un Ajuste automatico (1 segundo despues del corte) para que el siguiente periodo arranque desde el inventario fisico." }),
      reportMsg,
      field("Corte a comparar", reportCutoffSel),
      h("div", { class: "grid2" }, [field("Base de calculo", reportIncludeAdjustments), field("Vista de discrepancia", reportApplyDiscrepancy)]),
      h("div", { class: "row-wrap" }, [generateReportBtn, applyCutoffBtn, exportKardexBtn, printBtn]),
    ]),
    reportOut,
  ]);

  layout(ROUTE_TITLES.cutoffs, page);
  await loadCutoffs();
}

async function pageSettings(pageCtx) {
  const isActive = () => isPageContextActive(pageCtx);
  const msg = h("div");

  const productsWrap = h("div", { class: "col" });
  const qualitiesWrap = h("div", { class: "col" });
  const employeesWrap = h("div", { class: "col" });
  const skusWrap = h("div", { class: "col" });

  async function refreshMaster() {
    state.masterLoaded = false;
    await loadMasterData();
    if (!isActive()) return;
    scheduleSafeRender();
  }

  function renderMaster() {
    const products = [...state.products].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const qualities = [...state.qualities].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const employees = [...state.employees].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const skus = [...state.skus].sort((a, b) => (a.code || 0) - (b.code || 0));

    productsWrap.replaceChildren(
      h("div", { class: "h1", text: "Productos" }),
      ...products.map((p) => {
        const chk = h("input", { type: "checkbox" });
        chk.checked = !!p.is_active;
        chk.addEventListener("change", async () => {
          const { error } = await supabase.from("products").update({ is_active: chk.checked }).eq("id", p.id);
          if (error) msg.replaceChildren(notice("error", error.message));
          await loadMasterData();
          renderMaster();
        });
        return h("div", { class: "notice" }, [
          h("div", { class: "row-wrap" }, [
            h("div", { text: String(p.name) }),
            h("div", { class: "spacer" }),
            h("label", { class: "muted", style: "display:flex; gap:8px; align-items:center" }, [
              chk,
              h("span", { text: "Activo" }),
            ]),
          ]),
        ]);
      })
    );

    qualitiesWrap.replaceChildren(
      h("div", { class: "h1", text: "Calidades" }),
      ...qualities.map((q) => {
        const chk = h("input", { type: "checkbox" });
        chk.checked = !!q.is_active;
        chk.addEventListener("change", async () => {
          const { error } = await supabase.from("qualities").update({ is_active: chk.checked }).eq("id", q.id);
          if (error) msg.replaceChildren(notice("error", error.message));
          await loadMasterData();
          renderMaster();
        });
        return h("div", { class: "notice" }, [
          h("div", { class: "row-wrap" }, [
            h("div", { text: String(q.name) }),
            h("div", { class: "spacer" }),
            h("div", { class: "muted mono", text: `orden ${q.sort_order || 0}` }),
            h("label", { class: "muted", style: "display:flex; gap:8px; align-items:center" }, [
              chk,
              h("span", { text: "Activo" }),
            ]),
          ]),
        ]);
      })
    );

    employeesWrap.replaceChildren(
      h("div", { class: "h1", text: "Empleados" }),
      ...employees.map((e) => {
        const chk = h("input", { type: "checkbox" });
        chk.checked = !!e.is_active;
        chk.addEventListener("change", async () => {
          const { error } = await supabase.from("employees").update({ is_active: chk.checked }).eq("id", e.id);
          if (error) msg.replaceChildren(notice("error", error.message));
          await loadMasterData();
          renderMaster();
        });
        return h("div", { class: "notice" }, [
          h("div", { class: "row-wrap" }, [
            h("div", { text: String(e.name) }),
            h("div", { class: "spacer" }),
            h("label", { class: "muted", style: "display:flex; gap:8px; align-items:center" }, [
              chk,
              h("span", { text: "Activo" }),
            ]),
          ]),
        ]);
      })
    );

    skusWrap.replaceChildren(
      h("div", { class: "h1", text: "SKUs" }),
      ...skus.map((s) => {
        const nameInput = h("input", { type: "text", value: String(s.name || "") });

        const prodSel = h("select", {}, optionList(products, { includeEmpty: false }));
        prodSel.value = String(s.product_id || "");

        const qualSel = h("select", {}, optionList(qualities, { includeEmpty: false }));
        qualSel.value = String(s.quality_id || "");

        const pmSel = h(
          "select",
          {},
          [
            h("option", { value: "", text: "(sin default)" }),
            h("option", { value: "per_kg", text: "Por kg" }),
            h("option", { value: "per_box", text: "Por caja" }),
          ]
        );
        pmSel.value = String(s.default_price_model || "");

        const activeChk = h("input", { type: "checkbox" });
        activeChk.checked = !!s.is_active;

        const saveBtn = h(
          "button",
          {
            class: "btn",
            type: "button",
            onclick: async () => {
              msg.replaceChildren();
              const name = String(nameInput.value || "").trim();
              const product_id = String(prodSel.value || "");
              const quality_id = String(qualSel.value || "");
              const default_price_model = String(pmSel.value || "") || null;
              if (!name) {
                msg.appendChild(notice("error", "Nombre de SKU requerido."));
                return;
              }
              if (!product_id || !quality_id) {
                msg.appendChild(notice("error", "SKU requiere producto y calidad."));
                return;
              }
              const { error } = await supabase
                .from("skus")
                .update({
                  name,
                  product_id,
                  quality_id,
                  default_price_model,
                  is_active: activeChk.checked,
                })
                .eq("id", s.id);
              if (error) {
                msg.appendChild(notice("error", error.message));
                return;
              }
              await refreshMaster();
            },
          },
          ["Guardar"]
        );

        return h("div", { class: "notice" }, [
          h("div", { class: "row-wrap" }, [
            h("div", { class: "mono", style: "font-weight: 760", text: String(s.code) }),
            h("div", { class: "spacer" }),
            h("label", { class: "muted", style: "display:flex; gap:8px; align-items:center" }, [
              activeChk,
              h("span", { text: "Activo" }),
            ]),
          ]),
          h("div", { class: "grid2" }, [field("Nombre", nameInput), field("Default", pmSel)]),
          h("div", { class: "grid2" }, [field("Producto", prodSel), field("Calidad", qualSel)]),
          h("div", { class: "row-wrap" }, [h("div", { class: "spacer" }), saveBtn]),
        ]);
      })
    );
  }

  const newProduct = h("input", { type: "text", placeholder: "Ej: Papaya" });
  const addProductBtn = h(
    "button",
    {
      class: "btn",
      type: "button",
      onclick: async () => {
        msg.replaceChildren();
        const name = String(newProduct.value || "").trim();
        if (!name) return;
        const { error } = await supabase.from("products").insert({ name });
        if (error) msg.replaceChildren(notice("error", error.message));
        newProduct.value = "";
        await refreshMaster();
      },
    },
    ["Agregar producto"]
  );

  const newQuality = h("input", { type: "text", placeholder: "Ej: 1ra" });
  const newQualityOrder = h("input", { type: "number", step: "1", value: "0" });
  const addQualityBtn = h(
    "button",
    {
      class: "btn",
      type: "button",
      onclick: async () => {
        msg.replaceChildren();
        const name = String(newQuality.value || "").trim();
        const sort_order = Number(newQualityOrder.value || 0);
        if (!name) return;
        const { error } = await supabase.from("qualities").insert({ name, sort_order: Number.isFinite(sort_order) ? Math.trunc(sort_order) : 0 });
        if (error) msg.replaceChildren(notice("error", error.message));
        newQuality.value = "";
        newQualityOrder.value = "0";
        await refreshMaster();
      },
    },
    ["Agregar calidad"]
  );

  const bootstrapMsg = h("div");
  const bootstrapBtn = h(
    "button",
    {
      class: "btn btn-primary",
      type: "button",
      onclick: async () => {
        bootstrapMsg.replaceChildren(notice("warn", "Cargando SKUs base..."));
        const { error } = await supabase.rpc("bootstrap_defaults");
        if (error) {
          bootstrapMsg.replaceChildren(notice("error", error.message));
          return;
        }
        bootstrapMsg.replaceChildren(notice("ok", "Listo. Revisa tus catalogos y SKUs."));
        await refreshMaster();
      },
    },
    ["Cargar SKUs base"]
  );

  const newEmployee = h("input", { type: "text", placeholder: "Ej: Juan" });
  const addEmployeeBtn = h(
    "button",
    {
      class: "btn",
      type: "button",
      onclick: async () => {
        msg.replaceChildren();
        const name = String(newEmployee.value || "").trim();
        if (!name) return;
        const { error } = await supabase.from("employees").insert({ name });
        if (error) msg.replaceChildren(notice("error", error.message));
        newEmployee.value = "";
        await refreshMaster();
      },
    },
    ["Agregar empleado"]
  );

  const newSkuCode = h("input", { type: "number", step: "1", placeholder: "103" });
  const newSkuName = h("input", { type: "text", placeholder: "Ej: Papaya 2da Caja" });
  const newSkuProduct = h("select", {}, optionList(state.products, { includeEmpty: true, emptyLabel: "Producto..." }));
  const newSkuQuality = h("select", {}, optionList(state.qualities, { includeEmpty: true, emptyLabel: "Calidad..." }));
  const newSkuPm = h(
    "select",
    {},
    [
      h("option", { value: "", text: "(sin default)" }),
      h("option", { value: "per_kg", text: "Por kg" }),
      h("option", { value: "per_box", text: "Por caja" }),
    ]
  );

  const addSkuBtn = h(
    "button",
    {
      class: "btn",
      type: "button",
      onclick: async () => {
        msg.replaceChildren();
        const code = Number(newSkuCode.value);
        const name = String(newSkuName.value || "").trim();
        const product_id = String(newSkuProduct.value || "");
        const quality_id = String(newSkuQuality.value || "");
        const default_price_model = String(newSkuPm.value || "") || null;

        if (!Number.isFinite(code) || code <= 0) {
          msg.appendChild(notice("error", "Codigo SKU invalido."));
          return;
        }
        if (!name) {
          msg.appendChild(notice("error", "Nombre de SKU requerido."));
          return;
        }
        if (!product_id || !quality_id) {
          msg.appendChild(notice("error", "SKU requiere producto y calidad."));
          return;
        }

        const { error } = await supabase
          .from("skus")
          .insert({ code: Math.trunc(code), name, product_id, quality_id, default_price_model });
        if (error) {
          msg.appendChild(notice("error", error.message));
          return;
        }
        newSkuCode.value = "";
        newSkuName.value = "";
        newSkuProduct.value = "";
        newSkuQuality.value = "";
        newSkuPm.value = "";
        await refreshMaster();
      },
    },
    ["Agregar SKU"]
  );

  const exportStart = h("input", { type: "date" });
  const exportEnd = h("input", { type: "date" });
  const exportMsg = h("div");

  const today = new Date();
  const pad = (x) => String(x).padStart(2, "0");
  const yyyy = today.getFullYear();
  const mm = pad(today.getMonth() + 1);
  const dd = pad(today.getDate());
  exportStart.value = `${yyyy}-${mm}-${dd}`;
  exportEnd.value = `${yyyy}-${mm}-${dd}`;

  const exportBtn = h(
    "button",
    {
      class: "btn btn-primary",
      type: "button",
      onclick: async () => {
        exportMsg.replaceChildren();
        const s = String(exportStart.value || "");
        const e = String(exportEnd.value || "");
        if (!s || !e) {
          exportMsg.appendChild(notice("error", "Elige fechas de inicio y fin."));
          return;
        }
        const startIso = new Date(`${s}T00:00:00`).toISOString();
        const endIso = new Date(`${e}T23:59:59`).toISOString();
        exportMsg.appendChild(notice("warn", "Exportando..."));

	        const { data, error } = await supabase
	          .from("movements")
	          .select(
	            "id,movement_type,occurred_at,notes,currency,reported_by_employee_id,from_sku_id,to_sku_id,from_quality_id,to_quality_id," +
	              "movement_lines(sku_id,product_id,quality_id,delta_weight_kg,boxes,price_model,unit_price,line_total)," +
	              "movement_attachments(storage_path)"
	          )
          .gte("occurred_at", startIso)
          .lte("occurred_at", endIso)
          .order("occurred_at", { ascending: true });

        exportMsg.replaceChildren();
        if (error) {
          exportMsg.appendChild(notice("error", error.message));
          return;
        }

        const lines = [
	          [
	            "movement_id",
	            "movement_type",
	            "occurred_at",
	            "currency",
	            "employee",
	            "notes",
	            "from_sku_code",
	            "from_sku_name",
	            "to_sku_code",
	            "to_sku_name",
	            "from_quality",
	            "to_quality",
	            "sku_code",
	            "sku_name",
            "product",
            "quality",
            "delta_weight_kg",
            "boxes",
            "price_model",
            "unit_price",
            "line_total",
            "proof_paths",
          ].join(","),
        ];

        let exportMovementIndex = 0;
        for (const m of data || []) {
          await maybeYield(++exportMovementIndex, 20);
	          const proofPaths = (m.movement_attachments || []).map((a) => a.storage_path).join("|");
	          const fromSku = m.from_sku_id ? skuById(m.from_sku_id) : null;
	          const toSku = m.to_sku_id ? skuById(m.to_sku_id) : null;
	          const fromSkuCode = fromSku && Number.isFinite(fromSku.code) ? String(fromSku.code) : "";
	          const toSkuCode = toSku && Number.isFinite(toSku.code) ? String(toSku.code) : "";
	          const fromSkuName = fromSku ? String(fromSku.name || "") : "";
	          const toSkuName = toSku ? String(toSku.name || "") : "";
	          const base = [
	            m.id,
	            m.movement_type,
	            m.occurred_at,
	            m.currency || DEFAULT_CURRENCY,
	            m.reported_by_employee_id ? employeeName(m.reported_by_employee_id) : "",
	            (m.notes || "").replaceAll("\n", " ").replaceAll(",", " "),
	            fromSkuCode,
	            fromSkuName.replaceAll(",", " "),
	            toSkuCode,
	            toSkuName.replaceAll(",", " "),
	            m.from_quality_id ? qualityName(m.from_quality_id) : "",
	            m.to_quality_id ? qualityName(m.to_quality_id) : "",
	          ];
          let lineIdx = 0;
          for (const l of m.movement_lines || []) {
            await maybeYield(exportMovementIndex * 10 + ++lineIdx, 20);
            const s = l.sku_id ? skuById(l.sku_id) : null;
            const skuCode = s && Number.isFinite(s.code) ? String(s.code) : "";
            const skuName = s ? String(s.name || "") : "";
            const row = [
              ...base,
              skuCode,
              skuName.replaceAll(",", " "),
              productName(l.product_id).replaceAll(",", " "),
              qualityName(l.quality_id).replaceAll(",", " "),
              fmtKg(l.delta_weight_kg),
              l.boxes != null ? String(l.boxes) : "",
              l.price_model || "",
              l.unit_price != null ? String(l.unit_price) : "",
              l.line_total != null ? String(l.line_total) : "",
              proofPaths,
            ];
            lines.push(row.map((v) => `"${String(v ?? "").replaceAll("\"", "\"\"")}"`).join(","));
          }
        }

        const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = h("a", { href: url, download: `produce-inventory-export_${s}_to_${e}.csv` });
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        exportMsg.appendChild(notice("ok", "Export descargado."));
      },
    },
    ["Exportar CSV"]
  );

  const signOutBtn = h(
    "button",
    {
      class: "btn btn-danger",
      type: "button",
      onclick: async () => {
        await supabase.auth.signOut();
        navTo("login");
      },
    },
    ["Cerrar sesion"]
  );

  const page = h("div", { class: "col" }, [
    h("div", { class: "card col" }, [
      h("div", { class: "h1", text: "Ajustes" }),
      h("div", { class: "muted mono", text: `Version actual: ${APP_VERSION}` }),
      msg,
      h("div", { class: "row-wrap" }, [signOutBtn]),
    ]),
    h("div", { class: "card col" }, [
      h("div", { class: "h1", text: "Inicio rapido" }),
      h("div", { class: "muted", text: "Crea productos, calidades y SKUs iniciales (puedes editar despues)." }),
      bootstrapMsg,
      h("div", { class: "row-wrap" }, [bootstrapBtn]),
    ]),
    h("div", { class: "card col" }, [
      h("div", { class: "h1", text: "Catalogos" }),
      h("div", { class: "grid2" }, [
        h("div", { class: "col" }, [field("Nuevo producto", newProduct), addProductBtn]),
        h("div", { class: "col" }, [field("Nueva calidad", newQuality), field("Orden de calidad", newQualityOrder), addQualityBtn]),
      ]),
      h("div", { class: "divider" }),
      h("div", { class: "grid2" }, [
        h("div", { class: "col" }, [field("Nuevo empleado", newEmployee), addEmployeeBtn]),
        h("div", { class: "notice" }, [
          h("div", { class: "muted", text: "Los empleados solo son para registrar quien reporto el movimiento." }),
        ]),
      ]),
      h("div", { class: "muted" }, [
        "Tip: define calidades como 1ra (orden 10), 2da (orden 20).",
      ]),
    ]),
    h("div", { class: "card col" }, [
      h("div", { class: "h1", text: "Nuevo SKU" }),
      h("div", { class: "muted", text: "SKU = codigo + nombre, mapeado a (producto, calidad). Varias SKUs pueden compartir el mismo inventario." }),
      h("div", { class: "grid2" }, [field("Codigo", newSkuCode), field("Nombre", newSkuName)]),
      h("div", { class: "grid2" }, [field("Producto", newSkuProduct), field("Calidad", newSkuQuality)]),
      field("Default", newSkuPm),
      h("div", { class: "row-wrap" }, [addSkuBtn]),
    ]),
    h("div", { class: "grid2" }, [
      h("div", { class: "card col" }, [productsWrap]),
      h("div", { class: "card col" }, [qualitiesWrap]),
    ]),
    h("div", { class: "grid2" }, [
      h("div", { class: "card col" }, [employeesWrap]),
      h("div", { class: "card col" }, [skusWrap]),
    ]),
    h("div", { class: "card col" }, [
      h("div", { class: "h1", text: "Respaldo / Exportar" }),
      h("div", { class: "muted", text: "Exporta el kardex a CSV (si subiste fotos, quedan en Storage)." }),
      exportMsg,
      h("div", { class: "grid2" }, [field("Fecha inicio", exportStart), field("Fecha fin", exportEnd)]),
      exportBtn,
    ]),
  ]);

  layout(ROUTE_TITLES.settings, page);
  renderMaster();
}

async function render() {
  let r = route();
  await ensureActorContextLoaded();
  r = route();

  if (!state.session) {
    if (r !== "login") navTo("login");
    await pageLogin(createPageContext("login"));
    return;
  }

  if (!state.masterLoaded) {
    try {
      await loadMasterData();
      r = route();
    } catch (e) {
      layout("Error", notice("error", e?.message ? String(e.message) : "No se pudo cargar catalogos."));
      return;
    }
  }

  if (r === "login") {
    navTo("capture");
    return;
  }

  if (!currentRouteAllowed(r)) {
    navTo("capture");
    await pageCapture(createPageContext("capture"));
    return;
  }

  const pageCtx = createPageContext(r);

  if (r === "capture") return pageCapture(pageCtx);
  if (r === "movements") return pageMovements(pageCtx);
  if (r === "inventory") return pageInventory(pageCtx);
  if (r === "hypothetical") return pageHypothetical(pageCtx);
  if (r === "cutoffs") return pageCutoffs(pageCtx);
  if (r === "reports") return pageReports(pageCtx);
  if (r === "settings") return pageSettings(pageCtx);

  navTo("capture");
}

let renderRunning = false;
let renderPending = false;
let appVisibilityResumeScheduled = false;
let isAppHidden = false;

function isRenderThrottled() {
  return isAppHidden || !isAppInForeground() || isProofPickerOpen || state.captureSubmitting;
}

function scheduleSafeRender() {
  renderPending = true;
  if (isRenderThrottled()) return;
  if (renderRunning) return;
  if (renderTimer != null) return;

  const sinceLastRender = Date.now() - lastRenderCompleteAt;
  const delay = sinceLastRender < RENDER_DEBOUNCE_MS ? RENDER_DEBOUNCE_MS - sinceLastRender : 0;

  renderTimer = window.setTimeout(() => {
    renderTimer = null;
    void safeRender();
  }, delay);
}

function clearRenderTimer() {
  if (renderTimer == null) return;
  window.clearTimeout(renderTimer);
  renderTimer = null;
}

async function safeRender() {
  if (isRenderThrottled()) {
    renderPending = true;
    return;
  }
  if (renderRunning) {
    renderPending = true;
    return;
  }
  renderRunning = true;
  renderPending = false;
  try {
    do {
      renderPending = false;
      await render();
    } while (renderPending);
  } catch (e) {
    layout("Error", notice("error", e?.message ? String(e.message) : "La app tuvo un error inesperado."));
  } finally {
    lastRenderCompleteAt = Date.now();
    renderRunning = false;
  }
}

let lastResumeRefreshAt = 0;
async function refreshAfterResume() {
  if (!isAppInForeground() || isAppHidden) return;
  if (state.captureSubmitting) return;
  const now = Date.now();
  if (now - lastResumeRefreshAt < RESUME_REFRESH_MS) return;
  lastResumeRefreshAt = now;
  if (route() === "capture") return;
  try {
    await withTimeout(loadSession(), NETWORK_TIMEOUT_MS, "Reconectando...");
    if (!state.masterLoaded || now - masterDataLoadedAt >= MASTER_DATA_TTL_MS) {
      state.masterLoaded = false;
    }
  } catch {
    // ignore; safeRender will show auth error if needed
  }
  await safeRender();
}

async function boot() {
  try {
    await loadSession();
    await loadActorContext();
  } catch (e) {
    layout("Error", notice("error", e?.message ? String(e.message) : "No se pudo cargar la sesion."));
  }

  supabase.auth.onAuthStateChange(async (_event, session) => {
    state.session = session;
    state.masterLoaded = false;
    state.actorLoaded = false;
    if (session) await loadActorContext();
    else {
      state.actor = {
        workspace_id: null,
        role: "manager",
        employee_id: null,
        merma_limit_kg: null,
        allow_all_traspaso_sku: true,
        display_name: null,
      };
      state.actorLoaded = true;
    }
    if (!session) navTo("login");
    scheduleSafeRender();
  });

  const scheduleResumeRefresh = () => {
    if (appVisibilityResumeScheduled || isAppHidden) return;
    appVisibilityResumeScheduled = true;
    requestAnimationFrame(async () => {
      appVisibilityResumeScheduled = false;
      await refreshAfterResume();
    });
  };

  const recoverMobileUiState = () => {
    clearProofPickerOpen();
    cleanupStuckBackdrops();
  };

  window.addEventListener("hashchange", () => scheduleSafeRender());
  window.addEventListener("online", () => scheduleSafeRender());
  window.addEventListener("focus", () => {
    recoverMobileUiState();
    if (isAppInForeground()) {
      isAppHidden = false;
      scheduleResumeRefresh();
    }
    scheduleSafeRender();
  });
  window.addEventListener("blur", () => {
    clearProofPickerOpen();
    clearRenderTimer();
  });
  window.addEventListener("pagehide", () => {
    isAppHidden = true;
    clearProofPickerOpen();
    clearRenderTimer();
  });
  window.addEventListener("pageshow", () => {
    recoverMobileUiState();
    isAppHidden = false;
    scheduleResumeRefresh();
    scheduleSafeRender();
  });
  document.addEventListener("visibilitychange", () => {
    const hidden = !isAppInForeground();
    isAppHidden = hidden;
    if (hidden) {
      clearProofPickerOpen();
      clearRenderTimer();
      return;
    }
    if (!hidden && route() !== "capture") {
      scheduleResumeRefresh();
    }
    scheduleSafeRender();
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        for (const reg of regs) reg.unregister();
      }).catch(() => {});
    });
  }

  await safeRender();
}

boot();
