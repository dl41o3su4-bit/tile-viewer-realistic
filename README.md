# 磁磚高擬真室內模擬器 (tile-viewer-realistic)

Live: https://dl41o3su4-bit.github.io/tile-viewer-realistic/

- `index.html` + `app.js` (Three.js r169 bundled locally with esbuild, no CDN). Source: `main.src.js`.
- `assets/*.b64`: base64-encoded binary assets (GLB with meshopt + WebP textures, HDR). Decoded in the browser.
- Furniture models and HDRI (lebombo) from Poly Haven, CC0. Tiles (marble/quartz/cement/wood) are baked procedurally per tile with grout depth, 4 face variants.
- URL params: `?room=living|bath|garage`, `?q=high|mobile`.
