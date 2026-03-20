import * as cfg from "./config.js?v=2026.03.20.01";
import { supabase } from "./supabaseClient.js?v=2026.03.20.01";

const DEFAULT_CURRENCY = cfg.DEFAULT_CURRENCY || "MXN";
const APP_VERSION = cfg.APP_VERSION || "2026.03.20.01";
const APP_NAME = cfg.APP_NAME || "FST INV";
const APP_LOGO_URL = cfg.APP_LOGO_URL || "./icons/fst-logo.png";

const $root = document.getElementById("root");

const ROUTE_TITLES = {
  login: "Iniciar sesion",
  capture: "Capturar",
  entries: "Entradas",
  movements: "Movimientos",
  inventory: "Inventario",
  hypothetical: "Hipotetico",
  cutoffs: "Cortes",
  cash: "Caja",
  reports: "Reportes",
  settings: "Ajustes",
};

const NAV_ITEMS = [
  { route: "entries", label: "Entradas", icon: "IN", role: "employee" },
  { route: "capture", label: "Capturar", icon: "+" },
  { route: "cash", label: "Caja", icon: "$" },
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
const EMPLOYEE_PROOF_MAX_DIMENSION = 960;
const EMPLOYEE_PROOF_JPEG_QUALITY = 0.74;
const EMPLOYEE_CAMERA_REQUEST_DIMENSION = 1280;
const POST_SAVE_REFERENCE_WAIT_MS = 180;
const PROOF_PICKER_RESET_MS = 45_000;
const MOVEMENT_LINES_PREVIEW_LIMIT = 12;
const DEFAULT_PROOF_STAMP_ROWS = 2;
const CAPTURE_DRAFT_AUTOSAVE_MS = 450;
const CAPTURE_DRAFT_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const CAPTURE_DRAFT_SCHEMA_VERSION = 1;
const CASH_DRAFT_AUTOSAVE_MS = 450;
const CASH_DRAFT_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const CASH_DRAFT_SCHEMA_VERSION = 1;
const CASH_DEFAULT_EXCHANGE_RATE = 17.5;
const CASH_DEFAULT_INITIAL_FUND = 1000;
const CASH_DEFAULT_CUT_TYPE = "Corte Z";
const CASH_DEFAULT_BRANCH = "Sucursal principal";
const CASH_PRODUCT_LINE_MIN = 4;
const CASH_LIST_PAGE_SIZE = 30;
const CASH_MXN_BILLS = [1000, 500, 200, 100, 50, 20];
const CASH_MXN_COINS = [20, 10, 5, 2, 1, 0.5];
const CASH_USD_DENOMS = [100, 50, 20, 10, 5, 1, 0.25, 0.1, 0.05, 0.01];
const CASH_ADJUSTMENT_META = {
  fondo_inicial: {
    label: "Fondo de caja inicial",
    affectsCash: false,
    fixedSign: "positive",
    defaultDirection: "entrada",
  },
  reembolso_dia: {
    label: "Reembolsos del día",
    affectsCash: false,
    fixedSign: "negative",
    defaultDirection: "salida",
    syncFromRefunds: true,
  },
  gasto_caja: {
    label: "Gastos pagados con caja",
    affectsCash: true,
    fixedSign: "negative",
    defaultDirection: "salida",
  },
  retiro_boveda: {
    label: "Retiros a bóveda",
    affectsCash: false,
    fixedSign: "positive",
    defaultDirection: "salida",
    syncFromVaultWithdrawals: true,
  },
  deposito_retiro_parcial: {
    label: "Depositos / retiros parciales",
    affectsCash: true,
    fixedSign: "direction",
    defaultDirection: "entrada",
  },
  vale_comprobante: {
    label: "Vales / comprobantes",
    affectsCash: true,
    fixedSign: "direction",
    defaultDirection: "salida",
  },
  cheque: {
    label: "Cheques",
    affectsCash: true,
    fixedSign: "direction",
    defaultDirection: "entrada",
  },
  transferencia_identificada: {
    label: "Transferencias identificadas",
    affectsCash: false,
    fixedSign: "direction",
    defaultDirection: "entrada",
  },
  otro_ajuste: {
    label: "Otros ajustes (+/-)",
    affectsCash: true,
    fixedSign: "direction",
    defaultDirection: "entrada",
  },
};
const CASH_ADJUSTMENT_ORDER = [
  "fondo_inicial",
  "reembolso_dia",
  "gasto_caja",
  "retiro_boveda",
  "deposito_retiro_parcial",
  "vale_comprobante",
  "cheque",
  "transferencia_identificada",
  "otro_ajuste",
];

const ROUTE_ACCESS = {
  employee: new Set(["capture", "entries", "cash"]),
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
  none: [],
};
const ROUTE_BY_ROLE = {
  manager: null,
  employee: new Set(["capture", "entries", "cash"]),
  none: new Set(),
};

const state = {
  session: null,
  products: [],
  qualities: [],
  employees: [],
  skus: [],
  captureEmployeeProofs: [],
  captureEmployeeEntrySheetProofs: [],
  masterLoaded: false,
  actor: {
    workspace_id: null,
    role: null,
    employee_id: null,
    merma_limit_kg: null,
    allow_all_sale_sku: true,
    allow_all_traspaso_sku: true,
    display_name: null,
    has_access: false,
    access_reason: null,
  },
  actorLoaded: false,
  captureSubmitting: false,
  captureFlashNotice: null,
  captureNextMode: null,
  cashSubmitting: false,
  cashFlashNotice: null,
  cashDraft: null,
  cashFilters: {
    business_date: "",
    cashier_employee_id: "",
  },
  cashSelectedId: null,
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
  cashDraft: "produce_inventory.cash.draft.v1",
};
const NETWORK_TIMEOUT_MS = 45000;
const LOCAL_DRAFT_DB_NAME = "produce_inventory_local_drafts";
const LOCAL_DRAFT_DB_VERSION = 1;
const LOCAL_DRAFT_DB_STORE = "draft_payloads";
const CAPTURE_EMPLOYEE_PROOFS_DRAFT_KEY = "captureEmployeeProofs";

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
let lastLaidOutRoute = "";
let routeScrollResetPending = true;
let captureDraftFlushFn = null;
let cashDraftFlushFn = null;
let captureDraftStatus = { state: "idle", restored: false };
let cashDraftStatus = { state: "idle", restored: false };

function flushPendingDraftSaves() {
  try {
    captureDraftFlushFn?.();
  } catch {
    // ignore
  }
  try {
    cashDraftFlushFn?.();
  } catch {
    // ignore
  }
}

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
  const role = String(state.actor?.role || "").toLowerCase();
  if (role === "employee") return "employee";
  if (role === "manager") return "manager";
  return "none";
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

function navItemVisible(item) {
  const requiredRole = String(item?.role || "any").trim().toLowerCase();
  if (!requiredRole || requiredRole === "any") return true;
  return actorRole() === requiredRole;
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
      return "Este usuario solo puede capturar entrada, venta, merma o traspaso entre SKUs.";
    case "proof_required_for_employee":
      return "Los empleados deben adjuntar al menos una evidencia para registrar el movimiento.";
    case "entry_sheet_proof_required_for_employee":
      return "Como empleado, debes adjuntar una foto adicional de la hoja de entrada.";
    case "employee_not_linked":
      return "Este usuario empleado no está ligado a un empleado activo.";
    case "employee_must_match_linked_employee":
      return "Este usuario solo puede guardar movimientos con su empleado ligado.";
    case "traspaso_sku_not_allowed":
      return "No tienes permiso para este traspaso entre SKUs.";
    case "employee_sale_requires_sku":
      return "Las ventas de empleado requieren un SKU por línea.";
    case "employee_entry_requires_sku":
      return "Las entradas de empleado requieren elegir un SKU por línea.";
    case "employee_merma_requires_sku":
      return "La merma de empleado requiere elegir un SKU por línea.";
    case "employee_sale_only_per_box_skus":
      return "Los empleados solo pueden capturar ventas en SKUs autorizados y con el formato permitido por ese SKU.";
    case "merma_limit_exceeded":
      return "La merma excede el límite permitido para este usuario.";
    case "employee_invalid":
      return "Empleado inválido, inaccesible o inactivo.";
    case "only_manager_can_delete_movement":
      return "Solo el gerente puede eliminar movimientos.";
    case "not_authorized":
      return "No estás autorizado para esta acción.";
    default:
      return code;
  }
}

function defaultActorState() {
  return {
    workspace_id: null,
    role: null,
    employee_id: null,
    merma_limit_kg: null,
    allow_all_sale_sku: true,
    allow_all_traspaso_sku: true,
    display_name: null,
    has_access: false,
    access_reason: null,
  };
}

function resetActorState() {
  state.actor = defaultActorState();
  state.actorLoaded = true;
}

function isSupabaseLockAbortError(error) {
  const message = String(error?.message || error || "");
  const name = String(error?.name || "");
  return name === "AbortError" || message.includes("Lock broken by another request with the 'steal' option");
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

function revokeObjectUrl(url) {
  if (!url) return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    // ignore
  }
}

async function loadStoredEmployeeCaptureProofs() {
  try {
    const wrapped = await localDraftStoreGet(CAPTURE_EMPLOYEE_PROOFS_DRAFT_KEY);
    if (!wrapped || typeof wrapped !== "object") return [];
    if (!wrapped.timestamp || Date.now() - Number(wrapped.timestamp) > CAPTURE_DRAFT_TTL_MS) {
      await localDraftStoreDelete(CAPTURE_EMPLOYEE_PROOFS_DRAFT_KEY);
      return [];
    }
    const items = Array.isArray(wrapped.items) ? wrapped.items : [];
    return items
      .map((item) => {
        const blob = item?.blob;
        if (!(blob instanceof Blob)) return null;
        const file = new File([blob], String(item?.name || "employee-proof.jpg"), {
          type: String(item?.type || blob.type || "image/jpeg"),
          lastModified: Number(item?.lastModified || Date.now()),
        });
        return {
          file,
          captured_at_iso: String(item?.captured_at_iso || new Date().toISOString()),
          stamp_text: String(item?.stamp_text || ""),
          preview_url: URL.createObjectURL(file),
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function persistEmployeeCaptureProofs() {
  try {
    const items = Array.isArray(state.captureEmployeeProofs) ? state.captureEmployeeProofs : [];
    if (items.length === 0) {
      await localDraftStoreDelete(CAPTURE_EMPLOYEE_PROOFS_DRAFT_KEY);
      return;
    }
    await localDraftStoreSet(CAPTURE_EMPLOYEE_PROOFS_DRAFT_KEY, {
      timestamp: Date.now(),
      items: items
        .filter((item) => item?.file instanceof Blob)
        .map((item) => ({
          blob: item.file,
          name: String(item.file?.name || "employee-proof.jpg"),
          type: String(item.file?.type || "image/jpeg"),
          lastModified: Number(item.file?.lastModified || Date.now()),
          captured_at_iso: String(item.captured_at_iso || new Date().toISOString()),
          stamp_text: String(item.stamp_text || ""),
        })),
    });
  } catch {
    // ignore local persistence failures
  }
}

function clearEmployeeCaptureProofs({ clearStored = false } = {}) {
  for (const item of state.captureEmployeeProofs || []) {
    revokeObjectUrl(item?.preview_url);
  }
  for (const item of state.captureEmployeeEntrySheetProofs || []) {
    revokeObjectUrl(item?.preview_url);
  }
  state.captureEmployeeProofs = [];
  state.captureEmployeeEntrySheetProofs = [];
  if (clearStored) {
    void localDraftStoreDelete(CAPTURE_EMPLOYEE_PROOFS_DRAFT_KEY);
  }
}

async function signOutCurrentUser() {
  clearEmployeeCaptureProofs({ clearStored: true });
  await supabase.auth.signOut();
  navTo("login");
}

function employeeCaptureStampTime(date = new Date()) {
  try {
    return date.toLocaleString([], {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return date.toISOString();
  }
}

function employeeCaptureStampLines(employeeName, capturedAt = new Date()) {
  const lines = [];
  const safeName = String(employeeName || "").trim();
  lines.push(`Empleado: ${safeName || "Sin nombre"}`);
  lines.push(`Capturada: ${employeeCaptureStampTime(capturedAt)}`);
  return lines;
}

function fitMediaWithin(width, height, maxDimension = MAX_PROOF_DIMENSION) {
  const w = Number(width || 0);
  const h = Number(height || 0);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { width: 0, height: 0 };
  }
  const scale = Math.min(1, maxDimension / w, maxDimension / h);
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

function drawEmployeeProofStamp(ctx, canvas, lines) {
  const textLines = Array.isArray(lines) ? lines.filter(Boolean) : [];
  if (!ctx || !canvas || textLines.length === 0) return;

  const pad = Math.max(18, Math.round(canvas.width * 0.02));
  const lineGap = Math.max(8, Math.round(canvas.width * 0.008));
  const fontSize = Math.max(20, Math.round(canvas.width * 0.028));
  const lineHeight = Math.round(fontSize * 1.2);

  ctx.save();
  ctx.font = `700 ${fontSize}px Poppins, sans-serif`;
  const maxTextWidth = textLines.reduce((acc, line) => Math.max(acc, ctx.measureText(String(line)).width), 0);
  const boxHeight = pad * 2 + lineHeight * textLines.length + lineGap * Math.max(0, textLines.length - 1);
  const boxWidth = Math.min(canvas.width - pad * 2, Math.ceil(maxTextWidth + pad * 2));
  const boxX = pad;
  const boxY = Math.max(pad, canvas.height - boxHeight - pad);

  ctx.fillStyle = "rgba(12, 21, 35, 0.72)";
  ctx.fillRect(boxX, boxY, boxWidth, boxHeight);

  ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
  ctx.lineWidth = 2;
  ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);

  ctx.fillStyle = "#ffffff";
  let y = boxY + pad + fontSize;
  for (const line of textLines) {
    ctx.fillText(String(line), boxX + pad, y);
    y += lineHeight + lineGap;
  }
  ctx.restore();
}

async function buildEmployeeCameraFile(videoEl, employeeName) {
  const sourceWidth = Number(videoEl?.videoWidth || 0);
  const sourceHeight = Number(videoEl?.videoHeight || 0);
  if (!sourceWidth || !sourceHeight) {
    throw new Error("La cámara todavía no está lista.");
  }

  const capturedAt = new Date();
  // Employee proofs should upload fast on mobile, so keep them smaller than manager uploads.
  const target = fitMediaWithin(sourceWidth, sourceHeight, EMPLOYEE_PROOF_MAX_DIMENSION);
  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo preparar la foto.");

  ctx.drawImage(videoEl, 0, 0, target.width, target.height);
  drawEmployeeProofStamp(ctx, canvas, employeeCaptureStampLines(employeeName, capturedAt));

  const blob = await canvasToBlob(canvas, { type: "image/jpeg", quality: EMPLOYEE_PROOF_JPEG_QUALITY });
  if (!blob) throw new Error("No se pudo capturar la foto.");

  const safeStamp = capturedAt.toISOString().replace(/[:.]/g, "-");
  const file = new File([blob], `employee-proof-${safeStamp}.jpg`, {
    type: "image/jpeg",
    lastModified: capturedAt.getTime(),
  });

  return {
    file,
    captured_at_iso: capturedAt.toISOString(),
    stamp_text: employeeCaptureStampLines(employeeName, capturedAt).join(" | "),
  };
}

async function openEmployeeCameraCaptureModal({ employeeName, title = "Tomar evidencia" } = {}) {
  setProofPickerOpen(true, { scheduleRender: false });

  return await new Promise((resolve, reject) => {
    const backdrop = h("div", { class: "modal-backdrop" });
    const modal = h("div", { class: "modal col camera-modal" });
    const msg = h("div");
    const video = h("video", {
      class: "camera-video",
      autoplay: "autoplay",
      muted: "muted",
      playsinline: "playsinline",
    });
    video.muted = true;
    video.playsInline = true;

    let stream = null;
    let closed = false;

    const stopStream = () => {
      try {
        video.pause();
      } catch {
        // ignore
      }
      try {
        video.srcObject = null;
      } catch {
        // ignore
      }
      if (!stream) return;
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {
          // ignore
        }
      }
      stream = null;
    };

    const close = (result = null, error = null) => {
      if (closed) return;
      closed = true;
      stopStream();
      backdrop.remove();
      clearProofPickerOpen({ scheduleRender: false });
      if (error) reject(error);
      else resolve(result);
    };

    const cancelBtn = h("button", { class: "btn btn-ghost", type: "button", onclick: () => close(null) }, ["Cancelar"]);
    const captureBtn = h(
      "button",
      {
        class: "btn btn-primary",
        type: "button",
        disabled: "true",
        onclick: async () => {
          captureBtn.disabled = true;
          try {
            msg.replaceChildren(notice("warn", "Procesando foto..."));
            const captured = await buildEmployeeCameraFile(video, employeeName);
            close({
              ...captured,
              preview_url: URL.createObjectURL(captured.file),
            });
          } catch (error) {
            captureBtn.disabled = false;
            msg.replaceChildren(notice("error", error?.message ? String(error.message) : "No se pudo capturar la foto."));
          }
        },
      },
      ["Capturar foto"]
    );

    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) close(null);
    });

    const header = h("div", { class: "row-wrap modal-header" }, [
      h("div", { class: "col", style: "gap: 4px" }, [
        h("div", { style: "font-weight: 820; font-size: 16px", text: title }),
        h("div", { class: "muted", text: "La foto se guarda con nombre del empleado y hora de captura." }),
      ]),
      h("div", { class: "spacer" }),
      cancelBtn,
    ]);

    modal.append(
      header,
      msg,
      h("div", { class: "camera-frame" }, [video]),
      h("div", { class: "row-wrap" }, [h("div", { class: "spacer" }), captureBtn])
    );
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Este dispositivo no permite usar la cámara desde la app.");
        }
        msg.replaceChildren(notice("warn", "Solicitando acceso a la cámara..."));
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: EMPLOYEE_CAMERA_REQUEST_DIMENSION },
            height: { ideal: EMPLOYEE_CAMERA_REQUEST_DIMENSION },
          },
        });
        video.srcObject = stream;
        await video.play();
        msg.replaceChildren(notice("ok", "Toma la foto y presiona Capturar foto."));
        captureBtn.disabled = false;
      } catch (error) {
        stopStream();
        msg.replaceChildren(
          notice(
            "error",
            error?.message
              ? String(error.message)
              : "No se pudo abrir la cámara. Revisa permisos del navegador e intenta de nuevo."
          )
        );
      }
    })();
  });
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
  flushPendingDraftSaves();
  routeScrollResetPending = true;
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

function loadCashDraft() {
  const data = storageGetJson(STORAGE_KEYS.cashDraft, null);
  if (!data || typeof data !== "object") return null;
  if (data.version !== CASH_DRAFT_SCHEMA_VERSION) return null;
  if (!data.timestamp || Date.now() - Number(data.timestamp) > CASH_DRAFT_TTL_MS) {
    storageRemove(STORAGE_KEYS.cashDraft);
    return null;
  }
  return data;
}

function buildCashDraft(payload) {
  return {
    version: CASH_DRAFT_SCHEMA_VERSION,
    timestamp: Date.now(),
    payload,
  };
}

function openLocalDraftDb() {
  return new Promise((resolve, reject) => {
    try {
      if (typeof indexedDB === "undefined") {
        resolve(null);
        return;
      }
      const request = indexedDB.open(LOCAL_DRAFT_DB_NAME, LOCAL_DRAFT_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(LOCAL_DRAFT_DB_STORE)) {
          db.createObjectStore(LOCAL_DRAFT_DB_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("No se pudo abrir IndexedDB."));
    } catch (error) {
      reject(error);
    }
  });
}

async function localDraftStoreGet(key) {
  const db = await openLocalDraftDb();
  if (!db) return null;
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(LOCAL_DRAFT_DB_STORE, "readonly");
    const store = tx.objectStore(LOCAL_DRAFT_DB_STORE);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error || new Error("No se pudo leer el borrador local."));
    tx.oncomplete = () => db.close();
    tx.onabort = () => db.close();
    tx.onerror = () => db.close();
  });
}

async function localDraftStoreSet(key, value) {
  const db = await openLocalDraftDb();
  if (!db) return;
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(LOCAL_DRAFT_DB_STORE, "readwrite");
    const store = tx.objectStore(LOCAL_DRAFT_DB_STORE);
    const request = store.put(value, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error("No se pudo guardar el borrador local."));
    tx.oncomplete = () => db.close();
    tx.onabort = () => db.close();
    tx.onerror = () => db.close();
  });
}

async function localDraftStoreDelete(key) {
  const db = await openLocalDraftDb();
  if (!db) return;
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(LOCAL_DRAFT_DB_STORE, "readwrite");
    const store = tx.objectStore(LOCAL_DRAFT_DB_STORE);
    const request = store.delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error("No se pudo borrar el borrador local."));
    tx.oncomplete = () => db.close();
    tx.onabort = () => db.close();
    tx.onerror = () => db.close();
  });
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

function movementShortId(movementOrId, explicitReferenceNumber = null) {
  const referenceNumber =
    explicitReferenceNumber != null
      ? explicitReferenceNumber
      : movementOrId && typeof movementOrId === "object"
        ? movementOrId.reference_number
        : null;
  const refNum = Number(referenceNumber);
  if (Number.isFinite(refNum) && refNum > 0) {
    return `FST${Math.trunc(refNum)}`;
  }

  const rawId =
    movementOrId && typeof movementOrId === "object"
      ? movementOrId.id
      : movementOrId;
  const raw = String(rawId || "")
    .replace(/-/g, "")
    .slice(0, 8)
    .toUpperCase();
  return raw ? `FST-${raw}` : "FST-";
}

function movementSavedText(movementType, movementOrId) {
  return `Guardado: ${movementLabel(movementType)} | ID ${movementShortId(movementOrId)}`;
}

async function fetchSavedMovementReference(movementId) {
  const { data } = await supabase
    .from("movements")
    .select("id,reference_number")
    .eq("id", movementId)
    .maybeSingle();
  return data || null;
}

