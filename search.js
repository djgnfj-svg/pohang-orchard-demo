// ---------------------------------------------------------------------------
// 주소 검색 · 지도 클릭 → 그 위치의 필지(VWorld 연속지적도)를 선택
// 검색 순서: 내 필지 주소 → VWorld 검색 → 네이버 Geocoding(?map=naver) → OSM Nominatim
// ---------------------------------------------------------------------------
const searchForm = $("#search-form");
const searchInput = $("#search-input");
const searchBtn = $("#search-btn");
const searchResults = $("#search-results");
let selSeq = 0;
let lastResults = [];

const mapHint = document.createElement("div");
mapHint.className = "map-hint";
mapHint.textContent = "지도를 누르면 그 자리의 필지를 조회합니다";
$(".map-wrap").appendChild(mapHint);

// Nominatim "두마리, 죽장면, 북구, 포항시, 경상북도, 37800, 대한민국" → "경상북도 포항시 북구 죽장면 두마리"
function krAddress(displayName) {
  return displayName.split(",").map((s) => s.trim())
    .filter((s) => s && s !== "대한민국" && !/^\d{5}$/.test(s))
    .reverse().join(" ");
}

// Nominatim은 "면 + 리" 조합이나 지번을 잘 못 찾으므로 점점 넓혀가며 재시도 (이용정책상 1초 간격)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function relaxedQueries(q) {
  const noNum = q.replace(/(산\s*)?\d+(-\d+)?(번지)?/g, " ").replace(/\s+/g, " ").trim();
  const words = noNum.split(" ").filter(Boolean);
  const list = [q, noNum];
  if (words.length > 1) list.push(words[words.length - 1]);
  for (let n = words.length - 1; n >= 1; n--) list.push(words.slice(0, n).join(" "));
  return [...new Set(list)].filter((x) => x.length >= 2).slice(0, 4);
}
async function nominatimSearch(q) {
  const tries = relaxedQueries(q);
  for (let i = 0; i < tries.length; i++) {
    if (i) await sleep(1100);
    const url = "https://nominatim.openstreetmap.org/search?" + new URLSearchParams({
      q: tries[i], format: "jsonv2", limit: "6", countrycodes: "kr", "accept-language": "ko",
      viewbox: "128.95,36.45,129.65,35.85", bounded: i && !tries[i].includes(" ") ? "1" : "0",
    });
    const r = await fetch(url, { signal: AbortSignal.timeout(7000) });
    const rows = await r.json();
    if (rows.length) return { rows, used: tries[i] };
  }
  return { rows: [], used: null };
}

async function geocode(q) {
  const key = q.replace(/\s+/g, "");
  const out = listed().filter((p) => String(p.address).replace(/\s+/g, "").includes(key))
    .map((p) => ({ label: p.label, sub: p.address, lat: p.lat, lon: p.lon, parcelId: p.id, source: p.shared ? "shared" : "saved" }));

  if (!out.length) out.push(...(await vworldSearch(q)));
  if (!out.length) out.push(...(await naverGeocode(q)));
  if (!out.length) {
    try {
      const { rows, used } = await nominatimSearch(q);
      rows.forEach((x) => {
        const addr = krAddress(x.display_name);
        const approx = used !== q ? ` · '${used}'로 찾은 근사 위치` : "";
        out.push({ label: x.name || addr.split(" ").pop(), sub: addr + approx, address: addr, lat: +x.lat, lon: +x.lon, source: "osm" });
      });
    } catch { /* 네트워크 차단 시 결과 없음 */ }
  }
  return out;
}

