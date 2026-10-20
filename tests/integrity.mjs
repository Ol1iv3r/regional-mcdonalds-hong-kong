import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, relative, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const readJSON = async path => JSON.parse(await readFile(path, 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fingerprint = value => sha256(JSON.stringify(value));
const content = await readJSON(resolve(dist, 'assets/content.json'));
const provenance = await readJSON(resolve(dist, 'assets/provenance.json'));
const expected = await readJSON(resolve(root, 'tests/expected-graphs.json'));
let checks = 0;

function check(condition, message) {
  assert.ok(condition, message);
  checks++;
}

function checkPoint(point, name) {
  check(Number.isFinite(point?.x) && Number.isFinite(point?.y), `${name}: finite coordinates`);
  check(point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1, `${name}: inside map bounds`);
}

function checkGraph(graph, baseline, name) {
  check(graph.nodes.length === baseline.nodes, `${name}: original node count`);
  check(graph.edges.length === baseline.edges, `${name}: original edge count`);
  const ids = new Set(graph.nodes.map(node => node.id));
  const edgeIds = new Set(graph.edges.map(edge => edge.id));
  check(ids.size === graph.nodes.length, `${name}: unique node IDs`);
  check(edgeIds.size === graph.edges.length, `${name}: unique edge IDs`);
  check(fingerprint([...ids].sort()) === baseline.nodeIdsSha256, `${name}: no original nodes lost or replaced`);
  const topology = graph.edges.map(edge => [edge.id, edge.source, edge.target, edge.color, edge.kind]).sort((a, b) => a[0].localeCompare(b[0]));
  check(fingerprint(topology) === baseline.edgeTopologySha256, `${name}: original connections and their colours retained`);
  for (const node of graph.nodes) {
    check(typeof node.label === 'string' && node.label.trim().length > 0, `${name}: label for ${node.id}`);
    check(Number.isFinite(node.x) && Number.isFinite(node.y), `${name}: coordinates for ${node.id}`);
    if (node.parentId) check(ids.has(node.parentId), `${name}: parent ${node.parentId} exists`);
  }
  const adjacency = new Map([...ids].map(id => [id, new Set()]));
  for (const edge of graph.edges) {
    check(ids.has(edge.source) && ids.has(edge.target), `${name}: endpoints exist for ${edge.id}`);
    adjacency.get(edge.source).add(edge.target);
    adjacency.get(edge.target).add(edge.source);
  }
  const seen = new Set();
  const visit = id => {
    if (seen.has(id)) return;
    seen.add(id);
    adjacency.get(id).forEach(visit);
  };
  visit(graph.nodes[0].id);
  check(seen.size === ids.size, `${name}: no disconnected nodes`);
}

async function assetPath(src) {
  check(typeof src === 'string' && !/^(?:[a-z]+:|\/)/i.test(src), `Asset URL is relative: ${src}`);
  const path = resolve(dist, src);
  check(path.startsWith(dist + sep), `Asset stays inside dist: ${src}`);
  check((await stat(path)).isFile(), `Asset exists: ${src}`);
  return path;
}

async function checkOriginalAsset(asset) {
  const path = await assetPath(asset.src);
  const bytes = await readFile(path);
  check(bytes.length === asset.originalBytes, `${asset.src}: original byte length`);
  check(sha256(bytes) === asset.sha256, `${asset.src}: byte-for-byte original PDF image stream`);
  check(bytes[0] === 0xff && bytes[1] === 0xd8, `${asset.src}: JPEG signature`);
}

check(content.restaurants.length === 5, 'Exactly five restaurant systems');
check(new Set(content.restaurants.map(r => r.id)).size === 5, 'Unique restaurant system IDs');
check(content.markers.length === 269, 'All 269 source branch locations');
check(new Set(content.markers.map(m => m.id)).size === content.markers.length, 'Unique branch location IDs');
check(content.map.width === 7923 && content.map.height === 5596, 'Full source map pixel dimensions');
await checkOriginalAsset(content.map);

for (const marker of content.markers) {
  checkPoint(marker, `Branch ${marker.id}`);
  check(Number.isFinite(marker.lat) && Number.isFinite(marker.lng), `Branch ${marker.id}: geographic coordinates`);
}

for (const restaurant of content.restaurants) {
  check(Boolean(expected.restaurants[restaurant.id]), `Recognized restaurant: ${restaurant.id}`);
  checkGraph(restaurant, expected.restaurants[restaurant.id], restaurant.name);
  checkPoint(restaurant.anchor, restaurant.name);
  if (restaurant.secondaryAnchor) checkPoint(restaurant.secondaryAnchor, `${restaurant.name} secondary anchor`);
  check(restaurant.photos.length > 0, `${restaurant.name}: clickable photograph available`);
  for (const photo of restaurant.photos) await checkOriginalAsset(photo);
  const marker = content.markers.find(m => m.storeNo === restaurant.anchor.storeNo);
  check(Boolean(marker), `${restaurant.name}: anchor matches source branch`);
  check(Math.abs(marker.x - restaurant.anchor.x) < 1e-10 && Math.abs(marker.y - restaurant.anchor.y) < 1e-10, `${restaurant.name}: map anchor uses exact branch coordinate`);
}

checkGraph(content.journey, expected.journey, 'Customer journey');
for (const asset of Object.values(provenance.media)) await checkOriginalAsset(asset);

const html = await readFile(resolve(dist, 'index.html'), 'utf8');
const htmlIds = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
check(new Set(htmlIds).size === htmlIds.length, 'No duplicate HTML IDs');
for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  if (!/^(https?:|#)/.test(match[1])) await assetPath(match[1]);
}
const app = await readFile(resolve(dist, 'app.js'), 'utf8');
for (const match of app.matchAll(/\$\('([^']+)'\)/g)) {
  check(htmlIds.includes(match[1]), `App DOM target exists: ${match[1]}`);
}

async function filesUnder(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else files.push(path);
  }
  return files;
}

let totalBytes = 0;
for (const path of await filesUnder(dist)) {
  const name = relative(dist, path);
  const size = (await stat(path)).size;
  totalBytes += size;
  check(!/\.(?:pdf|ai|psd|zip)$/i.test(name), `No private or bulky source document in published files: ${name}`);
  check(!/(?:^|\/)(?:\.env|\.git|\.openai)(?:\/|$)/.test(name), `No credentials/config directory in published files: ${name}`);
  check(size < 50 * 1024 * 1024, `Asset below GitHub's large-file warning threshold: ${name}`);
  if (/\.(?:html|css|js|json|svg|txt)$/i.test(extname(path))) {
    const text = await readFile(path, 'utf8');
    check(!/\/(?:Users|private|var\/folders)\//.test(text), `No private absolute file paths in ${name}`);
    check(!/\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16})\b/.test(text), `No recognizable access-token patterns in ${name}`);
    if (extname(path) === '.js') {
      const result = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: text, encoding: 'utf8' });
      check(result.status === 0, `${name}: JavaScript parses\n${result.stderr}`);
    }
  }
}
console.log(`PASS — ${checks} checks; 5 restaurant graphs (210 nodes, 278 connections), 17-node/25-connection journey, 269 map locations.`);
console.log(`Original 7923 × 5596 map JPEG and all photos retain their PDF image-stream bytes. Published payload ${(totalBytes / 1024 / 1024).toFixed(2)} MiB.`);
