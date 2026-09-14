// ---------------------------------------------------------------------------
// 판단엔진 v0 (Risk Engine) — 공공데이터 입력을 0~100 점수로 바꾸는 규칙.
// 수치 기준은 데모용 초안이며, 실제 기준은 농진청 자료·현장 검증으로 확정해야 함.
// ---------------------------------------------------------------------------
const INDEXES = [
  { key: "spray", label: "방제", kind: "suit" },
  { key: "harvest", label: "수확", kind: "suit" },
  { key: "weed", label: "제초", kind: "suit" },
  { key: "irrigation", label: "관수", kind: "need" },
  { key: "robot", label: "로봇작업", kind: "suit" },
];

const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(v)));
const isNight = (hod, from = 6, to = 18) => hod < from || hod > to;
const sum = (arr, f) => arr.reduce((a, r) => a + f(r), 0);
const slice = (rows, a, b) => rows.slice(Math.max(0, a), Math.min(rows.length, b));

function hourLabel(h) {
  const d = new Date(BASE_DATE + "T00:00:00");
  d.setHours(d.getHours() + h);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}시`;
}

function daysBetween(isoA, h) {
  const a = new Date(isoA + "T00:00:00");
  const b = new Date(BASE_DATE + "T00:00:00");
  b.setHours(b.getHours() + h);
  return Math.floor((b - a) / 86400000);
}

// 강풍 예비특보: 16일 12시 ~ 20시
const alertActive = (h) => h >= 36 && h <= 44;

function statusOf(score, kind) {
  if (score === null) return { key: "na", label: "시기 아님" };
  if (kind === "need") {
    if (score >= 70) return { key: "warning", label: "필요" };
    if (score >= 40) return { key: "neutral", label: "검토" };
    return { key: "good", label: "불필요" };
  }
  if (score >= 70) return { key: "good", label: "적합" };
  if (score >= 40) return { key: "warning", label: "주의" };
  return { key: "critical", label: "부적합" };
}

// 각 규칙은 { score, factors: [근거 문구] } 반환
function rule(start = 100) {
  const factors = [];
  let score = start;
  return {
    add(delta, text) { if (delta) { score += delta; factors.push({ delta, text }); } },
    cap(max, text) { if (score > max) { factors.push({ delta: max - score, text }); score = max; } },
    done() { return { score: clamp(score), factors }; },
  };
}

const SCORERS = {
  spray(field, rows, t) {
    const r = rows[t], next6 = slice(rows, t, t + 6);
    const maxPop = Math.max(...next6.map((x) => x.pop));
    const maxWind = Math.max(...slice(rows, t, t + 3).map((x) => x.wind));
    const s = rule();
    if (r.pcp > 0) s.add(-90, "현재 강우");
    if (maxPop >= 60) s.add(-45, `6시간 내 강수확률 ${maxPop}%`);
    else if (maxPop >= 30) s.add(-20, `6시간 내 강수확률 ${maxPop}%`);
    if (maxWind > 4) s.add(-35, `풍속 ${maxWind}m/s (비산 위험)`);
    else if (maxWind > 3) s.add(-15, `풍속 ${maxWind}m/s`);
    if (r.temp > 30) s.add(-20, `고온 ${r.temp}℃ (약해)`);
    if (r.temp < 10) s.add(-20, `저온 ${r.temp}℃`);
    if (r.hum > 90) s.add(-10, `습도 ${r.hum}% (약액 건조 지연)`);
    if (field.harvestable) s.add(-30, "수확기 — 농약 안전사용기준(수확 전 일수) 확인");
    if (isNight(r.hod, 5, 19)) s.add(-30, "야간");
    if (alertActive(t)) s.cap(20, "강풍 예비특보");
    return s.done();
  },

  harvest(field, rows, t) {
    if (!field.harvestable) return { score: null, factors: [{ delta: 0, text: `${field.stage} — 수확 시기 아님` }] };
    const r = rows[t], next3 = slice(rows, t, t + 3);
    const maxPop = Math.max(...next3.map((x) => x.pop));
    const s = rule();
    if (r.pcp > 0) s.add(-60, "현재 강우 (과피 젖음)");
    if (maxPop >= 60) s.add(-35, `3시간 내 강수확률 ${maxPop}%`);
    else if (maxPop >= 30) s.add(-15, `3시간 내 강수확률 ${maxPop}%`);
    if (r.hum > 90) s.add(-20, `습도 ${r.hum}% (이슬)`);
    if (r.temp > 30) s.add(-15, `고온 ${r.temp}℃ (품온 상승)`);
    if (isNight(r.hod)) s.add(-50, "야간");
    return s.done();
  },

  weed(field, rows, t) {
    const r = rows[t];
    const rain12 = sum(slice(rows, t - 12, t), (x) => x.pcp);
    const s = rule();
    if (r.pcp > 0) s.add(-50, "현재 강우");
    if (rain12 > 2) s.add(-35, `최근 12시간 강우 ${rain12.toFixed(1)}mm (토양 젖음)`);
    if (r.pop >= 60) s.add(-25, `강수확률 ${r.pop}%`);
    if (r.temp > 31) s.add(-15, `고온 ${r.temp}℃`);
    if (field.harvestable) s.add(-20, "수확기 — 수확 작업 우선");
    if (isNight(r.hod)) s.add(-40, "야간");
    return s.done();
  },

  irrigation(field, rows, t) {
    const rainPast = sum(slice(rows, t - 24, t), (x) => x.pcp);
    const rainNext = sum(slice(rows, t, t + 48), (x) => x.pcp);
    const passedRain = sum(slice(rows, 0, t), (x) => x.pcp) > 3;
    const dry = passedRain ? 0 : field.dryDays + Math.floor(t / 24);
    const maxT = Math.max(...slice(rows, t, t + 24).map((x) => x.temp));
    const s = rule(0);
    s.add(dry * 9, `무강우 ${dry}일`);
    if (maxT > 22) s.add(Math.round((maxT - 22) * 4), `24시간 최고기온 ${maxT}℃`);
    if (RESERVOIR.rate < RESERVOIR.normalRate) s.add(8, `저수율 ${RESERVOIR.rate}% (평년 ${RESERVOIR.normalRate}%)`);
    if (field.soil.om < 25) s.add(8, "유기물 부족 (보수력 낮음)");
    if (rainNext >= 10) s.add(-45, `48시간 내 강우 ${rainNext.toFixed(1)}mm 예상`);
    else if (rainNext >= 5) s.add(-25, `48시간 내 강우 ${rainNext.toFixed(1)}mm (적음)`);
    if (rainPast >= 5) s.add(-50, `최근 24시간 강우 ${rainPast.toFixed(1)}mm`);
    return s.done();
  },

  robot(field, rows, t) {
    const r = rows[t];
    const rain6 = sum(slice(rows, t - 6, t), (x) => x.pcp);
    const s = rule();
    if (r.pcp > 0) s.add(-90, "현재 강우");
    if (rain6 > 2) s.add(-30, `최근 6시간 강우 ${rain6.toFixed(1)}mm (노면 미끄럼)`);
    if (r.pop >= 60) s.add(-30, `강수확률 ${r.pop}%`);
    if (field.slope > 15) s.add(-25, `경사 ${field.slope}% (주행 제한)`);
    else if (field.slope > 10) s.add(-10, `경사 ${field.slope}%`);
    if (r.wind > 6) s.add(-30, `풍속 ${r.wind}m/s`);
    else if (r.wind > 4.5) s.add(-10, `풍속 ${r.wind}m/s`);
    if (isNight(r.hod, 5, 20)) s.add(-20, "야간 (조명 필요)");
    if (alertActive(t)) s.cap(30, "강풍 예비특보");
    return s.done();
  },
};

function pestRisks(field, rows, t) {
  const win = slice(rows, t - 24, t + 48);
  const wetWarm = win.filter((x) => (x.pcp > 0 || x.hum >= 88) && x.temp >= 18 && x.temp <= 30).length;
  const humid = win.filter((x) => x.hum >= 85).length;
  const warm = win.filter((x) => x.temp >= 20).length;
  return PEST_BULLETIN.filter((p) => p.crop === field.crop).map((p) => {
    const base = p.level === "주의" ? 35 : 15;
    const env = p.sensitive === "rain" ? wetWarm * 3.2 : p.sensitive === "humid" ? humid * 1.6 : warm * 0.5;
    const score = clamp(base + env);
    const why = p.sensitive === "rain" ? `고온다습 ${wetWarm}시간` : p.sensitive === "humid" ? `습도 85%↑ ${humid}시간` : `20℃↑ ${warm}시간`;
    return { ...p, score, why, status: score >= 70 ? "critical" : score >= 40 ? "warning" : "good" };
  }).sort((a, b) => b.score - a.score);
}

function bestWindow(field, rows, from, key, len = 2) {
  let best = null;
  for (let h = from; h <= rows.length - len; h++) {
    const scores = [];
    for (let i = 0; i < len; i++) scores.push(SCORERS[key](field, rows, h + i).score);
    if (scores.includes(null)) return null;
    const avg = sum(scores, (x) => x) / len;
    if (!best || avg > best.score + 2) best = { start: h, end: h + len, score: Math.round(avg) };
  }
  return best;
}

function soilAdvice(soil) {
  const out = [];
  const R = SOIL_RANGE;
  if (soil.pH < R.pH.min) out.push(`pH ${soil.pH} — 석회 시용 검토`);
  if (soil.pH > R.pH.max) out.push(`pH ${soil.pH} — 산성 비료 위주 시비`);
  if (soil.om < R.om.min) out.push(`유기물 ${soil.om}g/kg — 퇴비 보충`);
  if (soil.p > R.p.max) out.push(`유효인산 ${soil.p}mg/kg — 인산 비료 생략`);
  if (soil.k < R.k.min) out.push(`칼륨 ${soil.k} — 칼리 추가 시비`);
  if (soil.ca < R.ca.min) out.push(`칼슘 ${soil.ca} — 고두병 주의, 칼슘제 엽면시비`);
  if (soil.ec > R.ec.max) out.push(`EC ${soil.ec}dS/m — 염류 집적, 시비량 줄이기`);
  return out;
}

function evaluate(field, rows, t) {
  const result = {};
  for (const idx of INDEXES) {
    const r = SCORERS[idx.key](field, rows, t);
    result[idx.key] = { ...r, status: statusOf(r.score, idx.kind) };
  }
  result.sprayDays = daysBetween(field.lastSpray, t);
  result.pests = pestRisks(field, rows, t);
  result.bestSpray = bestWindow(field, rows, t, "spray");
  result.bestHarvest = field.harvestable ? bestWindow(field, rows, t, "harvest", 3) : null;
  result.nextRain = rows.find((x) => x.h > t && x.pcp > 0) || null;
  result.soil = soilAdvice(field.soil);
  result.recs = recommend(field, rows, t, result);
  return result;
}

function recommend(field, rows, t, e) {
  const recs = [];
  const rainTxt = e.nextRain ? `${hourLabel(e.nextRain.h)} 강우 전` : "";
  if (field.harvestable) {
    if (e.harvest.score >= 70) recs.push({ tone: "good", text: `지금 수확 적합 — ${rainTxt} 마무리 권장` });
    else if (e.bestHarvest) recs.push({ tone: "warning", text: `수확은 ${hourLabel(e.bestHarvest.start)}부터 적합 (${e.bestHarvest.score}점)` });
  }
  if (e.sprayDays < 7) {
    recs.push({ tone: "neutral", text: `방제 간격 여유 — 마지막 방제 후 ${e.sprayDays}일` });
  } else if (e.spray.score >= 70) {
    recs.push({ tone: "good", text: `지금 방제 적합 — 마지막 방제 후 ${e.sprayDays}일 경과` });
  } else if (e.bestSpray) {
    recs.push({ tone: "warning", text: `방제는 ${hourLabel(e.bestSpray.start)}~${String((e.bestSpray.end) % 24).padStart(2, "0")}시 적합 (${e.bestSpray.score}점)` });
  }
  const topPest = e.pests[0];
  if (topPest && topPest.score >= 60) recs.push({ tone: "critical", text: `${topPest.name} 위험 ${topPest.score} — 강우 후 예방 방제 검토` });
  if (e.irrigation.score >= 70) recs.push({ tone: "warning", text: "관수 필요 — 점적관수 가동 검토" });
  else if (e.irrigation.score < 40 && e.nextRain) recs.push({ tone: "good", text: "관수 불필요 — 예보 강우로 대체" });
  if (alertActive(t) || (t < 36 && t + 24 >= 36)) recs.push({ tone: "warning", text: "16일 오후 강풍 예비특보 — 로봇·고소작업 일정 조정" });
  if (e.soil.length) recs.push({ tone: "neutral", text: `토양: ${e.soil[0]}` });
  return recs;
}
