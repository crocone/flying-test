// Страница стенда: четыре экрана по сценарию А (ТЗ, разделы 3 и 8) — ввод, допущения, стенд, отчёт.
// Физика — в src/core; тяжёлые многократные прогоны — в фоновом потоке (worker.ts).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { PRESETS } from '../presets/index.ts';
import { ProgramRun, PROGRAMS, type ProgramId } from '../core/programs.ts';
import { analyze } from '../core/analyze.ts';
import type { Assumption, Spec } from '../core/spec.ts';
import { MATERIALS, GROUP_NAMES, DATA_KIND_NAMES, type MaterialGroup } from '../core/materials.ts';
import { getLang, isEn, setLang, td, tr, U, unit, type Lang } from '../core/i18n.ts';
import { modeName } from '../core/strength.ts';
import { SpecError, type PartModel } from '../core/sim.ts';
import type { Design } from '../core/design.ts';
import type { ImageAnalysis } from '../server/generate.ts';
import { baseAssumptions, buildVehicle, decodeState, encodeState, programOptions, wireState, type TestState } from '../core/vehicle.ts';
import { buildReport, partNames, resultDigest, type Report } from '../core/report.ts';
import { raz } from '../core/analyze.ts';
import { parseShare, type Snapshot } from '../core/share.ts';
import { chartData, type ChartData } from './snapshot.ts';
import { add, fromArr, rotate, type V3 } from '../core/vec.ts';
import { Replay, Series } from './recorder.ts';
import { Airflow } from './airflow.ts';
import { reproRun } from '../core/repro.ts';
import type { Job, JobReply } from './worker.ts';
declare const __DEMO__: boolean; // vite.config.ts: демо без сервера (GitHub Pages)

// ---------- язык ----------
// ?lang= в адресе → выбор, сохранённый в этом браузере → язык браузера.
function pickLang(): Lang {
  const q = new URLSearchParams(location.search).get('lang');
  if (q === 'ru' || q === 'en') return q;
  try {
    const saved = localStorage.getItem('lang');
    if (saved === 'ru' || saved === 'en') return saved;
  } catch { /* приватный режим */ }
  return /^ru|^ru-/i.test(navigator.language) || (navigator.languages ?? []).some((l) => /^ru/i.test(l)) ? 'ru' : 'en';
}
setLang(pickLang());
document.documentElement.lang = getLang();
if (isEn()) {
  // Разметка: у элемента data-en — английский текст, data-en-placeholder / -title / -aria — атрибуты.
  for (const e of document.querySelectorAll<HTMLElement>('[data-en]')) e.textContent = e.dataset.en!;
  for (const e of document.querySelectorAll<HTMLElement>('[data-en-placeholder]')) e.setAttribute('placeholder', e.dataset.enPlaceholder!);
  for (const e of document.querySelectorAll<HTMLElement>('[data-en-title]')) e.title = e.dataset.enTitle!;
  for (const e of document.querySelectorAll<HTMLElement>('[data-en-aria]')) e.setAttribute('aria-label', e.dataset.enAria!);
  document.title = 'Vehicle test stand';
}
{
  const b = document.getElementById('langBtn');
  if (b) {
    b.textContent = isEn() ? 'Русский' : 'English';
    b.addEventListener('click', () => {
      const next: Lang = isEn() ? 'ru' : 'en';
      try { localStorage.setItem('lang', next); } catch { /* приватный режим */ }
      const u = new URL(location.href);
      u.searchParams.set('lang', next);
      location.href = u.toString(); // всё перестраивается на новом языке; состояние — в адресе
    });
  }
}

await RAPIER.init();

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const nf = new Intl.NumberFormat(isEn() ? 'en-US' : 'ru-RU', { maximumSignificantDigits: 3 });
const fmt = (x: number | undefined) => (x !== undefined && Number.isFinite(x) ? nf.format(Math.abs(x) < 1e-6 ? 0 : x) : '—');
const power = (w: number) => (Math.abs(w) >= 1e6 ? `${fmt(w / 1e6)} ${U.MW}` : Math.abs(w) >= 1e3 ? `${fmt(w / 1e3)} ${U.kW}` : `${fmt(w)} ${U.W}`);
const dec = (x: number, d: number) => x.toFixed(d).replace('.', isEn() ? '.' : ',');
const el = (tag: string, text?: string, cls?: string) => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text; // всё, что могло прийти от ИИ или из ссылки, — только текстом
  if (cls) e.className = cls;
  return e;
};

// ---------- аппараты ----------
const GALLERY: Record<string, { about: string; program: ProgramId }> = {
  ornithopter: { about: tr('Махолёт по мотивам «Дюны»: 8 крыльев, 10 т', 'Ornithopter after “Dune”: 8 wings, 10 t'), program: 'tethered' },
  cessna172: { about: tr('Лёгкий самолёт — эталон сваливания и крейсера', 'Light aircraft — stall and cruise reference'), program: 'flight' },
  r22: { about: tr('Лёгкий вертолёт — эталон мощности висения', 'Light helicopter — hover power reference'), program: 'hover' },
  quadcopter: { about: tr('Квадрокоптер класса Phantom 4', 'Phantom 4 class quadcopter'), program: 'hover' },
  smartbird: { about: tr('Робот-птица Festo, 0,45 кг', 'Festo robotic bird, 0.45 kg'), program: 'free' },
  snowbird: { about: tr('Мускулолёт с машущими крыльями, 2010 г.', 'Human-powered ornithopter, 2010'), program: 'free' },
};
interface Generated { design: Design; info: string; imageNote?: string[] }
const GENERATED: Record<string, Generated> = {};
let genCount = 0;

let vehicleId = 'ornithopter';
const state: TestState = { vehicle: { preset: 'ornithopter' }, overrides: {}, program: 'tethered', breakable: true, altitude: 0 };

function setVehicle(id: string) {
  vehicleId = id;
  state.vehicle = GENERATED[id] ? { design: GENERATED[id].design, info: GENERATED[id].info } : { preset: id };
  state.overrides = {};
}

function vehicleClass(): Spec['meta']['class'] {
  return GENERATED[vehicleId] ? (GENERATED[vehicleId].design.vehicleClass as Spec['meta']['class']) : PRESETS[vehicleId].meta.class;
}

function defaultProgram(): ProgramId {
  const g = GALLERY[vehicleId];
  if (g) return g.program;
  // Махолёт, собранный по описанию как «птица» (задана скорость полёта вперёд), — сразу в свободный полёт.
  const fl = GENERATED[vehicleId]?.design.flapping;
  if (fl && (fl.cruiseSpeed ?? 0) > 0) return 'free';
  return vehicleClass() === 'fixed-wing' ? 'flight' : 'hover';
}

// ---------- выбор ----------
for (const [id, p] of Object.entries(PROGRAMS)) $('program').append(new Option(p.name, id));
const matSel = $<HTMLSelectElement>('material');
matSel.append(new Option(tr('как в спецификации', 'as in the specification'), ''));
for (const g of Object.keys(GROUP_NAMES) as MaterialGroup[]) {
  const items = Object.values(MATERIALS).filter((m) => m.group === g);
  if (!items.length) continue;
  const og = document.createElement('optgroup');
  og.label = td(GROUP_NAMES[g]);
  for (const m of items) og.append(new Option(td(m.name), m.id));
  matSel.append(og);
}

function buildGallery() {
  const box = $('gallery');
  box.innerHTML = '';
  const items: [string, string, string][] = [
    ...Object.keys(GENERATED).map((id): [string, string, string] => [id, GENERATED[id].design.name, tr('собран по описанию', 'built from a description')]),
    ...Object.entries(PRESETS).map(([id, s]): [string, string, string] => [id, td(s.meta.name), GALLERY[id]?.about ?? '']),
  ];
  for (const [id, name, about] of items) {
    const b = el('button');
    b.append(el('b', name), el('span', about));
    b.setAttribute('aria-pressed', String(id === vehicleId));
    b.addEventListener('click', () => {
      setVehicle(id);
      state.program = defaultProgram();
      syncInputs();
      $('genInfo').textContent = GENERATED[id]?.info ?? '';
      showImageNote(GENERATED[id]?.imageNote);
      buildGallery();
      buildAssumptions();
      rebuild();
      go('assume');
    });
    box.append(b);
  }
}

// ---------- экраны ----------
type Screen = 'input' | 'assume' | 'stand' | 'report';
let screen: Screen = 'input';
function go(s: Screen) {
  if (s === 'report' && rview?.source === 'stored' && !run?.done) return showReportScreen();
  if (s === 'report') {
    if (!run) return;
    if (!run.done) {
      pendingReport = true;
      startFinish();
      go('stand');
      return;
    }
    openReport();
  }
  screen = s;
  $('report').hidden = s !== 'report';
  for (const sec of document.querySelectorAll<HTMLElement>('aside [data-screen]')) sec.hidden = sec.dataset.screen !== s;
  for (const b of document.querySelectorAll<HTMLButtonElement>('nav.steps button')) {
    if (b.dataset.go === s) b.setAttribute('aria-current', 'step');
    else b.removeAttribute('aria-current');
  }
  if (s !== 'report') resize();
}
document.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-go]');
  if (t && !(t as HTMLButtonElement).disabled) go(t.dataset.go as Screen);
});

// ---------- допущения ----------
const CONF: Record<Assumption['confidence'], string> = { high: tr('данные', 'data'), medium: tr('оценка', 'estimate'), low: tr('догадка', 'guess') };
function showValue(a: Pick<Assumption, 'unit'>, v: number): string {
  if (a.unit === 'Вт') return power(v);
  if (a.unit === 'м' && v < 0.1) return `${fmt(v * 1000)} ${U.mm}`;
  if (!a.unit) return fmt(v);
  return `${fmt(v)} ${unit(a.unit)}`;
}
function buildAssumptions() {
  const box = $('assumptions');
  box.innerHTML = '';
  const order = { low: 0, medium: 1, high: 2 };
  for (const a of [...baseAssumptions(state.vehicle)].sort((x, y) => order[x.confidence] - order[y.confidence])) {
    const v = state.overrides[a.path] ?? a.value;
    const min = a.min ?? v / 5;
    const max = a.max ?? v * 5;
    const step = a.step ?? (max - min) / 200;
    const div = el('div', undefined, `ctl ${a.confidence === 'low' ? 'low' : ''}`);
    const head = el('div', undefined, 'head');
    const reset = el('button', tr('↺ исходное', '↺ original'), 'reset') as HTMLButtonElement;
    reset.title = tr(`Вернуть ${showValue(a, a.value)}`, `Back to ${showValue(a, a.value)}`);
    head.append(el('span', td(a.label)), el('span', CONF[a.confidence], `conf ${a.confidence}`), reset);
    const out = el('output');
    const input = document.createElement('input');
    Object.assign(input, { type: 'range', min: String(min), max: String(max), step: String(step), value: String(v) });
    const why = el('div', (a.origin === 'user' ? tr('Из описания: ', 'From the description: ') : a.origin === 'source' ? tr('По источнику: ', 'From the source: ') : a.origin === 'image' ? tr('С картинки: ', 'From the image: ') : '') + td(a.reason), 'why');
    div.append(head, out, input, why);
    const mark = () => {
      const x = state.overrides[a.path] ?? a.value;
      out.textContent = showValue(a, x);
      const changed = a.path in state.overrides && Math.abs(x - a.value) > 1e-12 * Math.max(1, Math.abs(a.value));
      div.classList.toggle('changed', changed);
      reset.hidden = !changed;
      $<HTMLButtonElement>('resetAll').disabled = !Object.keys(state.overrides).length;
    };
    input.addEventListener('input', () => {
      state.overrides[a.path] = Number(input.value);
      mark();
      rebuild();
    });
    reset.addEventListener('click', () => {
      delete state.overrides[a.path];
      input.value = String(a.value);
      mark();
      rebuild();
    });
    mark();
    box.append(div);
  }
  $<HTMLButtonElement>('resetAll').disabled = !Object.keys(state.overrides).length;
}
$('resetAll').addEventListener('click', () => {
  state.overrides = {};
  buildAssumptions();
  rebuild();
});

