// ---------------------------------------------------------------------------
// 목업 데이터 — 화면 확인용 예시 값. 실제 연동 시 각 SRC에 적힌 API 응답으로 교체.
// 응답 필드가 확인된 항목만 둔다 (docs/API_DATA.md). 출처를 모르는 값은 넣지 않음.
// ---------------------------------------------------------------------------
// VWorld 인증키 — 지도 타일·지적도·검색을 브라우저에서 직접 호출하므로 페이지에 노출되는 키.
// 공공데이터포털 키는 사용처 제한이 없으니 여기에 두지 말 것 (서버·중계로 호출).
const VWORLD_KEY = "9D089910-1218-40D6-A39F-7CBD242DF2D1";

const SRC = {
  ncst: "기상청 초단기실황",
  fcst: "기상청 단기예보",
  mid: "기상청 중기예보",
  warn: "기상청 기상특보",
  fmapWeather: "팜맵 농업기상",
  soil: "팜맵 토양검정",
  pest: "농진청 병해충 예찰정보",
  growth: "사과생육품질정보",
  parcel: "VWorld 연속지적도",
  internal: "로봇 관제 시스템(내부)",
  engine: "자체 판단엔진",
  naver: "네이버 지오코딩",
  osm: "OSM Nominatim 주소검색",
  vworld: "VWorld 검색",
  click: "지도에서 선택",
};

// 검색 위치(미등록 필지)에 적용할 작물 가정값
const CROP_PRESETS = {
  "apple-hongro": { crop: "사과", cultivar: "홍로", maturity: "중생종", stage: "수확기", harvestable: true },
  "apple-fuji": { crop: "사과", cultivar: "후지", maturity: "만생종", stage: "착색기", harvestable: false },
  "apple-shinano": { crop: "사과", cultivar: "시나노골드", maturity: "중만생종", stage: "과실비대후기", harvestable: false },
  "pear-singo": { crop: "배", cultivar: "신고", maturity: "만생종", stage: "성숙기", harvestable: false },
};

const BASE_DATE = "2026-09-15"; // 72시간 예보 시작일 (00시)
const DEFAULT_HOUR = 9;          // 처음 열었을 때 기준 시각

// tempOffset·windOffset·rainFactor: 지역 예보 시나리오를 필지마다 조금씩 다르게 만드는 목업 보정값 (화면에 표시 안 함)
// dryDays: 무강우 일수 (과거 강수 관측으로 계산할 값)
// soil: 팜맵 토양검정에서 필드가 확인된 항목만 — pH(acidity), 유기물(ormtCont), 유효인산(vdphdy), EC(ecd)
const FIELDS = [
  {
    id: "F-101", name: "밤*골농장", crop: "사과", cultivar: "홍로", maturity: "중생종",
    stage: "수확기", harvestable: true,
    address: "포항시 북구 죽장면 두마리 904-1", pnu: "4711335037109040001",
    area: 5510, landUse: "과수원", lat: 36.16482, lon: 129.02589,
    tempOffset: -1.4, windOffset: -0.3, rainFactor: 1.1, dryDays: 5,
    soil: { pH: 5.6, om: 27, p: 240, ec: 0.8 },
  },
  {
    id: "F-102", name: "솔밭농장", crop: "사과", cultivar: "후지", maturity: "만생종",
    stage: "착색기", harvestable: false,
    address: "포항시 북구 기북면 성법리 891", pnu: "4711336027108910000",
    area: 3594, landUse: "과수원", lat: 36.17326, lon: 129.19256,
    tempOffset: -0.9, windOffset: 0.2, rainFactor: 1.0, dryDays: 5,
    soil: { pH: 6.3, om: 19, p: 265, ec: 0.6 },
  },
  {
    id: "F-103", name: "바다뜰농장", crop: "배", cultivar: "신고", maturity: "만생종",
    stage: "성숙기", harvestable: false,
    address: "포항시 북구 흥해읍 북송리 38-1", pnu: "4711325022100380001",
    area: 5644, landUse: "과수원", lat: 36.10999, lon: 129.32387,
    tempOffset: 0.6, windOffset: 2.6, rainFactor: 0.5, dryDays: 8,
    soil: { pH: 6.1, om: 31, p: 420, ec: 1.1 },
  },
  {
    id: "F-104", name: "청하사과원", crop: "사과", cultivar: "홍로", maturity: "중생종",
    stage: "수확기", harvestable: true,
    address: "포항시 북구 청하면 유계리 526-2", pnu: "4711332037105260002",
    area: 8227, landUse: "과수원", lat: 36.19512, lon: 129.30044,
    tempOffset: 0.2, windOffset: 1.8, rainFactor: 0.8, dryDays: 5,
    soil: { pH: 6.2, om: 29, p: 230, ec: 0.9 },
  },
  {
    id: "F-105", name: "신광농원", crop: "사과", cultivar: "시나노골드", maturity: "중만생종",
    stage: "과실비대후기", harvestable: false,
    address: "포항시 북구 신광면 안덕리 119", pnu: "4711331028101190000",
    area: 5635, landUse: "과수원", lat: 36.15002, lon: 129.26915,
    tempOffset: -0.2, windOffset: 0.0, rainFactor: 0.9, dryDays: 5,
    soil: { pH: 6.4, om: 33, p: 280, ec: 2.4 },
  },
];

