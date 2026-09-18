// 로봇 작업 맵 — 필지 상세 섹션과 3D 보기 (데이터는 tools/build_robotmap.py가 만든 robot/<이름>.js)
const THREE_URLS = [
  "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js",
  "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js",
];

const robotMapOf = (p) => (p?.pnu && ROBOT_MAPS.find((rm) => rm.pnu === p.pnu)) || null;
const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// 지면 위 높이 색 — 지도 영상·3D 점과 같은 팔레트 (legend: [[m, "#rrggbb"], …])
function heightGradient(legend) {
  const top = legend.at(-1)[0];
  return `linear-gradient(90deg, ${legend.map(([m, c]) => `${c} ${((m / top) * 100).toFixed(1)}%`).join(", ")})`;
}

// 로봇 데이터가 지적도 경계보다 15m쯤 밀려 보이는 건 연속지적도 오차다 (위성영상과 맞는 건 로봇 쪽)
function renderRobotMap(p) {
  const rm = robotMapOf(p);
  if (!rm) return "";
  const { lidar, route, cloud } = rm;
  const fence = rm.fences[0];
  return `<div class="d-data">
    <div class="d-sec-head"><h3>로봇 작업 맵</h3><span>${src("lidar")}${src("route")}</span></div>
    <dl class="d-facts">
      <div><dt>라이다 맵 <small>${esc(lidar.date)}</small></dt><dd><span class="mono">${fmt(lidar.points)}</span>점</dd></div>
      <div><dt>스캔 범위</dt><dd class="mono">${lidar.size[0]} × ${lidar.size[1]}m</dd></div>
      <div><dt>주행 경로 <small>${esc(route.date.slice(0, 10))}</small></dt><dd><span class="mono">${fmt(route.length)}</span>m · 노드 <span class="mono">${route.nodes.length}</span></dd></div>
      <div><dt>작업 구역 <small>지오펜스</small></dt><dd>${fence ? `<span class="mono">${fmt(fence.area)}</span>㎡` : "–"}</dd></div>
    </dl>
    <div class="robot-legend"><span>지면</span><i style="background:${heightGradient(lidar.legend)}"></i><span>${lidar.legend.at(-1)[0]}m 이상</span></div>
    <p class="d-note">지도 색은 라이다로 잰 지면 위 높이(나무 열) · <b class="robot-key is-path">주황</b> 주행 경로 · <b class="robot-key is-fence">파랑 점선</b> 작업 구역 · 홈 노드 ${route.home}</p>
    <p class="d-note">라이다 맵 위치는 주행 경로(UTM 52N 좌표)가 나무 열 사이를 지나도록 맞춘 것</p>
    <div class="d-actions">
      <button type="button" class="btn" data-robot3d="${esc(rm.id)}">3D로 보기</button>
      <small>${fmt(cloud.count)}점(${cloud.voxel}m 간격) · ${((cloud.count * 7) / 1e6).toFixed(1)}MB</small>
    </div>
  </div>`;
}

// 3D 보기 — three.js는 처음 열 때만 불러온다
function loadScript(url) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = url;
    s.onload = resolve;
    s.onerror = () => { s.remove(); reject(new Error("3D 라이브러리를 불러오지 못했습니다")); };
    document.head.appendChild(s);
  });
}
let threeLoading = null;
function loadThree() {
  threeLoading ??= THREE_URLS.reduce((chain, url) => chain.then(() => loadScript(url)), Promise.resolve())
    .catch((e) => { threeLoading = null; throw e; });
  return threeLoading;
}

async function fetchCloud(rm) {
  const r = await fetch(rm.cloud.url);
  if (!r.ok) throw new Error(`점 파일 오류 (${r.status})`);
  return r.arrayBuffer();
}

// 3D 카드는 지도 칸 아래에 붙는다 (한 번에 하나). 닫으면 지도가 원래 크기로
let card3d = null; // { rm, el, dispose }

function closeRobot3D() {
  if (!card3d) return;
  card3d.dispose();
  card3d.el.remove();
  card3d = null;
  $(".shell").classList.remove("has-3d");
}