function roundMoneyValue(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function roundRateValue(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

function numberFromInput(value, fallback = 0) {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function integerFromInput(value, fallback = 0) {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function trimmedOrEmpty(value) {
  return String(value ?? "").trim();
}

function dateOnlyToday() {
  return localDatePartFromInput(localNowInputValue());
}

function fmtSignedMoney(n, currency = DEFAULT_CURRENCY) {
  const value = Number(n);
  if (!Number.isFinite(value)) return fmtMoney(0, currency);
  const prefix = value < 0 ? "-" : "";
  return `${prefix}${fmtMoney(Math.abs(value), currency)}`;
}

function cashCutShortId(cutOrDate, explicitDailySequence = null) {
  const dateValue =
    cutOrDate && typeof cutOrDate === "object"
      ? String(cutOrDate.business_date || "").trim()
      : String(cutOrDate || "").trim();
  const seqValue =
    explicitDailySequence != null
      ? explicitDailySequence
      : cutOrDate && typeof cutOrDate === "object"
        ? cutOrDate.daily_sequence
        : null;
  const seq = Math.max(1, Math.trunc(Number(seqValue || 0) || 0));
  return dateValue ? `CZ-${dateValue}-${seq}` : `CZ-${seq}`;
}

function cashAdjustmentLabel(type) {
  return CASH_ADJUSTMENT_META[type]?.label || String(type || "");
}

function cashAdjustmentDirectionLabel(direction) {
  return String(direction || "entrada") === "salida" ? "Salida" : "Entrada";
}

function defaultCashProductLine() {
  return {
    product_label: "",
    amount: "",
    note: "",
  };
}

function defaultCashDenominationLines() {
  const rows = [];
  for (const denomination of CASH_MXN_BILLS) {
    rows.push({ currency: "MXN", kind: "bill", denomination, quantity: "" });
  }
  for (const denomination of CASH_MXN_COINS) {
    rows.push({ currency: "MXN", kind: "coin", denomination, quantity: "" });
  }
  for (const denomination of CASH_USD_DENOMS) {
    rows.push({ currency: "USD", kind: denomination >= 1 ? "bill" : "coin", denomination, quantity: "" });
  }
  return rows;
}

function cashDenominationKey(row) {
  return `${String(row?.currency || "").toUpperCase()}|${String(row?.kind || "").toLowerCase()}|${Number(row?.denomination || 0)}`;
}

function normalizeCashDenominationLines(rows) {
  const defaults = defaultCashDenominationLines();
  const existing = new Map((Array.isArray(rows) ? rows : []).map((row) => [cashDenominationKey(row), row]));
  return defaults.map((row) => {
    const found = existing.get(cashDenominationKey(row)) || {};
    return {
      currency: row.currency,
      kind: row.kind,
      denomination: row.denomination,
      quantity: found.quantity != null ? String(found.quantity) : "",
    };
  });
}

function defaultCashVaultWithdrawal() {
  return {
    reference_label: "",
    note: "",
    denomination_lines: defaultCashDenominationLines(),
  };
}

function normalizeCashVaultWithdrawal(row = {}) {
  return {
    reference_label: trimmedOrEmpty(row?.reference_label),
    note: trimmedOrEmpty(row?.note),
    denomination_lines: normalizeCashDenominationLines(row?.denomination_lines),
  };
}

function defaultCashAdjustments() {
  return CASH_ADJUSTMENT_ORDER.map((adjustmentType) => ({
    adjustment_type: adjustmentType,
    direction: CASH_ADJUSTMENT_META[adjustmentType]?.defaultDirection || "entrada",
    amount: adjustmentType === "fondo_inicial" ? CASH_DEFAULT_INITIAL_FUND.toFixed(2) : "",
    support_reference: "",
    note: "",
  }));
}

function createCashCutDraft() {
  const nowLocal = localNowInputValue();
  const currentEmployeeId = actorEmployeeId();
  const currentEmployeeName = currentEmployeeId ? employeeName(currentEmployeeId) : "";
  const displayName = getActorDisplayName() || currentEmployeeName || "";
  return {
    business_date: dateOnlyToday(),
    branch_name: CASH_DEFAULT_BRANCH,
    cut_type: CASH_DEFAULT_CUT_TYPE,
    cut_folio: "",
    started_at: nowLocal,
    ended_at: nowLocal,
    cashier_employee_id: actorRole() === "employee" ? currentEmployeeId || "" : "",
    cashier_system_name: displayName,
    customers_served: "",
    ticket_start_folio: "",
    ticket_end_folio: "",
    delivered_by: displayName,
    received_by: "",
    observations: "",
    invoice_sale_amount: "",
    cash_receipts_amount: "",
    refund_receipts_amount: "",
    credit_invoiced_sales_amount: "",
    cash_invoiced_sales_amount: "",
    total_invoiced_sales_amount: "",
    sales_mxn_amount: "",
    sales_usd_amount: "",
    exchange_rate: CASH_DEFAULT_EXCHANGE_RATE.toFixed(2),
    iva_zero_amount: "",
    ticket_total_amount: "",
    versatil_cash_count_amount: "",
    product_lines: Array.from({ length: CASH_PRODUCT_LINE_MIN }, () => defaultCashProductLine()),
    denomination_lines: defaultCashDenominationLines(),
    vault_withdrawals: [defaultCashVaultWithdrawal()],
    adjustment_lines: defaultCashAdjustments(),
  };
}

function ensureCashDraft() {
  if (!state.cashDraft || typeof state.cashDraft !== "object") {
    state.cashDraft = createCashCutDraft();
  }
  const draft = state.cashDraft;
  if (!Array.isArray(draft.product_lines)) draft.product_lines = [];
  while (draft.product_lines.length < CASH_PRODUCT_LINE_MIN) draft.product_lines.push(defaultCashProductLine());
  if (!Array.isArray(draft.denomination_lines) || draft.denomination_lines.length === 0) {
    draft.denomination_lines = defaultCashDenominationLines();
  }
  draft.denomination_lines = normalizeCashDenominationLines(draft.denomination_lines);
  if (!Array.isArray(draft.vault_withdrawals)) draft.vault_withdrawals = [defaultCashVaultWithdrawal()];
  draft.vault_withdrawals = draft.vault_withdrawals.map((row) => normalizeCashVaultWithdrawal(row));
  if (draft.vault_withdrawals.length === 0) draft.vault_withdrawals.push(defaultCashVaultWithdrawal());
  if (!Array.isArray(draft.adjustment_lines) || draft.adjustment_lines.length === 0) {
    draft.adjustment_lines = defaultCashAdjustments();
  }
  const existingAdjustments = new Map((draft.adjustment_lines || []).map((row) => [row.adjustment_type, row]));
  draft.adjustment_lines = CASH_ADJUSTMENT_ORDER.map((type) => {
    const found = existingAdjustments.get(type) || {};
    return {
      adjustment_type: type,
      direction: found.direction || CASH_ADJUSTMENT_META[type]?.defaultDirection || "entrada",
      amount:
        found.amount != null && String(found.amount).trim() !== ""
          ? String(found.amount)
          : type === "fondo_inicial"
            ? CASH_DEFAULT_INITIAL_FUND.toFixed(2)
            : "",
      support_reference: found.support_reference || "",
      note: found.note || "",
    };
  });

  if (actorRole() === "employee") {
    const linkedEmployeeId = actorEmployeeId() || "";
    draft.cashier_employee_id = linkedEmployeeId;
    if (!trimmedOrEmpty(draft.delivered_by)) {
      draft.delivered_by = getActorDisplayName() || employeeName(linkedEmployeeId) || "";
    }
  }

  if (!trimmedOrEmpty(draft.business_date)) draft.business_date = dateOnlyToday();
  if (!trimmedOrEmpty(draft.cut_type)) draft.cut_type = CASH_DEFAULT_CUT_TYPE;
  if (!trimmedOrEmpty(draft.exchange_rate)) draft.exchange_rate = CASH_DEFAULT_EXCHANGE_RATE.toFixed(2);
  if (!trimmedOrEmpty(draft.branch_name)) draft.branch_name = CASH_DEFAULT_BRANCH;
  if (draft.versatil_cash_count_amount == null) draft.versatil_cash_count_amount = "";
  if (!trimmedOrEmpty(draft.started_at)) draft.started_at = localNowInputValue();
  if (!trimmedOrEmpty(draft.ended_at)) draft.ended_at = draft.started_at;

  return draft;
}

function resetCashDraft() {
  state.cashDraft = createCashCutDraft();
}

function computeCashDenominationSet(lines, exchangeRate) {
  let totalMxnBillsAmount = 0;
  let totalMxnCoinsAmount = 0;
  let totalUsdAmount = 0;
  const normalizedLines = (lines || []).map((row) => {
    const currency = String(row?.currency || "").toUpperCase();
    const kind = String(row?.kind || "").toLowerCase();
    const denomination = roundMoneyValue(numberFromInput(row?.denomination, 0));
    const quantity = Math.max(0, integerFromInput(row?.quantity, 0));
    const lineTotal = roundMoneyValue(denomination * quantity);

    if (currency === "MXN" && kind === "bill") totalMxnBillsAmount += lineTotal;
    else if (currency === "MXN") totalMxnCoinsAmount += lineTotal;
    else totalUsdAmount += lineTotal;

    return {
      currency,
      kind,
      denomination,
      quantity,
      line_total: lineTotal,
    };
  });

  const totalUsdMxnAmount = roundMoneyValue(totalUsdAmount * exchangeRate);
  const totalMxnAmount = roundMoneyValue(totalMxnBillsAmount + totalMxnCoinsAmount);
  const totalComparableAmount = roundMoneyValue(totalMxnAmount + totalUsdMxnAmount);

  return {
    lines: normalizedLines,
    totalMxnBillsAmount: roundMoneyValue(totalMxnBillsAmount),
    totalMxnCoinsAmount: roundMoneyValue(totalMxnCoinsAmount),
    totalMxnAmount,
    totalUsdAmount: roundMoneyValue(totalUsdAmount),
    totalUsdMxnAmount,
    totalComparableAmount,
  };
}

function computeCashCutDraft(draft) {
  const safeDraft = draft || ensureCashDraft();
  const exchangeRate = roundRateValue(numberFromInput(safeDraft.exchange_rate, CASH_DEFAULT_EXCHANGE_RATE));
  const cashReceiptsAmount = roundMoneyValue(numberFromInput(safeDraft.cash_receipts_amount, 0));
  const refundReceiptsAmount = roundMoneyValue(numberFromInput(safeDraft.refund_receipts_amount, 0));
  const netCashSalesAmount = roundMoneyValue(cashReceiptsAmount - refundReceiptsAmount);
  const creditInvoicedSalesAmount = roundMoneyValue(numberFromInput(safeDraft.credit_invoiced_sales_amount, 0));
  const cashInvoicedSalesAmount = roundMoneyValue(numberFromInput(safeDraft.cash_invoiced_sales_amount, 0));
  const totalInvoicedSalesAmount = roundMoneyValue(creditInvoicedSalesAmount + cashInvoicedSalesAmount);
  const invoicedSalesMismatchAmount = 0;
  const salesUsdAmount = roundMoneyValue(numberFromInput(safeDraft.sales_usd_amount, 0));
  const salesUsdMxnAmount = roundMoneyValue(salesUsdAmount * exchangeRate);
  const ticketTotalAmount = roundMoneyValue(numberFromInput(safeDraft.ticket_total_amount, 0));
  const versatilCashCountAmount = roundMoneyValue(numberFromInput(safeDraft.versatil_cash_count_amount, 0));

  const productLines = (safeDraft.product_lines || []).map((row) => {
    const amount = roundMoneyValue(numberFromInput(row?.amount, 0));
    const participation = ticketTotalAmount > 0 ? (amount / ticketTotalAmount) * 100 : 0;
    return {
      product_label: trimmedOrEmpty(row?.product_label),
      amount,
      note: trimmedOrEmpty(row?.note),
      participation,
    };
  });

  const countedCashSet = computeCashDenominationSet(safeDraft.denomination_lines, exchangeRate);
  const denominationLines = countedCashSet.lines;
  const totalMxnBillsAmount = countedCashSet.totalMxnBillsAmount;
  const totalMxnCoinsAmount = countedCashSet.totalMxnCoinsAmount;
  const totalUsdAmount = countedCashSet.totalUsdAmount;
  const totalUsdMxnAmount = countedCashSet.totalUsdMxnAmount;
  const totalCountedCashAmount = countedCashSet.totalComparableAmount;

  const vaultWithdrawals = (safeDraft.vault_withdrawals || []).map((row, index) => {
    const denominationSet = computeCashDenominationSet(row?.denomination_lines, exchangeRate);
    const hasContent =
      !!trimmedOrEmpty(row?.reference_label) ||
      !!trimmedOrEmpty(row?.note) ||
      denominationSet.lines.some((entry) => Number(entry.quantity || 0) > 0);

    return {
      index,
      reference_label: trimmedOrEmpty(row?.reference_label),
      note: trimmedOrEmpty(row?.note),
      denomination_lines: denominationSet.lines,
      total_mxn_bills_amount: denominationSet.totalMxnBillsAmount,
      total_mxn_coins_amount: denominationSet.totalMxnCoinsAmount,
      total_mxn_amount: denominationSet.totalMxnAmount,
      total_usd_amount: denominationSet.totalUsdAmount,
      total_usd_mxn_amount: denominationSet.totalUsdMxnAmount,
      total_comparable_amount: denominationSet.totalComparableAmount,
      has_content: hasContent,
    };
  });
  const visibleVaultWithdrawals = vaultWithdrawals.filter((row) => row.has_content);
  const totalVaultWithdrawalsAmount = roundMoneyValue(
    visibleVaultWithdrawals.reduce((sum, row) => sum + Number(row.total_comparable_amount || 0), 0)
  );
  const totalDeliveredCashAmount = roundMoneyValue(totalCountedCashAmount + totalVaultWithdrawalsAmount);

  let totalCashAdjustmentsAmount = 0;
  let identifiedTransfersAmount = 0;
  let initialFundAmount = 0;
  const adjustments = CASH_ADJUSTMENT_ORDER.map((type) => {
    const meta = CASH_ADJUSTMENT_META[type];
    const row = (safeDraft.adjustment_lines || []).find((item) => item?.adjustment_type === type) || {};
    const rawAmount = meta?.syncFromRefunds
      ? refundReceiptsAmount
      : meta?.syncFromVaultWithdrawals
        ? totalVaultWithdrawalsAmount
        : roundMoneyValue(numberFromInput(row?.amount, 0));
    const direction = row?.direction || meta?.defaultDirection || "entrada";
    let signedAmount = rawAmount;
    if (meta?.fixedSign === "negative") signedAmount = -rawAmount;
    else if (meta?.fixedSign === "direction") signedAmount = direction === "salida" ? -rawAmount : rawAmount;
    else signedAmount = rawAmount;
    signedAmount = roundMoneyValue(signedAmount);
    if (type === "fondo_inicial") initialFundAmount = rawAmount;
    else if (type === "reembolso_dia") {
      // Refunds are already included in net cash sales.
    }
    else if (type === "retiro_boveda") {
      // Vault withdrawals remain part of the delivered cash and do not reduce expected cash.
    }
    else if (meta?.affectsCash) totalCashAdjustmentsAmount += signedAmount;
    else identifiedTransfersAmount += signedAmount;
    return {
      adjustment_type: type,
      label: meta?.label || type,
      direction,
      amount: rawAmount,
      signed_amount: signedAmount,
      affects_cash: !!meta?.affectsCash,
      support_reference: trimmedOrEmpty(row?.support_reference),
      note: trimmedOrEmpty(row?.note),
      is_amount_read_only: !!meta?.syncFromRefunds || !!meta?.syncFromVaultWithdrawals,
      fixed_sign: meta?.fixedSign || "direction",
    };
  });

  initialFundAmount = roundMoneyValue(initialFundAmount);
  totalCashAdjustmentsAmount = roundMoneyValue(totalCashAdjustmentsAmount);
  identifiedTransfersAmount = roundMoneyValue(identifiedTransfersAmount);

  const expectedCashAmount = roundMoneyValue(initialFundAmount + netCashSalesAmount + totalCashAdjustmentsAmount);
  const comparableCountedCashAmount = roundMoneyValue(totalDeliveredCashAmount);
  const differenceAmount = roundMoneyValue(totalDeliveredCashAmount - versatilCashCountAmount);

  return {
    exchangeRate,
    invoiceSaleAmount: roundMoneyValue(numberFromInput(safeDraft.invoice_sale_amount, 0)),
    cashReceiptsAmount,
    refundReceiptsAmount,
    netCashSalesAmount,
    creditInvoicedSalesAmount,
    cashInvoicedSalesAmount,
    totalInvoicedSalesAmount,
    invoicedSalesMismatchAmount,
    salesMxnAmount: roundMoneyValue(numberFromInput(safeDraft.sales_mxn_amount, 0)),
    salesUsdAmount,
    salesUsdMxnAmount,
    ivaZeroAmount: roundMoneyValue(numberFromInput(safeDraft.iva_zero_amount, 0)),
    ticketTotalAmount,
    versatilCashCountAmount,
    productLines,
    denominationLines,
    adjustments,
    vaultWithdrawals,
    visibleVaultWithdrawals,
    totalMxnBillsAmount: roundMoneyValue(totalMxnBillsAmount),
    totalMxnCoinsAmount: roundMoneyValue(totalMxnCoinsAmount),
    totalUsdAmount: roundMoneyValue(totalUsdAmount),
    totalUsdMxnAmount,
    totalCountedCashAmount,
    totalVaultWithdrawalsAmount,
    totalDeliveredCashAmount,
    initialFundAmount,
    comparableCountedCashAmount,
    totalCashAdjustmentsAmount,
    identifiedTransfersAmount,
    expectedCashAmount,
    differenceAmount,
  };
}

function normalizeCashCutError(message) {
  const code = String(message || "").trim();
  if (!code) return "";
  switch (code) {
    case "cash_cut_required":
      return "Falta la captura principal del Corte Z.";
    case "cash_cut_business_date_required":
      return "Selecciona la fecha del día que estás cerrando.";
    case "cash_cut_time_required":
      return "Captura inicio y fin del corte.";
    case "cash_cut_time_invalid":
      return "La hora de cierre no puede ser anterior al inicio del corte.";
    case "cash_cut_denominations_invalid":
      return "Las denominaciones del arqueo no tienen un formato válido.";
    case "cash_cut_adjustments_invalid":
      return "Los ajustes del cajero no tienen un formato válido.";
    case "cash_cut_vault_withdrawals_invalid":
      return "Los retiros a bóveda no tienen un formato válido.";
    case "cash_cut_vault_withdrawal_denom_invalid":
      return "Hay una denominación inválida dentro de un retiro a bóveda.";
    case "cash_cut_adjustment_amount_invalid":
      return "Hay un ajuste con importe inválido.";
    case "cash_cut_amount_invalid":
      return "Hay un importe del Corte Z con valor inválido.";
    case "cash_cut_exchange_rate_invalid":
      return "El tipo de cambio debe ser mayor a 0.";
    case "cash_cut_product_label_required":
      return "Cada linea de producto con importe debe tener nombre.";
    case "cash_cut_product_amount_invalid":
      return "Hay un importe de producto inválido.";
    case "cash_cut_actor_invalid":
      return "No se pudo validar el acceso del usuario para capturar el corte.";
    case "employee_not_linked":
      return "Este usuario empleado no está ligado a un empleado activo.";
    case "employee_must_match_linked_employee":
      return "El empleado del corte debe coincidir con el usuario que inició sesión.";
    case "employee_invalid":
      return "El empleado seleccionado no está activo o no es válido.";
    default:
      return code;
  }
}

function cashDifferenceKind(value) {
  const amount = roundMoneyValue(value);
  if (Math.abs(amount) < 0.005) return "ok";
  return amount > 0 ? "warn" : "error";
}

function cashDifferenceText(value) {
  const amount = roundMoneyValue(value);
  if (Math.abs(amount) < 0.005) return "Sin diferencia";
  return amount > 0 ? `Sobrante ${fmtMoney(amount)}` : `Faltante ${fmtMoney(Math.abs(amount))}`;
}

function cashComparableCountedAmount(source) {
  if (source?.delivered_cash_amount != null) return roundMoneyValue(Number(source.delivered_cash_amount || 0));
  return roundMoneyValue(Number(source?.total_counted_cash_amount || 0) + Number(source?.vault_withdrawals_total_amount || 0));
}

function cashAdjustmentEffectText(row) {
  if (row?.adjustment_type === "fondo_inicial") return "Entra al esperado / no afecta diferencia";
  if (row?.adjustment_type === "reembolso_dia") return "Ya descontado en venta neta";
  if (row?.adjustment_type === "retiro_boveda") return "Incluido en efectivo entregado";
  if (!row?.affects_cash) return "No entra a efectivo";
  return fmtSignedMoney(row.signed_amount);
}

function cashAdjustmentEffectClass(row) {
  if (row?.adjustment_type === "reembolso_dia") return "mono muted";
  if (row?.adjustment_type === "retiro_boveda") return "mono muted";
  if (!row?.affects_cash) return "mono muted";
  return `mono ${Number(row?.signed_amount || 0) < 0 ? "delta-neg" : "delta-pos"}`;
}

async function loadSession() {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    state.session = data.session;
    return data.session;
  } catch (error) {
    if (isSupabaseLockAbortError(error)) {
      return state.session;
    }
    throw error;
  }
}

async function loadActorContext() {
  if (!state.session) {
    resetActorState();
    return;
  }

  state.actorLoaded = false;
  try {
    const { data, error } = await withTimeout(
      supabase
        .from("workspace_users")
        .select("workspace_id,role,employee_id,merma_limit_kg,allow_all_sale_sku,allow_all_traspaso_sku,display_name")
        .eq("user_id", state.session.user.id)
        .maybeSingle(),
      7000,
      "Cargando permisos"
    );
    if (error) throw error;

    if (!data?.workspace_id || !data?.role) {
      state.actor = {
        ...defaultActorState(),
        has_access: false,
        access_reason: "not_assigned",
      };
      return;
    }

    const actor = {
      workspace_id: data?.workspace_id || null,
      role: String(data?.role || "").toLowerCase() === "employee" ? "employee" : "manager",
      employee_id: data?.employee_id || null,
      merma_limit_kg: data?.merma_limit_kg ?? null,
      allow_all_sale_sku: data?.allow_all_sale_sku !== false,
      allow_all_traspaso_sku: data?.allow_all_traspaso_sku !== false,
      display_name: data?.display_name || null,
      has_access: true,
      access_reason: null,
    };
    state.actor = actor;
  } catch (error) {
    const message = String(error?.message || error || "").toLowerCase();
    if (
      (message.includes("relation") && message.includes("workspace_users"))
      || (message.includes("workspace_users") && message.includes("does not exist"))
    ) {
      // Backward compatibility for databases that predate workspace access control.
      state.actor = {
        workspace_id: state.session.user.id,
        role: "manager",
        employee_id: null,
        merma_limit_kg: null,
        allow_all_sale_sku: true,
        allow_all_traspaso_sku: true,
        display_name: null,
        has_access: true,
        access_reason: null,
      };
    } else {
      throw error;
    }
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
  const activeRoute = route();
  const app = h("div", { class: "app" });

  function blurActiveElement() {
    try {
      const el = document.activeElement;
      if (el && typeof el.blur === "function") el.blur();
    } catch {
      // ignore
    }
  }

  const topbarSignOutBtn = state.session
    ? h(
        "button",
        {
          class: "btn btn-ghost topbar-signout",
          type: "button",
          onclick: async () => {
            await signOutCurrentUser();
          },
        },
        ["Cerrar sesion"]
      )
    : null;

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
        topbarSignOutBtn,
      ]),
    ]),
  ]);

  const content = h("div", { class: "content" }, [contentEl]);

  app.appendChild(topbar);
  app.appendChild(content);

  if (showNav && state.session) {
    const navItems = NAV_ITEMS.filter((it) => currentRouteAllowed(it.route) && navItemVisible(it));
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

  const routeChanged = activeRoute !== lastLaidOutRoute;
  lastLaidOutRoute = activeRoute;
  if (routeScrollResetPending || routeChanged) {
    routeScrollResetPending = false;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        try {
          window.scrollTo(0, 0);
          document.documentElement.scrollTop = 0;
          document.body.scrollTop = 0;
        } catch {
          // ignore
        }
      });
    });
  }
}

function notice(kind, text) {
  return h("div", { class: `notice ${kind || ""}` }, [h("div", { text })]);
}

function appendLabelContent(labelEl, labelContent) {
  const items = Array.isArray(labelContent) ? labelContent : [labelContent];
  for (const item of items) {
    if (item === null || item === undefined) continue;
    if (typeof item === "string") labelEl.appendChild(document.createTextNode(item));
    else labelEl.appendChild(item);
  }
}

function optionalLabel(baseText) {
  return [document.createTextNode(`${baseText} `), h("span", { class: "optional-mark", text: "(Opcional)" })];
}

function requiredLabel(baseText) {
  return [document.createTextNode(`${baseText} `), h("span", { class: "required-mark", text: "(Obligatorio)" })];
}

function automaticLabel(baseText) {
  return [document.createTextNode(`${baseText} `), h("span", { class: "auto-mark", text: "(Automático)" })];
}

function openCashGuideModal() {
  const backdrop = h("div", { class: "modal-backdrop" });
  const modal = h("div", { class: "modal col" });
  backdrop.appendChild(modal);

  function close() {
    backdrop.remove();
  }

  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });

  const sectionList = h("div", { class: "col", style: "gap: 8px" }, [
    h("div", { class: "cash-guide-highlight" }, [
      h("div", { class: "cash-guide-highlight-title", text: "Antes de empezar" }),
      h("div", { class: "cash-guide-highlight-body", text: "Estas secciones pueden dejarse vacías si no aplican ese día:" }),
      h("div", { class: "cash-guide-pill-row" }, [
        h("span", { class: "cash-guide-pill", text: "Desglose de venta por producto (Opcional)" }),
        h("span", { class: "cash-guide-pill", text: "Retiros a bóveda (solo si hubo)" }),
        h("span", { class: "cash-guide-pill", text: "Controles adicionales (solo si aplica)" }),
      ]),
    ]),
    h("div", { class: "notice" }, [
      h("div", { style: "font-weight: 780", text: "Orden recomendado" }),
      h("ol", { class: "cash-guide-list" }, [
        h("li", { text: "Captura primero Total del ticket y Arqueo de efectivo en comprobante Versatil." }),
        h("li", { text: "Llena Datos generales del corte." }),
        h("li", { text: "Llena Datos del ticket POS." }),
        h("li", { text: "Cuenta el efectivo en Arqueo físico." }),
        h("li", { text: "Si hubo retiros a bóveda, captúralos en su sección." }),
        h("li", { text: "Llena solo los movimientos que sí existieron en Controles adicionales del cajero." }),
        h("li", { text: "Revisa la Conciliación automática y luego guarda." }),
      ]),
    ]),
    h("div", { class: "notice" }, [
      h("div", { style: "font-weight: 780", text: "Secciones obligatorias" }),
      h("ul", { class: "cash-guide-list" }, [
        h("li", { text: "Datos clave" }),
        h("li", { text: "Datos generales del corte" }),
        h("li", { text: "Datos del ticket POS" }),
        h("li", { text: "Arqueo físico" }),
        h("li", { text: "Conciliación automática" }),
      ]),
    ]),
    h("div", { class: "notice" }, [
      h("div", { style: "font-weight: 780", text: "No dejes en blanco" }),
      h("ul", { class: "cash-guide-list" }, [
        h("li", { text: "Factura global / venta" }),
        h("li", { text: "Ventas a crédito facturadas" }),
        h("li", { text: "Ventas en efectivo facturadas" }),
        h("li", { text: "Folio inicio tickets" }),
        h("li", { text: "Folio fin tickets" }),
        h("li", { text: "Entregado por" }),
      ]),
    ]),
    h("div", { class: "notice" }, [
      h("div", { style: "font-weight: 780", text: "Secciones opcionales o segun el caso" }),
      h("ul", { class: "cash-guide-list" }, [
        h("li", { text: "Desglose de venta por producto (Opcional)." }),
        h("li", { text: "Retiros a bóveda: solo si realmente hubo retiros." }),
        h("li", { text: "Controles adicionales del cajero: llena solo los conceptos que sí ocurrieron." }),
      ]),
    ]),
    h("div", { class: "notice" }, [
      h("div", { style: "font-weight: 780", text: "Reglas clave" }),
      h("ul", { class: "cash-guide-list" }, [
        h("li", { text: "Fondo de caja inicial es informativo. No genera faltante por sí solo." }),
        h("li", { text: "Transferencias identificadas se registran, pero no cuentan como efectivo." }),
        h("li", { text: "Retiros a bóveda sí forman parte del efectivo entregado." }),
        h("li", { text: "Captura siempre ventas a crédito facturadas y ventas en efectivo facturadas, aunque una de las dos sea 0." }),
        h("li", { text: "Total de ventas facturadas se calcula automáticamente y no cambia la diferencia contra Versatil." }),
      ]),
    ]),
  ]);

  modal.append(
    h("div", { class: "row-wrap modal-header" }, [
      h("div", { class: "col", style: "gap: 4px" }, [
        h("div", { style: "font-weight: 820; font-size: 16px", text: "Guía rápida Corte Z" }),
        h("div", { class: "muted", text: "Resumen corto para empleados dentro de la app." }),
      ]),
      h("div", { class: "spacer" }),
      h("button", { class: "btn btn-ghost", type: "button", onclick: close }, ["Cerrar"]),
    ]),
    sectionList,
    h("div", { class: "row-wrap" }, [
      h("div", { class: "spacer" }),
      h("button", { class: "btn", type: "button", onclick: close }, ["Entendido"]),
    ])
  );

  document.body.appendChild(backdrop);
}

function field(labelText, inputEl) {
  const label = h("label");
  appendLabelContent(label, labelText);
  return h("div", {}, [label, inputEl]);
}

function labeledField(labelText, inputEl, inputId) {
  const label = h("label", { for: inputId });
  appendLabelContent(label, labelText);
  return h("div", {}, [label, inputEl]);
}

function createInput(type = "text", value = "", attrs = {}) {
  const el = h("input", { type, ...attrs });
  if (value != null) el.value = String(value);
  return el;
}

function createTextarea(value = "", attrs = {}) {
  const el = h("textarea", attrs);
  el.value = value != null ? String(value) : "";
  return el;
}

