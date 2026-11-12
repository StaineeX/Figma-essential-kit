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
const FIGMA_PX_TO_PT = 72 / 96;
const CROP_EXTRA_MM = 4.525;
const CROP_STROKE_PT = 0.5;

// Tamanhos de corte mais usados (mm, retrato). A orientação segue a do frame.
const PAGE_SIZES_MM = Object.freeze({
  A3: [297, 420],
  A4: [210, 297],
  A5: [148, 210],
  A6: [105, 148],
  Letter: [215.9, 279.4],
  card: [90, 50],
  flyer: [100, 150],
  folder: [99, 210],
  square: [200, 200],
  story: [108, 192],
});

function targetSizePt(widthPt, heightPt, settings) {
  if (settings.pageSize === 'reference') return [REFERENCE_FRAME_WIDTH_PT, REFERENCE_FRAME_HEIGHT_PT];
  if (settings.pageSize === 'custom') return [settings.customWidth * PT_PER_MM, settings.customHeight * PT_PER_MM];
  const size = PAGE_SIZES_MM[settings.pageSize];
  if (size) {
    const [short, long] = [Math.min(...size), Math.max(...size)];
    const [w, h] = widthPt > heightPt ? [long, short] : [short, long];
    return [w * PT_PER_MM, h * PT_PER_MM];
  }
  // Frames do Figma (e do FIGAI Pranchetas) usam 96 px/pol; PDF usa 72 pt/pol.
  return [widthPt * FIGMA_PX_TO_PT, heightPt * FIGMA_PX_TO_PT];
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

// Todos os preenchimentos visíveis do frame (cor, gradiente ou imagem).
function hexToRgb(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  const value = match ? parseInt(match[1], 16) : 0xffffff;
  return { r: (value >> 16 & 255) / 255, g: (value >> 8 & 255) / 255, b: (value & 255) / 255 };
}

function frameBackgroundFills(node) {
  if (!node || !Array.isArray(node.fills)) return null;
  const visible = node.fills.filter((paint) => paint.visible !== false && paint.opacity !== 0);
  return visible.length ? visible : null;
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
  // 1) Preenchimento do próprio frame (cor, gradiente ou imagem) cobrindo a sangria.
  let rect = null;
  const fills = frameBackgroundFills(node);
  if (fills) {
    rect = appendSolidRectangle(
      parent,
      'Fundo estendido para sangria',
      geometry.marginPt * scale + bounds.x,
      geometry.marginPt * scale + bounds.y,
      bounds.width,
      bounds.height,
      { r: 1, g: 1, b: 1 },
    );
    rect.fills = fills;
  }

  // 2) Sangria espelhada: cada faixa fora do corte recebe o espelho da arte junto
  // àquela borda. Mantém a cor contínua sem ampliar (ampliar duplicava logos e
  // textos perto da borda em peças compridas).
  const x0 = geometry.marginPt * scale;
  const y0 = geometry.marginPt * scale;
  const pageW = x0 * 2 + scaledNode.width;
  const pageH = y0 * 2 + scaledNode.height;
  const last = appendMirrorBleed(parent, node, x0, y0, scaledNode.width, scaledNode.height, pageW, pageH, contentScale);
  return last || rect;
}

// No espelho ficam só camadas que encostam na borda espelhada (fundo, foto,
// ondas). Texto e logo perto da borda, sem encostar, não aparecem na sangria.
function keepEdgeLayers(mirror, sides) {
  if (!Array.isArray(mirror.children)) return;
  const W = Number(mirror.width);
  const H = Number(mirror.height);
  const t = 1;
  for (const child of [...mirror.children]) {
    const touches = (sides.left && child.x <= t)
      || (sides.right && child.x + child.width >= W - t)
      || (sides.top && child.y <= t)
      || (sides.bottom && child.y + child.height >= H - t);
    if (!touches) child.remove();
  }
}

// 8 molduras (4 lados + 4 cantos) fora do corte, cada uma com a arte refletida
// na borda vizinha. Retorna a última criada.
function appendMirrorBleed(parent, node, x0, y0, w, h, pageW, pageH, contentScale) {
  if (!node || typeof node.clone !== 'function') return null;
  const cols = [
    { at: 0, size: x0, flip: -1, origin: x0 },
    { at: x0, size: w, flip: 1, origin: x0 },
    { at: x0 + w, size: pageW - x0 - w, flip: -1, origin: x0 + 2 * w },
  ];
  const rows = [
    { at: 0, size: y0, flip: -1, origin: y0 },
    { at: y0, size: h, flip: 1, origin: y0 },
    { at: y0 + h, size: pageH - y0 - h, flip: -1, origin: y0 + 2 * h },
  ];
  let last = null;
  for (const col of cols) {
    for (const row of rows) {
      if ((col.flip === 1 && row.flip === 1) || col.size <= 0 || row.size <= 0) continue;
      const clip = figma.createFrame();
      parent.appendChild(clip);
      clip.name = 'Sangria espelhada';
      clip.resize(col.size, row.size);
      clip.x = col.at;
      clip.y = row.at;
      clip.fills = [];
      clip.clipsContent = true;
      const mirror = node.clone();
      if (contentScale !== 1) mirror.rescale(contentScale);
      clip.appendChild(mirror);
      mirror.name = 'Espelho';
      keepEdgeLayers(mirror, {
        left: cols.indexOf(col) === 0, right: cols.indexOf(col) === 2,
        top: rows.indexOf(row) === 0, bottom: rows.indexOf(row) === 2,
      });
      mirror.relativeTransform = [[col.flip, 0, col.origin - col.at], [0, row.flip, row.origin - row.at]];
      last = clip;
    }
  }
  return last;
}

// Exporta um frame temporário do Figma, com a arte clonada e as marcas.
// O clone e seu wrapper são apagados no finally; nunca altera a arte original.
// O PDF do Figma rasteriza efeitos, misturas e máscaras a 1x; como aqui
// 1 unidade = 1 pt, isso dá ~72 dpi. Em "300 dpi" a folha inteira é exportada
// em PNG nessa resolução e a interface monta o PDF no tamanho físico exato.
const MAX_RASTER_SIDE_PX = 12000;

function rasterScale(pageWidthPt, pageHeightPt, dpi) {
  return Math.min(dpi / 72, MAX_RASTER_SIDE_PX / Math.max(pageWidthPt, pageHeightPt));
}

async function exportSheet(printFrame, geometry, settings) {
  if (settings.quality !== 'raster') return printFrame.exportAsync({ format: 'PDF' });
  const scale = rasterScale(geometry.pageWidthPt, geometry.pageHeightPt, settings.dpi);
  const bytes = await printFrame.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: scale } });
  return { raster: true, bytes, widthPt: geometry.pageWidthPt, heightPt: geometry.pageHeightPt };
}

