import assert from 'node:assert/strict';
import { minimumScale, constrainView } from '../dist/map-viewport.js';

const worldWidth = 1800, worldHeight = 1800 * 5596 / 7923;
let checks = 0;
function covered(view, viewport) {
  assert.ok(view.x <= 0 && view.y <= 0, 'Top/left are covered');
  assert.ok(view.x + worldWidth * view.scale >= viewport.width, 'Right edge is covered');
  assert.ok(view.y + worldHeight * view.scale >= viewport.height, 'Bottom edge is covered');
  checks += 3;
}
for (const [width,height] of [[1919,1140],[1280,850],[844,390],[768,1024],[390,844],[320,568]]) {
  const viewport = { width,height,worldWidth,worldHeight };
  const min = minimumScale(width,height,worldWidth,worldHeight);
  for (const scale of [min*.1,min*.7,min,min*2,min*15]) {
    for (const x of [-50000,-width,-1,0,width,50000]) {
      for (const y of [-50000,-height,-1,0,height,50000]) {
        const view = constrainView({x,y,scale},viewport);
        covered(view,viewport);
        assert.deepEqual(constrainView(view,viewport),view,'Clamping is stable');
      }
    }
  }
  // A spring may overshoot both translation and scale while zooming out at an edge.
  let current = {x:-3000,y:-2000,scale:min*5}, velocity = {x:0,y:0,scale:0};
  const target = constrainView({x:500,y:500,scale:min*.4},viewport);
  for (let frame=0;frame<180;frame++) {
    for (const axis of ['x','y','scale']) {
      velocity[axis] = (velocity[axis] + (target[axis]-current[axis])*.12)*.69;
      current[axis] += velocity[axis];
    }
    current = constrainView(current,viewport);
    covered(current,viewport);
  }
}
console.log(`PASS — ${checks} viewport coverage assertions, including spring frames and portrait sizes.`);
