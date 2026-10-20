/* Interactive, SVG-native graph view. Source node/edge IDs and statements stay intact. */
const NS = 'http://www.w3.org/2000/svg';
const FONT = 'Arial, Helvetica, sans-serif';
const PALETTE = { neutral: '#b6c2c4', green: '#76b59a', yellow: '#d4b46b', red: '#d68080' };
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const el = (name, attrs = {}) => {
  const n = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) n.setAttribute(key, value);
  return n;
};
const hash = text => Array.from(String(text)).reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const isEffectColor = color => /^#(76b59a|d4b46b|d68080)$/i.test(color || '');

function wrap(text, maxWidth, fontSize, context) {
  context.font = `${fontSize}px ${FONT}`;
  const lines = [];
  String(text || '').split(/\n/).forEach(paragraph => {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && context.measureText(candidate).width > maxWidth) {
        lines.push(line); line = word;
      } else line = candidate;
    }
    if (line) lines.push(line);
  });
  return lines.length ? lines : [''];
}

function roundedPath(points, radius = 12) {
  if (points.length < 2) return '';
  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1], b = points[i], c = points[i + 1];
    const d1 = distance(a, b), d2 = distance(b, c);
    const r = Math.min(radius, d1 / 3, d2 / 3);
    const before = { x: b.x + (a.x - b.x) * r / (d1 || 1), y: b.y + (a.y - b.y) * r / (d1 || 1) };
    const after = { x: b.x + (c.x - b.x) * r / (d2 || 1), y: b.y + (c.y - b.y) * r / (d2 || 1) };
    d += ` L ${before.x.toFixed(2)} ${before.y.toFixed(2)} Q ${b.x.toFixed(2)} ${b.y.toFixed(2)} ${after.x.toFixed(2)} ${after.y.toFixed(2)}`;
  }
  const last = points.at(-1);
  return `${d} L ${last.x.toFixed(2)} ${last.y.toFixed(2)}`;
}

// Liang–Barsky segment/rectangle clipping. Boundary-following segments are allowed.
function crosses(a, b, rect) {
  let lo = 0, hi = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - rect.l, rect.r - a.x, a.y - rect.t, rect.b - a.y];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 0.0001) { if (q[i] <= 0) return false; }
    else {
      const t = q[i] / p[i];
      if (p[i] < 0) lo = Math.max(lo, t); else hi = Math.min(hi, t);
      if (lo >= hi) return false;
    }
  }
  return lo < 0.999 && hi > 0.001;
}

function route(a, b, obstacles) {
  let points = [{ x: a.ax, y: a.ay }, { x: b.ax, y: b.ay }];
  const completed = new Set();
  for (let pass = 0; pass < 18; pass++) {
    let found = null;
    outer: for (let k = 0; k < points.length - 1; k++) {
      for (const box of obstacles) {
        if (!completed.has(box.id) && crosses(points[k], points[k + 1], box)) {
          found = { k, box }; break outer;
        }
      }
    }
    if (!found) break;
    const { k, box } = found;
    completed.add(box.id);
    const s = points[k], t = points[k + 1];
    const tl = { x: box.l - 2, y: box.t - 2 }, tr = { x: box.r + 2, y: box.t - 2 };
    const bl = { x: box.l - 2, y: box.b + 2 }, br = { x: box.r + 2, y: box.b + 2 };
    let best = null, bestCost = Infinity;
    for (const middle of [[tl], [tr], [bl], [br], [tl, tr], [tr, tl], [bl, br], [br, bl], [tl, bl], [bl, tl], [tr, br], [br, tr]]) {
      const candidate = [s, ...middle, t];
      if (candidate.slice(1).some((p, i) => crosses(candidate[i], p, box))) continue;
      let cost = 0;
      for (let j = 1; j < candidate.length; j++) {
        cost += distance(candidate[j - 1], candidate[j]);
        for (const other of obstacles) if (other !== box && crosses(candidate[j - 1], candidate[j], other)) cost += 90;
      }
      if (cost < bestCost) { bestCost = cost; best = middle; }
    }
    if (best) points.splice(k + 1, 0, ...best);
  }
  return points;
}

