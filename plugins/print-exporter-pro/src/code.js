const DEFAULT_SETTINGS = Object.freeze({
  scope: 'selection',
  colorMode: 'CMYK',
  preset: 'printer',
  pageSize: 'frame',
  bleed: 5,
  cropMarks: true,
});

const EXPORTABLE_TYPES = new Set(['FRAME', 'COMPONENT', 'INSTANCE', 'SECTION']);

// A exportação PDF de um frame temporário do Figma preserva 1 unidade do
// frame como 1 ponto PDF. As marcas são vetores do Figma.
// Não altera os metadados TrimBox/BleedBox: o Figma não os expõe pela API.
const PT_PER_MM = 72 / 25.4;
const REFERENCE_FRAME_WIDTH_PT = 200 * PT_PER_MM;
const REFERENCE_FRAME_HEIGHT_PT = 70 * PT_PER_MM;
const CROP_EXTRA_MM = 4.525;
const CROP_STROKE_PT = 0.25;
const CROP_HALO_PT = 1.25;

function targetSizePt(widthPt, heightPt, settings) {
  if (settings.pageSize === 'reference') return [REFERENCE_FRAME_WIDTH_PT, REFERENCE_FRAME_HEIGHT_PT];
  if (settings.pageSize === 'custom') return [settings.customWidth * PT_PER_MM, settings.customHeight * PT_PER_MM];
  return [widthPt, heightPt];
}

function printGeometry(widthPt, heightPt, settings) {
  const [targetWidthPt, targetHeightPt] = targetSizePt(widthPt, heightPt, settings);
  const contentScaleX = targetWidthPt / widthPt;
  const contentScaleY = targetHeightPt / heightPt;
  const bleedPt = settings.bleed * PT_PER_MM;
  const outerPt = settings.cropMarks ? CROP_EXTRA_MM * PT_PER_MM : 0;
  const marginPt = bleedPt + outerPt;
  return {
    widthPt: targetWidthPt,
    heightPt: targetHeightPt,
    contentScaleX,
    contentScaleY,
    contentScale: contentScaleX,
    bleedPt,
    marginPt,
    pageWidthPt: targetWidthPt + 2 * marginPt,
    pageHeightPt: targetHeightPt + 2 * marginPt,
  };
}

// Marcas saem do canto do corte até a borda da página, por cima da arte
// (igual ao PDF de referência da gráfica), para o sensor da máquina ler.
function cropMarkSegments(geometry) {
  const { widthPt, heightPt, marginPt, pageWidthPt, pageHeightPt } = geometry;
  const x0 = marginPt;
  const x1 = marginPt + widthPt;
  const y0 = marginPt;
  const y1 = marginPt + heightPt;
  const marks = [];
  for (const y of [y0, y1]) {
    marks.push([[0, y], [x0, y]]);
    marks.push([[x1, y], [pageWidthPt, y]]);
  }
  for (const x of [x0, x1]) {
    marks.push([[x, 0], [x, y0]]);
    marks.push([[x, y1], [x, pageHeightPt]]);
  }
  return marks;
}

function solidFrameBackground(node) {
  if (!node || !Array.isArray(node.fills)) return null;
  const visible = node.fills.filter((paint) => paint.visible !== false);
  if (visible.length !== 1 || visible[0].type !== 'SOLID') return null;
  const paint = visible[0];
  if (!paint.color || paint.opacity === 0) return null;
  return { color: paint.color, opacity: paint.opacity === undefined ? 1 : paint.opacity };
}

function findFullFrameBackgroundLayer(node) {
  if (!node || !Array.isArray(node.children)) return null;
  const tolerance = 0.5;
  return node.children.find((child) => {
    if (!child || child.visible === false || child.type === 'TEXT' || child.type === 'TEXT_PATH') return false;
    const x = Number(child.x);
    const y = Number(child.y);
    const width = Number(child.width);
    const height = Number(child.height);
    return Number.isFinite(x)
      && Number.isFinite(y)
      && Number.isFinite(width)
      && Number.isFinite(height)
      && x <= tolerance
      && y <= tolerance
      && x + width >= Number(node.width) - tolerance
      && y + height >= Number(node.height) - tolerance;
  }) || node.children.find((child) => child && child.visible !== false && child.type !== 'TEXT' && child.type !== 'TEXT_PATH') || null;
  // Sem camada que cubra o frame inteiro: usa a camada mais de baixo (o fundo).
}

