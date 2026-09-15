// ---------------------------------------------------------------------------
// 화면 상태 · 내 필지 목록 · 지도 · 필지 상세
// 실제 데이터만 표시: 지도·지적도·검색·필지 정보는 VWorld. 기상·토양·병해충은 키 연결 후 추가.
// ---------------------------------------------------------------------------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (n) => n.toLocaleString("ko-KR");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// "경상북도 포항시 북구 죽장면 두마리 1294" → "두마리 1294"
function shortAddr(addr) {
  const t = String(addr || "").split(/\s+/).filter(Boolean);
  const i = t.findLastIndex((w) => /[리동가]$/.test(w));
  return i >= 0 ? t.slice(i).join(" ") : t.slice(-2).join(" ");
}

// 필지 { id, pnu, address, lat, lon, label, status: loading|ok|none, landUse, area, jiga, jigaDate, rings, saved }
// 내 필지는 이 브라우저에만 저장 (PNU·주소·좌표만, 경계는 열 때마다 다시 조회)
const STORE_KEY = "pohang-orchard:parcels";
function loadSaved() {
  try {
    const rows = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
    return rows.map((r) => ({ ...r, id: r.pnu, label: shortAddr(r.address), status: "loading", saved: true }));
  } catch {
    return [];
  }
}
function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state.saved.map(({ pnu, address, lat, lon }) => ({ pnu, address, lat, lon }))));
  } catch { /* 저장소를 못 쓰면(사생활 보호 모드 등) 이번 방문에만 유지 */ }
}

// 공유 필지(config.js)는 모두에게 보이고 삭제할 수 없음. 같은 PNU를 내 필지에 저장해 뒀으면 공유 쪽만 표시
const shared = SHARED_PARCELS.map((r) => ({ ...r, id: r.pnu, label: shortAddr(r.address), status: "loading", saved: false, shared: true }));
const state = {
  shared,
  saved: loadSaved().filter((p) => !shared.some((s) => s.pnu === p.pnu)),
  selection: null,
  id: shared[0]?.id ?? null,
};
const listed = () => [...state.shared, ...state.saved];
const allParcels = () => (state.selection ? [state.selection, ...listed()] : listed());
const current = () => allParcels().find((p) => p.id === state.id) ?? null;
const src = (key) => `<span class="src" title="데이터 출처">${esc(SRC[key])}</span>`;

// ---------------------------------------------------------------------------
// 지도 — 기본 Leaflet + VWorld, ?map=naver면 네이버 지도(실패 시 Leaflet으로 대체) (mapview.js)
// ---------------------------------------------------------------------------
let mapView = createMapView($("#map"));
const mapClickHandlers = [];
let activeBase = "sat";
let cadastralOn = true; // 지적도 기본 표시 (확대했을 때만 보임)

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
function drawParcel(p) {
  mapView.removeField(p.id);
  mapView.addField(p, select);
}
function mountParcels() {
  allParcels().forEach(drawParcel);
  if (cadastralOn) mapView.toggleCadastral(true);
  renderTools();
}
mountParcels();

// 네이버 지도가 안 뜨면(인증 실패, URL 미등록, 서버 오류) Leaflet + VWorld로 전환
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
  cadastralOn = true;
  mountParcels();
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
  mapView.fit(listed().map((p) => [p.lat, p.lon]));
}

function renderMap() {
  allParcels().forEach((p) => mapView.updateField(p, p.id === state.id));
}

function select(id, fly) {
  state.id = id;
  renderAll();
  const p = current();
  if (fly && p) mapView.flyTo(p.lat, p.lon, 17);
}

// ---------------------------------------------------------------------------
// 선택 위치 · 내 필지
// ---------------------------------------------------------------------------
function clearSelection() {
  if (!state.selection) return;
  mapView.removeField(state.selection.id);
  if (state.id === state.selection.id) state.id = null;
  state.selection = null;
}

// VWorld 연속지적도 결과로 PNU·주소·지목·면적·공시지가·경계를 채우고 다시 그림
async function applyParcel(p, lookup) {
  const r = await lookup;
  if (!allParcels().includes(p)) return; // 그 사이 다른 위치를 골랐거나 삭제됨
  if (r && !p.saved) {
    const same = listed().find((s) => s.pnu === r.pnu);
    if (same) {
      clearSelection();
      return select(same.id, false);
    }
  }
  p.status = r ? "ok" : "none";
  if (r) {
    Object.assign(p, {
      pnu: r.pnu, address: r.address, label: shortAddr(r.address), landUse: r.landUse,
      area: r.area, jiga: r.jiga, jigaDate: r.jigaDate, rings: r.rings,
    });
  }
  drawParcel(p);
  renderAll();
}