// 네이버 지도 Geocoding (?map=naver이고 Client ID에 Geocoding API가 켜져 있을 때만 동작, 아니면 빈 결과)
function naverService() {
  return mapView.kind === "naver" ? window.naver?.maps?.Service : null;
}
function naverGeocode(q) {
  const S = naverService();
  if (!S) return Promise.resolve([]);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve([]), 5000);
    S.geocode({ query: q }, (status, res) => {
      clearTimeout(timer);
      if (status !== S.Status.OK) return resolve([]);
      resolve((res?.v2?.addresses ?? []).map((a) => ({
        label: a.jibunAddress || a.roadAddress, sub: a.roadAddress || "", address: a.jibunAddress || a.roadAddress,
        lat: +a.y, lon: +a.x, source: "naver",
      })));
    });
  });
}
function naverReverse(lat, lon) {
  const S = naverService();
  if (!S) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 5000);
    S.reverseGeocode({ coords: new naver.maps.LatLng(lat, lon), orders: "addr,roadaddr" }, (status, res) => {
      clearTimeout(timer);
      const a = status === S.Status.OK ? res?.v2?.address : null;
      resolve(a ? a.jibunAddress || a.roadAddress || null : null);
    });
  });
}

async function reverseGeocode(lat, lon) {
  const vworldAddr = await vworldReverse(lat, lon);
  if (vworldAddr) return vworldAddr;
  const naverAddr = await naverReverse(lat, lon);
  if (naverAddr) return naverAddr;
  try {
    const url = "https://nominatim.openstreetmap.org/reverse?" + new URLSearchParams({
      lat: lat.toFixed(6), lon: lon.toFixed(6), format: "jsonv2", zoom: "17", "accept-language": "ko",
    });
    const r = await fetch(url, { signal: AbortSignal.timeout(7000) });
    const j = await r.json();
    return j.display_name ? krAddress(j.display_name) : null;
  } catch {
    return null;
  }
}

// 검색 결과·지도 클릭 위치를 선택하고 그 자리의 필지를 조회. 필지가 없으면 주소만이라도 표시.
function goTo(result) {
  closeResults();
  if (result.parcelId) return select(result.parcelId, true);
  clearSelection();
  const p = { id: `SEL-${++selSeq}`, lat: result.lat, lon: result.lon, label: "선택 위치", address: result.address || "", status: "loading", saved: false };
  state.selection = p;
  drawParcel(p);
  select(p.id, true);
  showDetailTop();
  applyParcel(p, vworldParcelAt(p.lat, p.lon)).then(async () => {
    if (state.selection !== p || p.status !== "none" || p.address) return;
    p.address = (await reverseGeocode(p.lat, p.lon)) || `좌표 ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
    if (state.id === p.id) renderDetail();
  });
}

// 검색 후 필지 정보가 바로 보이도록 상세 패널을 맨 위로 (좁은 화면에서는 패널까지 스크롤)
function showDetailTop() {
  const d = $("#detail");
  d.scrollTop = 0;
  if (window.innerWidth <= 1180) d.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
}

function closeResults() {
  searchResults.hidden = true;
  searchResults.innerHTML = "";
}

function showResults(list, q) {
  lastResults = list;
  searchResults.innerHTML = list.length
    ? list.map((r, i) => `<li><button type="button" id="sr-${i}" data-i="${i}">
        <span class="sr-t">${esc(r.label)}</span>
        <span class="sr-s">${esc(r.sub)}</span>
        <span class="src">${esc(SRC[r.source])}</span>
      </button></li>`).join("")
    : `<li class="sr-empty">"${esc(q)}" 결과가 없습니다. 읍·면·리 이름으로 다시 검색하거나 지도를 눌러 보세요.</li>`;
  searchResults.hidden = false;
}

searchForm.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const q = searchInput.value.trim();
  if (!q) return;
  searchBtn.disabled = true;
  searchBtn.textContent = "검색 중…";
  try {
    const list = await geocode(q);
    if (list.length === 1) goTo(list[0]);
    else showResults(list, q);
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = "검색";
  }
});
searchResults.addEventListener("click", (ev) => {
  const b = ev.target.closest("button[data-i]");
  if (b) goTo(lastResults[+b.dataset.i]);
});
document.addEventListener("click", (ev) => {
  if (!searchForm.contains(ev.target)) closeResults();
});
searchInput.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") closeResults();
});

onMapClick((lat, lng) => goTo({ lat, lon: lng }));