function bleedBackgroundBounds(node, bleed) {
  return {
    x: -bleed,
    y: -bleed,
    width: Number(node.width) + 2 * bleed,
    height: Number(node.height) + 2 * bleed,
  };
}

function appendSolidRectangle(parent, name, x, y, width, height, color, opacity = 1) {
  const rect = figma.createRectangle();
  parent.appendChild(rect);
  rect.name = name;
  rect.resize(width, height);
  rect.x = x;
  rect.y = y;
  rect.fills = [{ type: 'SOLID', color, opacity }];
  rect.strokes = [];
  return rect;
}

function appendBleedBackground(parent, node, geometry, scale, contentScale = 1) {
  const bleed = geometry.bleedPt * scale;
  const scaledNode = {
    width: Number(node.width) * contentScale,
    height: Number(node.height) * contentScale,
  };
  const bounds = bleedBackgroundBounds(scaledNode, bleed);
  const solidBackground = solidFrameBackground(node);
  if (solidBackground) {
    return appendSolidRectangle(
      parent,
      'Fundo estendido para sangria',
      geometry.marginPt * scale + bounds.x,
      geometry.marginPt * scale + bounds.y,
      bounds.width,
      bounds.height,
      solidBackground.color,
      solidBackground.opacity,
    );
  }

  const backgroundLayer = findFullFrameBackgroundLayer(node);
  if (!backgroundLayer || typeof backgroundLayer.clone !== 'function' || typeof backgroundLayer.rescale !== 'function') return null;

  const backgroundClone = backgroundLayer.clone();
  parent.appendChild(backgroundClone);
  backgroundClone.name = 'Fundo estendido para sangria';
  const scaleX = bounds.width / Number(backgroundLayer.width);
  const scaleY = bounds.height / Number(backgroundLayer.height);
  backgroundClone.rescale(Math.max(scaleX, scaleY));
  // Centraliza: o fundo aumentado cobre toda a área de sangria.
  backgroundClone.x = geometry.marginPt * scale + bounds.x + (bounds.width - Number(backgroundClone.width)) / 2;
  backgroundClone.y = geometry.marginPt * scale + bounds.y + (bounds.height - Number(backgroundClone.height)) / 2;
  return backgroundClone;
}

