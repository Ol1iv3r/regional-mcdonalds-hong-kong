// Annotation positions are screen-space display positions only. The geographic
// anchors stay unchanged, so displaced pins can retain a short location leader.
const PIN_RADIUS = 25;
const PIN_DISTANCE = 52;
const CARD_GAP = 12;
const EDGE = 12;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const distance2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const intersects = (a, b, gap = 0) => a.x < b.x + b.width + gap &&
  a.x + a.width + gap > b.x && a.y < b.y + b.height + gap &&
  a.y + a.height + gap > b.y;
const circleIntersects = (point, rect, radius) => {
  const x = clamp(point.x, rect.x, rect.x + rect.width);
  const y = clamp(point.y, rect.y, rect.y + rect.height);
  return (point.x - x) ** 2 + (point.y - y) ** 2 < radius ** 2;
};
const within = (point, width, height, padding = 0) =>
  point.x >= -padding && point.y >= -padding &&
  point.x <= width + padding && point.y <= height + padding;

function clusterTargets(pins) {
  const targets = new Map();
  const visited = new Set();
  for (const first of pins) {
    if (visited.has(first.id)) continue;
    const cluster = [first];
    visited.add(first.id);
    for (let i = 0; i < cluster.length; i++) {
      for (const pin of pins) {
        if (!visited.has(pin.id) && distance2(cluster[i], pin) < PIN_DISTANCE ** 2) {
          visited.add(pin.id);
          cluster.push(pin);
        }
      }
    }
    if (cluster.length === 1) {
      targets.set(first.id, { x: first.x, y: first.y });
    } else if (cluster.length === 2) {
      const [a, b] = cluster;
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      const angle = distance2(a, b) > .01 ? Math.atan2(b.y - a.y, b.x - a.x) : 0;
      const dx = Math.cos(angle) * PIN_DISTANCE / 2;
      const dy = Math.sin(angle) * PIN_DISTANCE / 2;
      targets.set(a.id, { x: cx - dx, y: cy - dy });
      targets.set(b.id, { x: cx + dx, y: cy + dy });
    } else {
      const cx = cluster.reduce((sum, p) => sum + p.x, 0) / cluster.length;
      const cy = cluster.reduce((sum, p) => sum + p.y, 0) / cluster.length;
      const radius = PIN_DISTANCE / (2 * Math.sin(Math.PI / cluster.length));
      cluster.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
      const start = Math.atan2(cluster[0].y - cy, cluster[0].x - cx);
      cluster.forEach((pin, i) => targets.set(pin.id, {
        x: cx + Math.cos(start + i * Math.PI * 2 / cluster.length) * radius,
        y: cy + Math.sin(start + i * Math.PI * 2 / cluster.length) * radius
      }));
    }
  }
  return targets;
}

function placePins(pins, width, height, obstacles) {
  const visible = pins.filter(pin => within(pin, width, height, 24));
  const targets = clusterTargets(visible);
  const placed = [];
  for (const pin of visible) {
    const target = targets.get(pin.id);
    const candidates = [target, { x: pin.x, y: pin.y }];
    // Prefer tiny symmetric displacements; broader rings only serve pins under
    // a fixed UI control or very near the viewport edge.
    for (const radius of [16, 28, 40, 56, 80, 112, 160, 224, 320, 448]) {
      for (let angle = 0; angle < 16; angle++) {
        const radians = angle * Math.PI / 8;
        candidates.push({
          x: target.x + Math.cos(radians) * radius,
          y: target.y + Math.sin(radians) * radius
        });
      }
    }
    let best, bestScore = Infinity;
    for (const candidate of candidates) {
      const point = {
        x: clamp(candidate.x, PIN_RADIUS + EDGE, width - PIN_RADIUS - EDGE),
        y: clamp(candidate.y, PIN_RADIUS + EDGE, height - PIN_RADIUS - EDGE)
      };
      if (obstacles.some(rect => circleIntersects(point, rect, PIN_RADIUS + 5))) continue;
      if (placed.some(other => distance2(point, other) < PIN_DISTANCE ** 2 - .01)) continue;
      const score = distance2(point, target) + distance2(point, pin) * .2;
      if (score < bestScore) { best = point; bestScore = score; }
    }
    if (best) placed.push({ ...pin, ...best, anchorX: pin.x, anchorY: pin.y, visible: true });
  }
  const byId = new Map(placed.map(pin => [pin.id, pin]));
  return pins.map(pin => byId.get(pin.id) || {
    ...pin, anchorX: pin.x, anchorY: pin.y, visible: false
  });
}

function nearestPoint(rect, point) {
  return {
    x: clamp(point.x, rect.x, rect.x + rect.width),
    y: clamp(point.y, rect.y, rect.y + rect.height)
  };
}

