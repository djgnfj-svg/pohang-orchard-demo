// ---------------------------------------------------------------------------
// 설정 · 데이터 출처 이름 — 화면에는 실제 데이터만 표시한다 (목업 없음)
// ---------------------------------------------------------------------------

// VWorld 인증키 — 지도 타일·지적도·검색을 브라우저에서 직접 호출하므로 페이지에 노출되는 키.
const VWORLD_KEY = "9D089910-1218-40D6-A39F-7CBD242DF2D1";

// 공공데이터포털 중계(Cloudflare Worker, 저장소 worker/). 서비스키는 Worker 비밀값에만 있다.
const PROXY_URL = "https://pohang-orchard-proxy.djgnfj89239272.workers.dev/";

// 공유 필지 — 데모를 여는 모든 사람에게 보이는 필지 (삭제 불가, 처음 열면 첫 필지 선택).
// PNU·주소·중심 좌표만 두고 경계·지목·면적은 열 때마다 VWorld에서 조회한다.
const SHARED_PARCELS = [
  { pnu: "5176033025100570000", address: "강원특별자치도 평창군 대화면 하안미리 57", lat: 37.45997, lon: 128.49597 },
];

// 로봇 작업 맵(라이다·웨이포인트) — robot/<이름>.js가 여기에 추가한다 (tools/build_robotmap.py로 생성)
const ROBOT_MAPS = [];

const SRC = {
  lidar: "로봇 라이다 맵",
  route: "로봇 웨이포인트",
  parcel: "VWorld 연속지적도",
  shared: "공유 필지",
  vworld: "VWorld 검색",
  naver: "네이버 지오코딩",
  osm: "OSM Nominatim",
  saved: "내 필지",
  kmaNow: "기상청 초단기실황",
  kmaShort: "기상청 단기예보",
  kmaMid: "기상청 중기예보",
  kmaWarn: "기상청 기상특보",
  soil: "팜맵 토양검정",
  pest: "팜맵 병해충발생",
};
