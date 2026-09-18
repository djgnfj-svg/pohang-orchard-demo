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
// 지도 — 기본 Leaflet + VWorld. 지도 도구의 "네이버" 버튼으로 같은 위치를 네이버 지도로 바꿔 본다 (mapview.js)
// ---------------------------------------------------------------------------
let mapView = createMapView($("#map"), "leaflet");
const mapClickHandlers = [];
let activeBase = "sat";
let cadastralOn = true; // 지적도 기본 표시 (확대했을 때만 보임)
let windOn = false;
let windReloadTimer = null;

async function reloadWindField() {
  if (!windOn || mapView.kind === "naver") return;
  try {
    const data = await loadWindField(mapView.raw.getBounds(), 4);
    mapView.setWindField?.(data);
  } catch (e) {
    console.error("바람장 갱신 실패", e);
  }
}

function scheduleWindReload() {
  if (!windOn) return;
  clearTimeout(windReloadTimer);
  windReloadTimer = setTimeout(reloadWindField, 500);
}

const robotShow = { lidar: true, route: true }; // 로봇 라이다 영상 · 주행 경로 (robot.js)
const hasNaverKey = typeof NAVER_CLIENT_ID === "string" && !!NAVER_CLIENT_ID;
let switchingMap = false; // 네이버 스크립트를 불러오는 중

let mapNoteTimer = null;
function showMapNote(text) {
  const note = $("#map-note");
  note.textContent = text;
  note.hidden = false;
  clearTimeout(mapNoteTimer);
  mapNoteTimer = setTimeout(hideMapNote, 3000); // 3초 뒤 자동으로 사라짐
}
function hideMapNote() {
  $("#map-note").hidden = true;
}
$("#map-note-close").addEventListener("click", hideMapNote);

const tools = document.createElement("div");
tools.className = "map-tools";
$(".map-wrap").appendChild(tools);
// 도구 막대는 세 가지가 섞여 있어 모양으로 구별한다.
//   고르기(둘 중 하나) = 이어 붙인 칸, 고른 쪽이 진한 색   — 배경지도(위성·일반), 지도 종류(VWorld·네이버)
//   켜고 끄기          = 낱개 칸, 켜면 연한 색 + 색 점      — 지적도·라이다·경로
//   한 번 하는 일      = 테두리만                          — 전체 보기
function renderTools() {
  const btn = (id, label, pressed, attrs = "") => `<button type="button" id="${id}" ${attrs} aria-pressed="${pressed}">${label}</button>`;
  const dot = (style) => `<i class="tool-dot" style="${style}" aria-hidden="true"></i>`;
  const pick = (label, inner) => `<span class="tool-pick" role="group" aria-label="${label}">${inner}</span>`;
  const rm = ROBOT_MAPS[0];
  const groups = [
    pick("배경지도",
      btn("map-sat", "위성", activeBase === "sat", 'data-base="sat"')
      + btn("map-base", "일반", activeBase === "base", 'data-base="base"')),
    [
      mapView.bases.includes("cadastral") ? btn("map-cad", dot("background:var(--line-strong)") + "지적도", cadastralOn, 'title="필지 경계선"') : "",
      rm ? btn("map-lidar", dot(`background:${heightGradient(rm.lidar.legend)}`) + "라이다", robotShow.lidar, 'data-robot="lidar" title="로봇 라이다 평면 영상 (지면 위 높이 색)"') : "",
      rm ? btn("map-route", dot(`background:${ROBOT_PATH_HEX}`) + "경로", robotShow.route, 'data-robot="route" title="로봇 주행 경로 · 작업 구역"') : "",
    ].join(""),
    hasNaverKey ? pick("지도 종류",
      btn("map-vworld", "VWorld", mapView.kind !== "naver", 'data-map="vworld" title="VWorld 위성·지적도 (기본)"')
      + btn("map-naver", switchingMap ? "여는 중…" : "네이버", mapView.kind === "naver", `data-map="naver" title="네이버 지도로 같은 자리 비교"${switchingMap ? " disabled" : ""}`)) : "",
    '<button type="button" id="map-all" class="tool-do">전체 보기</button>',
    `<button type="button" id="map-wind" class="tool-do" aria-pressed="${windOn}">바람장</button>`,
  ].filter(Boolean);
  tools.innerHTML = groups.join('<i class="tool-sep" aria-hidden="true"></i>');
}
tools.addEventListener("click", async (ev) => {
  const b = ev.target.closest("button");
  if (!b) return;
  if (b.id === "map-all") return fitAll();
  if (b.dataset.map) return switchMap(b.dataset.map);
  if (b.id === "map-cad") {
    cadastralOn = !cadastralOn;
    mapView.toggleCadastral(cadastralOn);
    return renderTools();
  }
  if (b.dataset.robot) {
    robotShow[b.dataset.robot] = !robotShow[b.dataset.robot];
    mountRobotMaps();
    return renderTools();
  }
  if (b.id === "map-wind") {
    windOn = !windOn;
    b.setAttribute("aria-pressed", String(windOn));
    if (windOn) {
      if (mapView.kind === "naver") {
        windOn = false;
        b.setAttribute("aria-pressed", "false");
        return;
      }
      b.textContent = "불러오는 중…";
      try {
        const data = await loadWindField(mapView.raw.getBounds(), 4);
        mapView.setWindField?.(data);
      } catch (e) {
        console.error("바람장 불러오기 실패", e);
        windOn = false;
        b.setAttribute("aria-pressed", "false");
      } finally {
        b.textContent = "바람장";
      }
    } else {
      clearTimeout(windReloadTimer);
      mapView.setWindField?.(null);
    }
    return renderTools();
  }
  activeBase = b.dataset.base;
  mapView.setBase(activeBase);
  renderTools();
}
);

