const WIDTH = 370;
const OWN = 'bleedpro.sourceId';
const KIND = 'bleedpro.print';
const MARKS = 'bleedpro.marks';
const GUIDE_NAME = 'SANGRIA • NÃO EDITAR';
const downloads = new Map();
let sequence = 0;
let busy = false;
function emit(type, message, extra) {
    figma.ui.postMessage(Object.assign({ type, message }, extra || {}));
}
function finite(v) { return typeof v === 'number' && Number.isFinite(v); }
function unitToInches(unit, basePpi) {
    if (unit === 'mm')
        return 1 / 25.4;
    if (unit === 'cm')
        return 1 / 2.54;
    return 1 / basePpi;
}
function unitToPx(v, unit, basePpi) { return v * unitToInches(unit, basePpi) * basePpi; }
function convertUnitValue(v, from, to, basePpi) { return v * unitToInches(from, basePpi) / unitToInches(to, basePpi); }
function toSides(s, config) {
    return { top: unitToPx(s.top, config.unit, config.basePpi), right: unitToPx(s.right, config.unit, config.basePpi), bottom: unitToPx(s.bottom, config.unit, config.basePpi), left: unitToPx(s.left, config.unit, config.basePpi) };
}
function checkConfig(c) {
    if (!c || (c.unit !== 'mm' && c.unit !== 'cm' && c.unit !== 'px') || !finite(c.dpi) || c.dpi < 72 || c.dpi > 1200)
        throw new Error('DPI inválido. Use um valor de 72 a 1200.');
    if (!finite(c.basePpi) || c.basePpi < 36 || c.basePpi > 1200)
        throw new Error('Escala da arte inválida. Use de 36 a 1200 px/pol.');
    if (c.scope !== 'selection' && c.scope !== 'page')
        throw new Error('Escolha as pranchetas selecionadas ou a página atual.');
    for (const s of [c.outer, c.inner]) {
        if (!s)
            throw new Error('Informe as margens.');
        for (const v of [s.top, s.right, s.bottom, s.left])
            if (!finite(v) || v < 0 || v > 10000)
                throw new Error('As margens precisam ser números não negativos.');
    }
    const b = toSides(c.outer, c);
    if (Math.max(b.top, b.right, b.bottom, b.left) > 3000)
        throw new Error('A sangria ultrapassa 3000 px de um lado. Reduza a medida ou o DPI.');
}
function sources(scope) {
    const selected = figma.currentPage.selection;
    if (scope === 'selection') {
        const result = [];
        for (const node of selected) {
            if (node.type !== 'FRAME')
                continue;
            if (node.getPluginData(KIND) === '1') {
                const id = node.getPluginData(OWN);
                const found = figma.currentPage.findOne(n => n.id === id);
                if (found && found.type === 'FRAME' && !result.includes(found))
                    result.push(found);
            }
            else if (!result.includes(node))
                result.push(node);
        }
        return result;
    }
    return figma.currentPage.children.filter((node) => node.type === 'FRAME' && !node.getPluginData(KIND));
}
function prints(scope) {
    const all = figma.currentPage.children.filter((node) => node.type === 'FRAME' && node.getPluginData(KIND) === '1');
    if (scope === 'page')
        return all;
    const ids = new Set(figma.currentPage.selection.map(n => n.id));
    return all.filter(node => ids.has(node.id) || ids.has(node.getPluginData(OWN)));
}
function existing(source) {
    return figma.currentPage.children.find((n) => n.type === 'FRAME' && n.getPluginData(KIND) === '1' && n.getPluginData(OWN) === source.id);
}
function rectangle(parent, name, x, y, w, h, stroke, fill) {
    const r = figma.createRectangle();
    parent.appendChild(r);
    r.name = name;
    r.resize(Math.max(.01, w), Math.max(.01, h));
    r.x = x;
    r.y = y;
    r.fills = fill ? [fill] : [];
    r.strokes = stroke ? [{ type: 'SOLID', color: stroke }] : [];
    if (stroke)
        r.strokeWeight = Math.max(.5, Math.min(1, w / 500));
    return r;
}
function line(parent, name, x, y, w, h, color = { r: 0, g: 0, b: 0 }) {
    rectangle(parent, name, x, y, w, h, undefined, { type: 'SOLID', color });
}
function addGuides(sheet, sw, sh, slug, b, m) {
    const g = figma.createFrame();
    sheet.appendChild(g);
    g.name = GUIDE_NAME;
    g.resize(sheet.width, sheet.height);
    g.x = 0;
    g.y = 0;
    g.fills = [];
    g.clipsContent = false;
    const bx = slug, by = slug, tx = slug + b.left, ty = slug + b.top;
    rectangle(g, 'Limite da sangria', bx, by, sw + b.left + b.right, sh + b.top + b.bottom, { r: .92, g: .22, b: .31 });
    rectangle(g, 'Linha de corte', tx, ty, sw, sh, { r: .02, g: .55, b: .99 });
    const iw = sw - m.left - m.right, ih = sh - m.top - m.bottom;
    if (iw > 0 && ih > 0)
        rectangle(g, 'Área segura', tx + m.left, ty + m.top, iw, ih, { r: .07, g: .78, b: .41 });
    g.locked = true;
    g.setPluginData('bleedpro.guides', '1');
}
function addCropMarks(sheet, slug, b, w, h) {
    const c = figma.createFrame();
    sheet.appendChild(c);
    c.name = 'MARCAS DE CORTE • IMPRESSÃO';
    c.resize(sheet.width, sheet.height);
    c.x = 0;
    c.y = 0;
    c.fills = [];
    c.clipsContent = false;
    // Marcas encostam no canto do corte (da borda da folha até o corte, por cima
    // da sangria), igual ao PDF de referência da gráfica.
    const tx = slug + b.left, ty = slug + b.top, rx = tx + w, by = ty + h;
    const W = sheet.width, H = sheet.height;
    for (const [lw, color] of [[.5, { r: 0, g: 0, b: 0 }]]) { // só preto
        for (const x of [tx, rx]) {
            line(c, 'Marca superior', x - lw / 2, 0, lw, ty, color);
            line(c, 'Marca inferior', x - lw / 2, by, lw, H - by, color);
        }
        for (const y of [ty, by]) {
            line(c, 'Marca esquerda', 0, y - lw / 2, tx, lw, color);
            line(c, 'Marca direita', rx, y - lw / 2, W - rx, lw, color);
        }
    }
    c.locked = true;
    c.setPluginData(MARKS, '1');
}
function downloadFile(filename, mime, bytes) {
    const job = String(++sequence);
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            downloads.delete(job);
            reject(new Error('O download não foi confirmado pelo navegador.'));
        }, 15000);
        downloads.set(job, { resolve, reject, timer });
        figma.ui.postMessage({ type: 'download', job, filename, mime, bytes: Array.from(bytes) });
    });
}
// Sangria vetorial: estende o fundo da própria prancheta (cor/imagem do frame
// e a camada que cobre o frame inteiro). Sem imagem esticada por cima e sem
// fundo branco, que geravam emendas/linhas brancas na impressão.
async function addEdge(sheet, source, slug, b) {
    const x = slug, y = slug;
    const w = source.width + b.left + b.right, h = source.height + b.top + b.bottom;
    const fills = Array.isArray(source.fills) ? source.fills.filter(p => p.visible !== false) : [];
    if (fills.length) {
        const r = rectangle(sheet, 'SANGRIA • FUNDO DA PRANCHETA', x, y, w, h);
        r.fills = fills;
        sheet.insertChild(0, r);
        r.locked = true;
    }
    // Sangria espelhada: cada faixa fora do corte recebe o espelho da arte junto
    // àquela borda. Cor contínua sem ampliar (ampliar duplicava logos e textos
    // perto da borda em peças compridas). 4 lados + 4 cantos, atrás da arte.
    const tx = x + b.left, ty = y + b.top, sw = source.width, sh = source.height;
    const cols = [[x, b.left, -1, tx], [tx, sw, 1, tx], [tx + sw, b.right, -1, tx + 2 * sw]];
    const rows = [[y, b.top, -1, ty], [ty, sh, 1, ty], [ty + sh, b.bottom, -1, ty + 2 * sh]];
    let index = fills.length ? 1 : 0;
    for (const [cx, cw, fx, ox] of cols) {
        for (const [cy, ch, fy, oy] of rows) {
            if ((fx === 1 && fy === 1) || cw <= 0 || ch <= 0) continue;
            const clip = figma.createFrame();
            sheet.insertChild(index++, clip);
            clip.name = 'SANGRIA • ESPELHO';
            clip.resize(cw, ch);
            clip.x = cx;
            clip.y = cy;
            clip.fills = [];
            clip.clipsContent = true;
            const mirror = source.clone();
            clip.appendChild(mirror);
            // Só camadas que encostam na borda espelhada (fundo, foto, ondas);
            // texto e logo perto da borda não vão para a sangria.
            for (const child of [...mirror.children]) {
                const touches = (cx < tx && child.x <= 1) || (cx >= tx + sw && child.x + child.width >= sw - 1)
                    || (cy < ty && child.y <= 1) || (cy >= ty + sh && child.y + child.height >= sh - 1);
                if (!touches) child.remove();
            }
            mirror.relativeTransform = [[fx, 0, ox - cx], [0, fy, oy - cy]];
            clip.locked = true;
        }
    }
    if (index > (fills.length ? 1 : 0))
        return 'Sangria espelhada a partir das bordas da arte.';
    if (fills.length)
        return 'Cor de fundo da prancheta estendida na sangria. Elementos que encostam no corte precisam de sangria própria.';
    return 'Sem fundo para estender: preencha a sangria manualmente.';
}
function pageAbs(node) {
    const t = node.absoluteTransform;
    return { x: t[0][2], y: t[1][2] };
}
async function prepare(source, config) {
    const a = source.absoluteTransform;
    if (Math.abs(a[0][1]) > .001 || Math.abs(a[1][0]) > .001)
        throw new Error('Pranchetas giradas precisam ser colocadas sem rotação antes da sangria.');
    const b = toSides(config.outer, config), m = toSides(config.inner, config);
    if (source.width <= m.left + m.right || source.height <= m.top + m.bottom)
        throw new Error('A margem interna é maior que a área útil.');
    const slug = config.marks ? Math.max(12, config.basePpi * .12) : 0;
    const sheetW = source.width + b.left + b.right + slug * 2;
    const sheetH = source.height + b.top + b.bottom + slug * 2;
    if (sheetW > 18000 || sheetH > 18000 || sheetW * sheetH > 70000000)
        throw new Error('Dimensões excedem o limite seguro de 70 megapixels.');
    const previous = existing(source);
    const place = pageAbs(source);
    const print = figma.createFrame();
    print.name = 'IMPRESSÃO • ' + source.name;
    print.resize(sheetW, sheetH);
    print.fills = [];
    print.clipsContent = true;
    figma.currentPage.appendChild(print);
    print.x = previous ? previous.x : place.x + source.width + 90;
    print.y = previous ? previous.y : place.y;
    print.setPluginData(KIND, '1');
    print.setPluginData(OWN, source.id);
    print.setPluginData('bleedpro.config', JSON.stringify(config));
    // "API" entre plugins: shared plugin data é lido por qualquer plugin
    // (o Print Exporter Pro usa isto para exportar a cópia como está).
    print.setSharedPluginData('printkit', 'sheet', JSON.stringify({
        version: 1,
        source: 'bleed-pro',
        ppi: config.basePpi,
        trim: { x: slug + b.left, y: slug + b.top, width: source.width, height: source.height },
        bleed: b,
        slug,
        guides: GUIDE_NAME,
        marks: 'MARCAS DE CORTE • IMPRESSÃO',
    }));
    print.setPluginData('bleedpro.geometry', JSON.stringify({ sourceWidth: source.width, sourceHeight: source.height, bleed: b, margin: m, slug, dpi: config.dpi, basePpi: config.basePpi }));
    let warning = '';
    try {
        // Elementos que passam da borda da prancheta entram na sangria: a arte não
        // recorta mais no corte; quem recorta é uma moldura no limite da sangria.
        const clip = figma.createFrame();
        print.appendChild(clip);
        // Fundo vai até a borda da folha (sangria + área das marcas), igual ao
        // PDF de referência; as marcas de corte ficam por cima.
        clip.name = 'SANGRIA • RECORTE';
        clip.resize(sheetW, sheetH);
        clip.x = 0;
        clip.y = 0;
        clip.fills = [];
        clip.clipsContent = true;
        const full = { top: b.top + slug, right: b.right + slug, bottom: b.bottom + slug, left: b.left + slug };
        const art = source.clone();
        clip.appendChild(art);
        art.name = 'ARTE ORIGINAL • CÓPIA EDITÁVEL';
        art.x = full.left;
        art.y = full.top;
        art.clipsContent = false;
        warning = await addEdge(clip, source, 0, full);
        if (config.marks)
            addCropMarks(print, slug, b, source.width, source.height);
        addGuides(print, source.width, source.height, slug, b, m);
        print.setPluginData('bleedpro.warning', warning);
        print.setRelaunchData({ 'f394038b-4a32-4ad7-b82c-4530431c9c28': 'Editar sangria' });
        if (previous)
            previous.remove();
        return { node: print, warning };
    }
    catch (err) {
        print.remove();
        throw err;
    }
}
function ascii(s) {
    const arr = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++)
        arr[i] = s.charCodeAt(i) & 255;
    return arr;
}
function merge(parts) {
    const total = parts.reduce((n, p) => n + p.length, 0);
    const result = new Uint8Array(total);
    let pos = 0;
    for (const p of parts) {
        result.set(p, pos);
        pos += p.length;
    }
    return result;
}
function pdfFromJpg(jpg, widthPx, heightPx, basePpi, geometry, rasterWidth, rasterHeight) {
    const pw = widthPx * 72 / basePpi, ph = heightPx * 72 / basePpi;
    const factor = 72 / basePpi;
    const xTrim = (geometry.slug + geometry.bleed.left) * factor;
    const yTrim = (geometry.slug + geometry.bleed.top) * factor;
    const cutW = geometry.sourceWidth * factor, cutH = geometry.sourceHeight * factor;
    const xBleed = geometry.slug * factor, yBleed = geometry.slug * factor;
    const bleedW = (geometry.sourceWidth + geometry.bleed.left + geometry.bleed.right) * factor;
    const bleedH = (geometry.sourceHeight + geometry.bleed.top + geometry.bleed.bottom) * factor;
    const f = (n) => n.toFixed(3);
    const objects = [];
    objects.push(ascii('<< /Type /Catalog /Pages 2 0 R >>'));
    objects.push(ascii('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
    objects.push(ascii('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + f(pw) + ' ' + f(ph) + '] /TrimBox [' + f(xTrim) + ' ' + f(ph - yTrim - cutH) + ' ' + f(xTrim + cutW) + ' ' + f(ph - yTrim) + '] /BleedBox [' + f(xBleed) + ' ' + f(ph - yBleed - bleedH) + ' ' + f(xBleed + bleedW) + ' ' + f(ph - yBleed) + '] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>'));
    const content = ascii('q\n' + f(pw) + ' 0 0 ' + f(ph) + ' 0 0 cm\n/Im0 Do\nQ\n');
    objects.push(merge([ascii('<< /Length ' + content.length + ' >>\nstream\n'), content, ascii('endstream')]));
    objects.push(merge([ascii('<< /Type /XObject /Subtype /Image /Width ' + rasterWidth + ' /Height ' + rasterHeight + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpg.length + ' >>\nstream\n'), jpg, ascii('\nendstream')]));
    const pieces = [ascii('%PDF-1.4\n%BleedPro\n')];
    const offsets = [0];
    let pos = pieces[0].length;
    for (let i = 0; i < objects.length; i++) {
        offsets.push(pos);
        const entry = merge([ascii((i + 1) + ' 0 obj\n'), objects[i], ascii('\nendobj\n')]);
        pieces.push(entry);
        pos += entry.length;
    }
    const xref = pos;
    let trailer = 'xref\n0 6\n0000000000 65535 f \n';
    for (let i = 1; i <= 5; i++)
        trailer += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    trailer += 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';
    pieces.push(ascii(trailer));
    return merge(pieces);
}
async function apply(config) {
    checkConfig(config);
    const frames = sources(config.scope).slice(0, 20);
    if (!frames.length)
        throw new Error('Selecione uma ou mais pranchetas (Frame), ou use Todas da página.');
    const created = [];
    const errors = [];
    for (let i = 0; i < frames.length; i++) {
        emit('progress', 'Preparando ' + (i + 1) + ' de ' + frames.length + ': ' + frames[i].name);
        try {
            const res = await prepare(frames[i], config);
            created.push(res.node);
            emit('item', '• ' + frames[i].name + ': ' + res.warning);
        }
        catch (e) {
            errors.push(frames[i].name + ': ' + (e instanceof Error ? e.message : String(e)));
        }
    }
    if (created.length) {
        figma.currentPage.selection = created;
        figma.viewport.scrollAndZoomIntoView(created);
    }
    emit('done', 'Criadas/atualizadas ' + created.length + ' cópias.' + (errors.length ? ' Falhas: ' + errors.join(' | ') : '') + ' Revise as bordas antes de enviar à gráfica.', { count: created.length });
}
async function exportPrints(config) {
    checkConfig(config);
    // Exportar já cria/atualiza a cópia com sangria (fundo esticado, marcas) a
    // partir da arte atual: um clique só, sempre com a versão mais recente.
    await apply(config);
    const targets = prints(config.scope).slice(0, 20);
    if (!targets.length)
        throw new Error('Nenhuma cópia preparada encontrada. Crie a sangria primeiro.');
    for (let i = 0; i < targets.length; i++) {
        const frame = targets[i];
        const data = frame.getPluginData('bleedpro.geometry');
        if (!data)
            continue;
        const g = JSON.parse(data);
        const guides = frame.children.find(n => n.name === GUIDE_NAME);
        emit('progress', 'Exportando ' + (i + 1) + ' de ' + targets.length + ': ' + frame.name);
        if (guides)
            guides.visible = false;
        try {
            const scale = config.dpi / g.basePpi;
            const dims = { w: Math.round(frame.width * scale), h: Math.round(frame.height * scale) };
            if (dims.w > 15000 || dims.h > 15000 || dims.w * dims.h > 70000000)
                throw new Error('Arquivo grande demais para exportar com segurança.');
            let result, extension, mime;
            if (config.format === 'PNG') {
                result = await frame.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: scale } });
                extension = 'png';
                mime = 'image/png';
            }
            else {
                const jpg = await frame.exportAsync({ format: 'JPG', constraint: { type: 'SCALE', value: scale } });
                result = pdfFromJpg(jpg, frame.width, frame.height, g.basePpi, g, dims.w, dims.h);
                extension = 'pdf';
                mime = 'application/pdf';
            }
            const name = frame.name.replace(/[^\p{L}\p{N}_\- ]/gu, '').replace(/\s+/g, '-').slice(0, 70);
            await downloadFile((name || 'Sangria') + '.' + extension, mime, result);
        }
        finally {
            if (guides)
                guides.visible = true;
        }
    }
    emit('done', 'Exportação enviada ao navegador. PDF em RGB rasterizado na resolução definida; confira a conversão de cor exigida pela gráfica.');
}
function removeCopies(scope) {
    const targets = prints(scope);
    if (!targets.length)
        throw new Error('Nenhuma cópia do Bleed Pro encontrada.');
    for (const node of targets)
        node.remove();
    emit('done', targets.length + ' cópia(s) preparada(s) removida(s). As pranchetas originais foram preservadas.');
}
figma.showUI(__html__, { width: WIDTH, height: 700 });
figma.root.setRelaunchData({ 'f394038b-4a32-4ad7-b82c-4530431c9c28': 'Abrir Bleed Pro' });
figma.ui.onmessage = async (message) => {
    if (message.type === 'resize') {
        figma.ui.resize(WIDTH, Math.max(360, Math.min(920, Math.round(message.height))));
        return;
    }
    if (message.type === 'download-ack') {
        const w = downloads.get(message.job);
        if (!w)
            return;
        clearTimeout(w.timer);
        downloads.delete(message.job);
        if (message.error)
            w.reject(new Error(message.error));
        else
            w.resolve();
        return;
    }
    if (busy) {
        emit('error', 'Aguarde a conclusão da operação atual.');
        return;
    }
    busy = true;
    emit('busy', 'Processando…');
    try {
        if (message.type === 'apply')
            await apply(message.config);
        else if (message.type === 'export')
            await exportPrints(message.config);
        else if (message.type === 'remove')
            removeCopies(message.scope);
    }
    catch (e) {
        emit('error', e instanceof Error ? e.message : String(e));
    }
    finally {
        busy = false;
        emit('idle', '');
    }
};
figma.on('selectionchange', () => emit('selection', 'Pranchetas selecionadas: ' + sources('selection').length));
emit('selection', 'Pranchetas selecionadas: ' + sources('selection').length);
