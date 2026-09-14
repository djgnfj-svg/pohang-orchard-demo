// ---------------------------------------------------------------------------
// 화면 상태 · 농지 목록 · 지도 · 선택 필지 패널
// ---------------------------------------------------------------------------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (n) => n.toLocaleString("ko-KR");
const STATUS_ICON = { good: "✓", warning: "!", critical: "✕", neutral: "–", na: "·" };
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const hourlyCache = new Map();
const evalCache = new Map();
function hourlyOf(f) {
  if (!hourlyCache.has(f.id)) hourlyCache.set(f.id, buildHourly(f));
  return hourlyCache.get(f.id);
}
function evalAt(f, t) {
  const k = `${f.id}:${t}`;
  if (!evalCache.has(k)) evalCache.set(k, evaluate(f, hourlyOf(f), t));
  return evalCache.get(k);
}
function invalidateField(id) {
  hourlyCache.delete(id);
  for (const k of [...evalCache.keys()]) if (k.startsWith(`${id}:`)) evalCache.delete(k);
}

const state = { id: FIELDS[0].id, t: DEFAULT_HOUR, index: "spray", tab: "hourly", openWhy: new Set() };
const currentField = () => FIELDS.find((f) => f.id === state.id);

function pill(status, text) {
  return `<span class="pill" data-s="${status.key}"><i aria-hidden="true">${STATUS_ICON[status.key]}</i>${esc(text ?? status.label)}</span>`;
}
function src(key) {
  return `<span class="src" title="데이터 출처">${esc(SRC[key])}</span>`;
}

// ---------------------------------------------------------------------------
// 상단: 기준 시각, 특보
// ---------------------------------------------------------------------------
const hourSel = $("#hour-select");
hourSel.innerHTML = Array.from({ length: 72 }, (_, h) => `<option value="${h}">${hourLabel(h)}</option>`).join("");
hourSel.addEventListener("change", () => setHour(+hourSel.value));

const warnAlert = ALERTS.find((a) => a.status === "warning");
const alertChip = $("#alert-chip");
alertChip.dataset.s = "warning";
alertChip.innerHTML = `<i aria-hidden="true">!</i>${esc(warnAlert.kind)} ${esc(warnAlert.level)} · ${esc(warnAlert.when)}`;

function setHour(h) {
  state.t = Math.max(0, Math.min(71, h));
  renderAll();
}

// ---------------------------------------------------------------------------
// 농지 목록
// ---------------------------------------------------------------------------
$("#index-switch").innerHTML = INDEXES.map(
  (i) => `<button type="button" role="radio" id="idx-${i.key}" data-key="${i.key}">${i.label}</button>`
).join("");
$("#index-switch").addEventListener("click", (ev) => {
  const b = ev.target.closest("button");
  if (!b) return;
  state.index = b.dataset.key;
  renderAll();
});
$("#field-list").addEventListener("click", (ev) => {
  const rm = ev.target.closest("[data-remove]");
  if (rm) return removeTempField(rm.dataset.remove);
  const b = ev.target.closest(".field-row");
  if (b) select(b.dataset.id, true);
});

