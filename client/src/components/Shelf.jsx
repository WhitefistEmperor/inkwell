// The landing page's 3D bookshelf (Three.js). Every book is a real article:
// its cover is drawn on a <canvas> from the title and author, and clicking it
// opens the article. Books near the pointer rise in a springy wave.
//
// This file is loaded lazily (see Cover.jsx), so the Three.js bundle is only
// downloaded by signed-out visitors who actually see the shelf.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const MAX_BOOKS = 32;
const MIN_BOOKS = 18; // with fewer articles than this, the row repeats them so it still fills the screen

// [cover colour, ink colour, motif colour]
const PALETTE = [
  ['#2c4f63', '#f4efe3', '#e9b44c'], ['#195433', '#f1ead6', '#9fd3a8'], ['#c62420', '#fff4e6', '#1a1414'],
  ['#f4f3ef', '#16161a', '#c62420'], ['#2d86cf', '#ffffff', '#0d2f52'], ['#f7d547', '#17140a', '#17140a'],
  ['#494e68', '#f3efe6', '#f08a5d'], ['#f2ecde', '#1d1a16', '#d1392b'], ['#0c0b0b', '#f5f1e8', '#f5f1e8'],
  ['#013eb0', '#ffffff', '#f7d547'], ['#0a291c', '#e8f0e4', '#c9a227'], ['#ae4716', '#fff1e0', '#2a1206'],
  ['#021f42', '#f3e9c8', '#d9b44a'], ['#b8acd3', '#1b1530', '#1b1530'], ['#076368', '#eafaf6', '#f2c14e'],
  ['#f57664', '#2a0f0b', '#fff3ea'],
];

// A small, stable hash, so an article always gets the same cover.
function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