// ---------- сцена ----------
const view = $('view');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
view.prepend(renderer.domElement);
// Чёрно-белая графика: чёрная заливка, белый контур — как карандашный рисунок мелом по чёрному.
const INK = 0xffffff;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.Fog(0x000000, 150, 1800);
const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 5000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
// Земля с сеткой — одна поверхность, сетка считается в шейдере. Раньше это были плоскость и GridHelper
// в 1 см над ней: белые линии в пиксель на чёрном давали муар вдали и мерцали по глубине при повороте камеры.
// Здесь линии сглажены по ширине пикселя (fwidth), гаснут там, где клетка мельче пары пикселей, и с расстоянием.
const groundMat = new THREE.ShaderMaterial({
  uniforms: { uShift: { value: new THREE.Vector2() }, uCam: { value: new THREE.Vector3() }, uFade: { value: 900 } },
  vertexShader: `
    varying vec3 vWorld;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: `
    uniform vec2 uShift;
    uniform vec3 uCam;
    uniform float uFade;
    varying vec3 vWorld;
    float gridLine(vec2 p, float cell) {
      vec2 c = p / cell;
      vec2 w = fwidth(c);
      vec2 g = abs(fract(c - 0.5) - 0.5) / max(w, 1e-6);
      float line = 1.0 - min(min(g.x, g.y), 1.0);
      return line * (1.0 - smoothstep(0.08, 0.35, max(w.x, w.y)));
    }
    void main() {
      vec2 p = vWorld.xz - uShift;
      float a = 0.17 * gridLine(p, 10.0) + 0.06 * gridLine(p, 1.0) + 0.12 * gridLine(p, 100.0);
      float d = length(vWorld.xz - uCam.xz);
      a *= 1.0 - smoothstep(uFade * 0.25, uFade, d);
      gl_FragColor = vec4(vec3(min(a, 0.4)), 1.0);
    }`,
});
const ground = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), groundMat);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// Горизонт: гряды холмов тонкой линией, как на заднем плане рисунка. Туман их не гасит — они и есть даль.
const horizon = new THREE.Group();
{
  const ridge = (R: number, hMax: number, seed: number, opacity: number) => {
    const n = 720;
    const pts: number[] = [];
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      let h = 0;
      for (let k = 1; k <= 5; k++) h += Math.sin(a * (2 + 3 * k) + seed * k * 1.7) / k + 0.6 * Math.sin(a * (5 * k + 1) - seed * 0.7) / (k * k);
      h = Math.max(0, h * 0.45 + 0.25) * hMax;
      pts.push(Math.cos(a) * R, h, Math.sin(a) * R);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return new THREE.Line(g, new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity, fog: false, depthWrite: false }));
  };
  horizon.add(ridge(2400, 150, 1.3, 0.55), ridge(2700, 260, 4.1, 0.3), ridge(3000, 380, 7.7, 0.16));
  scene.add(horizon);
}

// Отвес от центра масс до земли и кольцо под аппаратом — высота читается без тени.
const plumb = new THREE.Group();
{
  const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)]);
  const line = new THREE.Line(lineGeo, new THREE.LineDashedMaterial({ color: INK, transparent: true, opacity: 0.35, dashSize: 0.12, gapSize: 0.1 }));
  line.computeLineDistances();
  const ringPts = Array.from({ length: 65 }, (_, i) => {
    const a = (i / 64) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
  });
  const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPts), new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.4 }));
  const cross = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-1.25, 0, 0), new THREE.Vector3(1.25, 0, 0), new THREE.Vector3(0, 0, -1.25), new THREE.Vector3(0, 0, 1.25)]),
    new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.25 }),
  );
  plumb.add(line, ring, cross);
  scene.add(plumb);
}
function drawPlumb() {
  if (!run) {
    plumb.visible = false;
    return;
  }
  const c = vehicleCom();
  const [line, ring, cross] = plumb.children as THREE.Object3D[];
  plumb.visible = c.y > 0.02;
  plumb.position.set(c.x, 0.015, c.z);
  const h = Math.max(1e-3, c.y - 0.015);
  line.scale.set(1, h, 1);
  // Штрих отвеса — в метрах, поэтому шаг пунктира задаём через масштаб материала.
  const m = (line as THREE.Line).material as THREE.LineDashedMaterial;
  m.dashSize = m.gapSize = Math.max(0.02, sizeR * 0.04) / h;
  const r = sizeR * 0.35;
  ring.scale.setScalar(r);
  cross.scale.setScalar(r);
}

// Воздух: линии тока вокруг аппарата (src/web/airflow.ts) и сетка земли, уходящая назад в трубе.
const airflow = new Airflow();
scene.add(airflow.object);
let flowDist = 0; // путь воздуха мимо аппарата, м
let flowLastT = 0;
const gridShift = { x: 0, z: 0 };
function drawFlow(dtModel: number) {
  gridShift.x = gridShift.z = 0;
  if (!run || !run.r.applicable) {
    airflow.object.visible = false;
    return;
  }
  airflow.update(run.sim, dtModel, sizeR, $<HTMLInputElement>('airflow').checked);
  const w = run.sim.opts.wind;
  const V = w ? Math.hypot(w.x, w.y, w.z) : 0;
  if (V < 1e-6) return;
  flowDist += V * dtModel;
  // Земля уходит назад со скоростью потока; клетка сетки — 10 м.
  gridShift.x = (w.x / V) * (flowDist % 10);
  gridShift.z = (w.z / V) * (flowDist % 10);
}
/** Сетка земли — под камерой с шагом клетки (аппарат улетает на километры), горизонт — вокруг камеры. */
function placeGround() {
  const t = camMode === 'cockpit' ? camera.position : controls.target;
  ground.position.set(t.x, 0, t.z);
  groundMat.uniforms.uShift.value.set(gridShift.x, gridShift.z);
  groundMat.uniforms.uCam.value.copy(camera.position);
  horizon.position.set(camera.position.x, 0, camera.position.z);
}

interface PartView {
  part: PartModel;
  group: THREE.Group;
  elems: THREE.Mesh[];
  offset: number; // место в кадре повтора
}
let views: PartView[] = [];
let frameSize = 0;
// Заливка элемента — по нагрузке: чёрный — запас велик, белый — предел. Сломанная деталь гаснет.
const neutral = new THREE.Color(0x000000);
const tmp = new THREE.Color();
// Заливку чуть отодвигаем, чтобы рёбра на ней не мерцали. Только постоянным сдвигом: сдвиг по наклону
// у силуэта велик, и оболочка-контур проступала сквозь заливку толстым серпом.
const fillMat = (color: THREE.ColorRepresentation) =>
  new THREE.MeshBasicMaterial({ color, polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: 4 });
const lineMat = (opacity = 0.95) => new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity });
/** Контур формы: рёбра (острые углы) и силуэт — вывернутая оболочка чуть больше самой формы. */
function outline(mesh: THREE.Mesh, size: [number, number, number], crease: number, hull: boolean) {
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, crease), lineMat());
  mesh.add(edges);
  if (hull) {
    const e = Math.max(0.004, Math.min(...size) * 0.025);
    const h = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide }));
    h.scale.set(1 + e / Math.max(size[0], 1e-3), 1 + e / Math.max(size[1], 1e-3), 1 + e / Math.max(size[2], 1e-3));
    h.userData.sharedGeo = true;
    mesh.add(h);
  }
}

/**
 * Проект отклонён — модели нет. Раньше на стенде оставалась последняя картинка, писалось «Готов к пуску»,
 * а «Пуск» ничего не делал: страница выглядела зависшей, а причина была только внизу экрана допущений.
 */
function showRejected(errors: string[]) {
  clearViews();
  $('summary').textContent = tr('Модель не собрана: исправьте допущения.', 'The model was not built: fix the assumptions.');
  const v = $('verdict');
  v.innerHTML = '';
  v.className = 'badge bad';
  v.append(el('b', tr('Модель не собрана', 'The model was not built')), listOf(errors.slice(0, 3).map((x) => x.replace(/^Спецификация отклонена:\s*/, ''))));
  const b = el('button', tr('← К допущениям', '← To the assumptions'), 'primary');
  b.dataset.go = 'assume';
  v.append(b);
  $('clock').textContent = 't = 0';
  $('phase').textContent = tr('модель не собрана', 'model not built');
  setPlaying(false);
  $<HTMLButtonElement>('toReport').disabled = true;
  $<HTMLButtonElement>('replayBtn').disabled = true;
  renderer.render(scene, camera); // убрать с картинки прежний аппарат
}

function clearViews() {
  for (const v of views) {
    scene.remove(v.group);
    v.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
        if (!o.userData.sharedGeo) o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
  views = [];
}

function buildViews(parts: PartModel[]) {
  clearViews();
  let offset = 0;
  for (const p of parts) {
    const g = new THREE.Group();
    const elems: THREE.Mesh[] = [];
    const s = p.spec;
    if (s.aero) {
      const a = s.aero;
      for (const e of p.elements) {
        const th = Math.max(0.004, e.chord * a.airfoil.thickness * 0.6);
        const geo = new THREE.BoxGeometry(e.chord, th, e.dr * 1.01);
        geo.translate(-0.25 * e.chord, 0, 0); // центр хорды — на четверть хорды позади точки элемента
        const m = new THREE.Mesh(geo, fillMat(neutral));
        m.position.set(e.r.x, e.r.y, e.r.z);
        outline(m, [e.chord, th, e.dr], 20, false);
        g.add(m);
        elems.push(m);
      }
    } else if (s.shape) {
      const [x, y, z] = s.shape.size;
      let geo: THREE.BufferGeometry;
      if (s.shape.type === 'box') geo = new THREE.BoxGeometry(x, y, z);
      else if (s.shape.type === 'cylinder') geo = new THREE.CylinderGeometry(x / 2, x / 2, y, 20);
      else {
        geo = new THREE.SphereGeometry(1, 32, 16);
        geo.scale(x / 2, y / 2, z / 2);
      }
      const m = new THREE.Mesh(geo, fillMat(0x000000));
      outline(m, [x, y, z], 25, true);
      if (s.shape.type !== 'box' && s.shape.type !== 'cylinder') {
        // Сфере рёбер нет — тонкая сетка меридианов, как штриховка на рисунке.
        const lat = new THREE.SphereGeometry(1, 12, 8);
        lat.scale(x / 2, y / 2, z / 2);
        const graticule = new THREE.LineSegments(new THREE.EdgesGeometry(lat, 1), lineMat(0.22));
        lat.dispose();
        m.add(graticule);
      }
      g.add(m);
    }
    scene.add(g);
    views.push({ part: p, group: g, elems, offset });
    offset += 9 + elems.length;
  }
  frameSize = offset;
}

/** Кадр: положение, поворот, угол установки, сломана ли, запасы станций — для каждой детали. */
function snapshot(): Float32Array {
  const d = new Float32Array(frameSize);
  if (!run) return d;
  const sim = run.sim;
  for (const v of views) {
    const { t, q } = sim.pose(v.part);
    const o = v.offset;
    d[o] = t.x; d[o + 1] = t.y; d[o + 2] = t.z;
    d[o + 3] = q.x; d[o + 4] = q.y; d[o + 5] = q.z; d[o + 6] = q.w;
    const a = v.part.spec.aero;
    d[o + 7] = a ? sim.surfaceIncidence(a) : 0;
    d[o + 8] = v.part.broken ? 1 : 0;
    const hasMat = !!v.part.material;
    v.elems.forEach((_, i) => (d[o + 9 + i] = hasMat ? v.part.stations[i].margin : NaN));
  }
  return d;
}

function applyFrame(d: Float32Array) {
  for (const v of views) {
    const o = v.offset;
    v.group.position.set(d[o], d[o + 1], d[o + 2]);
    v.group.quaternion.set(d[o + 3], d[o + 4], d[o + 5], d[o + 6]);
    const inc = d[o + 7];
    const broken = d[o + 8] > 0;
    if (!v.elems.length) {
      for (const c of v.group.children[0]?.children ?? []) {
        const lm = (c as THREE.LineSegments).material as THREE.LineBasicMaterial;
        if (c instanceof THREE.LineSegments) lm.opacity = broken ? 0.2 : lm.userData.base ?? (lm.userData.base = lm.opacity);
      }
    }
    v.elems.forEach((m, i) => {
      m.rotation.set(0, 0, inc + v.part.elements[i].twist);
      const mat = m.material as THREE.MeshBasicMaterial;
      const margin = d[o + 9 + i];
      const edge = (m.children[0] as THREE.LineSegments | undefined)?.material as THREE.LineBasicMaterial | undefined;
      if (edge) edge.opacity = broken ? 0.28 : 0.95;
      if (broken) mat.color.copy(neutral);
      else if (!Number.isFinite(margin)) mat.color.copy(neutral);
      else {
        // Доля предела 1/запас: до половины предела — чёрный, дальше светлеет до белого на пределе.
        const f = Math.min(1, 1 / Math.max(margin, 1e-6));
        const g = Math.max(0, (f - 0.4) / 0.6) ** 1.3 * 0.9;
        mat.color.copy(tmp.setRGB(g, g, g));
      }
    });
  }
}

// Место первого разрушения.
const marker = new THREE.Group();
{
  const red = new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.9, depthTest: false });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.08, 8, 48), red);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 8), red.clone());
  ring.renderOrder = dot.renderOrder = 10;
  marker.add(ring, dot);
  marker.visible = false;
  scene.add(marker);
}
let markerT = Infinity;

// Векторы сил.
const ARROWS = {
  lift: { color: 0xffffff, label: tr('подъёмная сила', 'lift'), css: '--lift' },
  thrust: { color: 0xc8c8c8, label: tr('тяга', 'thrust'), css: '--thrust' },
  drag: { color: 0x8c8c8c, label: tr('сопротивление', 'drag'), css: '--drag' },
  weight: { color: 0x5a5a5a, label: tr('вес', 'weight'), css: '--weight' },
} as const;
type ForceKey = keyof typeof ARROWS;
const arrows = Object.fromEntries(
  (Object.keys(ARROWS) as ForceKey[]).map((k) => {
    const a = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1, ARROWS[k].color);
    a.visible = false;
    (a.line.material as THREE.Material).depthTest = false;
    (a.cone.material as THREE.Material).depthTest = false;
    a.renderOrder = 11;
    scene.add(a);
    return [k, a];
  }),
) as Record<ForceKey, THREE.ArrowHelper>;
const forces = { lift: 0, thrust: 0, drag: 0 };
let fwd: V3 = { x: 1, y: 0, z: 0 };

function vehicleCom(): V3 {
  const sim = run!.sim;
  let m = 0;
  const c = { x: 0, y: 0, z: 0 };
  for (const p of sim.parts) {
    if (p.broken) continue;
    const { t, q } = sim.pose(p);
    const w = add(t, rotate(q, p.com));
    c.x += w.x * p.mass; c.y += w.y * p.mass; c.z += w.z * p.mass;
    m += p.mass;
  }
  return m > 0 ? { x: c.x / m, y: c.y / m, z: c.z / m } : c;
}

function trackForces(dt: number) {
  const sim = run!.sim;
  const rq = sim.root.b.rb.rotation();
  const f = rotate(rq, { x: 1, y: 0, z: 0 });
  const h = Math.hypot(f.x, f.z) || 1;
  fwd = { x: f.x / h, y: 0, z: f.z / h };
  let lift = 0, thrust = 0, drag = 0;
  for (const p of sim.parts) {
    if (p.broken) continue;
    lift += p.aeroForce.y;
    const along = p.aeroForce.x * fwd.x + p.aeroForce.z * fwd.z;
    if (along > 0) thrust += along;
    else drag -= along;
  }
  const hz = fastestHz();
  const tau = Math.min(0.5, Math.max(0.05, hz > 0 ? 1 / hz : 0.1));
  const k = 1 - Math.exp(-dt / tau);
  forces.lift += (lift - forces.lift) * k;
  forces.thrust += (thrust - forces.thrust) * k;
  forces.drag += (drag - forces.drag) * k;
}

function showForces(on: boolean) {
  for (const a of Object.values(arrows)) a.visible = false;
  $('forceLegend').hidden = !on;
  if (!on || !run) return;
  const W = run.sim.totalMass * run.sim.g;
  const c = vehicleCom();
  const o = new THREE.Vector3(c.x, c.y, c.z);
  const f = new THREE.Vector3(fwd.x, 0, fwd.z);
  const dirs: Record<ForceKey, [THREE.Vector3, number]> = {
    lift: [new THREE.Vector3(0, Math.sign(forces.lift) || 1, 0), Math.abs(forces.lift)],
    weight: [new THREE.Vector3(0, -1, 0), W],
    thrust: [f.clone(), forces.thrust],
    drag: [f.clone().negate(), forces.drag],
  };
  const legend: string[] = [];
  for (const k of Object.keys(dirs) as ForceKey[]) {
    const [d, F] = dirs[k];
    const L = Math.min(sizeR * 2.5, sizeR * 0.8 * (F / W));
    const a = arrows[k];
    if (L > sizeR * 0.01) {
      a.position.copy(o);
      a.setDirection(d);
      a.setLength(L, Math.min(L * 0.3, sizeR * 0.15), Math.min(L * 0.15, sizeR * 0.08));
      a.visible = true;
    }
    legend.push(`<span><i style="background:var(${ARROWS[k].css})"></i>${ARROWS[k].label}${k === 'weight' ? '' : ` ${fmt(Math.round((F / W) * 1000) / 10)} % ${tr('веса', 'of weight')}`}</span>`);
  }
  $('forceLegend').innerHTML = legend.join('');
}

function resize() {
  const r = view.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / Math.max(1, r.height);
  camera.updateProjectionMatrix();
  sizeChart();
}
new ResizeObserver(resize).observe(view);

// ---------- запуск ----------
let run: ProgramRun | null = null;
let playing = false;
let finishing = false;
let autoFast = false; // досчитывание запущено только на ускоренную часть (поиск режима); дальше — обычный показ
let pendingReport = false;
let series = new Series();
let replay = new Replay();
let replaying: { t: number } | null = null;
// После испытания с закреплённым корпусом последний цикл привода показывается по кругу.
let looping: { t: number } | null = null;
// Пока автопилот трубы подбирает режим (ускоренный расчёт), показывается последний целый цикл привода по кругу в выбранном
// темпе: иначе на экране — ускоренные кадры, и крылья мелькают в десятки раз быстрее, чем потом в замедлении.
let ffT = 0;
let knownBreaks = 0;
let lastEvents = -1;
let sizeR = 10;
let lastStepT = 0;
let report: Report | null = null;

const fastestHz = () => run?.sim.mainCycle()?.hz ?? 0;

function onStep() {
  const sim = run!.sim;
  const s = sim.sample;
  const hz = fastestHz();
  series.push(s, hz);
  replay.push(s.t, hz, snapshot);
  trackForces(s.t - lastStepT);
  lastStepT = s.t;
  const br = run!.r.breaks;
  if (br.length > knownBreaks) {
    if (knownBreaks === 0) {
      const b = br[0];
      replay.markBreak(b.t);
      const p = sim.partById.get(b.part);
      if (p && p.elements.length) {
        let best = 0;
        p.elements.forEach((e, i) => {
          if (Math.abs(e.spanFrac - b.spanFrac) < Math.abs(p.elements[best].spanFrac - b.spanFrac)) best = i;
        });
        const { t, q } = sim.pose(p);
        const w = add(t, rotate(q, p.elements[best].innerR));
        marker.position.set(w.x, w.y, w.z);
        marker.scale.setScalar(Math.max(0.05, sizeR * 0.05));
        markerT = b.t;
      }
    }
    knownBreaks = br.length;
  }
}

function rebuild() {
  run?.free();
  run = null;
  report = null;
  if (rview?.source === 'live') rview = null;
  series = new Series();
  replay = new Replay();
  replaying = null;
  looping = null;
  flowDist = 0;
  flowLastT = 0;
  airflow.reset();
  knownBreaks = 0;
  lastEvents = -1;
  lastStepT = 0;
  finishing = false;
  autoFast = false;
  markerT = Infinity;
  marker.visible = false;
  forces.lift = forces.thrust = forces.drag = 0;
  cancelJobs();
  $('invOut').innerHTML = '';
  $<HTMLButtonElement>('replayBtn').disabled = true;
  $<HTMLButtonElement>('toReport').disabled = true;
  $('replayBanner').hidden = true;
  history.replaceState(null, '', `${location.pathname}#t=${encodeState(state)}`);

  const { spec, errors } = buildVehicle(state);
  $('errors').textContent = errors.length ? `${tr('Спецификация отклонена', 'Specification rejected')}:\n• ${errors.join('\n• ')}` : '';
  $('programWhat').textContent = PROGRAMS[state.program].what;
  const fixed = spec.meta.class === 'fixed-wing';
  $('flightOpts').hidden = !(fixed && (state.program === 'flight' || state.program === 'max'));
  $('tunnelOpts').hidden = !(state.program === 'tunnel' || state.program === 'free' || (fixed && state.program === 'tethered'));
  showMaterialNote();
  if (errors.length) {
    showRejected(errors);
    return;
  }
  try {
    run = new ProgramRun(RAPIER, spec, state.program, programOptions(state));
  } catch (e) {
    if (e instanceof SpecError) {
      $('errors').textContent = e.message;
      showRejected([e.message]);
      return;
    }
    throw e;
  }
  const sim = run.sim;
  buildViews(sim.parts);
  sizeR = 1;
  for (const p of spec.parts) {
    const ext = (p.aero?.span ?? 0) + Math.hypot(p.position[0], p.position[2]);
    const sh = p.shape ? Math.max(...p.shape.size) / 2 : 0;
    sizeR = Math.max(sizeR, ext, sh);
  }
  placeCamera();
  showSummary(spec);
  applyFrame(snapshot());
  updatePanel();
  drawLiveChart();
  setPlaying(false);
}

function placeCamera() {
  if (!run) return;
  const rt = run.sim.root.b.rb.translation();
  controls.target.set(rt.x, rt.y, rt.z);
  camera.position.set(rt.x + sizeR * 1.6, rt.y + sizeR * 0.9, rt.z + sizeR * 2.2);
  camera.near = sizeR / 200;
  camera.updateProjectionMatrix();
}

function showSummary(spec: Spec) {
  const sim = run!.sim;
  const c = vehicleCom();
  const rt = sim.root.b.rb.translation();
  const box = $('summary');
  const cm = (x: number) => fmt(Math.round(x * 100) / 100);
  box.innerHTML = '';
  box.append(el('b', td(spec.meta.name)), el('br'));
  box.append(document.createTextNode(
    tr(`Масса ${fmt(sim.totalMass)} кг · мощность ${power(sim.powerAvailable)} · экипаж ${spec.crew.unmanned ? 0 : spec.crew.seats.length}. ` +
    `Центр масс: ${cm(c.x - rt.x)} м вперёд и ${cm(c.y - rt.y)} м выше центра корпуса, ${cm(c.y)} м над землёй.`,
    `Mass ${fmt(sim.totalMass)} kg · power ${power(sim.powerAvailable)} · crew ${spec.crew.unmanned ? 0 : spec.crew.seats.length}. ` +
    `Centre of mass: ${cm(c.x - rt.x)} m forward and ${cm(c.y - rt.y)} m above the body centre, ${cm(c.y)} m above the ground.`),
  ));
}

function showMaterialNote() {
  const mo = matSel.value ? MATERIALS[matSel.value] : null;
  const box = $('materialNote');
  box.innerHTML = '';
  if (!mo) return;
  box.append(document.createTextNode(
    `${td(mo.name)} — ${td(DATA_KIND_NAMES[mo.kind])}. ${tr('Плотность', 'Density')} ${fmt(mo.density)} ${U.kgm3}, ` +
    (mo.E2 ? tr(`модуль вдоль волокон ${fmt(mo.E / 1e9)} ${U.GPa}, поперёк ${fmt(mo.E2 / 1e9)} ${U.GPa}, `, `modulus along the fibres ${fmt(mo.E / 1e9)} ${U.GPa}, across ${fmt(mo.E2 / 1e9)} ${U.GPa}, `) : `${tr('модуль', 'modulus')} ${fmt(mo.E / 1e9)} ${U.GPa}, `) +
    `${tr('растяжение', 'tension')} ${fmt(mo.ultTension / 1e6)} ${U.MPa}, ${tr('сжатие', 'compression')} ${mo.ultCompression ? fmt(mo.ultCompression / 1e6) + ' ' + U.MPa : tr('не держит', 'none')}, ` +
    `${tr('срез', 'shear')} ${mo.shear ? fmt(mo.shear / 1e6) + ' ' + U.MPa : tr('не держит', 'none')}.` + (mo.scale ? ` ${td(mo.scale)}.` : '') + (mo.note ? ` ${td(mo.note)}.` : ''),
  ));
  if (mo.estimates?.length) box.append(el('br'), document.createTextNode(`${tr('Оценки, а не данные', 'Estimates, not data')}: ${mo.estimates.map(td).join(', ')}.`));
  box.append(el('br'), document.createTextNode(tr('Источники: ', 'Sources: ')));
  mo.sources.forEach((u, i) => {
    const a = el('a', `[${i + 1}]`) as HTMLAnchorElement;
    a.href = u;
    a.target = '_blank';
    a.rel = 'noopener';
    box.append(a, document.createTextNode(' '));
  });
}

// ---------- панель стенда ----------
function updatePanel() {
  if (!run) return;
  const r = run.r;
  const s = run.sim.sample;
  if (!replaying) $('clock').textContent = `t = ${dec(s.t, 2)} ${U.s}`;
  $('phase').textContent = replaying ? tr('повтор разрушения', 'failure replay') : run.done ? (looping ? tr('испытание завершено · найденный режим по кругу', 'test finished · the regime found, looped') : tr('испытание завершено', 'test finished'))
    : run.fastForward ? td(run.phase) + tr(' · ускоренно', ' · fast-forward') : finishing ? tr('досчитываю без замедления…', 'computing to the end…') : td(run.phase);
  $('tSpeed').textContent = `${fmt(s.airspeed)} ${U.ms} · ${fmt(s.altitude)} ${U.m}`;
  $('tPitch').textContent = `${fmt(s.pitchDeg)}°`;
  $('tLift').textContent = fmt(r.liftToWeightMean);
  $('tPower').textContent = `${power(s.power)} ${tr('из', 'of')} ${power(r.powerAvailable)}`;
  $('tPowerNote').textContent = s.power > r.powerAvailable ? tr('не хватает мощности', 'not enough power') : tr('на валах и винтах', 'at shafts and rotors');
  const m = s.minMargin;
  $('tMargin').innerHTML = '';
  if (Number.isFinite(m)) $('tMargin').append(el('span', fmt(m), m < 1 ? 'bad' : m < 1.5 ? 'warn' : 'ok'));
  else $('tMargin').textContent = tr('не проверяется', 'not checked');
  const names = partNames(run.spec);
  $('tMarginNote').textContent = s.minMarginPart
    ? `${td(names[s.minMarginPart] ?? s.minMarginPart)}, ${modeName(s.minMarginMode)}, ${Math.round(s.minMarginSpan * 100)} % ${tr('размаха · худший за запуск', 'span · worst this run')} ${fmt(r.minMargin)}`
    : '';
  $('tCrew').textContent = `${fmt(r.crewSustainedG)} / ${fmt(r.crewPeakG)} g · ${fmt(r.vibrationRms)} ${U.ms2}`;
  $('tMach').innerHTML = '';
  $('tMach').append(r.maxMach > 0.7 ? el('span', `${fmt(r.maxMach)} — ${tr('вне модели', 'outside the model')}`, 'bad') : document.createTextNode(fmt(r.maxMach)));
  $('tStall').textContent = `${tr('сечений в срыве', 'sections stalled')} ${fmt(s.stalledFrac * 100)} %`;

  const v = $('verdict');
  v.innerHTML = '';
  if (run.sim.steps === 0) {
    v.className = 'badge';
    v.append(el('b', r.applicable ? tr('Готов к пуску', 'Ready to run') : tr('Не применимо', 'Not applicable')));
    if (!r.applicable) v.append(listOf([r.notApplicable ?? '']));
  } else {
    const a = analyze(r, names);
    // До конца испытания вердикт выносится только по тому, что уже случилось: разрушение, перегрузка.
    // «Не взлетает» посреди разгона или поиска режима — преждевременно.
    if (!run.done && a.kind !== 'breaks' && a.kind !== 'crew') {
      v.className = 'badge';
      v.append(el('b', tr('Идёт испытание', 'Test in progress')), listOf([run.fastForward
        ? (run.id === 'stress'
          ? tr('Самолёт выходит на режим следующего манёвра или возвращается в горизонт — эта часть идёт ускоренно. Сами манёвры — в замедлении; результаты по каждому — в отчёте.',
            'The aeroplane is setting up the next manoeuvre or recovering to level flight — this part runs fast-forward. The manoeuvres themselves play in slow motion; results for each are in the report.')
          : run.id === 'free'
          ? tr('Автопилот подбирает режим полёта в потоке — угол установки и закручивание крыла. Эта часть идёт ускоренно; потом корпус отпускается, и аппарат летит сам — уже в замедлении.',
            'The autopilot is searching for the flight regime in a flow — wing incidence and twist. This part runs fast-forward; then the body is released and the vehicle flies by itself — in slow motion.')
          : tr('Автопилот трубы подбирает режим полёта — угол установки и закручивание крыла — и измеряет его. Эта часть идёт ускоренно; потом найденный режим показывается в замедлении.',
            'The tunnel autopilot is searching for the flight regime — wing incidence and twist — and measuring it. This part runs fast-forward; the regime found is then shown in slow motion.'))
        : run.id === 'free'
          ? tr('Свободный полёт: корпус отпущен, автопилот держит высоту углом установки крыльев и скорость — закручиванием. Вердикт будет в конце; досчитать сразу — кнопка «К итогу».',
            'Free flight: the body is released, the autopilot holds height with wing incidence and speed with wing twist. The verdict comes at the end; to compute it right away, press “To the end”.')
        : tr('Вердикт будет в конце испытания. Досчитать сразу — кнопка «К итогу».', 'The verdict comes at the end of the test. To compute it right away, press “To the end”.')]));
    } else {
      v.className = `badge ${a.kind === 'flies' ? 'good' : a.kind === 'marginal' ? 'warn' : a.kind === 'n/a' ? '' : 'bad'}`;
      v.append(el('b', (run.done ? '' : tr('Пока: ', 'So far: ')) + a.title), listOf(a.reasons));
      for (const w of a.warnings) v.append(el('div', w, 'w'));
    }
    if (run.done) {
      const b = el('button', tr('Открыть отчёт →', 'Open the report →'), 'primary');
      b.dataset.go = 'report';
      v.append(b);
    }
  }
  if (r.breaks.length !== lastEvents) {
    lastEvents = r.breaks.length;
    $('events').innerHTML = '';
    if (!r.breaks.length) $('events').append(el('li', tr('пока нет', 'none yet')));
    for (const b of r.breaks) $('events').append(el('li', `${fmt(b.t)} ${U.s} — ${tr('«', '“')}${td(names[b.part] ?? b.part)}${tr('»', '”')}: ${modeName(b.mode)}, ${Math.round(b.spanFrac * 100)} % ${tr('размаха', 'span')}`));
  }
  $<HTMLButtonElement>('replayBtn').disabled = !replay.ready || (!replay.frozen && !run.done);
  $<HTMLButtonElement>('toReport').disabled = false;
  $('toReport').textContent = run.done ? tr('Отчёт →', 'Report →') : tr('Досчитать и открыть отчёт →', 'Finish and open the report →');
}

function listOf(items: string[]) {
  const ul = el('ul');
  for (const x of items) ul.append(el('li', x));
  return ul;
}

// ---------- графики ----------
interface ChartOpts { yMax?: number; refs?: { y: number; css: string; label: string }[]; lines: { y: ArrayLike<number>; css: string }[]; x: ArrayLike<number>; tMax?: number; fmtY?: (y: number) => string }

function drawSeries(canvas: HTMLCanvasElement, o: ChartOpts) {
  const ctx = canvas.getContext('2d')!;
  const d = devicePixelRatio;
  const rect = canvas.getBoundingClientRect();
  if (canvas.width !== Math.round(rect.width * d)) canvas.width = Math.round(rect.width * d);
  if (canvas.height !== Math.round(rect.height * d)) canvas.height = Math.round(rect.height * d);
  const W = canvas.width, H = canvas.height;
  const css = getComputedStyle(document.documentElement);
  ctx.clearRect(0, 0, W, H);
  const padL = 40 * d, padB = 16 * d, padT = 8 * d, padR = 8 * d;
  const n = o.x.length;
  const tMax = Math.max(o.tMax ?? (n ? o.x[n - 1] : 1), 1e-3);
  let yMax = o.yMax ?? 0;
  if (o.yMax === undefined) {
    for (const l of o.lines) for (let i = 0; i < l.y.length; i++) if (Number.isFinite(l.y[i])) yMax = Math.max(yMax, l.y[i]);
    for (const r of o.refs ?? []) yMax = Math.max(yMax, r.y);
    yMax = yMax * 1.1 || 1;
  }
  const X = (t: number) => padL + (t / tMax) * (W - padL - padR);
  const Y = (y: number) => H - padB - (Math.max(0, Math.min(y, yMax)) / yMax) * (H - padB - padT);
  const fy = o.fmtY ?? fmt;
  ctx.font = `${10 * d}px "JetBrains Mono", ui-monospace, Consolas, monospace`;
  ctx.lineWidth = d;
  for (const r of o.refs ?? []) {
    ctx.strokeStyle = css.getPropertyValue(r.css);
    ctx.setLineDash([4 * d, 4 * d]);
    ctx.beginPath();
    ctx.moveTo(padL, Y(r.y));
    ctx.lineTo(W - padR, Y(r.y));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = css.getPropertyValue(r.css);
    ctx.textAlign = 'right';
    ctx.fillText(r.label, W - padR - 2 * d, Y(r.y) - 3 * d); // над линией, у правого края
  }
  ctx.fillStyle = css.getPropertyValue('--quiet');
  ctx.textAlign = 'right';
  ctx.fillText(fy(yMax), padL - 4 * d, padT + 8 * d);
  ctx.fillText(`${fmt(tMax)} ${U.s}`, W - padR, H - 3 * d);
  ctx.textAlign = 'left';
  ctx.fillText(`0 ${U.s}`, padL, H - 3 * d);
  // По столбцу пикселей — минимум и максимум, чтобы быстрые колебания не терялись.
  for (const l of o.lines) {
    ctx.strokeStyle = css.getPropertyValue(l.css);
    ctx.lineWidth = 1.5 * d;
    ctx.beginPath();
    let col = -1, lo = Infinity, hi = -Infinity, started = false;
    const flush = () => {
      if (col < 0 || !Number.isFinite(lo)) return;
      if (!started) ctx.moveTo(col, Y(hi));
      else ctx.lineTo(col, Y(hi));
      ctx.lineTo(col, Y(lo));
      started = true;
    };
    for (let i = 0; i < Math.min(n, l.y.length); i++) {
      const c = Math.round(X(o.x[i]));
      const y = l.y[i];
      if (c !== col) {
        flush();
        col = c;
        lo = hi = Number.isFinite(y) ? y : NaN;
        if (!Number.isFinite(y)) { lo = Infinity; hi = -Infinity; }
      } else if (Number.isFinite(y)) {
        lo = Math.min(lo, y);
        hi = Math.max(hi, y);
      }
    }
    flush();
    ctx.stroke();
  }
}

const chart = $<HTMLCanvasElement>('chart');
function sizeChart() {
  drawLiveChart();
}
function drawLiveChart() {
  if (!run || chart.offsetParent === null) return;
  drawSeries(chart, {
    x: series.col('t'), lines: [{ y: series.col('minMargin'), css: '--accent' }], yMax: 5, tMax: Math.max(run.sim.t, 1),
    refs: [{ y: 1, css: '--bad', label: tr('предел', 'limit') }, { y: 1.5, css: '--warn', label: fmt(1.5) }], fmtY: () => '5+',
  });
}

// ---------- отчёт ----------
// Отчёт рисуется из «вида»: живой прогон на этой странице или сохранённый снимок по ссылке.
interface ReportView { report: Report; charts: ChartData; digest: string; source: 'live' | 'stored'; storedId?: string; created?: number; influence?: string[] }
let rview: ReportView | null = null;

function liveView(): ReportView | null {
  if (!run) return null;
  report = report ?? buildReport(run.r, run.spec);
  return { report, charts: chartData(run.r, series), digest: resultDigest(run.r), source: 'live' };
}

function openReport() {
  const v = liveView();
  if (!v) return;
  rview = v;
  renderReport(v);
  $('verifyNote').textContent = '';
  startInfluence();
}

function renderReport(v: ReportView) {
  const rp = v.report;
  const k = rp.verdict.kind;
  $('rTitle').textContent = `${rp.vehicle} · ${rp.program}`;
  $('rVerdict').textContent = rp.verdict.title;
  $('rVerdict').className = `verdict ${k === 'flies' ? 'good' : k === 'marginal' ? 'warn' : k === 'n/a' ? '' : 'bad'}`;
  $('rEvent').textContent = rp.event;
  const fill = (id: string, items: string[], empty?: string) => {
    const ul = $(id);
    ul.innerHTML = '';
    for (const x of items) ul.append(el('li', x));
    if (!items.length && empty) ul.append(el('li', empty, 'muted'));
  };
  fill('rReasons', rp.verdict.reasons);
  fill('rCompare', rp.comparisons, tr('нет', 'none'));
  fill('rWarnings', rp.verdict.warnings);
  if (v.influence) fill('rInfluence', v.influence);

  const tt = $('rTelemetry');
  tt.innerHTML = '';
  for (const r of rp.telemetry) {
    const trow = el('tr');
    const td1 = el('td', r.label);
    if (r.note) td1.append(el('small', r.note));
    trow.append(td1, el('td', r.value, r.level === 'bad' ? 'bad' : r.level === 'warn' ? 'warn' : ''));
    tt.append(trow);
  }
  const ta = $('rAssumptions');
  ta.innerHTML = '';
  for (const a of baseAssumptions(state.vehicle)) {
    const val = state.overrides[a.path] ?? a.value;
    const trow = el('tr');
    const td1 = el('td', td(a.label));
    td1.append(el('small', `${CONF[a.confidence]}${val !== a.value ? tr(` · изменено, исходно ${showValue(a, a.value)}`, ` · changed, originally ${showValue(a, a.value)}`) : ''}`));
    trow.append(td1, el('td', showValue(a, val)));
    ta.append(trow);
  }
  const mat = state.material ? td(MATERIALS[state.material]?.name ?? '') : null;
  const extra: [string, string][] = [[tr('Материал силового набора', 'Structural material'), mat ?? tr('как в спецификации', 'as in the specification')], [tr('Высота', 'Altitude'), `${fmt(state.altitude ?? 0)} ${U.m}`]];
  if (state.isaDeviation) extra.push([tr('Температура относительно стандартной', 'Temperature relative to standard'), `${state.isaDeviation > 0 ? '+' : ''}${fmt(state.isaDeviation)} °C`]);
  if (state.cruise) extra.push([tr('Крейсерская скорость', 'Cruise speed'), `${fmt(state.cruise)} ${U.ms}`]);
  if (state.wind) extra.push([tr('Скорость потока', 'Flow speed'), `${fmt(state.wind)} ${U.ms}`]);
  if (state.breakable === false) extra.push([tr('Разрушение', 'Breaking'), tr('отключено', 'disabled')]);
  for (const [l, val] of extra) {
    const trow = el('tr');
    trow.append(el('td', l), el('td', val));
    ta.append(trow);
  }
  $('rDisclaimer').textContent = rp.disclaimer;
  $('linkNote').textContent = '';
  $('linkOut').hidden = true;
  $<HTMLButtonElement>('csvBtn').disabled = v.source !== 'live';
  $<HTMLButtonElement>('clipBtn').disabled = v.source !== 'live' || !run;
  requestAnimationFrame(() => drawReportCharts(v.charts));
}

const nn = (a: (number | null)[]) => a.map((x) => (x === null ? NaN : x));
function drawReportCharts(c: ChartData) {
  const t = nn(c.t);
  $('fMargin').hidden = !c.hasMargin;
  if (c.hasMargin) drawSeries($('cMargin') as HTMLCanvasElement, {
    x: t, lines: [{ y: nn(c.margin), css: '--accent' }], yMax: 5,
    refs: [{ y: 1, css: '--bad', label: tr('предел', 'limit') }, { y: 1.5, css: '--warn', label: fmt(1.5) }], fmtY: () => '5+',
  });
  drawSeries($('cLift') as HTMLCanvasElement, { x: t, lines: [{ y: nn(c.lift), css: '--lift' }], refs: [{ y: 1, css: '--quiet', label: tr('вес', 'weight') }] });
  const avail = c.powerAvailable;
  drawSeries($('cPower') as HTMLCanvasElement, {
    x: t, lines: [{ y: nn(c.power), css: '--accent' }], refs: [{ y: avail, css: '--bad', label: tr('есть', 'available') }],
    yMax: Math.min(Math.max(avail * 1.2, c.powerNeed * 1.2), avail * 50), fmtY: power,
  });
}

// ---------- отчёт по постоянной ссылке ----------
function showReportScreen() {
  screen = 'report';
  $('report').hidden = false;
  for (const b of document.querySelectorAll<HTMLButtonElement>('nav.steps button')) {
    if (b.dataset.go === 'report') b.setAttribute('aria-current', 'step');
    else b.removeAttribute('aria-current');
  }
}

function applyState(s: TestState) {
  if ('design' in s.vehicle) {
    const id = `gen-${++genCount}`;
    GENERATED[id] = { design: s.vehicle.design, info: s.vehicle.info ?? '' };
    vehicleId = id;
  } else vehicleId = s.vehicle.preset;
  for (const k of Object.keys(state) as (keyof TestState)[]) delete state[k];
  Object.assign(state, s);
}

async function openStored(id: string) {
  showReportScreen();
  $('rTitle').textContent = tr('Загружаю отчёт…', 'Loading the report…');
  let body: { ok: boolean; error?: string; state?: unknown; snapshot?: unknown; created?: number };
  try {
    const res = await fetch(`/api/reports/${id}`);
    body = await res.json();
  } catch {
    body = { ok: false, error: tr('нет связи с сервером', 'cannot reach the server') };
  }
  const p = body.ok ? parseShare(body) : null;
  if (!p || 'error' in p) {
    $('rTitle').textContent = '';
    $('rVerdict').textContent = tr('Отчёт не открылся', 'The report did not open');
    $('rVerdict').className = 'verdict bad';
    $('rEvent').textContent = body.error ?? (p && 'error' in p ? p.error : '');
    return;
  }
  applyState(p.state);
  syncInputs();
  buildGallery();
  buildAssumptions();
  rebuild(); // стенд готов к повтору: «← К стенду» и «Пуск»
  history.replaceState(null, '', `/r/${id}`);
  rview = { report: p.snapshot.report, charts: p.snapshot.charts, digest: p.snapshot.digest, source: 'stored', storedId: id, created: body.created, influence: p.snapshot.influence };
  renderReport(rview);
  const when = body.created ? new Date(body.created).toLocaleString(isEn() ? 'en-GB' : 'ru-RU', { dateStyle: 'medium', timeStyle: 'short' }) : '';
  const note = $('verifyNote');
  note.className = 'note';
  note.textContent = tr(`Отчёт сохранён ${when}. Повторяю испытание в вашем браузере, чтобы проверить…`, `Report saved ${when}. Re-running the test in your browser to check it…`);
  if (!p.snapshot.influence) $('rInfluence').innerHTML = '';
  const t0 = performance.now();
  submit('verify', (m) => {
    if (m.type === 'progress') note.textContent = tr(`Отчёт сохранён ${when}. Повторяю испытание в вашем браузере: модельное время ${fmt(m.done / 10)} с…`, `Report saved ${when}. Re-running the test in your browser: simulated time ${fmt(m.done / 10)} s…`);
    else if (m.type === 'verify') {
      const secs = fmt((performance.now() - t0) / 1000);
      if (m.snapshot.digest === rview?.digest) {
        // Тот же результат; если отчёт сохранён на другом языке — показываем пересчитанный, на языке зрителя.
        if (p.snapshot.lang !== getLang()) {
          rview = { report: m.snapshot.report, charts: m.snapshot.charts, digest: m.snapshot.digest, source: 'stored', storedId: id, created: body.created };
          renderReport(rview);
        }
        note.className = 'note ok';
        note.textContent = tr(`Отчёт сохранён ${when}. Испытание повторено в вашем браузере за ${secs} с — результат совпал.`, `Report saved ${when}. The test was re-run in your browser in ${secs} s — the result matches.`);
      } else {
        // Снимок не подтвердился: показываем то, что посчитано здесь.
        rview = { report: m.snapshot.report, charts: m.snapshot.charts, digest: m.snapshot.digest, source: 'stored', storedId: id, created: body.created };
        renderReport(rview);
        note.className = 'note warn';
        note.textContent = tr(`Отчёт сохранён ${when}, но повторный расчёт в вашем браузере дал другой результат — показан пересчитанный отчёт. Возможна другая версия стенда.`, `Report saved ${when}, but the re-run in your browser gave a different result — the recomputed report is shown. The stand version may differ.`);
      }
      if (!rview?.influence) startInfluence();
    } else if (m.type === 'error') {
      note.className = 'note bad';
      note.textContent = `${tr('Повторить испытание не удалось', 'Could not re-run the test')}: ${m.message}`;
    }
  });
}

// ---------- фоновые расчёты ----------
let worker: Worker | null = null;
let jobId = 0;
const handlers = new Map<number, (m: JobReply) => void>();
let busy = 0;
function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<JobReply>) => {
      const h = handlers.get(e.data.id);
      if (!h) return;
      if (e.data.type !== 'progress') {
        handlers.delete(e.data.id);
        busy--;
      }
      h(e.data);
    };
  }
  return worker;
}
function submit(type: Job['type'], h: (m: JobReply) => void) {
  const id = ++jobId;
  handlers.set(id, h);
  busy++;
  getWorker().postMessage({ id, type, state: structuredClone(state), lang: getLang() } satisfies Job);
}
function cancelJobs() {
  if (busy > 0 && worker) {
    worker.terminate();
    worker = null;
  }
  busy = 0;
  handlers.clear();
  influenceKey = '';
}

