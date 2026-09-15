// ---------------------------------------------------------------------------
// 공공데이터포털 실데이터 — 기상청 실황·단기예보·중기예보·특보, 팜맵 토양검정·병해충발생
// 서비스키는 중계 Worker(PROXY_URL)에만 있다. 이 파일은 Worker로만 호출한다.
// 팜맵 농업기상은 2025년 자료까지만 조회돼(2026년은 NODATA) 현재 판단용으로 쓰지 않는다.
// ---------------------------------------------------------------------------
const pad2 = (n) => String(n).padStart(2, "0");

// 한국시간(KST) 기준 날짜·시각. offsetMin만큼 앞뒤로 이동
function kst(offsetMin = 0) {
  const d = new Date(Date.now() + 9 * 3600e3 + offsetMin * 60e3);
  const ym = `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}`;
  return { ymd: `${ym}${pad2(d.getUTCDate())}`, ym, hour: d.getUTCHours() };
}
function ymdShift(ymd, days) {
  const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8) + days));
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
}
function dayLabel(ymd) {
  const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)));
  return `${+ymd.slice(4, 6)}/${+ymd.slice(6, 8)}(${"일월화수목금토"[d.getUTCDay()]})`;
}
const timeLabel = (ymd, hm) => `${+ymd.slice(4, 6)}/${+ymd.slice(6, 8)} ${hm.slice(0, 2)}시`;
const dotDate = (s) => (s ? `${String(s).slice(0, 4)}.${String(s).slice(4, 6)}.${String(s).slice(6, 8)}` : "");

// 위경도 → 기상청 동네예보 격자 (Lambert 정각원추도법, 기상청 활용가이드 공식)
function kmaGrid(lat, lon) {
  const RE = 6371.00877, GRID = 5.0, SLAT1 = 30.0, SLAT2 = 60.0, OLON = 126.0, OLAT = 38.0, XO = 43, YO = 136;
  const D = Math.PI / 180, re = RE / GRID;
  const s1 = SLAT1 * D, s2 = SLAT2 * D, olon = OLON * D, olat = OLAT * D;
  const sn = Math.log(Math.cos(s1) / Math.cos(s2)) / Math.log(Math.tan(Math.PI / 4 + s2 / 2) / Math.tan(Math.PI / 4 + s1 / 2));
  const sf = (Math.tan(Math.PI / 4 + s1 / 2) ** sn * Math.cos(s1)) / sn;
  const ro = (re * sf) / Math.tan(Math.PI / 4 + olat / 2) ** sn;
  const ra = (re * sf) / Math.tan(Math.PI / 4 + lat * D / 2) ** sn;
  let th = lon * D - olon;
  if (th > Math.PI) th -= 2 * Math.PI;
  if (th < -Math.PI) th += 2 * Math.PI;
  th *= sn;
  return [Math.floor(ra * Math.sin(th) + XO + 0.5), Math.floor(ro - ra * Math.cos(th) + YO + 0.5)];
}

// Worker 호출 → item 배열. 자료 없음(NODATA)은 빈 배열, 그 밖의 오류는 예외
async function pdCall(path, params) {
  const r = await fetch(PROXY_URL + path + "?" + new URLSearchParams(params), { signal: AbortSignal.timeout(15000) });
  const text = await r.text();
  if (/^\s*</.test(text)) {
    const msg = text.match(/<(?:resultMsg|returnAuthMsg)>([^<]*)</)?.[1] || `응답 오류 (${r.status})`;
    if (/NODATA/.test(msg)) return [];
    throw new Error(msg);
  }
  let j;
  try { j = JSON.parse(text); } catch { throw new Error(`응답 오류 (${r.status})`); }
  if (j.error) throw new Error(j.error);
  const gw = j.OpenAPI_ServiceResponse?.cmmMsgHeader;
  if (gw) throw new Error(gw.returnAuthMsg || gw.errMsg || "게이트웨이 오류");
  const head = j.response?.header;
  if (head && !/NORMAL/.test(head.resultMsg)) {
    if (/NODATA/.test(head.resultMsg)) return [];
    throw new Error(head.resultMsg);
  }
  const it = j.response?.body?.items?.item ?? [];
  return Array.isArray(it) ? it : [it];
}

