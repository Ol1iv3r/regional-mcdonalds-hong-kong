import { GraphView } from './graph-view.js';

const $ = id => document.getElementById(id);
const svgNS = 'http://www.w3.org/2000/svg';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const worldWidth = 1800;
const camera = { x: 0, y: 0, scale: 1, tx: 0, ty: 0, ts: 1, vx: 0, vy: 0, vs: 0 };
const pointers = new Map();
let content, worldHeight, baseScale, mapFrame = 0, introGraph, modalGraph, returnFocus;
let photoElements = [], pinElements = [], leaderElements = [];
let exploring = false, moved = false, pinchState = null, modalSession = 0;
const offsets = [
  { x: -173, y: 51 }, // Hung Hom: west of its close neighbour.
  { x: 53, y: -110 },
  { x: 54, y: -81 },
  { x: -75, y: -123 },
  { x: -151, y: -70 }
];
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

function elementNS(tag, attributes = {}) {
  const el = document.createElementNS(svgNS, tag);
  Object.entries(attributes).forEach(([key, value]) => el.setAttribute(key, value));
  return el;
}

async function load() {
  try {
    const response = await fetch('assets/content.json');
    if (!response.ok) throw new Error(`Content: ${response.status}`);
    content = await response.json();
    worldHeight = worldWidth * content.map.height / content.map.width;
    $('map-world').style.width = `${worldWidth}px`;
    $('map-world').style.height = `${worldHeight}px`;
    $('basemap').src = content.map.src;
    $('basemap').addEventListener('load', () => { $('loading-note').textContent = ''; }, { once: true });
    if ($('basemap').complete) $('loading-note').textContent = '';
    $('basemap').addEventListener('error', () => { $('loading-note').textContent = 'Map image unavailable. Refresh to try again.'; });
    createMap();
    renderJourneyMini();
    introGraph = new GraphView($('intro-journey'), content.journey, { journey: true, compact: true, reducedMotion });
    resetMap(true);
    $('explore').disabled = false;
    document.body.dataset.ready = 'true';
  } catch (error) {
    console.error(error);
    $('error').hidden = false;
    $('loading-note').textContent = 'The map could not load.';
  }
}

