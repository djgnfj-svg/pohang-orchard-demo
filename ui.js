// ---------------------------------------------------------------------------
// 하단 탭 콘텐츠 — 각 탭은 render(ctx) → HTML, bind(el, ctx)로 상호작용 연결
// ---------------------------------------------------------------------------
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
function dayName(day) {
  const d = new Date(BASE_DATE + "T00:00:00");
  d.setDate(d.getDate() + day);
  return `${d.getMonth() + 1}/${d.getDate()}(${DOW[d.getDay()]})`;
}
function tabHead(title, desc, ...srcKeys) {
  return `<div class="tab-head"><h3>${title}${srcKeys.map(src).join("")}</h3><p>${desc}</p></div>`;
}
const fieldName = (id) => FIELDS.find((f) => f.id === id)?.name ?? id;

// ---------------------------------------------------------------------------
// 시간별 예보 (72h): 기온 / 강수확률 / 작업 적합도 띠 — 같은 시간축, 밴드별 독립 척도
// ---------------------------------------------------------------------------
const HC = { W: 1200, L: 70, R: 14, top: 30 };
HC.cw = (HC.W - HC.L - HC.R) / 72;
const hx = (h) => HC.L + (h + 0.5) * HC.cw;
const STRIPS = [["spray", "방제"], ["harvest", "수확"], ["robot", "로봇작업"]];

function hourlyChart(ctx) {
  const { field, rows, t } = ctx;
  const temps = rows.map((r) => r.temp);
  const tMin = Math.floor((Math.min(...temps) - 1) / 5) * 5;
  const tMax = Math.ceil((Math.max(...temps) + 1) / 5) * 5;
  const T = { y0: HC.top, y1: HC.top + 120 };
  const P = { y0: T.y1 + 34, y1: T.y1 + 34 + 70 };
  const S = { y0: P.y1 + 26, row: 20 };
  const H = S.y0 + STRIPS.length * S.row + 8;
  const ty = (v) => T.y1 - ((v - tMin) / (tMax - tMin)) * (T.y1 - T.y0);
  const py = (v) => P.y1 - (v / 100) * (P.y1 - P.y0);

  let g = "";
  // 날짜 구분
  for (let d = 0; d < 3; d++) {
    const x = HC.L + d * 24 * HC.cw;
    if (d) g += `<line class="day-sep" x1="${x}" x2="${x}" y1="12" y2="${H - 8}"/>`;
    g += `<text class="day-label" x="${x + 6}" y="16">${dayName(d)}</text>`;
  }
  // 기온 밴드
  for (let v = tMin; v <= tMax; v += 5) {
    g += `<line class="grid-line" x1="${HC.L}" x2="${HC.W - HC.R}" y1="${ty(v)}" y2="${ty(v)}"/>`;
    g += `<text class="ax" x="${HC.L - 8}" y="${ty(v) + 3.5}" text-anchor="end">${v}℃</text>`;
  }
  const pts = rows.map((r) => `${hx(r.h).toFixed(1)},${ty(r.temp).toFixed(1)}`);
  g += `<path class="temp-area" d="M${hx(0)},${T.y1} L${pts.join(" L")} L${hx(71)},${T.y1} Z"/>`;
  g += `<path class="temp-line" d="M${pts.join(" L")}"/>`;
  // 강수확률 밴드
  [0, 50, 100].forEach((v) => {
    g += `<line class="${v ? "grid-line" : "base-line"}" x1="${HC.L}" x2="${HC.W - HC.R}" y1="${py(v)}" y2="${py(v)}"/>`;
    g += `<text class="ax" x="${HC.L - 8}" y="${py(v) + 3.5}" text-anchor="end">${v}%</text>`;
  });
  g += `<text class="ax-title" x="${HC.L - 8}" y="${P.y0 - 12}" text-anchor="end">강수확률</text>`;
  g += `<text class="ax-title" x="${HC.L - 8}" y="${T.y0 - 12}" text-anchor="end">기온</text>`;
  const bw = Math.min(HC.cw - 3, 24);
  rows.forEach((r) => {
    if (!r.pop) return;
    const y = py(r.pop), h = P.y1 - y, x = hx(r.h) - bw / 2, rr = Math.min(3, h);
    g += `<path class="pop-bar" d="M${x},${P.y1} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + bw - rr} Q${x + bw},${y} ${x + bw},${y + rr} V${P.y1} Z"/>`;
  });
  // 적합도 띠
  STRIPS.forEach(([key, label], i) => {
    const y = S.y0 + i * S.row;
    g += `<text class="ax" x="${HC.L - 8}" y="${y + 13}" text-anchor="end">${label}</text>`;
    rows.forEach((r) => {
      const sc = SCORERS[key](field, rows, r.h).score;
      const st = statusOf(sc, "suit").key;
      g += `<rect class="strip-cell" data-s="${st}" x="${HC.L + r.h * HC.cw}" y="${y}" width="${HC.cw}" height="${S.row - 2}" style="fill:var(--s)" fill-opacity="${st === "na" ? 0.35 : 0.85}"/>`;
    });
  });
  // 기준 시각
  g += `<line class="now-line" x1="${hx(t)}" x2="${hx(t)}" y1="${T.y0 - 6}" y2="${H - 8}"/>`;
  g += `<circle class="dot" cx="${hx(t)}" cy="${ty(rows[t].temp)}" r="4.5"/>`;
  g += `<line class="cursor" id="hc-cursor" x1="0" x2="0" y1="${T.y0 - 6}" y2="${H - 8}" visibility="hidden"/>`;
  rows.forEach((r) => {
    g += `<rect class="hit" data-h="${r.h}" x="${HC.L + r.h * HC.cw}" y="${T.y0 - 6}" width="${HC.cw}" height="${H - T.y0}"/>`;
  });
  return `<svg viewBox="0 0 ${HC.W} ${H}" role="img" aria-label="72시간 기온, 강수확률, 작업 적합도">${g}</svg>`;
}