let influenceKey = '';
function startInfluence() {
  const key = encodeState(state);
  if (influenceKey === key) return;
  influenceKey = key;
  const ul = $('rInfluence');
  ul.innerHTML = '';
  ul.append(el('li', tr('Считаю: каждое допущение по очереди меняется на 10 %…', 'Computing: each assumption is changed by 10 % in turn…'), 'muted'));
  submit('influence', (m) => {
    ul.innerHTML = '';
    if (m.type === 'progress') ul.append(el('li', tr(`Считаю: прогон ${m.done} из ${m.total}…`, `Computing: run ${m.done} of ${m.total}…`), 'muted'));
    else if (m.type === 'influence') {
      for (const x of m.lines) ul.append(el('li', x));
      if (!m.lines.length) ul.append(el('li', tr('Допущений нет.', 'No assumptions.'), 'muted'));
      ul.append(el('li', tr(`Каждое допущение увеличено на 10 %, испытание повторено без разрушения (${fmt(m.ms / 1000)} с).`, `Each assumption raised by 10 %, the test re-run without breaking (${fmt(m.ms / 1000)} s).`), 'muted'));
      const broke = (rview?.report.telemetry.find((x) => x.key === 'breaks')?.value ?? '0') !== '0';
      if (rview) rview.influence = m.lines;
      if (m.overload && broke) {
        $('rCompare').querySelector('li.muted')?.remove();
        $('rCompare').prepend(el('li', `${tr('Без разрушения', 'Without breaking')}: ${m.overload.charAt(0).toLowerCase()}${m.overload.slice(1)}`));
      }
      const b = m.base;
      if (b && broke) {
        const row = el('tr');
        const td1 = el('td', tr('Тот же прогон без разрушения', 'The same run without breaking'));
        td1.append(el('small', tr('детали не ломаются — видно, какие нагрузки и мощность нужны на самом деле', 'parts do not break — this shows the loads and power really needed')));
        row.append(td1, el('td', tr(`запас ${fmt(b.margin)} · нужно ${power(b.powerNeed)} из ${power(b.powerAvailable)} · подъёмная сила ${fmt(b.lift * 100)} % веса`, `margin ${fmt(b.margin)} · needs ${power(b.powerNeed)} of ${power(b.powerAvailable)} · lift ${fmt(b.lift * 100)} % of weight`)));
        $('rTelemetry').append(row);
      }
    } else if (m.type === 'error') ul.append(el('li', m.message, 'bad'));
  });
}