// Cópia criada pelo Bleed Pro (contorno vermelho): já tem sangria esticada e
// marcas. Exporta como está, sem as guias, convertendo 96 px/pol para pt.
const BLEED_PRO_GUIDES = 'SANGRIA • NÃO EDITAR';
const BLEED_PRO_MARKS = 'MARCAS DE CORTE • IMPRESSÃO';

// "API" entre plugins: o Bleed Pro grava em shared plugin data ('printkit',
// 'sheet') as medidas da cópia (ppi, corte, sangria, guias).
function readPrintkitSheet(node) {
  try {
    const raw = node && typeof node.getSharedPluginData === 'function' ? node.getSharedPluginData('printkit', 'sheet') : '';
    const data = raw ? JSON.parse(raw) : null;
    return data && data.version === 1 && Number(data.ppi) > 0 ? data : null;
  } catch (error) {
    return null;
  }
}

function isBleedProCopy(node) {
  if (readPrintkitSheet(node)) return true;
  // Cópias antigas, sem os dados compartilhados: reconhece pela camada de guias.
  return Boolean(node && node.type === 'FRAME' && Array.isArray(node.children)
    && node.children.some((child) => child.name === BLEED_PRO_GUIDES));
}

async function exportBleedProCopy(node, settings) {
  const sheet = readPrintkitSheet(node);
  const guidesName = (sheet && sheet.guides) || BLEED_PRO_GUIDES;
  const pxToPt = sheet ? 72 / Number(sheet.ppi) : FIGMA_PX_TO_PT;
  // Com a API, o Bleed Pro só orienta o designer: guias e marcas dele saem, e as
  // marcas de impressão são do Exporter, no corte informado pela API.
  const ownMarks = Boolean(sheet && sheet.trim);
  const hiddenNames = new Set([guidesName, ...(ownMarks ? [sheet.marks || BLEED_PRO_MARKS] : [])]);
  const guides = node.children.filter((child) => hiddenNames.has(child.name) && child.visible !== false);
  guides.forEach((guide) => { guide.visible = false; });
  try {
    const widthPt = Number(node.width) * pxToPt;
    const heightPt = Number(node.height) * pxToPt;
    if (ownMarks) return await exportWithOwnMarks(node, sheet, pxToPt, widthPt, heightPt, settings);
    if (settings.quality === 'raster') {
      const scale = rasterScale(widthPt, heightPt, settings.dpi) * pxToPt;
      const bytes = await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: scale } });
      return { raster: true, bytes, widthPt, heightPt };
    }
    const copy = node.clone();
    try {
      copy.rescale(pxToPt);
      return await copy.exportAsync({ format: 'PDF' });
    } finally {
      copy.remove();
    }
  } finally {
    guides.forEach((guide) => { guide.visible = true; });
  }
}

