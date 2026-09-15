// ---------------------------------------------------------------------------
// 지도 어댑터 — 기본은 Leaflet + VWorld(위성·일반·지적도). ?map=naver면 네이버 지도.
// app.js는 이 인터페이스만 사용: addField / updateField / removeField / fit / flyTo / onClick / resize / setBase / toggleCadastral / setRobotMap
// 필지 경계는 VWorld 연속지적도에서 받아 p.rings에 채운 것만 그린다 (아직 없으면 핀만)
// ---------------------------------------------------------------------------
const PARCEL_HEX = "#72b9bf";
const ROBOT_PATH_HEX = "#ff8a3d";
const ROBOT_FENCE_HEX = "#5fb0ff";
const HOME = { center: [36.13, 129.25], zoom: 11 }; // 포항시 북구 일대

function pinHtml(p, selected) {
  return `<div class="pin-wrap"><div class="pin${selected ? " is-selected" : ""}">${esc(p.label)}</div></div>`;
}

// 로봇 웨이포인트 연결선 [[위도, 경도] ×2] 목록과 홈 노드 위치
function robotRoute(rm) {
  const at = Object.fromEntries(rm.route.nodes.map(([id, lat, lon]) => [id, [lat, lon]]));
  return { lines: rm.route.edges.map(([a, b]) => [at[a], at[b]]), home: at[rm.route.home] };
}
const ROBOT_HOME_HTML = '<div class="pin-wrap"><div class="robot-home">홈</div></div>';