// 사과 과원 토양 적정범위 (예시 기준 — 실제는 흙토람/토양검정 처방 기준 적용)
const SOIL_RANGE = {
  pH: { label: "산도(pH)", unit: "", min: 6.0, max: 6.5, scaleMax: 8 },
  om: { label: "유기물", unit: "g/kg", min: 25, max: 35, scaleMax: 50 },
  p: { label: "유효인산", unit: "mg/kg", min: 200, max: 300, scaleMax: 500 },
  ec: { label: "전기전도도(EC)", unit: "dS/m", min: 0, max: 2.0, scaleMax: 3 },
};

// ---------------------------------------------------------------------------
// 72시간 시간별 예보 (지역 공통 시나리오 + 필지별 보정)
// 시나리오: 15일 맑음 → 16일 14시부터 비·강풍 → 17일 새벽 그침
// ---------------------------------------------------------------------------
const DAY_PROFILE = [
  { mean: 21.5, amp: 5.0 }, // 15일
  { mean: 20.5, amp: 2.5 }, // 16일 (흐리고 비)
  { mean: 19.5, amp: 5.0 }, // 17일
];

function regionalHour(h) {
  const day = Math.floor(h / 24), hod = h % 24;
  const p = DAY_PROFILE[day];
  // 05시 최저, 14시 최고
  const phase = ((hod - 14 + 24) % 24) / 24;
  let temp = p.mean + p.amp * Math.cos(2 * Math.PI * phase);
  let pop = 5, pcp = 0, wind = 1.4 + 1.2 * Math.max(0, Math.sin(((hod - 8) / 12) * Math.PI));
  let sky = "맑음";

  if (day === 0 && hod >= 18) { pop = 10 + (hod - 18) * 2; sky = "구름많음"; }
  if (day === 1) {
    if (hod < 12) { pop = 20 + hod * 2; sky = "구름많음"; wind = 2.2 + hod * 0.1; }
    else if (hod < 14) { pop = 50; sky = "흐림"; wind = 3.8; }
    else if (hod <= 20) {
      pop = [70, 80, 80, 80, 70, 70, 70][hod - 14]; sky = "비";
      pcp = [1.0, 3.5, 4.0, 2.5, 2.0, 1.0, 0.5][hod - 14];
      wind = [5.2, 6.4, 6.8, 6.1, 5.0, 4.4, 3.9][hod - 14];
      temp -= 2.2;
    } else { pop = 60; sky = "흐림"; wind = 3.6; temp -= 1.5; }
  }
  if (day === 2) {
    if (hod < 4) { pop = 40 - hod * 5; sky = "흐림"; pcp = hod < 2 ? 0.5 : 0; wind = 3.2; }
    else if (hod < 9) { pop = 20; sky = "구름많음"; wind = 2.4; }
    else { pop = 10; sky = hod < 13 ? "구름많음" : "맑음"; }
  }
  const rainBoost = pcp > 0 ? 18 : pop >= 50 ? 10 : 0;
  let hum = 62 - (temp - p.mean) * 4.2 + rainBoost + (day === 1 ? 8 : 0);
  return { temp, pop, pcp, wind, hum: Math.min(98, hum), sky };
}