// Monta folha temporária: cópia do Bleed Pro (já sem guias/marcas) + marcas do
// Exporter saindo do canto do corte até a borda da folha.
async function exportWithOwnMarks(node, sheet, pxToPt, widthPt, heightPt, settings) {
  // Adesivo (sem sangria e sem marcas): página = só a área útil, recortada da cópia.
  const sticker = settings.bleed === 0 && !settings.cropMarks;
  const offX = sticker ? sheet.trim.x * pxToPt : 0;
  const offY = sticker ? sheet.trim.y * pxToPt : 0;
  const pageW = sticker ? sheet.trim.width * pxToPt : widthPt;
  const pageH = sticker ? sheet.trim.height * pxToPt : heightPt;
  const temp = figma.createFrame();
  let copy;
  try {
    temp.name = '__print_exporter_pro_temp__';
    temp.resize(pageW, pageH);
    temp.fills = [{ type: 'SOLID', color: hexToRgb(settings.slugColor) }];
    temp.clipsContent = true;
    copy = node.clone();
    temp.appendChild(copy);
    copy.rescale(pxToPt);
    copy.x = -offX;
    copy.y = -offY;
    if (sticker) return await exportSheet(temp, { pageWidthPt: pageW, pageHeightPt: pageH }, settings);
    if (settings.cropMarks) {
      const x0 = sheet.trim.x * pxToPt;
      const y0 = sheet.trim.y * pxToPt;
      const x1 = x0 + sheet.trim.width * pxToPt;
      const y1 = y0 + sheet.trim.height * pxToPt;
      for (const [t, color, name] of [
        [CROP_STROKE_PT, { r: 0, g: 0, b: 0 }, 'Marca de corte'],
      ]) {
        for (const y of [y0, y1]) {
          appendSolidRectangle(temp, name, 0, y - t / 2, x0, t, color);
          appendSolidRectangle(temp, name, x1, y - t / 2, widthPt - x1, t, color);
        }
        for (const x of [x0, x1]) {
          appendSolidRectangle(temp, name, x - t / 2, 0, t, y0, color);
          appendSolidRectangle(temp, name, x - t / 2, y1, t, heightPt - y1, color);
        }
      }
    }
    return await exportSheet(temp, { pageWidthPt: widthPt, pageHeightPt: heightPt }, settings);
  } finally {
    if (copy && !copy.removed && copy.parent !== temp) copy.remove();
    if (!temp.removed) temp.remove();
  }
}

