# FIGAI 0.1 compatibility matrix

| Figma content | Illustrator result | MVP status |
|---|---|---|
| Multiple selected frames | Separate artboards | Native |
| Frame/layer names | Artboard/layer/group names | Native |
| Rectangles | PathItem rectangle | Native |
| Rounded rectangles | Rounded rectangle | Native |
| Ellipses | PathItem ellipse | Native |
| Solid fills/strokes | Illustrator RGB/CMYK colors | Native/basic |
| Arbitrary vector paths | Imported SVG group | SVG fallback, editable |
| Boolean/vector marks | Imported SVG group | SVG fallback, editable |
| Plain text | Live Illustrator text | Native/best effort |
| Mixed text styles | Per-character attributes | Native/best effort |
| Missing fonts | Live text with fallback + warning | Best effort |
| Variable-font axes | Metadata not fully mapped | Unsupported in V0.1 |
| Raster image fills | Embedded image | Native/basic |
| Image crop | Clipping group | Best effort |
| Masks | SVG group | SVG fallback |
| Opacity | Illustrator opacity | Native/basic |
| Rotation | Illustrator transform | Native/basic |
| Linear/radial gradients | Editable mode preserves metadata with warning; Maximum Fidelity imports affected subtree as SVG | Best effort / SVG fallback |
| Drop/inner shadows | Editable mode warns; Maximum Fidelity imports affected subtree as SVG | Best effort / SVG fallback |
| Layer/background blur | Editable mode warns; Maximum Fidelity imports affected subtree as SVG when exposed on the node | Best effort / SVG fallback |
| Auto Layout | Final resolved geometry only | Expected behavior |
| Components/instances | Resolved visual structure | Expected behavior |
| RGB target | RGB Illustrator document | Native |
| CMYK target | CMYK document + basic RGB→CMYK conversion | Basic conversion |
| Bleed | Stored/reported; verify manually in Illustrator | Metadata only |
| Pantone/spot colors | Not mapped | Not supported |
| PDF/X preflight | Not performed | Not supported |