function createSelect(options = [], value = "", attrs = {}) {
  const children = [];
  for (const option of options) {
    children.push(
      h(
        "option",
        {
          value: option?.value ?? "",
          disabled: option?.disabled ? "true" : null,
        },
        [option?.label ?? ""]
      )
    );
  }
  const el = h("select", attrs, children);
  el.value = value != null ? String(value) : "";
  return el;
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
  let submit = null;
  const email = h("input", {
    id: "login-username",
    type: "text",
    name: "username",
    placeholder: "Email",
    autocomplete: "username",
    autocapitalize: "none",
    autocorrect: "off",
    spellcheck: "false",
    inputmode: "email",
    enterkeyhint: "next",
  });
  const password = h("input", {
    id: "login-password",
    type: "password",
    name: "password",
    placeholder: "Password",
    autocomplete: "current-password",
    autocapitalize: "none",
    autocorrect: "off",
    spellcheck: "false",
    enterkeyhint: "go",
  });
  const msg = h("div");

  async function handleLoginSubmit() {
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
  }

  email.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    password.focus();
  });
  password.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void handleLoginSubmit();
  });

  submit = h(
    "button",
    {
      class: "btn btn-primary",
      type: "submit",
    },
    ["Iniciar sesion"]
  );

  const form = h("form", {
    autocomplete: "on",
    novalidate: "true",
    onsubmit: (event) => {
      event.preventDefault();
      void handleLoginSubmit();
    },
  }, [
    msg,
    labeledField("Email", email, "login-username"),
    labeledField("Password", password, "login-password"),
    h("div", { class: "row-wrap" }, [submit]),
  ]);

  const card = h("div", { class: "card col" }, [
    h("div", { class: "h1", text: "Iniciar sesion" }),
    h("div", { class: "muted", text: "Usa tu usuario de Supabase Auth (email/password)." }),
    form,
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

  const buttons = [];
  const buttonById = new Map();

  function applyCurrent(next) {
    const normalized = String(next || "").trim();
    current = allowedSet.has(normalized) ? normalized : (types[0]?.id || "venta");
    for (const [id, btn] of buttonById.entries()) {
      btn.setAttribute("aria-pressed", id === current ? "true" : "false");
    }
  }

  for (const t of types) {
    const btn = h(
      "button",
      {
        class: "pill",
        type: "button",
        "aria-pressed": t.id === current ? "true" : "false",
        onclick: () => {
          applyCurrent(t.id);
          onChange?.(current);
        },
      },
      [t.label]
    );
    buttons.push(btn);
    buttonById.set(t.id, btn);
  }

  applyCurrent(current);

  return {
    el: h("div", { class: "pillbar" }, buttons),
    get: () => current,
    set: (next, { silent = false } = {}) => {
      const before = current;
      applyCurrent(next);
      if (!silent && current !== before) onChange?.(current);
    },
  };
}

function buildLineRow({ products, qualities, skus, mode, onRemove, employeeCapture = false, getAllowedSkusForMode = null }) {
  let currentMode = mode;
  const allSkus = Array.isArray(skus) ? [...skus] : [];
  const ENTRY_TARE_PRESET_WEIGHTS = {
    tarima_promedio: 15,
    tarima_bin: 30,
    tarima_bin_doble: 60,
  };
  const skuSel = h("select", {});

  const productSel = h("select", {}, optionList(products, { includeEmpty: true, emptyLabel: "Producto..." }));
  const qualitySel = h("select", {}, optionList(qualities, { includeEmpty: true, emptyLabel: "Calidad..." }));
  const weight = h("input", { type: "number", step: "0.001", min: "0", placeholder: "kg" });
  const grossWeight = h("input", { type: "number", step: "0.001", min: "0", placeholder: "peso bruto kg" });
  const tarePreset = h("select", {}, [
    h("option", { value: "manual", text: "Manual" }),
    h("option", { value: "tarima_promedio", text: "Tarima promedio" }),
    h("option", { value: "tarima_bin", text: "Tarima y bin" }),
    h("option", { value: "tarima_bin_doble", text: "Tarima y bin doble" }),
  ]);
  const tareWeight = h("input", { type: "number", step: "0.001", min: "0", placeholder: "tara kg" });

  const boxes = h("input", { type: "number", step: "1", min: "0", placeholder: "cajas" });
  const priceModel = h("select", {}, [
    h("option", { value: "", text: "Modelo de precio..." }),
    h("option", { value: "per_kg", text: "Por kg" }),
    h("option", { value: "per_box", text: "Por caja" }),
  ]);
  const unitPrice = h("input", { type: "number", step: "0.01", min: "0", placeholder: "precio unitario" });
  const total = h("div", { class: "muted right mono", text: "" });

  const skuField = h("div", {}, [field(employeeCapture ? "SKU" : "SKU (opcional)", skuSel)]);
  const productField = h("div", { style: "flex: 1; min-width: 200px" }, [field("Producto", productSel)]);
  const qualityField = h("div", { style: "flex: 1; min-width: 180px" }, [field("Calidad", qualitySel)]);
  const weightField = h("div", { style: "flex: 1; min-width: 140px" }, [field("Peso (kg)", weight)]);
  const grossWeightField = field("Peso Bruto (kg)", grossWeight);
  const tarePresetField = field("Tipo de tara", tarePreset);
  const tareWeightField = field("Tara a restar (kg)", tareWeight);
  const boxesField = field("Cajas (opcional)", boxes);
  const priceModelField = field("Modelo", priceModel);
  const unitPriceField = field("Precio unitario", unitPrice);
  const saleBoxesSlot = h("div");
  const entryBoxesSlot = h("div");
  const saleGrid = h("div", { class: "grid3" }, [priceModelField, saleBoxesSlot, unitPriceField]);
  const entryTareGrid = h("div", { class: "grid3" }, [grossWeightField, tarePresetField, tareWeightField]);
  const entryHint = h("div", { class: "notice" }, [
    h("div", { class: "muted", text: "Si capturas peso bruto y tara, el peso neto se calcula automáticamente. Si dejas peso bruto vacío, puedes capturar solo el peso neto." }),
  ]);
  const entryBoxesRow = h("div", { class: "grid2" }, [entryBoxesSlot, entryHint]);
  const totalRow = h("div", { class: "row" }, [h("div", { class: "spacer" }), total]);

  function allowedSkusForMode(nextMode = currentMode) {
    if (typeof getAllowedSkusForMode === "function") {
      const provided = getAllowedSkusForMode(nextMode, allSkus);
      if (Array.isArray(provided)) return provided;
    }
    return allSkus;
  }

  function formatWeightInput(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return "";
    return num.toFixed(3).replace(/\.000$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
  }

  function refreshSkuOptions(nextMode = currentMode, preserveValue = true) {
    const currentValue = preserveValue ? String(skuSel.value || "") : "";
    const allowed = allowedSkusForMode(nextMode);
    skuSel.replaceChildren(
      h("option", { value: "", text: employeeCapture ? "SKU..." : "SKU (opcional)..." }),
      ...allowed.map((s) => h("option", { value: s.id, text: `${Number(s.code)} ${String(s.name)}` }))
    );
    if (currentValue && allowed.some((s) => String(s.id) === currentValue)) {
      skuSel.value = currentValue;
    }
  }

  function findSku(id) {
    const value = String(id || "").trim();
    return allSkus.find((x) => String(x.id) === value) || null;
  }

  function mountBoxesField(target, labelText) {
    saleBoxesSlot.replaceChildren();
    entryBoxesSlot.replaceChildren();
    boxesField.querySelector("label")?.replaceChildren(document.createTextNode(labelText));
    target?.replaceChildren(boxesField);
  }

  function syncSkuDerivedFields() {
    const s = findSku(skuSel.value);
    if (s) {
      productSel.value = String(s.product_id || "");
      qualitySel.value = String(s.quality_id || "");
      if (currentMode === "venta" && s.default_price_model && !priceModel.disabled && !priceModel.value) {
        priceModel.value = String(s.default_price_model);
      }
      return;
    }
    if (employeeCapture && currentMode !== "traspaso_calidad" && currentMode !== "traspaso_sku") {
      productSel.value = "";
      qualitySel.value = "";
    }
  }

  function syncEntryNetWeight() {
    if (currentMode !== "entrada") {
      weight.readOnly = false;
      return;
    }
    weightField.querySelector("label")?.replaceChildren(document.createTextNode("Peso Neto en KG"));
    const grossRaw = String(grossWeight.value || "").trim();
    const grossValue = Number(grossWeight.value);
    const tareValue = Number(tareWeight.value);
    if (grossRaw && Number.isFinite(grossValue) && grossValue >= 0) {
      const next = Math.max(0, grossValue - (Number.isFinite(tareValue) && tareValue > 0 ? tareValue : 0));
      weight.value = formatWeightInput(next);
      weight.readOnly = true;
      return;
    }
    weight.readOnly = false;
  }

  function updateEntryTarePresentation() {
    const selected = String(tarePreset.value || "manual");
    const presetWeight = ENTRY_TARE_PRESET_WEIGHTS[selected];
    if (Number.isFinite(presetWeight)) {
      tareWeight.value = formatWeightInput(presetWeight);
      tareWeight.readOnly = true;
    } else {
      tareWeight.readOnly = false;
    }
    if (selected === "manual") {
      tareWeight.placeholder = "tara kg";
    } else if (selected === "tarima_promedio") {
      tareWeight.placeholder = "tara kg (tarima promedio)";
    } else if (selected === "tarima_bin") {
      tareWeight.placeholder = "tara kg (tarima y bin)";
    } else {
      tareWeight.placeholder = "tara kg (tarima y bin doble)";
    }
    syncEntryNetWeight();
  }

  skuSel.addEventListener("change", () => {
    syncSkuDerivedFields();
    if (currentMode === "venta") {
      setVisibilityForMode(currentMode);
      return;
    }
    if (currentMode === "entrada") syncEntryNetWeight();
    recalc();
  });

  function recalc() {
    if (currentMode === "entrada") {
      syncEntryNetWeight();
    }
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
  grossWeight.addEventListener("input", syncEntryNetWeight);
  tarePreset.addEventListener("change", updateEntryTarePresentation);
  tareWeight.addEventListener("input", syncEntryNetWeight);
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
    skuField,
    h("div", { class: "row-wrap" }, [
      productField,
      qualityField,
      weightField,
    ]),
    entryTareGrid,
    entryBoxesRow,
    saleGrid,
    totalRow,
    h("div", { class: "row-wrap" }, [h("div", { class: "spacer" }), removeBtn]),
  ]);

  function get() {
    return {
      sku_id: String(skuSel.value || ""),
      product_id: String(productSel.value || ""),
      quality_id: String(qualitySel.value || ""),
      weight_kg: String(weight.value || ""),
      gross_weight_kg: String(grossWeight.value || ""),
      tare_preset: String(tarePreset.value || "manual"),
      tare_weight_kg: String(tareWeight.value || ""),
      boxes: String(boxes.value || ""),
      price_model: String(priceModel.value || ""),
      unit_price: String(unitPrice.value || ""),
    };
  }

  function setValues(values = {}) {
    if (values == null || typeof values !== "object") return;
    refreshSkuOptions(currentMode, false);
    skuSel.value = String(values.sku_id || "");
    productSel.value = String(values.product_id || "");
    qualitySel.value = String(values.quality_id || "");
    weight.value = String(values.weight_kg != null ? values.weight_kg : "");
    grossWeight.value = String(values.gross_weight_kg != null ? values.gross_weight_kg : "");
    tarePreset.value = String(values.tare_preset || "manual");
    tareWeight.value = String(values.tare_weight_kg != null ? values.tare_weight_kg : "");
    boxes.value = String(values.boxes != null ? values.boxes : "");
    priceModel.value = String(values.price_model || "");
    unitPrice.value = String(values.unit_price != null ? values.unit_price : "");
    syncSkuDerivedFields();
    updateEntryTarePresentation();
    recalc();
  }

  function setVisibilityForMode(nextMode) {
    currentMode = nextMode;
    refreshSkuOptions(nextMode);
    saleGrid.style.display = nextMode === "venta" ? "" : "none";
    entryTareGrid.style.display = nextMode === "entrada" ? "" : "none";
    entryBoxesRow.style.display = nextMode === "entrada" ? "" : "none";
    totalRow.style.display = nextMode === "venta" ? "" : "none";
    const employeeSkuDrivenMode = employeeCapture && nextMode !== "traspaso_calidad" && nextMode !== "traspaso_sku";

    if (nextMode === "traspaso_calidad") {
      skuSel.value = "";
      skuField.style.display = "none";
      productField.style.display = "";
      qualitySel.value = "";
      qualityField.style.display = "none";
      productSel.disabled = false;
      qualitySel.disabled = false;
    } else if (nextMode === "traspaso_sku") {
      skuSel.value = "";
      skuField.style.display = "none";
      productField.style.display = "none";
      qualityField.style.display = "none";
      productSel.disabled = true;
      qualitySel.disabled = true;
    } else if (employeeSkuDrivenMode) {
      skuField.style.display = "";
      productField.style.display = "none";
      qualityField.style.display = "none";
      productSel.disabled = true;
      qualitySel.disabled = true;
    } else {
      skuField.style.display = "";
      productField.style.display = "";
      qualityField.style.display = "";
      productSel.disabled = false;
      qualitySel.disabled = false;
    }

    if (nextMode === "entrada") {
      mountBoxesField(entryBoxesSlot, "Numero de cajas (opcional)");
      priceModel.value = "";
      unitPrice.value = "";
      total.textContent = "";
      priceModel.disabled = false;
      priceModelField.style.display = "";
      unitPriceField.style.display = "";
    } else if (nextMode === "venta") {
      const s = findSku(skuSel.value);
      const employeeSaleModel = String(s?.default_price_model || "") === "per_box" ? "per_box" : "per_kg";
      if (employeeCapture) {
        priceModel.value = employeeSaleModel;
        priceModel.disabled = true;
        priceModelField.style.display = "none";
        if (employeeSaleModel === "per_box") {
          mountBoxesField(saleBoxesSlot, "Cajas");
        } else {
          saleBoxesSlot.replaceChildren();
          entryBoxesSlot.replaceChildren();
          boxes.value = "";
        }
      } else {
        priceModel.disabled = false;
        priceModelField.style.display = "";
        mountBoxesField(saleBoxesSlot, "Cajas (opcional)");
      }
      if (s && s.default_price_model && !priceModel.value) {
        priceModel.value = String(s.default_price_model);
      }
      recalc();
    } else {
      saleBoxesSlot.replaceChildren();
      entryBoxesSlot.replaceChildren();
      boxes.value = "";
      priceModel.value = "";
      unitPrice.value = "";
      total.textContent = "";
      priceModel.disabled = false;
      priceModelField.style.display = "";
      unitPriceField.style.display = "";
      weightField.querySelector("label")?.replaceChildren(document.createTextNode("Peso (kg)"));
      weight.readOnly = false;
      grossWeight.value = "";
      tarePreset.value = "manual";
      tareWeight.value = "";
    }
    syncSkuDerivedFields();
    updateEntryTarePresentation();
    if (nextMode !== "traspaso_calidad" && nextMode !== "entrada" && !qualitySel.value && qualities.length === 1) {
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

  refreshSkuOptions(currentMode, false);
  setVisibilityForMode(currentMode);

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

async function pageCapture(pageCtx, options = {}) {
  const isActive = () => isPageContextActive(pageCtx);
  const forcedMovementType = MOVEMENT_TYPES[String(options?.forcedMovementType || "").trim()]
    ? String(options.forcedMovementType).trim()
    : null;
  const pageTitle = String(options?.pageTitle || (forcedMovementType === "entrada" ? ROUTE_TITLES.entries : ROUTE_TITLES.capture));
  const OCCURRED_AT_AUTO_SYNC_MS = 15000;
  const products = state.products.filter((p) => p.is_active);
  const qualities = state.qualities.filter((q) => q.is_active).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const skus = state.skus.filter((s) => s.is_active).sort((a, b) => (a.code || 0) - (b.code || 0));
  const employees = state.employees.filter((e) => e.is_active).sort((a, b) => String(a.name).localeCompare(String(b.name)));

  const msg = h("div");
  if (state.captureFlashNotice?.text) {
    msg.appendChild(notice(state.captureFlashNotice.kind || "", String(state.captureFlashNotice.text)));
    state.captureFlashNotice = null;
  }
  let restoredCaptureDraftNotice = false;
  let restoredProofDraftNotice = false;

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
    layout(pageTitle, card);
    return;
  }

  const isActorManager = isManager();
  const actorRequiresEmployee = hasProofRequirement();
  const autoEmpId = actorEmployeeId();
  const actorDisplayName = getActorDisplayName() || employeeName(autoEmpId) || "Empleado asociado";
  const entryOnlyCaptureForEmployee = !isActorManager && forcedMovementType === "entrada";
  if (!isActorManager) {
    storageRemove(STORAGE_KEYS.captureFixedDatetimeLock);
    storageRemove(STORAGE_KEYS.captureFixedDatetimeValue);
    storageRemove(STORAGE_KEYS.captureBatchMode);
    storageRemove(STORAGE_KEYS.captureBatchCloseTime);
  }
  let employeeSaleSkuIds = new Set(
    skus.map((s) => String(s.id))
  );
  const employeeToSkuByFrom = new Map();

  function employeeSalePriceModelForSkuId(skuId) {
    const sku = skus.find((s) => String(s.id) === String(skuId || ""));
    return String(sku?.default_price_model || "") === "per_box" ? "per_box" : "per_kg";
  }

  if (!isActorManager && state.actor?.allow_all_sale_sku === false && state.actor?.workspace_id) {
    const { data, error } = await supabase
      .from("workspace_sale_sku_rules")
      .select("sku_id,is_allowed")
      .eq("workspace_id", state.actor.workspace_id)
      .eq("is_allowed", true);
    if (!isActive()) return;
    if (error) {
      msg.appendChild(notice("warn", "No se pudieron cargar las reglas de venta SKU. Solo se aplicará la validación del servidor."));
    } else {
      const allowedIds = new Set((data || []).map((row) => String(row.sku_id || "")).filter(Boolean));
      employeeSaleSkuIds = new Set([...employeeSaleSkuIds].filter((id) => allowedIds.has(id)));
    }
  }

  if (!isActorManager && state.actor?.allow_all_traspaso_sku === false && state.actor?.workspace_id) {
    const { data, error } = await supabase
      .from("workspace_traspaso_sku_rules")
      .select("from_sku_id,to_sku_id,is_allowed")
      .eq("workspace_id", state.actor.workspace_id)
      .eq("is_allowed", true);
    if (!isActive()) return;
    if (error) {
      msg.appendChild(notice("warn", "No se pudieron cargar las reglas de traspaso SKU. Solo se aplicará la validación del servidor."));
    } else {
      for (const rule of data || []) {
        const fromId = String(rule.from_sku_id || "");
        const toId = String(rule.to_sku_id || "");
        if (!fromId || !toId) continue;
        if (!employeeToSkuByFrom.has(fromId)) employeeToSkuByFrom.set(fromId, new Set());
        employeeToSkuByFrom.get(fromId).add(toId);
      }
    }
  }

  function allowedLineSkusForMode(nextMode, allSkus) {
    if (isActorManager) return allSkus;
    if (nextMode === "venta") {
      return allSkus.filter((s) => employeeSaleSkuIds.has(String(s.id)));
    }
    return allSkus;
  }

  const employeeCanUseTraspasoSku =
    isActorManager || state.actor?.allow_all_traspaso_sku !== false || employeeToSkuByFrom.size > 0;
  const baseMovementTypes = forcedMovementType ? [forcedMovementType] : movementTypesForActor();
  const availableMovementTypes = baseMovementTypes.filter((mt) => {
    if (!isActorManager && mt === "venta" && employeeSaleSkuIds.size === 0) return false;
    if (!isActorManager && mt === "traspaso_sku" && !employeeCanUseTraspasoSku) return false;
    return true;
  });

  const fixedDtLockOn = storageGet(STORAGE_KEYS.captureFixedDatetimeLock, "0") === "1";
  const fixedDtSaved = storageGet(STORAGE_KEYS.captureFixedDatetimeValue, "");
  const occurredAt = h("input", {
    type: "datetime-local",
    value: isActorManager && fixedDtLockOn && fixedDtSaved ? fixedDtSaved : localNowInputValue(),
  });
  let occurredAtDirtyWhileUnlocked = false;
  const lockOccurredAt = h("input", { type: "checkbox" });
  lockOccurredAt.checked = isActorManager && fixedDtLockOn;
  const fixedDatetimeWarning = h("div");
  const useNowBtn = h("button", { class: "btn btn-ghost", type: "button" }, ["Usar ahora"]);
  const aggregateMode = h("input", { type: "checkbox" });
  aggregateMode.checked = isActorManager && storageGet(STORAGE_KEYS.captureBatchMode, "0") === "1";
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

  function updateFixedDatetimeWarning() {
    if (!isActorManager || !lockOccurredAt.checked) {
      fixedDatetimeWarning.replaceChildren();
      return;
    }
    const label = occurredAt.value ? formatOccurredAt(occurredAt.value) : "(sin fecha/hora)";
    fixedDatetimeWarning.replaceChildren(
      notice(
        "warn",
        `Fecha/hora fija activa: ${label}. Todo lo que guardes seguirá usando esta fecha/hora hasta que desactives la casilla o presiones "Usar ahora".`
      )
    );
  }

  function setOccurredAtToNow({ persistIfLocked = true } = {}) {
    const nextValue = localNowInputValue();
    const changed = String(occurredAt.value || "") !== nextValue;
    occurredAt.value = nextValue;
    occurredAtDirtyWhileUnlocked = false;
    if (isActorManager && lockOccurredAt.checked && persistIfLocked) {
      storageSet(STORAGE_KEYS.captureFixedDatetimeValue, String(occurredAt.value || ""));
    }
    if (isActorManager && aggregateMode.checked && !aggregateCloseTimeEdited) {
      const suggested = batchCloseDefaultTime(occurredAt.value);
      batchClosePresetTodayDefault.dataset.preset = suggested;
      setAggregateCloseTime(suggested, false);
    }
    updateFixedDatetimeWarning();
    if (changed) queueDraftSave();
  }

  function shouldAutoSyncOccurredAt() {
    if (isActorManager) return false;
    if (!isActive() || !isAppInForeground()) return false;
    if (occurredAtDirtyWhileUnlocked) return false;
    if (document.activeElement === occurredAt) return false;
    return true;
  }

  function syncOccurredAtIfNeeded({ force = false } = {}) {
    if (isActorManager) return;
    if (!force && !shouldAutoSyncOccurredAt()) return;
    const nextValue = localNowInputValue();
    if (!force && String(occurredAt.value || "") === nextValue) return;
    setOccurredAtToNow({ persistIfLocked: true });
  }

  useNowBtn.addEventListener("click", () => {
    setOccurredAtToNow({ persistIfLocked: true });
  });
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
    { class: "muted checkrow" },
    [aggregateNoCutoff, h("span", { text: "Confirmo que este movimiento agregado NO incluye periodo de corte físico." })]
  );
  const batchCloseWrap = h("div", { class: "col" }, [field("Hora de cierre", aggregateCloseTime), batchClosePresetWrap]);
  const batchHint = h("div", { class: "muted" }, [
    "En modo agregado: se registra como un bloque y se marca con [AGREGADO] para rastrear que fue captura consolidada.",
  ]);
  const mermaExhibition = h("input", { type: "checkbox" });
  const mermaDegustation = h("input", { type: "checkbox" });
  const mermaFlagsSection = h("div", { class: "merma-flags col" }, [
    h("div", { class: "merma-flags-title", text: "Clasificación de merma" }),
    h("div", { class: "muted", text: "Marca si esta merma corresponde a producto de exhibición o degustación." }),
    h("label", { class: "checkrow" }, [mermaExhibition, h("span", { text: "Exhibición" })]),
    h("label", { class: "checkrow" }, [mermaDegustation, h("span", { text: "Degustación" })]),
  ]);
  const notes = h("textarea", { placeholder: "Notas (opcional). Ej: cliente, contexto..." });
  const currency = h("input", { type: "text", value: DEFAULT_CURRENCY, placeholder: "Moneda (MXN)" });
  const reportedBy = h("select", {}, optionList(employees, { includeEmpty: true, emptyLabel: "(Opcional)..." }));
  if (autoEmpId) {
    reportedBy.value = autoEmpId;
    if (!isActorManager) {
      reportedBy.setAttribute("disabled", "true");
    }
  }
  const reportedByField = isActorManager
    ? field("Empleado", reportedBy)
    : [field("Empleado", h("div", { class: "muted", text: actorDisplayName }))];

  const fromQuality = h("select", {}, optionList(qualities, { includeEmpty: true, emptyLabel: "De calidad..." }));
  const toQuality = h("select", {}, optionList(qualities, { includeEmpty: true, emptyLabel: "A calidad..." }));

  const fromSku = h("select", {});
  const toSku = h("select", {});

  const adjustDir = h(
    "select",
    {},
    [
      h("option", { value: "decrease", text: "Disminuir (-kg)" }),
      h("option", { value: "increase", text: "Aumentar (+kg)" }),
    ]
  );

  let proofs = null;
  const employeeProofMsg = h("div");
  const employeeProofsWrap = h("div", { class: "col" });
  const employeeProofActions = h("div", { class: "row-wrap" });
  const employeeEntrySheetProofMsg = h("div");
  const employeeEntrySheetProofsWrap = h("div", { class: "col" });
  const employeeEntrySheetProofActions = h("div", { class: "row-wrap" });

  function clearEmployeeProofList(stateKey) {
    for (const item of state[stateKey] || []) {
      revokeObjectUrl(item?.preview_url);
    }
    state[stateKey] = [];
  }

  function renderEmployeeProofCollection(stateKey, wrapEl, emptyText) {
    wrapEl.replaceChildren();
    const items = state[stateKey] || [];
    if (items.length === 0) {
      wrapEl.appendChild(notice("warn", emptyText));
      return;
    }
    wrapEl.appendChild(
      h(
        "div",
        { class: "thumbgrid" },
        items.map((item, index) =>
          h("div", { class: "card col", style: "padding: 10px; gap: 8px" }, [
            h("img", {
              class: "thumb",
              src: item.preview_url,
              alt: item.file?.name || "evidencia",
            }),
            h("div", { class: "muted", text: item.stamp_text || employeeCaptureStampTime(new Date(item.captured_at_iso || Date.now())) }),
            h(
              "button",
              {
                class: "btn btn-ghost",
                type: "button",
                onclick: () => {
                  const removed = state[stateKey].splice(index, 1)[0];
                  revokeObjectUrl(removed?.preview_url);
                  if (stateKey === "captureEmployeeProofs") {
                    void persistEmployeeCaptureProofs();
                  }
                  renderEmployeeProofCollection(stateKey, wrapEl, emptyText);
                },
              },
              ["Quitar"]
            ),
          ])
        )
      )
    );
  }

  function renderEmployeeProofs() {
    renderEmployeeProofCollection("captureEmployeeProofs", employeeProofsWrap, "Todavía no hay foto de evidencia.");
  }

  function renderEmployeeEntrySheetProofs() {
    renderEmployeeProofCollection("captureEmployeeEntrySheetProofs", employeeEntrySheetProofsWrap, "Todavía no hay foto de la hoja de entrada.");
  }

  async function captureEmployeeProofTo(stateKey, messageEl, title, { replaceExisting = false } = {}) {
    messageEl.replaceChildren();
    try {
      const captured = await openEmployeeCameraCaptureModal({ employeeName: actorDisplayName, title });
      if (!captured) return;
      if (replaceExisting) clearEmployeeProofList(stateKey);
      if (!Array.isArray(state[stateKey])) state[stateKey] = [];
      state[stateKey].push(captured);
      if (stateKey === "captureEmployeeProofs") {
        await persistEmployeeCaptureProofs();
        renderEmployeeProofs();
      } else {
        renderEmployeeEntrySheetProofs();
      }
    } catch (error) {
      messageEl.replaceChildren(
        notice("error", error?.message ? String(error.message) : "No se pudo tomar la foto.")
      );
    }
  }

  async function captureEmployeeProof() {
    await captureEmployeeProofTo(
      "captureEmployeeProofs",
      employeeProofMsg,
      entryOnlyCaptureForEmployee ? "Tomar evidencia del movimiento" : "Tomar evidencia"
    );
  }

  async function captureEmployeeEntrySheetProof() {
    await captureEmployeeProofTo(
      "captureEmployeeEntrySheetProofs",
      employeeEntrySheetProofMsg,
      "Tomar foto de hoja de entrada",
      { replaceExisting: true }
    );
  }

  if (isActorManager) {
    proofs = h("input", { type: "file", accept: "image/*", multiple: "multiple" });
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
  } else {
    employeeProofActions.append(
      h("button", { class: "btn btn-primary", type: "button", onclick: captureEmployeeProof }, ["Tomar foto"]),
      h(
        "button",
        {
          class: "btn btn-ghost",
          type: "button",
          onclick: () => {
            clearEmployeeProofList("captureEmployeeProofs");
            void persistEmployeeCaptureProofs();
            renderEmployeeProofs();
          },
        },
        ["Limpiar fotos"]
      )
    );
    renderEmployeeProofs();

    if (entryOnlyCaptureForEmployee) {
      employeeEntrySheetProofActions.append(
        h("button", { class: "btn btn-primary", type: "button", onclick: captureEmployeeEntrySheetProof }, ["Tomar foto de hoja"]),
        h(
          "button",
          {
            class: "btn btn-ghost",
            type: "button",
            onclick: () => {
              clearEmployeeProofList("captureEmployeeEntrySheetProofs");
              renderEmployeeEntrySheetProofs();
            },
          },
          ["Quitar foto"]
        )
      );
      renderEmployeeEntrySheetProofs();
    }
  }

  const proofsHint = h("div", { class: "muted" }, [
    actorRequiresEmployee
      ? entryOnlyCaptureForEmployee
        ? "Entrada de empleado: se requiere una sola foto de la hoja de entrada para todo el registro."
        : "Evidencia obligatoria (empleado): solo se permite tomar la foto desde la cámara de la app."
      : "Evidencia (opcional): foto(s) de WhatsApp o captura de pantalla.",
  ]);

  const pills = movementTypePills({
    allowed: availableMovementTypes,
    initial:
      forcedMovementType ||
      ((state.captureNextMode && availableMovementTypes.includes(String(state.captureNextMode))
        ? String(state.captureNextMode)
        : availableMovementTypes[0]) || "venta"),
    onChange: (mt) => updateMode(mt),
  });
  state.captureNextMode = null;

  const showMovementTypePills = !forcedMovementType && availableMovementTypes.length > 1;
  let currentMode = pills.get();
  const linesWrap = h("div", { class: "col" });
  const lineRows = [];
  let draftRestoreInProgress = false;
  let draftSaveTimer = null;
  const MAX_DRAFT_LINES = 200;

  function getSelectedCaptureMode() {
    const pillMode = String(pills.get() || "").trim();
    if (availableMovementTypes.includes(pillMode)) return pillMode;
    if (availableMovementTypes.includes(String(currentMode || "").trim())) return String(currentMode || "").trim();
    return availableMovementTypes[0] || "venta";
  }

  function saveCaptureDraftNow() {
    if (state.captureSubmitting || isProofPickerOpen) return;
    if (draftRestoreInProgress) return;
    if (draftSaveTimer) {
      window.clearTimeout(draftSaveTimer);
      draftSaveTimer = null;
    }
    currentMode = getSelectedCaptureMode();
    const draftLines = lineRows.length > MAX_DRAFT_LINES ? lineRows.slice(0, MAX_DRAFT_LINES) : lineRows;
    const payload = {
      movementType: currentMode,
      occurredAt:
        isActorManager && !!lockOccurredAt.checked
          ? normalizeDraftValue(occurredAt.value, localNowInputValue())
          : null,
      lockOccurredAt: !!lockOccurredAt.checked,
      aggregateMode: !!aggregateMode.checked,
      aggregateCloseTime: normalizeDraftValue(aggregateCloseTime.value),
      notes: normalizeDraftValue(notes.value),
      mermaExhibition: !!mermaExhibition.checked,
      mermaDegustation: !!mermaDegustation.checked,
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
    captureDraftStatus.state = "saved";
  }

  function queueDraftSave() {
    if (state.captureSubmitting || isProofPickerOpen) return;
    if (draftRestoreInProgress) return;
    if (draftSaveTimer) window.clearTimeout(draftSaveTimer);
    captureDraftStatus.state = "saving";
    draftSaveTimer = window.setTimeout(() => {
      saveCaptureDraftNow();
    }, CAPTURE_DRAFT_AUTOSAVE_MS);
  }

  function clearCaptureDraft() {
    storageRemove(STORAGE_KEYS.captureDraft);
    captureDraftStatus.state = "idle";
    captureDraftStatus.restored = false;
  }

  captureDraftFlushFn = () => {
    if (route() !== "capture") return;
    saveCaptureDraftNow();
  };

  function applyCaptureDraft() {
    const wrapped = loadCaptureDraft();
    if (!wrapped?.payload || typeof wrapped.payload !== "object") return false;
    const draft = wrapped.payload;
    if (!draft) return false;
    const allowed = availableMovementTypes;
      if (draft.movementType && allowed.includes(String(draft.movementType))) {
        currentMode = String(draft.movementType);
        pills.set(currentMode, { silent: true });
      }
    draftRestoreInProgress = true;
    try {
      if (isActorManager && draft.lockOccurredAt && draft.occurredAt) {
        occurredAt.value = String(draft.occurredAt);
        occurredAtDirtyWhileUnlocked = false;
      } else {
        occurredAt.value = localNowInputValue();
        occurredAtDirtyWhileUnlocked = false;
      }
      lockOccurredAt.checked = isActorManager && !!draft.lockOccurredAt;
      aggregateMode.checked = isActorManager && !!draft.aggregateMode;
      aggregateCloseTime.value = normalizeDraftValue(draft.aggregateCloseTime, aggregateCloseTime.value);
      notes.value = String(draft.notes || "");
      mermaExhibition.checked = !!draft.mermaExhibition;
      mermaDegustation.checked = !!draft.mermaDegustation;
      currency.value = String(draft.currency || DEFAULT_CURRENCY).trim() || DEFAULT_CURRENCY;
      fromQuality.value = normalizeDraftValue(draft.fromQuality, "");
      toQuality.value = normalizeDraftValue(draft.toQuality, "");
      fromSku.value = normalizeDraftValue(draft.fromSku, "");
      toSku.value = normalizeDraftValue(draft.toSku, "");
      adjustDir.value = normalizeDraftValue(draft.adjustDir, "decrease") === "increase" ? "increase" : "decrease";
      aggregateNoCutoff.checked = !!draft.aggregateNoCutoff;

      const draftLines = Array.isArray(draft.lines) ? draft.lines : [];
      if (draftLines.length > 0) {
        const lineLimit = entryOnlyCaptureForEmployee ? 16 : MAX_DRAFT_LINES;
        while (lineRows.length < Math.min(draftLines.length, lineLimit)) addLine();
        while (lineRows.length > Math.min(draftLines.length, lineLimit)) {
          const lastRow = lineRows.pop();
          if (lastRow?.el) lastRow.el.remove();
        }
        const target = Math.min(Math.min(draftLines.length, lineLimit), lineRows.length);
        for (let i = 0; i < target; i++) {
          lineRows[i].setValues(draftLines[i]);
        }
      }

      updateMode(currentMode);
      setBatchClosePresetState(aggregateCloseTime.value);
      aggregateCloseTime.disabled = !isActorManager || !aggregateMode.checked;
      batchCloseWrap.style.display = isActorManager && aggregateMode.checked ? "" : "none";
      batchHint.style.display = isActorManager && aggregateMode.checked ? "" : "none";
      aggregateNoCutoff.disabled = !isActorManager || !aggregateMode.checked;
      aggregateNoCutoffRow.style.display = isActorManager && aggregateMode.checked ? "" : "none";
      if (isActorManager && aggregateMode.checked) {
        const suggested = batchCloseDefaultTime(occurredAt.value);
        batchClosePresetTodayDefault.dataset.preset = suggested;
        setAggregateCloseTime(aggregateCloseTime.value || suggested, true);
      }
      updateFixedDatetimeWarning();
    } finally {
      draftRestoreInProgress = false;
      queueDraftSave();
    }
    captureDraftStatus.restored = true;
    return true;
  }

  function setSkuSelectOptions(selectEl, items, emptyLabel, preserve = true) {
    const currentValue = preserve ? String(selectEl.value || "") : "";
    selectEl.replaceChildren(
      h("option", { value: "", text: emptyLabel }),
      ...items.map((s) => h("option", { value: s.id, text: `${Number(s.code)} ${String(s.name)}` }))
    );
    if (currentValue && items.some((s) => String(s.id) === currentValue)) {
      selectEl.value = currentValue;
    }
  }

  function allowedFromTraspasoSkus() {
    if (isActorManager || state.actor?.allow_all_traspaso_sku !== false) return skus;
    return skus.filter((s) => employeeToSkuByFrom.has(String(s.id)));
  }

  function allowedToTraspasoSkus(fromId) {
    if (isActorManager || state.actor?.allow_all_traspaso_sku !== false) {
      return skus.filter((s) => String(s.id) !== String(fromId || ""));
    }
    const allowed = employeeToSkuByFrom.get(String(fromId || ""));
    if (!allowed) return [];
    return skus.filter((s) => allowed.has(String(s.id)));
  }

  function refreshTraspasoSkuOptions() {
    const fromItems = allowedFromTraspasoSkus();
    setSkuSelectOptions(fromSku, fromItems, "De SKU...");
    const fromId = String(fromSku.value || "");
    const toItems = fromId ? allowedToTraspasoSkus(fromId) : [];
    setSkuSelectOptions(toSku, toItems, "A SKU...");
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

  const captureLineLimit = entryOnlyCaptureForEmployee ? 16 : MAX_DRAFT_LINES;
  let addLineBtn = null;

  function updateAddLineAvailability() {
    if (!addLineBtn) return;
    const atLimit = entryOnlyCaptureForEmployee && lineRows.length >= captureLineLimit;
    addLineBtn.disabled = atLimit;
    addLineBtn.textContent = atLimit ? `Máximo ${captureLineLimit} líneas` : "Agregar línea";
  }

  function addLine() {
    if (entryOnlyCaptureForEmployee && lineRows.length >= captureLineLimit) {
      msg.replaceChildren(notice("warn", `La captura de entradas de empleado permite hasta ${captureLineLimit} líneas por registro.`));
      return;
    }
    const row = buildLineRow({
      products,
      qualities,
      skus,
      mode: currentMode,
      employeeCapture: !isActorManager,
      getAllowedSkusForMode: allowedLineSkusForMode,
      onRemove: () => {
        const idx = lineRows.indexOf(row);
        if (idx >= 0) {
          lineRows.splice(idx, 1);
          row.el.remove();
          updateAddLineAvailability();
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
    pills.set(mt, { silent: true });
    currentMode = mt;
    for (const row of lineRows) row.setMode(mt);

    traspasoSection.style.display = mt === "traspaso_calidad" ? "" : "none";
    traspasoSkuSection.style.display = mt === "traspaso_sku" ? "" : "none";
    ajusteSection.style.display = mt === "ajuste" ? "" : "none";
    mermaFlagsSection.style.display = mt === "merma" ? "" : "none";
    currencySection.style.display = mt === "venta" ? "" : "none";
    refreshTraspasoSkuOptions();
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
  mermaFlagsSection.style.display = currentMode === "merma" ? "" : "none";

  refreshTraspasoSkuOptions();
  fromSku.addEventListener("change", () => {
    refreshTraspasoSkuOptions();
    applyTraspasoSkuBucket();
    updateTraspasoSkuMeta();
    queueDraftSave();
  });
  toSku.addEventListener("change", () => {
    updateTraspasoSkuMeta();
    queueDraftSave();
  });
  occurredAt.addEventListener("input", (event) => {
    if ((isActorManager && lockOccurredAt.checked) || !event?.isTrusted) return;
    occurredAtDirtyWhileUnlocked = true;
  });
  let aggregateCloseTimeEdited = false;
  occurredAt.addEventListener("change", () => {
    if (!isActorManager || !lockOccurredAt.checked) {
      occurredAtDirtyWhileUnlocked = true;
    }
    if (isActorManager && lockOccurredAt.checked) storageSet(STORAGE_KEYS.captureFixedDatetimeValue, String(occurredAt.value || ""));
    if (isActorManager && aggregateMode.checked && !aggregateCloseTimeEdited) {
      const suggested = batchCloseDefaultTime(occurredAt.value);
      batchClosePresetTodayDefault.dataset.preset = suggested;
      setAggregateCloseTime(suggested, false);
    }
    updateFixedDatetimeWarning();
    queueDraftSave();
  });
  aggregateCloseTime.addEventListener("change", () => {
    if (!isActorManager) return;
    aggregateCloseTimeEdited = true;
    storageSet(STORAGE_KEYS.captureBatchCloseTime, String(aggregateCloseTime.value || ""));
    setBatchClosePresetState(aggregateCloseTime.value);
  });
  lockOccurredAt.addEventListener("change", () => {
    if (!isActorManager) return;
    storageSet(STORAGE_KEYS.captureFixedDatetimeLock, lockOccurredAt.checked ? "1" : "0");
    if (lockOccurredAt.checked) {
      if (!occurredAt.value) occurredAt.value = localNowInputValue();
      storageSet(STORAGE_KEYS.captureFixedDatetimeValue, String(occurredAt.value || ""));
    } else {
      occurredAtDirtyWhileUnlocked = false;
      syncOccurredAtIfNeeded({ force: true });
    }
    updateFixedDatetimeWarning();
    queueDraftSave();
  });
  if (!isActorManager) {
    const occurredAtAutoSyncTimer = window.setInterval(() => {
      if (!isActive()) {
        window.clearInterval(occurredAtAutoSyncTimer);
        return;
      }
      syncOccurredAtIfNeeded();
    }, OCCURRED_AT_AUTO_SYNC_MS);
    syncOccurredAtIfNeeded({ force: true });
  }
  setBatchClosePresetState(aggregateCloseTime.value);
  updateFixedDatetimeWarning();
  aggregateCloseTime.disabled = !isActorManager || !aggregateMode.checked;
  batchCloseWrap.style.display = isActorManager && aggregateMode.checked ? "" : "none";
  batchHint.style.display = isActorManager && aggregateMode.checked ? "" : "none";
  aggregateNoCutoff.disabled = !isActorManager || !aggregateMode.checked;
  aggregateNoCutoffRow.style.display = isActorManager && aggregateMode.checked ? "" : "none";
  aggregateNoCutoff.checked = false;
  aggregateMode.addEventListener("change", () => {
    if (!isActorManager) return;
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
    mermaExhibition.checked = false;
    mermaDegustation.checked = false;
    if (proofs) proofs.value = "";
    clearEmployeeCaptureProofs({ clearStored: true });
    renderEmployeeProofs();
    occurredAtDirtyWhileUnlocked = false;
    if (isActorManager && lockOccurredAt.checked) {
      storageSet(STORAGE_KEYS.captureFixedDatetimeValue, String(occurredAt.value || ""));
    } else {
      occurredAt.value = localNowInputValue();
    }
    if (isActorManager) reportedBy.value = "";
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
    updateFixedDatetimeWarning();
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
        let shouldRefreshCaptureAfterSuccess = false;
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
        const submitMode = getSelectedCaptureMode();
        currentMode = submitMode;
        if (!availableMovementTypes.includes(submitMode)) {
          msg.appendChild(notice("error", "No tienes permiso para ese tipo de movimiento."));
          return;
        }
        const isAggregateMode = isActorManager && aggregateMode.checked;
        const aggregateDtIso = isAggregateMode ? buildBatchOccurredIso(dtInputValue, aggregateCloseTime.value) : null;
        if (isAggregateMode && !aggregateDtIso) {
          msg.appendChild(notice("error", "Hora de cierre invalida para el registro agregado."));
          return;
        }
        if (isAggregateMode && !aggregateNoCutoff.checked) {
          msg.appendChild(notice("error", "Confirma que este registro no se hizo dentro de una toma física de inventario activa."));
          return;
        }
        let noteBase = String(notes.value || "").trim();
        if (submitMode === "merma") {
          const mermaTags = [];
          if (mermaExhibition.checked) mermaTags.push("Exhibición");
          if (mermaDegustation.checked) mermaTags.push("Degustación");
          if (mermaTags.length) {
            noteBase = [`[MERMA: ${mermaTags.join(" | ")}]`, noteBase].filter(Boolean).join(" ");
          }
        }
        const closeTime = isAggregateMode ? String(aggregateCloseTime.value || batchCloseDefaultTime(dtInputValue)) : "";
        const isMarked = noteBase.toUpperCase().includes("[AGREGADO]");
        const aggregateSuffix = isAggregateMode && !isMarked ? ` [AGREGADO] registrado al cierre ${closeTime}` : "";
        const finalNotes = isAggregateMode ? `${noteBase}${aggregateSuffix}`.trim() : noteBase;

        const movementProofFiles = isActorManager
          ? Array.from(proofs?.files || [])
          : (state.captureEmployeeProofs || []).map((item) => item.file).filter(Boolean);
        const entrySheetProofFiles = !isActorManager && submitMode === "entrada"
          ? (state.captureEmployeeEntrySheetProofs || []).map((item) => item.file).filter(Boolean)
          : [];
        const files = isActorManager
          ? movementProofFiles
          : submitMode === "entrada"
            ? entrySheetProofFiles
            : movementProofFiles;
        if (!isActorManager && submitMode === "entrada" && entrySheetProofFiles.length === 0) {
          msg.appendChild(notice("error", "Como empleado, debes adjuntar una foto de la hoja de entrada."));
          return;
        }
        if (hasProofRequirement() && submitMode !== "entrada" && movementProofFiles.length === 0) {
          msg.appendChild(notice("error", "Como empleado, debes adjuntar evidencia para guardar el movimiento."));
          return;
        }
        const rawLines = lineRows.map((r) => r.get());
        if (!isActorManager && submitMode === "entrada" && rawLines.length > captureLineLimit) {
          msg.appendChild(notice("error", `La captura de entradas de empleado permite hasta ${captureLineLimit} líneas por registro.`));
          return;
        }
        const parsed = [];
        await maybeYield(1, 1);

        const fromSkuId = String(fromSku.value || "");
        const toSkuId = String(toSku.value || "");
        const fromSkuObj = fromSkuId ? skuById(fromSkuId) : null;
        const toSkuObj = toSkuId ? skuById(toSkuId) : null;

        if (submitMode === "traspaso_sku") {
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
          if (!isActorManager && submitMode !== "traspaso_sku" && !sku_id) {
            return msg.appendChild(notice("error", `Linea ${i + 1}: elige un SKU.`));
          }
          if (submitMode !== "traspaso_sku" && !product_id) return msg.appendChild(notice("error", `Linea ${i + 1}: elige un producto.`));
          if (submitMode !== "traspaso_calidad" && submitMode !== "traspaso_sku" && !quality_id) {
            return msg.appendChild(notice("error", `Linea ${i + 1}: elige una calidad.`));
          }
          if (!Number.isFinite(w) || w <= 0) return msg.appendChild(notice("error", `Linea ${i + 1}: kg invalido.`));

          const row = { sku_id: sku_id || null, product_id: product_id || null, weight_kg: w };
          if (submitMode !== "traspaso_calidad") row.quality_id = quality_id || null;

          if (submitMode === "venta") {
            const pm = !isActorManager ? employeeSalePriceModelForSkuId(sku_id) : ln.price_model;
            const up = Number(ln.unit_price);
            const b = ln.boxes ? Number(ln.boxes) : null;
            if (!isActorManager && !employeeSaleSkuIds.has(sku_id)) {
              return msg.appendChild(notice("error", `Linea ${i + 1}: este SKU no está autorizado para venta de empleado.`));
            }
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

        if (submitMode === "traspaso_calidad") {
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
            movement_type: submitMode,
            occurred_at: isAggregateMode ? aggregateDtIso : dtIso,
            notes: finalNotes || null,
            currency: submitMode === "venta" ? String(currency.value || DEFAULT_CURRENCY).trim() || DEFAULT_CURRENCY : DEFAULT_CURRENCY,
            reported_by_employee_id: autoEmpId || String(reportedBy.value || "") || null,
            from_sku_id: submitMode === "traspaso_sku" ? fromSkuId : null,
            to_sku_id: submitMode === "traspaso_sku" ? toSkuId : null,
            from_quality_id: submitMode === "traspaso_calidad" ? String(fromQuality.value) : null,
            to_quality_id: submitMode === "traspaso_calidad" ? String(toQuality.value) : null,
          };

          const lines = [];
          for (let iLine = 0; iLine < parsed.length; iLine++) {
            await maybeYield(iLine + 1, SUBMIT_PARSE_YIELD_EVERY);
            const ln = parsed[iLine];
            if (submitMode === "entrada") {
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
            } else if (submitMode === "venta") {
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
            } else if (submitMode === "merma") {
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
            } else if (submitMode === "ajuste") {
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
            } else if (submitMode === "traspaso_calidad") {
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
            } else if (submitMode === "traspaso_sku") {
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

          const savedMovement = await Promise.race([
            fetchSavedMovementReference(newId),
            new Promise((resolve) => window.setTimeout(() => resolve(null), POST_SAVE_REFERENCE_WAIT_MS)),
          ]);
          const successText = movementSavedText(submitMode, savedMovement || newId);
          state.captureFlashNotice = { kind: "ok", text: successText, movement_id: newId };
          state.captureNextMode = submitMode;
          msg.replaceChildren(notice("ok", successText));
          resetCaptureFormAfterSave();
          shouldRefreshCaptureAfterSuccess = true;
          if (!savedMovement) {
            void fetchSavedMovementReference(newId)
              .then((resolvedMovement) => {
                if (!resolvedMovement?.reference_number) return;
                const hydratedText = movementSavedText(submitMode, resolvedMovement);
                if (msg.isConnected) {
                  msg.replaceChildren(notice("ok", hydratedText));
                }
                state.captureFlashNotice = { kind: "ok", text: hydratedText, movement_id: newId };
                if (isActive()) scheduleSafeRender();
              })
              .catch(() => {
                // Ignore delayed lookup failures; the movement is already saved.
              });
          }
        } catch (e) {
          // If timeout happened but insert actually reached DB, avoid duplicate capture on retry.
          if (movementId) {
            try {
              const { data: existing } = await supabase
                .from("movements")
                .select("id,reference_number")
                .eq("id", movementId)
                .maybeSingle();
              if (existing?.id) {
                const successText = `Guardado: ${movementLabel(submitMode)} | ID ${movementShortId(existing)}`;
                state.captureFlashNotice = { kind: "ok", text: successText };
                state.captureNextMode = submitMode;
                msg.replaceChildren(notice("ok", successText));
                resetCaptureFormAfterSave();
                shouldRefreshCaptureAfterSuccess = true;
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
          if (shouldRefreshCaptureAfterSuccess) scheduleSafeRender();
        }
      },
    },
      ["Guardar movimiento"]
  );

  const discardCaptureDraftBtn = h(
    "button",
    {
      class: "btn btn-ghost",
      type: "button",
      onclick: () => {
        clearCaptureDraft();
        resetCaptureFormAfterSave();
        msg.replaceChildren(notice("ok", "Borrador descartado."));
      },
    },
    ["Descartar borrador"]
  );

  const card = h("div", { class: "col" }, [
    h("div", { class: "card col" }, [
      h("div", { class: "h1", text: forcedMovementType === "entrada" ? "Nueva entrada" : "Nuevo movimiento" }),
      h("div", { class: "muted", text: isActorManager ? "Todo se registra en kg. Evidencia (WhatsApp) opcional." : entryOnlyCaptureForEmployee ? "Todo se registra en kg. La hoja de entrada por foto es obligatoria para empleados." : "Todo se registra en kg. La evidencia por foto es obligatoria para empleados." }),
      h("div", { class: "muted", text: "Nota: el inventario se calcula por (Producto + Calidad). SKUs vinculados comparten saldo (ej: 103 descuenta de 102; 106 descuenta de 101; 301 descuenta de 300)." }),
      !isActorManager ? notice("warn", entryOnlyCaptureForEmployee ? "Para guardar una entrada debes adjuntar una sola foto de la hoja de entrada." : "Evidencia por medio de foto necesaria para poder capturar un movimiento.") : null,
      h("div", { class: "row-wrap cash-draft-bar" }, [
        h("div", {
          class: "muted cash-draft-status",
          text:
            captureDraftStatus.state === "saving"
              ? "Borrador guardándose..."
              : captureDraftStatus.restored
                ? "Borrador restaurado y guardado localmente."
                : "Borrador local activo.",
        }),
        h("div", { class: "spacer" }),
        discardCaptureDraftBtn,
      ]),
      msg,
      showMovementTypePills ? pills.el : null,
      mermaFlagsSection,
      h("div", { class: "divider" }),
      h("div", { class: "grid2" }, [
        h("div", { class: "col" }, [
          field("Fecha/hora", occurredAt),
          h("div", { class: "row-wrap" }, [useNowBtn]),
          isActorManager ? fixedDatetimeWarning : null,
        ]),
        ...(Array.isArray(reportedByField) ? reportedByField : [reportedByField]),
      ]),
      isActorManager
        ? h(
            "label",
            { class: "muted checkrow" },
            [lockOccurredAt, h("span", { text: "Mantener fecha/hora fija despues de guardar." })]
          )
        : null,
      isActorManager
        ? h(
            "label",
            { class: "muted checkrow" },
            [aggregateMode, h("span", { text: "Registro agregado del día (lote). Se usa solo si no hubo corte físico." })]
          )
        : null,
      isActorManager ? aggregateNoCutoffRow : null,
      isActorManager ? batchCloseWrap : null,
      isActorManager ? batchHint : null,
      field("Notas", notes),
      currencySection,
      traspasoSection,
      traspasoSkuSection,
      isActorManager ? ajusteSection : null,
      h("div", { class: "divider" }),
      h("div", { class: "row-wrap" }, [h("div", { class: "h1", text: "Lineas" }), h("div", { class: "spacer" }), addLineBtn]),
      linesWrap,
      h("div", { class: "divider" }),
      isActorManager
        ? field("Evidencia (fotos)", proofs)
        : entryOnlyCaptureForEmployee
          ? h("div", { class: "col" }, [
              h("div", { class: "h1", text: "Hoja de entrada (foto obligatoria)" }),
              employeeEntrySheetProofMsg,
              employeeEntrySheetProofActions,
              employeeEntrySheetProofsWrap,
            ])
          : h("div", { class: "col" }, [
              h("div", { class: "h1", text: "Evidencia (foto)" }),
              employeeProofMsg,
              employeeProofActions,
              employeeProofsWrap,
            ]),
      proofsHint,
      h("div", { class: "row-wrap" }, [submitBtn]),
    ]),
    h("div", { class: "notice" }, [
      h("div", { class: "muted" }, [
        "Tip: Para papaya de 2da vendida por caja con peso variable, usa Venta + modelo Por caja, e ingresa cajas + kg.",
      ]),
      ]),
  ]);

  if (!isActorManager && state.captureEmployeeProofs.length === 0) {
    const restoredProofs = await loadStoredEmployeeCaptureProofs();
    if (!isActive()) return;
    if (restoredProofs.length > 0) {
      clearEmployeeCaptureProofs();
      state.captureEmployeeProofs = restoredProofs;
      restoredProofDraftNotice = true;
      renderEmployeeProofs();
    }
  }

  restoredCaptureDraftNotice = applyCaptureDraft();
  if (msg.childElementCount === 0 && (restoredCaptureDraftNotice || restoredProofDraftNotice)) {
    msg.appendChild(
      notice(
        "ok",
        restoredCaptureDraftNotice && restoredProofDraftNotice
          ? "Se restauró tu borrador anterior, incluyendo la evidencia pendiente."
          : restoredProofDraftNotice
            ? "Se restauró tu evidencia pendiente."
            : "Se restauró tu borrador anterior."
      )
    );
  }
  card.addEventListener("input", () => queueDraftSave());
  card.addEventListener("change", () => queueDraftSave());
  layout(pageTitle, card);
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

  const openMovementDetails = async (movement) => {
    try {
      await openMovementModal(movement, pageCtx);
    } catch (error) {
      if (!isActive()) return;
      msg.replaceChildren(
        notice("error", error?.message ? String(error.message) : "No se pudo abrir el movimiento.")
      );
    }
  };

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
          "id,reference_number,movement_type,occurred_at,notes,currency,reported_by_employee_id,from_sku_id,to_sku_id,from_quality_id,to_quality_id,created_at," +
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
            class: "btn btn-primary",
            type: "button",
            onclick: (event) => {
              event?.preventDefault?.();
              event?.stopPropagation?.();
              void openMovementDetails(m);
            },
          },
          ["Ver"]
        );

        const card = h("div", {
          class: "card col movement-card",
          role: "button",
          tabindex: "0",
          onclick: () => {
            void openMovementDetails(m);
          },
          onkeydown: (event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            void openMovementDetails(m);
          },
        }, [
          h("div", { class: "row" }, [
            h("div", { class: "col", style: "gap: 4px" }, [
              h("div", { style: "font-weight: 760", text: title }),
              h("div", { class: "muted", text: subtitle }),
              h("div", { class: "muted mono", text: `ID ${movementShortId(m)}` }),
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
      h("div", { class: "muted mono", text: `ID: ${movementShortId(m)}` }),
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

  if (attachments.length === 0) {
    proofsWrap.replaceChildren(notice("warn", "Sin evidencia."));
    return;
  }

  proofsWrap.replaceChildren(notice("", "Cargando evidencia..."));

  void (async () => {
    try {
      const signed = [];
      for (let i = 0; i < attachments.length; i++) {
        const a = attachments[i];
        const { data, error } = await supabase.storage.from("movement-proofs").createSignedUrl(a.storage_path, 60 * 30);
        if (!isActive() || !document.body.contains(backdrop)) return;
        if (error) {
          console.warn("Could not create signed URL for movement proof", a.storage_path, error);
        } else {
          signed.push({ ...a, signedUrl: data?.signedUrl || null });
        }
        await maybeYield(i + 1, 3);
      }

      if (!isActive() || !document.body.contains(backdrop)) return;

      const visibleSigned = signed.filter((a) => a.signedUrl);
      if (visibleSigned.length === 0) {
        proofsWrap.replaceChildren(notice("warn", "No se pudo cargar la evidencia, pero el movimiento sigue disponible."));
        return;
      }

      const extraCount = Math.max(0, visibleSigned.length - 6);
      proofsWrap.replaceChildren(
        h("div", { class: "thumbgrid" }, [
          ...visibleSigned.slice(0, 6).map((a) =>
            h("a", { href: a.signedUrl, target: "_blank", rel: "noreferrer" }, [
              h("img", { class: "thumb", src: a.signedUrl, alt: a.original_filename || "proof" }),
            ])
          ),
        ]),
        extraCount > 0 ? h("div", { class: "muted", text: `+ ${extraCount} evidencia(s) adicional(es)` }) : null
      );
    } catch (error) {
      console.error("Failed to load movement evidence", error);
      if (!isActive() || !document.body.contains(backdrop)) return;
      proofsWrap.replaceChildren(notice("warn", "No se pudo cargar la evidencia, pero el movimiento sigue disponible."));
    }
  })();
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
    h("label", { class: "checkrow" }, [
      lineMeasuredAtLock,
      h("span", { text: "Fijar fecha/hora para siguientes pesajes." }),
    ]),
  ]);

  const page = h("div", { class: "col" }, [
    h("div", { class: "card col no-print" }, [
      h("div", { class: "h1", text: "Nuevo corte fisico" }),
      h("div", { class: "muted", text: "Registra un corte para comparar inventario fisico vs sistema." }),
      createMsg,
      h("div", { class: "grid2" }, [field("Inicio", createStarted), field(optionalLabel("Cierre"), createEnded)]),
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
        h("div", { class: "grid2" }, [field("Peso (kg)", lineWeight), field(optionalLabel("Evidencia"), lineProofs)]),
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

async function pageCash(pageCtx) {
  const isActive = () => isPageContextActive(pageCtx);
  const managerMode = isManager();
  const employeeMode = actorRole() === "employee";
  let restoredCashDraftNotice = false;
  if (!state.cashDraft) {
    const wrapped = loadCashDraft();
    if (wrapped?.payload && typeof wrapped.payload === "object") {
      state.cashDraft = wrapped.payload;
      restoredCashDraftNotice = true;
    }
  }
  const draft = ensureCashDraft();
  const activeEmployees = [...state.employees]
    .filter((employee) => employee.is_active)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  const cashierOptions = [
    { value: "", label: "Elige empleado..." },
    ...activeEmployees.map((employee) => ({
      value: employee.id,
      label: employee.name,
    })),
  ];

  const formMsg = h("div");
  const productRowsWrap = h("div", { class: "col" });
  const denominationWrap = h("div", { class: "cash-denomination-grid" });
  const vaultWithdrawalsWrap = h("div", { class: "col" });
  const adjustmentsWrap = h("div", { class: "col" });
  const summaryWrap = h("div", { class: "cash-summary-grid" });
  const posWarningWrap = h("div", { class: "cash-pos-warning-wrap" });
  const detailMsg = h("div");
  const listMsg = h("div");
  const listWrap = h("div", { class: "col" });
  let loadingList = false;
  let loadingDetail = false;
  let listRows = [];
  let cashDraftRestoreInProgress = false;
  let cashDraftSaveTimer = null;

  const productParticipationEls = [];
  const productAmountEls = [];
  const denominationTotalEls = [];
  const vaultWithdrawalTotalEls = [];
  let vaultWithdrawalsGrandTotalEl = null;
  const adjustmentAmountEls = [];
  const adjustmentDirectionEls = [];
  const adjustmentEffectEls = [];
  const summaryRefs = {};
  const detailTitle = h("div", { class: "h1", text: "Reporte imprimible" });
  const detailCard = managerMode
    ? h("div", { class: "card col" }, [
        h("div", { class: "row-wrap no-print" }, [
          detailTitle,
          h("div", { class: "spacer" }),
          h(
            "button",
            {
              class: "btn",
              type: "button",
              onclick: () => window.print(),
            },
            ["Imprimir"]
          ),
          h(
            "button",
            {
              class: "btn btn-ghost",
              type: "button",
              onclick: () => {
                state.cashSelectedId = null;
                detailTitle.textContent = "Reporte imprimible";
                detailMsg.replaceChildren(notice("warn", "Elige un corte para revisar o imprimir."));
                scheduleSafeRender();
              },
            },
            ["Cerrar reporte"]
          ),
        ]),
        detailMsg,
      ])
    : null;

  const businessDateInput = createInput("date", draft.business_date);
  const branchNameInput = createInput("text", draft.branch_name, { placeholder: "Sucursal" });
  const cutTypeInput = createInput("text", draft.cut_type, { placeholder: "Corte Z" });
  const cutFolioInput = createInput("text", draft.cut_folio, { placeholder: "Opcional" });
  const startedAtInput = createInput("datetime-local", draft.started_at);
  const endedAtInput = createInput("datetime-local", draft.ended_at);
  const cashierInput = employeeMode
    ? h("div", { class: "notice" }, [h("div", { text: employeeName(draft.cashier_employee_id) || getActorDisplayName() || "Empleado no ligado" })])
    : createSelect(cashierOptions, draft.cashier_employee_id);
  const cashierSystemInput = createInput("text", draft.cashier_system_name, { placeholder: "Nombre en sistema" });
  const customersServedInput = createInput("number", draft.customers_served, { min: "0", step: "1", inputmode: "numeric" });
  const ticketStartFolioInput = createInput("text", draft.ticket_start_folio);
  const ticketEndFolioInput = createInput("text", draft.ticket_end_folio);
  const deliveredByInput = createInput("text", draft.delivered_by);
  const receivedByInput = createInput("text", draft.received_by);
  const observationsInput = createTextarea(draft.observations, { placeholder: "Observaciones generales del corte..." });

  const invoiceSaleInput = createInput("number", draft.invoice_sale_amount, { min: "0", step: "0.01", inputmode: "decimal" });
  const cashReceiptsInput = createInput("number", draft.cash_receipts_amount, { min: "0", step: "0.01", inputmode: "decimal" });
  const refundReceiptsInput = createInput("number", draft.refund_receipts_amount, { min: "0", step: "0.01", inputmode: "decimal" });
  const creditInvoicedSalesInput = createInput("number", draft.credit_invoiced_sales_amount, { min: "0", step: "0.01", inputmode: "decimal" });
  const cashInvoicedSalesInput = createInput("number", draft.cash_invoiced_sales_amount, { min: "0", step: "0.01", inputmode: "decimal" });
  const totalInvoicedSalesInput = createInput("text", "", { readonly: "true" });
  const netCashSalesInput = createInput("text", "", { readonly: "true" });
  const salesMxnInput = createInput("number", draft.sales_mxn_amount, { min: "0", step: "0.01", inputmode: "decimal" });
  const salesUsdInput = createInput("number", draft.sales_usd_amount, { min: "0", step: "0.01", inputmode: "decimal" });
  const exchangeRateInput = createInput("number", draft.exchange_rate, { min: "0", step: "0.0001", inputmode: "decimal" });
  const salesUsdMxnInput = createInput("text", "", { readonly: "true" });
  const ivaZeroInput = createInput("number", draft.iva_zero_amount, { min: "0", step: "0.01", inputmode: "decimal" });
  const ticketTotalInput = createInput("number", draft.ticket_total_amount, { min: "0", step: "0.01", inputmode: "decimal" });
  const versatilCashCountInput = createInput("number", draft.versatil_cash_count_amount, { min: "0", step: "0.01", inputmode: "decimal" });

  const listBusinessDateInput = createInput("date", state.cashFilters.business_date || "");
  const listCashierInput = createSelect(cashierOptions, state.cashFilters.cashier_employee_id || "");

  function cashField(labelText, inputEl, extraClass = "") {
    const label = h("label", { class: "cash-form-label" });
    appendLabelContent(label, labelText);
    return h("div", { class: `cash-form-field${extraClass ? ` ${extraClass}` : ""}` }, [
      label,
      inputEl,
    ]);
  }

  function clearCashFlash() {
    if (!state.cashFlashNotice) return;
    state.cashFlashNotice = null;
    formMsg.replaceChildren();
  }

  function showCashFormNotice(kind, text) {
    formMsg.replaceChildren(notice(kind, text));
  }

  function showStoredCashNotice() {
    formMsg.replaceChildren();
    if (!state.cashFlashNotice) return;
    formMsg.appendChild(notice(state.cashFlashNotice.kind || "ok", state.cashFlashNotice.text || ""));
  }

  function saveCashDraftNow() {
    if (state.cashSubmitting || cashDraftRestoreInProgress) return;
    if (!state.cashDraft || typeof state.cashDraft !== "object") return;
    if (cashDraftSaveTimer) {
      window.clearTimeout(cashDraftSaveTimer);
      cashDraftSaveTimer = null;
    }
    storageSet(STORAGE_KEYS.cashDraft, JSON.stringify(buildCashDraft(state.cashDraft)));
    cashDraftStatus.state = "saved";
  }

  function queueCashDraftSave() {
    if (state.cashSubmitting || cashDraftRestoreInProgress) return;
    if (cashDraftSaveTimer) window.clearTimeout(cashDraftSaveTimer);
    cashDraftStatus.state = "saving";
    cashDraftSaveTimer = window.setTimeout(() => {
      saveCashDraftNow();
    }, CASH_DRAFT_AUTOSAVE_MS);
  }

  function clearCashDraftStorage() {
    storageRemove(STORAGE_KEYS.cashDraft);
    cashDraftStatus.state = "idle";
    cashDraftStatus.restored = false;
  }

  cashDraftFlushFn = () => {
    if (route() !== "cash") return;
    saveCashDraftNow();
  };

  function setTextSummary(key, label, value, extraClass = "") {
    const card = summaryRefs[key];
    if (!card) return;
    card.label.textContent = label;
    card.value.textContent = value;
    card.value.className = `cash-summary-value${extraClass ? ` ${extraClass}` : ""}`;
  }

  function refreshComputed() {
    const computed = computeCashCutDraft(draft);
    netCashSalesInput.value = fmtMoney(computed.netCashSalesAmount);
    totalInvoicedSalesInput.value = fmtMoney(computed.totalInvoicedSalesAmount);
    salesUsdMxnInput.value = fmtMoney(computed.salesUsdMxnAmount);
    draft.total_invoiced_sales_amount = computed.totalInvoicedSalesAmount.toFixed(2);

    computed.productLines.forEach((row, index) => {
      if (productParticipationEls[index]) {
        productParticipationEls[index].textContent = `${row.participation.toFixed(1)}%`;
      }
      if (productAmountEls[index] && document.activeElement !== productAmountEls[index]) {
        productAmountEls[index].value = draft.product_lines[index]?.amount ?? "";
      }
    });

    computed.denominationLines.forEach((row, index) => {
      if (denominationTotalEls[index]) denominationTotalEls[index].textContent = fmtMoney(row.line_total, row.currency);
    });

    computed.adjustments.forEach((row, index) => {
      const amountEl = adjustmentAmountEls[index];
      const directionEl = adjustmentDirectionEls[index];
      const effectEl = adjustmentEffectEls[index];
      if (amountEl) {
        if (row.is_amount_read_only) {
          amountEl.textContent = fmtMoney(row.amount || 0);
        } else if ("value" in amountEl) {
          amountEl.readOnly = false;
        }
      }
      if (directionEl) {
        if ("value" in directionEl) {
          directionEl.disabled = false;
          directionEl.value = row.direction || "entrada";
        } else {
          directionEl.textContent =
            row.fixed_sign === "negative"
              ? "Salida fija"
              : row.fixed_sign === "positive"
                ? "Entrada fija"
                : "Dirección fija";
        }
      }
      if (effectEl) {
        effectEl.textContent = cashAdjustmentEffectText(row);
        effectEl.className = cashAdjustmentEffectClass(row);
      }
    });

    computed.vaultWithdrawals.forEach((row, index) => {
      const totalEl = vaultWithdrawalTotalEls[index];
      if (totalEl) {
        totalEl.textContent = `Total retiro comparable: ${fmtMoney(row.total_comparable_amount)}`;
      }
    });
    if (vaultWithdrawalsGrandTotalEl) {
      vaultWithdrawalsGrandTotalEl.textContent = fmtMoney(computed.totalVaultWithdrawalsAmount);
    }

    posWarningWrap.replaceChildren(
      h("div", { class: "cash-pos-warning cash-pos-info" }, [
        h("div", { class: "cash-pos-warning-title", text: "Control de ventas facturadas" }),
        h(
          "div",
          {
            class: "cash-pos-warning-body",
            text: `El total de ventas facturadas se calcula automáticamente: crédito ${fmtMoney(computed.creditInvoicedSalesAmount)} + efectivo ${fmtMoney(computed.cashInvoicedSalesAmount)} = ${fmtMoney(computed.totalInvoicedSalesAmount)}.`
          }
        ),
        h("div", { class: "cash-pos-warning-note muted", text: "Este total es informativo y no cambia el faltante o sobrante del corte." }),
      ])
    );

    setTextSummary("countedMxn", "Efectivo contado MXN", fmtMoney(computed.totalMxnBillsAmount + computed.totalMxnCoinsAmount));
    setTextSummary("countedUsd", "USD contado", fmtMoney(computed.totalUsdAmount, "USD"));
    setTextSummary("countedUsdMxn", "USD contado en MXN", fmtMoney(computed.totalUsdMxnAmount));
    setTextSummary("physicalTotal", "Efectivo contado en caja", fmtMoney(computed.totalCountedCashAmount));
    setTextSummary("initialFund", "Fondo de caja inicial", fmtMoney(computed.initialFundAmount));
    setTextSummary("vaultWithdrawals", "Retiros a bóveda", fmtMoney(computed.totalVaultWithdrawalsAmount));
    setTextSummary("comparablePhysical", "Total efectivo entregado", fmtMoney(computed.comparableCountedCashAmount));
    setTextSummary("versatilCash", "Arqueo efectivo Versatil", fmtMoney(computed.versatilCashCountAmount));
    setTextSummary("expectedCash", "Esperado calculado (incluye fondo)", fmtMoney(computed.expectedCashAmount));
    setTextSummary("adjustments", "Ajustes que afectan efectivo", fmtSignedMoney(computed.totalCashAdjustmentsAmount));
    setTextSummary("transfers", "Transferencias identificadas", fmtSignedMoney(computed.identifiedTransfersAmount));
    setTextSummary(
      "difference",
      "Diferencia vs Versatil",
      cashDifferenceText(computed.differenceAmount),
      `cash-diff-${cashDifferenceKind(computed.differenceAmount)}`
    );

    return computed;
  }

  function renderProductRows() {
    productParticipationEls.length = 0;
    productAmountEls.length = 0;

    const header = h("div", { class: "cash-line-grid cash-line-grid-head muted mono" }, [
      h("div", { text: "Producto" }),
      h("div", { text: "Importe" }),
      h("div", { text: "Participación" }),
      h("div", { text: "Notas" }),
      h("div", { text: "" }),
    ]);

    const rows = draft.product_lines.map((row, index) => {
      const productLabelInput = createInput("text", row.product_label, { placeholder: "Producto" });
      const amountInput = createInput("number", row.amount, { min: "0", step: "0.01", inputmode: "decimal" });
      const participationValue = h("div", { class: "mono muted cash-inline-value", text: "0.0%" });
      const noteInput = createInput("text", row.note, { placeholder: "Notas" });
      const removeBtn = h(
        "button",
        {
          class: "btn btn-ghost",
          type: "button",
          onclick: () => {
            draft.product_lines.splice(index, 1);
            while (draft.product_lines.length < CASH_PRODUCT_LINE_MIN) draft.product_lines.push(defaultCashProductLine());
            scheduleSafeRender();
          },
        },
        ["Quitar"]
      );
      if (draft.product_lines.length <= CASH_PRODUCT_LINE_MIN) removeBtn.disabled = true;

      productLabelInput.addEventListener("input", () => {
        clearCashFlash();
        row.product_label = productLabelInput.value;
        queueCashDraftSave();
      });
      amountInput.addEventListener("input", () => {
        clearCashFlash();
        row.amount = amountInput.value;
        refreshComputed();
        queueCashDraftSave();
      });
      noteInput.addEventListener("input", () => {
        clearCashFlash();
        row.note = noteInput.value;
        queueCashDraftSave();
      });

      productParticipationEls[index] = participationValue;
      productAmountEls[index] = amountInput;

      return h("div", { class: "cash-line-grid" }, [
        productLabelInput,
        amountInput,
        h("div", { class: "cash-inline-box" }, [participationValue]),
        noteInput,
        removeBtn,
      ]);
    });

    const addBtn = h(
      "button",
      {
        class: "btn",
        type: "button",
        onclick: () => {
          draft.product_lines.push(defaultCashProductLine());
          scheduleSafeRender();
          queueCashDraftSave();
        },
      },
      ["Agregar producto"]
    );

    productRowsWrap.replaceChildren(
      h("div", { class: "muted", text: "Desglose opcional del ticket por producto. La participación se calcula sobre Total del ticket." }),
      header,
      ...rows,
      h("div", { class: "row-wrap" }, [addBtn])
    );
  }

  function renderDenominationSection(title, currency, rows, startIndexOffset) {
    const table = h("table", { class: "table" }, [
      h("thead", {}, [
        h("tr", {}, [h("th", { text: title }), h("th", { text: "Cantidad" }), h("th", { text: "Total" })]),
      ]),
      h(
        "tbody",
        {},
        rows.map((row, localIndex) => {
          const globalIndex = startIndexOffset + localIndex;
          const quantityInput = createInput("number", row.quantity, { min: "0", step: "1", inputmode: "numeric" });
          const totalValue = h("div", { class: "mono", text: fmtMoney(0, currency) });
          quantityInput.addEventListener("input", () => {
            clearCashFlash();
            draft.denomination_lines[globalIndex].quantity = quantityInput.value;
            refreshComputed();
            queueCashDraftSave();
          });
          denominationTotalEls[globalIndex] = totalValue;
          return h("tr", {}, [
            h("td", { class: "mono", text: currency === "USD" ? fmtMoney(row.denomination, "USD") : fmtMoney(row.denomination) }),
            h("td", {}, [quantityInput]),
            h("td", {}, [totalValue]),
          ]);
        })
      ),
    ]);
    return h("div", { class: "card col" }, [h("div", { class: "h1", text: title }), tableScroll(table)]);
  }

  function renderDenominations() {
    denominationTotalEls.length = 0;
    const mxnBills = draft.denomination_lines.filter((row) => row.currency === "MXN" && row.kind === "bill");
    const mxnCoins = draft.denomination_lines.filter((row) => row.currency === "MXN" && row.kind === "coin");
    const usdRows = draft.denomination_lines.filter((row) => row.currency === "USD");
    const mxnBillsOffset = 0;
    const mxnCoinsOffset = mxnBills.length;
    const usdOffset = mxnBills.length + mxnCoins.length;
    denominationWrap.replaceChildren(
      renderDenominationSection("Arqueo MXN - Billetes", "MXN", mxnBills, mxnBillsOffset),
      renderDenominationSection("Arqueo MXN - Monedas", "MXN", mxnCoins, mxnCoinsOffset),
      renderDenominationSection("Arqueo USD", "USD", usdRows, usdOffset)
    );
  }

  function renderVaultWithdrawalDenominationSection(title, currency, rows) {
    const table = h("table", { class: "table" }, [
      h("thead", {}, [
        h("tr", {}, [h("th", { text: title }), h("th", { text: "Cantidad" }), h("th", { text: "Total" })]),
      ]),
      h(
        "tbody",
        {},
        rows.map((row) => {
          const quantityInput = createInput("number", row.quantity, { min: "0", step: "1", inputmode: "numeric" });
          const totalValue = h("div", { class: "mono", text: fmtMoney(0, currency) });
          quantityInput.addEventListener("input", () => {
            clearCashFlash();
            row.quantity = quantityInput.value;
            totalValue.textContent = fmtMoney(roundMoneyValue(Number(row.denomination || 0) * Math.max(0, integerFromInput(row.quantity, 0))), currency);
            refreshComputed();
            queueCashDraftSave();
          });
          totalValue.textContent = fmtMoney(roundMoneyValue(Number(row.denomination || 0) * Math.max(0, integerFromInput(row.quantity, 0))), currency);
          return h("tr", {}, [
            h("td", { class: "mono", text: currency === "USD" ? fmtMoney(row.denomination, "USD") : fmtMoney(row.denomination) }),
            h("td", {}, [quantityInput]),
            h("td", {}, [totalValue]),
          ]);
        })
      ),
    ]);
    return h("div", { class: "card col" }, [h("div", { class: "h1", text: title }), tableScroll(table)]);
  }

  function renderVaultWithdrawals() {
    vaultWithdrawalTotalEls.length = 0;
    const rows = draft.vault_withdrawals.map((withdrawal, index) => {
      const referenceInput = createInput("text", withdrawal.reference_label, { placeholder: "Referencia / sobre (opcional)" });
      const noteInput = createInput("text", withdrawal.note, { placeholder: "Observación (opcional)" });
      const subtotalValue = h("div", { class: "cash-vault-total-value mono", text: fmtMoney(0) });
      const mxnBills = withdrawal.denomination_lines.filter((row) => row.currency === "MXN" && row.kind === "bill");
      const mxnCoins = withdrawal.denomination_lines.filter((row) => row.currency === "MXN" && row.kind === "coin");
      const usdRows = withdrawal.denomination_lines.filter((row) => row.currency === "USD");
      const removeBtn = h(
        "button",
        {
          class: "btn btn-ghost",
          type: "button",
          onclick: () => {
            draft.vault_withdrawals.splice(index, 1);
            if (draft.vault_withdrawals.length === 0) draft.vault_withdrawals.push(defaultCashVaultWithdrawal());
            renderVaultWithdrawals();
            refreshComputed();
            queueCashDraftSave();
          },
        },
        ["Quitar retiro"]
      );
      if (draft.vault_withdrawals.length <= 1) removeBtn.disabled = true;

      referenceInput.addEventListener("input", () => {
        clearCashFlash();
        withdrawal.reference_label = referenceInput.value;
        queueCashDraftSave();
      });
      noteInput.addEventListener("input", () => {
        clearCashFlash();
        withdrawal.note = noteInput.value;
        queueCashDraftSave();
      });

      vaultWithdrawalTotalEls[index] = subtotalValue;

      return h("div", { class: "card col" }, [
        h("div", { class: "row-wrap" }, [
          h("div", { class: "h1", text: `Retiro a bóveda ${index + 1}` }),
          h("div", { class: "spacer" }),
          removeBtn,
        ]),
        h("div", { class: "grid2" }, [cashField("Referencia / sobre", referenceInput), cashField("Observación", noteInput)]),
        h("div", { class: "cash-denomination-grid" }, [
          renderVaultWithdrawalDenominationSection("Bóveda MXN - Billetes", "MXN", mxnBills),
          renderVaultWithdrawalDenominationSection("Bóveda MXN - Monedas", "MXN", mxnCoins),
          renderVaultWithdrawalDenominationSection("Bóveda USD", "USD", usdRows),
        ]),
        h("div", { class: "cash-vault-total-row" }, [
          h("strong", { text: "Total retiro a bóveda" }),
          subtotalValue,
        ]),
      ]);
    });

    const addBtn = h(
      "button",
      {
        class: "btn",
        type: "button",
        onclick: () => {
          draft.vault_withdrawals.push(defaultCashVaultWithdrawal());
          renderVaultWithdrawals();
          refreshComputed();
          queueCashDraftSave();
        },
      },
      ["Agregar retiro a bóveda adicional"]
    );
    vaultWithdrawalsGrandTotalEl = h("div", { class: "cash-vault-grand-total-value mono", text: fmtMoney(0) });

    vaultWithdrawalsWrap.replaceChildren(
      h("div", { class: "muted", text: "Captura el efectivo retirado a bóveda. Este dinero sí cuenta como parte del corte entregado y se compara contra Versatil junto con el efectivo restante en caja." }),
      ...rows,
      h("div", { class: "row-wrap" }, [addBtn]),
      h("div", { class: "cash-vault-grand-total" }, [
        h("strong", { text: "Total retiros a bóveda" }),
        vaultWithdrawalsGrandTotalEl,
      ]),
    );
  }

  function renderAdjustments() {
    adjustmentAmountEls.length = 0;
    adjustmentDirectionEls.length = 0;
    adjustmentEffectEls.length = 0;

    const rows = CASH_ADJUSTMENT_ORDER.map((adjustmentType, index) => {
      const row = draft.adjustment_lines[index];
      const meta = CASH_ADJUSTMENT_META[adjustmentType];
      const isAmountReadOnly = !!meta?.syncFromRefunds || !!meta?.syncFromVaultWithdrawals;
      const fixedSign = meta?.fixedSign || "direction";
      const amountInput = isAmountReadOnly
        ? h("div", { class: "mono cash-static-value", text: fmtMoney(row.amount || 0) })
        : createInput("number", row.amount, {
            min: "0",
            step: "0.01",
            inputmode: "decimal",
            placeholder: "0.00",
          });
      const amountCell = isAmountReadOnly
        ? h("div", { class: "cash-inline-box cash-static-box" }, [amountInput])
        : amountInput;
      const directionInput = fixedSign === "direction"
        ? createSelect(
            [
              { value: "entrada", label: "Entrada" },
              { value: "salida", label: "Salida" },
            ],
            row.direction || meta?.defaultDirection || "entrada"
          )
        : h("div", {
            class: "mono cash-static-value",
            text:
              fixedSign === "negative"
                ? "Salida fija"
                : fixedSign === "positive"
                  ? "Entrada fija"
                  : "Dirección fija",
          });
      const directionCell = fixedSign === "direction"
        ? directionInput
        : h("div", { class: "cash-inline-box cash-static-box" }, [directionInput]);
      const supportInput = createInput("text", row.support_reference, { placeholder: "Soporte / referencia" });
      const noteInput = createInput("text", row.note, { placeholder: "Observación" });
      const effectValue = h("div", { class: "mono muted", text: meta?.affectsCash ? fmtMoney(0) : "No entra a efectivo" });

      if (!isAmountReadOnly) {
        amountInput.addEventListener("input", () => {
          clearCashFlash();
          row.amount = amountInput.value;
          refreshComputed();
          queueCashDraftSave();
        });
      }
      if (fixedSign === "direction") {
        directionInput.addEventListener("change", () => {
          clearCashFlash();
          row.direction = directionInput.value;
          refreshComputed();
          queueCashDraftSave();
        });
      }
      supportInput.addEventListener("input", () => {
        clearCashFlash();
        row.support_reference = supportInput.value;
        queueCashDraftSave();
      });
      noteInput.addEventListener("input", () => {
        clearCashFlash();
        row.note = noteInput.value;
        queueCashDraftSave();
      });

      adjustmentAmountEls[index] = amountInput;
      adjustmentDirectionEls[index] = directionInput;
      adjustmentEffectEls[index] = effectValue;

      return h("div", { class: "cash-adjustment-grid" }, [
        h("div", { class: `col${adjustmentType === "retiro_boveda" ? " cash-adjustment-priority" : ""}`, style: "gap: 4px" }, [
          h("div", { class: adjustmentType === "retiro_boveda" ? "cash-adjustment-priority-title" : null, style: adjustmentType === "retiro_boveda" ? null : "font-weight: 680", text: cashAdjustmentLabel(adjustmentType) }),
          h("div", {
            class: "muted",
            text:
              adjustmentType === "retiro_boveda"
                ? "Control informativo. El total viene del desglose de bóveda y sí entra al efectivo entregado."
                : adjustmentType === "transferencia_identificada"
                  ? "Se registra para control, pero no aumenta el efectivo esperado."
                  : adjustmentType === "reembolso_dia"
                    ? "Se toma automáticamente del POS y ya está descontado en Venta neta de contado."
                    : adjustmentType === "fondo_inicial"
                      ? "Entra al esperado calculado, pero no suma ni resta en la diferencia contra Versatil."
                      : "El sistema aplica el signo según el concepto o dirección.",
          }),
        ]),
        amountCell,
        directionCell,
        supportInput,
        noteInput,
        h("div", { class: "cash-inline-box" }, [effectValue]),
      ]);
    });

    adjustmentsWrap.replaceChildren(
      h("div", { class: "muted", text: "Captura solo el importe. El sistema calcula automáticamente el efecto en efectivo según el concepto." }),
      h("div", { class: "cash-adjustment-grid cash-adjustment-grid-head muted mono" }, [
        h("div", { text: "Concepto" }),
        h("div", { text: "Importe" }),
        h("div", { text: "Dirección" }),
        h("div", { text: "Soporte" }),
        h("div", { text: "Observación" }),
        h("div", { text: "Efecto" }),
      ]),
      ...rows
    );
  }

  function buildSummaryCard(key, label) {
    const labelEl = h("div", { class: "cash-summary-label", text: label });
    const valueEl = h("div", { class: "cash-summary-value mono", text: "--" });
    summaryRefs[key] = { label: labelEl, value: valueEl };
    return h("div", { class: "card cash-summary-card" }, [labelEl, valueEl]);
  }

  function renderListCards(rows) {
    if (!managerMode) return;
    if (!rows.length) {
      listWrap.replaceChildren(notice("warn", "Aún no hay cortes guardados para este filtro."));
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const row of rows) {
      const differenceKind = cashDifferenceKind(row.difference_amount);
      const card = h("div", {
        class: "card col movement-card no-print",
        role: "button",
        tabindex: "0",
        onclick: () => {
          void loadDetail(row.id);
        },
        onkeydown: (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          void loadDetail(row.id);
        },
      }, [
        h("div", { class: "row-wrap" }, [
          h("div", { class: "col", style: "gap: 4px" }, [
            h("div", { style: "font-weight: 760", text: cashCutShortId(row) }),
            h("div", {
              class: "muted",
              text: [
                row.business_date,
                row.cut_type || CASH_DEFAULT_CUT_TYPE,
                row.cashier_employee_id ? employeeName(row.cashier_employee_id) : "Sin cajero",
              ].join(" | "),
            }),
            h("div", {
              class: `mono ${differenceKind === "error" ? "delta-neg" : differenceKind === "warn" ? "cash-diff-warn" : "muted"}`,
              text: cashDifferenceText(row.difference_amount),
            }),
          ]),
          h("div", { class: "spacer" }),
          h(
            "button",
            {
              class: "btn btn-primary",
              type: "button",
              onclick: (event) => {
                event.preventDefault();
                event.stopPropagation();
                void loadDetail(row.id);
              },
            },
            ["Ver"]
          ),
        ]),
        h("div", {
          class: "muted",
          text: `Caja ${fmtMoney(row.total_counted_cash_amount)} | Bóveda ${fmtMoney(row.vault_withdrawals_total_amount)} | Entregado ${fmtMoney(cashComparableCountedAmount(row))} | Versatil ${fmtMoney(row.versatil_cash_count_amount)}`,
        }),
      ]);
      fragment.appendChild(card);
    }
    listWrap.replaceChildren(fragment);
  }

  function renderDetail(detail) {
    if (!managerMode || !detailCard) return;
    const { cut, productLines, denominationLines, adjustments } = detail;
    const bills = denominationLines.filter((row) => row.currency === "MXN" && row.kind === "bill");
    const coins = denominationLines.filter((row) => row.currency === "MXN" && row.kind === "coin");
    const usd = denominationLines.filter((row) => row.currency === "USD");
    const displayBills = bills.filter((row) => Number(row.quantity || 0) > 0);
    const displayCoins = coins.filter((row) => Number(row.quantity || 0) > 0);
    const displayUsd = usd.filter((row) => Number(row.quantity || 0) > 0);
    const visibleProductLines = productLines.filter((row) => row.product_label || Number(row.amount || 0) > 0 || row.note);
    const visibleAdjustments = adjustments.filter((row) => Number(row.amount || 0) > 0 || row.support_reference || row.note || row.adjustment_type === "fondo_inicial");
    const visibleVaultWithdrawals = (Array.isArray(cut.vault_withdrawals) ? cut.vault_withdrawals : [])
      .map((row, index) => ({
        index,
        reference_label: row?.reference_label || "",
        note: row?.note || "",
        denomination_lines: Array.isArray(row?.denomination_lines) ? row.denomination_lines : [],
        total_comparable_amount: Number(row?.total_comparable_amount || 0),
        total_mxn_amount: Number(row?.total_mxn_amount || 0),
        total_usd_amount: Number(row?.total_usd_amount || 0),
      }))
      .filter((row) => row.reference_label || row.note || row.total_comparable_amount > 0 || row.denomination_lines.some((entry) => Number(entry?.quantity || 0) > 0));
    const differenceTone = cashDifferenceKind(cut.difference_amount);
    const invoicedMismatchAmount = roundMoneyValue((Number(cut.credit_invoiced_sales_amount || 0) + Number(cut.cash_invoiced_sales_amount || 0)) - Number(cut.total_invoiced_sales_amount || 0));

    const generalTable = h("table", { class: "table" }, [
      h("tbody", {}, [
        h("tr", {}, [h("th", { text: "Sucursal" }), h("td", { text: cut.branch_name || "-" }), h("th", { text: "Tipo de corte" }), h("td", { text: cut.cut_type || CASH_DEFAULT_CUT_TYPE })]),
        h("tr", {}, [h("th", { text: "Folio corte" }), h("td", { text: cut.cut_folio || cashCutShortId(cut) }), h("th", { text: "Fecha del negocio" }), h("td", { text: cut.business_date || "-" })]),
        h("tr", {}, [h("th", { text: "Inicio" }), h("td", { text: formatOccurredAt(cut.started_at) }), h("th", { text: "Fin" }), h("td", { text: formatOccurredAt(cut.ended_at) })]),
        h("tr", {}, [h("th", { text: "Cajero sistema" }), h("td", { text: cut.cashier_system_name || "-" }), h("th", { text: "Empleado" }), h("td", { text: cut.cashier_employee_id ? employeeName(cut.cashier_employee_id) : "-" })]),
        h("tr", {}, [h("th", { text: "Clientes atendidos" }), h("td", { text: cut.customers_served != null ? String(cut.customers_served) : "-" }), h("th", { text: "Folios tickets" }), h("td", { text: `${cut.ticket_start_folio || "-"} -> ${cut.ticket_end_folio || "-"}` })]),
        h("tr", {}, [h("th", { text: "Entregado por" }), h("td", { text: cut.delivered_by || "-" }), h("th", { text: "Recibido por" }), h("td", { text: cut.received_by || "-" })]),
        h("tr", {}, [h("th", { text: "Observaciones" }), h("td", { colspan: "3", text: cut.observations || "-" })]),
      ]),
    ]);

    const posTable = h("table", { class: "table" }, [
      h("tbody", {}, [
        h("tr", {}, [h("th", { text: "Factura global / venta" }), h("td", { text: fmtMoney(cut.invoice_sale_amount) }), h("th", { text: "Suma de recibos contado" }), h("td", { text: fmtMoney(cut.cash_receipts_amount) })]),
        h("tr", {}, [h("th", { text: "Reembolso recibos" }), h("td", { text: fmtMoney(cut.refund_receipts_amount) }), h("th", { text: "Venta neta de contado" }), h("td", { text: fmtMoney(cut.net_cash_sales_amount) })]),
        h("tr", {}, [h("th", { text: "Ventas a crédito facturadas" }), h("td", { text: fmtMoney(cut.credit_invoiced_sales_amount) }), h("th", { text: "Ventas en efectivo facturadas" }), h("td", { text: fmtMoney(cut.cash_invoiced_sales_amount) })]),
        h("tr", {}, [h("th", { text: "Total de ventas facturadas" }), h("td", { text: fmtMoney(cut.total_invoiced_sales_amount) }), h("th", { text: "Impacto en arqueo" }), h("td", { text: "Informativo; no cambia la diferencia automática" })]),
        h("tr", {}, [h("th", { text: "Ventas moneda nacional" }), h("td", { text: fmtMoney(cut.sales_mxn_amount) }), h("th", { text: "Ventas dólar (USD)" }), h("td", { text: fmtMoney(cut.sales_usd_amount, "USD") })]),
        h("tr", {}, [h("th", { text: "Tipo de cambio" }), h("td", { text: Number(cut.exchange_rate || 0).toFixed(4) }), h("th", { text: "Ventas dólar en MXN" }), h("td", { text: fmtMoney(cut.sales_usd_mxn_amount) })]),
        h("tr", {}, [h("th", { text: "IVA 0%" }), h("td", { text: fmtMoney(cut.iva_zero_amount) }), h("th", { text: "Total del ticket" }), h("td", { text: fmtMoney(cut.ticket_total_amount) })]),
        h("tr", {}, [h("th", { text: "Arqueo efectivo Versatil" }), h("td", { text: fmtMoney(cut.versatil_cash_count_amount) }), h("th", { text: "Referencia de diferencia" }), h("td", { text: "Físico contado vs Versatil" })]),
      ]),
    ]);

    const posFacturadasWarning = Math.abs(invoicedMismatchAmount) >= 0.005
      ? h("div", { class: "cash-print-warning" }, [
          h("div", { class: "cash-print-warning-title", text: "Advertencia de control: ventas facturadas" }),
          h("div", { class: "cash-print-warning-body", text: `Crédito + efectivo = ${fmtMoney(Number(cut.credit_invoiced_sales_amount || 0) + Number(cut.cash_invoiced_sales_amount || 0))}, pero Total de ventas facturadas = ${fmtMoney(cut.total_invoiced_sales_amount)}.` }),
          h("div", { class: "cash-print-warning-note muted", text: "Revisa el dato antes de archivar o firmar este corte. No cambia automáticamente la diferencia vs Versatil." }),
        ])
      : null;

    const productTable = h("table", { class: "table" }, [
      h("thead", {}, [h("tr", {}, [h("th", { text: "Producto" }), h("th", { text: "Importe" }), h("th", { text: "Participación" }), h("th", { text: "Notas" })])]),
      h(
        "tbody",
        {},
        (visibleProductLines.length ? visibleProductLines : [{ product_label: "-", amount: 0, note: "", is_empty: true }]).map((row) =>
          h("tr", {}, [
            h("td", { text: row.product_label || "-" }),
            h("td", { class: "mono", text: row.is_empty ? "-" : fmtMoney(row.amount) }),
            h("td", {
              class: "mono",
              text:
                row.is_empty
                  ? "-"
                  : Number(cut.ticket_total_amount || 0) > 0
                    ? `${((Number(row.amount || 0) / Number(cut.ticket_total_amount || 0)) * 100).toFixed(1)}%`
                    : "0.0%",
            }),
            h("td", { text: row.note || "-" }),
          ])
        )
      ),
    ]);

    function denominationTable(rows, currencyLabel, fallbackCurrency = "MXN") {
      const displayRows = rows.length
        ? rows
        : [{ currency: fallbackCurrency, denomination: 0, quantity: 0, line_total: 0, is_empty: true }];
      return h("table", { class: "table" }, [
        h("thead", {}, [h("tr", {}, [h("th", { text: currencyLabel }), h("th", { text: "Cantidad" }), h("th", { text: "Total" })])]),
        h(
          "tbody",
          {},
          displayRows.map((row) =>
            h("tr", {}, [
              h("td", { class: "mono", text: row.is_empty ? "-" : row.currency === "USD" ? fmtMoney(row.denomination, "USD") : fmtMoney(row.denomination) }),
              h("td", { class: "mono", text: row.is_empty ? "-" : String(row.quantity || 0) }),
              h("td", { class: "mono", text: row.is_empty ? "-" : fmtMoney(row.line_total, row.currency) }),
            ])
          )
        ),
      ]);
    }

    const adjustmentsTable = h("table", { class: "table" }, [
      h("thead", {}, [h("tr", {}, [h("th", { text: "Concepto" }), h("th", { text: "Importe capturado" }), h("th", { text: "Efecto" }), h("th", { text: "Soporte" }), h("th", { text: "Observación" })])]),
      h(
        "tbody",
        {},
        (visibleAdjustments.length ? visibleAdjustments : [{ adjustment_type: "-", amount: 0, support_reference: "", note: "", is_empty: true }]).map((row) =>
          h("tr", {}, [
            h("td", { text: row.is_empty ? "-" : cashAdjustmentLabel(row.adjustment_type) }),
            h("td", { class: "mono", text: row.is_empty ? "-" : fmtMoney(row.amount) }),
            h("td", {
              class: row.is_empty ? "mono muted" : cashAdjustmentEffectClass(row),
              text: row.is_empty ? "-" : cashAdjustmentEffectText(row),
            }),
            h("td", { text: row.support_reference || "-" }),
            h("td", { text: row.note || "-" }),
          ])
        )
      ),
    ]);

    const summary = h("div", { class: "cash-report-summary" }, [
      h("div", { class: "cash-report-summary-row" }, [h("span", { text: "Efectivo contado en caja MXN" }), h("strong", { class: "mono", text: fmtMoney(Number(cut.total_mxn_bills_amount || 0) + Number(cut.total_mxn_coins_amount || 0)) })]),
      h("div", { class: "cash-report-summary-row" }, [h("span", { text: "USD contado (USD)" }), h("strong", { class: "mono", text: fmtMoney(cut.total_usd_amount, "USD") })]),
      h("div", { class: "cash-report-summary-row" }, [h("span", { text: "USD contado en MXN" }), h("strong", { class: "mono", text: fmtMoney(cut.total_usd_mxn_amount) })]),
      h("div", { class: "cash-report-summary-row" }, [h("span", { text: "Total físico contado en caja" }), h("strong", { class: "mono", text: fmtMoney(cut.total_counted_cash_amount) })]),
      h("div", { class: "cash-report-summary-row" }, [h("span", { text: "Fondo de caja inicial" }), h("strong", { class: "mono", text: fmtMoney(cut.initial_fund_amount) })]),
      h("div", { class: "cash-report-summary-row" }, [h("span", { text: "Retiros a bóveda" }), h("strong", { class: "mono", text: fmtMoney(cut.vault_withdrawals_total_amount) })]),
      h("div", { class: "cash-report-summary-row" }, [h("span", { text: "Total efectivo entregado" }), h("strong", { class: "mono", text: fmtMoney(cashComparableCountedAmount(cut)) })]),
      h("div", { class: "cash-report-summary-row" }, [h("span", { text: "Arqueo efectivo Versatil" }), h("strong", { class: "mono", text: fmtMoney(cut.versatil_cash_count_amount) })]),
      h("div", { class: "cash-report-summary-row" }, [h("span", { text: "Esperado calculado (incluye fondo)" }), h("strong", { class: "mono", text: fmtMoney(cut.expected_cash_amount) })]),
      h("div", { class: "cash-report-summary-row" }, [h("span", { text: "Ajustes / otros movimientos" }), h("strong", { class: "mono", text: fmtSignedMoney(cut.total_cash_adjustments_amount) })]),
      h("div", { class: "cash-report-summary-row" }, [h("span", { text: "Transferencias identificadas" }), h("strong", { class: "mono", text: fmtSignedMoney(cut.identified_transfers_amount) })]),
      h("div", { class: `cash-report-summary-row cash-report-diff cash-diff-${differenceTone}` }, [h("span", { text: "Diferencia (sobrante/faltante vs Versatil)" }), h("strong", { class: "mono", text: cashDifferenceText(cut.difference_amount) })]),
    ]);

    const vaultWithdrawalCards = visibleVaultWithdrawals.length
      ? h("div", { class: "cash-print-grid cash-print-grid-2" }, visibleVaultWithdrawals.map((row) => {
          const billsRows = row.denomination_lines.filter((entry) => entry.currency === "MXN" && entry.kind === "bill" && Number(entry.quantity || 0) > 0);
          const coinRows = row.denomination_lines.filter((entry) => entry.currency === "MXN" && entry.kind === "coin" && Number(entry.quantity || 0) > 0);
          const usdRows = row.denomination_lines.filter((entry) => entry.currency === "USD" && Number(entry.quantity || 0) > 0);
          return h("div", { class: "card col" }, [
            h("div", { class: "h1", text: row.reference_label || `Retiro a bóveda ${row.index + 1}` }),
            row.note ? h("div", { class: "muted", text: row.note }) : null,
            h("div", { class: "cash-print-grid cash-print-grid-3" }, [
              h("div", { class: "col" }, [h("div", { class: "muted", text: "MXN - Billetes" }), tableScroll(denominationTable(billsRows, "Billete", "MXN"))]),
              h("div", { class: "col" }, [h("div", { class: "muted", text: "MXN - Monedas" }), tableScroll(denominationTable(coinRows, "Moneda", "MXN"))]),
              h("div", { class: "col" }, [h("div", { class: "muted", text: "USD" }), tableScroll(denominationTable(usdRows, "Denominación", "USD"))]),
            ]),
            h("div", { class: "cash-report-summary-row" }, [h("span", { text: "Total retiro a bóveda" }), h("strong", { class: "mono", text: fmtMoney(row.total_comparable_amount) })]),
          ].filter(Boolean));
        }))
      : null;

    detailTitle.textContent = `Reporte imprimible | ${cashCutShortId(cut)}`;
    const productCard = visibleProductLines.length
      ? h("div", { class: "card col" }, [h("div", { class: "h1", text: "Desglose de venta por producto" }), tableScroll(productTable)])
      : null;
    detailMsg.replaceChildren(
      h("div", { class: "cash-printable" }, [
        h("div", { class: "cash-print-header" }, [
          h("div", { class: "h1", text: "REPORTE DE CORTE DE CAJA Y ARQUEO DE EFECTIVO" }),
          h("div", { class: "muted", text: `${APP_NAME} | ${cashCutShortId(cut)} | Generado ${new Date().toLocaleString()}` }),
        ]),
        h("div", { class: "cash-print-grid cash-print-grid-2" }, [
          h("div", { class: "card col" }, [h("div", { class: "h1", text: "Datos generales del corte" }), tableScroll(generalTable)]),
          h("div", { class: "card col" }, [h("div", { class: "h1", text: "Conciliación automática vs Versatil" }), summary]),
        ]),
        h("div", { class: "cash-print-grid cash-print-grid-2" }, [
          h("div", { class: "card col" }, [h("div", { class: "h1", text: "Datos del ticket POS" }), tableScroll(posTable), posFacturadasWarning].filter(Boolean)),
          h("div", { class: "card col" }, [h("div", { class: "h1", text: "Controles adicionales del cajero" }), tableScroll(adjustmentsTable)]),
        ]),
        vaultWithdrawalCards
          ? h("div", { class: "col" }, [
              h("div", { class: "h1", text: "Retiros a bóveda" }),
              vaultWithdrawalCards,
            ])
          : null,
        h("div", { class: "cash-print-grid cash-print-grid-3" }, [
          h("div", { class: "card col" }, [h("div", { class: "h1", text: "Arqueo MXN - Billetes" }), tableScroll(denominationTable(displayBills, "Billete", "MXN"))]),
          h("div", { class: "card col" }, [h("div", { class: "h1", text: "Arqueo MXN - Monedas" }), tableScroll(denominationTable(displayCoins, "Moneda", "MXN"))]),
          h("div", { class: "card col" }, [h("div", { class: "h1", text: "Arqueo USD" }), tableScroll(denominationTable(displayUsd, "Denominación", "USD"))]),
        ]),
        productCard,
        h("div", { class: "cash-signatures" }, [
          h("div", { class: "cash-signature-line" }, [h("span", { text: "Entregado por" }), h("strong", { text: cut.delivered_by || "-" })]),
          h("div", { class: "cash-signature-line" }, [h("span", { text: "Recibido por" }), h("strong", { text: cut.received_by || "-" })]),
        ]),
      ].filter(Boolean))
    );
  }

  async function loadList() {
    if (!managerMode || loadingList || !isActive()) return;
    loadingList = true;
    listMsg.replaceChildren(notice("warn", "Cargando cortes..."));
    try {
      let query = supabase
        .from("cash_cuts")
        .select("id,business_date,daily_sequence,cut_type,cashier_employee_id,total_counted_cash_amount,vault_withdrawals_total_amount,delivered_cash_amount,initial_fund_amount,versatil_cash_count_amount,expected_cash_amount,difference_amount,identified_transfers_amount,status,created_at")
        .order("business_date", { ascending: false })
        .order("daily_sequence", { ascending: false })
        .limit(CASH_LIST_PAGE_SIZE);

      const businessDate = trimmedOrEmpty(state.cashFilters.business_date);
      const cashierEmployeeId = trimmedOrEmpty(state.cashFilters.cashier_employee_id);
      if (businessDate) query = query.eq("business_date", businessDate);
      if (cashierEmployeeId) query = query.eq("cashier_employee_id", cashierEmployeeId);

      const { data, error } = await query;
      if (!isActive()) return;
      if (error) {
        listMsg.replaceChildren(notice("error", error.message));
        return;
      }
      listRows = data || [];
      listMsg.replaceChildren();
      renderListCards(listRows);
    } finally {
      loadingList = false;
    }
  }

  async function loadDetail(cashCutId) {
    if (!managerMode || loadingDetail || !cashCutId || !isActive()) return;
    loadingDetail = true;
    detailTitle.textContent = "Reporte imprimible";
    detailMsg.replaceChildren(notice("warn", "Cargando reporte..."));
    state.cashSelectedId = cashCutId;
    try {
      const [
        { data: cut, error: cutError },
        { data: productLines, error: productError },
        { data: denominationLines, error: denominationError },
        { data: adjustmentLines, error: adjustmentError },
      ] = await Promise.all([
        supabase.from("cash_cuts").select("*").eq("id", cashCutId).single(),
        supabase.from("cash_cut_product_lines").select("*").eq("cash_cut_id", cashCutId).order("sort_order"),
        supabase.from("cash_cut_denominations").select("*").eq("cash_cut_id", cashCutId).order("sort_order"),
        supabase.from("cash_cut_adjustments").select("*").eq("cash_cut_id", cashCutId).order("sort_order"),
      ]);
      if (!isActive()) return;
      if (cutError) throw cutError;
      if (productError) throw productError;
      if (denominationError) throw denominationError;
      if (adjustmentError) throw adjustmentError;

      renderDetail({
        cut,
        productLines: productLines || [],
        denominationLines: denominationLines || [],
        adjustments: adjustmentLines || [],
      });
    } catch (error) {
      if (!isActive()) return;
      detailMsg.replaceChildren(notice("error", error?.message ? String(error.message) : "No se pudo cargar el reporte."));
    } finally {
      loadingDetail = false;
    }
  }

  function missingCashNumber(value) {
    return String(value ?? "").trim() === "";
  }

  async function submitCashCut() {
    if (state.cashSubmitting || !isActive()) return;
    clearCashFlash();
    const startedAtIso = isoFromLocalInput(draft.started_at);
    const endedAtIso = isoFromLocalInput(draft.ended_at);
    if (!trimmedOrEmpty(draft.business_date)) {
      showCashFormNotice("error", "Selecciona la fecha del día que estás cerrando.");
      return;
    }
    if (!startedAtIso || !endedAtIso) {
      showCashFormNotice("error", "Captura inicio y fin del corte.");
      return;
    }
    if (!employeeMode && !trimmedOrEmpty(draft.cashier_employee_id)) {
      showCashFormNotice("error", "Selecciona el empleado/cajero del corte.");
      return;
    }
    if (missingCashNumber(draft.ticket_total_amount)) {
      showCashFormNotice("error", "Captura Total del ticket.");
      return;
    }
    if (missingCashNumber(draft.versatil_cash_count_amount)) {
      showCashFormNotice("error", "Captura Arqueo de efectivo en comprobante Versatil.");
      return;
    }
    if (missingCashNumber(draft.invoice_sale_amount)) {
      showCashFormNotice("error", "Captura Factura global / venta.");
      return;
    }
    if (missingCashNumber(draft.credit_invoiced_sales_amount)) {
      showCashFormNotice("error", "Captura Ventas a crédito facturadas. Si no hubo, escribe 0.");
      return;
    }
    if (missingCashNumber(draft.cash_invoiced_sales_amount)) {
      showCashFormNotice("error", "Captura Ventas en efectivo facturadas. Si no hubo, escribe 0.");
      return;
    }
    if (!trimmedOrEmpty(draft.ticket_start_folio)) {
      showCashFormNotice("error", "Captura Folio inicio tickets.");
      return;
    }
    if (!trimmedOrEmpty(draft.ticket_end_folio)) {
      showCashFormNotice("error", "Captura Folio fin tickets.");
      return;
    }
    if (!trimmedOrEmpty(draft.delivered_by)) {
      showCashFormNotice("error", "Captura Entregado por.");
      return;
    }

    const computed = refreshComputed();
    state.cashSubmitting = true;
    showCashFormNotice("warn", "Guardando Corte Z...");
    try {
      const productLines = computed.productLines
        .filter((row) => row.product_label || row.amount > 0 || row.note)
        .map((row) => ({
          product_label: row.product_label,
          amount: row.amount,
          note: row.note || null,
        }));
      const denominationLines = computed.denominationLines.map((row) => ({
        currency: row.currency,
        kind: row.kind,
        denomination: row.denomination,
        quantity: row.quantity,
      }));
      const adjustmentLines = computed.adjustments.map((row) => ({
        adjustment_type: row.adjustment_type,
        direction: row.fixed_sign === "direction" ? row.direction : null,
        amount: row.amount,
        support_reference: row.support_reference || null,
        note: row.note || null,
      }));
      const vaultWithdrawals = computed.visibleVaultWithdrawals.map((row) => ({
        reference_label: row.reference_label || null,
        note: row.note || null,
        denomination_lines: row.denomination_lines.map((entry) => ({
          currency: entry.currency,
          kind: entry.kind,
          denomination: entry.denomination,
          quantity: entry.quantity,
        })),
      }));
      const cutPayload = {
        business_date: draft.business_date,
        branch_name: trimmedOrEmpty(draft.branch_name) || CASH_DEFAULT_BRANCH,
        cut_type: trimmedOrEmpty(draft.cut_type) || CASH_DEFAULT_CUT_TYPE,
        cut_folio: trimmedOrEmpty(draft.cut_folio) || null,
        started_at: startedAtIso,
        ended_at: endedAtIso,
        cashier_employee_id: trimmedOrEmpty(draft.cashier_employee_id) || null,
        cashier_system_name: trimmedOrEmpty(draft.cashier_system_name) || null,
        customers_served: trimmedOrEmpty(draft.customers_served) ? integerFromInput(draft.customers_served, 0) : null,
        ticket_start_folio: trimmedOrEmpty(draft.ticket_start_folio) || null,
        ticket_end_folio: trimmedOrEmpty(draft.ticket_end_folio) || null,
        delivered_by: trimmedOrEmpty(draft.delivered_by) || null,
        received_by: trimmedOrEmpty(draft.received_by) || null,
        observations: trimmedOrEmpty(draft.observations) || null,
        invoice_sale_amount: computed.invoiceSaleAmount,
        cash_receipts_amount: computed.cashReceiptsAmount,
        refund_receipts_amount: computed.refundReceiptsAmount,
        net_cash_sales_amount: computed.netCashSalesAmount,
        credit_invoiced_sales_amount: computed.creditInvoicedSalesAmount,
        cash_invoiced_sales_amount: computed.cashInvoicedSalesAmount,
        total_invoiced_sales_amount: computed.totalInvoicedSalesAmount,
        sales_mxn_amount: computed.salesMxnAmount,
        sales_usd_amount: computed.salesUsdAmount,
        exchange_rate: computed.exchangeRate,
        iva_zero_amount: computed.ivaZeroAmount,
        ticket_total_amount: computed.ticketTotalAmount,
        versatil_cash_count_amount: computed.versatilCashCountAmount,
        vault_withdrawals: vaultWithdrawals,
      };

      const { data, error } = await supabase.rpc("create_cash_cut", {
        cut: cutPayload,
        product_lines: productLines,
        denomination_lines: denominationLines,
        adjustment_lines: adjustmentLines,
      });
      if (error) throw error;

      const created = data && typeof data === "object" ? data : {};
      const cutRef = cashCutShortId(created.business_date || draft.business_date, created.daily_sequence);
      state.cashFlashNotice = {
        kind: "ok",
        text: `Guardado: ${cutRef} | ${cashDifferenceText(computed.differenceAmount)}`,
      };
      clearCashDraftStorage();
      resetCashDraft();
      if (managerMode && created.id) {
        state.cashSelectedId = created.id;
      }
      scheduleSafeRender();
    } catch (error) {
      showCashFormNotice("error", normalizeCashCutError(error?.message || error));
    } finally {
      state.cashSubmitting = false;
    }
  }

  function bindDraftInput(input, key, { refresh = false } = {}) {
    input.addEventListener("input", () => {
      clearCashFlash();
      draft[key] = input.value;
      if (refresh) refreshComputed();
      queueCashDraftSave();
    });
  }

  bindDraftInput(businessDateInput, "business_date");
  bindDraftInput(branchNameInput, "branch_name");
  bindDraftInput(cutTypeInput, "cut_type");
  bindDraftInput(cutFolioInput, "cut_folio");
  bindDraftInput(startedAtInput, "started_at");
  bindDraftInput(endedAtInput, "ended_at");
  bindDraftInput(cashierSystemInput, "cashier_system_name");
  bindDraftInput(customersServedInput, "customers_served");
  bindDraftInput(ticketStartFolioInput, "ticket_start_folio");
  bindDraftInput(ticketEndFolioInput, "ticket_end_folio");
  bindDraftInput(deliveredByInput, "delivered_by");
  bindDraftInput(receivedByInput, "received_by");
  observationsInput.addEventListener("input", () => {
    clearCashFlash();
    draft.observations = observationsInput.value;
    queueCashDraftSave();
  });

  invoiceSaleInput.addEventListener("input", () => {
    clearCashFlash();
    draft.invoice_sale_amount = invoiceSaleInput.value;
    queueCashDraftSave();
  });
  cashReceiptsInput.addEventListener("input", () => {
    clearCashFlash();
    draft.cash_receipts_amount = cashReceiptsInput.value;
    refreshComputed();
    queueCashDraftSave();
  });
  refundReceiptsInput.addEventListener("input", () => {
    clearCashFlash();
    draft.refund_receipts_amount = refundReceiptsInput.value;
    refreshComputed();
    queueCashDraftSave();
  });
  creditInvoicedSalesInput.addEventListener("input", () => {
    clearCashFlash();
    draft.credit_invoiced_sales_amount = creditInvoicedSalesInput.value;
    refreshComputed();
    queueCashDraftSave();
  });
  cashInvoicedSalesInput.addEventListener("input", () => {
    clearCashFlash();
    draft.cash_invoiced_sales_amount = cashInvoicedSalesInput.value;
    refreshComputed();
    queueCashDraftSave();
  });
  salesMxnInput.addEventListener("input", () => {
    clearCashFlash();
    draft.sales_mxn_amount = salesMxnInput.value;
    queueCashDraftSave();
  });
  salesUsdInput.addEventListener("input", () => {
    clearCashFlash();
    draft.sales_usd_amount = salesUsdInput.value;
    refreshComputed();
    queueCashDraftSave();
  });
  exchangeRateInput.addEventListener("input", () => {
    clearCashFlash();
    draft.exchange_rate = exchangeRateInput.value;
    refreshComputed();
    queueCashDraftSave();
  });
  ivaZeroInput.addEventListener("input", () => {
    clearCashFlash();
    draft.iva_zero_amount = ivaZeroInput.value;
    queueCashDraftSave();
  });
  ticketTotalInput.addEventListener("input", () => {
    clearCashFlash();
    draft.ticket_total_amount = ticketTotalInput.value;
    refreshComputed();
    queueCashDraftSave();
  });
  versatilCashCountInput.addEventListener("input", () => {
    clearCashFlash();
    draft.versatil_cash_count_amount = versatilCashCountInput.value;
    refreshComputed();
    queueCashDraftSave();
  });
  if (!employeeMode && cashierInput instanceof HTMLSelectElement) {
    cashierInput.addEventListener("change", () => {
      clearCashFlash();
      draft.cashier_employee_id = cashierInput.value;
      queueCashDraftSave();
    });
  }

  listBusinessDateInput.addEventListener("input", () => {
    state.cashFilters.business_date = listBusinessDateInput.value;
  });
  listCashierInput.addEventListener("change", () => {
    state.cashFilters.cashier_employee_id = listCashierInput.value;
  });

  const submitBtn = h(
    "button",
    {
      class: "btn btn-primary",
      type: "button",
      onclick: () => {
        void submitCashCut();
      },
    },
    ["Guardar Corte Z"]
  );

  const resetBtn = h(
    "button",
    {
      class: "btn btn-ghost",
      type: "button",
      onclick: () => {
        clearCashDraftStorage();
        resetCashDraft();
        state.cashFlashNotice = null;
        scheduleSafeRender();
      },
    },
    ["Limpiar formulario"]
  );

  const discardCashDraftBtn = h(
    "button",
    {
      class: "btn btn-ghost",
      type: "button",
      onclick: () => {
        clearCashDraftStorage();
        resetCashDraft();
        state.cashFlashNotice = null;
        scheduleSafeRender();
      },
    },
    ["Descartar borrador"]
  );

  const formCard = h("div", { class: "card col no-print cash-form-card" }, [
    h("div", { class: "row-wrap" }, [
      h("div", { class: "h1", text: "Corte Z" }),
      h("div", { class: "spacer" }),
      h(
        "button",
        {
          class: "btn",
          type: "button",
          onclick: () => openCashGuideModal(),
        },
        ["Guía rápida"]
      ),
    ]),
    h("div", { class: "muted cash-form-intro", text: employeeMode ? "Captura el cierre del día y envíalo una sola vez." : "Puedes capturar, revisar e imprimir cierres de caja desde aquí." }),
    h("div", { class: "row-wrap cash-draft-bar" }, [
      h("div", {
        class: "muted cash-draft-status",
        text:
          cashDraftStatus.state === "saving"
            ? "Borrador guardándose..."
            : cashDraftStatus.restored
              ? "Borrador restaurado y guardado localmente."
              : "Borrador local activo.",
      }),
      h("div", { class: "spacer" }),
      discardCashDraftBtn,
    ]),
    formMsg,
    h("div", { class: "cash-priority-block" }, [
      h("div", { class: "cash-priority-copy" }, [
        h("div", { class: "cash-priority-title", text: "Datos clave" }),
        h("div", { class: "muted cash-priority-note", text: "Captura primero el Total del ticket y el Arqueo de efectivo en comprobante Versatil para que el cierre y la diferencia sean fáciles de revisar." }),
      ]),
      h("div", { class: "cash-priority-grid" }, [
        cashField(requiredLabel("Total del ticket"), ticketTotalInput, "cash-priority-field"),
        cashField(requiredLabel("Arqueo de efectivo en comprobante Versatil"), versatilCashCountInput, "cash-priority-field cash-priority-accent"),
      ]),
    ]),
    h("div", { class: "divider" }),
    h("div", { class: "h1", text: "Datos generales del corte" }),
    h("div", { class: "grid3" }, [cashField(requiredLabel("Fecha del negocio"), businessDateInput), cashField("Sucursal", branchNameInput), cashField("Tipo de corte", cutTypeInput)]),
    h("div", { class: "grid3" }, [cashField("Folio corte", cutFolioInput), cashField(requiredLabel("Inicio corte"), startedAtInput), cashField(requiredLabel("Fin corte"), endedAtInput)]),
    h("div", { class: "grid3" }, [employeeMode ? cashField(requiredLabel("Empleado"), cashierInput) : cashField(requiredLabel("Empleado / Cajero"), cashierInput), cashField("Cajero sistema", cashierSystemInput), cashField("Clientes atendidos", customersServedInput)]),
    h("div", { class: "grid3" }, [cashField(requiredLabel("Folio inicio tickets"), ticketStartFolioInput), cashField(requiredLabel("Folio fin tickets"), ticketEndFolioInput), cashField(requiredLabel("Entregado por"), deliveredByInput)]),
    h("div", { class: "grid2" }, [cashField("Recibido por", receivedByInput), cashField("Observaciones", observationsInput)]),
    h("div", { class: "divider" }),
    h("div", { class: "h1", text: "Datos del ticket POS" }),
    h("div", { class: "muted cash-section-note", text: "Los dos importes más importantes ya están arriba para que resalten desde el inicio." }),
    h("div", { class: "muted cash-section-note", text: "Factura global / venta, ventas facturadas y folios de tickets ya no son opcionales. Si un importe no aplica ese día, captura 0." }),
    h("div", { class: "muted cash-section-note", text: "El total de ventas facturadas se calcula automáticamente. Es informativo y no cambia automáticamente el arqueo; la diferencia sigue comparándose contra Versatil." }),
    posWarningWrap,
    h("div", { class: "grid3" }, [cashField(requiredLabel("Factura global / venta"), invoiceSaleInput), cashField("Suma de recibos contado", cashReceiptsInput), cashField("Reembolso recibos", refundReceiptsInput)]),
    h("div", { class: "grid3" }, [cashField(requiredLabel("Ventas a crédito facturadas"), creditInvoicedSalesInput), cashField(requiredLabel("Ventas en efectivo facturadas"), cashInvoicedSalesInput), cashField(automaticLabel("Total de ventas facturadas"), totalInvoicedSalesInput)]),
    h("div", { class: "grid3" }, [cashField(automaticLabel("Venta neta de contado"), netCashSalesInput), cashField("Ventas moneda nacional", salesMxnInput), cashField("Ventas dólar (USD)", salesUsdInput)]),
    h("div", { class: "grid3" }, [cashField("Tipo de cambio", exchangeRateInput), cashField(automaticLabel("Ventas dólar en MXN"), salesUsdMxnInput), cashField("IVA 0%", ivaZeroInput)]),
    h("div", { class: "divider" }),
    h("div", { class: "row-wrap" }, [h("div", { class: "h1", text: "Desglose de venta por producto" }), h("span", { class: "optional-mark", text: "(Opcional)" })]),
    productRowsWrap,
    h("div", { class: "divider" }),
    h("div", { class: "h1", text: "Arqueo físico" }),
    denominationWrap,
    h("div", { class: "divider" }),
    h("div", { class: "h1", text: "Retiros a bóveda" }),
    vaultWithdrawalsWrap,
    h("div", { class: "divider" }),
    h("div", { class: "h1", text: "Controles adicionales del cajero" }),
    adjustmentsWrap,
    h("div", { class: "divider" }),
    h("div", { class: "h1", text: "Conciliación automática" }),
    summaryWrap,
    h("div", { class: "row-wrap" }, [submitBtn, resetBtn]),
  ]);

  const managerListCard = managerMode
    ? h("div", { class: "card col no-print" }, [
        h("div", { class: "row-wrap" }, [
          h("div", { class: "h1", text: "Cortes guardados" }),
          h("div", { class: "spacer" }),
          h(
            "button",
            {
              class: "btn",
              type: "button",
              onclick: () => {
                void loadList();
              },
            },
            ["Actualizar"]
          ),
        ]),
        h("div", { class: "grid2" }, [field("Filtrar por fecha", listBusinessDateInput), field("Filtrar por empleado", listCashierInput)]),
        listMsg,
        listWrap,
      ])
    : null;

  const pageChildren = [formCard];
  if (managerListCard) pageChildren.push(managerListCard);
  if (detailCard) {
    detailMsg.replaceChildren(notice("warn", "Elige un corte para revisar o imprimir."));
    pageChildren.push(detailCard);
  }

  const page = h("div", { class: "col" }, pageChildren);

  renderProductRows();
  renderDenominations();
  renderAdjustments();
  renderVaultWithdrawals();
  summaryWrap.replaceChildren(
    buildSummaryCard("countedMxn", "Efectivo contado MXN"),
    buildSummaryCard("countedUsd", "USD contado"),
    buildSummaryCard("countedUsdMxn", "USD contado en MXN"),
    buildSummaryCard("physicalTotal", "Total físico contado"),
    buildSummaryCard("initialFund", "Fondo de caja inicial"),
    buildSummaryCard("vaultWithdrawals", "Retiros a bóveda"),
    buildSummaryCard("comparablePhysical", "Físico para comparación"),
    buildSummaryCard("versatilCash", "Arqueo efectivo Versatil"),
    buildSummaryCard("expectedCash", "Esperado calculado (incluye fondo)"),
    buildSummaryCard("adjustments", "Ajustes que afectan efectivo"),
    buildSummaryCard("transfers", "Transferencias identificadas"),
    buildSummaryCard("difference", "Diferencia vs Versatil")
  );
  showStoredCashNotice();
  if (formMsg.childElementCount === 0 && restoredCashDraftNotice) {
    formMsg.appendChild(notice("ok", "Se restauró tu borrador anterior del Corte Z."));
  }
  refreshComputed();
  layout(ROUTE_TITLES.cash, page);

  if (managerMode) {
    await loadList();
    if (state.cashSelectedId) {
      await loadDetail(state.cashSelectedId);
    }
  }
}

async function pageSettings(pageCtx) {
  const isActive = () => isPageContextActive(pageCtx);
  const msg = h("div");

  const productsWrap = h("div", { class: "col" });
  const qualitiesWrap = h("div", { class: "col" });
  const employeesWrap = h("div", { class: "col" });
  const skusWrap = h("div", { class: "col" });
  const employeeAccessWrap = h("div", { class: "col" });
  const employeeAccessMsg = h("div");
  const saleRulesWrap = h("div", { class: "col" });
  const saleRulesMsg = h("div");
  const traspasoRulesWrap = h("div", { class: "col" });
  const traspasoRulesMsg = h("div");
  let workspaceUsers = [];
  let workspaceSaleRules = [];
  let workspaceTraspasoRules = [];

  function workspaceId() {
    return String(state.actor?.workspace_id || "").trim();
  }

  function isUuidLike(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "").trim());
  }

  function parseOptionalNonNegativeNumber(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return NaN;
    return Number(n.toFixed(3));
  }

  function employeeOptionNodes({ includeEmpty = true, emptyLabel = "(Sin empleado)" } = {}) {
    const items = [...state.employees]
      .sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .map((e) =>
        h("option", {
          value: e.id,
          text: `${String(e.name)}${e.is_active ? "" : " (inactivo)"}`,
        })
      );
    return includeEmpty ? [h("option", { value: "", text: emptyLabel }), ...items] : items;
  }

  function skuOptionNodes({ includeEmpty = true, emptyLabel = "Elige SKU..." } = {}) {
    const items = [...state.skus]
      .sort((a, b) => Number(a.code || 0) - Number(b.code || 0))
      .map((s) =>
        h("option", {
          value: s.id,
          text: `${Number.isFinite(Number(s.code)) ? String(s.code) : ""} ${String(s.name || "")}${s.is_active ? "" : " (inactivo)"}`.trim(),
        })
      );
    return includeEmpty ? [h("option", { value: "", text: emptyLabel }), ...items] : items;
  }

  function makeEmployeeSelect(selectedValue = "") {
    const sel = h("select", {}, employeeOptionNodes());
    sel.value = String(selectedValue || "");
    return sel;
  }

  function makeSkuSelect(emptyLabel, selectedValue = "") {
    const sel = h("select", {}, skuOptionNodes({ includeEmpty: true, emptyLabel }));
    sel.value = String(selectedValue || "");
    return sel;
  }

  function saleSkuOptionNodes({ includeEmpty = true, emptyLabel = "SKU de venta..." } = {}) {
    const items = [...state.skus]
      .filter((s) => !!s.is_active)
      .sort((a, b) => Number(a.code || 0) - Number(b.code || 0))
      .map((s) =>
        h("option", {
          value: s.id,
          text: `${Number.isFinite(Number(s.code)) ? String(s.code) : ""} ${String(s.name || "")}${s.is_active ? "" : " (inactivo)"}`.trim(),
        })
      );
    return includeEmpty ? [h("option", { value: "", text: emptyLabel }), ...items] : items;
  }

  function makeSaleSkuSelect(emptyLabel = "SKU de venta...", selectedValue = "") {
    const sel = h("select", {}, saleSkuOptionNodes({ includeEmpty: true, emptyLabel }));
    sel.value = String(selectedValue || "");
    return sel;
  }

  function syncWorkspaceUserInputs(roleSel, employeeSel, mermaInput, allowAllSaleChk, allowAllTraspasoChk) {
    const isEmployeeRole = String(roleSel.value || "employee") === "employee";
    employeeSel.disabled = !isEmployeeRole;
    mermaInput.disabled = !isEmployeeRole;
    allowAllSaleChk.disabled = !isEmployeeRole;
    allowAllTraspasoChk.disabled = !isEmployeeRole;
    if (!isEmployeeRole) {
      employeeSel.value = "";
      mermaInput.value = "";
      allowAllSaleChk.checked = true;
      allowAllTraspasoChk.checked = true;
    }
  }

  function sortWorkspaceUsers(list) {
    return [...(list || [])].sort((a, b) => {
      const roleRank = String(a.role || "") === String(b.role || "") ? 0 : String(a.role || "") === "manager" ? -1 : 1;
      if (roleRank !== 0) return roleRank;
      const nameA = String(a.display_name || employeeName(a.employee_id) || a.user_id || "");
      const nameB = String(b.display_name || employeeName(b.employee_id) || b.user_id || "");
      return nameA.localeCompare(nameB) || String(a.user_id || "").localeCompare(String(b.user_id || ""));
    });
  }

  function sortTraspasoRules(list) {
    return [...(list || [])].sort((a, b) => {
      const left = `${skuLabel(a.from_sku_id)} ${skuLabel(a.to_sku_id)}`;
      const right = `${skuLabel(b.from_sku_id)} ${skuLabel(b.to_sku_id)}`;
      return left.localeCompare(right);
    });
  }

  function sortSaleRules(list) {
    return [...(list || [])].sort((a, b) => skuLabel(a.sku_id).localeCompare(skuLabel(b.sku_id)));
  }

  function renderWorkspaceUsers() {
    if (!workspaceId()) {
      employeeAccessWrap.replaceChildren(notice("warn", "No se encontró workspace activo para este usuario."));
      return;
    }

    const rows = sortWorkspaceUsers(workspaceUsers);
    if (rows.length === 0) {
      employeeAccessWrap.replaceChildren(notice("warn", "Todavía no hay accesos configurados."));
      return;
    }

    employeeAccessWrap.replaceChildren(
      ...rows.map((row) => {
        const isCurrentUser = String(row.user_id || "") === String(state.session?.user?.id || "");
        const displayNameInput = h("input", {
          type: "text",
          value: String(row.display_name || ""),
          placeholder: "Nombre visible",
        });
        const roleSel = h("select", {}, [
          h("option", { value: "manager", text: "Manager" }),
          h("option", { value: "employee", text: "Empleado" }),
        ]);
        roleSel.value = String(row.role || "employee");

        const employeeSel = makeEmployeeSelect(row.employee_id || "");
        const mermaLimitInput = h("input", {
          type: "number",
          step: "0.001",
          min: "0",
          value: row.merma_limit_kg != null ? String(Number(row.merma_limit_kg)) : "",
          placeholder: "Sin límite",
        });
        const allowAllSaleChk = h("input", { type: "checkbox" });
        allowAllSaleChk.checked = row.allow_all_sale_sku !== false;
        const allowAllTraspasoChk = h("input", { type: "checkbox" });
        allowAllTraspasoChk.checked = row.allow_all_traspaso_sku !== false;
        syncWorkspaceUserInputs(roleSel, employeeSel, mermaLimitInput, allowAllSaleChk, allowAllTraspasoChk);
        roleSel.addEventListener("change", () => syncWorkspaceUserInputs(roleSel, employeeSel, mermaLimitInput, allowAllSaleChk, allowAllTraspasoChk));

        const saveBtn = h(
          "button",
          {
            class: "btn",
            type: "button",
            onclick: async () => {
              employeeAccessMsg.replaceChildren();
              const nextRole = String(roleSel.value || "employee");
              if (isCurrentUser && nextRole !== "manager") {
                employeeAccessMsg.appendChild(notice("error", "No puedes quitarte el rol de manager desde esta pantalla."));
                return;
              }

              if (nextRole === "employee" && !employeeSel.value) {
                employeeAccessMsg.appendChild(notice("error", "Selecciona un empleado para los usuarios con rol empleado."));
                return;
              }

              const mermaLimit = nextRole === "employee" ? parseOptionalNonNegativeNumber(mermaLimitInput.value) : null;
              if (Number.isNaN(mermaLimit)) {
                employeeAccessMsg.appendChild(notice("error", "El límite de merma debe ser un número mayor o igual a 0."));
                return;
              }

              const payload = {
                role: nextRole,
                employee_id: nextRole === "employee" ? String(employeeSel.value || "") || null : null,
                display_name: String(displayNameInput.value || "").trim() || null,
                merma_limit_kg: nextRole === "employee" ? mermaLimit : null,
                allow_all_sale_sku: nextRole === "employee" ? !!allowAllSaleChk.checked : true,
                allow_all_traspaso_sku: nextRole === "employee" ? !!allowAllTraspasoChk.checked : true,
              };

              const { error } = await supabase
                .from("workspace_users")
                .update(payload)
                .eq("workspace_id", workspaceId())
                .eq("user_id", row.user_id);
              if (!isActive()) return;
              if (error) {
                employeeAccessMsg.appendChild(notice("error", error.message));
                return;
              }
              employeeAccessMsg.appendChild(notice("ok", "Acceso actualizado."));
              await loadAccessControlData();
            },
          },
          ["Guardar acceso"]
        );

        const deleteBtn = h(
          "button",
          {
            class: "btn btn-danger",
            type: "button",
            disabled: isCurrentUser,
            onclick: async () => {
              if (isCurrentUser) {
                employeeAccessMsg.replaceChildren(notice("error", "No puedes eliminar tu propio acceso de manager."));
                return;
              }
              if (!confirm("Eliminar este acceso? El usuario ya no podrá usar esta app con este workspace.")) return;
              const { error } = await supabase
                .from("workspace_users")
                .delete()
                .eq("workspace_id", workspaceId())
                .eq("user_id", row.user_id);
              if (!isActive()) return;
              if (error) {
                employeeAccessMsg.replaceChildren(notice("error", error.message));
                return;
              }
              employeeAccessMsg.replaceChildren(notice("ok", "Acceso eliminado."));
              await loadAccessControlData();
            },
          },
          ["Eliminar acceso"]
        );

        return h("div", { class: "notice col" }, [
          h("div", { class: "row-wrap" }, [
            h("div", { style: "font-weight: 760", text: String(row.display_name || employeeName(row.employee_id) || row.user_id || "(sin nombre)") }),
            h("div", { class: "spacer" }),
            h("div", { class: "muted mono", text: String(row.role || "employee") }),
            isCurrentUser ? h("div", { class: "muted", text: "Tu usuario actual" }) : null,
          ]),
          h("div", { class: "muted mono", style: "word-break: break-all", text: `Auth User ID: ${String(row.user_id || "")}` }),
          h("div", { class: "grid2" }, [field("Nombre visible", displayNameInput), field("Rol", roleSel)]),
          h("div", { class: "grid2" }, [field("Empleado ligado", employeeSel), field("Límite merma (kg)", mermaLimitInput)]),
          h("label", { class: "muted checkrow" }, [
            allowAllSaleChk,
            h("span", { text: "Permitir todas las ventas SKU para este usuario." }),
          ]),
          h("label", { class: "muted checkrow" }, [
            allowAllTraspasoChk,
            h("span", { text: "Permitir todos los traspasos SKU para este usuario." }),
          ]),
          h("div", { class: "row-wrap" }, [saveBtn, deleteBtn]),
        ]);
      })
    );
  }

  function renderSaleRules() {
    if (!workspaceId()) {
      saleRulesWrap.replaceChildren(notice("warn", "No se encontró workspace activo para este usuario."));
      return;
    }

    const rows = sortSaleRules(workspaceSaleRules);
    if (rows.length === 0) {
      saleRulesWrap.replaceChildren(
        notice("warn", "Todavía no hay reglas de venta SKU. Si un empleado tiene ventas restringidas, no podrá vender hasta que agregues SKUs permitidos.")
      );
      return;
    }

    saleRulesWrap.replaceChildren(
      ...rows.map((row) => {
        const noteInput = h("input", {
          type: "text",
          value: String(row.note || ""),
          placeholder: "Nota (opcional)",
        });
        const activeChk = h("input", { type: "checkbox" });
        activeChk.checked = row.is_allowed !== false;

        const saveBtn = h(
          "button",
          {
            class: "btn",
            type: "button",
            onclick: async () => {
              saleRulesMsg.replaceChildren();
              const { error } = await supabase
                .from("workspace_sale_sku_rules")
                .update({
                  note: String(noteInput.value || "").trim() || null,
                  is_allowed: !!activeChk.checked,
                })
                .eq("id", row.id);
              if (!isActive()) return;
              if (error) {
                saleRulesMsg.appendChild(notice("error", error.message));
                return;
              }
              saleRulesMsg.appendChild(notice("ok", "Regla de venta actualizada."));
              await loadAccessControlData();
            },
          },
          ["Guardar regla"]
        );

        const deleteBtn = h(
          "button",
          {
            class: "btn btn-danger",
            type: "button",
            onclick: async () => {
              if (!confirm("Eliminar esta regla de venta SKU?")) return;
              const { error } = await supabase.from("workspace_sale_sku_rules").delete().eq("id", row.id);
              if (!isActive()) return;
              if (error) {
                saleRulesMsg.appendChild(notice("error", error.message));
                return;
              }
              saleRulesMsg.appendChild(notice("ok", "Regla de venta eliminada."));
              await loadAccessControlData();
            },
          },
          ["Eliminar regla"]
        );

        return h("div", { class: "notice col" }, [
          h("div", { class: "row-wrap" }, [
            h("div", { style: "font-weight: 760", text: skuLabel(row.sku_id) || "(SKU desconocido)" }),
            h("div", { class: "spacer" }),
            h("div", { class: "muted mono", text: String(row.id).slice(0, 8) }),
          ]),
          field("Nota", noteInput),
          h("label", { class: "muted checkrow" }, [
            activeChk,
            h("span", { text: "SKU permitido para empleados con ventas restringidas." }),
          ]),
          h("div", { class: "row-wrap" }, [saveBtn, deleteBtn]),
        ]);
      })
    );
  }

  function renderTraspasoRules() {
    if (!workspaceId()) {
      traspasoRulesWrap.replaceChildren(notice("warn", "No se encontró workspace activo para este usuario."));
      return;
    }

    const rows = sortTraspasoRules(workspaceTraspasoRules);
    if (rows.length === 0) {
      traspasoRulesWrap.replaceChildren(
        notice("warn", "Todavía no hay reglas de traspaso SKU. Si un empleado tiene restricción, no podrá hacer traspasos hasta que agregues reglas.")
      );
      return;
    }

    traspasoRulesWrap.replaceChildren(
      ...rows.map((row) => {
        const noteInput = h("input", {
          type: "text",
          value: String(row.note || ""),
          placeholder: "Nota (opcional)",
        });
        const activeChk = h("input", { type: "checkbox" });
        activeChk.checked = row.is_allowed !== false;

        const saveBtn = h(
          "button",
          {
            class: "btn",
            type: "button",
            onclick: async () => {
              traspasoRulesMsg.replaceChildren();
              const { error } = await supabase
                .from("workspace_traspaso_sku_rules")
                .update({
                  note: String(noteInput.value || "").trim() || null,
                  is_allowed: !!activeChk.checked,
                })
                .eq("id", row.id);
              if (!isActive()) return;
              if (error) {
                traspasoRulesMsg.appendChild(notice("error", error.message));
                return;
              }
              traspasoRulesMsg.appendChild(notice("ok", "Regla actualizada."));
              await loadAccessControlData();
            },
          },
          ["Guardar regla"]
        );

        const deleteBtn = h(
          "button",
          {
            class: "btn btn-danger",
            type: "button",
            onclick: async () => {
              if (!confirm("Eliminar esta regla de traspaso SKU?")) return;
              const { error } = await supabase.from("workspace_traspaso_sku_rules").delete().eq("id", row.id);
              if (!isActive()) return;
              if (error) {
                traspasoRulesMsg.appendChild(notice("error", error.message));
                return;
              }
              traspasoRulesMsg.appendChild(notice("ok", "Regla eliminada."));
              await loadAccessControlData();
            },
          },
          ["Eliminar regla"]
        );

        return h("div", { class: "notice col" }, [
          h("div", { class: "row-wrap" }, [
            h("div", { style: "font-weight: 760", text: `${skuLabel(row.from_sku_id)} -> ${skuLabel(row.to_sku_id)}` }),
            h("div", { class: "spacer" }),
            h("div", { class: "muted mono", text: String(row.id).slice(0, 8) }),
          ]),
          field("Nota", noteInput),
          h("label", { class: "muted checkrow" }, [
            activeChk,
            h("span", { text: "Regla permitida para empleados con traspaso restringido." }),
          ]),
          h("div", { class: "row-wrap" }, [saveBtn, deleteBtn]),
        ]);
      })
    );
  }

  async function loadAccessControlData() {
    if (!workspaceId()) {
      workspaceUsers = [];
      workspaceSaleRules = [];
      workspaceTraspasoRules = [];
      renderWorkspaceUsers();
      renderSaleRules();
      renderTraspasoRules();
      return;
    }

    employeeAccessMsg.replaceChildren(notice("warn", "Cargando accesos..."));
    saleRulesMsg.replaceChildren(notice("warn", "Cargando reglas de venta..."));
    traspasoRulesMsg.replaceChildren(notice("warn", "Cargando reglas..."));
    const [usersRes, saleRulesRes, rulesRes] = await Promise.all([
      supabase
        .from("workspace_users")
        .select("workspace_id,user_id,role,employee_id,display_name,merma_limit_kg,allow_all_sale_sku,allow_all_traspaso_sku,created_at,updated_at")
        .eq("workspace_id", workspaceId()),
      supabase
        .from("workspace_sale_sku_rules")
        .select("id,workspace_id,sku_id,is_allowed,note,created_at,updated_at")
        .eq("workspace_id", workspaceId()),
      supabase
        .from("workspace_traspaso_sku_rules")
        .select("id,workspace_id,from_sku_id,to_sku_id,is_allowed,note,created_at,updated_at")
        .eq("workspace_id", workspaceId()),
    ]);
    if (!isActive()) return;

    if (usersRes.error) {
      employeeAccessMsg.replaceChildren(notice("error", usersRes.error.message));
    } else {
      workspaceUsers = usersRes.data || [];
      renderWorkspaceUsers();
      employeeAccessMsg.replaceChildren();
    }

    if (saleRulesRes.error) {
      saleRulesMsg.replaceChildren(notice("error", saleRulesRes.error.message));
    } else {
      workspaceSaleRules = saleRulesRes.data || [];
      renderSaleRules();
      saleRulesMsg.replaceChildren();
    }

    if (rulesRes.error) {
      traspasoRulesMsg.replaceChildren(notice("error", rulesRes.error.message));
    } else {
      workspaceTraspasoRules = rulesRes.data || [];
      renderTraspasoRules();
      traspasoRulesMsg.replaceChildren();
    }
  }

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

  const accessUserId = h("input", { type: "text", placeholder: "UUID del usuario en Auth" });
  const accessDisplayName = h("input", { type: "text", placeholder: "Nombre visible en la app" });
  const accessRole = h("select", {}, [
    h("option", { value: "employee", text: "Empleado" }),
    h("option", { value: "manager", text: "Manager" }),
  ]);
  const accessEmployee = makeEmployeeSelect("");
  const accessMermaLimit = h("input", {
    type: "number",
    step: "0.001",
    min: "0",
    placeholder: "Sin límite",
  });
  const accessAllowAllSale = h("input", { type: "checkbox" });
  accessAllowAllSale.checked = false;
  const accessAllowAllTraspaso = h("input", { type: "checkbox" });
  accessAllowAllTraspaso.checked = false;
  syncWorkspaceUserInputs(accessRole, accessEmployee, accessMermaLimit, accessAllowAllSale, accessAllowAllTraspaso);
  accessRole.addEventListener("change", () => syncWorkspaceUserInputs(accessRole, accessEmployee, accessMermaLimit, accessAllowAllSale, accessAllowAllTraspaso));

  const addAccessBtn = h(
    "button",
    {
      class: "btn btn-primary",
      type: "button",
      onclick: async () => {
        employeeAccessMsg.replaceChildren();
        const wsId = workspaceId();
        if (!wsId) {
          employeeAccessMsg.appendChild(notice("error", "No se encontró workspace activo."));
          return;
        }

        const userId = String(accessUserId.value || "").trim();
        if (!isUuidLike(userId)) {
          employeeAccessMsg.appendChild(notice("error", "Pega un Auth User ID válido (UUID)."));
          return;
        }

        const nextRole = String(accessRole.value || "employee");
        if (nextRole === "employee" && !accessEmployee.value) {
          employeeAccessMsg.appendChild(notice("error", "Selecciona un empleado para este usuario."));
          return;
        }

        const mermaLimit = nextRole === "employee" ? parseOptionalNonNegativeNumber(accessMermaLimit.value) : null;
        if (Number.isNaN(mermaLimit)) {
          employeeAccessMsg.appendChild(notice("error", "El límite de merma debe ser un número mayor o igual a 0."));
          return;
        }

        const { error } = await supabase.from("workspace_users").insert({
          workspace_id: wsId,
          user_id: userId,
          role: nextRole,
          employee_id: nextRole === "employee" ? String(accessEmployee.value || "") || null : null,
          display_name: String(accessDisplayName.value || "").trim() || null,
          merma_limit_kg: nextRole === "employee" ? mermaLimit : null,
          allow_all_sale_sku: nextRole === "employee" ? !!accessAllowAllSale.checked : true,
          allow_all_traspaso_sku: nextRole === "employee" ? !!accessAllowAllTraspaso.checked : true,
        });
        if (!isActive()) return;
        if (error) {
          employeeAccessMsg.appendChild(notice("error", error.message));
          return;
        }

        accessUserId.value = "";
        accessDisplayName.value = "";
        accessRole.value = "employee";
        accessEmployee.value = "";
        accessMermaLimit.value = "";
        accessAllowAllSale.checked = false;
        accessAllowAllTraspaso.checked = false;
        syncWorkspaceUserInputs(accessRole, accessEmployee, accessMermaLimit, accessAllowAllSale, accessAllowAllTraspaso);
        employeeAccessMsg.appendChild(notice("ok", "Acceso agregado."));
        await loadAccessControlData();
      },
    },
    ["Agregar acceso"]
  );

  const saleRuleSku = makeSaleSkuSelect("SKU de venta...");
  const saleRuleNote = h("input", { type: "text", placeholder: "Nota (opcional)" });
  const addSaleRuleBtn = h(
    "button",
    {
      class: "btn",
      type: "button",
      onclick: async () => {
        saleRulesMsg.replaceChildren();
        if (!workspaceId()) {
          saleRulesMsg.appendChild(notice("error", "No se encontró workspace activo."));
          return;
        }

        const skuId = String(saleRuleSku.value || "");
        if (!skuId) {
          saleRulesMsg.appendChild(notice("error", "Elige un SKU."));
          return;
        }
        const sku = skuById(skuId);
        if (!sku) {
          saleRulesMsg.appendChild(notice("error", "SKU inválido."));
          return;
        }

        const { error } = await supabase.from("workspace_sale_sku_rules").insert({
          workspace_id: workspaceId(),
          sku_id: skuId,
          note: String(saleRuleNote.value || "").trim() || null,
          is_allowed: true,
        });
        if (!isActive()) return;
        if (error) {
          saleRulesMsg.appendChild(notice("error", error.message));
          return;
        }
        saleRuleSku.value = "";
        saleRuleNote.value = "";
        saleRulesMsg.appendChild(notice("ok", "Regla de venta agregada."));
        await loadAccessControlData();
      },
    },
    ["Agregar regla de venta"]
  );

  const ruleFromSku = makeSkuSelect("De SKU...");
  const ruleToSku = makeSkuSelect("A SKU...");
  const ruleNote = h("input", { type: "text", placeholder: "Nota opcional" });
  const addRuleBtn = h(
    "button",
    {
      class: "btn btn-primary",
      type: "button",
      onclick: async () => {
        traspasoRulesMsg.replaceChildren();
        const wsId = workspaceId();
        if (!wsId) {
          traspasoRulesMsg.appendChild(notice("error", "No se encontró workspace activo."));
          return;
        }

        const fromSkuId = String(ruleFromSku.value || "");
        const toSkuId = String(ruleToSku.value || "");
        if (!fromSkuId || !toSkuId) {
          traspasoRulesMsg.appendChild(notice("error", "Selecciona De SKU y A SKU."));
          return;
        }
        if (fromSkuId === toSkuId) {
          traspasoRulesMsg.appendChild(notice("error", "De SKU y A SKU deben ser diferentes."));
          return;
        }

        const { error } = await supabase.from("workspace_traspaso_sku_rules").insert({
          workspace_id: wsId,
          from_sku_id: fromSkuId,
          to_sku_id: toSkuId,
          is_allowed: true,
          note: String(ruleNote.value || "").trim() || null,
        });
        if (!isActive()) return;
        if (error) {
          traspasoRulesMsg.appendChild(notice("error", error.message));
          return;
        }

        ruleFromSku.value = "";
        ruleToSku.value = "";
        ruleNote.value = "";
        traspasoRulesMsg.appendChild(notice("ok", "Regla agregada."));
        await loadAccessControlData();
      },
    },
    ["Agregar regla"]
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
        await signOutCurrentUser();
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
    h("div", { class: "card col" }, [
      h("div", { class: "h1", text: "Acceso de empleados" }),
      h("div", { class: "muted", text: "El mismo link de la app sirve para manager y empleados; el acceso depende del login." }),
      h("div", { class: "notice" }, [
        h("div", { class: "muted", text: "Para crear el login, crea primero el usuario en Supabase Auth > Users. Luego pega aquí el Auth User ID (UUID) y asígnale rol y empleado." }),
        h("div", { class: "muted mono", style: "word-break: break-all", text: `Workspace activo: ${workspaceId() || "(sin workspace)"}` }),
      ]),
      employeeAccessMsg,
      h("div", { class: "grid2" }, [field("Auth User ID", accessUserId), field("Nombre visible", accessDisplayName)]),
      h("div", { class: "grid2" }, [field("Rol", accessRole), field("Empleado ligado", accessEmployee)]),
      h("div", { class: "grid2" }, [field("Límite merma (kg)", accessMermaLimit), h("div", { class: "col" }, [
        h("label", { class: "muted checkrow" }, [
          accessAllowAllSale,
          h("span", { text: "Permitir todas las ventas SKU para este usuario." }),
        ]),
        h("label", { class: "muted checkrow" }, [
          accessAllowAllTraspaso,
          h("span", { text: "Permitir todos los traspasos SKU para este usuario." }),
        ]),
      ])]),
      h("div", { class: "muted", text: "Si desactivas todas las ventas SKU o los traspasos SKU para un empleado, las reglas de abajo definirán qué SKUs sí puede usar." }),
      h("div", { class: "row-wrap" }, [addAccessBtn]),
      employeeAccessWrap,
    ]),
    h("div", { class: "card col" }, [
      h("div", { class: "h1", text: "Reglas de venta SKU" }),
      h("div", { class: "muted", text: "Estas reglas se aplican a los empleados que tengan desactivada la opción de todas las ventas SKU." }),
      h("div", { class: "muted", text: "La lista es compartida para todos los empleados restringidos de este workspace." }),
      saleRulesMsg,
      h("div", { class: "grid2" }, [field("SKU", saleRuleSku), field("Nota", saleRuleNote)]),
      h("div", { class: "row-wrap" }, [addSaleRuleBtn]),
      saleRulesWrap,
    ]),
    h("div", { class: "card col" }, [
      h("div", { class: "h1", text: "Reglas de traspaso SKU" }),
      h("div", { class: "muted", text: "Estas reglas se aplican a los empleados que tengan desactivada la opción de todos los traspasos SKU." }),
      traspasoRulesMsg,
      h("div", { class: "grid2" }, [field("De SKU", ruleFromSku), field("A SKU", ruleToSku)]),
      field("Nota", ruleNote),
      h("div", { class: "row-wrap" }, [addRuleBtn]),
      traspasoRulesWrap,
    ]),
    h("div", { class: "card col" }, [
      h("div", { class: "h1", text: "Checklist de piloto" }),
      h("div", { class: "muted", text: "Úsalo antes de entregar la app a los empleados." }),
      h("div", { class: "notice col" }, [
        h("div", { text: "1. Verifica que cada empleado tenga login en Supabase Auth y un acceso ligado a su empleado." }),
        h("div", { text: "2. Decide si el empleado tendrá ventas libres o ventas restringidas por SKU." }),
        h("div", { text: "3. Si tendrá ventas restringidas, agrega los SKUs autorizados en Reglas de venta SKU." }),
        h("div", { text: "4. Decide si el empleado tendrá traspasos libres o restringidos por par de SKU." }),
        h("div", { text: "5. Si tendrá traspasos restringidos, agrega las reglas exactas en Reglas de traspaso SKU." }),
        h("div", { text: "6. Define el límite de merma (kg) para ese usuario." }),
        h("div", { text: "7. En el teléfono del empleado, abre la app, inicia sesión, concede permiso de cámara y prueba: una venta, una merma y un traspaso." }),
        h("div", { text: "8. Confirma que la foto se capture desde la cámara, que el movimiento aparezca en Movimientos con tu cuenta de manager y que el inventario se descuente correctamente." }),
      ]),
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
  await loadAccessControlData();
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

  if (!state.actor?.has_access) {
    const signOutBtn = h(
      "button",
      {
        class: "btn btn-danger",
        type: "button",
        onclick: async () => {
          await signOutCurrentUser();
        },
      },
      ["Cerrar sesion"]
    );
    layout(
      "Acceso no autorizado",
      h("div", { class: "card col" }, [
        h("div", { class: "h1", text: "Acceso no autorizado" }),
        h("div", {
          class: "muted",
          text: "Este usuario existe en Supabase Auth, pero no tiene acceso asignado dentro de FST INV.",
        }),
        h("div", {
          class: "muted",
          text: "Agrega su Auth User ID en Ajustes > Acceso de empleados y vuelve a iniciar sesión.",
        }),
        state.session?.user?.email ? h("div", { class: "muted mono", text: `Usuario: ${state.session.user.email}` }) : null,
        h("div", { class: "row-wrap" }, [signOutBtn]),
      ]),
      { showNav: false }
    );
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
  if (r === "entries") return pageCapture(pageCtx, { forcedMovementType: "entrada", pageTitle: ROUTE_TITLES.entries });
  if (r === "cash") return pageCash(pageCtx);
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

function isLoginInteractionSensitive() {
  return !state.session && route() === "login";
}

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
    if (isSupabaseLockAbortError(e)) {
      renderPending = true;
      window.setTimeout(() => {
        scheduleSafeRender();
      }, 200);
      return;
    }
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
  if (!state.masterLoaded || now - masterDataLoadedAt >= MASTER_DATA_TTL_MS) {
    state.masterLoaded = false;
  }
  await safeRender();
}

async function boot() {
  let bootHadLockAbort = false;
  try {
    await loadSession();
    await loadActorContext();
  } catch (e) {
    if (isSupabaseLockAbortError(e)) {
      bootHadLockAbort = true;
    } else {
      layout("Error", notice("error", e?.message ? String(e.message) : "No se pudo cargar la sesion."));
    }
  }

  let authSyncToken = 0;
  supabase.auth.onAuthStateChange((_event, session) => {
    const token = ++authSyncToken;
    clearEmployeeCaptureProofs();
    state.session = session;
    state.masterLoaded = false;
    state.actorLoaded = false;
    window.setTimeout(async () => {
      if (token !== authSyncToken) return;
      try {
        if (session) {
          await loadActorContext();
        } else {
          resetActorState();
        }
      } catch (error) {
        if (!session || isSupabaseLockAbortError(error)) {
          resetActorState();
        }
      } finally {
        if (token !== authSyncToken) return;
        if (!session) navTo("login");
        scheduleSafeRender();
      }
    }, 0);
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

  if ("scrollRestoration" in history) {
    try {
      history.scrollRestoration = "manual";
    } catch {
      // ignore
    }
  }

  window.addEventListener("hashchange", () => {
    routeScrollResetPending = true;
    scheduleSafeRender();
  });
  window.addEventListener("online", () => scheduleSafeRender());
  window.addEventListener("focus", () => {
    recoverMobileUiState();
    if (isLoginInteractionSensitive()) {
      isAppHidden = false;
      return;
    }
    if (isAppInForeground()) {
      isAppHidden = false;
      scheduleResumeRefresh();
    }
    scheduleSafeRender();
  });
  window.addEventListener("blur", () => {
    flushPendingDraftSaves();
    clearProofPickerOpen();
    clearRenderTimer();
  });
  window.addEventListener("pagehide", () => {
    isAppHidden = true;
    flushPendingDraftSaves();
    clearProofPickerOpen();
    clearRenderTimer();
  });
  window.addEventListener("pageshow", () => {
    recoverMobileUiState();
    isAppHidden = false;
    if (isLoginInteractionSensitive()) return;
    scheduleResumeRefresh();
    scheduleSafeRender();
  });
  document.addEventListener("visibilitychange", () => {
    const hidden = !isAppInForeground();
    isAppHidden = hidden;
    if (hidden) {
      flushPendingDraftSaves();
      clearProofPickerOpen();
      clearRenderTimer();
      return;
    }
    if (isLoginInteractionSensitive()) {
      isAppHidden = false;
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

  if (bootHadLockAbort) {
    window.setTimeout(() => {
      scheduleSafeRender();
    }, 200);
  }

  await safeRender();
}

boot();
