import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { layoutAnnotations } from '../dist/map-annotations.js';

const content = JSON.parse(await readFile(new URL('../dist/assets/content.json', import.meta.url), 'utf8'));
const worldWidth = 1800;
const worldHeight = worldWidth * content.map.height / content.map.width;
const offsets = [
  { x: -170, y: 72 }, { x: -170, y: -135 }, { x: 55, y: -105 },
  { x: -75, y: -123 }, { x: -151, y: -70 }
];
const rectOverlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x &&
  a.y < b.y + b.height && a.y + a.height > b.y;
const circleOverlaps = (pin, rect, r) => {
  const x = Math.max(rect.x, Math.min(rect.x + rect.width, pin.x));
  const y = Math.max(rect.y, Math.min(rect.y + rect.height, pin.y));
  return Math.hypot(pin.x - x, pin.y - y) < r - .01;
};

function scenario(width, height, zoom = 1, panX = .5, panY = .5) {
  const scale = Math.max(width / worldWidth, height / worldHeight) * zoom;
  const cameraX = (width - worldWidth * scale) * panX;
  const cameraY = (height - worldHeight * scale) * panY;
  const project = anchor => ({ x: anchor.x * worldWidth * scale + cameraX, y: anchor.y * worldHeight * scale + cameraY });
  const pins = [], cards = [];
  const mobile = width < 900;
  content.restaurants.forEach((restaurant, index) => {
    const point = project(restaurant.anchor);
    pins.push({ id: restaurant.id, restaurantId: restaurant.id, index, ...point });
    if (restaurant.secondaryAnchor) pins.push({
      id: `${restaurant.id}-secondary`, restaurantId: restaurant.id, index,
      ...project(restaurant.secondaryAnchor)
    });
    cards.push({
      id: restaurant.id, anchorX: point.x, anchorY: point.y,
      width: mobile ? 98 : 132, height: mobile ? 92 : 118,
      preferred: offsets[index]
    });
  });
  const obstacles = width < 600 ? [
    { x: 18, y: 18, width: 170, height: 90 },
    { x: width - 160, y: 20, width: 142, height: 58 },
    { x: width - 233, y: height - 158, width: 215, height: 106 },
    { x: 18, y: height - 64, width: 126, height: 46 }
  ] : [
    { x: 30, y: 30, width: mobile ? 230 : 300, height: 138 },
    { x: width - 270, y: 30, width: 240, height: 66 },
    { x: width - (mobile ? 295 : 350), y: height - 156, width: mobile ? 265 : 320, height: 132 },
    { x: 30, y: height - 78, width: 146, height: 54 }
  ];
  return { width, height, pins, cards, obstacles };
}

function verify(input, output) {
  const pins = output.pins.filter(pin => pin.visible);
  const cards = output.cards.filter(card => card.visible);
  for (const pin of pins) {
    const original = input.pins.find(item => item.id === pin.id);
    assert.equal(pin.anchorX, original.x, 'True longitude anchor must not move.');
    assert.equal(pin.anchorY, original.y, 'True latitude anchor must not move.');
    assert(pin.x >= 25 && pin.x <= input.width - 25);
    assert(pin.y >= 25 && pin.y <= input.height - 25);
    for (const obstacle of input.obstacles) assert(!circleOverlaps(pin, obstacle, 25), `Pin ${pin.id} overlaps UI.`);
  }
  for (let i = 0; i < pins.length; i++) {
    for (let j = i + 1; j < pins.length; j++) {
      assert(Math.hypot(pins[i].x - pins[j].x, pins[i].y - pins[j].y) >= 51.99, 'Pulse rings must be separate.');
    }
  }
  for (const card of cards) {
    assert(card.x >= 12 && card.y >= 12);
    assert(card.x + card.width <= input.width - 12 + .01);
    assert(card.y + card.height <= input.height - 12 + .01);
    for (const obstacle of input.obstacles) assert(!rectOverlaps(card, obstacle), `${card.id} overlaps fixed UI.`);
    for (const pin of pins) assert(!circleOverlaps(pin, card, 34), `${card.id} obscures number ${pin.id}.`);
  }
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      assert(!rectOverlaps(cards[i], cards[j]), `Cards ${cards[i].id} and ${cards[j].id} overlap.`);
    }
  }
}

const viewports = [[1280, 850], [1919, 1140], [768, 1024], [390, 844]];
let cases = 0, maxMs = 0, totalMs = 0;
for (const [width, height] of viewports) {
  for (const zoom of [1, 1.2, 1.8, 3, 8]) {
    for (const panX of [0, .3, .5, .7, 1]) {
      for (const panY of [0, .5, 1]) {
        const input = scenario(width, height, zoom, panX, panY);
        const before = JSON.stringify(input);
        const start = performance.now();
        const output = layoutAnnotations(input);
        const elapsed = performance.now() - start;
        maxMs = Math.max(maxMs, elapsed); totalMs += elapsed;
        verify(input, output);
        assert.equal(JSON.stringify(input), before, 'Layout must not mutate data.');
        assert.deepEqual(layoutAnnotations(input), output, 'Same camera must produce deterministic positions.');
        if (zoom === 1 && panX === .5 && panY === .5) {
          const visibleAnchors = input.cards.filter(card => card.anchorX >= -24 && card.anchorX <= width + 24 &&
            card.anchorY >= -24 && card.anchorY <= height + 24).length;
          assert.equal(output.cards.filter(card => card.visible).length, visibleAnchors, 'Initial view must show every in-view restaurant photo.');
        }
        cases++;
      }
    }
  }
}
console.log(`PASS ${cases} viewport / zoom / pan cases; mean ${(totalMs / cases).toFixed(2)} ms; max ${maxMs.toFixed(2)} ms.`);