// 같은 요청은 ttl(분) 동안 한 번만
const pdCache = new Map();
function cached(key, ttlMin, fn) {
  const hit = pdCache.get(key);
  if (hit && Date.now() - hit.t < ttlMin * 60e3) return hit.promise;
  const promise = fn().catch((e) => { pdCache.delete(key); throw e; });
  pdCache.set(key, { t: Date.now(), promise });
  return promise;
}

const PTY = { 0: "없음", 1: "비", 2: "비/눈", 3: "눈", 4: "소나기", 5: "빗방울", 6: "빗방울눈날림", 7: "눈날림" };
const SKY = { 1: "맑음", 3: "구름많음", 4: "흐림" };
const KMA = "1360000/";

// 초단기실황: 정시 관측, 발표 직후엔 비어 있을 수 있어 한 시간 전까지 시도
function loadNow(lat, lon) {
  const [nx, ny] = kmaGrid(lat, lon);
  return cached(`now:${nx},${ny}:${kst(-15).ymd}${kst(-15).hour}`, 10, async () => {
    for (const back of [15, 75]) {
      const t = kst(-back);
      const base = { base_date: t.ymd, base_time: `${pad2(t.hour)}00` };
      const rows = await pdCall(`${KMA}VilageFcstInfoService_2.0/getUltraSrtNcst`, { dataType: "JSON", numOfRows: "20", pageNo: "1", nx, ny, ...base });
      if (!rows.length) continue;
      // 바다 등 관측이 없는 격자는 -998.9 같은 결측값이 온다
      const v = Object.fromEntries(rows.map((r) => [r.category, +r.obsrValue <= -900 ? "" : r.obsrValue]));
      if (v.T1H === "") throw new Error("이 위치 격자에는 관측값이 없습니다 (바다 등)");
      return { nx, ny, at: timeLabel(base.base_date, base.base_time), temp: v.T1H, hum: v.REH, wind: v.WSD, rain: v.RN1, pty: PTY[v.PTY] ?? v.PTY };
    }
    throw new Error("관측 자료가 아직 없습니다");
  });
}

const pcpMm = (v) => (!v || v === "강수없음" ? 0 : /미만/.test(v) ? 0.5 : parseFloat(v) || 0);
const mostCommon = (arr) => {
  const c = {};
  arr.forEach((x) => { c[x] = (c[x] || 0) + 1; });
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0];
};

// 단기예보: 02·05·…·23시 발표, 발표 후 10분부터 조회
function loadShort(lat, lon) {
  const [nx, ny] = kmaGrid(lat, lon);
  const t = kst(-15);
  const hours = [2, 5, 8, 11, 14, 17, 20, 23].filter((h) => h <= t.hour);
  const base = hours.length
    ? { base_date: t.ymd, base_time: `${pad2(hours.at(-1))}00` }
    : { base_date: ymdShift(t.ymd, -1), base_time: "2300" };
  return cached(`short:${nx},${ny}:${base.base_date}${base.base_time}`, 30, async () => {
    const rows = await pdCall(`${KMA}VilageFcstInfoService_2.0/getVilageFcst`, { dataType: "JSON", numOfRows: "1000", pageNo: "1", nx, ny, ...base });
    const slotMap = new Map();
    rows.forEach((r) => {
      const k = r.fcstDate + r.fcstTime;
      if (!slotMap.has(k)) slotMap.set(k, { date: r.fcstDate, time: r.fcstTime });
      slotMap.get(k)[r.category] = +r.fcstValue <= -900 ? "" : r.fcstValue; // 결측값(-998.9 등)은 빈 값
    });
    const slots = [...slotMap.values()].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    if (!slots.length) throw new Error("예보 자료가 없습니다");
    const dates = [...new Set(slots.map((s) => s.date))].filter((d) => slots.filter((s) => s.date === d).length >= 6);
    const days = dates.map((date) => {
      const ds = slots.filter((s) => s.date === date);
      const temps = ds.filter((s) => s.TMP !== "" && s.TMP != null).map((s) => +s.TMP);
      const tmn = ds.find((s) => s.TMN)?.TMN, tmx = ds.find((s) => s.TMX)?.TMX;
      const wet = ds.find((s) => s.PTY && s.PTY !== "0");
      return {
        ymd: date, label: dayLabel(date),
        min: tmn ? Math.round(+tmn) : temps.length ? Math.round(Math.min(...temps)) : null,
        max: tmx ? Math.round(+tmx) : temps.length ? Math.round(Math.max(...temps)) : null,
        pop: Math.max(...ds.map((s) => +s.POP || 0)),
        rain: ds.reduce((a, s) => a + pcpMm(s.PCP), 0),
        sky: wet ? PTY[wet.PTY] ?? "비" : SKY[mostCommon(ds.map((s) => s.SKY))] ?? "–",
      };
    });
    const nextRain = slots.find((s) => s.PTY && s.PTY !== "0");
    return {
      base: timeLabel(base.base_date, base.base_time), nx, ny, days,
      nextRain: nextRain ? { at: timeLabel(nextRain.date, nextRain.time), pop: nextRain.POP, kind: PTY[nextRain.PTY] ?? "비" } : null,
      maxWind24: Math.max(...slots.slice(0, 24).map((s) => +s.WSD || 0)),
    };
  });
}

