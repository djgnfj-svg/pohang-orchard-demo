// ---------------------------------------------------------------------------
// 주소 검색 · 지도 클릭 → 그 위치의 필지 데이터를 한 화면에 모아보기
// 지오코딩 순서: 등록 농지 이름/주소 → 네이버 Geocoding → Flask /api/geocode (VWorld 키 있을 때) → OSM Nominatim
// 위치 이후의 필지 속성(면적·토양·기상 보정)은 좌표 기반 목업 — 키 연동 후 실제 API로 교체
// ---------------------------------------------------------------------------
const searchForm = $("#search-form");
const searchInput = $("#search-input");
const searchBtn = $("#search-btn");
const searchResults = $("#search-results");
let tempSeq = 0;
let lastResults = [];

const mapHint = document.createElement("div");
mapHint.className = "map-hint";
mapHint.textContent = "지도를 누르면 그 위치를 분석합니다";
$(".map-wrap").appendChild(mapHint);

function seeded(key) {
  let h = 2166136261;
  for (const c of key) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
}

// Nominatim "두마리, 죽장면, 북구, 포항시, 경상북도, 37800, 대한민국" → "경상북도 포항시 북구 죽장면 두마리"
function krAddress(displayName) {
  return displayName.split(",").map((s) => s.trim())
    .filter((s) => s && s !== "대한민국" && !/^\d{5}$/.test(s))
    .reverse().join(" ");
}

function distKm(lat1, lon1, lat2, lon2) {
  const toR = Math.PI / 180;
  const x = (lon2 - lon1) * toR * Math.cos(((lat1 + lat2) / 2) * toR);
  const y = (lat2 - lat1) * toR;
  return Math.sqrt(x * x + y * y) * 6371;
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
  const out = [];
  const key = q.replace(/\s+/g, "");
  FIELDS.filter((f) => !f.temp && (f.name.replace(/\s+/g, "").includes(key) || f.address.replace(/\s+/g, "").includes(key)))
    .forEach((f) => out.push({ label: f.name, sub: f.address, lat: f.lat, lon: f.lon, fieldId: f.id, source: "registered" }));

  if (!out.length) out.push(...(await naverGeocode(q)));

  if (!out.some((x) => x.source === "naver")) try {
    const r = await fetch(`../api/geocode?address=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(4000) });
    const j = r.ok ? await r.json() : null;
    if (j?.source === "vworld") out.push({ label: q, sub: "VWorld 지오코딩 결과", lat: j.lat, lon: j.lon, source: "vworld" });
  } catch { /* 정적 배포(GitHub Pages)나 파일로 열었을 때는 서버 없음 */ }

  if (!out.some((x) => x.source === "vworld" || x.source === "naver")) {
    try {
      const { rows, used } = await nominatimSearch(q);
      rows.forEach((x) => {
        const addr = krAddress(x.display_name);
        const approx = used !== q ? ` · '${used}'로 찾은 근사 위치` : "";
        out.push({ label: x.name || addr.split(" ").pop(), sub: addr + approx, address: addr, lat: +x.lat, lon: +x.lon, source: "osm" });
      });
    } catch { /* 네트워크 차단 시 등록 농지 결과만 */ }
  }
  return out;
}

// 네이버 지도 Geocoding (Client ID에 Geocoding API가 켜져 있을 때만 동작, 아니면 빈 결과)
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

function makeTempField({ lat, lon, address, source }) {
  const rnd = seeded(`${lat.toFixed(4)},${lon.toFixed(4)}`);
  const pick = (min, max, d = 1) => +(min + rnd() * (max - min)).toFixed(d);
  const coastal = lon > 129.3;
  tempSeq += 1;
  return {
    id: `S-${String(tempSeq).padStart(2, "0")}`, name: "검색 위치", temp: true, preset: "apple-hongro",
    ...CROP_PRESETS["apple-hongro"],
    address, geocoder: source, pnu: "조회 필요", landUse: "판독 필요",
    area: Math.round(pick(1500, 6000, 0) / 10) * 10, lat, lon,
    tempOffset: pick(-1.4, 0.8), windOffset: coastal ? pick(1.0, 2.6) : pick(-0.3, 1.0),
    slope: coastal ? pick(2, 9, 0) : pick(6, 22, 0), rainFactor: pick(0.6, 1.2),
    lastSpray: `2026-09-${String(1 + Math.floor(rnd() * 12)).padStart(2, "0")}`,
    lastRainMm: pick(6, 14, 0), dryDays: 4 + Math.floor(rnd() * 5),
    soil: { pH: pick(5.4, 6.8), om: pick(16, 38, 0), p: pick(150, 450, 0), k: pick(0.35, 0.9, 2), ca: pick(3.8, 6.8), mg: pick(1.1, 2.3), ec: pick(0.3, 2.6) },
  };
}

function dropField(f) {
  FIELDS.splice(FIELDS.indexOf(f), 1);
  removeFieldLayers(f.id);
  invalidateField(f.id);
}

function removeTempField(id) {
  const f = FIELDS.find((x) => x.id === id);
  if (!f) return;
  dropField(f);
  if (state.id === id) state.id = FIELDS[0].id;
  renderAll();
}

// 검색 결과/클릭 위치로 이동. 등록 농지 250m 이내면 그 농지를 선택, 아니면 검색 필지를 새로 만든다.
function goTo(result) {
  closeResults();
  if (result.fieldId) return select(result.fieldId, true);
  const near = FIELDS.find((f) => !f.temp && distKm(f.lat, f.lon, result.lat, result.lon) < 0.25);
  if (near) return select(near.id, true);
  FIELDS.filter((f) => f.temp).forEach(dropField);
  const f = makeTempField({ lat: result.lat, lon: result.lon, address: result.address || result.sub || result.label, source: result.source });
  FIELDS.unshift(f);
  addFieldLayers(f);
  select(f.id, true);
  showDetailTop();
  return f;
}

// 검색 후 종합 판정이 바로 보이도록 상세 패널을 맨 위로 (좁은 화면에서는 패널까지 스크롤)
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
        <span class="src">${esc(r.source === "registered" ? "내 농지" : SRC[r.source])}</span>
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

onMapClick(async (lat, lng) => {
  const f = goTo({ lat, lon: lng, label: "지도 선택 위치", sub: `지도 선택 위치 (${lat.toFixed(5)}, ${lng.toFixed(5)})`, source: "click" });
  if (!f) return;
  const addr = await reverseGeocode(lat, lng);
  if (addr && FIELDS.includes(f)) {
    f.address = addr;
    if (state.id === f.id) renderDetail();
  }
});

// 검색 필지: 작물 가정 변경 / 내 농지로 추가
$("#detail").addEventListener("change", (ev) => {
  if (ev.target.id !== "crop-preset") return;
  const f = currentField();
  Object.assign(f, CROP_PRESETS[ev.target.value], { preset: ev.target.value });
  invalidateField(f.id);
  renderAll();
});
$("#detail").addEventListener("click", (ev) => {
  if (ev.target.id !== "add-field") return;
  const f = currentField();
  f.temp = false;
  f.name = `신규 필지 ${f.id.slice(2)}`;
  f.landUse = "과수원(가정)";
  renderAll();
});