// Exporta um frame temporário do Figma, com a arte clonada e as marcas.
// O clone e seu wrapper são apagados no finally; nunca altera a arte original.
async function makePrintPdf(node, settings) {
  if (settings.bleed === 0 && !settings.cropMarks) {
    return node.exportAsync({ format: 'PDF' });
  }

  if (node.type === 'SECTION') {
    throw new Error('Para incluir marcas de corte, selecione um frame ou componente em vez de uma seção.');
  }

  const geometry = printGeometry(node.width, node.height, settings);
  if (settings.pageSize === 'reference' && Math.abs(geometry.contentScaleX - geometry.contentScaleY) > 0.001) {
    throw new Error('O frame precisa manter a proporção 20 × 7 cm para usar o tamanho de referência.');
  }
  // 1% de tolerância absorve arredondamento de mm digitado à mão.
  if (settings.pageSize === 'custom' && Math.abs(geometry.contentScaleX / geometry.contentScaleY - 1) > 0.01) {
    throw new Error(`O frame precisa ter a mesma proporção de ${settings.customWidth} × ${settings.customHeight} mm.`);
  }
  const scale = 1;
  let printFrame;
  let artwork;
  let bleedBackground;
  try {
    printFrame = figma.createFrame();
    printFrame.name = '__print_exporter_pro_temp__';
    printFrame.resize(geometry.pageWidthPt * scale, geometry.pageHeightPt * scale);
    printFrame.fills = [];
    printFrame.strokes = [];
    printFrame.clipsContent = false;

    // O fundo é a primeira camada, por trás do conteúdo clonado.
    if (settings.bleed > 0) {
      bleedBackground = appendBleedBackground(printFrame, node, geometry, scale, geometry.contentScale);
    }

    artwork = node.clone();
    if (geometry.contentScale !== 1) artwork.rescale(geometry.contentScale);
    printFrame.appendChild(artwork);
    artwork.x = geometry.marginPt * scale;
    artwork.y = geometry.marginPt * scale;
    artwork.rotation = 0;

    if (settings.cropMarks) {
      // Contorno branco embaixo, linha preta em cima: legível sobre arte clara ou escura.
      for (const [thicknessPt, color, name] of [
        [CROP_HALO_PT, { r: 1, g: 1, b: 1 }, 'Marca de corte (contorno)'],
        [CROP_STROKE_PT, { r: 0, g: 0, b: 0 }, 'Marca de corte'],
      ]) {
        const thickness = thicknessPt * scale;
        for (const [start, end] of cropMarkSegments(geometry)) {
          const horizontal = start[1] === end[1];
          const x0 = Math.min(start[0], end[0]) * scale;
          const x1 = Math.max(start[0], end[0]) * scale;
          const y0 = Math.min(start[1], end[1]) * scale;
          const y1 = Math.max(start[1], end[1]) * scale;
          appendSolidRectangle(
            printFrame, name,
            horizontal ? x0 : x0 - thickness / 2,
            horizontal ? y0 - thickness / 2 : y0,
            horizontal ? x1 - x0 : thickness,
            horizontal ? thickness : y1 - y0,
            color,
          );
        }
      }
    }

    return await printFrame.exportAsync({ format: 'PDF' });
  } finally {
    // Se a inserção do clone falhar, ele ainda pode estar na página original.
    if (artwork && !artwork.removed && artwork.parent !== printFrame) artwork.remove();
    if (bleedBackground && !bleedBackground.removed && bleedBackground.parent !== printFrame) bleedBackground.remove();
    if (printFrame && !printFrame.removed) printFrame.remove();
  }
}

function normalizeSettings(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const rawBleed = source.bleed === undefined ? DEFAULT_SETTINGS.bleed : source.bleed;
  const bleed = rawBleed === '' || rawBleed === null ? Number.NaN : Number(rawBleed);

  return {
    ...DEFAULT_SETTINGS,
    ...source,
    scope: source.scope === 'page' ? 'page' : 'selection',
    colorMode: source.colorMode === 'RGB' ? 'RGB' : 'CMYK',
    preset: typeof source.preset === 'string' ? source.preset : DEFAULT_SETTINGS.preset,
    pageSize: typeof source.pageSize === 'string' ? source.pageSize : DEFAULT_SETTINGS.pageSize,
    bleed,
    customWidth: Number(source.customWidth),
    customHeight: Number(source.customHeight),
    cropMarks: source.cropMarks === undefined ? DEFAULT_SETTINGS.cropMarks : Boolean(source.cropMarks),
  };
}

function validateSettings(settings, frameCount) {
  const errors = [];
  if (!Number.isInteger(frameCount) || frameCount < 1) {
    errors.push('Selecione pelo menos um frame para exportar.');
  }
  if (!Number.isFinite(settings.bleed) || settings.bleed < 0) {
    errors.push('O bleed precisa ser um número maior ou igual a zero.');
  }
  if (settings.pageSize === 'custom'
    && !(settings.customWidth > 0 && settings.customHeight > 0)) {
    errors.push('Informe largura e altura personalizadas maiores que zero.');
  }
  return errors;
}

function isExportableNode(node) {
  return Boolean(node && EXPORTABLE_TYPES.has(node.type));
}

function collectTopLevelFrames(nodes) {
  return (Array.isArray(nodes) ? nodes : []).filter(
    (node) => isExportableNode(node) && node.parent && node.parent.type === 'PAGE',
  );
}

