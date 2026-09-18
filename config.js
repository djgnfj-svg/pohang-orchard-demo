// 설정 · 데이터 출처 이름

// VWorld 키 — 브라우저에서 호출하므로 노출돼도 되는 키. 개발키라 3개월마다 연장(최대 3회)
const VWORLD_KEY = "9D089910-1218-40D6-A39F-7CBD242DF2D1";

// 네이버 지도 Client ID — 콘솔 Web 서비스 URL에 등록된 주소만 인증된다 (지금은 github.io뿐, demo·localhost 등록 필요)
const NAVER_CLIENT_ID = "v33u514rqa";

// 공공데이터포털 중계 — 같은 주소의 /api/를 backend/가 받는다. github.io 배포본은 백엔드가 없어 Cloudflare Worker로
const PROXY_URL = location.hostname.endsWith("github.io")
  ? "https://pohang-orchard-proxy.djgnfj89239272.workers.dev/"
  : "api/";

// 공유 필지 — 모두에게 보이고 삭제 불가. 경계·지목·면적은 열 때마다 VWorld에서 조회
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
