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
// 지도 — 네이버 지도 우선, 인증 실패·미로드 시 Leaflet(Esri 위성)로 대체 (mapview.js)
// 필지 폴리곤은 목업 (실서비스: VWorld 연속지적도 / 팜맵 경계)
// ---------------------------------------------------------------------------
let mapView = createMapView($("#map"));
const mapClickHandlers = [];
let activeBase = "sat";
let cadastralOn = false;

function showMapNote(text) {
  const note = $("#map-note");
  note.textContent = text;
  note.hidden = false;
}

const tools = document.createElement("div");
tools.className = "map-tools";
$(".map-wrap").appendChild(tools);
function renderTools() {
  const btn = (id, label, pressed, attrs = "") => `<button type="button" id="${id}" ${attrs} aria-pressed="${pressed}">${label}</button>`;
  tools.innerHTML = [
    btn("map-sat", "위성", activeBase === "sat", 'data-base="sat"'),
    btn("map-base", "일반", activeBase === "base", 'data-base="base"'),
    mapView.bases.includes("cadastral") ? btn("map-cad", "지적도", cadastralOn) : "",
    '<button type="button" id="map-all">전체 보기</button>',
  ].join("");
}
tools.addEventListener("click", (ev) => {
  const b = ev.target.closest("button");
  if (!b) return;
  if (b.id === "map-all") return fitAll();
  if (b.id === "map-cad") {
    cadastralOn = !cadastralOn;
    mapView.toggleCadastral(cadastralOn);
    return renderTools();
  }
  activeBase = b.dataset.base;
  mapView.setBase(activeBase);
  renderTools();
});

function onMapClick(cb) {
  mapClickHandlers.push(cb);
  mapView.onClick(cb);
}
function addFieldLayers(f) { mapView.addField(f, select); }
function removeFieldLayers(id) { mapView.removeField(id); }

function mountFields() {
  FIELDS.forEach(addFieldLayers);
  renderTools();
}
mountFields();

// 네이버 지도가 안 뜨면(인증 실패, URL 미등록, 서버 오류) 대체 지도(Leaflet + Esri 위성)로 전환
function fallbackToLeaflet(message) {
  if (mapView.kind !== "naver") return;
  mapView.destroy();
  // 네이버 스크립트가 실패 후에도 기존 요소를 건드리므로 새 요소로 교체
  const fresh = document.createElement("div");
  fresh.id = "map";
  fresh.setAttribute("aria-label", "필지 지도");
  $("#map").replaceWith(fresh);
  mapView = LeafletView(fresh);
  mapClickHandlers.forEach((cb) => mapView.onClick(cb));
  activeBase = "sat";
  cadastralOn = false;
  mountFields();
  renderMap();
  fitAll();
  showMapNote(message);
}
window.navermap_authFailure = () =>
  fallbackToLeaflet("네이버 지도 인증 실패 — 이 주소를 Client ID의 Web 서비스 URL에 등록하면 네이버 지도로 표시됩니다");

// 인증 오류(500 등)는 authFailure가 호출되지 않으므로, 5초 안에 init이 안 오면 전환
if (mapView.kind === "naver") {
  let naverReady = false;
  naver.maps.Event.once(mapView.raw, "init", () => { naverReady = true; });
  setTimeout(() => {
    if (!naverReady && !mapView.raw?.isReady) fallbackToLeaflet("네이버 지도를 불러오지 못해 대체 지도로 표시합니다");
  }, 5000);
}

function fitAll() {
  mapView.fit(FIELDS.map((f) => [f.lat, f.lon]));
}

function renderMap() {
  FIELDS.forEach((f) => {
    const v = evalAt(f, state.t)[state.index];
    mapView.updateField(f, v.status.key, v.score, f.id === state.id);
  });
}

function select(id, fly) {
  state.id = id;
  renderAll();
  if (fly) {
    const f = currentField();
    mapView.flyTo(f.lat, f.lon, 17);
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
