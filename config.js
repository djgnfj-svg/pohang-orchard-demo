// ---------------------------------------------------------------------------
// 설정 · 데이터 출처 이름 — 화면에는 실제 데이터만 표시한다 (목업 없음)
// ---------------------------------------------------------------------------

// VWorld 인증키 — 지도 타일·지적도·검색을 브라우저에서 직접 호출하므로 페이지에 노출되는 키.
const VWORLD_KEY = "9D089910-1218-40D6-A39F-7CBD242DF2D1";

// 공공데이터포털 중계(Cloudflare Worker, 저장소 worker/). 서비스키는 Worker 비밀값에만 있다.
const PROXY_URL = "https://pohang-orchard-proxy.djgnfj89239272.workers.dev/";

const SRC = {
  parcel: "VWorld 연속지적도",
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