export class GraphView {
  constructor(container, graph, options = {}) {
    this.container = container;
    this.options = options;
    this.reduced = options.reducedMotion ?? matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.context = document.createElement('canvas').getContext('2d');
    this.nodes = (graph.nodes || []).map(n => ({ ...n, vx: 0, vy: 0, dragging: false }));
    this.lookup = new Map(this.nodes.map(n => [n.id, n]));
    this.edges = (graph.edges || []).filter(e => this.lookup.has(e.source) && this.lookup.has(e.target)).map(e => ({ ...e, a: this.lookup.get(e.source), b: this.lookup.get(e.target) }));
    this.incoming = new Map(this.nodes.map(n => [n.id, this.edges.filter(e => e.target === n.id)]));
    this.annotations = (graph.annotations || []).filter(a => this.lookup.has(a.source) && this.lookup.has(a.target)).map(a => ({ ...a, a: this.lookup.get(a.source), b: this.lookup.get(a.target) }));
    this.uid = `graph-${Math.random().toString(36).slice(2, 9)}`;
    this.disposed = false;
    this.pointer = null;
    this.touches = new Map();
    this.scale = 1;
    this.tx = this.ty = 0;
    this._listeners = [];
    this.prepareLabels();
    if (options.geographic) this.layoutGeographic(); else if (options.journey) this.layoutJourney(); else this.layoutRestaurant();
    this.prepareAnnotations();
    this.build();
    this.computeRoutes();
    if (!options.geographic) {
      this.resizeObserver = new ResizeObserver(() => this.fit());
      this.resizeObserver.observe(container);
    }
    this.fit();
    this.replay();
  }

  prepareLabels() {
    for (const node of this.nodes) {
      const major = node.role === 'root' || node.role === 'category' || node.role === 'hub';
      node.fontSize = node.role === 'root' ? 21 : major ? 16 : this.options.journey ? (this.options.compact ? 21 : 17) : 14.5;
      node.wrapWidth = node.role === 'root' ? 350 : major ? 220 : this.options.journey ? (this.options.compact ? 180 : 160) : 180;
      if (this.options.geographic) {
        node.fontSize = Number(node.size) || (major ? 6 : 4.5);
        node.wrapWidth = Number(node.labelWidth) || 90;
      }
      node.lines = this.options.geographic && node.lines?.length ? [...node.lines] : wrap(node.label, node.wrapWidth, node.fontSize, this.context);
      node.lineHeight = this.options.geographic ? (Number(node.lineHeight) || Number(node.leading) || node.fontSize * 1.28) : node.fontSize * 1.32;
      this.context.font = `${node.fontSize}px ${FONT}`;
      node.textWidth = Math.max(...node.lines.map(line => this.context.measureText(line).width));
      node.textHeight = node.lines.length * node.lineHeight;
      node.r = node.role === 'root' ? 10 : major ? 7 : this.options.journey ? 6 : 4.2;
      if (this.options.geographic) node.r = Number(node.radius) || (major ? 3.8 : 1.9);
      node.labelOffset = this.options.geographic ? (Number.isFinite(node.labelY) ? node.labelY - node.y : node.r + node.fontSize * 1.2) : node.r + 12;
      node.textAnchor = this.options.geographic && node.align === 'right' ? 'end' : this.options.geographic && node.align === 'left' ? 'start' : 'middle';
      node.labelDx = this.options.geographic && Number.isFinite(node.labelX) ? node.labelX - node.x : 0;
      node.effectColor = this.incoming.get(node.id)?.find(e => isEffectColor(e.color))?.color || null;
    }
  }

  layoutGeographic() {
    this.root = this.nodes.find(n => n.role === 'root') || this.nodes[0];
    const findTier = (n, seen = new Set()) => {
      if (!n || seen.has(n.id)) return 2;
      if (n === this.root || n.role === 'root') return 0;
      if (n.role === 'category') return 1;
      if (n.role === 'hub') return 4;
      seen.add(n.id);
      const parent = this.lookup.get(n.parentId);
      if (parent?.role === 'hub' || n.effectColor) return 5;
      return parent ? Math.min(3, findTier(parent, seen) + 1) : 2;
    };
    for (const n of this.nodes) {
      n.ax = Number(n.x); n.ay = Number(n.y);
      n.tier = findTier(n);
      n.revealParent = this.lookup.get(n.parentId) || this.incoming.get(n.id)?.[0]?.a || this.root;
    }
  }

  prepareAnnotations() {
    for (const caption of this.annotations) {
      caption.fontSize = this.options.compact ? 21 : 16;
      caption.lineHeight = caption.fontSize * 1.25;
      caption.lines = wrap(caption.text, 185, caption.fontSize, this.context);
      this.context.font = `${caption.fontSize}px ${FONT}`;
      caption.width = Math.max(...caption.lines.map(line => this.context.measureText(line).width));
      caption.height = caption.lines.length * caption.lineHeight;
    }
  }