// 중기예보: 06·18시 발표. 육상(대구·경북 11H10000) + 기온(포항 11H10201)
function loadMid() {
  const t = kst(-30);
  const tmFc = t.hour >= 18 ? `${t.ymd}1800` : t.hour >= 6 ? `${t.ymd}0600` : `${ymdShift(t.ymd, -1)}1800`;
  return cached(`mid:${tmFc}`, 60, async () => {
    const q = { dataType: "JSON", numOfRows: "10", pageNo: "1", tmFc };
    const [land, ta] = await Promise.all([
      pdCall(`${KMA}MidFcstInfoService/getMidLandFcst`, { ...q, regId: "11H10000" }),
      pdCall(`${KMA}MidFcstInfoService/getMidTa`, { ...q, regId: "11H10201" }),
    ]);
    const L = land[0] || {}, T = ta[0] || {};
    const baseYmd = tmFc.slice(0, 8);
    const days = [];
    for (let n = 3; n <= 10; n++) {
      if (T[`taMin${n}`] == null && T[`taMax${n}`] == null) continue;
      const am = L[`wf${n}Am`] ?? L[`wf${n}`], pm = L[`wf${n}Pm`] ?? L[`wf${n}`];
      const pop = Math.max(+(L[`rnSt${n}Am`] ?? L[`rnSt${n}`]) || 0, +(L[`rnSt${n}Pm`] ?? L[`rnSt${n}`]) || 0);
      const ymd = ymdShift(baseYmd, n);
      days.push({ ymd, label: dayLabel(ymd), min: T[`taMin${n}`], max: T[`taMax${n}`], sky: am === pm ? am : `${am}→${pm}`, pop });
    }
    return { base: timeLabel(baseYmd, tmFc.slice(8)), days };
  });
}

// 기상특보 현황(전국 발표문)에서 포항이 들어간 줄만
function loadWarn() {
  return cached("warn", 10, async () => {
    const rows = await pdCall(`${KMA}WthrWrnInfoService/getPwnStatus`, { dataType: "JSON", numOfRows: "10", pageNo: "1" });
    const r = rows[0] || {};
    const pick = (s) => String(s || "").split(/\r?\n/).map((x) => x.replace(/^o\s*/, "").trim()).filter((x) => x.includes("포항"));
    const fc = String(r.tmFc || "");
    return { at: fc ? timeLabel(fc.slice(0, 8), fc.slice(8, 12)) : "", active: pick(r.t6), pre: pick(r.t7) };
  });
}