$('invBtn').addEventListener('click', () => {
  const btn = $<HTMLButtonElement>('invBtn');
  const out = $('invOut');
  btn.disabled = true;
  out.innerHTML = '';
  out.append(el('li', tr('Считаю: прогоны без разрушения…', 'Computing: runs without breaking…'), 'muted'));
  submit('inverse', (m) => {
    if (m.type === 'progress') return;
    out.innerHTML = '';
    btn.disabled = false;
    if (m.type === 'inverse') for (const line of [tr(`Сейчас: ${m.verdict}. Расчёт занял ${fmt(m.ms / 1000)} с.`, `Now: ${m.verdict}. Computed in ${fmt(m.ms / 1000)} s.`), ...m.lines]) out.append(el('li', line));
    else if (m.type === 'error') out.append(el('li', m.message, 'bad'));
  });
});

$('copyLink').addEventListener('click', async () => {
  if (!rview) return;
  const btn = $<HTMLButtonElement>('copyLink');
  const noteEl = $('linkNote');
  delete noteEl.dataset.fallback;
  let url: string;
  if (rview.source === 'stored' && rview.storedId) url = `${location.origin}/r/${rview.storedId}`;
  else {
    btn.disabled = true;
    noteEl.textContent = tr('Сохраняю отчёт…', 'Saving the report…');
    try {
      if (__DEMO__) throw new Error(tr('на демо сервера нет', 'the demo has no server'));
      const snapshot: Snapshot = { v: 1, lang: getLang(), digest: rview.digest, report: rview.report, charts: rview.charts, ...(rview.influence ? { influence: rview.influence } : {}) };
      const res = await fetch('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: wireState(state), snapshot }) });
      const b = await res.json();
      if (!b.ok) throw new Error(b.error ?? `${tr('ошибка', 'error')} ${res.status}`);
      rview.storedId = b.id;
      url = `${location.origin}/r/${b.id}`;
    } catch (e) {
      // Без сервера — длинная ссылка: испытание целиком в адресе, повторяется у зрителя.
      url = `${location.origin}${location.pathname}#r=${encodeState(state)}`;
      noteEl.textContent = tr(`Сервер не сохранил отчёт (${e instanceof Error ? e.message : e}) — ссылка длинная, испытание записано в ней самой.`, `The server did not save the report (${e instanceof Error ? e.message : e}) — the link is long, the test is encoded in it.`);
      noteEl.dataset.fallback = '1';
    } finally {
      btn.disabled = false;
    }
  }
  const out = $<HTMLInputElement>('linkOut');
  out.value = url;
  out.hidden = false;
  out.select();
  try {
    await navigator.clipboard.writeText(url);
    if (!noteEl.dataset.fallback) noteEl.textContent = tr('Ссылка скопирована. Открывается без регистрации, на компьютере и телефоне; испытание повторяется в браузере зрителя.', 'Link copied. It opens without sign-up on a computer or phone; the test is re-run in the viewer’s browser.');
  } catch {
    if (!noteEl.dataset.fallback) noteEl.textContent = tr('Скопируйте ссылку из поля.', 'Copy the link from the field.');
  }
});
// ---------- клип (ТЗ, раздел 8: 10–15 с, ключевой момент и вердикт) ----------
// Испытание пересчитывается, положения деталей запоминаются в нужные моменты модельного времени,
// затем кадры проигрываются ровно по 30 в секунду в MediaRecorder. Так длина клипа не зависит
// от того, насколько быстро считает компьютер.
const CLIP_W = 960, CLIP_H = 540, CLIP_FPS = 30;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function clipMime(): string | null {
  for (const m of ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'])
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m;
  return null;
}

/** Моменты модельного времени для кадров клипа и подпись к каждому. */
function clipPlan(simTime: number, breakT: number | null): { t: number; label: string }[] {
  const out: { t: number; label: string }[] = [];
  const seg = (a: number, b: number, secs: number, label: string) => {
    const n = Math.round(secs * CLIP_FPS);
    for (let i = 0; i < n; i++) out.push({ t: a + ((b - a) * i) / n, label });
  };
  // Подпись скорости: во сколько раз модельное время идёт быстрее или медленнее настоящего.
  const pace = (simSecs: number, videoSecs: number) => {
    const k = simSecs / videoSecs;
    if (k > 1.1) return tr(`ускорено в ${raz(k, 2)}`, `${raz(k, 2)} faster`);
    if (k < 0.9) return tr(`замедлено в ${raz(1 / k, 2)}`, `${raz(1 / k, 2)} slower`);
    return tr('реальное время', 'real time');
  };
  if (breakT !== null) {
    const a = Math.max(0, breakT - 0.25), b = Math.min(simTime, breakT + 0.35);
    if (a > 0) seg(0, a, 3, pace(a, 3));
    seg(a, b, 5, `${pace(b - a, 5)} · ${tr('момент разрушения', 'moment of failure')}`);
  } else seg(0, simTime, 8, pace(simTime, 8));
  return out;
}

function drawClipOverlay(ctx: CanvasRenderingContext2D, title: string, t: number, label: string) {
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.fillRect(0, 0, CLIP_W, 44);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillRect(0, 44, CLIP_W, 1);
  ctx.fillStyle = '#fff';
  ctx.font = '700 20px "Oswald", "Bahnschrift", system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, 16, 22);
  ctx.font = '17px "JetBrains Mono", ui-monospace, Consolas, monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`t = ${dec(t, 2)} ${U.s}${label ? '  ·  ' + label : ''}`, CLIP_W - 16, 22);
  ctx.textAlign = 'left';
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number, maxLines: number): number {
  const words = text.split(' ');
  let line = '', lines = 0;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y + lines * lh);
      line = w;
      if (++lines >= maxLines) return lines;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, y + lines++ * lh);
  return lines;
}