// Splits a title into lines that fit `maxWidth` at the current ctx.font.
function wrap(ctx, text, maxWidth) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Draws one book cover: a colour field, the title, one simple motif, the author.
function drawCover(article) {
  const W = 400;
  const H = 600;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const seed = hash(article.slug);
  const [paper, ink, accent] = PALETTE[seed % PALETTE.length];

  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, W, H);

  // Motif in the lower half, so it never fights the title.
  ctx.fillStyle = accent;
  ctx.strokeStyle = accent;
  switch ((seed >>> 8) % 6) {
    case 0: // disc
      ctx.beginPath();
      ctx.arc(W / 2, 410, 105, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 1: // ruled lines
      for (let i = 0; i < 8; i++) ctx.fillRect(36, 330 + i * 24, W - 72, 9);
      break;
    case 2: // diagonal band
      ctx.beginPath();
      ctx.moveTo(0, 470);
      ctx.lineTo(W, 300);
      ctx.lineTo(W, 380);
      ctx.lineTo(0, 550);
      ctx.fill();
      break;
    case 3: // dot grid
      for (let r = 0; r < 5; r++) for (let c = 0; c < 7; c++) {
        ctx.beginPath();
        ctx.arc(52 + c * 49, 330 + r * 44, 8, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 4: // ripples from the corner
      ctx.lineWidth = 7;
      for (let r = 50; r <= 250; r += 40) {
        ctx.beginPath();
        ctx.arc(0, H, r, -Math.PI / 2, 0);
        ctx.stroke();
      }
      break;
    default: // rising sun
      ctx.beginPath();
      ctx.arc(W / 2, 520, 150, Math.PI, Math.PI * 2);
      ctx.fill();
  }

  // Title: shrink the type until it fits in five lines.
  ctx.fillStyle = ink;
  ctx.textBaseline = 'top';
  let size = 56;
  let lines;
  do {
    ctx.font = `800 ${size}px Alegreya, Georgia, serif`;
    lines = wrap(ctx, article.title, W - 72);
    size -= 4;
  } while (lines.length > 5 && size > 26);
  lines.slice(0, 5).forEach((line, i) => ctx.fillText(line, 36, 40 + i * (size + 8)));

  ctx.font = '500 24px "Alegreya Sans", system-ui, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(article.author.username, 36, H - 34);

  return { canvas, colour: paper };
}

// The page edges of a closed book: cream with faint lines.
function pageTexture(vertical) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#efe7d6';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 256; i += 2) {
    ctx.fillStyle = `rgba(96, 72, 44, ${0.05 + Math.random() * 0.12})`;
    if (vertical) ctx.fillRect(i, 0, 1, 256);
    else ctx.fillRect(0, i, 256, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export default function Shelf({ articles, onHover, onOpen }) {
  const canvasRef = useRef(null);
  // Keep the latest callbacks without restarting the whole scene when they change.
  const callbacks = useRef({ onHover, onOpen });
  callbacks.current = { onHover, onOpen };

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas.parentElement;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    let disposed = false;
    let frame = 0;
    const cleanups = [];

    async function start() {
      // Covers are drawn with the web fonts, so wait until they are ready.
      await Promise.all([
        document.fonts.load('800 56px Alegreya'),
        document.fonts.load('500 24px "Alegreya Sans"'),
      ]).catch(() => {});
      if (disposed) return;

      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.outputColorSpace = THREE.SRGBColorSpace;

      const scene = new THREE.Scene();
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environmentIntensity = 0.55;

      const key = new THREE.DirectionalLight('#fff3e4', 2.4);
      key.position.set(-4, 6, 6);
      const rim = new THREE.DirectionalLight('#bfd2ff', 1.1);
      rim.position.set(6, 3, -4);
      scene.add(key, rim, new THREE.AmbientLight('#ffffff', 0.12));

      const camera = new THREE.PerspectiveCamera(19.5, 1, 0.1, 100);
      camera.position.set(3.6, 2.15, 7.4);
      camera.lookAt(-1.4, 0.05, -0.6);

      // ---- books ----
      const list = articles.slice(0, MAX_BOOKS);
      const count = Math.min(MAX_BOOKS, Math.max(MIN_BOOKS, list.length));
      const geometry = new THREE.BoxGeometry(1, 1.5, 0.2);
      const edgeH = new THREE.MeshStandardMaterial({ map: pageTexture(false), roughness: 0.9 });
      const edgeV = new THREE.MeshStandardMaterial({ map: pageTexture(true), roughness: 0.9 });
      const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

      const books = [];
      for (let i = 0; i < count; i++) {
        const article = list[i % list.length];
        const { canvas: coverCanvas, colour } = drawCover(article);
        const cover = new THREE.CanvasTexture(coverCanvas);
        cover.colorSpace = THREE.SRGBColorSpace;
        cover.anisotropy = maxAnisotropy;
        const cloth = new THREE.Color(colour).multiplyScalar(0.62);

        // Box faces in order: +x fore-edge, -x spine, +y top, -y bottom, +z cover, -z back.
        const mesh = new THREE.Mesh(geometry, [
          edgeH,
          new THREE.MeshPhysicalMaterial({ color: cloth, roughness: 0.55, clearcoat: 0.3 }),
          edgeV,
          edgeV,
          new THREE.MeshPhysicalMaterial({ map: cover, roughness: 0.42, clearcoat: 0.55, clearcoatRoughness: 0.35 }),
          new THREE.MeshStandardMaterial({ color: cloth, roughness: 0.6 }),
        ]);
        mesh.position.y = reduceMotion ? 0 : -3; // the intro lifts each book into place
        mesh.userData.index = i;

        // i = 0 is the front book at the bottom right; the row runs back and to the left.
        const group = new THREE.Group();
        group.position.set(1.55 - i * 0.5, -1.12, 0.9 - i * 0.2);
        group.rotation.y = 0.32;
        group.add(mesh);
        scene.add(group);
        books.push({ mesh, article, y: mesh.position.y, vy: 0, z: 0, vz: 0, sx: 0, sy: 0 });
      }
      const meshes = books.map((b) => b.mesh);

      // ---- sizing ----
      let width = 1;
      let height = 1;
      function resize() {
        width = host.clientWidth;
        height = host.clientHeight;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.fov = width < height ? 40 : 19.5; // wider lens on phones
        camera.updateProjectionMatrix();
      }
      resize();
      window.addEventListener('resize', resize);
      cleanups.push(() => window.removeEventListener('resize', resize));

      // ---- pointer ----
      const pointer = { x: 0, y: 0, active: false, movedAt: -Infinity };
      const raycaster = new THREE.Raycaster();
      const ndc = new THREE.Vector2();
      let hovered = -1;

      function bookUnder(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
        raycaster.setFromCamera(ndc, camera);
        const hit = raycaster.intersectObjects(meshes, false)[0];
        return hit ? hit.object.userData.index : -1;
      }

      function onMove(e) {
        const rect = canvas.getBoundingClientRect();
        pointer.x = e.clientX - rect.left;
        pointer.y = e.clientY - rect.top;
        pointer.active = pointer.y >= 0 && pointer.y <= rect.height;
        pointer.movedAt = performance.now();

        const index = pointer.active ? bookUnder(e.clientX, e.clientY) : -1;
        if (index !== hovered) {
          hovered = index;
          host.style.cursor = index >= 0 ? 'pointer' : '';
          callbacks.current.onHover?.(index >= 0 ? books[index].article : null);
        }
      }
      const onLeave = () => {
        pointer.active = false;
      };
      // Clicks are handled on the section, not the canvas: the canvas ignores
      // pointer events so the links drawn underneath it stay clickable.
      function onClick(e) {
        if (e.target.closest('a, button')) return;
        const index = bookUnder(e.clientX, e.clientY);
        if (index >= 0) callbacks.current.onOpen?.(books[index].article);
      }
      window.addEventListener('pointermove', onMove);
      document.documentElement.addEventListener('pointerleave', onLeave);
      window.addEventListener('blur', onLeave);
      host.addEventListener('click', onClick);
      cleanups.push(() => {
        window.removeEventListener('pointermove', onMove);
        document.documentElement.removeEventListener('pointerleave', onLeave);
        window.removeEventListener('blur', onLeave);
        host.removeEventListener('click', onClick);
        host.style.cursor = '';
      });

      // ---- animation ----
      const K = 70;    // spring stiffness
      const C = 12.5;  // damping
      const point = new THREE.Vector3();
      const startedAt = performance.now();
      let last = startedAt;

      function tick(now) {
        frame = requestAnimationFrame(tick);
        if (host.getBoundingClientRect().bottom < 0) return; // scrolled out of view: do no work

        const t = (now - startedAt) / 1000;
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;

        // Where each book sits on screen, in pixels.
        for (const book of books) {
          point.set(0, 0.1, 0);
          book.mesh.localToWorld(point).project(camera);
          book.sx = ((point.x + 1) / 2) * width;
          book.sy = ((1 - point.y) / 2) * height;
        }

        // The point the wave follows: the real pointer, or, on touch screens and
        // after 4 idle seconds, a virtual one that sweeps along the row.
        let px = pointer.x;
        let py = pointer.y;
        let active = pointer.active;
        if (!reduceMotion && (coarse || now - pointer.movedAt > 4000)) {
          const u = (Math.sin(t * 0.45) + 1) / 2;
          const from = books[1];
          const to = books[count - 3];
          px = from.sx + (to.sx - from.sx) * u;
          py = from.sy + (to.sy - from.sy) * u;
          active = true;
        }

        const spread = Math.max(width, height) * 0.085;
        const h = dt / 4; // four sub-steps keep the springs stable at any frame rate
        books.forEach((book, i) => {
          const dx = book.sx - px;
          const dy = (book.sy - py) * 0.55;
          const influence = active ? Math.exp(-(dx * dx + dy * dy) / (spread * spread)) : 0;
          const lift = 0.78 * influence;
          // Intro: the row rises from the back to the front.
          const waiting = !reduceMotion && t < 0.25 + (count - i) * 0.035;
          const targetY = waiting ? -3 : lift;
          const targetZ = lift * 0.35;

          for (let step = 0; step < 4; step++) {
            book.vy += ((targetY - book.y) * K - book.vy * C) * h;
            book.y += book.vy * h;
            book.vz += ((targetZ - book.z) * K - book.vz * C) * h;
            book.z += book.vz * h;
          }
          book.mesh.position.y = book.y;
          book.mesh.position.z = book.z;
          book.mesh.rotation.x = -book.vy * 0.012; // lean a little while moving
        });

        renderer.render(scene, camera);
      }
      frame = requestAnimationFrame(tick);

      cleanups.push(() => {
        geometry.dispose();
        pmrem.dispose();
        for (const mesh of meshes) for (const m of mesh.material) {
          m.map?.dispose();
          m.dispose();
        }
        renderer.dispose();
      });
    }

    start();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      cleanups.forEach((fn) => fn());
    };
  }, [articles]);

  // Decorative for assistive technology: the same articles are listed as
  // ordinary links further down the page.
  return <canvas ref={canvasRef} className="shelf" aria-hidden="true" />;
}