  layoutRestaurant() {
    const root = this.nodes.find(n => n.role === 'root') || this.nodes[0];
    if (!root) return;
    this.root = root;
    const categoryRank = label => /location/i.test(label) ? 0 : /opening/i.test(label) ? 1 : /^service/i.test(label) ? 2 : 3;
    const hubRank = label => /footfall/i.test(label) ? 0 : /order volume/i.test(label) ? 1 : /staff/i.test(label) ? 2 : 3;
    const categories = this.nodes.filter(n => n.role === 'category').sort((a, b) => categoryRank(a.label) - categoryRank(b.label));
    const hubs = this.nodes.filter(n => n.role === 'hub').sort((a, b) => hubRank(a.label) - hubRank(b.label));
    const ancestor = (node, role, visited = new Set()) => {
      if (!node || visited.has(node.id)) return null;
      if (node.role === role) return node;
      visited.add(node.id);
      const parent = this.lookup.get(node.parentId);
      if (parent) { const found = ancestor(parent, role, visited); if (found) return found; }
      for (const edge of this.incoming.get(node.id) || []) {
        if (edge.kind === 'child' || edge.a.role === role) {
          const found = ancestor(edge.a, role, new Set(visited)); if (found) return found;
        }
      }
      return null;
    };
    const depth = (node, seen = new Set()) => {
      if (!node || node === root || seen.has(node.id)) return 0;
      if (node.role === 'category') return 1;
      seen.add(node.id);
      return 1 + depth(this.lookup.get(node.parentId), seen);
    };
    const facts = new Map(categories.map(n => [n.id, []]));
    const effects = new Map(hubs.map(n => [n.id, []]));
    for (const node of this.nodes) {
      if (['root', 'category', 'hub'].includes(node.role)) continue;
      // Direct parentage wins over analytic cross-links (some source hub edges point back to facts).
      let owner = this.lookup.get(node.parentId), parentSeen = new Set();
      while (owner && !['category', 'hub', 'root'].includes(owner.role) && !parentSeen.has(owner.id)) { parentSeen.add(owner.id); owner = this.lookup.get(owner.parentId); }
      const h = owner?.role === 'hub' ? owner : owner?.role === 'category' ? null : ancestor(node, 'hub');
      if (h && effects.has(h.id)) { effects.get(h.id).push(node); node.tier = 5; node.revealParent = h; continue; }
      let cat = owner?.role === 'category' ? owner : ancestor(node, 'category');
      if (!cat) cat = categories.reduce((best, c) => !best || Math.abs(c.x - node.x) < Math.abs(best.x - node.x) ? c : best, null);
      if (cat) { facts.get(cat.id).push(node); node.tier = Math.min(3, Math.max(2, depth(node))); node.revealParent = this.lookup.get(node.parentId) || cat; }
    }
    const widths = categories.map(c => Math.max(410, facts.get(c.id).length > 7 ? 615 : 410));
    const gap = 50;
    const width = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, categories.length - 1);
    root.ax = width / 2; root.ay = 10; root.tier = 0;
    let laneLeft = 0, factBottom = 0;
    categories.forEach((cat, index) => {
      const laneWidth = widths[index];
      cat.ax = laneLeft + laneWidth / 2; cat.ay = 120 + (index % 2) * 12; cat.tier = 1; cat.revealParent = root;
      const members = facts.get(cat.id).sort((a, b) => depth(a) - depth(b) || (a.x - b.x));
      const columns = members.length > 7 ? 3 : 2;
      const colWidth = laneWidth / columns;
      const ys = Array(columns).fill(230);
      members.forEach((node, i) => {
        const col = ys.indexOf(Math.min(...ys));
        node.ax = laneLeft + colWidth * (col + 0.5) + ((hash(node.id) % 9) - 4);
        node.ay = ys[col];
        ys[col] += node.textHeight + node.labelOffset + 32;
        factBottom = Math.max(factBottom, ys[col]);
      });
      laneLeft += laneWidth + gap;
    });
    const hubTop = factBottom + 50;
    const hubWeights = hubs.map(h => Math.max(300, effects.get(h.id).length > 5 ? 650 : effects.get(h.id).length > 3 ? 460 : 360));
    const totalWeight = hubWeights.reduce((a, b) => a + b, 0);
    let hubLeft = 0;
    hubs.forEach((hub, index) => {
      const laneWidth = width * hubWeights[index] / totalWeight;
      hub.ax = hubLeft + laneWidth / 2;
      hub.ay = hubTop + (index % 2) * 18;
      hub.tier = 4;
      hub.revealParent = this.incoming.get(hub.id)?.[0]?.a || root;
      const members = effects.get(hub.id);
      const columns = members.length > 5 ? 3 : members.length > 2 ? 2 : Math.max(1, members.length);
      const ys = Array(columns).fill(hubTop + 120);
      members.forEach(node => {
        const col = ys.indexOf(Math.min(...ys));
        node.ax = hubLeft + laneWidth / columns * (col + 0.5);
        node.ay = ys[col] + (col % 2) * 10;
        ys[col] += node.textHeight + node.labelOffset + 45;
      });
      hubLeft += laneWidth;
    });
    // A few inherited nodes may not have a declared parent. Keep them visible.
    let spare = 0;
    this.nodes.forEach(n => {
      if (!Number.isFinite(n.ax)) { n.ax = width / 2; n.ay = hubTop + 200 + spare++ * 110; n.tier = 3; n.revealParent = root; }
      n.x = n.ax; n.y = n.ay;
    });
    this.separateLabels();
  }

  layoutJourney() {
    if (!this.nodes.length) return;
    const minX = Math.min(...this.nodes.map(n => n.x));
    const minY = Math.min(...this.nodes.map(n => n.y));
    this.root = this.nodes[0];
    for (const node of this.nodes) {
      node.ax = (node.x - minX) * 3.5;
      node.ay = (node.y - minY) * (this.options.compact ? 1.8 : 3.3);
      node.tier = Math.round((node.x - minX) / 65);
      node.revealParent = this.lookup.get(node.parentId) || this.incoming.get(node.id)?.[0]?.a || this.root;
      node.x = node.ax; node.y = node.ay;
    }
    this.separateLabels();
  }

  separateLabels() {
    // Resolve label boxes vertically before applying spring motion, preserving lanes.
    for (let pass = 0; pass < 7; pass++) {
      let moved = false;
      for (let i = 0; i < this.nodes.length; i++) for (let j = i + 1; j < this.nodes.length; j++) {
        const a = this.nodes[i], b = this.nodes[j];
        const ax = a.ax - a.textWidth / 2 - 9, bx = b.ax - b.textWidth / 2 - 9;
        const ay = a.ay - a.r - 4, by = b.ay - b.r - 4;
        const ah = a.r + a.labelOffset + a.textHeight + 20, bh = b.r + b.labelOffset + b.textHeight + 20;
        if (ax < bx + b.textWidth + 18 && ax + a.textWidth + 18 > bx && ay < by + bh && ay + ah > by) {
          const lower = a.ay <= b.ay ? b : a;
          lower.ay += Math.min(ay + ah - by, by + bh - ay) + 12;
          lower.y = lower.ay; moved = true;
        }
      }
      if (!moved) break;
    }
  }

  build() {
    this.svg = el('svg', { class: 'graph-svg', role: 'group', 'aria-label': this.options.journey ? 'Customer journey. Drag nodes, pan, or zoom to explore.' : 'Restaurant system graph. Drag nodes, pan, or zoom to explore.', width: '100%', height: '100%', tabindex: '0' });
    if (this.options.geographic) this.svg.setAttribute('viewBox', '0 0 2383.937 1683.779');
    Object.assign(this.svg.style, { display: 'block', overflow: 'hidden', touchAction: 'none', cursor: this.options.compact ? 'default' : 'grab', userSelect: 'none', WebkitUserSelect: 'none' });
    const defs = el('defs');
    const arrow = el('marker', { id: `${this.uid}-arrow`, viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '5', markerHeight: '5', orient: 'auto-start-reverse', markerUnits: 'strokeWidth' });
    arrow.append(el('path', { d: 'M 0 1 L 9 5 L 0 9', fill: 'none', stroke: '#a6b5b5', 'stroke-width': '1.5' }));
    defs.append(arrow); this.svg.append(defs);
    this.world = el('g', { class: 'graph-world' });
    this.edgeGroup = el('g', { class: 'graph-connections', fill: 'none' });
    this.nodeGroup = el('g', { class: 'graph-nodes' });
    this.annotationGroup = el('g', { class: 'graph-annotations', 'pointer-events': 'none' });
    this.world.append(this.edgeGroup, this.annotationGroup, this.nodeGroup); this.svg.append(this.world);
    for (const edge of this.edges) {
      edge.path = el('path', { class: 'graph-edge', stroke: isEffectColor(edge.color) ? edge.color : PALETTE.neutral, 'stroke-width': this.options.geographic ? (isEffectColor(edge.color) ? .65 : .5) : isEffectColor(edge.color) ? 1.65 : 1.05, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'data-source': edge.source, 'data-target': edge.target, opacity: '0' });
      if (this.options.journey || edge.arrows === 'end' || edge.arrows === 'both') edge.path.setAttribute('marker-end', `url(#${this.uid}-arrow)`);
      if (edge.arrows === 'start' || edge.arrows === 'both') edge.path.setAttribute('marker-start', `url(#${this.uid}-arrow)`);
      this.edgeGroup.append(edge.path);
    }
    for (const caption of this.annotations) {
      caption.element = el('text', { class: 'graph-annotation', 'text-anchor': 'middle', fill: caption.color || '#76b59a', 'font-family': FONT, 'font-size': caption.fontSize, 'paint-order': 'stroke', stroke: '#102023', 'stroke-width': 3, 'stroke-linejoin': 'round', opacity: 0 });
      caption.lines.forEach((line, i) => {
        const span = el('tspan', { x: 0, dy: i ? caption.lineHeight : 0 });
        span.textContent = line; caption.element.append(span);
      });
      this.annotationGroup.append(caption.element);
    }
    for (const node of this.nodes) {
      const group = el('g', { class: 'graph-node', 'data-node-id': node.id, tabindex: this.options.compact ? '-1' : '0', role: 'button', 'aria-label': node.label, opacity: '0' });
      const title = el('title'); title.textContent = node.label;
      const hit = el('circle', { r: this.options.geographic ? Math.max(6, node.r + 3) : Math.max(18, node.r + 12), fill: 'transparent' });
      const glow = el('circle', { r: node.r + 8, fill: node.effectColor || '#f7dc9f', opacity: '0', class: 'graph-node-glow' });
      const circle = el('circle', { r: node.r, fill: node.role === 'root' ? (this.options.rootColor || '#f3cf6b') : '#d9dddf', stroke: node.role === 'root' ? (this.options.rootColor || '#ffe3a0') : '#162426', 'stroke-width': this.options.geographic ? .5 : node.role === 'root' ? 2 : 1.2 });
      const text = el('text', { 'text-anchor': node.textAnchor, x: node.labelDx, y: node.labelOffset, fill: node.role === 'root' ? '#ffe3a0' : '#ecf0eb', 'font-family': FONT, 'font-size': node.fontSize, 'font-weight': node.role === 'root' || node.role === 'category' || node.role === 'hub' ? '500' : '400', 'paint-order': 'stroke', stroke: '#102023', 'stroke-width': this.options.geographic ? '.7' : '3.5', 'stroke-linejoin': 'round' });
      node.lines.forEach((line, i) => { const span = el('tspan', { x: node.labelDx, dy: i ? node.lineHeight : 0 }); span.textContent = line; text.append(span); });
      group.append(title, hit, glow, circle, text);
      group.style.cursor = this.options.compact ? 'default' : 'grab';
      if (this.options.geographic) group.style.pointerEvents = 'auto';
      node.group = group; node.glow = glow;
      this.nodeGroup.append(group);
      if (!this.options.compact) {
        this.listen(group, 'pointerdown', event => this.nodeDown(event, node));
        this.listen(group, 'dblclick', event => { event.stopPropagation(); this.focusNode(node.id); });
        this.listen(group, 'mouseenter', () => this.highlight(node));
        this.listen(group, 'mouseleave', () => this.highlight(null));
        this.listen(group, 'focus', () => this.highlight(node));
        this.listen(group, 'blur', () => this.highlight(null));
        this.listen(group, 'keydown', event => {
          const directions = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] };
          if (directions[event.key]) { event.preventDefault(); if ((this.options.lockRoot || this.options.geographic) && node === this.root) return; node.ax += directions[event.key][0]; node.ay += directions[event.key][1]; this.computeRoutes(); this.wake(); }
          if (event.key === 'Enter') this.focusNode(node.id);
        });
      }
    }
    if (this.options.geographic) {
      this.svg.style.pointerEvents = 'none';
      this.svg.style.overflow = 'visible';
      this.svg.style.touchAction = 'auto';
    }
    this.container.append(this.svg);
    if (!this.options.compact) {
      if (!this.options.geographic) {
      this.listen(this.svg, 'wheel', event => {
        event.preventDefault();
        const rect = this.svg.getBoundingClientRect();
        this.zoomBy(Math.exp(-event.deltaY * 0.0015), { x: event.clientX - rect.left, y: event.clientY - rect.top });
      }, { passive: false });
      this.listen(this.svg, 'pointerdown', event => this.touchDown(event), { capture: true });
      this.listen(this.svg, 'pointerdown', event => this.backgroundDown(event));
      }
      this.listen(this.svg, 'pointermove', event => this.pointerMove(event));
      this.listen(this.svg, 'pointerup', event => this.pointerUp(event));
      this.listen(this.svg, 'pointercancel', event => this.pointerUp(event));
      this.listen(this.svg, 'dblclick', event => { if (event.target === this.svg) this.fit(); });
      this.listen(this.svg, 'keydown', event => {
        if (event.target !== this.svg) return;
        if (event.key === '+' || event.key === '=') { event.preventDefault(); this.zoomBy(1.25); }
        if (event.key === '-') { event.preventDefault(); this.zoomBy(0.8); }
        if (event.key === '0' || event.key.toLowerCase() === 'f') { event.preventDefault(); this.fit(); }
      });
    }
  }

  listen(target, type, fn, options) {
    target.addEventListener(type, fn, options); this._listeners.push(() => target.removeEventListener(type, fn, options));
  }

  computeRoutes() {
    const boxes = this.nodes.map(n => ({ id: n.id, l: n.ax - n.textWidth / 2 - 9, r: n.ax + n.textWidth / 2 + 9, t: n.ay + n.labelOffset - n.fontSize - 3, b: n.ay + n.labelOffset + (n.lines.length - 1) * n.lineHeight + 6 }));
    for (const edge of this.edges) {
      if (!this.options.geographic && !this.options.journey) {
        // Keep a legible fan of connections: small continuous curves, never rectangular
        // tours around every intervening label. Glyph halos and focus isolate dense links.
        const a = { x: edge.a.ax, y: edge.a.ay }, b = { x: edge.b.ax, y: edge.b.ay };
        const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1;
        const side = Math.abs(dx) > 12 ? Math.sign(dx) : (Math.abs(hash(edge.id || edge.source + edge.target)) % 2 ? 1 : -1);
        const bend = -side * Math.min(24, length * .045);
        const nx = -dy / length * bend, ny = dx / length * bend;
        edge.route = [a, { x: a.x + dx * .32 + nx, y: a.y + dy * .32 + ny }, { x: a.x + dx * .68 + nx, y: a.y + dy * .68 + ny }, b];
        edge.curve = true;
      } else {
        edge.route = this.options.geographic ? [{ x: edge.a.ax, y: edge.a.ay }, { x: edge.b.ax, y: edge.b.ay }] : route(edge.a, edge.b, boxes);
        edge.curve = false;
      }
      edge.routeStart = { x: edge.a.ax, y: edge.a.ay };
      edge.routeEnd = { x: edge.b.ax, y: edge.b.ay };
      const lengths = [0];
      for (let i = 1; i < edge.route.length; i++) lengths.push(lengths.at(-1) + distance(edge.route[i - 1], edge.route[i]));
      edge.fractions = lengths.map(x => x / (lengths.at(-1) || 1));
    }
  }

  bounds() {
    if (!this.nodes.length) return { x: 0, y: 0, width: 100, height: 100 };
    const padding = this.options.geographic ? 8 : 25;
    const extents = this.nodes.map(n => {
      const x = n.ax + (n.labelDx || 0);
      const left = n.textAnchor === 'end' ? x - n.textWidth : n.textAnchor === 'start' ? x : x - n.textWidth / 2;
      return { l: Math.min(n.ax - n.r, left), r: Math.max(n.ax + n.r, left + n.textWidth), t: Math.min(n.ay - n.r, n.ay + n.labelOffset - n.fontSize), b: Math.max(n.ay + n.r, n.ay + n.labelOffset + n.textHeight) };
    });
    const minX = Math.min(...extents.map(b => b.l)) - padding;
    const maxX = Math.max(...extents.map(b => b.r)) + padding;
    const minY = Math.min(...extents.map(b => b.t)) - padding;
    const maxY = Math.max(...extents.map(b => b.b)) + padding;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  fit() {
    if (this.disposed || !this.svg) return;
    if (this.options.geographic) { this.scale = 1; this.tx = this.ty = 0; this.transform(); return; }
    const { width, height } = this.container.getBoundingClientRect();
    if (width < 1 || height < 1) return;
    const b = this.bounds();
    const margin = this.options.compact ? 8 : 32;
    this.scale = Math.min((width - margin * 2) / b.width, (height - margin * 2) / b.height);
    this.fitScale = this.scale;
    this.tx = (width - b.width * this.scale) / 2 - b.x * this.scale;
    this.ty = (height - b.height * this.scale) / 2 - b.y * this.scale;
    this.transform();
  }

  zoomBy(factor, center) {
    if (this.options.geographic) return;
    const { width, height } = this.container.getBoundingClientRect();
    center ||= { x: width / 2, y: height / 2 };
    const next = clamp(this.scale * factor, (this.fitScale || 0.2) * 0.45, Math.max(3, (this.fitScale || 1) * 8));
    const ratio = next / this.scale;
    this.tx = center.x - (center.x - this.tx) * ratio;
    this.ty = center.y - (center.y - this.ty) * ratio;
    this.scale = next;
    this.transform();
  }

  getView() {
    return { scale: this.scale, tx: this.tx, ty: this.ty, root: { x: this.root?.ax || 0, y: this.root?.ay || 0 } };
  }

  transform() {
    this.world.setAttribute('transform', `translate(${this.tx} ${this.ty}) scale(${this.scale})`);
    this.options.onViewChange?.(this.getView());
  }

  focusNode(id) {
    const n = this.lookup.get(id); if (!n) return;
    if (this.options.geographic) { this.options.onNodeFocus?.(n); return; }
    const { width, height } = this.container.getBoundingClientRect();
    this.scale = Math.max(this.scale, 1.15);
    this.tx = width / 2 - n.x * this.scale;
    this.ty = height / 2 - (n.y + n.textHeight / 2) * this.scale;
    this.transform();
  }

  point(event) {
    if (this.options.geographic) {
      const point = this.svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
      const matrix = this.world.getScreenCTM();
      if (matrix) { const p = point.matrixTransform(matrix.inverse()); return { x: p.x, y: p.y }; }
    }
    const r = this.svg.getBoundingClientRect();
    return { x: (event.clientX - r.left - this.tx) / this.scale, y: (event.clientY - r.top - this.ty) / this.scale };
  }

  touchDown(event) {
    if (event.pointerType !== 'touch') return;
    this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.touches.size !== 2) return;
    const [a, b] = [...this.touches.values()];
    const r = this.svg.getBoundingClientRect();
    const mid = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
    if (this.pointer?.node) { this.pointer.node.dragging = false; this.pointer.node.group.style.cursor = 'grab'; }
    this.pointer = { type: 'pinch', scale: this.scale, distance: distance(a, b), worldX: (mid.x - this.tx) / this.scale, worldY: (mid.y - this.ty) / this.scale };
    this.svg.setPointerCapture(event.pointerId);
    event.preventDefault(); event.stopPropagation();
  }

  nodeDown(event, node) {
    if (event.button !== 0) return;
    if ((this.options.lockRoot || this.options.geographic) && node === this.root) return;
    event.stopPropagation(); event.preventDefault();
    const p = this.point(event);
    this.pointer = { type: 'node', id: event.pointerId, node, dx: node.x - p.x, dy: node.y - p.y };
    node.dragging = true; node.group.style.cursor = 'grabbing';
    this.svg.setPointerCapture(event.pointerId); this.wake();
  }

  backgroundDown(event) {
    if (event.button !== 0 || this.pointer) return;
    this.pointer = { type: 'pan', id: event.pointerId, x: event.clientX, y: event.clientY, tx: this.tx, ty: this.ty };
    this.svg.setPointerCapture(event.pointerId); this.svg.style.cursor = 'grabbing';
  }

  pointerMove(event) {
    if (event.pointerType === 'touch' && this.touches.has(event.pointerId)) this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointer?.type === 'pinch' && this.touches.size >= 2) {
      const [a, b] = [...this.touches.values()];
      const r = this.svg.getBoundingClientRect();
      this.scale = clamp(this.pointer.scale * distance(a, b) / (this.pointer.distance || 1), (this.fitScale || .2) * .45, Math.max(3, (this.fitScale || 1) * 8));
      this.tx = (a.x + b.x) / 2 - r.left - this.pointer.worldX * this.scale;
      this.ty = (a.y + b.y) / 2 - r.top - this.pointer.worldY * this.scale;
      this.transform(); return;
    }
    if (!this.pointer || this.pointer.id !== event.pointerId) return;
    if (this.pointer.type === 'pan') {
      this.tx = this.pointer.tx + event.clientX - this.pointer.x;
      this.ty = this.pointer.ty + event.clientY - this.pointer.y; this.transform();
    } else {
      const p = this.point(event), n = this.pointer.node;
      n.x = p.x + this.pointer.dx; n.y = p.y + this.pointer.dy;
      n.ax = n.x; n.ay = n.y; n.vx = n.vy = 0;
      // Adjacent nodes receive a tiny elastic impulse rather than moving as a rigid block.
      for (const e of this.edges) {
        const neighbor = e.a === n ? e.b : e.b === n ? e.a : null;
        if (neighbor && !this.reduced) { neighbor.vx += event.movementX * 0.012 / this.scale; neighbor.vy += event.movementY * 0.012 / this.scale; }
      }
      this.wake();
    }
  }

  pointerUp(event) {
    this.touches.delete(event.pointerId);
    if (this.pointer?.type === 'pinch') {
      this.pointer = null;
      if (this.svg.hasPointerCapture(event.pointerId)) this.svg.releasePointerCapture(event.pointerId);
      return;
    }
    if (!this.pointer || event.pointerId !== this.pointer.id) return;
    if (this.pointer.type === 'node') {
      this.pointer.node.dragging = false;
      this.pointer.node.group.style.cursor = 'grab';
      this.computeRoutes(); this.wake();
    }
    this.pointer = null; this.svg.style.cursor = 'grab';
    if (this.svg.hasPointerCapture(event.pointerId)) this.svg.releasePointerCapture(event.pointerId);
  }

  highlight(node) {
    this.highlighted = node;
    const adjacent = new Set([node?.id]);
    if (node) for (const e of this.edges) { if (e.a === node) adjacent.add(e.b.id); if (e.b === node) adjacent.add(e.a.id); }
    this.nodes.forEach(n => { n.glow.setAttribute('opacity', n === node ? '.14' : '0'); n.group.style.filter = node && !adjacent.has(n.id) ? 'opacity(.32)' : ''; });
    this.edges.forEach(e => { e.path.style.filter = node && e.a !== node && e.b !== node ? 'opacity(.13)' : ''; });
    this.paint();
  }

  replay() {
    this.startTime = performance.now();
    this.nodes.forEach(n => {
      const origin = n.revealParent || this.root || n;
      n.x = this.reduced ? n.ax : origin.ax + (n.ax - origin.ax) * 0.08;
      n.y = this.reduced ? n.ay : origin.ay + (n.ay - origin.ay) * 0.08;
      n.vx = n.vy = 0;
      n.opacity = this.reduced ? 1 : 0;
      n.delay = this.reduced ? 0 : n.tier * (this.options.journey ? 110 : 155) + Math.abs(hash(n.id) % 90);
    });
    this.wake();
  }

  wake() {
    if (this.disposed || this.frame) return;
    this.lastFrame = performance.now();
    this.frame = requestAnimationFrame(time => this.tick(time));
  }

  tick(time) {
    this.frame = null;
    if (this.disposed) return;
    const dt = Math.min(2, (time - this.lastFrame) / 16.667 || 1);
    this.lastFrame = time;
    let energy = 0, pending = false;
    for (const n of this.nodes) {
      const age = time - this.startTime - n.delay;
      if (age < 0) { pending = true; continue; }
      n.opacity = this.reduced ? 1 : clamp(age / 320, 0, 1);
      if (!n.dragging) {
        if (this.reduced) { n.x = n.ax; n.y = n.ay; }
        else {
          n.vx += (n.ax - n.x) * 0.065 * dt;
          n.vy += (n.ay - n.y) * 0.065 * dt;
          n.vx *= Math.pow(0.76, dt); n.vy *= Math.pow(0.76, dt);
          n.x += n.vx * dt; n.y += n.vy * dt;
        }
      }
      energy += Math.abs(n.vx) + Math.abs(n.vy) + Math.abs(n.ax - n.x) * .01 + Math.abs(n.ay - n.y) * .01;
      if (n.opacity < 1) pending = true;
    }
    // A soft short-range repulsion gives the unfolding graph its restrained physical feel.
    if (!this.reduced && !this.options.geographic) for (let i = 0; i < this.nodes.length; i++) for (let j = i + 1; j < this.nodes.length; j++) {
      const a = this.nodes[i], b = this.nodes[j];
      if (a.opacity < .7 || b.opacity < .7) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
      const minimum = a.r + b.r + (this.options.geographic ? 2 : 28);
      if (d < minimum) {
        const push = (minimum - d) * .025;
        if (!a.dragging) { a.vx -= dx / d * push; a.vy -= dy / d * push; }
        if (!b.dragging) { b.vx += dx / d * push; b.vy += dy / d * push; }
      }
    }
    this.paint();
    if (pending || energy > .15 || this.pointer?.type === 'node') this.frame = requestAnimationFrame(t => this.tick(t));
  }

  paint() {
    for (const n of this.nodes) {
      n.group.setAttribute('transform', `translate(${n.x.toFixed(2)} ${n.y.toFixed(2)})`);
      n.group.setAttribute('opacity', n.opacity);
    }
    for (const caption of this.annotations) {
      const x = (caption.a.x + caption.b.x) / 2;
      const y = (caption.a.y + caption.b.y) / 2 - 18 - (caption.lines.length - 1) * caption.lineHeight;
      caption.element.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
      caption.element.setAttribute('opacity', Math.min(caption.a.opacity, caption.b.opacity));
    }
    for (const edge of this.edges) {
      const opacity = Math.min(edge.a.opacity, edge.b.opacity);
      const emphasized = this.highlighted && (edge.a === this.highlighted || edge.b === this.highlighted);
      edge.path.setAttribute('opacity', opacity * (emphasized ? .96 : isEffectColor(edge.color) ? .9 : this.options.geographic ? .86 : this.options.journey ? .6 : .46));
      if (opacity <= 0) continue;
      const points = edge.route.map((p, i) => {
        const t = edge.fractions[i];
        const offsetX = p.x - (edge.routeStart.x + (edge.routeEnd.x - edge.routeStart.x) * t);
        const offsetY = p.y - (edge.routeStart.y + (edge.routeEnd.y - edge.routeStart.y) * t);
        return { x: edge.a.x + (edge.b.x - edge.a.x) * t + offsetX * opacity, y: edge.a.y + (edge.b.y - edge.a.y) * t + offsetY * opacity };
      });
      if (points.length > 1) {
        const first = points[0], second = points[1], last = points.at(-1), before = points.at(-2);
        const dl = distance(first, second) || 1, dr = distance(last, before) || 1;
        points[0] = { x: first.x + (second.x - first.x) / dl * edge.a.r, y: first.y + (second.y - first.y) / dl * edge.a.r };
        const padding = edge.b.r + (this.options.journey ? 3 : 0);
        points[points.length - 1] = { x: last.x + (before.x - last.x) / dr * padding, y: last.y + (before.y - last.y) / dr * padding };
      }
      edge.path.setAttribute('d', edge.curve && points.length === 4 ? `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)} C ${points[1].x.toFixed(2)} ${points[1].y.toFixed(2)} ${points[2].x.toFixed(2)} ${points[2].y.toFixed(2)} ${points[3].x.toFixed(2)} ${points[3].y.toFixed(2)}` : roundedPath(points));
    }
  }

  destroy() {
    this.disposed = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
    this._listeners.forEach(remove => remove());
    this.svg?.remove();
  }
}

export default GraphView;