function renderList() {
  const idx = INDEXES.find((i) => i.key === state.index);
  $("#field-count").textContent = `${FIELDS.filter((f) => !f.temp).length}필지 · ${idx.label} ${idx.kind === "need" ? "필요도" : "적합도"}`;
  document.querySelectorAll("#index-switch button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.key === state.index)));

  $("#field-list").innerHTML = FIELDS.map((f) => {
    const v = evalAt(f, state.t)[state.index];
    return `<li class="${f.temp ? "is-temp" : ""}"><button type="button" class="field-row" id="row-${f.id}" data-id="${f.id}" aria-pressed="${f.id === state.id}">
      <span class="fr-main">
        <span class="fr-name">${f.temp ? '<span class="tag">검색</span>' : ""}${esc(f.name)}</span>
        <span class="fr-meta">${f.crop} ${esc(f.cultivar)} · ${fmt(f.area)}㎡ · ${esc(f.stage)}</span>
      </span>
      <span class="fr-score"><span class="num">${v.score ?? "–"}</span>${pill(v.status)}</span>
    </button>${f.temp ? `<button type="button" class="fr-remove" id="rm-${f.id}" data-remove="${f.id}" aria-label="검색 위치 지우기">×</button>` : ""}</li>`;
  }).join("");

  const keys = idx.kind === "need"
    ? [["warning", "필요 70+"], ["neutral", "검토 40–69"], ["good", "불필요"]]
    : [["good", "적합 70+"], ["warning", "주의 40–69"], ["critical", "부적합"], ["na", "시기 아님"]];
  $("#status-legend").innerHTML = keys.map(([k, l]) => `<span data-s="${k}"><b></b>${l}</span>`).join("");
}

// ---------------------------------------------------------------------------
// 지도 — 필지 폴리곤은 목업 (실서비스: VWorld 연속지적도 / 팜맵 경계)
// ---------------------------------------------------------------------------
const map = L.map("map", { zoomControl: false });
L.control.zoom({ position: "bottomright" }).addTo(map);

const baseLayers = {
  sat: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19, attribution: "Esri World Imagery (데모용 · 실서비스 VWorld)",
  }),
  base: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: "© OpenStreetMap (데모용 · 실서비스 VWorld)",
  }),
};
let activeBase = "sat";
baseLayers.sat.addTo(map);

let tileFailed = false;
Object.values(baseLayers).forEach((layer) =>
  layer.on("tileerror", () => {
    if (tileFailed) return;
    tileFailed = true;
    $("#map").classList.add("no-tiles");
    $("#map-note").hidden = false;
  })
);

const tools = document.createElement("div");
tools.className = "map-tools";
tools.innerHTML = `
  <button type="button" id="map-sat" data-base="sat" aria-pressed="true">위성</button>
  <button type="button" id="map-base" data-base="base" aria-pressed="false">일반</button>
  <button type="button" id="map-all">전체 보기</button>`;