async function openRobot3D(id) {
  const rm = ROBOT_MAPS.find((r) => r.id === id);
  if (!rm) return;
  const scroll = (el) => el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest" });
  if (card3d?.rm === rm) return scroll(card3d.el);
  closeRobot3D();
  const el = document.createElement("section");
  el.className = "card-3d";
  el.setAttribute("aria-label", "라이다 3D");
  el.innerHTML = `
    <div class="r3d-head">
      <h2>라이다 3D · ${esc(rm.title)}</h2>
      <button type="button" class="r3d-north" title="지도와 같은 방향(위쪽이 북쪽)으로 되돌립니다" hidden>북쪽으로</button>
      <span class="r3d-status" role="status">불러오는 중…</span>
      <button type="button" class="r3d-close" aria-label="3D 카드 닫기">×</button>
    </div>
    <div class="r3d-view"></div>
    <p class="r3d-hint">지도와 같이 위쪽이 북쪽 · 화면을 누른 뒤 WASD 이동(Shift 빠르게) · 드래그 회전 · 휠 확대 · 오른쪽 드래그 이동 ·<b class="robot-key is-path">주황</b> 주행 경로 · <b class="robot-key is-fence">파랑</b> 작업 구역 · 흰 점 홈</p>`;
  const card = { rm, el, dispose: () => {} };
  card3d = card;
  el.querySelector(".r3d-close").addEventListener("click", closeRobot3D);
  $(".shell").appendChild(el);
  $(".shell").classList.add("has-3d");
  if (window.innerWidth <= 1180) scroll(el);
  const status = el.querySelector(".r3d-status");
  try {
    const [buf] = await Promise.all([cached(`cloud:${rm.id}`, 24 * 60, () => fetchCloud(rm)), loadThree()]);
    if (card3d !== card) return; // 불러오는 사이 닫음
    const north = el.querySelector(".r3d-north");
    const view = mountCloud(el.querySelector(".r3d-view"), rm, buf, (facingNorth) => { north.hidden = facingNorth; });
    north.addEventListener("click", view.faceNorth);
    card.dispose = view.dispose;
    status.textContent = `${fmt(rm.cloud.count)}점 표시 · 원본 ${fmt(rm.lidar.points)}점`;
  } catch (e) {
    if (card3d === card) status.textContent = `불러오지 못했습니다 · ${e.message}`;
  }
}

