// ---------------------------------------------------------------------------
// 지도 어댑터 — 네이버 지도(Client ID에 등록된 도메인) 우선, 안 되면 Leaflet + Esri 위성으로 대체.
// app.js는 이 인터페이스만 사용: addField / updateField / removeField / fit / flyTo / onClick / setBase
// ---------------------------------------------------------------------------
const STATUS_HEX = { good: "#0ca30c", warning: "#fab219", critical: "#d03b3b", neutral: "#8a948d", na: "#b7bfb8" };

function pinHtml(f, status, score, selected) {
  return `<div class="pin-wrap"><div class="pin${selected ? " is-selected" : ""}" data-s="${status}"><b>${score ?? "–"}</b><span>${esc(f.name)}</span></div></div>`;
}

// 필지 중심 기준 격자 배치로 등록 필지(i=j=0) + 주변 필지를 [lat, lon] 꼭짓점으로 반환 (목업 경계)
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

function forNeighbors(fn) {
  for (let i = -2; i <= 2; i++) {
    for (let j = -2; j <= 2; j++) {
      if (i || j) fn(i, j, 0.8 + (Math.abs(i * 3 + j) % 3) * 0.08);
    }
  }
}

// ---------------------------------------------------------------------------
function NaverView(el) {
  const nm = naver.maps;
  const map = new nm.Map(el, {
    center: new nm.LatLng(36.17, 129.2),
    zoom: 11,
    mapTypeId: nm.MapTypeId.HYBRID,
    zoomControl: true,
    zoomControlOptions: { position: nm.Position.BOTTOM_RIGHT, style: nm.ZoomControlStyle.SMALL },
    scaleControl: false,
    mapDataControl: false,
  });
  const cadastral = new nm.CadastralLayer();
  const layers = {};
  const ll = ([lat, lon]) => new nm.LatLng(lat, lon);
  let suppressMapClick = false; // 필지·핀 클릭이 지도 클릭으로 이어지지 않게
  const swallow = () => { suppressMapClick = true; setTimeout(() => { suppressMapClick = false; }, 0); };

  return {
    kind: "naver",
    raw: map,
    bases: ["sat", "base", "cadastral"],
    setBase(k) { map.setMapTypeId(k === "base" ? nm.MapTypeId.NORMAL : nm.MapTypeId.HYBRID); },
    toggleCadastral(on) { cadastral.setMap(on ? map : null); },
    addField(f, onSelect) {
      const neighbors = [];
      forNeighbors((i, j, s) => neighbors.push(new nm.Polygon({
        map, paths: [parcel(f, i, j, s).map(ll)], clickable: false,
        strokeColor: "#ffffff", strokeOpacity: 0.6, strokeWeight: 1, fillColor: "#ffffff", fillOpacity: 0.06,
      })));
      const poly = new nm.Polygon({
        map, paths: [parcel(f, 0, 0).map(ll)], clickable: true, zIndex: 10,
        strokeColor: "#ffffff", strokeWeight: 2, fillColor: STATUS_HEX.na, fillOpacity: 0.42,
      });
      const pin = new nm.Marker({ map, position: ll([f.lat, f.lon]), zIndex: 100, icon: { content: "<div></div>", anchor: new nm.Point(0, 0) } });
      nm.Event.addListener(poly, "click", () => { swallow(); onSelect(f.id, false); });
      nm.Event.addListener(pin, "click", () => { swallow(); onSelect(f.id, true); });
      layers[f.id] = { neighbors, poly, pin };
    },
    updateField(f, status, score, selected) {
      const x = layers[f.id];
      if (!x) return;
      x.poly.setOptions({ fillColor: STATUS_HEX[status], fillOpacity: selected ? 0.55 : 0.42, strokeWeight: selected ? 3.5 : 2, zIndex: selected ? 20 : 10 });
      x.pin.setIcon({ content: pinHtml(f, status, score, selected), anchor: new nm.Point(0, 0) });
      x.pin.setZIndex(selected ? 1000 : 100);
    },
    removeField(id) {
      const x = layers[id];
      if (!x) return;
      [...x.neighbors, x.poly, x.pin].forEach((o) => o.setMap(null));
      delete layers[id];
    },
    fit(points) {
      const b = new nm.LatLngBounds(ll(points[0]), ll(points[0]));
      points.forEach((p) => b.extend(ll(p)));
      map.fitBounds(b, { top: 70, right: 70, bottom: 70, left: 70 });
    },
    flyTo(lat, lon, zoom) {
      const c = ll([lat, lon]);
      if (reduceMotion) { map.setCenter(c); map.setZoom(zoom); }
      else map.morph(c, zoom, { duration: 700 });
    },
    onClick(cb) {
      nm.Event.addListener(map, "click", (e) => { if (!suppressMapClick) cb(e.coord.lat(), e.coord.lng()); });
    },
    destroy() {
      try { map.destroy(); } catch { /* 인증 실패 상태에서는 destroy가 실패할 수 있음 */ }
      el.innerHTML = "";
    },
  };
}

