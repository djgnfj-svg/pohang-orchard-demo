// VWorld 검색·좌표→주소·연속지적도 필지. CORS가 막혀 JSONP로 호출하고, 약관상 검색 결과는 저장하지 않는다
const VW_API = "https://api.vworld.kr/req/";
let vwSeq = 0;

function vworldCall(path, params, timeout = 7000) {
  if (typeof VWORLD_KEY !== "string" || !VWORLD_KEY) return Promise.resolve(null);
  return new Promise((resolve) => {
    const cb = `__vw${++vwSeq}`;
    const script = document.createElement("script");
    const done = (res) => {
      clearTimeout(timer);
      window[cb] = () => {}; // 타임아웃 뒤 늦게 도착한 응답이 오류를 내지 않게
      script.remove();
      resolve(res);
    };
    const timer = setTimeout(() => done(null), timeout);
    window[cb] = (json) => done(json?.response ?? null);
    script.onerror = () => done(null);
    script.src = VW_API + path + "?" + new URLSearchParams({
      ...params, key: VWORLD_KEY, domain: location.hostname || "localhost",
      format: "json", errorformat: "json", callback: cb,
    });
    document.head.appendChild(script);
  });
}

// 번지가 있으면 지번 → 도로명 → 장소, 없으면 행정구역 → 장소 → 지번 순으로 첫 결과가 나올 때까지
async function vworldSearch(q) {
  const tries = /\d/.test(q)
    ? [{ type: "address", category: "parcel" }, { type: "address", category: "road" }, { type: "place" }]
    : [{ type: "district", category: "L4" }, { type: "place" }, { type: "address", category: "parcel" }];
  for (const t of tries) {
    const r = await vworldCall("search", { service: "search", request: "search", version: "2.0", crs: "EPSG:4326", size: "6", query: q, ...t });
    const items = r?.status === "OK" ? r.result?.items ?? [] : [];
    if (!items.length) continue;
    return items.map((it) => {
      const parcel = it.address?.parcel || "", road = it.address?.road || "";
      const address = t.category === "road" ? road || parcel : parcel || road || it.title;
      const label = t.type === "address" ? address : it.title;
      const sub = t.type === "place" ? parcel || road : t.type === "district" ? "행정구역" : t.category === "road" ? parcel : road;
      return { label, sub, address: parcel || address, lat: +it.point.y, lon: +it.point.x, source: "vworld" };
    });
  }
  return [];
}

async function vworldReverse(lat, lon) {
  const r = await vworldCall("address", { service: "address", request: "getAddress", version: "2.0", crs: "epsg:4326", point: `${lon},${lat}`, type: "both" });
  const items = r?.status === "OK" ? r.result ?? [] : [];
  return (items.find((x) => x.type === "parcel") || items[0])?.text ?? null;
}

// 지번 끝 글자(지목 부호) → 지목
const JIMOK = {
  전: "밭", 답: "논", 과: "과수원", 목: "목장용지", 임: "임야", 광: "광천지", 염: "염전", 대: "대지",
  장: "공장용지", 학: "학교용지", 차: "주차장", 주: "주유소용지", 창: "창고용지", 도: "도로", 철: "철도용지",
  제: "제방", 천: "하천", 구: "구거", 유: "유지", 양: "양어장", 수: "수도용지", 공: "공원", 체: "체육용지",
  원: "유원지", 종: "종교용지", 사: "사적지", 묘: "묘지", 잡: "잡종지",
};

// 고리 면적(㎡) — 1도당 거리를 고정값 대신 위도별로 써야 0.5% 작게 나오지 않는다
function ringArea(ring) {
  const lat0 = ring.reduce((a, p) => a + p[0], 0) / ring.length;
  const f = (lat0 * Math.PI) / 180;
  const kx = 111412.84 * Math.cos(f) - 93.5 * Math.cos(3 * f); // 경도 1도(m)
  const ky = 111132.92 - 559.82 * Math.cos(2 * f) + 1.175 * Math.cos(4 * f); // 위도 1도(m)
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [y1, x1] = ring[i], [y2, x2] = ring[(i + 1) % ring.length];
    a += x1 * kx * y2 * ky - x2 * kx * y1 * ky;
  }
  return Math.abs(a) / 2;
}

function toParcel(feature) {
  const p = feature.properties, g = feature.geometry;
  const polys = g.type === "MultiPolygon" ? g.coordinates : [g.coordinates];
  const rings = polys.map((poly) => poly[0].map(([x, y]) => [y, x])); // 바깥 고리만
  const mark = p.jibun.trim().slice(-1);
  return {
    pnu: p.pnu, jibun: p.jibun, address: p.addr, landUse: JIMOK[mark] ?? mark,
    jiga: p.jiga ? +p.jiga : null, // 개별공시지가 (원/㎡)
    jigaDate: p.gosi_year ? `${p.gosi_year}.${p.gosi_month}` : "",
    rings, area: Math.round(rings.reduce((a, r) => a + ringArea(r), 0)),
  };
}

async function vworldParcel(filter) {
  const r = await vworldCall("data", {
    service: "data", request: "GetFeature", version: "2.0", data: "LP_PA_CBND_BUBUN",
    crs: "EPSG:4326", geometry: "true", attribute: "true", size: "1", ...filter,
  });
  const f = r?.status === "OK" ? r.result?.featureCollection?.features?.[0] : null;
  return f ? toParcel(f) : null;
}
const vworldParcelAt = (lat, lon) => vworldParcel({ geomFilter: `POINT(${lon} ${lat})` });
const vworldParcelByPnu = (pnu) => vworldParcel({ attrFilter: `pnu:=:${pnu}` });