function drawVerdictCard(ctx: CanvasRenderingContext2D, rp: Report, link: string) {
  const k = rp.verdict.kind;
  // Не летит — карточка инвертирована (белая), как на панели; иначе — чёрная с белой рамкой.
  const inv = k !== 'flies' && k !== 'marginal';
  const bg = inv ? '#fff' : '#000', ink = inv ? '#000' : '#fff', quiet = inv ? '#555' : '#a6a6a6';
  ctx.fillStyle = bg;
  ctx.fillRect(60, 70, CLIP_W - 120, CLIP_H - 140);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2;
  if (k === 'marginal') ctx.setLineDash([10, 6]);
  ctx.strokeRect(66, 76, CLIP_W - 132, CLIP_H - 152);
  ctx.setLineDash([]);
  const color = ink;
  ctx.fillStyle = quiet;
  ctx.font = '18px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  wrap(ctx, `${rp.vehicle} · ${rp.program}`, 90, 96, CLIP_W - 180, 24, 2);
  ctx.fillStyle = color;
  ctx.font = '700 50px "Oswald", "Bahnschrift", system-ui, sans-serif';
  ctx.fillText(rp.verdict.title.toUpperCase(), 90, 146);
  ctx.fillStyle = ink;
  ctx.font = '20px system-ui, sans-serif';
  let y = 220;
  for (const r of rp.verdict.reasons.slice(0, 2)) y += 28 * wrap(ctx, r, 90, y, CLIP_W - 180, 28, 3) + 10;
  ctx.fillStyle = quiet;
  ctx.font = '15px system-ui, sans-serif';
  wrap(ctx, `${tr('Оценка по упрощённой модели, не инженерный расчёт.', 'An estimate from a simplified model, not an engineering analysis.')} ${link}`, 90, CLIP_H - 110, CLIP_W - 180, 20, 2);
  ctx.textBaseline = 'middle';
}