const TAB_HOURLY = {
  key: "hourly", label: "시간별 예보",
  render: (ctx) => `
    ${tabHead(`${esc(ctx.field.name)} · 72시간`, "막대·선에 올리면 값, 누르면 그 시각 기준으로 전체 판단이 바뀝니다.", "fcst", "engine")}
    <div class="scroll-x"><div class="chart" id="hourly-chart" style="min-width:760px">${hourlyChart(ctx)}<div class="tip" id="hc-tip" hidden></div></div></div>`,
  bind(el, ctx) {
    const chart = el.querySelector("#hourly-chart");
    const tip = el.querySelector("#hc-tip");
    const cursor = el.querySelector("#hc-cursor");
    const svg = chart.querySelector("svg");
    chart.addEventListener("pointermove", (ev) => {
      const hit = ev.target.closest(".hit");
      if (!hit) { tip.hidden = true; cursor.setAttribute("visibility", "hidden"); return; }
      const h = +hit.dataset.h, r = ctx.rows[h];
      const sp = SCORERS.spray(ctx.field, ctx.rows, h).score;
      cursor.setAttribute("x1", hx(h)); cursor.setAttribute("x2", hx(h)); cursor.setAttribute("visibility", "visible");
      tip.innerHTML = `<div>${hourLabel(h)} · ${r.sky}</div>기온 <b>${r.temp}℃</b> · 습도 <b>${r.hum}%</b><br>강수확률 <b>${r.pop}%</b> · 강수 <b>${r.pcp}mm</b><br>풍속 <b>${r.wind}m/s</b> · 방제 <b>${sp}</b>`;
      const box = svg.getBoundingClientRect();
      tip.style.left = `${(hx(h) / HC.W) * box.width}px`;
      tip.style.top = `${(HC.top / HC.W) * box.width + 8}px`;
      tip.hidden = false;
    });
    chart.addEventListener("pointerleave", () => { tip.hidden = true; cursor.setAttribute("visibility", "hidden"); });
    chart.addEventListener("click", (ev) => {
      const hit = ev.target.closest(".hit");
      if (hit) ctx.setHour(+hit.dataset.h);
    });
  },
};

// ---------------------------------------------------------------------------
const TAB_OUTLOOK = {
  key: "outlook", label: "7일 전망",
  render() {
    const lo = Math.min(...OUTLOOK.map((d) => d.min)), hi = Math.max(...OUTLOOK.map((d) => d.max));
    const pct = (v) => ((v - lo) / (hi - lo)) * 100;
    return `${tabHead("포항 7일 전망", "3일까지 단기예보, 이후 중기예보 (오전/오후 강수확률)", "fcst", "mid")}
      <div class="scroll-x"><div class="outlook">${OUTLOOK.map((d, i) => `
        <div class="ol-day${i === 0 ? " is-today" : ""}">
          <div class="ol-date">${d.date.slice(3)}일<small>${d.dow}</small></div>
          <div>${d.sky}</div>
          <div class="ol-temp"><span class="lo">${d.min}°</span> / ${d.max}°</div>
          <div class="ol-range" aria-hidden="true"><span style="left:${pct(d.min)}%;right:${100 - pct(d.max)}%"></span></div>
          <div class="ol-pop">강수 <span class="mono">${d.popAm}% · ${d.popPm}%</span></div>
          <small>${d.src === "fcst" ? "단기예보" : "중기예보"}</small>
        </div>`).join("")}
      </div></div>`;
  },
};