// 점 파일(Uint16 x·y·z N×3 + Uint8 지면 위 높이 N)을 three.js 좌표(x 동 · y 위 · z 남, 원점 = 주행 경로 평균)로
function mountCloud(el, rm, buf, onFacing) {
  const { count: n, scale, hagScale } = rm.cloud;
  const q = new Uint16Array(buf, 0, n * 3);
  const hag = new Uint8Array(buf, n * 6, n);
  const local = rm.route.local;
  const nodes = Object.values(local);
  const o = [0, 1, 2].map((k) => nodes.reduce((a, v) => a + v[k], 0) / nodes.length);

  const stops = rm.lidar.legend.map(([m, hex]) => [m, hexRgb(hex)]);
  const lut = new Float32Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const m = i * hagScale;
    let j = stops.findIndex(([s]) => s >= m);
    if (j < 0) j = stops.length - 1;
    const [s0, c0] = stops[Math.max(0, j - 1)], [s1, c1] = stops[j];
    const t = s1 > s0 ? Math.min(1, Math.max(0, (m - s0) / (s1 - s0))) : 1;
    for (let k = 0; k < 3; k++) lut[i * 3 + k] = (c0[k] + (c1[k] - c0[k]) * t) / 255;
  }
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = i * 3, c = hag[i] * 3;
    pos[a] = q[a] * scale - o[0];
    pos[a + 1] = q[a + 2] * scale - o[2];
    pos[a + 2] = o[1] - q[a + 1] * scale;
    col[a] = lut[c]; col[a + 1] = lut[c + 1]; col[a + 2] = lut[c + 2];
  }

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  el.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x121814);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.3, 3000);
  camera.position.set(0, 62, 100); // 남쪽 위에서 북쪽을 봄 — 지도와 같은 방향
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = !reduceMotion;
  controls.maxPolarAngle = Math.PI * 0.495;

  const owned = [];
  const add = (obj) => { scene.add(obj); owned.push(obj.geometry, obj.material); return obj; };
  const cloud = new THREE.BufferGeometry();
  cloud.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  cloud.setAttribute("color", new THREE.BufferAttribute(col, 3));
  add(new THREE.Points(cloud, new THREE.PointsMaterial({ size: 0.28, vertexColors: true })));

  const lift = 0.35; // 경로가 지면 점에 묻히지 않게
  const v3 = ([x, y, z]) => new THREE.Vector3(x - o[0], z - o[2] + lift, o[1] - y);
  add(new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(rm.route.edges.flatMap(([a, b]) => [v3(local[a]), v3(local[b])])),
    new THREE.LineBasicMaterial({ color: ROBOT_PATH_HEX }),
  ));
  rm.fences.forEach((f) => add(new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(f.local.map(v3)),
    new THREE.LineBasicMaterial({ color: ROBOT_FENCE_HEX }),
  )));
  add(new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff })))
    .position.copy(v3(local[rm.route.home]));

  // 처음엔 위쪽이 북쪽으로 잠겨 있고(방위각 0 = 북쪽) 좌우로 끌면 풀린다. "북쪽으로"를 누르면 돌아가 다시 잠김
  const UP = new THREE.Vector3(0, 1, 0);
  const arm = new THREE.Vector3();
  let facing = true, turning = false;
  const azimuth = () => Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z);
  function turn(delta) { // target을 축으로 카메라를 수평 회전 (방위각 += delta)
    arm.subVectors(camera.position, controls.target).applyAxisAngle(UP, delta);
    camera.position.copy(controls.target).add(arm);
  }
  function lockNorth() {
    turn(-azimuth());
    controls.minAzimuthAngle = 0;
    controls.maxAzimuthAngle = 0;
    turning = false;
    facing = true;
    onFacing?.(true);
  }
  function unlock() {
    if (!facing) return;
    controls.minAzimuthAngle = -Infinity;
    controls.maxAzimuthAngle = Infinity;
    facing = false;
    onFacing?.(false);
  }
  const faceNorth = () => {
    if (facing) return;
    if (reduceMotion) lockNorth();
    else turning = true; // 갑자기 튀지 않게 프레임마다 조금씩 돌린다
  };
  const turnToNorth = (dt) => {
    const a = azimuth();
    if (Math.abs(a) < 0.01) return lockNorth();
    turn(-Math.sign(a) * Math.min(Math.abs(a), Math.max(0.6, Math.abs(a) * 3.5) * dt));
  };
  lockNorth();

  // WASD 이동 (화면을 누른 뒤에만, Shift 3배). 한글 입력 상태에서도 되게 e.code로 판단
  const MOVE = { KeyW: [0, 1], KeyS: [0, -1], KeyA: [-1, 0], KeyD: [1, 0] };
  const held = new Set();
  let fast = false;
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.addEventListener("pointerdown", () => canvas.focus({ preventScroll: true }));
  let dragFrom = null; // 왼쪽 버튼으로 끌기 시작한 x
  canvas.addEventListener("pointerdown", (e) => { dragFrom = e.button === 0 ? e.clientX : null; });
  canvas.addEventListener("pointermove", (e) => {
    if (dragFrom === null) return;
    if (Math.abs(e.clientX - dragFrom) > 6) { unlock(); dragFrom = null; }
  });
  canvas.addEventListener("pointerup", () => { dragFrom = null; });
  canvas.addEventListener("pointercancel", () => { dragFrom = null; });
  const onKey = (e) => {
    fast = e.shiftKey;
    if (!MOVE[e.code]) return;
    e.preventDefault();
    if (e.type === "keydown") held.add(e.code);
    else held.delete(e.code);
  };
  canvas.addEventListener("keydown", onKey);
  canvas.addEventListener("keyup", onKey);
  canvas.addEventListener("blur", () => held.clear());
  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), step = new THREE.Vector3();
  const walk = (dt) => {
    camera.getWorldDirection(fwd).setY(0);
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 1, 0).applyQuaternion(camera.quaternion).setY(0); // 바로 위에서 볼 때는 화면 위쪽이 앞
    fwd.normalize();
    right.crossVectors(fwd, camera.up).normalize();
    step.set(0, 0, 0);
    held.forEach((code) => step.addScaledVector(right, MOVE[code][0]).addScaledVector(fwd, MOVE[code][1]));
    if (!step.lengthSq()) return;
    step.normalize().multiplyScalar((fast ? 45 : 15) * dt); // m/s
    camera.position.add(step);
    controls.target.add(step);
  };

  let raf = 0, last = performance.now();
  const frame = () => {
    raf = requestAnimationFrame(frame);
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000); // 탭을 오래 비웠다 돌아와도 한 번에 멀리 가지 않게
    last = now;
    if (turning) turnToNorth(dt);
    if (held.size) walk(dt);
    controls.update();
    renderer.render(scene, camera);
  };
  const ro = new ResizeObserver(() => {
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });
  ro.observe(el);
  frame();
  return {
    faceNorth,
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      owned.forEach((x) => x.dispose());
      renderer.dispose();
    },
  };
}