function saveSelection() {
  const p = state.selection;
  if (!p || p.status !== "ok") return;
  clearSelection();
  Object.assign(p, { id: p.pnu, saved: true });
  state.saved.unshift(p);
  persist();
  drawParcel(p);
  select(p.id, false);
}

function removeSaved(id) {
  const i = state.saved.findIndex((p) => p.id === id);
  if (i < 0) return;
  mapView.removeField(id);
  state.saved.splice(i, 1);
  persist();
  if (state.id === id) state.id = null;
  renderAll();
}

// ---------------------------------------------------------------------------
// 내 필지 목록
// ---------------------------------------------------------------------------
$("#field-list").addEventListener("click", (ev) => {
  const rm = ev.target.closest("[data-remove]");
  if (rm) return removeSaved(rm.dataset.remove);
  const b = ev.target.closest(".field-row");
  if (b) select(b.dataset.id, true);
});

function parcelMeta(p) {
  if (p.status === "loading") return "필지 조회 중…";
  if (p.status === "none") return "필지 정보 없음";
  return `${p.landUse} · ${fmt(p.area)}㎡`;
}

function parcelRow(p) {
  return `<li>
    <button type="button" class="field-row" id="row-${p.id}" data-id="${p.id}" aria-pressed="${p.id === state.id}">
      <span class="fr-name">${p.shared ? '<span class="tag">공유</span>' : ""}${esc(p.label)}</span>
      <span class="fr-meta">${esc(parcelMeta(p))}</span>
    </button>
    ${p.shared ? "" : `<button type="button" class="fr-remove" id="rm-${p.id}" data-remove="${p.id}" aria-label="${esc(p.label)} 삭제">×</button>`}
  </li>`;
}

function renderList() {
  $("#field-count").textContent = listed().length ? `${listed().length}필지` : "";
  $("#field-list").innerHTML = listed().map(parcelRow).join("")
    + (state.saved.length ? "" : '<li class="empty">주소를 검색하거나 지도를 눌러 필지를 고른 뒤 <b>내 필지에 추가</b>를 누르세요.</li>');
}

// ---------------------------------------------------------------------------
// 필지 상세
// ---------------------------------------------------------------------------
$("#detail").addEventListener("click", (ev) => {
  if (ev.target.closest("#add-field")) saveSelection();
  else if (ev.target.closest("#remove-field")) removeSaved(state.id);
});

function renderDetail() {
  const p = current();
  if (!p) {
    $("#detail").innerHTML = `
      <div class="d-head">
        <h2>필지를 선택하세요</h2>
        <p class="d-empty">주소·지번을 검색하거나 지도를 누르면 그 자리의 필지 정보와 기상청 날씨·예보·특보, 팜맵 토양·병해충 자료를 보여줍니다.</p>
      </div>`;
    return;
  }
  ensurePublicData(p);
  const body = p.status === "ok"
    ? `<dl class="d-facts">
        <div><dt>지목</dt><dd>${esc(p.landUse)}</dd></div>
        <div><dt>면적 <small>경계로 계산</small></dt><dd class="mono">${fmt(p.area)}㎡</dd></div>
        <div><dt>개별공시지가</dt><dd>${p.jiga ? `<span class="mono">${fmt(p.jiga)}</span>원/㎡ <small>${esc(p.jigaDate)} 기준</small>` : "–"}</dd></div>
        <div><dt>PNU</dt><dd class="mono">${p.pnu}</dd></div>
      </dl>`
    : `<p class="d-empty">${p.status === "loading" ? "필지 조회 중…" : "이 위치에서 필지를 찾지 못했습니다 (도로·하천·바다 등)"}</p>`;
  const action = p.status !== "ok" || p.shared ? ""
    : p.saved ? '<button type="button" class="btn btn-ghost" id="remove-field">내 필지에서 삭제</button>'
    : '<button type="button" class="btn" id="add-field">내 필지에 추가</button>';
  const tag = p.shared ? "공유 필지" : p.saved ? "내 필지" : p.status === "ok" ? "선택 위치" : ""; // 필지가 없으면 제목이 이미 "선택 위치"
  $("#detail").innerHTML = `
    <div class="d-head">
      <div class="d-title"><h2>${esc(p.label)}</h2>${tag ? `<span class="tag">${tag}</span>` : ""}</div>
      <div class="d-addr">${esc(p.address || "주소 확인 중…")}</div>
      ${body}
      <div class="d-actions">${action}${p.status === "ok" ? src("parcel") : ""}</div>
    </div>
    ${renderPublicData(p)}`;
}

function renderAll() {
  renderList();
  renderMap();
  renderDetail();
}

fitAll();
renderAll();
listed().forEach((p) => applyParcel(p, vworldParcelByPnu(p.pnu)));