async function recordClip() {
  const note = $('clipNote');
  const mime = clipMime();
  if (!mime) return void (note.textContent = tr('Этот браузер не умеет записывать видео (нет MediaRecorder).', 'This browser cannot record video (no MediaRecorder).'));
  if (!run?.done || !rview || rview.source !== 'live') return;
  const btn = $<HTMLButtonElement>('clipBtn');
  btn.disabled = true;
  const rp = rview.report;
  const breakT = run.r.breaks[0]?.t ?? null;
  const plan = clipPlan(run.r.simTime, breakT);
  const keepView = rview;
  try {
    // 1. Пересчёт испытания с записью кадров (детерминированно — тот же результат).
    note.textContent = tr('Клип: пересчитываю испытание…', 'Clip: re-running the test…');
    rebuild();
    rview = keepView;
    const frames: Float32Array[] = [];
    let k = 0, t0 = performance.now();
    while (k < plan.length && run && !run.done) {
      const dt = plan[k].t - run.sim.t;
      if (dt > run.sim.dt * 0.5) run.advance(dt, onStep);
      frames.push(snapshot());
      k++;
      if (performance.now() - t0 > 40) {
        note.textContent = `${tr('Клип: пересчитываю испытание…', 'Clip: re-running the test…')} ${Math.round((100 * k) / plan.length)} %`;
        await sleep(0);
        t0 = performance.now();
      }
    }
    if (run && !run.done) run.advance(1e9, onStep); // досчитать до конца, как было
    report = rview.report;
    // 2. Проигрывание кадров в запись.
    const cv = document.createElement('canvas');
    cv.width = CLIP_W;
    cv.height = CLIP_H;
    const ctx = cv.getContext('2d')!;
    const stream = cv.captureStream(CLIP_FPS);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 3_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
    rec.start(500);
    const rootIdx = views.findIndex((v) => v.part === run!.sim.root);
    const title = `${rp.vehicle} · ${rp.program}`;
    const link = rview.storedId ? `${location.host}/r/${rview.storedId}` : location.host;
    const savedAspect = camera.aspect;
    camera.aspect = CLIP_W / CLIP_H;
    camera.updateProjectionMatrix();
    const offset = new THREE.Vector3(sizeR * 1.6, sizeR * 0.9, sizeR * 2.2);
    const src = renderer.domElement;
    const start = performance.now();
    const total = frames.length + 4 * CLIP_FPS;
    airflow.object.visible = plumb.visible = false; // в клипе кадры из записи: линии тока к ним не привязаны
    for (let i = 0; i < total; i++) {
      const fi = Math.min(i, frames.length - 1);
      const d = frames[fi];
      applyFrame(d);
      marker.visible = plan[fi].t >= markerT;
      if (rootIdx >= 0) {
        const o = views[rootIdx].offset;
        camera.position.set(d[o] + offset.x, d[o + 1] + offset.y, d[o + 2] + offset.z);
        camera.lookAt(d[o], d[o + 1], d[o + 2]);
      }
      renderer.render(scene, camera);
      // Кадр сцены — с обрезкой под 16:9.
      const sw = src.width, sh = src.height, want = CLIP_W / CLIP_H;
      const cw = sw / sh > want ? sh * want : sw, ch = sw / sh > want ? sh : sw / want;
      ctx.drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, CLIP_W, CLIP_H);
      drawClipOverlay(ctx, title, plan[fi].t, i < frames.length ? plan[fi].label : '');
      if (i >= frames.length) drawVerdictCard(ctx, rp, link);
      if (i % 15 === 0) note.textContent = `${tr('Клип: записываю…', 'Clip: recording…')} ${Math.round((100 * i) / total)} %`;
      const due = start + ((i + 1) * 1000) / CLIP_FPS;
      await sleep(Math.max(0, due - performance.now()));
    }
    rec.stop();
    await stopped;
    camera.aspect = savedAspect;
    camera.updateProjectionMatrix();
    const blob = new Blob(chunks, { type: mime.split(';')[0] });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${rp.vehicle.replace(/[^\p{L}\p{N}]+/gu, '-')}-${state.program}.${mime.includes('mp4') ? 'mp4' : 'webm'}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
    note.textContent = tr(`Клип готов: ${fmt(total / CLIP_FPS)} с, ${fmt(blob.size / 1024 / 1024)} МБ, ${mime.includes('mp4') ? 'MP4' : 'WebM'} — файл сохранён.`, `Clip ready: ${fmt(total / CLIP_FPS)} s, ${fmt(blob.size / 1024 / 1024)} MB, ${mime.includes('mp4') ? 'MP4' : 'WebM'} — file saved.`);
    (window as unknown as { __clip?: Blob }).__clip = blob; // для проверки
  } catch (e) {
    note.textContent = `${tr('Клип не записался', 'The clip failed')}: ${e instanceof Error ? e.message : e}`;
  } finally {
    btn.disabled = false;
    resize();
    // Пересчёт для клипа остановил фоновые задачи — влияние допущений считаем заново, если не успело.
    if (rview && !rview.influence) startInfluence();
  }
}
$('clipBtn').addEventListener('click', () => void recordClip());