function safeFileName(name, index) {
  const fallback = `frame-${index + 1}`;
  const normalized = String(name ?? '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\s*-\s*/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized && normalized !== '.' && normalized !== '..' ? normalized : fallback;
}

function isWindowsReservedName(name) {
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(name);
}

function nextFileName(baseName, usedNames) {
  let candidate = baseName;
  let suffix = 2;
  while (usedNames.has(candidate.toLowerCase()) || isWindowsReservedName(candidate)) {
    candidate = `${baseName} (${suffix})`;
    suffix += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return `${candidate}.pdf`;
}

function planExports(nodes, settings) {
  const normalized = normalizeSettings(settings);
  const usedNames = new Set();
  return (Array.isArray(nodes) ? nodes : []).filter(isExportableNode).map((node, index) => {
    const baseName = safeFileName(node.name, index);
    return {
      nodeId: node.id,
      fileName: nextFileName(baseName, usedNames),
      colorMode: normalized.colorMode,
      bleed: normalized.bleed,
      cropMarks: normalized.cropMarks,
    };
  });
}

function frameSummary(node) {
  return {
    id: node.id,
    name: node.name || 'Sem nome',
    type: node.type,
    width: Math.round(Number(node.width) || 0),
    height: Math.round(Number(node.height) || 0),
  };
}

async function exportPlannedFrames(nodes, plan, exportNode, onProgress = () => {}) {
  const files = [];
  const failed = [];

  for (let index = 0; index < plan.length; index += 1) {
    const item = plan[index];
    const node = nodes.find((candidate) => candidate.id === item.nodeId);
    try {
      const bytes = await exportNode(node);
      files.push({ name: item.fileName, bytes });
    } catch (error) {
      failed.push({ name: item.fileName, message: error instanceof Error ? error.message : String(error) });
    }
    onProgress(index + 1, plan.length);
  }

  return { files, failed };
}

function startPlugin() {
  figma.showUI(__html__, {
    width: 420,
    height: 760,
    themeColors: true,
  });

  let scope = 'selection';
  let currentSettings = normalizeSettings();

  function nodesForScope() {
    if (scope === 'page') {
      return collectTopLevelFrames(figma.currentPage.children);
    }
    return figma.currentPage.selection.filter(isExportableNode);
  }

  function postSelectionState(settings = {}) {
    currentSettings = normalizeSettings({ ...currentSettings, ...settings, scope });
    const nodes = nodesForScope();
    figma.ui.postMessage({
      type: 'SELECTION_STATE',
      data: {
        scope,
        frames: nodes.map(frameSummary),
        settings: currentSettings,
      },
    });
  }

  async function exportFrames(settingsInput) {
    currentSettings = normalizeSettings({ ...currentSettings, ...settingsInput, scope });
    const settings = currentSettings;
    const nodes = nodesForScope();
    const errors = validateSettings(settings, nodes.length);
    if (errors.length) {
      figma.ui.postMessage({ type: 'EXPORT_ERROR', errors });
      return;
    }

    const plan = planExports(nodes, settings);
    figma.ui.postMessage({ type: 'EXPORT_PROGRESS', current: 0, total: plan.length });
    const result = await exportPlannedFrames(
      nodes,
      plan,
      async (node) => {
        return makePrintPdf(node, settings);
      },
      (current, total) => figma.ui.postMessage({ type: 'EXPORT_PROGRESS', current, total }),
    );

    figma.ui.postMessage({
      type: 'EXPORT_RESULT',
      ...result,
      settings,
    });
  }

  figma.on('selectionchange', () => postSelectionState());
  figma.ui.onmessage = (message) => {
    if (!message || typeof message.type !== 'string') return;
    if (message.type === 'REFRESH_SELECTION') postSelectionState(message.settings);
    if (message.type === 'SET_SCOPE') {
      scope = message.scope === 'page' ? 'page' : 'selection';
      postSelectionState(message.settings);
    }
    if (message.type === 'EXPORT') exportFrames(message.settings);
  };

  postSelectionState();
}

if (typeof module !== 'undefined') {
  module.exports = {
    collectTopLevelFrames,
    printGeometry,
    cropMarkSegments,
    findFullFrameBackgroundLayer,
    bleedBackgroundBounds,
    appendBleedBackground,
    exportPlannedFrames,
    normalizeSettings,
    planExports,
    safeFileName,
    makePrintPdf,
    validateSettings,
  };
}

if (typeof figma !== 'undefined' && typeof __html__ !== 'undefined') {
  startPlugin();
}