async function makePrintPdf(node, settings) {
  if (isBleedProCopy(node)) return exportBleedProCopy(node, settings);

  if (node.type === 'SECTION') {
    throw new Error('Para incluir marcas de corte, selecione um frame ou componente em vez de uma seção.');
  }

  const geometry = printGeometry(node.width, node.height, settings);
  if (settings.pageSize === 'reference' && Math.abs(geometry.contentScaleX - geometry.contentScaleY) > 0.001) {
    throw new Error('O frame precisa manter a proporção 20 × 7 cm para usar o tamanho de referência.');
  }
  // 1% de tolerância absorve arredondamento de mm digitado à mão.
  if (settings.pageSize !== 'frame' && settings.pageSize !== 'reference'
    && Math.abs(geometry.contentScaleX / geometry.contentScaleY - 1) > 0.01) {
    const mm = (pt) => Math.round(pt / PT_PER_MM * 10) / 10;
    throw new Error(`O frame precisa ter a mesma proporção de ${mm(geometry.widthPt)} × ${mm(geometry.heightPt)} mm. Ajuste o frame ou use "Mesmo do frame".`);
  }
  const scale = 1;
  let printFrame;
  let artwork;
  let bleedBackground;
  let clip;
  try {
    printFrame = figma.createFrame();
    printFrame.name = '__print_exporter_pro_temp__';
    printFrame.resize(geometry.pageWidthPt * scale, geometry.pageHeightPt * scale);
    printFrame.fills = [];
    printFrame.strokes = [];
    printFrame.clipsContent = false;

    // Área fora da sangria (onde ficam as marcas): cor sólida, branca por padrão.
    printFrame.fills = [{ type: 'SOLID', color: hexToRgb(settings.slugColor) }];
    // Moldura no limite da sangria: arte, fundo e espelho param na linha da sangria.
    const bleedOnly = geometry.bleedPt * scale;
    clip = figma.createFrame();
    printFrame.appendChild(clip);
    clip.name = 'Sangria';
    clip.resize(geometry.widthPt * scale + 2 * bleedOnly, geometry.heightPt * scale + 2 * bleedOnly);
    clip.x = (geometry.marginPt - geometry.bleedPt) * scale;
    clip.y = (geometry.marginPt - geometry.bleedPt) * scale;
    clip.fills = [];
    clip.clipsContent = true;
    const inClip = { ...geometry, marginPt: geometry.bleedPt };
    const marginPt = bleedOnly;

    // O fundo é a primeira camada, por trás do conteúdo clonado.
    if (settings.bleed > 0) {
      bleedBackground = appendBleedBackground(clip, node, inClip, scale, geometry.contentScale);
    }

    artwork = node.clone();
    if (geometry.contentScale !== 1) artwork.rescale(geometry.contentScale);
    clip.appendChild(artwork);
    artwork.x = marginPt;
    artwork.y = marginPt;
    artwork.rotation = 0;
    artwork.clipsContent = false; // FRAME, COMPONENT e INSTANCE têm clipsContent

    if (settings.cropMarks) {
      // Marcas só pretas (o contorno branco cobria a linha e ela parecia branca).
      for (const [thicknessPt, color, name] of [
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

    return await exportSheet(printFrame, geometry, settings);
  } finally {
    // Se a inserção do clone falhar, ele ainda pode estar na página original.
    // Se a inserção falhar, clones podem ter ficado fora da folha temporária.
    if (artwork && !artwork.removed && artwork.parent !== clip) artwork.remove();
    if (bleedBackground && !bleedBackground.removed && bleedBackground.parent !== clip) bleedBackground.remove();
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
    quality: source.quality === 'vector' ? 'vector' : 'raster',
    slugColor: /^#[0-9a-f]{6}$/i.test(String(source.slugColor)) ? source.slugColor : '#ffffff',
    dpi: [150, 300, 600].includes(Number(source.dpi)) ? Number(source.dpi) : 300,
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
      const result = await exportNode(node);
      files.push(result && result.raster ? { name: item.fileName, ...result } : { name: item.fileName, bytes: result });
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