$(".map-wrap").appendChild(tools);
tools.addEventListener("click", (ev) => {
  const b = ev.target.closest("button");
  if (!b) return;
  if (b.id === "map-all") return fitAll();
  if (b.dataset.base === activeBase) return;
  map.removeLayer(baseLayers[activeBase]);
  activeBase = b.dataset.base;
  baseLayers[activeBase].addTo(map).bringToBack();
  tools.querySelectorAll("[data-base]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.base === activeBase)));
});

// 필지 중심 기준 격자 배치로 등록 필지 + 주변 필지(미등록)를 그림
function parcel(f, i, j, widthScale = 1) {
  const side = Math.sqrt(f.area);
  const w = side * 0.62, hh = side * 0.4, gap = 6, rot = 0.24;
  const cx = i * (2 * w + gap), cy = j * (2 * hh + gap);
  const mLat = 1 / 111320, mLon = 1 / (111320 * Math.cos((f.lat * Math.PI) / 180));
  return [[-w, -hh], [w, -hh], [w, hh], [-w, hh]].map(([x, y], k) => {
    const X = cx + x * widthScale + Math.sin((i * 3 + j * 5 + k) * 1.3) * side * 0.04;
    const Y = cy + y + Math.cos((i * 7 + j * 2 + k) * 1.1) * side * 0.03;
    const east = X * Math.cos(rot) - Y * Math.sin(rot);
    const north = X * Math.sin(rot) + Y * Math.cos(rot);
    return [f.lat + north * mLat, f.lon + east * mLon];
  });
}

const fieldLayers = {};
function addFieldLayers(f) {
  const group = L.layerGroup().addTo(map);
  for (let i = -2; i <= 2; i++) {
    for (let j = -2; j <= 2; j++) {
      if (!i && !j) continue;
      L.polygon(parcel(f, i, j, 0.8 + (Math.abs(i * 3 + j) % 3) * 0.08), { className: "nb-parcel", interactive: false }).addTo(group);
    }
  }
  const poly = L.polygon(parcel(f, 0, 0), { className: "field-parcel", bubblingMouseEvents: false }).addTo(group);
  poly.on("click", () => select(f.id, false));
  const pin = L.marker([f.lat, f.lon], { keyboard: false }).addTo(group);
  pin.on("click", () => select(f.id, true));
  fieldLayers[f.id] = { group, poly, pin };
}
function removeFieldLayers(id) {
  fieldLayers[id]?.group.remove();
  delete fieldLayers[id];
}
FIELDS.forEach(addFieldLayers);

function fitAll() {
  map.fitBounds(L.latLngBounds(FIELDS.map((f) => [f.lat, f.lon])).pad(0.2), { animate: !reduceMotion });
}

function renderMap() {
  FIELDS.forEach((f) => {
    const v = evalAt(f, state.t)[state.index];
    const sel = f.id === state.id ? " is-selected" : "";
    const { poly, pin } = fieldLayers[f.id];
    const el = poly.getElement();
    if (el) {
      el.setAttribute("class", `leaflet-interactive field-parcel${sel}`);
      el.setAttribute("data-s", v.status.key);
    }
    if (sel) poly.bringToFront();
    pin.setIcon(L.divIcon({
      className: "pin-wrap", iconSize: null,
      html: `<div class="pin${sel}" data-s="${v.status.key}"><b>${v.score ?? "–"}</b><span>${esc(f.name)}</span></div>`,
    }));
    pin.setZIndexOffset(sel ? 1000 : 0);
  });
}

function select(id, fly) {
  state.id = id;
  renderAll();
  if (fly) {
    const f = currentField();
    if (reduceMotion) map.setView([f.lat, f.lon], 17);
    else map.flyTo([f.lat, f.lon], 17, { duration: 0.8 });
  }
}

// ---------------------------------------------------------------------------
// 선택 필지 패널
// ---------------------------------------------------------------------------
$("#detail").addEventListener("toggle", (ev) => {
  const d = ev.target;
  if (!d.id?.startsWith("why-")) return;
  if (d.open) state.openWhy.add(d.id); else state.openWhy.delete(d.id);
}, true);

function scoreRow(i, v) {
  const id = `why-${i.key}`;
  const factors = v.factors.length
    ? v.factors.map((x) => `<li><span>${esc(x.text)}</span><span class="mono">${x.delta > 0 ? "+" : ""}${x.delta || ""}</span></li>`).join("")
    : "<li><span>감점 요인 없음</span></li>";
  return `<li class="score-row">
    <details id="${id}"${state.openWhy.has(id) ? " open" : ""}>
      <summary>
        <span class="sr-label">${i.label}${i.kind === "need" ? "<small>필요도</small>" : ""}</span>
        <span class="meter" aria-hidden="true"><span class="meter-fill" data-s="${v.status.key}" style="width:${v.score ?? 0}%"></span></span>
        <span class="sr-num mono">${v.score ?? "–"}</span>
        ${pill(v.status)}
      </summary>
      <ul class="factors">${factors}</ul>
    </details>
  </li>`;
}

function detailHead(f) {
  if (!f.temp) {
    return `
      <div class="d-title"><h2>${esc(f.name)}</h2><span class="d-id">${f.id}</span></div>
      <div class="d-addr">${esc(f.address)}</div>
      <dl class="d-facts">
        <div><dt>작물 · 품종</dt><dd>${f.crop} ${esc(f.cultivar)} <small>${esc(f.maturity)}</small></dd></div>
        <div><dt>생육단계</dt><dd>${esc(f.stage)}${src("growth")}</dd></div>
        <div><dt>면적 · 판독</dt><dd><span class="mono">${fmt(f.area)}㎡</span> · ${esc(f.landUse)}</dd></div>
        <div><dt>PNU</dt><dd class="mono">${f.pnu}${src("parcel")}</dd></div>
      </dl>`;
  }
  const options = Object.entries(CROP_PRESETS)
    .map(([k, p]) => `<option value="${k}"${k === f.preset ? " selected" : ""}>${p.crop} ${p.cultivar} · ${p.stage}</option>`)
    .join("");
  return `
    <div class="d-title"><h2>${esc(f.name)}</h2><span class="d-id">${f.id}</span><span class="tag">미등록 필지</span></div>
    <div class="d-addr">${esc(f.address)}${src(f.geocoder)}</div>
    <dl class="d-facts">
      <div><dt><label for="crop-preset">작물 · 품종 (선택)</label></dt><dd><select id="crop-preset">${options}</select></dd></div>
      <div><dt>생육단계</dt><dd>${esc(f.stage)}${src("growth")}</dd></div>
      <div><dt>면적</dt><dd><span class="mono">${fmt(f.area)}㎡</span> <small>예시</small></dd></div>
      <div><dt>좌표</dt><dd class="mono">${f.lat.toFixed(5)}, ${f.lon.toFixed(5)}</dd></div>
    </dl>
    <div class="d-actions">
      <button type="button" class="btn" id="add-field">내 농지에 추가</button>
      <small>경계·PNU·토양은 API 키 연동 후 실제 값으로 바뀝니다</small>
    </div>`;
}

function renderDetail() {
  const f = currentField();
  const r = hourlyOf(f)[state.t];
  const e = evalAt(f, state.t);
  $("#detail").innerHTML = `
    <div class="d-head">${detailHead(f)}</div>
    <div class="d-weather">
      <div class="d-sec-head"><h3>${hourLabel(state.t)} 기상</h3>${src(state.t === DEFAULT_HOUR ? "ncst" : "fcst")}</div>
      <div class="wx">
        <div><span class="wx-v">${r.temp}<small>℃</small></span><span class="wx-l">기온</span></div>
        <div><span class="wx-v">${r.hum}<small>%</small></span><span class="wx-l">습도</span></div>
        <div><span class="wx-v">${r.wind}<small>m/s</small></span><span class="wx-l">풍속</span></div>
        <div><span class="wx-v">${r.pop}<small>%</small></span><span class="wx-l">강수확률</span></div>
      </div>
      <div class="wx-sky">${r.sky}${r.pcp ? ` · 시간당 ${r.pcp}mm` : ""} · 마지막 방제 ${e.sprayDays}일 전</div>
    </div>
    <div class="d-scores">
      <div class="d-sec-head"><h3>작업 판단</h3>${src("engine")}</div>
      <ul class="scores">${INDEXES.map((i) => scoreRow(i, e[i.key])).join("")}</ul>
    </div>
    <div class="d-recs">
      <div class="d-sec-head"><h3>추천</h3></div>
      <ul class="recs">${e.recs.map((x) => `<li data-s="${x.tone}"><i aria-hidden="true">${STATUS_ICON[x.tone]}</i><span>${esc(x.text)}</span></li>`).join("")}</ul>
    </div>`;
}

// ---------------------------------------------------------------------------
// 하단 탭 (내용은 ui.js의 TABS)
// ---------------------------------------------------------------------------
$("#tabs").addEventListener("click", (ev) => {
  const b = ev.target.closest("button");
  if (!b) return;
  state.tab = b.dataset.key;
  renderTabs();
});

function renderTabs() {
  $("#tabs").innerHTML = TABS.map(
    (tb) => `<button type="button" role="tab" id="tab-${tb.key}" data-key="${tb.key}" aria-selected="${tb.key === state.tab}">${tb.label}</button>`
  ).join("");
  const f = currentField();
  const ctx = { field: f, rows: hourlyOf(f), t: state.t, e: evalAt(f, state.t), evalAt, setHour };
  const tab = TABS.find((x) => x.key === state.tab);
  const body = $("#tab-body");
  body.innerHTML = tab.render(ctx);
  tab.bind?.(body, ctx);
}

function renderAll() {
  hourSel.value = state.t;
  renderList();
  renderMap();
  renderDetail();
  renderTabs();
}

fitAll();
renderAll();