// ---------------------------------------------------------------------------
function LeafletView(el) {
  const map = L.map(el, { zoomControl: false });
  L.control.zoom({ position: "bottomright" }).addTo(map);
  const bases = {
    sat: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19, attribution: "Esri World Imagery (대체 지도)",
    }),
    base: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: "© OpenStreetMap (대체 지도)",
    }),
  };
  let active = "sat";
  bases.sat.addTo(map);
  let tileFailed = false;
  Object.values(bases).forEach((layer) => layer.on("tileerror", () => {
    if (tileFailed) return;
    tileFailed = true;
    el.classList.add("no-tiles");
    showMapNote("배경지도를 불러오지 못했습니다 · 실서비스는 네이버/VWorld 지도");
  }));
  const layers = {};

  return {
    kind: "leaflet",
    bases: ["sat", "base"],
    setBase(k) {
      if (k === active) return;
      map.removeLayer(bases[active]);
      active = k;
      bases[active].addTo(map).bringToBack();
    },
    toggleCadastral() {},
    addField(f, onSelect) {
      const group = L.layerGroup().addTo(map);
      forNeighbors((i, j, s) => L.polygon(parcel(f, i, j, s), { className: "nb-parcel", interactive: false }).addTo(group));
      const poly = L.polygon(parcel(f, 0, 0), { className: "field-parcel", bubblingMouseEvents: false }).addTo(group);
      poly.on("click", () => onSelect(f.id, false));
      const pin = L.marker([f.lat, f.lon], { keyboard: false }).addTo(group);
      pin.on("click", () => onSelect(f.id, true));
      layers[f.id] = { group, poly, pin };
    },
    updateField(f, status, score, selected) {
      const x = layers[f.id];
      if (!x) return;
      const path = x.poly.getElement();
      if (path) {
        path.setAttribute("class", `leaflet-interactive field-parcel${selected ? " is-selected" : ""}`);
        path.setAttribute("data-s", status);
      }
      if (selected) x.poly.bringToFront();
      x.pin.setIcon(L.divIcon({ className: "pin-host", iconSize: null, html: pinHtml(f, status, score, selected) }));
      x.pin.setZIndexOffset(selected ? 1000 : 0);
    },
    removeField(id) {
      layers[id]?.group.remove();
      delete layers[id];
    },
    fit(points) { map.fitBounds(L.latLngBounds(points).pad(0.2), { animate: !reduceMotion }); },
    flyTo(lat, lon, zoom) {
      if (reduceMotion) map.setView([lat, lon], zoom);
      else map.flyTo([lat, lon], zoom, { duration: 0.8 });
    },
    onClick(cb) { map.on("click", (e) => cb(e.latlng.lat, e.latlng.lng)); },
    destroy() { map.remove(); el.innerHTML = ""; el.classList.remove("no-tiles"); },
  };
}

function createMapView(el) {
  if (new URLSearchParams(location.search).get("map") === "naver" && window.naver?.maps?.Map) {
    try {
      return NaverView(el);
    } catch (e) {
      console.warn("네이버 지도 초기화 실패 — 대체 지도 사용", e);
    }
  }
  return LeafletView(el);
}
