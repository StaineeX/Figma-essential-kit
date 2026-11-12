// FIGAI bundled plugin v0.1.0
(function(){
var __modules={
"assets.js":function(module,exports,require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAssetCollector = createAssetCollector;
function bytesToBase64(bytes) {
    const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
        const a = bytes[i] || 0, b = bytes[i + 1] || 0, c = bytes[i + 2] || 0;
        const n = (a << 16) | (b << 8) | c;
        out += table[(n >> 18) & 63] + table[(n >> 12) & 63] + (i + 1 < bytes.length ? table[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? table[n & 63] : '=');
    }
    return out;
}
function detectMime(bytes) {
    if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
        return 'image/png';
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
        return 'image/jpeg';
    if (bytes.length >= 6) {
        const head = String.fromCharCode(...Array.from(bytes.slice(0, 6)));
        if (head === 'GIF87a' || head === 'GIF89a')
            return 'image/gif';
    }
    return 'application/octet-stream';
}
function createAssetCollector(getBytes) {
    const assets = [];
    const byHash = {};
    return {
        assets,
        async collect(hash) {
            if (byHash[hash])
                return byHash[hash];
            const bytes = await getBytes(hash);
            const id = 'img-' + String(assets.length + 1).padStart(4, '0');
            assets.push({ id, mimeType: detectMime(bytes), base64: bytesToBase64(bytes), sourceHash: hash });
            byHash[hash] = id;
            return id;
        }
    };
}

},
"exporter.js":function(module,exports,require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportFrameSkeletons = exportFrameSkeletons;
exports.exportSelection = exportSelection;
const common_1 = require("./serializers/common");
async function exportFrameSkeletons(frames, options) {
    return {
        format: 'FIGAI', version: '0.1.0',
        generator: { name: 'FIGAI Figma Plugin', version: '0.1.0' },
        document: { name: 'FIGAI Export', colorMode: options.colorMode, bleedMm: options.bleedMm, unit: 'pt' },
        artboards: frames.map(frame => ({ id: frame.id, name: frame.name, widthPx: Number(frame.width || 0), heightPx: Number(frame.height || 0), children: [] })),
        assets: { images: [] }, warnings: []
    };
}
async function exportSelection(frames, options, deps) {
    const pkg = await exportFrameSkeletons(frames, options);
    const warnings = [];
    const ctx = { warnings, mode: options.mode, collectImageAsset: (hash) => deps.collectImageAsset(hash, ctx) };
    for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        const children = [];
        for (const child of (Array.isArray(frame.children) ? frame.children : [])) {
            const serialized = await (0, common_1.serializeSceneNode)(child, ctx);
            if (serialized)
                children.push(serialized);
        }
        pkg.artboards[i].children = children;
    }
    pkg.assets.images = deps.assets;
    pkg.warnings = warnings;
    return pkg;
}

},
"fallback-svg.js":function(module,exports,require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportSvgFallback = exportSvgFallback;
function decodeUtf8(bytes) {
    if (typeof TextDecoder !== 'undefined')
        return new TextDecoder('utf-8').decode(bytes);
    let s = '';
    for (let i = 0; i < bytes.length; i++)
        s += String.fromCharCode(bytes[i]);
    return s;
}
async function exportSvgFallback(node, ctx, reason) {
    var _a;
    let svg = '';
    if (typeof node.exportAsync === 'function') {
        try {
            const value = await node.exportAsync({ format: 'SVG_STRING' });
            svg = typeof value === 'string' ? value : decodeUtf8(value);
        }
        catch (_e) {
            try {
                const value = await node.exportAsync({ format: 'SVG' });
                svg = typeof value === 'string' ? value : decodeUtf8(value);
            }
            catch (_e2) {
                svg = '';
            }
        }
    }
    ctx.warnings.push({ code: 'SVG_FALLBACK', message: reason, nodeId: String(node.id), nodeName: String(node.name || node.type) });
    return { id: String(node.id), type: 'FALLBACK_SVG', name: String(node.name || node.type), visible: node.visible !== false, opacity: (_a = node.opacity) !== null && _a !== void 0 ? _a : 1, x: node.x || 0, y: node.y || 0, width: node.width || 0, height: node.height || 0, rotation: node.rotation || 0, matrix: node.relativeTransform || [[1, 0, node.x || 0], [0, 1, node.y || 0]], svg, reason };
}

},
"main.js":function(module,exports,require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const selection_1 = require("./selection");
const exporter_1 = require("./exporter");
const assets_1 = require("./assets");
figma.showUI(__html__, { width: 360, height: 520, themeColors: true });
function postSelectionCount() {
    const count = (figma.currentPage.selection || []).filter((n) => n.type === 'FRAME').length;
    figma.ui.postMessage({ type: 'SELECTION_COUNT', count });
}
postSelectionCount();
figma.on('selectionchange', postSelectionCount);
figma.ui.onmessage = async (msg) => {
    if (!msg || msg.type !== 'EXPORT')
        return;
    try {
        const frames = (0, selection_1.getSelectedExportRoots)(figma.currentPage.selection);
        const collector = (0, assets_1.createAssetCollector)(async (hash) => {
            const image = figma.getImageByHash(hash);
            if (!image)
                throw new Error('Image not found: ' + hash);
            return await image.getBytesAsync();
        });
        const options = {
            colorMode: msg.options.colorMode === 'CMYK' ? 'CMYK' : 'RGB',
            bleedMm: Math.max(0, Number(msg.options.bleedMm) || 0),
            mode: msg.options.mode === 'MAX_FIDELITY' ? 'MAX_FIDELITY' : 'EDITABLE',
            preserveText: msg.options.preserveText !== false,
            preserveLayerNames: msg.options.preserveLayerNames !== false,
            embedImages: msg.options.embedImages !== false
        };
        const pkg = await (0, exporter_1.exportSelection)(frames, options, { assets: collector.assets, collectImageAsset: (hash) => collector.collect(hash) });
        pkg.document.name = figma.root && figma.root.name ? figma.root.name : 'FIGAI Export';
        const safe = (pkg.document.name || 'figai-export').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'figai-export';
        figma.ui.postMessage({ type: 'EXPORT_READY', filename: safe + '.figai', data: JSON.stringify(pkg) });
        figma.notify('FIGAI export ready — ' + pkg.artboards.length + ' artboard(s).');
    }
    catch (error) {
        const message = error && error.message ? error.message : String(error);
        figma.ui.postMessage({ type: 'EXPORT_ERROR', message });
        figma.notify('FIGAI: ' + message, { error: true });
    }
};

},
"selection.js":function(module,exports,require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSelectedExportRoots = getSelectedExportRoots;
function getSelectedExportRoots(selection) {
    if (!selection.length)
        throw new Error('Select at least one frame.');
    if (selection.some(node => node.type !== 'FRAME'))
        throw new Error('Only top-level frames can be exported in FIGAI MVP.');
    return selection.slice();
}

},
"serializers/common.js":function(module,exports,require){
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.serializeSceneNode = serializeSceneNode;
const geometry_1 = require("./geometry");
async function serializeSceneNode(node, ctx) {
    if (!node || node.visible === false)
        return null;
    if (node.type === 'TEXT') {
        const mod = await Promise.resolve().then(() => __importStar(require('./text')));
        return mod.serializeTextNode(node, ctx);
    }
    const imagePaint = Array.isArray(node.fills) ? node.fills.find((p) => p && p.type === 'IMAGE') : null;
    if (imagePaint && ctx.collectImageAsset) {
        const mod = await Promise.resolve().then(() => __importStar(require('./image')));
        return mod.serializeImageNode(node, imagePaint, ctx);
    }
    const vectorLike = ['VECTOR', 'LINE', 'POLYGON', 'STAR', 'BOOLEAN_OPERATION'].includes(node.type);
    const hasMask = Array.isArray(node.children) && node.children.some((child) => child && child.isMask === true);
    if (vectorLike || hasMask) {
        const mod = await Promise.resolve().then(() => __importStar(require('../fallback-svg')));
        return mod.exportSvgFallback(node, ctx, vectorLike ? 'Vector geometry exported through SVG for Illustrator editability' : 'Mask group exported through SVG for visual fidelity');
    }
    const supported = ['GROUP', 'FRAME', 'RECTANGLE', 'ELLIPSE'].includes(node.type);
    if (!supported) {
        const mod = await Promise.resolve().then(() => __importStar(require('../fallback-svg')));
        return mod.exportSvgFallback(node, ctx, 'Unsupported node type: ' + node.type);
    }
    const paints = [...(Array.isArray(node.fills) ? node.fills : []), ...(Array.isArray(node.strokes) ? node.strokes : [])];
    const hasEffects = Array.isArray(node.effects) && node.effects.length > 0;
    const hasGradient = paints.some((p) => p && typeof p.type === 'string' && p.type.indexOf('GRADIENT_') === 0);
    if (ctx.mode === 'MAX_FIDELITY' && (hasEffects || hasGradient)) {
        const mod = await Promise.resolve().then(() => __importStar(require('../fallback-svg')));
        return mod.exportSvgFallback(node, ctx, 'Gradient/effect subtree exported through SVG in Maximum Fidelity mode');
    }
    const out = (0, geometry_1.serializeGeometryNode)(node);
    if (node.type === 'FRAME')
        out.type = 'GROUP';
    if (hasEffects) {
        ctx.warnings.push({ code: 'EFFECT_BEST_EFFORT', message: 'Effects may differ in Illustrator', nodeId: String(node.id), nodeName: String(node.name || node.type) });
    }
    if (hasGradient) {
        ctx.warnings.push({ code: 'GRADIENT_BEST_EFFORT', message: 'Gradient metadata is preserved but native Illustrator mapping is best-effort in MVP', nodeId: String(node.id), nodeName: String(node.name || node.type) });
    }
    if (Array.isArray(node.children)) {
        const children = [];
        for (const child of node.children) {
            const result = await serializeSceneNode(child, ctx);
            if (result)
                children.push(result);
        }
        out.children = children;
    }
    return out;
}

},
"serializers/geometry.js":function(module,exports,require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serializePaint = serializePaint;
exports.serializeGeometryNode = serializeGeometryNode;
function serializePaint(paint) {
    var _a, _b, _c;
    if (!paint || typeof paint !== 'object')
        return { type: 'SOLID', visible: false };
    if (paint.type === 'SOLID') {
        return {
            type: 'SOLID',
            visible: paint.visible !== false,
            opacity: typeof paint.opacity === 'number' ? paint.opacity : 1,
            color: paint.color ? { r: paint.color.r, g: paint.color.g, b: paint.color.b, a: (_a = paint.color.a) !== null && _a !== void 0 ? _a : 1 } : undefined
        };
    }
    if (paint.type === 'GRADIENT_LINEAR' || paint.type === 'GRADIENT_RADIAL') {
        return {
            type: paint.type,
            visible: paint.visible !== false,
            opacity: typeof paint.opacity === 'number' ? paint.opacity : 1,
            gradientStops: Array.isArray(paint.gradientStops) ? paint.gradientStops.map((s) => ({ position: s.position, color: { ...s.color } })) : [],
            gradientTransform: paint.gradientTransform ? paint.gradientTransform.map((r) => r.slice()) : undefined
        };
    }
    if (paint.type === 'IMAGE') {
        return {
            type: 'IMAGE', visible: paint.visible !== false, opacity: (_b = paint.opacity) !== null && _b !== void 0 ? _b : 1,
            imageHash: paint.imageHash, scaleMode: paint.scaleMode, imageTransform: paint.imageTransform
        };
    }
    return { type: paint.type || 'SOLID', visible: paint.visible !== false, opacity: (_c = paint.opacity) !== null && _c !== void 0 ? _c : 1 };
}
function serializeGeometryNode(node) {
    const base = {
        id: String(node.id), type: node.type, name: String(node.name || node.type),
        visible: node.visible !== false,
        opacity: typeof node.opacity === 'number' ? node.opacity : 1,
        blendMode: node.blendMode || 'NORMAL',
        x: Number(node.x || 0), y: Number(node.y || 0), width: Number(node.width || 0), height: Number(node.height || 0),
        rotation: Number(node.rotation || 0),
        matrix: node.relativeTransform ? node.relativeTransform.map((r) => r.slice()) : [[1, 0, Number(node.x || 0)], [0, 1, Number(node.y || 0)]],
        fills: Array.isArray(node.fills) ? node.fills.map(serializePaint) : [],
        strokes: Array.isArray(node.strokes) ? node.strokes.map(serializePaint) : [],
        effects: Array.isArray(node.effects) ? node.effects.map((e) => ({ ...e })) : []
    };
    if (typeof node.cornerRadius === 'number')
        base.cornerRadius = node.cornerRadius;
    if (Array.isArray(node.vectorPaths))
        base.vectorPaths = node.vectorPaths.map((p) => ({ ...p }));
    return base;
}

},
"serializers/image.js":function(module,exports,require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serializeImageNode = serializeImageNode;
async function serializeImageNode(node, paint, ctx) { var _a; const assetId = await ctx.collectImageAsset(paint.imageHash, ctx); return { id: String(node.id), type: 'IMAGE', name: String(node.name || 'Image'), visible: node.visible !== false, opacity: (_a = node.opacity) !== null && _a !== void 0 ? _a : 1, x: node.x || 0, y: node.y || 0, width: node.width || 0, height: node.height || 0, rotation: node.rotation || 0, matrix: node.relativeTransform || [[1, 0, node.x || 0], [0, 1, node.y || 0]], assetId, scaleMode: paint.scaleMode, imageTransform: paint.imageTransform }; }

},
"serializers/text.js":function(module,exports,require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serializeTextNode = serializeTextNode;
const geometry_1 = require("./geometry");
function scalarLineHeight(value) {
    if (!value)
        return undefined;
    if (value.unit === 'AUTO')
        return 'AUTO';
    if (typeof value.value === 'number')
        return value.value;
    return undefined;
}
function scalarLetterSpacing(value) {
    if (!value)
        return undefined;
    if (typeof value.value === 'number')
        return value.value;
    return undefined;
}
async function serializeTextNode(node, _ctx) {
    let segments = [];
    if (typeof node.getStyledTextSegments === 'function') {
        try {
            segments = node.getStyledTextSegments([
                'fontName', 'fontSize', 'fontWeight', 'fills', 'lineHeight', 'letterSpacing', 'textDecoration', 'textCase'
            ]) || [];
        }
        catch (_) {
            segments = [];
        }
    }
    if (!segments.length && typeof node.characters === 'string') {
        segments = [{
                start: 0, end: node.characters.length,
                fontName: typeof node.fontName === 'object' ? node.fontName : undefined,
                fontSize: typeof node.fontSize === 'number' ? node.fontSize : undefined,
                fontWeight: typeof node.fontWeight === 'number' ? node.fontWeight : undefined,
                fills: Array.isArray(node.fills) ? node.fills : [],
                lineHeight: typeof node.lineHeight === 'object' ? node.lineHeight : undefined,
                letterSpacing: typeof node.letterSpacing === 'object' ? node.letterSpacing : undefined,
                textDecoration: typeof node.textDecoration === 'string' ? node.textDecoration : undefined
            }];
    }
    const runs = segments.map((s) => {
        var _a, _b;
        return ({
            start: Number((_a = s.start) !== null && _a !== void 0 ? _a : 0), end: Number((_b = s.end) !== null && _b !== void 0 ? _b : 0),
            fontFamily: s.fontName && typeof s.fontName.family === 'string' ? s.fontName.family : undefined,
            fontStyle: s.fontName && typeof s.fontName.style === 'string' ? s.fontName.style : undefined,
            fontWeight: typeof s.fontWeight === 'number' ? s.fontWeight : undefined,
            fontSize: typeof s.fontSize === 'number' ? s.fontSize : undefined,
            fill: Array.isArray(s.fills) && s.fills.length ? (0, geometry_1.serializePaint)(s.fills[0]) : undefined,
            lineHeight: scalarLineHeight(s.lineHeight),
            letterSpacing: scalarLetterSpacing(s.letterSpacing),
            textDecoration: typeof s.textDecoration === 'string' ? s.textDecoration : undefined,
            textCase: typeof s.textCase === 'string' ? s.textCase : undefined
        });
    });
    return {
        id: String(node.id), type: 'TEXT', name: String(node.name || 'Text'), visible: node.visible !== false,
        opacity: typeof node.opacity === 'number' ? node.opacity : 1, blendMode: node.blendMode || 'NORMAL',
        x: Number(node.x || 0), y: Number(node.y || 0), width: Number(node.width || 0), height: Number(node.height || 0),
        rotation: Number(node.rotation || 0), matrix: node.relativeTransform || [[1, 0, node.x || 0], [0, 1, node.y || 0]],
        characters: String(node.characters || ''),
        textAlignHorizontal: typeof node.textAlignHorizontal === 'string' ? node.textAlignHorizontal : undefined,
        textAlignVertical: typeof node.textAlignVertical === 'string' ? node.textAlignVertical : undefined,
        textAutoResize: typeof node.textAutoResize === 'string' ? node.textAutoResize : undefined,
        paragraphSpacing: typeof node.paragraphSpacing === 'number' ? node.paragraphSpacing : undefined,
        runs
    };
}

},
};var __cache={};function __norm(parts){var o=[];for(var i=0;i<parts.length;i++){if(!parts[i]||parts[i]===".")continue;if(parts[i]==="..")o.pop();else o.push(parts[i]);}return o.join("/");}function __resolve(from,req){if(req.charAt(0)!==".")return req;var base=from.split("/");base.pop();var id=__norm(base.concat(req.split("/")));if(id.slice(-3)!==".js")id+=".js";return id;}function __require(id){if(__cache[id])return __cache[id].exports;if(!__modules[id])throw new Error("Module not bundled: "+id);var module={exports:{}};__cache[id]=module;__modules[id](module,module.exports,function(req){return __require(__resolve(id,req));});return module.exports;}__require("main.js");
})();