// ---------------------------------------------------------------------------
function NaverView(el) {
  const nm = naver.maps;
  const map = new nm.Map(el, {
    center: new nm.LatLng(...HOME.center),
    zoom: HOME.zoom,
    mapTypeId: nm.MapTypeId.HYBRID,
    zoomControl: true,
    zoomControlOptions: { position: nm.Position.BOTTOM_RIGHT, style: nm.ZoomControlStyle.SMALL },
    scaleControl: false,
    mapDataControl: false,
  });
  const cadastral = new nm.CadastralLayer();
  const layers = {};
  const robot = {}; // 로봇 맵 id → { lidar: [...], route: [...] }
  const ll = ([lat, lon]) => new nm.LatLng(lat, lon);
  let suppressMapClick = false; // 필지·핀 클릭이 지도 클릭으로 이어지지 않게
  const swallow = () => { suppressMapClick = true; setTimeout(() => { suppressMapClick = false; }, 0); };

  return {
    kind: "naver",
    raw: map,
    bases: ["sat", "base", "cadastral"],
    setBase(k) { map.setMapTypeId(k === "base" ? nm.MapTypeId.NORMAL : nm.MapTypeId.HYBRID); },
    toggleCadastral(on) { cadastral.setMap(on ? map : null); },
    addField(p, onSelect) {
      const polys = (p.rings ?? []).map((ring) => new nm.Polygon({
        map, paths: [ring.map(ll)], clickable: true, zIndex: 10,
        strokeColor: "#ffffff", strokeWeight: 2, fillColor: PARCEL_HEX, fillOpacity: 0.28,
      }));
      const pin = new nm.Marker({ map, position: ll([p.lat, p.lon]), zIndex: 100, icon: { content: "<div></div>", anchor: new nm.Point(0, 0) } });
      polys.forEach((poly) => nm.Event.addListener(poly, "click", () => { swallow(); onSelect(p.id, false); }));
      nm.Event.addListener(pin, "click", () => { swallow(); onSelect(p.id, true); });
      layers[p.id] = { polys, pin };
    },
    updateField(p, selected) {
      const x = layers[p.id];
      if (!x) return;
      x.polys.forEach((poly) => poly.setOptions({ fillOpacity: selected ? 0.45 : 0.28, strokeWeight: selected ? 3.5 : 2, zIndex: selected ? 20 : 10 }));
      x.pin.setIcon({ content: pinHtml(p, selected), anchor: new nm.Point(0, 0) });
      x.pin.setZIndex(selected ? 1000 : 100);
    },
    removeField(id) {
      const x = layers[id];
      if (!x) return;
      [...x.polys, x.pin].forEach((o) => o.setMap(null));
      delete layers[id];
    },
    fit(points) {
      if (!points.length) { map.setCenter(ll(HOME.center)); map.setZoom(HOME.zoom); return; }
      const b = new nm.LatLngBounds(ll(points[0]), ll(points[0]));
      points.forEach((pt) => b.extend(ll(pt)));
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
    resize() { map.setSize(new nm.Size(el.clientWidth, el.clientHeight)); },
    setRobotMap(rm, show) {
      if (!robot[rm.id]) {
        const { lines, home } = robotRoute(rm);
        const [sw, ne] = rm.lidar.bounds;
        robot[rm.id] = {
          lidar: [new nm.GroundOverlay(rm.lidar.image, new nm.LatLngBounds(ll(sw), ll(ne)))],
          route: [
            ...rm.fences.map((f) => new nm.Polygon({ paths: [f.ring.map(ll)], clickable: false, strokeColor: ROBOT_FENCE_HEX, strokeWeight: 2, strokeStyle: "shortdash", fillOpacity: 0 })),
            ...lines.map((line) => new nm.Polyline({ path: line.map(ll), clickable: false, strokeColor: ROBOT_PATH_HEX, strokeWeight: 2.5 })),
            new nm.Marker({ position: ll(home), clickable: false, zIndex: 50, icon: { content: ROBOT_HOME_HTML, anchor: new nm.Point(0, 0) } }),
          ],
        };
      }
      const x = robot[rm.id];
      x.lidar.forEach((o) => o.setMap(show.lidar ? map : null));
      x.route.forEach((o) => o.setMap(show.route ? map : null));
    },
    destroy() {
      try { map.destroy(); } catch { /* 인증 실패 상태에서는 destroy가 실패할 수 있음 */ }
      el.innerHTML = "";
    },
  };
}

// ---------------------------------------------------------------------------
// VWorld WMTS 타일: /{layer}/{z}/{row}/{col} — Satellite(jpeg)·Hybrid(라벨)·Base, 줌 6~19
// VWorld 키가 없으면 Esri 위성 / OSM으로 대체
function LeafletView(el) {
  const map = L.map(el, { zoomControl: false, minZoom: 7, maxZoom: 19 });
  L.control.zoom({ position: "bottomright" }).addTo(map);
  const hasKey = typeof VWORLD_KEY === "string" && !!VWORLD_KEY;
  const vw = (layer, ext, zIndex) => L.tileLayer(`https://api.vworld.kr/req/wmts/1.0.0/${VWORLD_KEY}/${layer}/{z}/{y}/{x}.${ext}`, {
    maxZoom: 19, maxNativeZoom: 19, zIndex, attribution: "© VWorld",
  });
  const tiles = hasKey
    ? { sat: [vw("Satellite", "jpeg", 1), vw("Hybrid", "png", 2)], base: [vw("Base", "png", 1)] }
    : {
      sat: [L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "Esri World Imagery (대체 지도)" })],
      base: [L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap (대체 지도)" })],
    };
  // 연속지적도 선 (WMS) — 필지가 구분되는 줌 15 이상에서만 요청
  const cadastral = hasKey ? L.tileLayer.wms("https://api.vworld.kr/req/wms", {
    layers: "lp_pa_cbnd_bubun,lp_pa_cbnd_bonbun", styles: "lp_pa_cbnd_bubun_line,lp_pa_cbnd_bonbun_line",
    format: "image/png", transparent: true, version: "1.3.0",
    key: VWORLD_KEY, domain: location.hostname || "localhost",
    minZoom: 15, maxZoom: 19, zIndex: 3,
  }) : null;

  let active = "sat";
  tiles.sat.forEach((t) => t.addTo(map));
  let tileFailed = false;
  Object.values(tiles).flat().forEach((layer) => layer.on("tileerror", () => {
    if (tileFailed) return;
    tileFailed = true;
    el.classList.add("no-tiles");
    showMapNote("배경지도 일부를 불러오지 못했습니다");
  }));
  const layers = {};
  // 로봇 라이다 영상·주행 경로는 필지 채우기(400) 위, 핀(600) 아래. 둘 다 클릭은 아래 필지로 통과
  map.createPane("robot-lidar").style.zIndex = 410;
  map.createPane("robot-route").style.zIndex = 450;
  map.getPane("robot-route").style.pointerEvents = "none";
  const robot = {};

  return {
    kind: "leaflet",
    bases: cadastral ? ["sat", "base", "cadastral"] : ["sat", "base"],
    setBase(k) {
      if (k === active) return;
      tiles[active].forEach((t) => map.removeLayer(t));
      active = k;
      tiles[active].forEach((t) => t.addTo(map));
    },
    toggleCadastral(on) {
      if (!cadastral) return;
      if (on) cadastral.addTo(map);
      else cadastral.remove();
    },
    addField(p, onSelect) {
      const group = L.layerGroup().addTo(map);
      const polys = (p.rings ?? []).map((ring) => L.polygon(ring, { className: "field-parcel", bubblingMouseEvents: false }).addTo(group));
      polys.forEach((poly) => poly.on("click", () => onSelect(p.id, false)));
      const pin = L.marker([p.lat, p.lon], { keyboard: false }).addTo(group);
      pin.on("click", () => onSelect(p.id, true));
      layers[p.id] = { group, polys, pin };
    },
    updateField(p, selected) {
      const x = layers[p.id];
      if (!x) return;
      x.polys.forEach((poly) => {
        poly.getElement()?.setAttribute("class", `leaflet-interactive field-parcel${selected ? " is-selected" : ""}`);
        if (selected) poly.bringToFront();
      });
      x.pin.setIcon(L.divIcon({ className: "pin-host", iconSize: null, html: pinHtml(p, selected) }));
      x.pin.setZIndexOffset(selected ? 1000 : 0);
    },
    removeField(id) {
      layers[id]?.group.remove();
      delete layers[id];
    },
    fit(points) {
      if (!points.length) return map.setView(HOME.center, HOME.zoom);
      if (points.length === 1) return map.setView(points[0], 16);
      map.fitBounds(L.latLngBounds(points).pad(0.2), { animate: !reduceMotion });
    },
    flyTo(lat, lon, zoom) {
      if (reduceMotion) map.setView([lat, lon], zoom);
      else map.flyTo([lat, lon], zoom, { duration: 0.8 });
    },
    onClick(cb) { map.on("click", (e) => cb(e.latlng.lat, e.latlng.lng)); },
    resize() { map.invalidateSize(); },
    setRobotMap(rm, show) {
      if (!robot[rm.id]) {
        const { lines, home } = robotRoute(rm);
        const pane = "robot-route";
        robot[rm.id] = {
          lidar: L.imageOverlay(rm.lidar.image, rm.lidar.bounds, { pane: "robot-lidar" }),
          route: L.layerGroup([
            ...rm.fences.map((f) => L.polygon(f.ring, { pane, className: "robot-fence", interactive: false })),
            L.polyline(lines, { pane, className: "robot-path", interactive: false }),
            L.marker(home, { pane, interactive: false, keyboard: false, icon: L.divIcon({ className: "pin-host", iconSize: null, html: ROBOT_HOME_HTML }) }),
          ]),
        };
      }
      const x = robot[rm.id];
      if (show.lidar) x.lidar.addTo(map);
      else x.lidar.remove();
      if (show.route) x.route.addTo(map);
      else x.route.remove();
    },
    destroy() { map.remove(); el.innerHTML = ""; el.classList.remove("no-tiles"); },
  };
}

function createMapView(el) {
  if (window.USE_NAVER_MAP && window.naver?.maps?.Map) {
    try {
      return NaverView(el);
    } catch (e) {
      console.warn("네이버 지도 초기화 실패 — 대체 지도 사용", e);
    }
  }
  return LeafletView(el);
}
