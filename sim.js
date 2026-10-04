// Orch-OR microtubule simulation for the web. Mirrors the iOS app's model:
// superposition seeds, spreads by orchestration, accumulates ∫E_G dt, and collapses at ħ.
(function () {
  const HBAR = 1.054571817e-34;
  const E_PER_TUBULIN = HBAR / (0.025 * 2e10);   // Hameroff & Penrose 2014 calibration
  const P = 13, R = 30, N = P * R;
  const state = new Uint8Array(N);                // 0 = A, 1 = B, 2 = superposed
  const phase = new Float32Array(N);
  const collapsed = new Uint8Array(N);
  let flash = 0, simTime = 0, action = 0, superposed = 0, events = [], running = true;
  const ctl = { orchestration: 0.6, repExp: 7.7, slow: 40, decoherence: false, decExp: -4 };

  function reset() {
    for (let i = 0; i < N; i++) { state[i] = Math.random() < 0.5 ? 0 : 1; phase[i] = 0; collapsed[i] = 0; }
    flash = 0; simTime = 0; action = 0; superposed = 0; events = [];
  }
  reset();
  const idx = (p, r) => r * P + p;
  function neighbours(i) {
    const p = i % P, r = Math.floor(i / P), out = [];
    if (r > 0) out.push(idx(p, r - 1));
    if (r < R - 1) out.push(idx(p, r + 1));
    out.push(idx((p + 1) % P, r), idx((p + P - 1) % P, r));
    return out;
  }
  const effective = () => superposed * Math.pow(10, ctl.repExp);
  const eG = () => effective() * E_PER_TUBULIN;
  const tau = () => (eG() > 0 ? HBAR / eG() : Infinity);

  function tick(realDt) {
    if (!running) return;
    const dt = realDt / ctl.slow, dtMs = dt * 1000;
    simTime += dt;
    if (Math.random() < 0.03 * dtMs) { const i = Math.floor(Math.random() * N); if (state[i] !== 2) { state[i] = 2; phase[i] = Math.random(); } }
    const recruit = Math.min(1, ctl.orchestration * 0.5 * dtMs);
    const newly = [];
    for (let i = 0; i < N; i++) if (state[i] === 2) for (const n of neighbours(i)) if (state[n] !== 2 && Math.random() < recruit) newly.push(n);
    for (const n of newly) { state[n] = 2; phase[n] = Math.random(); }
    if (ctl.decoherence) { const p = Math.min(1, dt / Math.pow(10, ctl.decExp)); for (let i = 0; i < N; i++) if (state[i] === 2 && Math.random() < p) state[i] = Math.random() < 0.5 ? 0 : 1; }
    superposed = 0; for (let i = 0; i < N; i++) if (state[i] === 2) superposed++;
    action += eG() * dt; if (superposed === 0) action = 0;
    const pulse = dtMs * 0.12; for (let i = 0; i < N; i++) if (state[i] === 2) phase[i] = (phase[i] + pulse) % 1;
    flash = Math.max(0, flash - realDt * 2.5);
    if (flash === 0) collapsed.fill(0);
    if (action >= HBAR && superposed > 0) {
      events.push({ t: simTime, n: superposed, eff: effective(), tau: tau() });
      for (let i = 0; i < N; i++) if (state[i] === 2) { collapsed[i] = 1; state[i] = Math.random() < 0.5 ? 0 : 1; }
      superposed = 0; action = 0; flash = 1;
      if (events.length > 200) events.shift();
    }
  }

  // ---------- three.js scene ----------
  const host = document.getElementById('sim');
  const canvas = document.getElementById('sim-canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x050a17);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100); camera.position.set(7.6, 3.6, 7.6); camera.lookAt(0, 0, 0);
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const light = new THREE.PointLight(0xffffff, 1.1); light.position.set(3, 5, 4); scene.add(light);
  const group = new THREE.Group(); scene.add(group);
  const geo = new THREE.SphereGeometry(0.11, 12, 12);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.05 });
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  const dummy = new THREE.Object3D(); const dz = 0.26;
  for (let r = 0; r < R; r++) for (let p = 0; p < P; p++) {
    const a = p / P * Math.PI * 2, z = r * dz + p * (3 * dz / P) - R * dz / 2;
    dummy.position.set(Math.cos(a), z, Math.sin(a)); dummy.updateMatrix(); mesh.setMatrixAt(idx(p, r), dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true; group.add(mesh);
  const lumen = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.78, R * dz, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.04, side: THREE.DoubleSide }));
  group.add(lumen);
  const cA = new THREE.Color(0.30, 0.70, 0.62), cB = new THREE.Color(0.25, 0.45, 0.95), tmp = new THREE.Color();
  function paint() {
    for (let i = 0; i < N; i++) {
      if (state[i] === 2) { const k = 0.5 + 0.5 * Math.sin(phase[i] * Math.PI * 2); tmp.setRGB(0.55 + 0.4 * k, 0.35 + 0.3 * k, 1.0); }
      else { tmp.copy(state[i] === 0 ? cA : cB); if (collapsed[i]) tmp.lerp(new THREE.Color(1, 1, 1), flash); }
      mesh.setColorAt(i, tmp);
    }
    mesh.instanceColor.needsUpdate = true;
  }
  // drag to rotate, wheel to zoom
  let dragging = false, lx = 0, ly = 0, spin = true;
  canvas.addEventListener('pointerdown', e => { dragging = true; spin = false; lx = e.clientX; ly = e.clientY; });
  window.addEventListener('pointerup', () => dragging = false);
  window.addEventListener('pointermove', e => { if (!dragging) return; group.rotation.y += (e.clientX - lx) * 0.01; group.rotation.x += (e.clientY - ly) * 0.01; lx = e.clientX; ly = e.clientY; });
  canvas.addEventListener('wheel', e => { e.preventDefault(); camera.position.multiplyScalar(e.deltaY > 0 ? 1.08 : 0.92); camera.lookAt(0, 0, 0); }, { passive: false });
  function resize() { const w = host.clientWidth, h = Math.min(520, Math.max(320, w * 0.75)); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  window.addEventListener('resize', resize); resize();

  // ---------- UI ----------
  const $ = id => document.getElementById(id);
  const fmtTime = t => !isFinite(t) ? 'never' : t >= 1 ? t.toFixed(2) + ' s' : t >= 1e-3 ? (t * 1e3).toFixed(1) + ' ms' : t >= 1e-6 ? (t * 1e6).toFixed(1) + ' µs' : t >= 1e-9 ? (t * 1e9).toFixed(1) + ' ns' : t >= 1e-12 ? (t * 1e12).toFixed(1) + ' ps' : (t * 1e15).toFixed(1) + ' fs';
  const fmtSci = (x, u) => x === 0 ? '0 ' + u : x.toExponential(2).replace('e', '×10^') + ' ' + u;
  const compact = x => x >= 1e9 ? (x / 1e9).toFixed(1) + ' B' : x >= 1e6 ? (x / 1e6).toFixed(1) + ' M' : x >= 1e3 ? (x / 1e3).toFixed(1) + ' k' : x.toFixed(0);
  function rate() { if (events.length < 2) return null; const r = events.slice(-6); const span = r[r.length - 1].t - r[0].t; return span > 0 ? (r.length - 1) / span : null; }
  function readouts() {
    $('ro-sup').textContent = superposed + ' / ' + N; $('ro-eff').textContent = compact(effective()) + ' tubulins';
    $('ro-eg').textContent = fmtSci(eG(), 'J'); $('ro-tau').textContent = fmtTime(tau()); $('ro-ev').textContent = events.length;
    const f = rate(); $('ro-rate').textContent = f ? f.toFixed(0) + ' Hz' : '—';
    $('ro-bar').style.width = (Math.min(1, action / HBAR) * 100).toFixed(0) + '%';
    $('flash').style.opacity = (flash * 0.55).toFixed(2);
  }
  $('c-orch').oninput = e => { ctl.orchestration = +e.target.value; $('v-orch').textContent = ctl.orchestration.toFixed(2); };
  $('c-rep').oninput = e => { ctl.repExp = +e.target.value; $('v-rep').textContent = '10^' + ctl.repExp.toFixed(1); };
  $('c-slow').oninput = e => { ctl.slow = +e.target.value; $('v-slow').textContent = ctl.slow + '×'; };
  $('c-dec').onchange = e => { ctl.decoherence = e.target.checked; $('dec-row').style.display = ctl.decoherence ? '' : 'none'; };
  $('c-decexp').oninput = e => { ctl.decExp = +e.target.value; $('v-dec').textContent = fmtTime(Math.pow(10, ctl.decExp)); };
  $('b-teg').onclick = () => { ctl.decExp = -13; $('c-decexp').value = -13; $('v-dec').textContent = fmtTime(1e-13); };
  $('b-hag').onclick = () => { ctl.decExp = -4; $('c-decexp').value = -4; $('v-dec').textContent = fmtTime(1e-4); };
  $('b-run').onclick = () => { running = !running; $('b-run').textContent = running ? 'Pause' : 'Run'; };
  $('b-reset').onclick = reset;

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    tick(dt); paint(); readouts();
    if (spin) group.rotation.y += dt * 0.15;
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
