const WIDTH = 370
const OWN = 'bleedpro.sourceId'
const KIND = 'bleedpro.print'
const MARKS = 'bleedpro.marks'
const GUIDE_NAME = 'SANGRIA • NÃO EDITAR'
type Unit = 'mm'|'cm'|'px'
type Sides = { top:number; right:number; bottom:number; left:number }
type Config = { unit:Unit; dpi:number; basePpi:number; outer:Sides; inner:Sides; scope:'selection'|'page'; marks:boolean; format:'PDF'|'PNG' }
type UiMessage =
  | {type:'resize';height:number}
  | {type:'apply';config:Config}
  | {type:'export';config:Config}
  | {type:'remove';scope:'selection'|'page'}
  | {type:'edge-result';job:string;bytes?:number[];error?:string}
  | {type:'download-ack';job:string;error?:string}
type Waiter<T> = {resolve:(v:T)=>void;reject:(e:Error)=>void;timer:number}
const pending = new Map<string, Waiter<Uint8Array>>()
const downloads = new Map<string, Waiter<void>>()
let sequence = 0
let busy = false
function emit(type:string, message:string, extra?:Record<string,unknown>):void {
  figma.ui.postMessage(Object.assign({type,message},extra||{}))
}
function finite(v:number):boolean {return typeof v==='number' && Number.isFinite(v)}
function unitToInches(unit:Unit,basePpi:number):number {
  if(unit==='mm') return 1/25.4
  if(unit==='cm') return 1/2.54
  return 1/basePpi
}
function unitToPx(v:number,unit:Unit,basePpi:number):number {return v*unitToInches(unit,basePpi)*basePpi}
function convertUnitValue(v:number,from:Unit,to:Unit,basePpi:number):number {return v*unitToInches(from,basePpi)/unitToInches(to,basePpi)}
function toSides(s:Sides,config:Config):Sides {
  return {top:unitToPx(s.top,config.unit,config.basePpi),right:unitToPx(s.right,config.unit,config.basePpi),bottom:unitToPx(s.bottom,config.unit,config.basePpi),left:unitToPx(s.left,config.unit,config.basePpi)}
}
function checkConfig(c:Config):void {
  if(!c || (c.unit!=='mm'&&c.unit!=='cm'&&c.unit!=='px') || !finite(c.dpi) || c.dpi<72 || c.dpi>1200) throw new Error('DPI inválido. Use um valor de 72 a 1200.')
  if(!finite(c.basePpi)||c.basePpi<36||c.basePpi>1200) throw new Error('Escala da arte inválida. Use de 36 a 1200 px/pol.')
  if(c.scope!=='selection'&&c.scope!=='page') throw new Error('Escolha as pranchetas selecionadas ou a página atual.')
  for(const s of [c.outer,c.inner]) {
    if(!s) throw new Error('Informe as margens.')
    for(const v of [s.top,s.right,s.bottom,s.left]) if(!finite(v)||v<0||v>10000) throw new Error('As margens precisam ser números não negativos.')
  }
  const b=toSides(c.outer,c)
  if(Math.max(b.top,b.right,b.bottom,b.left)>3000) throw new Error('A sangria ultrapassa 3000 px de um lado. Reduza a medida ou o DPI.')
}
function sources(scope:'selection'|'page'):FrameNode[] {
  const selected=figma.currentPage.selection
  if(scope==='selection') {
    const result:FrameNode[]=[]
    for(const node of selected) {
      if(node.type!=='FRAME') continue
      if(node.getPluginData(KIND)==='1') {
        const id=node.getPluginData(OWN)
        const found=figma.currentPage.findOne(n=>n.id===id)
        if(found&&found.type==='FRAME'&&!result.includes(found)) result.push(found)
      } else if(!result.includes(node)) result.push(node)
    }
    return result
  }
  return figma.currentPage.children.filter((node):node is FrameNode=>node.type==='FRAME'&&!node.getPluginData(KIND))
}
function prints(scope:'selection'|'page'):FrameNode[] {
  const all=figma.currentPage.children.filter((node):node is FrameNode=>node.type==='FRAME'&&node.getPluginData(KIND)==='1')
  if(scope==='page') return all
  const ids=new Set(figma.currentPage.selection.map(n=>n.id))
  return all.filter(node=>ids.has(node.id)||ids.has(node.getPluginData(OWN)))
}
function existing(source:FrameNode):FrameNode|undefined {
  return figma.currentPage.children.find((n):n is FrameNode=>n.type==='FRAME'&&n.getPluginData(KIND)==='1'&&n.getPluginData(OWN)===source.id)
}
function rectangle(parent:FrameNode,name:string,x:number,y:number,w:number,h:number,stroke?:RGB,fill?:Paint):RectangleNode {
  const r=figma.createRectangle()
  parent.appendChild(r)
  r.name=name
  r.resize(Math.max(.01,w),Math.max(.01,h))
  r.x=x;r.y=y
  r.fills=fill?[fill]:[]
  r.strokes=stroke?[{type:'SOLID',color:stroke}]:[]
  if(stroke) r.strokeWeight=Math.max(.5,Math.min(1,w/500))
  return r
}
function line(parent:FrameNode,name:string,x:number,y:number,w:number,h:number,color:RGB={r:0,g:0,b:0}):void {
  rectangle(parent,name,x,y,w,h,undefined,{type:'SOLID',color})
}
function addGuides(sheet:FrameNode,sw:number,sh:number,slug:number,b:Sides,m:Sides):void {
  const g=figma.createFrame();sheet.appendChild(g)
  g.name=GUIDE_NAME;g.resize(sheet.width,sheet.height);g.x=0;g.y=0;g.fills=[];g.clipsContent=false
  const bx=slug,by=slug,tx=slug+b.left,ty=slug+b.top
  rectangle(g,'Limite da sangria',bx,by,sw+b.left+b.right,sh+b.top+b.bottom,{r:.92,g:.22,b:.31})
  rectangle(g,'Linha de corte',tx,ty,sw,sh,{r:.02,g:.55,b:.99})
  const iw=sw-m.left-m.right,ih=sh-m.top-m.bottom
  if(iw>0&&ih>0) rectangle(g,'Área segura',tx+m.left,ty+m.top,iw,ih,{r:.07,g:.78,b:.41})
  g.locked=true
  g.setPluginData('bleedpro.guides','1')
}
function addCropMarks(sheet:FrameNode,slug:number,b:Sides,w:number,h:number):void {
  const c=figma.createFrame();sheet.appendChild(c)
  c.name='MARCAS DE CORTE • IMPRESSÃO';c.resize(sheet.width,sheet.height);c.x=0;c.y=0;c.fills=[];c.clipsContent=false
  // Marcas encostam no canto do corte (da borda da folha até o corte, por cima
  // da sangria), igual ao PDF de referência da gráfica.
  const tx=slug+b.left, ty=slug+b.top, rx=tx+w, by=ty+h
  const W=sheet.width,H=sheet.height
  for(const [lw,color] of [[1.25,{r:1,g:1,b:1}],[.5,{r:0,g:0,b:0}]] as [number,RGB][]) {
    for(const x of [tx,rx]) {
      line(c,'Marca superior',x-lw/2,0,lw,ty,color)
      line(c,'Marca inferior',x-lw/2,by,lw,H-by,color)
    }
    for(const y of [ty,by]) {
      line(c,'Marca esquerda',0,y-lw/2,tx,lw,color)
      line(c,'Marca direita',rx,y-lw/2,W-rx,lw,color)
    }
  }
  c.locked=true
  c.setPluginData(MARKS,'1')
}
function edgeAsset(bytes:Uint8Array,w:number,h:number,b:Sides,scale:number):Promise<Uint8Array> {
  const job=String(++sequence)
  return new Promise<Uint8Array>((resolve,reject)=>{
    const timer=setTimeout(()=>{
      pending.delete(job)
      reject(new Error('A extensão da borda demorou demais.'))
    },45000) as unknown as number
    pending.set(job,{resolve,reject,timer})
    figma.ui.postMessage({type:'edge-request',job,bytes:Array.from(bytes),width:w,height:h,outer:b,scale})
  })
}
function downloadFile(filename:string,mime:string,bytes:Uint8Array):Promise<void> {
  const job=String(++sequence)
  return new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>{
      downloads.delete(job)
      reject(new Error('O download não foi confirmado pelo navegador.'))
    },15000) as unknown as number
    downloads.set(job,{resolve,reject,timer})
    figma.ui.postMessage({type:'download',job,filename,mime,bytes:Array.from(bytes)})
  })
}
// Sangria vetorial: estende o fundo da própria prancheta (cor/imagem do frame
// e a camada que cobre o frame inteiro). Sem imagem esticada por cima e sem
// fundo branco, que geravam emendas/linhas brancas na impressão.
async function addEdge(sheet:FrameNode,source:FrameNode,slug:number,b:Sides):Promise<string> {
  const x=slug,y=slug
  const w=source.width+b.left+b.right,h=source.height+b.top+b.bottom
  const fills=Array.isArray(source.fills)?(source.fills as Paint[]).filter(p=>p.visible!==false):[]
  if(fills.length) {
    const r=rectangle(sheet,'SANGRIA • FUNDO DA PRANCHETA',x,y,w,h)
    r.fills=fills
    sheet.insertChild(0,r);r.locked=true
  }
  const t=.5
  // Camada que cobre a prancheta inteira; senão, a camada mais de baixo (o fundo).
  const bg=source.children.find(n=>n.visible&&n.type!=='TEXT'&&n.x<=t&&n.y<=t&&n.x+n.width>=source.width-t&&n.y+n.height>=source.height-t)
    ||source.children.find(n=>n.visible&&n.type!=='TEXT')
  if(bg&&'rescale' in bg) {
    const c=bg.clone() as SceneNode&{rescale(s:number):void}
    sheet.insertChild(fills.length?1:0,c)
    c.name='SANGRIA • '+bg.name
    c.rescale(Math.max(w/bg.width,h/bg.height))
    c.x=x+(w-c.width)/2
    c.y=y+(h-c.height)/2
    c.locked=true
    return 'Fundo "'+bg.name+'" estendido na sangria. Revise elementos que encostam no corte.'
  }
  if(fills.length) return 'Cor de fundo da prancheta estendida na sangria. Elementos que encostam no corte precisam de sangria própria.'
  return 'Sem fundo para estender: preencha a sangria manualmente.'
}
function pageAbs(node:FrameNode):{x:number;y:number} {
  const t=node.absoluteTransform
  return {x:t[0][2],y:t[1][2]}
}
async function prepare(source:FrameNode,config:Config):Promise<{node:FrameNode;warning:string}> {
  const a=source.absoluteTransform
  if(Math.abs(a[0][1])>.001||Math.abs(a[1][0])>.001) throw new Error('Pranchetas giradas precisam ser colocadas sem rotação antes da sangria.')
  const b=toSides(config.outer,config),m=toSides(config.inner,config)
  if(source.width<=m.left+m.right||source.height<=m.top+m.bottom) throw new Error('A margem interna é maior que a área útil.')
  const slug=config.marks?Math.max(12,config.basePpi*.12):0
  const sheetW=source.width+b.left+b.right+slug*2
  const sheetH=source.height+b.top+b.bottom+slug*2
  if(sheetW>18000||sheetH>18000||sheetW*sheetH>70000000) throw new Error('Dimensões excedem o limite seguro de 70 megapixels.')
  const previous=existing(source)
  const place=pageAbs(source)
  const print=figma.createFrame()
  print.name='IMPRESSÃO • '+source.name
  print.resize(sheetW,sheetH)
  print.fills=[]
  print.clipsContent=true
  figma.currentPage.appendChild(print)
  print.x=previous?previous.x:place.x+source.width+90
  print.y=previous?previous.y:place.y
  print.setPluginData(KIND,'1')
  print.setPluginData(OWN,source.id)
  print.setPluginData('bleedpro.config',JSON.stringify(config))
  print.setPluginData('bleedpro.geometry',JSON.stringify({sourceWidth:source.width,sourceHeight:source.height,bleed:b,margin:m,slug,dpi:config.dpi,basePpi:config.basePpi}))
  let warning=''
  try {
    const art=source.clone()
    print.appendChild(art)
    art.name='ARTE ORIGINAL • CÓPIA EDITÁVEL'
    art.x=slug+b.left
    art.y=slug+b.top
    warning=await addEdge(print,source,slug,b)
    if(config.marks) addCropMarks(print,slug,b,source.width,source.height)
    addGuides(print,source.width,source.height,slug,b,m)
    print.setPluginData('bleedpro.warning',warning)
    print.setRelaunchData({'f394038b-4a32-4ad7-b82c-4530431c9c28':'Editar sangria'})
    if(previous) previous.remove()
    return {node:print,warning}
  }catch(err) {
    print.remove()
    throw err
  }
}
function ascii(s:string):Uint8Array {
  const arr=new Uint8Array(s.length)
  for(let i=0;i<s.length;i++) arr[i]=s.charCodeAt(i)&255
  return arr
}
function merge(parts:Uint8Array[]):Uint8Array {
  const total=parts.reduce((n,p)=>n+p.length,0)
  const result=new Uint8Array(total)
  let pos=0
  for(const p of parts){result.set(p,pos);pos+=p.length}
  return result
}
function pdfFromJpg(jpg:Uint8Array,widthPx:number,heightPx:number,basePpi:number,geometry:{sourceWidth:number;sourceHeight:number;bleed:Sides;slug:number},rasterWidth:number,rasterHeight:number):Uint8Array {
  const pw=widthPx*72/basePpi,ph=heightPx*72/basePpi
  const factor=72/basePpi
  const xTrim=(geometry.slug+geometry.bleed.left)*factor
  const yTrim=(geometry.slug+geometry.bleed.top)*factor
  const cutW=geometry.sourceWidth*factor,cutH=geometry.sourceHeight*factor
  const xBleed=geometry.slug*factor,yBleed=geometry.slug*factor
  const bleedW=(geometry.sourceWidth+geometry.bleed.left+geometry.bleed.right)*factor
  const bleedH=(geometry.sourceHeight+geometry.bleed.top+geometry.bleed.bottom)*factor
  const f=(n:number)=>n.toFixed(3)
  const objects:Uint8Array[]=[]
  objects.push(ascii('<< /Type /Catalog /Pages 2 0 R >>'))
  objects.push(ascii('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'))
  objects.push(ascii('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+f(pw)+' '+f(ph)+'] /TrimBox ['+f(xTrim)+' '+f(ph-yTrim-cutH)+' '+f(xTrim+cutW)+' '+f(ph-yTrim)+'] /BleedBox ['+f(xBleed)+' '+f(ph-yBleed-bleedH)+' '+f(xBleed+bleedW)+' '+f(ph-yBleed)+'] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>'))
  const content=ascii('q\n'+f(pw)+' 0 0 '+f(ph)+' 0 0 cm\n/Im0 Do\nQ\n')
  objects.push(merge([ascii('<< /Length '+content.length+' >>\nstream\n'),content,ascii('endstream')]))
  objects.push(merge([ascii('<< /Type /XObject /Subtype /Image /Width '+rasterWidth+' /Height '+rasterHeight+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+jpg.length+' >>\nstream\n'),jpg,ascii('\nendstream')]))
  const pieces:Uint8Array[]=[ascii('%PDF-1.4\n%BleedPro\n')]
  const offsets:number[]=[0]
  let pos=pieces[0].length
  for(let i=0;i<objects.length;i++){
    offsets.push(pos)
    const entry=merge([ascii((i+1)+' 0 obj\n'),objects[i],ascii('\nendobj\n')])
    pieces.push(entry);pos+=entry.length
  }
  const xref=pos
  let trailer='xref\n0 6\n0000000000 65535 f \n'
  for(let i=1;i<=5;i++) trailer+=String(offsets[i]).padStart(10,'0')+' 00000 n \n'
  trailer+='trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF'
  pieces.push(ascii(trailer))
  return merge(pieces)
}
async function apply(config:Config):Promise<void>{
  checkConfig(config)
  const frames=sources(config.scope).slice(0,20)
  if(!frames.length) throw new Error('Selecione uma ou mais pranchetas (Frame), ou use Todas da página.')
  const created:FrameNode[]=[]
  const errors:string[]=[]
  for(let i=0;i<frames.length;i++){
    emit('progress','Preparando '+(i+1)+' de '+frames.length+': '+frames[i].name)
    try {
      const res=await prepare(frames[i],config)
      created.push(res.node)
      emit('item','• '+frames[i].name+': '+res.warning)
    }catch(e){errors.push(frames[i].name+': '+(e instanceof Error?e.message:String(e)))}
  }
  if(created.length){
    figma.currentPage.selection=created
    figma.viewport.scrollAndZoomIntoView(created)
  }
  emit('done','Criadas/atualizadas '+created.length+' cópias.'+(errors.length?' Falhas: '+errors.join(' | '):'')+' Revise as bordas antes de enviar à gráfica.',{count:created.length})
}
async function exportPrints(config:Config):Promise<void>{
  checkConfig(config)
  const targets=prints(config.scope).slice(0,20)
  if(!targets.length) throw new Error('Nenhuma cópia preparada encontrada. Crie a sangria primeiro.')
  for(let i=0;i<targets.length;i++){
    const frame=targets[i]
    const data=frame.getPluginData('bleedpro.geometry')
    if(!data) continue
    const g=JSON.parse(data) as {sourceWidth:number;sourceHeight:number;bleed:Sides;slug:number;dpi:number;basePpi:number}
    const guides=frame.children.find(n=>n.name===GUIDE_NAME)
    emit('progress','Exportando '+(i+1)+' de '+targets.length+': '+frame.name)
    if(guides) guides.visible=false
    try{
      const scale=config.dpi/g.basePpi
      const dims={w:Math.round(frame.width*scale),h:Math.round(frame.height*scale)}
      if(dims.w>15000||dims.h>15000||dims.w*dims.h>70000000) throw new Error('Arquivo grande demais para exportar com segurança.')
      let result:Uint8Array,extension:string,mime:string
      if(config.format==='PNG'){
        result=await frame.exportAsync({format:'PNG',constraint:{type:'SCALE',value:scale}})
        extension='png';mime='image/png'
      }else{
        const jpg=await frame.exportAsync({format:'JPG',constraint:{type:'SCALE',value:scale}})
        result=pdfFromJpg(jpg,frame.width,frame.height,g.basePpi,g,dims.w,dims.h)
        extension='pdf';mime='application/pdf'
      }
      const name=frame.name.replace(/[^\p{L}\p{N}_\- ]/gu,'').replace(/\s+/g,'-').slice(0,70)
      await downloadFile((name||'Sangria')+'.'+extension,mime,result)
    }finally{if(guides)guides.visible=true}
  }
  emit('done','Exportação enviada ao navegador. PDF em RGB rasterizado na resolução definida; confira a conversão de cor exigida pela gráfica.')
}
function removeCopies(scope:'selection'|'page'):void{
  const targets=prints(scope)
  if(!targets.length) throw new Error('Nenhuma cópia do Bleed Pro encontrada.')
  for(const node of targets) node.remove()
  emit('done',targets.length+' cópia(s) preparada(s) removida(s). As pranchetas originais foram preservadas.')
}
figma.showUI(__html__,{width:WIDTH,height:700})
figma.root.setRelaunchData({'f394038b-4a32-4ad7-b82c-4530431c9c28':'Abrir Bleed Pro'})
figma.ui.onmessage=async(message:UiMessage)=>{
  if(message.type==='resize'){figma.ui.resize(WIDTH,Math.max(360,Math.min(920,Math.round(message.height))));return}
  if(message.type==='edge-result'){
    const w=pending.get(message.job)
    if(!w) return
    clearTimeout(w.timer);pending.delete(message.job)
    if(message.error||!message.bytes)w.reject(new Error(message.error||'Falha ao gerar borda'))
    else w.resolve(new Uint8Array(message.bytes))
    return
  }
  if(message.type==='download-ack'){
    const w=downloads.get(message.job)
    if(!w) return
    clearTimeout(w.timer);downloads.delete(message.job)
    if(message.error)w.reject(new Error(message.error))
    else w.resolve()
    return
  }
  if(busy){emit('error','Aguarde a conclusão da operação atual.');return}
  busy=true;emit('busy','Processando…')
  try{
    if(message.type==='apply')await apply(message.config)
    else if(message.type==='export')await exportPrints(message.config)
    else if(message.type==='remove')removeCopies(message.scope)
  }catch(e){emit('error',e instanceof Error?e.message:String(e))}
  finally{busy=false;emit('idle','')}
}
figma.on('selectionchange',()=>emit('selection','Pranchetas selecionadas: '+sources('selection').length))
emit('selection','Pranchetas selecionadas: '+sources('selection').length)
