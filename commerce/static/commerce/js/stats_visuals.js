/* Three.js accent for the Statistics dashboard header: a subtle golden particle drift
   and a small moon behind the copy. Live trade visuals are handled in 2D by
   stats_dashboard.js; this layer stays intentionally quiet.
   Static single frame when the user prefers reduced motion. */
(function () {
  "use strict";

  const STAR_COUNT = 520;

  function init() {
    const host = document.getElementById("statsHeroScene");
    if (!host || typeof THREE === "undefined") return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x102324, 0.028);

    const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 120);
    camera.position.set(0, 0.4, 16);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    host.appendChild(renderer.domElement);

    // Golden starfield drifting slowly toward the camera.
    const starGeometry = new THREE.BufferGeometry();
    const starPositions = new Float32Array(STAR_COUNT * 3);
    const starSeeds = new Float32Array(STAR_COUNT);
    for (let i = 0; i < STAR_COUNT; i += 1) {
      starPositions[i * 3] = (Math.random() - 0.5) * 60;
      starPositions[i * 3 + 1] = (Math.random() - 0.5) * 34;
      starPositions[i * 3 + 2] = (Math.random() - 0.5) * 60;
      starSeeds[i] = Math.random() * Math.PI * 2;
    }
    starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    const starMaterial = new THREE.PointsMaterial({
      color: 0xf4bd2a,
      size: 0.11,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const stars = new THREE.Points(starGeometry, starMaterial);
    scene.add(stars);

    // Secondary cool-white dust layer for depth.
    const dustGeometry = new THREE.BufferGeometry();
    const dustPositions = new Float32Array(240 * 3);
    for (let i = 0; i < 240; i += 1) {
      dustPositions[i * 3] = (Math.random() - 0.5) * 80;
      dustPositions[i * 3 + 1] = (Math.random() - 0.5) * 40;
      dustPositions[i * 3 + 2] = (Math.random() - 0.5) * 80;
    }
    dustGeometry.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
    const dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({
      color: 0x9fd8e8,
      size: 0.05,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    scene.add(dust);

    // The moon: a softly lit sphere with a golden wire halo.
    const moonGroup = new THREE.Group();
    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(1.6, 36, 36),
      new THREE.MeshStandardMaterial({ color: 0xd8dee6, roughness: 0.92, metalness: 0.05, emissive: 0x233042, emissiveIntensity: 0.5 })
    );
    moonGroup.add(moon);
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(1.7, 22, 22),
      new THREE.MeshBasicMaterial({ color: 0xf4bd2a, wireframe: true, transparent: true, opacity: 0.07 })
    );
    moonGroup.add(halo);
    moonGroup.position.set(8.6, 0.9, -7);
    scene.add(moonGroup);

    scene.add(new THREE.AmbientLight(0x8f9fb2, 0.75));
    const keyLight = new THREE.DirectionalLight(0xf4bd2a, 1.15);
    keyLight.position.set(-6, 4, 8);
    scene.add(keyLight);

    // Live data hook: price ticks give the moon a gentle pulse.
    let pulse = 0;
    document.addEventListener("doge:price", () => {
      pulse = Math.min(1, pulse + 0.35);
    });

    // Gentle parallax from pointer position.
    let targetX = 0;
    let targetY = 0;
    host.parentElement?.addEventListener("pointermove", (event) => {
      const rect = host.getBoundingClientRect();
      targetX = ((event.clientX - rect.left) / rect.width - 0.5) * 1.4;
      targetY = ((event.clientY - rect.top) / rect.height - 0.5) * 0.8;
    });

    function resize() {
      const width = host.clientWidth || 1;
      const height = host.clientHeight || 1;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    }
    resize();
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(resize).observe(host);
    else window.addEventListener("resize", resize);

    let lastFrame = performance.now();
    function frame(now) {
      renderStep(now);
      if (!reducedMotion) requestAnimationFrame(frame);
    }

    function renderStep(now) {
      const delta = Math.min(0.05, (now - lastFrame) / 1000);
      lastFrame = now;
      stars.rotation.y += delta * 0.02;
      dust.rotation.y -= delta * 0.008;
      const positions = starGeometry.getAttribute("position");
      const drift = delta * 0.55;
      for (let i = 0; i < STAR_COUNT; i += 1) {
        let z = positions.getZ(i) + drift;
        if (z > 30) z = -30;
        positions.setZ(i, z);
        positions.setY(i, positions.getY(i) + Math.sin(now * 0.00045 + starSeeds[i]) * delta * 0.16);
      }
      positions.needsUpdate = true;
      moonGroup.rotation.y += delta * 0.05;
      halo.rotation.x += delta * 0.09;
      pulse = Math.max(0, pulse - delta * 1.2);
      const scale = 1 + pulse * 0.05;
      moonGroup.scale.set(scale, scale, scale);
      camera.position.x += (targetX - camera.position.x) * 0.04;
      camera.position.y += (0.4 - targetY - camera.position.y) * 0.04;
      camera.lookAt(0, 0.2, -4);
      renderer.render(scene, camera);
    }

    renderer.render(scene, camera);
    if (!reducedMotion) requestAnimationFrame(frame);

    window.dogeStatsScene = {
      renderOnce: () => renderer.render(scene, camera),
      stepFrame: (ms) => renderStep(performance.now() + (ms || 16)),
    };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
