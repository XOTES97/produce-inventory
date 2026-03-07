import { APP_VERSION, DEFAULT_CURRENCY } from "./config.js";
import { supabase } from "./supabaseClient.js";

const $root = document.getElementById("root");

const ROUTE_TITLES = {
  login: "Iniciar sesion",
  capture: "Capturar",
  movements: "Movimientos",
  inventory: "Inventario",
  cutoffs: "Cortes",
  reports: "Reportes",
  settings: "Ajustes",
};

const NAV_ITEMS = [
  { route: "capture", label: "Capturar", icon: "+" },
  { route: "movements", label: "Movimientos", icon: "LOG" },
  { route: "inventory", label: "Inventario", icon: "KG" },
  { route: "cutoffs", label: "Cortes", icon: "CUT" },
  { route: "reports", label: "Reportes", icon: "REP" },
  { route: "settings", label: "Ajustes", icon: "CFG" },
];

const state = {
  session: null,
  products: [],
  qualities: [],
  employees: [],
  skus: [],
  masterLoaded: false,
};

const STORAGE_KEYS = {
  captureFixedDatetimeLock: "produce_inventory.capture.fixed_datetime_lock",
  captureFixedDatetimeValue: "produce_inventory.capture.fixed_datetime_value",
};
const NETWORK_TIMEOUT_MS = 45000;