function lineCrossesRect(start, end, rect) {
  // Liang–Barsky clipping; used only as a layout preference for photo leaders.
  let lo = 0, hi = 1;
  const dx = end.x - start.x, dy = end.y - start.y;
  const tests = [[-dx, start.x - rect.x], [dx, rect.x + rect.width - start.x],
    [-dy, start.y - rect.y], [dy, rect.y + rect.height - start.y]];
  for (const [p, q] of tests) {
    if (Math.abs(p) < 1e-9) { if (q < 0) return false; }
    else {
      const t = q / p;
      if (p < 0) lo = Math.max(lo, t);
      else hi = Math.min(hi, t);
      if (lo > hi) return false;
    }
  }
  return hi > 0 && lo < 1;
}

function cardCandidates(card, width, height, obstacles, pins) {
  const anchor = { x: card.anchorX, y: card.anchorY };
  const preferred = {
    x: anchor.x + (card.preferred?.x ?? 35),
    y: anchor.y + (card.preferred?.y ?? -90)
  };
  const raw = [preferred];
  // These slots follow the anchor while panning. They give each card a stable
  // side of its restaurant rather than attaching it to an arbitrary UI grid.
  for (const gap of [38, 58, 90, 140, 210]) {
    for (const align of [0, .5, 1]) {
      raw.push({ x: anchor.x + gap, y: anchor.y - card.height * align });
      raw.push({ x: anchor.x - gap - card.width, y: anchor.y - card.height * align });
      raw.push({ x: anchor.x - card.width * align, y: anchor.y - gap - card.height });
      raw.push({ x: anchor.x - card.width * align, y: anchor.y + gap });
    }
  }
  // Edge slots handle small screens where a preferred side no longer fits.
  for (const y of [EDGE, height / 4, height / 2, height * .75, height - EDGE - card.height]) {
    for (const x of [EDGE, width / 2 - card.width / 2, width - EDGE - card.width]) raw.push({ x, y });
  }
  const seen = new Set(), result = [];
  for (const point of raw) {
    const rect = {
      id: card.id, width: card.width, height: card.height,
      x: clamp(point.x, EDGE, width - EDGE - card.width),
      y: clamp(point.y, EDGE, height - EDGE - card.height),
      visible: true
    };
    const key = `${Math.round(rect.x)},${Math.round(rect.y)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (rect.width + EDGE * 2 > width || rect.height + EDGE * 2 > height) continue;
    if (obstacles.some(other => intersects(rect, other, CARD_GAP))) continue;
    if (pins.some(pin => pin.visible && circleIntersects(pin, rect, PIN_RADIUS + 9))) continue;
    const end = nearestPoint(rect, anchor);
    const leader = Math.sqrt(distance2(anchor, end));
    // Strong preferred-side bias, plus short leaders and a modest edge margin.
    const score = distance2(rect, preferred) * .85 + leader ** 2 * .3;
    result.push({ rect, anchor, end, score });
  }
  return result.sort((a, b) => a.score - b.score).slice(0, 48);
}

/**
 * Return collision-free display positions without modifying source geography.
 *
 * pins: {id, restaurantId, index, x, y} at true map screen coordinates.
 * cards: {id, anchorX, anchorY, width, height, preferred:{x,y}}; preferred
 *        is an offset from the true anchor, not from its displaced number.
 * obstacles: screen-space rects occupied by fixed interface elements.
 */
export function layoutAnnotations({ width, height, pins = [], cards = [], obstacles = [] }) {
  const fixed = obstacles.filter(rect => rect.width > 0 && rect.height > 0);
  const placedPins = placePins(pins, width, height, fixed);
  const jobs = cards.map((card, index) => ({
    card, index,
    candidates: within({ x: card.anchorX, y: card.anchorY }, width, height, 24)
      ? cardCandidates(card, width, height, fixed, placedPins)
      : []
  }));
  // Place constrained cards first, then retain a small set of alternatives.
  // With five restaurants this prevents a greedy early choice from hiding a
  // later card, while keeping per-frame work bounded.
  const ordered = jobs.filter(job => job.candidates.length)
    .sort((a, b) => a.candidates.length - b.candidates.length || a.index - b.index);
  let states = [{ placements: [], score: 0, shown: 0 }];
  for (const job of ordered) {
    const next = [];
    for (const state of states) {
      for (const candidate of job.candidates) {
        if (state.placements.some(other => intersects(candidate.rect, other.rect, CARD_GAP))) continue;
        let score = state.score + candidate.score;
        for (const other of state.placements) {
          if (lineCrossesRect(candidate.anchor, candidate.end, other.rect)) score += 12000;
          if (lineCrossesRect(other.anchor, other.end, candidate.rect)) score += 12000;
        }
        next.push({
          placements: [...state.placements, candidate],
          score, shown: state.shown + 1
        });
      }
      // Last resort for impossibly crowded / tiny viewports; never overlap.
      next.push({ placements: state.placements, score: state.score + 1e8, shown: state.shown });
    }
    states = next.sort((a, b) => b.shown - a.shown || a.score - b.score).slice(0, 16);
  }
  const selected = new Map(states[0].placements.map(item => [item.rect.id, item.rect]));
  return {
    pins: placedPins,
    cards: cards.map(card => selected.get(card.id) || {
      id: card.id, x: card.anchorX, y: card.anchorY,
      width: card.width, height: card.height, visible: false
    })
  };
}