// 팜맵 토양검정 (PNU → 그 PNU가 속한 팜맵 필지의 시료)
function loadSoil(pnu) {
  return cached(`soil:${pnu}`, 24 * 60, async () => {
    const rows = await pdCall("B552895/rest/farmmap/getFarmmapSoilAnalysisService/getPnuBasedSoilAnalsInfo", { type: "json", numOfRows: "20", pageNo: "1", pnuCode: pnu });
    return rows
      .sort((a, b) => String(b.stDe).localeCompare(String(a.stDe)))
      .slice(0, 3)
      .map((r) => ({ date: dotDate(r.stDe), sample: r.splTynm || r.intprNm || "", pH: r.acidity, om: r.ormtCont, p: r.vdphdy, ec: r.elcd, samePnu: r.pnuLnmCd === pnu }));
  });
}

// 팜맵 병해충발생 (PNU 주변 관찰포 예찰, 월 단위 · 이번 달 없으면 지난달). 가장 최근 입력일 것만
function loadPest(pnu) {
  const now = kst();
  const prev = ymdShift(`${now.ym}01`, -1).slice(0, 6);
  return cached(`pest:${pnu}:${now.ym}`, 6 * 60, async () => {
    for (const month of [now.ym, prev]) {
      const rows = await pdCall("B552895/rest/farmmap/getFarmmapDbyhsService/getPnuBasedMonthDbyhsInfo", { type: "json", numOfRows: "100", pageNo: "1", pnuCode: pnu, month, yearCount: "1" });
      if (!rows.length) continue;
      const latest = rows.map((r) => String(r.inptDe)).sort().at(-1);
      const seen = new Set();
      const list = rows.filter((r) => String(r.inptDe) === latest)
        .map((r) => ({ crop: r.crpTynm, name: r.dbyhsNm, value: r.iqVl, kind: r.prdCfnm }))
        .filter((r) => { const k = `${r.crop}|${r.name}|${r.value}`; return !seen.has(k) && seen.add(k); }) // 같은 날 여러 조사점의 같은 값은 한 줄로
        .sort((a, b) => (b.crop === "사과") - (a.crop === "사과") || (+b.value || 0) - (+a.value || 0));
      return { date: dotDate(latest), rows: list };
    }
    return { date: "", rows: [] };
  });
}

// ---------------------------------------------------------------------------
// 선택한 필지에 필요한 자료를 한 번씩 불러오고, 끝나면 상세 패널을 다시 그림
// ---------------------------------------------------------------------------
function ensurePublicData(p) {
  p.pd ??= {};
  const start = (key, fn) => {
    if (p.pd[key]) return;
    p.pd[key] = { status: "loading" };
    fn()
      .then((data) => { p.pd[key] = { status: "ok", data }; })
      .catch((e) => { p.pd[key] = { status: "error", error: e.message }; })
      .finally(() => { if (current() === p) renderDetail(); });
  };
  start("now", () => loadNow(p.lat, p.lon));
  start("short", () => loadShort(p.lat, p.lon));
  start("mid", loadMid);
  start("warn", loadWarn);
  if (p.status === "ok" && p.pnu) {
    start("soil", () => loadSoil(p.pnu));
    start("pest", () => loadPest(p.pnu));
  }
}

const val = (v) => (v === "" || v == null ? "–" : v);

function pdSection(title, srcKeys, st, body) {
  const head = `<div class="d-sec-head"><h3>${title}</h3><span>${srcKeys.map(src).join("")}</span></div>`;
  const inner = !st || st.status === "loading" ? '<p class="d-empty">불러오는 중…</p>'
    : st.status === "error" ? `<p class="d-empty">불러오지 못했습니다 · ${esc(st.error)}</p>`
    : body(st.data);
  return `<div class="d-data">${head}${inner}</div>`;
}