// ---------------------------------------------------------------------------
const TAB_ALERTS = {
  key: "alerts", label: "재해·특보",
  render: (ctx) => {
    const r = RESERVOIR;
    const peak = ctx.rows.reduce((a, x) => (x.wind > a.wind ? x : a));
    return `${tabHead("재해 · 기상특보", "포항 및 필지 인근 기준")}
      <div class="grid-3">
        ${ALERTS.map((a) => `<div class="box"><h4><span>${esc(a.kind)} ${esc(a.level)}</span>${pill({ key: a.status, label: a.status === "good" ? "낮음" : "주의" })}</h4>
          <p>${esc(a.area)} · ${esc(a.when)}</p><p>${esc(a.text)}</p><p>${src(a.src)}</p></div>`).join("")}
        <div class="box"><h4><span>최대 풍속 (72시간)</span>${pill({ key: peak.wind > 6 ? "critical" : peak.wind > 4 ? "warning" : "good", label: `${peak.wind}m/s` })}</h4>
          <p>${hourLabel(peak.h)} · ${esc(ctx.field.name)}</p><p>${src("fcst")}</p></div>
        <div class="box"><h4><span>${esc(r.name)} 저수율</span><span class="mono">${r.rate}%</span></h4>
          <div class="robot-meter"><span style="width:${r.rate}%"></span></div>
          <p style="margin-top:6px">평년 ${r.normalRate}% 대비 ${r.rate - r.normalRate}%p</p><p>${src(r.src)}</p></div>
      </div>`;
  },
};

// ---------------------------------------------------------------------------
const TAB_PESTS = {
  key: "pests", label: "병해충",
  render: ({ field, e }) => `${tabHead(`${field.crop} 병해충 위험`, "지역 예찰 수준 + 필지 기상(전후 72시간)으로 위험도 산출", "pest", "engine")}
    <div class="scroll-x"><table class="tbl">
      <thead><tr><th>병해충</th><th>지역 예찰</th><th>필지 위험도</th><th>근거</th><th>메모</th></tr></thead>
      <tbody>${e.pests.map((p) => `<tr>
        <td><b>${esc(p.name)}</b></td>
        <td>${esc(p.level)}</td>
        <td><span class="mono">${p.score}</span> ${pill({ key: p.status, label: p.status === "critical" ? "높음" : p.status === "warning" ? "보통" : "낮음" })}</td>
        <td>${esc(p.why)}</td>
        <td style="white-space:normal;min-width:260px">${esc(p.note)}</td>
      </tr>`).join("")}</tbody>
    </table></div>`,
};

// ---------------------------------------------------------------------------
const TAB_SOIL = {
  key: "soil", label: "토양",
  render: ({ field, e }) => {
    const rows = Object.entries(SOIL_RANGE).map(([k, R]) => {
      const v = field.soil[k];
      const pos = (x) => Math.min(100, (x / R.scaleMax) * 100);
      const st = v < R.min ? { key: "warning", label: "부족" } : v > R.max ? { key: "warning", label: "과다" } : { key: "good", label: "적정" };
      return `<div class="soil-row">
        <span>${R.label}</span>
        <span class="soil-bar" aria-hidden="true"><span class="ok" style="left:${pos(R.min)}%;right:${100 - pos(R.max)}%"></span><span class="val" style="left:${pos(v)}%"></span></span>
        <span class="soil-val">${v} <small>${R.unit}</small></span>
        ${pill(st)}
      </div>`;
    }).join("");
    return `${tabHead(`${esc(field.name)} 토양검정`, "초록 구간 = 사과 과원 적정범위(예시 기준)", "soil")}
      <div class="grid-2">
        <div>${rows}</div>
        <div class="box"><h4>시비 처방 요약</h4>
          ${e.soil.length ? `<ul class="recs">${e.soil.map((s) => `<li data-s="warning"><i aria-hidden="true">!</i><span>${esc(s)}</span></li>`).join("")}</ul>` : "<p>모든 항목 적정 범위</p>"}
        </div>
      </div>`;
  },
};