function createMap() {
  const locations = $('locations');
  locations.setAttribute('viewBox', `0 0 ${worldWidth} ${worldHeight}`);
  $('photo-leaders').setAttribute('viewBox', `0 0 ${worldWidth} ${worldHeight}`);
  (content.markers || []).forEach(marker => {
    if (!Number.isFinite(marker.x) || !Number.isFinite(marker.y)) return;
    const dot = elementNS('circle', {
      cx: marker.x * worldWidth, cy: marker.y * worldHeight, r: 2.35,
      fill: '#ffd24a', opacity: '.92'
    });
    const title = elementNS('title');
    title.textContent = marker.name;
    dot.append(title);
    locations.append(dot);
  });
  content.restaurants.forEach((restaurant, index) => {
    const name = restaurant.name.replace(/^McDonald['’]s\s*[-·–—:]\s*/i, '');
    const n = String(index + 1).padStart(2, '0');
    const pin = document.createElement('button');
    pin.className = 'restaurant-pin';
    pin.dataset.restaurant = restaurant.id;
    pin.setAttribute('aria-expanded', 'false');
    pin.setAttribute('aria-label', `Explore McDonald’s — ${name}`);
    pin.style.left = `${restaurant.anchor.x * worldWidth}px`;
    pin.style.top = `${restaurant.anchor.y * worldHeight}px`;
    pin.style.setProperty('--delay', `${index * -.6}s`);
    pin.innerHTML = `<span>${index + 1}</span>`;
    pin.addEventListener('click', event => { if (!moved || event.detail === 0) openRestaurant(restaurant); });
    $('restaurants').append(pin);
    pinElements.push(pin);
    if (restaurant.secondaryAnchor) {
      const secondary = pin.cloneNode(true);
      secondary.setAttribute('aria-label', `Explore ${name} — second location`);
      secondary.style.left = `${restaurant.secondaryAnchor.x * worldWidth}px`;
      secondary.style.top = `${restaurant.secondaryAnchor.y * worldHeight}px`;
      secondary.addEventListener('click', event => { if (!moved || event.detail === 0) openRestaurant(restaurant); });
      $('restaurants').append(secondary);
      pinElements.push(secondary);
    }
    const photos = restaurant.photos || [];
    if (photos[0]) {
      const photo = document.createElement('button');
      photo.className = 'restaurant-photo';
      photo.dataset.restaurant = restaurant.id;
      photo.setAttribute('aria-label', `Open ${name} restaurant graph`);
      const photoStrip = document.createElement('span');
      photoStrip.className = `photo-strip${photos.length > 1 ? ' photo-pair' : ''}`;
      photos.forEach(asset => {
        const img = document.createElement('img');
        img.src = asset.src;
        img.alt = asset.alt || `McDonald’s — ${name}`;
        img.draggable = false;
        photoStrip.append(img);
      });
      photo.append(photoStrip);
      const caption = document.createElement('span');
      caption.className = 'photo-caption';
      caption.innerHTML = `<em>${n}</em><span>${escapeHTML(name)}</span><small aria-hidden="true">↗</small>`;
      photo.append(caption);
      photo.addEventListener('click', event => { if (!moved || event.detail === 0) openRestaurant(restaurant); });
      $('restaurants').append(photo);
      const line = elementNS('line', { stroke: '#ece8cb', 'stroke-width': '.6', opacity: '.58', 'vector-effect': 'non-scaling-stroke' });
      $('photo-leaders').append(line);
      photoElements.push({ el: photo, restaurant, offset: offsets[index] || { x: 35, y: -90 } });
      leaderElements.push(line);
    }
  });
}

function renderMap() {
  $('map-world').style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`;
  $('map-world').style.setProperty('--inverse-scale', 1 / camera.scale);
  const mobile = innerWidth < 900, photoWidth = mobile ? 98 : 132;
  photoElements.forEach(({ el, restaurant, offset }, index) => {
    const x = restaurant.anchor.x * worldWidth, y = restaurant.anchor.y * worldHeight;
    const narrowOffsets = [{x:-95,y:70},{x:-30,y:-160},{x:30,y:-30},{x:-65,y:-110},{x:-140,y:-50}];
    const adjusted = mobile ? narrowOffsets[content.restaurants.indexOf(restaurant)] || offset : offset;
    const dx = adjusted.x, dy = adjusted.y;
    el.style.left = `${x + dx / camera.scale}px`;
    el.style.top = `${y + dy / camera.scale}px`;
    const edgeX = dx < 0 ? dx + photoWidth : dx;
    const line = leaderElements[index];
    line.setAttribute('x1', x);
    line.setAttribute('y1', y);
    line.setAttribute('x2', x + edgeX / camera.scale);
    line.setAttribute('y2', y + (dy + (mobile ? 30 : 41)) / camera.scale);
  });
}

function animateMap() {
  mapFrame = 0;
  if (reducedMotion) {
    Object.assign(camera, { x: camera.tx, y: camera.ty, scale: camera.ts, vx: 0, vy: 0, vs: 0 });
    renderMap(); return;
  }
  camera.vx = (camera.vx + (camera.tx - camera.x) * .12) * .69;
  camera.vy = (camera.vy + (camera.ty - camera.y) * .12) * .69;
  camera.vs = (camera.vs + (camera.ts - camera.scale) * .12) * .69;
  camera.x += camera.vx; camera.y += camera.vy; camera.scale += camera.vs;
  renderMap();
  if (Math.abs(camera.tx - camera.x) + Math.abs(camera.ty - camera.y) > .1 || Math.abs(camera.ts - camera.scale) > .0001) {
    mapFrame = requestAnimationFrame(animateMap);
  } else {
    camera.x = camera.tx; camera.y = camera.ty; camera.scale = camera.ts; renderMap();
  }
}
function wakeMap() { if (!mapFrame) mapFrame = requestAnimationFrame(animateMap); }
function resetMap(immediate = false) {
  if (!worldHeight) return;
  baseScale = Math.min(innerWidth / worldWidth, innerHeight / worldHeight);
  camera.ts = baseScale;
  camera.tx = (innerWidth - worldWidth * baseScale) / 2;
  camera.ty = (innerHeight - worldHeight * baseScale) / 2;
  if (immediate) {
    camera.x = camera.tx; camera.y = camera.ty; camera.scale = camera.ts;
    camera.vx = camera.vy = camera.vs = 0; renderMap();
  } else wakeMap();
}
function zoom(factor, x = innerWidth / 2, y = innerHeight / 2) {
  const newScale = Math.min(baseScale * 15, Math.max(baseScale * .7, camera.ts * factor));
  const ratio = newScale / camera.ts;
  camera.tx = x - (x - camera.tx) * ratio;
  camera.ty = y - (y - camera.ty) * ratio;
  camera.ts = newScale;
  wakeMap();
}

$('map').addEventListener('wheel', event => {
  if (!exploring || !$('modal').hidden) return;
  event.preventDefault();
  zoom(Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * .003), event.clientX, event.clientY);
}, { passive: false });
$('map').addEventListener('pointerdown', event => {
  if (!exploring || event.button > 0 || !$('modal').hidden) return;
  moved = false;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY });
  if (!event.target.closest('button')) $('map').setPointerCapture(event.pointerId);
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchState = { distance: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
});
window.addEventListener('pointermove', event => {
  const pointer = pointers.get(event.pointerId);
  if (!pointer) return;
  const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
  pointer.x = event.clientX; pointer.y = event.clientY;
  if (Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY) > 5) moved = true;
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const distance = Math.hypot(a.x - b.x, a.y - b.y), x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
    if (pinchState) {
      zoom(distance / Math.max(1, pinchState.distance), x, y);
      camera.tx += x - pinchState.x; camera.ty += y - pinchState.y;
    }
    pinchState = { distance, x, y };
  } else {
    camera.tx += dx; camera.ty += dy;
    camera.x = camera.tx; camera.y = camera.ty; camera.vx = camera.vy = 0;
    renderMap();
  }
});
['pointerup', 'pointercancel'].forEach(type => window.addEventListener(type, event => {
  pointers.delete(event.pointerId); pinchState = null;
}));
$('map').addEventListener('dblclick', event => {
  if (!event.target.closest('button') && exploring) zoom(1.6, event.clientX, event.clientY);
});
$('map').addEventListener('keydown', event => {
  if (event.target !== $('map')) return;
  if (event.key === '+' || event.key === '=') zoom(1.35);
  else if (event.key === '-') zoom(1 / 1.35);
  else if (event.key === '0' || event.key === 'Home') resetMap();
  else if (event.key.startsWith('Arrow')) {
    event.preventDefault();
    if (event.key === 'ArrowLeft') camera.tx += 70;
    if (event.key === 'ArrowRight') camera.tx -= 70;
    if (event.key === 'ArrowUp') camera.ty += 70;
    if (event.key === 'ArrowDown') camera.ty -= 70;
    wakeMap();
  }
});
$('zoom-in').addEventListener('click', () => zoom(1.5));
$('zoom-out').addEventListener('click', () => zoom(1 / 1.5));
$('reset-map').addEventListener('click', () => resetMap());
window.addEventListener('resize', () => { resetMap(true); introGraph?.fit(); modalGraph?.fit(); });

function renderJourneyMini() {
  const nodes = content.journey.nodes;
  const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const positions = new Map(nodes.map(n => [n.id, { x: 8 + (n.x - minX) / (maxX - minX) * 504, y: 8 + (n.y - minY) / (maxY - minY) * 94 }]));
  content.journey.edges.forEach(edge => {
    const a = positions.get(edge.source), b = positions.get(edge.target);
    if (!a || !b) return;
    $('journey-mini').append(elementNS('line', { x1:a.x,y1:a.y,x2:b.x,y2:b.y,stroke:edge.color || '#91a7a2','stroke-width':1,opacity:.65 }));
  });
  nodes.forEach((node, i) => {
    const p = positions.get(node.id);
    $('journey-mini').append(elementNS('circle', { cx:p.x,cy:p.y,r:i===0?4:2.7,fill:i===0?'#ffd147':'#c9d7ce' }));
  });
}

function explore() {
  if (!content || exploring) return;
  exploring = true;
  if (!reducedMotion) {
    const from = $('intro-journey').getBoundingClientRect(), to = $('journey-mini').getBoundingClientRect();
    const clone = $('intro-journey').cloneNode(true);
    clone.removeAttribute('id');
    Object.assign(clone.style, { position:'fixed', left:`${from.x}px`,top:`${from.y}px`,width:`${from.width}px`,height:`${from.height}px`,zIndex:12,pointerEvents:'none',transformOrigin:'0 0' });
    document.body.append(clone);
    clone.animate([
      { transform:'translate(0,0) scale(1)',opacity:.9 },
      { transform:`translate(${to.x-from.x}px,${to.y-from.y}px) scale(${to.width/from.width},${to.height/from.height})`,opacity:0 }
    ], { duration:950,easing:'cubic-bezier(.22,.8,.22,1)',fill:'forwards' }).finished.then(() => clone.remove());
  }
  $('intro').classList.add('leaving');
  $('intro').setAttribute('aria-hidden','true');
  $('intro').inert = true;
  document.body.classList.add('exploring');
  $('map').focus({ preventScroll:true });
}
$('explore').disabled = true;
$('explore').addEventListener('click', explore);

function openModal(title, kicker, mode = 'graph') {
  modalSession++;
  returnFocus = document.activeElement;
  modalGraph?.destroy(); modalGraph = null;
  $('modal').classList.toggle('text-mode', mode === 'text');
  $('modal').classList.toggle('journey-mode', mode === 'journey');
  $('modal-title').textContent = title;
  $('modal-kicker').textContent = kicker;
  $('modal-copy').replaceChildren();
  $('modal-graph').replaceChildren();
  $('modal').hidden = false;
  $('modal-close').focus({ preventScroll:true });
  $('map').inert = true;
  document.querySelectorAll('.map-ui').forEach(el => { el.inert = true; });
  if (!exploring) $('intro').inert = true;
}
function closeModal() {
  modalSession++;
  modalGraph?.destroy(); modalGraph = null;
  $('modal').hidden = true;
  $('map').inert = false;
  document.querySelectorAll('.map-ui').forEach(el => { el.inert = false; });
  if (!exploring) $('intro').inert = false;
  document.querySelectorAll('.restaurant-pin').forEach(el => el.setAttribute('aria-expanded','false'));
  returnFocus?.focus({ preventScroll:true });
}
function openRestaurant(restaurant) {
  openModal(restaurant.name, '');
  const notes = (restaurant.notes || []).map(note => typeof note === 'string' ? note : note.text || note.label || '').filter(Boolean);
  if (notes.length) $('modal-copy').innerHTML = `<p class="graph-note">${notes.map(escapeHTML).join(' ')}</p>`;
  document.querySelectorAll(`.restaurant-pin[data-restaurant="${restaurant.id}"]`).forEach(el => el.setAttribute('aria-expanded','true'));
  const session = modalSession;
  requestAnimationFrame(() => {
    if (session === modalSession && !$('modal').hidden) modalGraph = new GraphView($('modal-graph'), restaurant, { reducedMotion });
  });
}
function openJourney() {
  if (!content) return;
  openModal('The customer journey', '', 'journey');
  const session = modalSession;
  requestAnimationFrame(() => { if (session === modalSession && !$('modal').hidden) modalGraph = new GraphView($('modal-graph'), content.journey, { journey:true, reducedMotion }); });
}
function openAbout() {
  if (!content) return;
  openModal('Regional McDonald’s', 'HONG KONG · HOW TO READ THIS MAP', 'text');
  const evidence = [
    ['[F]', 'Sourced fact'],
    ['[OBS]', 'Descriptive statement'],
    ['[?]', 'Tentative statement'],
    ['[TBC]', 'Unverified'],
    ['[EXP/?]', 'Prior experience / inference'],
    ['[HEARSAY]', 'Passerby report, unconfirmed']
  ];
  $('modal-copy').innerHTML = `<div class="prose"><p class="big-question">The same brand.<br>A different place in our lives.</p><p>This system map looks at five McDonald’s restaurants across Hong Kong through <strong>location, opening hours, service and facilities</strong> — and their connections to customer footfall, order volume, staff allocation and the use of space.</p><div class="graph-key"><span><i class="key-dot positive-bg"></i>Positive</span><span><i class="key-dot depends-bg"></i>Depends on context</span><span><i class="key-dot negative-bg"></i>Negative</span></div><dl class="evidence-list">${evidence.map(([code, text]) => `<dt>${code}</dt><dd>${text}</dd>`).join('')}</dl><p class="prose-note">The labels and research content follow the supplied A1 poster. Descriptive statements are not all independently verified findings. Restaurant locations are a snapshot of the source map, not a live directory.</p><p class="prose-note">${escapeHTML(content.map.attribution)}</p></div>`;
}
function openPrompt() {
  if (!content) return;
  openModal('A different experience?', 'THE QUESTIONS BEHIND THE MAP', 'text');
  const paragraphs = [
    'How do the positive, negative and context-dependent connections change the experience beyond the taste of the food?',
    'What could we change about the space, the location or the way it is used?',
    'How do these different regions — and surroundings with or without McDonald’s — shape people’s eating experiences in the long term?',
    'And how will those experiences change the way people describe McDonald’s?'
  ];
  $('modal-copy').innerHTML = `<div class="prose"><p class="big-question">What changes when the same food is served in a different place?</p>${paragraphs?.length ? paragraphs.map(text=>`<p>${escapeHTML(text)}</p>`).join('') : '<p>Our impression of a restaurant is shaped by more than taste. The people around us, the time available, the room to sit and the ways we are served all change the experience.</p><p>Explore a restaurant, then follow its connections. Where does a benefit for one person become a difficulty for another? What could make this everyday system work better?</p>'}<p class="prose-note">Click a red location point or a restaurant photograph. In each graph, drag a node, follow its connections and zoom in to read. Close the graph to return to the same place on the map.</p></div>`;
}
$('about-open').addEventListener('click', openAbout);
$('prompt-open').addEventListener('click', openPrompt);
$('journey-open').addEventListener('click', openJourney);
$('intro-journey-open').addEventListener('click', openJourney);
$('modal-close').addEventListener('click', closeModal);
document.querySelector('.modal-backdrop').addEventListener('click', closeModal);
$('graph-fit').addEventListener('click', () => modalGraph?.fit());
$('graph-replay').addEventListener('click', () => modalGraph?.replay());
$('graph-zoom-in').addEventListener('click', () => modalGraph?.zoomBy(1.45));
$('graph-zoom-out').addEventListener('click', () => modalGraph?.zoomBy(1 / 1.45));
window.addEventListener('keydown', event => {
  if ($('modal').hidden) return;
  if (event.key === 'Escape') closeModal();
  if (event.key === 'Tab') {
    const focusable = [...$('modal').querySelectorAll('button,[tabindex="0"],a[href]')].filter(el => el.offsetParent !== null);
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
});
load();