function onMapClick(cb) {
  mapClickHandlers.push(cb);
  mapView.onClick(cb);
}
function drawParcel(p) {
  mapView.removeField(p.id);
  mapView.addField(p, select);
}
function mountRobotMaps() {
  ROBOT_MAPS.forEach((rm) => mapView.setRobotMap(rm, robotShow));
}
function mountParcels() {
  mountRobotMaps();
  allParcels().forEach(drawParcel);
  if (cadastralOn) mapView.toggleCadastral(true);
  renderTools();
  mapView.raw.off?.("moveend", scheduleWindReload); // ← 추가
  mapView.raw.on?.("moveend", scheduleWindReload);  // ← 추가
}
mountParcels();
// 3D 카드를 열고 닫는 등 지도 칸 크기가 바뀌면 지도를 다시 맞춤
new ResizeObserver(() => mapView.resize()).observe($(".map-wrap"));

// ---------------------------------------------------------------------------
// VWorld ↔ 네이버 전환 — 보던 자리·줌을 그대로 넘겨 두 지도를 비교한다.
// 네이버는 Client ID에 등록된 주소(djgnfj-svg.github.io)에서만 인증되므로 localhost에서는 실패하고 되돌아온다.
// ---------------------------------------------------------------------------
function replaceMapView(kind, note) {
  const start = mapView.view();
  mapView.destroy();
  // 네이버 스크립트가 실패 후에도 기존 요소를 건드리므로 새 요소로 교체
  const fresh = document.createElement("div");
  fresh.id = "map";
  fresh.setAttribute("aria-label", "필지 지도");
  $("#map").replaceWith(fresh);
  mapView = createMapView(fresh, kind, start);
  mapClickHandlers.forEach((cb) => mapView.onClick(cb));
  mapView.setBase(activeBase);
  mountParcels();
  renderMap();
  if (!start) fitAll();
  if (note) showMapNote(note);
  else hideMapNote();
  watchNaver();
}

async function switchMap(kind) {
  const want = kind === "naver" ? "naver" : "leaflet"; // VWorld 쪽 어댑터의 kind는 "leaflet"
  if (switchingMap || mapView.kind === want) return;
  switchingMap = true;
  renderTools();
  try {
    if (want === "naver") await loadNaverMaps();
    replaceMapView(want);
  } catch (e) {
    showMapNote(e.message);
  } finally {
    switchingMap = false;
    renderTools();
  }
}

// 네이버 지도가 안 뜨면(인증 실패, URL 미등록, 서버 오류) Leaflet + VWorld로 되돌린다
function fallbackToLeaflet(message) {
  if (mapView.kind !== "naver") return;
  replaceMapView("leaflet", message);
}
window.navermap_authFailure = () => fallbackToLeaflet(NAVER_FAIL_NOTE);

// 네이버 지도는 인증에 실패해도 authFailure를 부르지 않고 지도 칸에 안내 그림(auth_fail)만 깔 때가 있다.
// 그래서 0.5초마다 그림을 확인하고, 5초 안에 init도 안 오면 되돌린다.
const NAVER_FAIL_NOTE = "네이버 지도 인증 실패 — 이 주소를 Client ID의 Web 서비스 URL에 등록하면 네이버 지도로 표시됩니다";
function watchNaver() {
  if (mapView.kind !== "naver") return;
  const opened = mapView;
  const el = $("#map");
  let ready = false;
  naver.maps.Event.once(opened.raw, "init", () => { ready = true; });
  let ticks = 0;
  const timer = setInterval(() => {
    if (mapView !== opened) return clearInterval(timer);
    if (/auth_fail/.test(el.style.backgroundImage || "")) {
      clearInterval(timer);
      return fallbackToLeaflet(NAVER_FAIL_NOTE);
    }
    if (++ticks < 10) return; // 5초
    clearInterval(timer);
    if (!ready && !opened.raw?.isReady) fallbackToLeaflet("네이버 지도를 불러오지 못해 대체 지도로 표시합니다");
  }, 500);
}

function fitAll() { // 로봇 맵이 있으면 라이다 범위까지 보이게
  mapView.fit([...listed().map((p) => [p.lat, p.lon]), ...ROBOT_MAPS.flatMap((rm) => rm.lidar.bounds)]);
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
    if (same && same !== p) { // 선택 위치가 이미 목록에 있는 필지면 그 필지로 (공유 필지 자기 자신은 제외)
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
  const robot3d = ev.target.closest("[data-robot3d]");
  if (robot3d) openRobot3D(robot3d.dataset.robot3d);
  else if (ev.target.closest("#add-field")) saveSelection();
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
    ${renderRobotMap(p)}
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
if (MAP_PARAM === "naver") switchMap("naver"); // ?map=naver로 열면 네이버 지도로 시작