// ---------------------------------------------------------------------------
const TAB_SCHEDULE = {
  key: "schedule", label: "농작업",
  render: ({ field, e, t }) => {
    const items = SCHEDULE[`${field.crop}:${field.stage}`] ?? [];
    const win = (w, label) => w
      ? `<li data-s="good"><i aria-hidden="true">✓</i><span>${label} 최적 시간대 <b class="mono">${hourLabel(w.start)}</b> (${w.score}점)</span></li>`
      : `<li data-s="na"><i aria-hidden="true">·</i><span>${label} — ${field.harvestable || label === "방제" ? "72시간 내 적합 시간 없음" : "시기 아님"}</span></li>`;
    return `${tabHead(`이번 주 권장 농작업 · ${field.crop} ${esc(field.stage)}`, "작목·생육단계별 권장 작업에 기상 판단을 더함", "schedule", "engine")}
      <div class="grid-2">
        <div class="box"><h4>시기별 권장 작업</h4><ul class="recs">${items.map((x) => `<li data-s="neutral"><i aria-hidden="true">–</i><span>${esc(x)}</span></li>`).join("")}</ul></div>
        <div class="box"><h4>기상 반영 작업 시간</h4><ul class="recs">
          ${win(e.bestSpray, "방제")}
          ${win(e.bestHarvest, "수확")}
          ${e.nextRain ? `<li data-s="warning"><i aria-hidden="true">!</i><span>다음 강우 ${hourLabel(e.nextRain.h)} — 방제 후 6시간 이상 비 없어야 함</span></li>` : ""}
        </ul></div>
      </div>`;
  },
};

// ---------------------------------------------------------------------------
const WORK_RATE = { spray: 2600, weed: 1800 }; // ㎡/시간 (예시)
const TAB_ROBOTS = {
  key: "robots", label: "로봇",
  render: ({ t, evalAt }) => {
    const plan = FIELDS.map((f) => {
      const e = evalAt(f, t);
      let action = { key: "na", label: "작업 연기" }, eta = "–";
      if (e.spray.score >= 70 && e.sprayDays >= 7) { action = { key: "good", label: "방제로봇 투입" }; eta = f.area / WORK_RATE.spray; }
      else if (e.weed.score >= 70 && e.robot.score >= 70) { action = { key: "good", label: "제초로봇 투입" }; eta = f.area / WORK_RATE.weed; }
      else if (e.robot.score < 40) action = { key: "critical", label: "로봇 작업 불가" };
      const etaTxt = typeof eta === "number" ? `${Math.floor(eta)}h ${String(Math.round((eta % 1) * 60)).padStart(2, "0")}m` : eta;
      return { f, e, action, etaTxt };
    });
    return `${tabHead(`${hourLabel(t)} 로봇 작업 계획`, "로봇 상태는 관제 시스템, 투입 판단은 판단엔진 결과", "internal", "engine")}
      <div class="grid-3" style="margin-bottom:16px">${ROBOTS.map((r) => `
        <div class="box"><h4><span>${r.id} · ${esc(r.type)}</span><span class="pill" data-s="${r.state === "대기" ? "good" : r.state === "작업 중" ? "neutral" : "warning"}">${r.state}</span></h4>
          <p>${esc(r.model)} · ${esc(fieldName(r.at))}</p>
          <div class="robot-meter" aria-label="배터리 ${r.battery}%"><span style="width:${r.battery}%"></span></div>
          <p style="margin-top:4px">배터리 <span class="mono">${r.battery}%</span></p></div>`).join("")}
      </div>
      <div class="scroll-x"><table class="tbl">
        <thead><tr><th>필지</th><th>로봇작업</th><th>방제</th><th>제초</th><th>마지막 방제</th><th>판단</th><th>예상 작업시간</th></tr></thead>
        <tbody>${plan.map(({ f, e, action, etaTxt }) => `<tr${f.id === state.id ? ' class="is-current"' : ""}>
          <td><b>${esc(f.name)}</b> <small>${fmt(f.area)}㎡</small></td>
          <td class="mono">${e.robot.score}</td><td class="mono">${e.spray.score}</td><td class="mono">${e.weed.score}</td>
          <td class="mono">${e.sprayDays}일 전</td>
          <td>${pill(action)}</td><td class="mono">${etaTxt}</td>
        </tr>`).join("")}</tbody>
      </table></div>`;
  },
};

// ---------------------------------------------------------------------------
const TAB_LOG = {
  key: "log", label: "작업이력",
  render: () => `${tabHead("최근 작업이력", "선택 필지 행 강조", "internal")}
    <div class="scroll-x"><table class="tbl">
      <thead><tr><th>날짜</th><th>필지</th><th>작업</th><th>수행</th><th>소요</th><th>결과</th></tr></thead>
      <tbody>${WORK_LOG.map((w) => `<tr${w.field === state.id ? ' class="is-current"' : ""}>
        <td class="mono">${w.date}</td><td>${esc(fieldName(w.field))}</td><td>${esc(w.task)}</td>
        <td>${esc(w.by)}</td><td class="mono">${w.duration}</td>
        <td>${pill({ key: w.result === "완료" ? "good" : "warning", label: w.result })}</td>
      </tr>`).join("")}</tbody>
    </table></div>`,
};

const TABS = [TAB_HOURLY, TAB_OUTLOOK, TAB_ALERTS, TAB_PESTS, TAB_SOIL, TAB_SCHEDULE, TAB_ROBOTS, TAB_LOG];