$('csvBtn').addEventListener('click', () => {
  const blob = new Blob([series.csv()], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(report?.vehicle ?? tr('испытание', 'test')).replace(/[^\p{L}\p{N}]+/gu, '-')}-${state.program}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// ---------- цикл ----------
const stats = { fps: 0, physMs: 0, stepsPerFrame: 0, slow: 0 };
(window as unknown as { __stand: unknown }).__stand = {
  stats, state, get run() { return run; }, get report() { return report; }, get series() { return series; }, get replay() { return replay; },
  renderer, scene, camera, go,
  // для проверок: досчитать испытание сразу, с записью рядов и кадров повтора
  // сверка с Node: те же 6 испытаний, вердикты и отпечатки (npm run check печатает отпечатки Node)
  repro: () => reproRun(RAPIER).map((r) => `${r.id} ${r.verdict} ${r.digest}`),
  digest: () => (run?.done ? resultDigest(run.r) : null),
  finishNow: () => { if (run && !run.done) { run.advance(1e9, onStep); finishing = false; setPlaying(false); updatePanel(); } },
  // для проверок: продвинуть испытание на dt секунд модельного времени и обновить панель (без отрисовки)
  advance: (dt: number) => { if (run && !run.done) { run.advance(dt, onStep); if (run.done) onRunDone(); updatePanel(); } },
  // для проверок: один «кадр» расчёта с тем же ограничением по времени, что в обычном показе; возвращает, сколько успел
  frameStep: (want: number) => {
    if (!run || run.done) return { did: 0, ms: 0 };
    const t0 = performance.now();
    const chunk = run.sim.dt * 4; // порция — четыре шага: время проверяется часто, перерасход не больше нескольких миллисекунд
    let did = 0;
    while (did < want - 1e-12 && !run.done && performance.now() - t0 < 20) {
      const d = Math.min(chunk, want - did);
      run.advance(d, onStep);
      did += d;
    }
    return { did, ms: performance.now() - t0 };
  },
  addGenerated: (d: Design, i: string) => addGenerated(d, i),
};
let frames = 0, fpsT0 = performance.now(), last = performance.now(), panelT = 0, physAcc = 0, stepAcc = 0;
let wantAcc = 0, didAcc = 0; // сколько модельного времени просили и сколько успели посчитать за секунду
const camOffset = new THREE.Vector3();
const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
let camMode = 'follow';

// «К итогу»: досчитывание порциями по 30 мс через MessageChannel — не зависит от отрисовки,
// поэтому идёт и в фоновой вкладке, а страница между порциями остаётся отзывчивой.
const pumpCh = new MessageChannel();
pumpCh.port1.onmessage = (e: MessageEvent<number>) => pump(e.data);
let pumpGen = 0;
function startFinish(auto = false) {
  if (!run || run.done) return;
  if (finishing) {
    if (!auto) autoFast = false; // «К итогу» поверх ускоренной части: считать до конца
    return;
  }
  autoFast = auto;
  finishing = true;
  setPlaying(true);
  pumpCh.port2.postMessage(++pumpGen);
}
function pump(gen = pumpGen) {
  if (gen !== pumpGen) return; // цепочка от прошлого запуска
  if (!finishing || !run || run.done || replaying) return;
  const t0 = performance.now();
  // Порция — 16 шагов, но не больше 0,02 с модели: у тяжёлого аппарата 0,02 с — это сотни миллисекунд расчёта.
  const part = Math.min(0.02, run.sim.dt * 16);
  while (!run.done && (!autoFast || run.fastForward) && performance.now() - t0 < 30) run.advance(part, onStep);
  if (run.done) onRunDone();
  else if (autoFast && !run.fastForward) {
    // Ускоренная часть кончилась: дальше испытание идёт в замедлении, по кадрам.
    finishing = false;
    autoFast = false;
    setPlaying(true);
    updatePanel();
  } else pumpCh.port2.postMessage(gen);
}
// После испытания, где корпус закреплён (труба, привязной стенд), последний цикл привода идёт по кругу:
// виден найденный режим, а не застывший кадр.
function startLoop() {
  if (!run || !run.done || !run.r.applicable || run.r.breaks.length || !replay.loopReady) return;
  if (run.id === 'tunnel' || run.id === 'tethered' || (run.id === 'max' && run.spec.meta.class !== 'fixed-wing')) looping = { t: 0 };
}
function onRunDone() {
  finishing = false;
  setPlaying(false);
  startLoop();
  updatePanel();
  if (pendingReport) {
    pendingReport = false;
    go('report');
  }
}

function frame(now: number) {
  const dtReal = Math.min(0.05, (now - last) / 1000);
  last = now;
  const speed = Number($<HTMLSelectElement>('speed').value);
  if (run && !replaying && playing && !finishing && !run.done) {
    const t0 = performance.now();
    const s0 = run.sim.steps;
    // Трубу досчитываем ускоренно: автопилот перебирает десятки циклов взмаха, в замедлении это минуты.
    // Найденный режим потом показывается по кругу (startLoop). Досчитывание идёт тем же насосом, что «К итогу»:
    // он не зависит от отрисовки и работает в фоновой вкладке.
    if (run.fastForward) startFinish(true);
    else {
      // На расчёт — не больше 20 мс за кадр. Тяжёлый аппарат (десяток винтов — десятки тел) иначе считается
      // дольше кадра, следующий кадр просит ещё больше — и страница перестаёт отвечать. Теперь такой
      // аппарат просто идёт медленнее выбранного темпа; об этом пишет строка под картинкой.
      const want = dtReal * speed;
      const chunk = run.sim.dt * 4; // порция — четыре шага: время проверяется часто, перерасход не больше нескольких миллисекунд
      let did = 0;
      while (did < want - 1e-12 && !run.done && performance.now() - t0 < 20) {
        const d = Math.min(chunk, want - did);
        run.advance(d, onStep);
        did += d;
      }
      wantAcc += want;
      didAcc += did;
    }
    physAcc += performance.now() - t0;
    stepAcc += run.sim.steps - s0;
    if (run.done) onRunDone();
  }
  if (run && screen !== 'report') {
    if (replaying) {
      replaying.t += dtReal * speed;
      if (replaying.t > replay.end) stopReplay();
      else {
        const f = replay.at(replaying.t);
        if (f) applyFrame(f.data);
        marker.visible = replaying.t >= markerT;
        const dtb = replaying.t - (replay.breakT ?? 0);
        $('clock').textContent = `t = ${dec(replaying.t, 3)} ${U.s}`;
        $('replayBanner').textContent = dtb < 0 ? tr(`Повтор: до разрушения ${fmt(-dtb * 1000)} мс`, `Replay: ${fmt(-dtb * 1000)} ms before failure`) : tr(`Повтор: разрушение + ${fmt(dtb * 1000)} мс`, `Replay: failure + ${fmt(dtb * 1000)} ms`);
      }
    } else if (looping) {
      looping.t += dtReal * speed;
      const f = replay.loopAt(looping.t);
      if (f) applyFrame(f.data);
    } else if (run.fastForward && !run.done) {
      ffT += dtReal * speed;
      const f = replay.loopAt(ffT);
      applyFrame(f ? f.data : snapshot());
    } else {
      applyFrame(snapshot());
      marker.visible = run.sim.t >= markerT;
    }
    drawFlow(looping ? dtReal * speed : Math.max(0, run.sim.t - flowLastT));
    flowLastT = run.sim.t;
    if (marker.visible) {
      const k = 1 + 0.25 * Math.sin(now / 150);
      marker.children[0].scale.setScalar(k);
      marker.lookAt(camera.position);
    }
    showForces($<HTMLInputElement>('forces').checked && !replaying);
    const rt = run.sim.root.b.rb.translation();
    if (camMode === 'cockpit') {
      const sim = run.sim;
      const p = sim.partById.get(run.spec.crew.part) ?? sim.root;
      const { t, q } = sim.pose(p);
      const seat = run.spec.crew.seats[0] ? fromArr(run.spec.crew.seats[0]) : { x: 0, y: 0, z: 0 };
      const w = add(t, rotate(q, seat));
      camera.position.set(w.x, w.y + 0.4, w.z);
      camera.quaternion.set(q.x, q.y, q.z, q.w).multiply(yaw);
      camera.near = 0.05;
      camera.updateProjectionMatrix();
    } else {
      if (camMode === 'follow') {
        camOffset.copy(camera.position).sub(controls.target);
        controls.target.lerp(new THREE.Vector3(rt.x, rt.y, rt.z), 0.2);
        camera.position.copy(controls.target).add(camOffset);
      }
      controls.update();
    }
    drawPlumb();
    placeGround();
    renderer.render(scene, camera);
  }
  frames++;
  if (now - panelT > 120) {
    panelT = now;
    if ((playing || finishing || run?.done) && screen === 'stand') {
      updatePanel();
      drawLiveChart();
    }
  }
  if (now - fpsT0 >= 1000) {
    stats.fps = (frames * 1000) / (now - fpsT0);
    stats.physMs = physAcc / frames;
    stats.stepsPerFrame = stepAcc / frames;
    const slow = wantAcc > 0 && didAcc < 0.8 * wantAcc ? wantAcc / Math.max(didAcc, 1e-12) : 0;
    stats.slow = slow;
    $('perf').textContent = tr(`${Math.round(stats.fps)} кадров/с · расчёт ${fmt(stats.physMs)} мс на кадр · шагов за кадр ${fmt(stats.stepsPerFrame)}`, `${Math.round(stats.fps)} fps · physics ${fmt(stats.physMs)} ms per frame · ${fmt(stats.stepsPerFrame)} steps per frame`) +
      (slow ? tr(` · расчёт не успевает: аппарат тяжёлый, показ идёт в ${fmt(slow)} раза медленнее выбранного`, ` · the physics cannot keep up: the vehicle is heavy, playback is ${fmt(slow)} times slower than selected`) : '');
    wantAcc = 0;
    didAcc = 0;
    frames = 0;
    physAcc = 0;
    stepAcc = 0;
    fpsT0 = now;
  }
  requestAnimationFrame(frame);
}

function stopReplay() {
  replaying = null;
  if (finishing) pumpCh.port2.postMessage(++pumpGen);
  $('replayBanner').hidden = true;
  $('replayBtn').textContent = tr('Повтор разрушения', 'Replay the failure');
  updatePanel();
}
$('replayBtn').addEventListener('click', () => {
  if (replaying) return stopReplay();
  if (!replay.ready) return;
  setPlaying(false);
  replaying = { t: replay.start };
  $('replayBanner').hidden = false;
  $('replayBtn').textContent = tr('Остановить повтор', 'Stop replay');
});

$('camera').addEventListener('change', () => {
  camMode = $<HTMLSelectElement>('camera').value;
  controls.enabled = camMode !== 'cockpit';
  if (camMode !== 'cockpit') placeCamera();
});

// ---------- генерация по описанию ----------
const genStatus = $('genStatus');
function addGenerated(design: Design, info: string, imageNote?: string[]) {
  const id = `gen-${++genCount}`;
  GENERATED[id] = { design, info, imageNote };
  setVehicle(id);
  state.program = defaultProgram();
  syncInputs();
  $('genInfo').textContent = info;
  showImageNote(imageNote);
  buildGallery();
  buildAssumptions();
  rebuild();
  go('assume');
  return id;
}
async function checkApi() {
  const btn = $<HTMLButtonElement>('genBtn');
  if (__DEMO__) {
    btn.disabled = true;
    genStatus.textContent = tr('Это демо на GitHub Pages: сборка аппарата по описанию и картинке работает только со своим сервером и ключом ИИ (npm run api). Выберите пример ниже — физика считается прямо в браузере.',
      'This is the GitHub Pages demo: building a vehicle from a description or an image needs your own server and AI key (npm run api). Pick an example below — the physics runs right in your browser.');
    return;
  }
  try {
    const res = await fetch('/api/health');
    if (!res.ok) throw new Error();
    const h = await res.json();
    if (!h.ai) {
      btn.disabled = true;
      genStatus.textContent = tr('На сервере не задан ключ ИИ (ANTHROPIC_API_KEY) — сборка по описанию недоступна. Выберите пример ниже.', 'The server has no AI key (ANTHROPIC_API_KEY) — building from a description is unavailable. Pick an example below.');
    }
  } catch {
    btn.disabled = true;
    genStatus.textContent = tr('Сервер генерации не запущен (npm run api) — выберите пример ниже.', 'The generation server is not running (npm run api) — pick an example below.');
  }
}
// ---------- картинка (этап 5) ----------
const MAX_FILE = 10 * 1024 * 1024;
const MAX_SIDE_PX = 1568; // больше ИИ всё равно уменьшит; меньше — дешевле и быстрее
let picked: { type: 'image/jpeg'; data: string; w: number; h: number } | null = null;

async function pickImage(file: File) {
  const label = $('imgLabel');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return void (label.textContent = tr(`«${file.name}»: нужен JPEG, PNG или WebP.`, `“${file.name}”: JPEG, PNG or WebP is required.`));
  if (file.size > MAX_FILE) return void (label.textContent = tr(`«${file.name}»: больше 10 МБ.`, `“${file.name}”: larger than 10 MB.`));
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file); // испорченный файл не откроется
  } catch {
    return void (label.textContent = tr(`«${file.name}» не открывается как изображение.`, `“${file.name}” does not open as an image.`));
  }
  if (Math.min(bmp.width, bmp.height) < 64) return void (label.textContent = tr(`Слишком маленькая картинка: ${bmp.width}×${bmp.height}.`, `The image is too small: ${bmp.width}×${bmp.height}.`));
  // Уменьшение и пересжатие: заодно пропадают метаданные (координаты съёмки, камера).
  const k = Math.min(1, MAX_SIDE_PX / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * k);
  cv.height = Math.round(bmp.height * k);
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#fff'; // прозрачный фон PNG — белым, иначе в JPEG он станет чёрным
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
  bmp.close();
  const url = cv.toDataURL('image/jpeg', 0.9);
  picked = { type: 'image/jpeg', data: url.slice(url.indexOf(',') + 1), w: cv.width, h: cv.height };
  const img = $<HTMLImageElement>('imgPreview');
  img.src = url;
  img.hidden = false;
  $('imgClear').hidden = false;
  label.textContent = tr(`«${file.name}», ${cv.width}×${cv.height}${k < 1 ? ' (уменьшено)' : ''}. Можно дописать уточнение текстом выше. Заменить —`, `“${file.name}”, ${cv.width}×${cv.height}${k < 1 ? ' (downscaled)' : ''}. You can add a note in the text above. Replace —`);
  $<HTMLButtonElement>('genBtn').textContent = tr('Собрать по картинке', 'Build from the image');
  $('imgPickText').textContent = tr('другой файл', 'another file');
}
function clearImage() {
  picked = null;
  $('imgPreview').hidden = true;
  $('imgClear').hidden = true;
  $('imgLabel').textContent = tr('Или картинка: фото, рисунок, чертёж — перетащите сюда, вставьте из буфера или', 'Or an image: a photo, drawing or blueprint — drop it here, paste it or');
  $<HTMLButtonElement>('genBtn').textContent = tr('Собрать по описанию', 'Build from the description');
  $('imgPickText').textContent = tr('выберите файл', 'choose a file');
  $<HTMLInputElement>('imgFile').value = '';
}
$('imgFile').addEventListener('change', () => {
  const f = $<HTMLInputElement>('imgFile').files?.[0];
  if (f) void pickImage(f);
});
$('imgClear').addEventListener('click', clearImage);
const drop = $('drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const f = e.dataTransfer?.files?.[0];
  if (f) void pickImage(f);
});
document.addEventListener('paste', (e) => {
  if (screen !== 'input') return;
  const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
  if (f) {
    e.preventDefault();
    void pickImage(f);
  }
});