function buildHourly(field) {
  const rows = [];
  for (let h = 0; h < 72; h++) {
    const r = regionalHour(h);
    const jitter = Math.sin((h + field.lat * 100) * 1.7) * 0.3;
    rows.push({
      h, day: Math.floor(h / 24), hod: h % 24,
      temp: +(r.temp + field.tempOffset + jitter).toFixed(1),
      hum: Math.round(r.hum),
      pop: r.pop,
      pcp: +(r.pcp * (field.rainFactor ?? 1)).toFixed(1),
      wind: +Math.max(0.3, r.wind + field.windOffset + jitter).toFixed(1),
      sky: r.sky,
    });
  }
  return rows;
}

// 10일 전망 (단기예보 3일 + 중기예보)
const OUTLOOK = [
  { date: "09-15", dow: "화", sky: "맑음", min: 16, max: 27, popAm: 0, popPm: 10, src: "fcst" },
  { date: "09-16", dow: "수", sky: "비", min: 17, max: 22, popAm: 40, popPm: 80, src: "fcst" },
  { date: "09-17", dow: "목", sky: "구름많음", min: 15, max: 25, popAm: 30, popPm: 10, src: "fcst" },
  { date: "09-18", dow: "금", sky: "맑음", min: 14, max: 26, popAm: 10, popPm: 10, src: "mid" },
  { date: "09-19", dow: "토", sky: "맑음", min: 15, max: 27, popAm: 0, popPm: 10, src: "mid" },
  { date: "09-20", dow: "일", sky: "구름많음", min: 16, max: 26, popAm: 20, popPm: 30, src: "mid" },
  { date: "09-21", dow: "월", sky: "흐림", min: 17, max: 24, popAm: 40, popPm: 60, src: "mid" },
];

const ALERTS = [
  { level: "예비특보", kind: "강풍", area: "경북북동산지 · 포항", when: "9/16(수) 오후", status: "warning",
    text: "순간풍속 20m/s 이상 예상. 16일 오후 방제·고소작업 자제.", src: "warn" },
];

// 병해충 예찰 (지역 발생 정보) — 점수화하지 않고 예찰 수준과 필지 기상 조건만 보여줌
const PEST_BULLETIN = [
  { crop: "사과", name: "탄저병", level: "주의", note: "경북 사과 주산지 발생 증가. 강우 후 고온다습 시 확산.", sensitive: "rain" },
  { crop: "사과", name: "겹무늬썩음병", level: "관심", note: "수확기 과실 발생. 수확 전 약제 안전사용기준 확인.", sensitive: "humid" },
  { crop: "사과", name: "복숭아순나방", level: "관심", note: "4세대 성충 발생기. 페로몬 트랩 예찰 권장.", sensitive: "warm" },
  { crop: "배", name: "검은별무늬병", level: "관심", note: "가을 강우 시 잎·과실 감염. 낙엽 처리.", sensitive: "rain" },
  { crop: "배", name: "꼬마배나무이", level: "관심", note: "밀도 낮음.", sensitive: "warm" },
];

const ROBOTS = [
  { id: "SP-03", type: "방제로봇", model: "과수 방제로봇", battery: 86, state: "대기", at: "F-101" },
  { id: "WD-02", type: "제초로봇", model: "과원 제초로봇", battery: 54, state: "충전 중", at: "F-102" },
  { id: "RT-01", type: "운반로봇", model: "RT100", battery: 91, state: "작업 중", at: "F-104" },
];

const WORK_LOG = [
  { date: "09-14", field: "F-104", task: "수확 운반", by: "RT-01", duration: "2h 10m", result: "완료" },
  { date: "09-12", field: "F-101", task: "수확", by: "작업자 3명", duration: "5h", result: "완료" },
  { date: "09-11", field: "F-103", task: "방제", by: "SP-03", duration: "1h 05m", result: "완료" },
  { date: "09-09", field: "F-105", task: "방제", by: "SP-03", duration: "1h 20m", result: "완료" },
  { date: "09-08", field: "F-102", task: "방제", by: "SP-03", duration: "1h 50m", result: "완료" },
  { date: "09-06", field: "F-102", task: "제초", by: "WD-02", duration: "2h 30m", result: "중단 (배터리)" },
  { date: "09-05", field: "F-101", task: "방제", by: "SP-03", duration: "1h 15m", result: "완료" },
];