function route() {
  const raw = (location.hash || "#/").replace(/^#\/?/, "");
  const r = raw.split("?")[0].trim();
  return r || "capture";
}

function navTo(r) {
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

function sanitizeFilename(name) {
  return String(name || "proof")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 80);
}

function productName(id) {
  return state.products.find((p) => p.id === id)?.name ?? "(Producto desconocido)";
}

function qualityName(id) {
  return state.qualities.find((q) => q.id === id)?.name ?? "(Calidad desconocida)";
}

function employeeName(id) {
  return state.employees.find((e) => e.id === id)?.name ?? "(Empleado desconocido)";
}

function skuById(id) {
  return state.skus.find((s) => s.id === id) || null;
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
  state.masterLoaded = true;
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

  function cleanupStuckBackdrops() {
    // Defensive: if a modal backdrop gets "stuck" (rare on mobile after navigation),
    // it will block taps on the bottom nav. Remove any leftovers.
    for (const el of document.querySelectorAll(".modal-backdrop")) el.remove();
  }

  const topbar = h("div", { class: "topbar" }, [
    h("div", { class: "topbar-inner" }, [
      h("div", { class: "brand" }, [
        h("div", { class: "brand-title", text: "Produce Inventory" }),
        h("div", { class: "brand-sub", text: pageTitle }),
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
    const r = route();
    const nav = h("div", { class: "bottomnav" }, [
      h(
        "div",
        { class: "bottomnav-inner", style: `grid-template-columns: repeat(${NAV_ITEMS.length}, 1fr)` },
        NAV_ITEMS.map((it) =>
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

function movementTypePills({ onChange, initial }) {
  const types = [
    { id: "entrada", label: "Entrada" },
    { id: "venta", label: "Venta" },
    { id: "merma", label: "Merma" },
    { id: "traspaso_sku", label: "Traspaso SKU" },
    { id: "traspaso_calidad", label: "Traspaso" },
    { id: "ajuste", label: "Ajuste" },
  ];
  let current = initial || "venta";

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

  return { el: row, get, setMode: setVisibilityForMode, setProductQuality };
}

async function pageCapture() {
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
  const notes = h("textarea", { placeholder: "Notas (opcional). Ej: cliente, contexto..." });
  const currency = h("input", { type: "text", value: DEFAULT_CURRENCY, placeholder: "Moneda (MXN)" });
  const reportedBy = h("select", {}, optionList(employees, { includeEmpty: true, emptyLabel: "(Opcional)..." }));

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
  const proofsHint = h("div", { class: "muted" }, [
    "Evidencia (opcional): foto(s) de WhatsApp. Capturas de pantalla funcionan.",
  ]);

  const pills = movementTypePills({
    initial: "venta",
    onChange: (mt) => updateMode(mt),
  });

  let currentMode = pills.get();
  const linesWrap = h("div", { class: "col" });
  const lineRows = [];

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
        }
      },
    });
    lineRows.push(row);
    linesWrap.appendChild(row.el);
    applyTraspasoSkuBucket();
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
  occurredAt.addEventListener("change", () => {
    if (lockOccurredAt.checked) storageSet(STORAGE_KEYS.captureFixedDatetimeValue, String(occurredAt.value || ""));
  });
  lockOccurredAt.addEventListener("change", () => {
    storageSet(STORAGE_KEYS.captureFixedDatetimeLock, lockOccurredAt.checked ? "1" : "0");
    if (lockOccurredAt.checked) {
      if (!occurredAt.value) occurredAt.value = localNowInputValue();
      storageSet(STORAGE_KEYS.captureFixedDatetimeValue, String(occurredAt.value || ""));
    }
  });

  function resetCaptureFormAfterSave() {
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
    linesWrap.replaceChildren();
    lineRows.length = 0;
    addLine();
    updateMode(currentMode);
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

        if (typeof navigator !== "undefined" && navigator.onLine === false) {
          msg.appendChild(notice("warn", "Sin conexion. Revisa internet e intenta de nuevo."));
          return;
        }

        const dtIso = isoFromLocalInput(String(occurredAt.value || ""));
        if (!dtIso) {
          msg.appendChild(notice("error", "Fecha/hora invalida."));
          return;
        }

        const files = Array.from(proofs.files || []);
        const rawLines = lineRows.map((r) => r.get());
        const parsed = [];

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
          submitBtn.disabled = on;
          submitBtn.textContent = on ? "Guardando..." : "Guardar movimiento";
        };

        setSubmitting(true);
        msg.replaceChildren(notice("warn", "Guardando movimiento..."));

        let movementId = "";
        const uploaded = [];
        try {
          movementId = crypto.randomUUID();

          // 1) Upload proofs first (so we can fail fast before writing to DB).
          for (let i = 0; i < files.length; i++) {
            const f = files[i];
            const safe = sanitizeFilename(f.name);
            const path = `${userId}/${movementId}/${Date.now()}_${i}_${safe}`;
            const { error: upErr } = await withTimeout(
              supabase.storage.from("movement-proofs").upload(path, f, {
                cacheControl: "3600",
                upsert: false,
                contentType: f.type || "application/octet-stream",
              }),
              NETWORK_TIMEOUT_MS,
              `Subida de evidencia ${i + 1}`
            );
            if (upErr) throw upErr;
            uploaded.push({
              storage_bucket: "movement-proofs",
              storage_path: path,
              original_filename: f.name || null,
              content_type: f.type || null,
              size_bytes: f.size || null,
            });
          }

          // 2) Build DB rows (signed deltas)
          const movement = {
            id: movementId,
            movement_type: currentMode,
            occurred_at: dtIso,
            notes: String(notes.value || "").trim() || null,
            currency: currentMode === "venta" ? String(currency.value || DEFAULT_CURRENCY).trim() || DEFAULT_CURRENCY : DEFAULT_CURRENCY,
            reported_by_employee_id: String(reportedBy.value || "") || null,
            from_sku_id: currentMode === "traspaso_sku" ? fromSkuId : null,
            to_sku_id: currentMode === "traspaso_sku" ? toSkuId : null,
            from_quality_id: currentMode === "traspaso_calidad" ? String(fromQuality.value) : null,
            to_quality_id: currentMode === "traspaso_calidad" ? String(toQuality.value) : null,
          };

          const lines = [];
          for (const ln of parsed) {
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
              `${e?.message ? String(e.message) : "No se pudo guardar el movimiento."} Si la red estuvo inestable, espera unos segundos y revisa Movimientos antes de reintentar.`
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
	      h("div", { class: "grid2" }, [field("Fecha/hora", occurredAt), field("Empleado", reportedBy)]),
      h(
        "label",
        { class: "muted", style: "display:flex; align-items:center; gap:8px; margin-top:-2px" },
        [lockOccurredAt, h("span", { text: "Mantener fecha/hora fija despues de guardar." })]
      ),
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

  layout(ROUTE_TITLES.capture, card);
  updateMode(currentMode);
}

async function pageMovements() {
  const msg = h("div");
  const listWrap = h("div", { class: "col" });

  async function load() {
    msg.replaceChildren(notice("warn", "Cargando..."));
	    const { data, error } = await supabase
	      .from("movements")
	      .select(
	        "id,movement_type,occurred_at,notes,currency,reported_by_employee_id,from_sku_id,to_sku_id,from_quality_id,to_quality_id,created_at," +
	          "movement_lines(id,sku_id,product_id,quality_id,delta_weight_kg,boxes,price_model,unit_price,line_total)," +
	          "movement_attachments(id,storage_path,original_filename,content_type,size_bytes)"
	      )
	      .order("occurred_at", { ascending: false })
      .limit(50);
    if (error) {
      msg.replaceChildren(notice("error", error.message));
      return;
    }
    msg.replaceChildren();
    listWrap.replaceChildren();

    for (const m of data || []) {
      const lines = m.movement_lines || [];
      const att = m.movement_attachments || [];

	      const sumDelta = lines.reduce((acc, l) => acc + Number(l.delta_weight_kg || 0), 0);
	      const sumAbs = lines.reduce((acc, l) => acc + Math.abs(Number(l.delta_weight_kg || 0)), 0);
	      const isTransfer = m.movement_type === "traspaso_calidad" || m.movement_type === "traspaso_sku";
	      const kgLabel =
	        isTransfer
	          ? `${fmtKg(sumAbs / 2)} kg movidos`
	          : `${fmtKg(Math.abs(sumDelta))} kg`;

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
          onclick: () => openMovementModal(m),
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
        lines.length
          ? h("div", { class: "movement-lines-preview col" }, [
              ...lines.map((l) => {
                const skuText =
                  skuLabel(l.sku_id) ||
                  `${productName(l.product_id)} | ${qualityName(l.quality_id)}`;
                const d = Number(l.delta_weight_kg || 0);
                const kg = `${d >= 0 ? "+" : "-"}${fmtKg(Math.abs(d))} kg`;
                const pieces = [kg];
                if (l.boxes != null) pieces.push(`${Number(l.boxes || 0)} cajas`);
                if (m.movement_type === "venta" && l.line_total != null) {
                  pieces.push(fmtMoney(Number(l.line_total || 0), m.currency || DEFAULT_CURRENCY));
                }
                return h("div", { class: "movement-line-item" }, [
                  h("div", { class: "mono movement-line-sku", text: skuText }),
                  h("div", { class: "spacer" }),
                  h("div", { class: "mono movement-line-qty", text: pieces.join(" | ") }),
                ]);
              }),
            ])
          : null,
      ]);
      listWrap.appendChild(card);
    }
  }

  const refreshBtn = h("button", { class: "btn", type: "button", onclick: load }, ["Actualizar"]);
  const top = h("div", { class: "card col" }, [
    h("div", { class: "row-wrap" }, [h("div", { class: "h1", text: "Movimientos recientes" }), h("div", { class: "spacer" }), refreshBtn]),
    msg,
  ]);

  const page = h("div", { class: "col" }, [top, listWrap]);
  layout(ROUTE_TITLES.movements, page);

  await load();
}

	async function openMovementModal(m) {
	  const backdrop = h("div", { class: "modal-backdrop" });
	  const modal = h("div", { class: "modal col" });
	  backdrop.appendChild(modal);

  function close() {
    backdrop.remove();
  }
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });

	  const header = h("div", { class: "row-wrap modal-header" }, [
	    h("div", { class: "col", style: "gap: 4px" }, [
	      h("div", { style: "font-weight: 820; font-size: 16px", text: movementLabel(m.movement_type) }),
	      h("div", { class: "muted", text: formatOccurredAt(m.occurred_at) }),
	    ]),
	    h("div", { class: "spacer" }),
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
	          await render();
	        },
	      },
	      ["Eliminar"]
	    ),
	    h("button", { class: "btn btn-ghost", type: "button", onclick: close }, ["Cerrar"]),
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
    const signed = await Promise.all(
      attachments.map(async (a) => {
        const { data } = await supabase.storage.from("movement-proofs").createSignedUrl(a.storage_path, 60 * 30);
        return { ...a, signedUrl: data?.signedUrl || null };
      })
    );
    proofsWrap.replaceChildren(
      h("div", { class: "thumbgrid" }, [
        ...signed
          .filter((a) => a.signedUrl)
          .map((a) =>
            h("a", { href: a.signedUrl, target: "_blank", rel: "noreferrer" }, [
              h("img", { class: "thumb", src: a.signedUrl, alt: a.original_filename || "proof" }),
            ])
          ),
      ])
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

async function pageInventory() {
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
    msg.replaceChildren(notice("warn", "Cargando..."));
    const { data, error } = await supabase.from("inventory_on_hand").select("product_id,product_name,quality_id,quality_name,on_hand_kg");
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

    renderTable();
  }

  await load();
}

async function pageReports() {
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

        for (const m of data || []) {
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

async function pageCutoffs() {
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
  const lineMeasuredAt = h("input", { type: "datetime-local", value: localNowInputValue() });
  const lineWeight = h("input", { type: "number", step: "0.001", min: "0.001", placeholder: "0.000" });
  const lineNotes = h("textarea", { placeholder: "Notas del pesaje (opcional)." });
  const lineProofs = h("input", { type: "file", accept: "image/*", multiple: true });

  const reportCutoffSel = h("select");

  setSkuSelectOptions(lineSku);

  async function loadCutoffs() {
    listMsg.replaceChildren(notice("warn", "Cargando cortes..."));
    const { data, error } = await supabase
      .from("physical_cutoffs")
      .select("id,started_at,ended_at,notes,created_at")
      .order("started_at", { ascending: false })
      .limit(100);
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

          for (let i = 0; i < files.length; i++) {
            const f = files[i];
            const safe = sanitizeFilename(f.name);
            const path = `${userId}/${cutoffId}/${lineId}/${Date.now()}_${i}_${safe}`;
            const { error: upErr } = await withTimeout(
              supabase.storage.from("physical-cutoff-proofs").upload(path, f, {
                cacheControl: "3600",
                upsert: false,
                contentType: f.type || "application/octet-stream",
              }),
              NETWORK_TIMEOUT_MS,
              `Subida de evidencia de corte ${i + 1}`
            );
            if (upErr) throw upErr;
            uploaded.push({
              cutoff_line_id: lineId,
              storage_bucket: "physical-cutoff-proofs",
              storage_path: path,
              original_filename: f.name || null,
              content_type: f.type || null,
              size_bytes: Number.isFinite(f.size) ? f.size : null,
            });
          }

          if (uploaded.length > 0) {
            const { error: attErr } = await supabase.from("physical_cutoff_attachments").insert(uploaded);
            if (attErr) throw attErr;
          }

          lineWeight.value = "";
          lineNotes.value = "";
          lineProofs.value = "";
          lineMeasuredAt.value = localNowInputValue();
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
    if (physicalErr) {
      reportMsg.replaceChildren(notice("error", physicalErr.message));
      return;
    }

    const { data: allMoves, error: allMovesErr } = await supabase
      .from("movements")
      .select("id,occurred_at,movement_lines(product_id,quality_id,delta_weight_kg)")
      .lte("occurred_at", cutoffEndIso)
      .order("occurred_at", { ascending: true });
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
    if (periodErr) {
      reportMsg.replaceChildren(notice("error", periodErr.message));
      return;
    }

    const physicalByBucket = new Map();
    for (const ln of physicalLines || []) {
      const sku = skuById(ln.sku_id);
      if (!sku) continue;
      const key = bucketKey(sku.product_id, sku.quality_id);
      physicalByBucket.set(key, Number(physicalByBucket.get(key) || 0) + Number(ln.weight_kg || 0));
    }

    const expectedByBucket = new Map();
    for (const m of allMoves || []) {
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
    const rows = Array.from(keys)
      .map((key) => {
        const skList = (bucketSkus.get(key) || []).slice().sort((a, b) => Number(a.code || 0) - Number(b.code || 0));
        const primary = choosePrimarySku(skList);
        const codes = skList.length ? skList.map((s) => String(s.code)).join("/") : "";
        const expected = Number(expectedByBucket.get(key) || 0);
        const physical = Number(physicalByBucket.get(key) || 0);
        const diff = physical - expected;
        const pct = Math.abs(expected) > 0 ? (diff / Math.abs(expected)) * 100 : physical === 0 ? 0 : null;
        const sortCode = skList.length ? Math.min(...skList.map((s) => Number(s.code || 0))) : 999999;
        return {
          key,
          product_id: String(key).split("|")[0] || null,
          quality_id: String(key).split("|")[1] || null,
          expected,
          physical,
          diff,
          pct,
          primary,
          skList,
          codes,
          sortCode,
        };
      })
      .filter((r) => Math.abs(r.expected) > 0 || Math.abs(r.physical) > 0)
      .sort((a, b) => (a.sortCode - b.sortCode) || String(skuLabel(a.primary?.id || "")).localeCompare(String(skuLabel(b.primary?.id || ""))));

    const discrepancyRows = rows.filter((r) => Math.abs(r.diff) > 0.0005);
    const totalExpected = rows.reduce((acc, r) => acc + r.expected, 0);
    const totalPhysical = rows.reduce((acc, r) => acc + r.physical, 0);
    const totalDiff = totalPhysical - totalExpected;
    const totalPct = Math.abs(totalExpected) > 0 ? (totalDiff / Math.abs(totalExpected)) * 100 : null;

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
        rows.map((r) => {
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
    for (const m of periodMoves || []) {
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
    }

    latestKardexRows = kardexRows;
    latestPeriodStartIso = periodStartIso;
    latestPeriodEndIso = cutoffEndIso;
    latestComparisonRows = rows;
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

    reportOut.replaceChildren(
      h("div", { class: "card col" }, [
        h("div", { class: "h1", text: "Resumen de corte" }),
        h("div", { class: "muted", text: `Corte actual: ${cutoffLabel(cutoff)}` }),
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
      h("div", { class: "row-wrap" }, [generateReportBtn, applyCutoffBtn, exportKardexBtn, printBtn]),
    ]),
    reportOut,
  ]);

  layout(ROUTE_TITLES.cutoffs, page);
  await loadCutoffs();
}

async function pageSettings() {
  const msg = h("div");

  const productsWrap = h("div", { class: "col" });
  const qualitiesWrap = h("div", { class: "col" });
  const employeesWrap = h("div", { class: "col" });
  const skusWrap = h("div", { class: "col" });

  async function refreshMaster() {
    state.masterLoaded = false;
    await loadMasterData();
    render();
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

	        for (const m of data || []) {
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
          for (const l of m.movement_lines || []) {
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
  const r = route();

  if (!state.session) {
    if (r !== "login") navTo("login");
    await pageLogin();
    return;
  }

  if (!state.masterLoaded) {
    try {
      await loadMasterData();
    } catch (e) {
      layout("Error", notice("error", e?.message ? String(e.message) : "No se pudo cargar catalogos."));
      return;
    }
  }

  if (r === "login") {
    navTo("capture");
    return;
  }

  if (r === "capture") return pageCapture();
  if (r === "movements") return pageMovements();
  if (r === "inventory") return pageInventory();
  if (r === "cutoffs") return pageCutoffs();
  if (r === "reports") return pageReports();
  if (r === "settings") return pageSettings();

  navTo("capture");
}

let renderRunning = false;
let renderPending = false;

async function safeRender() {
  if (renderRunning) {
    renderPending = true;
    return;
  }
  renderRunning = true;
  try {
    do {
      renderPending = false;
      await render();
    } while (renderPending);
  } catch (e) {
    layout("Error", notice("error", e?.message ? String(e.message) : "La app tuvo un error inesperado."));
  } finally {
    renderRunning = false;
  }
}

let lastResumeRefreshAt = 0;
async function refreshAfterResume() {
  const now = Date.now();
  if (now - lastResumeRefreshAt < 3000) return;
  lastResumeRefreshAt = now;
  try {
    await loadSession();
    state.masterLoaded = false;
  } catch {
    // ignore; safeRender will show auth error if needed
  }
  await safeRender();
}

// Boot
try {
  await loadSession();
} catch (e) {
  layout("Error", notice("error", e?.message ? String(e.message) : "No se pudo cargar la sesion."));
}

supabase.auth.onAuthStateChange(async (_event, session) => {
  state.session = session;
  state.masterLoaded = false;
  if (!session) navTo("login");
  await safeRender();
});

window.addEventListener("hashchange", () => safeRender());
window.addEventListener("online", () => safeRender());
window.addEventListener("focus", () => refreshAfterResume());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshAfterResume();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  });
}

await safeRender();
