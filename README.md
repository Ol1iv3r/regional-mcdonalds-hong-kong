# Regional McDonald’s — Hong Kong

An interactive adaptation of the supplied **A1-with-current-canvas.pdf** poster. It connects Hong Kong’s McDonald’s distribution with five restaurant systems: Hung Hom, Hung Hom Bay, HKUST LG5, Hong Kong Airport, and Cheung Chau.

## Run locally

No build step or package installation is required. From this directory:

```sh
python3 -m http.server 8780 --directory dist
```

Open [http://localhost:8780](http://localhost:8780). Serve the files over HTTP; opening `index.html` directly will not load the JSON data reliably.

## Explore

- The opening screen introduces the research and the complete customer journey.
- Select **Explore the map** to pan around Hong Kong. Scroll or pinch to zoom; the reset control restores the full map.
- Click a red location point or restaurant photograph to unfold its complete graph in a translucent window over the map.
- Graphs unfold in stages with damped motion. Drag nodes, drag the graph background to pan, and scroll or pinch to zoom. The lower controls provide replay, fit, and zoom. Closing the window restores the same map position.
- The research prompt, title/reading key, and customer-journey dock each open a larger panel. Use the close button or Escape to return.
- Keyboard support includes map arrow-key panning, `+`/`−` zooming and `0` reset. Graph nodes support arrow-key movement and Enter to focus.
- Reduced-motion preferences disable decorative movement and spring animation.

## Content and image fidelity

The satellite map is the original **7,923 × 5,596 pixel JPEG image stream extracted from the supplied PDF**. Its bytes are retained, with no resampling or additional JPEG compression. Restaurant photographs are also original PDF image streams. Zooming beyond source resolution cannot create additional detail, but the website does not discard the source pixels.

The five systems retain all **210 nodes and 278 connections**. The customer journey retains **17 nodes and 25 connections**, including the taste and space captions. Foreground text was extracted from the current PDF instead of older hidden text inside Illustrator’s PDF resources. Restaurant graphs are arranged for interactive reading; source node IDs, relationships, colours, and current statements are preserved.

The map contains the **269 branch locations** from the source map’s 19 October 2026 snapshot. It is a research artifact, not a live restaurant directory. `[OBS]` follows the poster’s use as a descriptive-statement code; it does not mean that every statement was independently verified. The complete evidence legend is available from the title/reading-key panel.

Image hashes and extraction provenance are recorded in `dist/assets/provenance.json`. The full editable poster and its private Illustrator resources are intentionally not part of the public website.

Map information © Lands Department, HKSAR Government. Image ©2002/2016/2024 NASA/USGS. The supplied map is a mosaic of imagery captured on different dates.

## Verify

Requires Node.js 20 or later:

```sh
node tests/integrity.mjs
```

This verifies original graph IDs and relationship fingerprints, connected graphs, valid endpoints, normalized map coordinates, exact image hashes, local asset references, JavaScript syntax, and the absence of private source documents or recognizable credential patterns in `dist/`. Browser interaction and visual checks remain a separate review.

## Publish with GitHub Pages

The deployable website is the contents of `dist/`. The repository’s Pages workflow publishes that directory; no server-side runtime is required. In GitHub repository settings, select **Pages → Build and deployment → GitHub Actions**, then push the site to the default branch.

Keep `assets/` paths relative so the site works under a GitHub project URL. Publishing the `dist/` directory to another static host also works.

## Files

- `dist/index.html`, `style.css`, `app.js`: introduction, map, controls and panels.
- `dist/graph-view.js`: SVG graph layout, interaction, routing and motion.
- `dist/assets/content.json`: restaurant systems, customer journey, map coordinates and poster text.
- `dist/assets/provenance.json`: original image hashes and extraction audit.
- `tests/`: content integrity and source-topology checks.