const VIEW_NAMES: Record<string, string> = isEn()
  ? { side: 'side', top: 'top', front: 'front', 'three-quarter': 'three-quarter', several: 'several views', unknown: 'unclear' }
  : { side: 'сбоку', top: 'сверху', front: 'спереди', 'three-quarter': 'в три четверти', several: 'несколько видов', unknown: 'вид не ясен' };
/** Что снято с картинки, а что оценено (ТЗ, сценарий Б). */
function imageNoteFrom(r: { analysis?: { image?: ImageAnalysis | null }; design?: Design }): string[] | undefined {
  const im = r.analysis?.image;
  if (!im) return undefined;
  const ref = im.scaleReference.kind === 'none' ? tr('нет — размеры оценены по типу аппарата', 'none — sizes estimated from the vehicle type') : `${im.scaleReference.what}${im.scaleReference.sizeM ? ` (${fmt(im.scaleReference.sizeM)} ${U.m})` : ''}`;
  const out = [tr(`Вид ${VIEW_NAMES[im.view] ?? im.view}. Эталон масштаба: ${ref}.`, `View: ${VIEW_NAMES[im.view] ?? im.view}. Scale reference: ${ref}.`)];
  const c = im.counts;
  const counts = [c.wings !== null ? `${tr('крыльев', 'wings')} ${c.wings}` : '', c.rotors !== null ? `${tr('несущих винтов', 'rotors')} ${c.rotors}` : '', c.bladesPerRotor !== null ? `${tr('лопастей', 'blades')} ${c.bladesPerRotor}` : '', c.propellers !== null ? `${tr('воздушных винтов', 'propellers')} ${c.propellers}` : ''].filter(Boolean);
  if (counts.length) out.push(`${tr('Посчитано на картинке', 'Counted in the image')}: ${counts.join(', ')}.`);
  if (im.measured.length) out.push(`${tr('Снято с картинки', 'Measured from the image')}: ${im.measured.map((m) => `${m.what} ${fmt(m.valueM)} ${U.m}`).join('; ')}.`);
  const est = (r.design?.assumptions ?? []).filter((a) => a.origin === 'estimated').map((a) => a.label);
  if (est.length) out.push(`${tr('Оценено, на картинке не видно', 'Estimated, not visible in the image')}: ${est.join(', ')}.`);
  return out;
}
function showImageNote(lines?: string[]) {
  const box = $('imageNote');
  box.innerHTML = '';
  if (!lines?.length) return;
  box.append(el('b', tr('По картинке', 'From the image')));
  const ul = el('ul');
  for (const x of lines) ul.append(el('li', x));
  box.append(ul);
}

$('genBtn').addEventListener('click', async () => {
  const text = $<HTMLTextAreaElement>('genText').value.trim();
  if (!text && !picked) return;
  const btn = $<HTMLButtonElement>('genBtn');
  btn.disabled = true;
  const t0 = performance.now();
  const tick = setInterval(() => (genStatus.textContent = tr(`ИИ ${picked ? 'разбирает картинку и ' : ''}собирает аппарат… ${Math.round((performance.now() - t0) / 1000)} с`, `The AI is ${picked ? 'reading the image and ' : ''}building the vehicle… ${Math.round((performance.now() - t0) / 1000)} s`)), 500);
  try {
    const res = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, lang: getLang(), image: picked ? { type: picked.type, data: picked.data } : undefined }) });
    const r = await res.json();
    if (!r.ok) {
      genStatus.textContent = r.error ?? tr('не получилось', 'it did not work');
      return;
    }
    const a = r.analysis;
    const info = tr(`${a.recognizedAs}. Части: ${a.components.join(', ')}. Собрано за ${fmt(r.ms / 1000)} с, `, `${a.recognizedAs}. Parts: ${a.components.join(', ')}. Built in ${fmt(r.ms / 1000)} s, `) +
      `$${r.costUsd.toFixed(3)}${r.attempts > 1 ? tr(`, исправлений после проверки: ${r.attempts - 1}`, `, corrections after validation: ${r.attempts - 1}`) : ''}.`;
    genStatus.textContent = '';
    addGenerated(r.design, info, imageNoteFrom(r));
  } catch {
    genStatus.textContent = tr('Нет связи с сервером генерации.', 'Cannot reach the generation server.');
  } finally {
    clearInterval(tick);
    btn.disabled = false;
  }
});

// ---------- управление ----------
function setPlaying(v: boolean) {
  playing = v;
  $('play').textContent = playing && (!finishing || autoFast) ? tr('Пауза', 'Pause') : run?.done ? tr('Готово', 'Done') : tr('Пуск', 'Run');
  $<HTMLButtonElement>('finish').disabled = !run || run.done || (finishing && !autoFast);
  $<HTMLButtonElement>('play').disabled = !run; // модель не собрана — пускать нечего
}
$('play').addEventListener('click', () => {
  if (!run) return;
  if (replaying) stopReplay();
  if (run?.done) rebuild();
  finishing = false;
  setPlaying(!playing);
  // Труба считается ускоренно сразу по нажатию — не дожидаясь кадра отрисовки (в фоновой вкладке его может не быть).
  if (playing && run && !run.done && run.fastForward) startFinish(true);
});
$('finish').addEventListener('click', () => {
  if (replaying) stopReplay();
  startFinish();
});
$('reset').addEventListener('click', () => rebuild());
$('program').addEventListener('input', () => {
  state.program = $<HTMLSelectElement>('program').value as ProgramId;
  rebuild();
});
matSel.addEventListener('change', () => {
  state.material = matSel.value || undefined;
  rebuild();
});
$('breakable').addEventListener('change', () => {
  state.breakable = $<HTMLInputElement>('breakable').checked;
  rebuild();
});
for (const id of ['altitude', 'isaDeviation', 'cruise', 'wind'] as const) $(id).addEventListener('change', () => {
  const x = Number($<HTMLInputElement>(id).value);
  if (id === 'altitude') state.altitude = Number.isFinite(x) ? Math.max(0, x) : 0;
  else if (id === 'isaDeviation') state.isaDeviation = Number.isFinite(x) && x !== 0 ? Math.max(-60, Math.min(60, x)) : undefined;
  else state[id] = Number.isFinite(x) && x > 0 ? x : undefined;
  rebuild();
});

function syncInputs() {
  $<HTMLSelectElement>('program').value = state.program;
  matSel.value = state.material ?? '';
  $<HTMLInputElement>('breakable').checked = state.breakable !== false;
  $<HTMLInputElement>('altitude').value = String(state.altitude ?? 0);
  $<HTMLInputElement>('isaDeviation').value = String(state.isaDeviation ?? 0);
  $<HTMLInputElement>('cruise').value = String(state.cruise ?? 0);
  $<HTMLInputElement>('wind').value = String(state.wind ?? 0);
}

// ---------- старт: ссылка или пример ----------
let startScreen: Screen = 'input';
let autoReport = false;
const hash = location.hash.match(/^#([tr])=(.+)$/);
const params = new URLSearchParams(location.search);
if (hash) {
  const { state: s, error } = decodeState(hash[2]);
  if (s) {
    if ('design' in s.vehicle) {
      const id = `gen-${++genCount}`;
      GENERATED[id] = { design: s.vehicle.design, info: s.vehicle.info ?? '' };
      vehicleId = id;
    } else vehicleId = s.vehicle.preset;
    Object.assign(state, s);
    startScreen = hash[1] === 'r' ? 'stand' : 'assume';
    autoReport = hash[1] === 'r';
  } else genStatus.textContent = `${tr('Ссылка не открылась', 'The link did not open')}: ${error}.`;
} else if (params.get('preset') && PRESETS[params.get('preset')!]) {
  setVehicle(params.get('preset')!);
  state.program = defaultProgram();
  startScreen = 'assume';
}
if (params.get('program') && params.get('program')! in PROGRAMS) state.program = params.get('program') as ProgramId;
if (GENERATED[vehicleId]) $('genInfo').textContent = GENERATED[vehicleId].info;

syncInputs();
buildGallery();
buildAssumptions();
rebuild();
go(startScreen);
resize();
void checkApi();
requestAnimationFrame(frame);
const storedId = location.pathname.match(/^\/r\/([A-Za-z0-9]{6,16})\/?$/)?.[1];
if (storedId) void openStored(storedId);
else if (autoReport) go('report');
