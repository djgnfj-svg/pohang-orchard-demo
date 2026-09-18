// ---------------------------------------------------------------------------
// GFS 바람장 시각화 — Open-Meteo에서 격자 형태로 여러 점을 받아 leaflet-velocity 형식으로 변환
// ---------------------------------------------------------------------------

// 지도 화면 범위를 steps x steps 격자로 쪼개 각 점의 위경도 반환
function windGridPoints(bounds, steps = 6) {
  const { _southWest: sw, _northEast: ne } = bounds;
  const points = [];
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < steps; j++) {
      points.push({
        lat: sw.lat + ((ne.lat - sw.lat) * i) / (steps - 1),
        lon: sw.lng + ((ne.lng - sw.lng) * j) / (steps - 1),
      });
    }
  }
  return points;
}

// 각 격자점의 현재 풍속·풍향을 Open-Meteo에서 받아온다 (current_weather로 응답 최소화)
// 각 격자점의 현재 풍속·풍향을 Open-Meteo에서 받아온다 (current_weather로 응답 최소화)
async function fetchWindPoint(lat, lon) {
  const params = new URLSearchParams({ latitude: lat, longitude: lon, current_weather: "true", models: "gfs_seamless" });
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const j = await r.json();
    return j.current_weather ?? null; // { windspeed(km/h), winddirection(도), ... }
  } catch {
    return null; // 개별 지점 실패(타임아웃·네트워크 오류 등)는 무시 — toVelocityData가 null을 풍속 0으로 처리
  }
}

// leaflet-velocity가 요구하는 [u성분, v성분] 두 개의 격자 데이터로 변환
function toVelocityData(points, results, steps, bounds) {
  const { _southWest: sw, _northEast: ne } = bounds;
  const header = {
    parameterUnit: "m.s-1", nx: steps, ny: steps,
    lo1: sw.lng, la1: ne.lat, lo2: ne.lng, la2: sw.lat,
    dx: (ne.lng - sw.lng) / (steps - 1), dy: (ne.lat - sw.lat) / (steps - 1),
    refTime: new Date().toISOString(),
  };
  const u = [], v = [];
  // leaflet-velocity는 북서→남동 순서(위→아래, 왼→오)로 데이터를 기대
  for (let i = steps - 1; i >= 0; i--) {
    for (let j = 0; j < steps; j++) {
      const res = results[i * steps + j];
      const speedMs = res ? (res.windspeed * 1000) / 3600 : 0; // km/h → m/s
      const rad = ((res?.winddirection ?? 0) * Math.PI) / 180;
      u.push(-speedMs * Math.sin(rad)); // 풍향은 "불어오는 방향" 기준이라 부호 반전
      v.push(-speedMs * Math.cos(rad));
    }
  }
  return [
    { header: { ...header, parameterCategory: 2, parameterNumber: 2 }, data: u },
    { header: { ...header, parameterCategory: 2, parameterNumber: 3 }, data: v },
  ];
}

// 지도 화면 범위 전체를 대상으로 바람장을 받아와 반환. steps^2번 호출되니 5~6 정도가 적당
async function loadWindField(bounds, steps = 6) {
  const points = windGridPoints(bounds, steps);
  const results = await Promise.all(points.map((p) => fetchWindPoint(p.lat, p.lon)));
  return toVelocityData(points, results, steps, bounds);
}