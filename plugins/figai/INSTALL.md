# FIGAI installation and usage

## Requirements

- Figma Desktop
- Adobe Illustrator desktop with JavaScript/ExtendScript scripting support
- For rebuilding from source: Node.js and TypeScript (`tsc`)

You do **not** need a server or online converter.

## Install the Figma development plugin

Use the prebuilt `figma-plugin` folder from the release ZIP.

1. Extract `FIGAI-0.1.0.zip`.
2. Open **Figma Desktop** and any Design file.
3. Open **Plugins → Development → Import plugin from manifest…** (or search this command in Quick Actions).
4. Choose `figma-plugin/manifest.json`.
5. Run **FIGAI — Export to Illustrator** from Plugins → Development.

If your Figma build rejects the development ID in the supplied manifest, create/register a development plugin in Figma and replace the `id` value in `manifest.json` with the ID Figma gives you. The code itself does not depend on that ID.

## Export from Figma

1. Select one or more frames.
2. Run FIGAI.
3. Choose:
   - **Editable**: prioritizes live text/native shapes and reports best-effort effects
   - **Maximum fidelity**: sends gradient/effect subtrees through editable SVG fallback when needed
   - RGB or CMYK target
   - Bleed metadata (0 / 3 / 5 mm / custom)
4. Text, layer names and image assets are preserved automatically in this MVP.
5. Click **Export for Illustrator (.figai)**.
6. Save the downloaded `.figai` file.

## Import into Illustrator

1. In Illustrator choose **File → Scripts → Other Script…**.
2. Select `illustrator/FIGAI Import.jsx` from the extracted release.
3. Choose the `.figai` file exported from Figma.
4. FIGAI creates a **new Illustrator document** and imports each Figma frame as a separate artboard.
5. Review the import report for missing fonts and compatibility fallbacks.
6. Save the result normally as `.ai`.

### Optional permanent Illustrator installation

Copy `FIGAI Import.jsx` into your Illustrator application's `Presets/<language>/Scripts` folder, then restart Illustrator. The exact folder varies by OS and Illustrator version. After restart, it should appear under **File → Scripts**.

## Print workflow

- Figma source colors originate as RGB.
- Selecting **CMYK** creates the Illustrator target document in CMYK and basic solid colors are converted during import.
- This is not ICC-managed professional color conversion yet.
- Requested bleed is stored and shown in the report, but verify/set bleed manually in **File → Document Setup** before final output.
- Final preflight, spot colors, overprint, trapping and PDF/X export remain Illustrator/prepress responsibilities.

## Rebuild from source

From the project root:

```bash
npm install --ignore-scripts
npm test
npm run build
npm run package
```