function renderPublicData(p) {
  const pd = p.pd || {};
  const parts = [];

  parts.push(pdSection("지금 날씨", ["kmaNow"], pd.now, (d) => `
    <div class="wx">
      <div><span class="wx-v">${val(d.temp)}<small>℃</small></span><span class="wx-l">기온</span></div>
      <div><span class="wx-v">${val(d.hum)}<small>%</small></span><span class="wx-l">습도</span></div>
      <div><span class="wx-v">${val(d.wind)}<small>m/s</small></span><span class="wx-l">풍속</span></div>
      <div><span class="wx-v">${val(d.rain)}<small>mm</small></span><span class="wx-l">1시간 강수</span></div>
    </div>
    <p class="d-note">${esc(d.at)} 관측 · 강수형태 ${esc(d.pty)} · 격자 ${d.nx},${d.ny}</p>`));

  parts.push(pdSection("예보", ["kmaShort", "kmaMid"], pd.short, (s) => {
    const lastShort = s.days.at(-1)?.ymd ?? "";
    const mid = pd.mid?.status === "ok" ? pd.mid.data.days.filter((d) => d.ymd > lastShort) : [];
    const rows = [...s.days, ...mid];
    return `<div class="scroll-x"><table class="data-table">
        <thead><tr><th>날짜</th><th>날씨</th><th>최저 / 최고</th><th>강수확률</th></tr></thead>
        <tbody>${rows.map((d, i) => `<tr${i === s.days.length ? ' class="mid-start"' : ""}>
          <td>${d.label}</td><td>${esc(d.sky)}</td><td class="mono">${val(d.min)}° / ${val(d.max)}°</td><td class="mono">${d.pop}%</td>
        </tr>`).join("")}</tbody>
      </table></div>
      <p class="d-note">${s.nextRain ? `다음 ${esc(s.nextRain.kind)} ${esc(s.nextRain.at)} (강수확률 ${s.nextRain.pop}%)` : "단기예보 기간에 비 소식 없음"} · 앞으로 24시간 최대풍속 ${s.maxWind24}m/s</p>
      <p class="d-note">${esc(s.days[0]?.label ?? "")}~${esc(s.days.at(-1)?.label ?? "")} 단기예보 ${esc(s.base)} 발표(이 위치 격자)${mid.length ? ` · 이후 중기예보 ${esc(pd.mid.data.base)} 발표(포항)` : pd.mid?.status === "loading" ? " · 중기예보 불러오는 중" : ""}</p>`;
  }));

  parts.push(pdSection("기상특보", ["kmaWarn"], pd.warn, (w) => {
    const list = [...w.active.map((x) => ["발효", x]), ...w.pre.map((x) => ["예비", x])];
    return (list.length
      ? `<ul class="warn-list">${list.map(([k, x]) => `<li><b>${k}</b> ${esc(x)}</li>`).join("")}</ul>`
      : '<p class="d-empty">포항 관련 발효·예비특보 없음</p>') + `<p class="d-note">${esc(w.at)} 발표 기준</p>`;
  }));

  if (p.status === "ok") {
    parts.push(pdSection("토양검정", ["soil"], pd.soil, (rows) => (rows.length
      ? `<div class="scroll-x"><table class="data-table">
          <thead><tr><th>채취일</th><th>pH</th><th>유기물<small>g/kg</small></th><th>유효인산<small>mg/kg</small></th><th>EC<small>dS/m</small></th></tr></thead>
          <tbody>${rows.map((r) => `<tr><td>${r.date}<small>${esc(r.sample)}</small></td><td class="mono">${val(r.pH)}</td><td class="mono">${val(r.om)}</td><td class="mono">${val(r.p)}</td><td class="mono">${val(r.ec)}</td></tr>`).join("")}</tbody>
        </table></div>${rows.some((r) => !r.samePnu) ? '<p class="d-note">같은 팜맵 필지에 속한 다른 지번의 시료가 포함돼 있습니다</p>' : ""}`
      : '<p class="d-empty">이 필지의 토양검정 기록이 없습니다</p>')));

    parts.push(pdSection("병해충 예찰", ["pest"], pd.pest, (d) => (d.rows.length
      ? `<p class="d-note">인근 관찰포 조사 · ${esc(d.date)} 입력</p>
        <div class="scroll-x"><table class="data-table">
          <thead><tr><th>작물</th><th>병해충</th><th>조사값</th></tr></thead>
          <tbody>${d.rows.slice(0, 8).map((r) => `<tr><td>${esc(r.crop)}</td><td>${esc(r.name)}</td><td class="mono">${val(r.value)}</td></tr>`).join("")}</tbody>
        </table></div>${d.rows.length > 8 ? `<p class="d-note">외 ${d.rows.length - 8}건</p>` : ""}`
      : '<p class="d-empty">인근 관찰포 예찰 기록이 없습니다</p>')));
  }
  return parts.join("");
}
