// FIGAI Illustrator Importer v0.1.0
// Local-only Figma -> Illustrator bridge.

// ---- src/json-compat.jsx ----
// ExtendScript versions used by Illustrator do not consistently provide a
// native JSON global. This ES3-compatible implementation keeps the importer
// self-contained and avoids eval-based parsing of files supplied by users.
function figaiParseJson(source){
  var text=String(source), index=0, length=text.length;
  function fail(message){ throw new Error('Invalid JSON at position '+index+': '+message); }
  function skipWhitespace(){ while(index<length && /[\x20\t\r\n]/.test(text.charAt(index))) index++; }
  function parseString(){
    var out='', closed=false, ch, escaped, hex, code, start, quote, slash, raw;
    if(text.charAt(index)!=='"') fail('Expected string');
    index++;
    // Most large FIGAI strings are base64 payloads with no escapes. Avoid
    // building those strings one character at a time: old ExtendScript
    // engines make repeated concatenation quadratic and can appear frozen on
    // multi-megabyte assets.
    start=index;
    slash=text.indexOf('\\',start);
    quote=text.indexOf('"',start);
    if(quote<0) fail('Unterminated string');
    if(slash<0 || slash>quote){
      raw=text.substring(start,quote);
      if(/[\x00-\x1f]/.test(raw)) fail('Unescaped control character');
      index=quote+1;
      return raw;
    }
    while(index<length){
      ch=text.charAt(index++);
      if(ch==='"'){ closed=true; break; }
      if(ch==='\\'){
        if(index>=length) fail('Unterminated escape');
        escaped=text.charAt(index++);
        if(escaped==='"'||escaped==='\\'||escaped==='/') out+=escaped;
        else if(escaped==='b') out+='\b';
        else if(escaped==='f') out+='\f';
        else if(escaped==='n') out+='\n';
        else if(escaped==='r') out+='\r';
        else if(escaped==='t') out+='\t';
        else if(escaped==='u'){
          hex=text.substr(index,4);
          if(!/^[0-9a-fA-F]{4}$/.test(hex)) fail('Invalid unicode escape');
          code=parseInt(hex,16); index+=4; out+=String.fromCharCode(code);
        } else fail('Invalid escape');
      } else {
        if(ch.charCodeAt(0)<32) fail('Unescaped control character');
        out+=ch;
      }
    }
    if(!closed) fail('Unterminated string');
    return out;
  }
  function parseNumber(){
    var match=/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.substr(index,64));
    if(!match) fail('Expected value');
    index+=match[0].length;
    return Number(match[0]);
  }
  function parseArray(){
    var out=[], value;
    index++; skipWhitespace();
    if(text.charAt(index)===']'){ index++; return out; }
    while(true){
      value=parseValue(); out.push(value); skipWhitespace();
      if(text.charAt(index)===']'){ index++; return out; }
      if(text.charAt(index)!==',') fail('Expected comma or closing bracket');
      index++; skipWhitespace();
    }
  }
  function parseObject(){
    var out={}, key, value;
    index++; skipWhitespace();
    if(text.charAt(index)==='}'){ index++; return out; }
    while(true){
      if(text.charAt(index)!=='"') fail('Expected object key');
      key=parseString(); skipWhitespace();
      if(key==='__proto__'||key==='constructor'||key==='prototype') fail('Unsafe object key');
      if(text.charAt(index)!==':') fail('Expected colon');
      index++; value=parseValue(); out[key]=value; skipWhitespace();
      if(text.charAt(index)==='}'){ index++; return out; }
      if(text.charAt(index)!==',') fail('Expected comma or closing brace');
      index++; skipWhitespace();
    }
  }
  function parseValue(){
    var ch;
    skipWhitespace(); ch=text.charAt(index);
    if(ch==='{') return parseObject();
    if(ch==='[') return parseArray();
    if(ch==='"') return parseString();
    if(text.substr(index,4)==='true'){ index+=4; return true; }
    if(text.substr(index,5)==='false'){ index+=5; return false; }
    if(text.substr(index,4)==='null'){ index+=4; return null; }
    return parseNumber();
  }
  var result;
  skipWhitespace(); result=parseValue(); skipWhitespace();
  if(index!==length) fail('Unexpected token');
  return result;
}
function figaiJsonQuote(value){
  var text=String(value), out='"', i, ch, code;
  for(i=0;i<text.length;i++){
    ch=text.charAt(i); code=ch.charCodeAt(0);
    if(ch==='"') out+='\\"';
    else if(ch==='\\') out+='\\\\';
    else if(ch==='\b') out+='\\b';
    else if(ch==='\f') out+='\\f';
    else if(ch==='\n') out+='\\n';
    else if(ch==='\r') out+='\\r';
    else if(ch==='\t') out+='\\t';
    else if(code<32) out+='\\u'+('0000'+code.toString(16)).slice(-4);
    else out+=ch;
  }
  return out+'"';
}
function figaiSerializeJson(value){
  function encode(item, stack){
    var type=typeof item, parts=[], i, key, child;
    if(item===null) return 'null';
    if(type==='string') return figaiJsonQuote(item);
    if(type==='number') return isFinite(item)?String(item):'null';
    if(type==='boolean') return item?'true':'false';
    if(type==='undefined'||type==='function') return undefined;
    for(i=0;i<stack.length;i++) if(stack[i]===item) throw new Error('Cannot serialize circular structure');
    stack.push(item);
    if(item instanceof Array){
      for(i=0;i<item.length;i++){
        child=encode(item[i],stack); parts.push(child===undefined?'null':child);
      }
      stack.pop(); return '['+parts.join(',')+']';
    }
    for(key in item){
      if(!Object.prototype.hasOwnProperty.call(item,key)) continue;
      child=encode(item[key],stack);
      if(child!==undefined) parts.push(figaiJsonQuote(key)+':'+child);
    }
    stack.pop(); return '{'+parts.join(',')+'}';
  }
  var encoded=encode(value,[]);
  return encoded===undefined?'null':encoded;
}

// ---- src/validate.jsx ----
function figaiValidatePackage(pkg) {
  var errors=[];
  if(!pkg || typeof pkg!=='object') return {ok:false,errors:['Package must be an object']};
  if(pkg.format!=='FIGAI') errors.push('Unsupported format');
  if(pkg.version!=='0.1.0') errors.push('Unsupported version');
  if(!pkg.document || (pkg.document.colorMode!=='RGB' && pkg.document.colorMode!=='CMYK')) errors.push('Invalid document');
  if(!pkg.artboards || !pkg.artboards.length) errors.push('At least one artboard is required');
  if(!pkg.assets || !pkg.assets.images) errors.push('Invalid assets');
  return {ok:errors.length===0,errors:errors};
}


// ---- src/coordinates.jsx ----
function figaiPxToPt(px){ return Number(px||0)*0.75; }
function figaiNodePosition(node, artboard){
  return {left:artboard.leftPt+figaiPxToPt(node.x||0), top:artboard.topPt-figaiPxToPt(node.y||0)};
}


// ---- src/document.jsx ----
function figaiCreateDocument(pkg, context){
  var first=pkg.artboards[0];
  var colorSpace=(pkg.document.colorMode==='CMYK' && typeof DocumentColorSpace!=='undefined')?DocumentColorSpace.CMYK:((typeof DocumentColorSpace!=='undefined')?DocumentColorSpace.RGB:undefined);
  var width=figaiPxToPt(first.widthPx), height=figaiPxToPt(first.heightPx);
  var doc=app.documents.add(colorSpace,width,height,1);
  var infos=[];
  var cursorLeft=0;
  for(var i=0;i<pkg.artboards.length;i++){
    var ab=pkg.artboards[i], w=figaiPxToPt(ab.widthPx), h=figaiPxToPt(ab.heightPx);
    var rect=[cursorLeft,h,cursorLeft+w,0];
    var target;
    if(i===0){ target=doc.artboards[0]; target.artboardRect=rect; }
    else { target=doc.artboards.add(rect); }
    target.name=ab.name;
    infos.push({index:i,id:ab.id,name:ab.name,leftPt:cursorLeft,topPt:h,widthPt:w,heightPt:h,rect:rect,source:ab});
    cursorLeft+=w+50;
  }
  if(pkg.document.bleedMm && pkg.document.bleedMm>0){
    context.warnings.push({code:'BLEED_METADATA',message:'Bleed '+pkg.document.bleedMm+' mm is stored in FIGAI. Illustrator scripting cannot reliably modify bleed after document creation across versions; verify Document Setup before print.'});
  }
  return {document:doc,artboards:infos};
}


// ---- src/layers.jsx ----
function figaiCreateTopLayer(doc,name){
  var layer=doc.layers.add(); layer.name=name; return layer;
}
function figaiCreateGroup(container,name){
  var group;
  if(container.groupItems && container.groupItems.add) group=container.groupItems.add();
  else if(container.layers && container.layers.add) group=container.layers.add();
  else return container;
  group.name=name||'Group'; return group;
}


// ---- src/nodes/shapes.jsx ----
function figaiRgbToCmyk(r,g,b){
  r=Math.max(0,Math.min(1,r));g=Math.max(0,Math.min(1,g));b=Math.max(0,Math.min(1,b));
  var k=1-Math.max(r,g,b); if(k>=0.999999) return {c:0,m:0,y:0,k:100};
  return {c:((1-r-k)/(1-k))*100,m:((1-g-k)/(1-k))*100,y:((1-b-k)/(1-k))*100,k:k*100};
}
function figaiMakeColor(paint,colorMode){
  if(!paint || paint.type!=='SOLID' || !paint.color) return null;
  var c=paint.color;
  if(colorMode==='CMYK' && typeof CMYKColor!=='undefined'){
    var v=figaiRgbToCmyk(c.r,c.g,c.b), out=new CMYKColor(); out.cyan=v.c;out.magenta=v.m;out.yellow=v.y;out.black=v.k; return out;
  }
  if(typeof RGBColor!=='undefined'){
    var rgb=new RGBColor(); rgb.red=c.r*255;rgb.green=c.g*255;rgb.blue=c.b*255; return rgb;
  }
  return null;
}
function figaiApplyAppearance(item,node,context){
  item.name=node.name||node.type;
  if(typeof node.opacity==='number') item.opacity=node.opacity*100;
  var fill=node.fills&&node.fills.length?figaiMakeColor(node.fills[0],context.colorMode):null;
  if(fill){ item.filled=true;item.fillColor=fill; } else if('filled' in item) item.filled=false;
  var stroke=node.strokes&&node.strokes.length?figaiMakeColor(node.strokes[0],context.colorMode):null;
  if(stroke){ item.stroked=true;item.strokeColor=stroke; } else if('stroked' in item) item.stroked=false;
  if(node.rotation && item.rotate) item.rotate(-node.rotation);
  return item;
}
function figaiCreateNativeShape(layer,node,context){
  var p=figaiNodePosition(node,context.artboard), w=figaiPxToPt(node.width), h=figaiPxToPt(node.height), item=null;
  if(node.type==='RECTANGLE'){
    if(node.cornerRadius && layer.pathItems.roundedRectangle) item=layer.pathItems.roundedRectangle(p.top,p.left,w,h,figaiPxToPt(node.cornerRadius),figaiPxToPt(node.cornerRadius));
    else item=layer.pathItems.rectangle(p.top,p.left,w,h);
  } else if(node.type==='ELLIPSE') item=layer.pathItems.ellipse(p.top,p.left,w,h,false,true);
  else if(node.type==='VECTOR' && node.vectorPaths && node.vectorPaths.length){
    // Complex path parsing is intentionally deferred to SVG fallback in MVP.
    context.warnings.push({code:'VECTOR_SVG_REQUIRED',message:'Complex vector uses SVG fallback',nodeId:node.id,nodeName:node.name}); return null;
  }
  if(item){ if(context.counts) context.counts.vectors=(context.counts.vectors||0)+1; return figaiApplyAppearance(item,node,context); }
  return null;
}


// ---- src/nodes/text.jsx ----
function figaiResolveFont(desc,context){
  var fonts=app.textFonts, i, f;
  if(desc && desc.postScriptName){ try { return {font:fonts.getByName(desc.postScriptName),exact:true}; } catch(_e){} }
  if(desc && desc.fontFamily){
    for(i=0;i<fonts.length;i++){
      f=fonts[i];
      if(f.family===desc.fontFamily && (!desc.fontStyle || f.style===desc.fontStyle)) return {font:f,exact:true};
    }
  }
  var fallbackName=context.fallbackFont||'ArialMT';
  try { return {font:fonts.getByName(fallbackName),exact:false}; } catch(_e2){}
  if(fonts.length) return {font:fonts[0],exact:false};
  return {font:null,exact:false};
}
function figaiApplyRunToCharacters(tf,run,context,node){
  var resolved=figaiResolveFont(run,context);
  if(!resolved.exact){
    context.counts.missingFonts++;
    context.warnings.push({code:'MISSING_FONT',message:'Missing font: '+(run.fontFamily||'Unknown')+' '+(run.fontStyle||''),nodeId:node.id,nodeName:node.name});
  }
  var start=Math.max(0,Number(run.start||0)), end=Math.min(tf.characters.length,Number(run.end||0));
  for(var i=start;i<end;i++){
    var attrs=tf.characters[i].characterAttributes;
    if(resolved.font) attrs.textFont=resolved.font;
    if(typeof run.fontSize==='number') attrs.size=figaiPxToPt(run.fontSize);
    if(run.fill){ var color=figaiMakeColor(run.fill,context.colorMode); if(color) attrs.fillColor=color; }
    if(typeof run.lineHeight==='number') attrs.leading=figaiPxToPt(run.lineHeight);
    if(typeof run.letterSpacing==='number' && typeof run.fontSize==='number' && run.fontSize!==0) attrs.tracking=(run.letterSpacing/run.fontSize)*1000;
  }
}
function figaiApplyParagraphAlignment(tf,align){
  if(!tf.paragraphs || typeof Justification==='undefined') return;
  var value=Justification.LEFT;
  if(align==='CENTER') value=Justification.CENTER;
  else if(align==='RIGHT') value=Justification.RIGHT;
  else if(align==='JUSTIFIED' && Justification.FULLJUSTIFYLASTLINELEFT) value=Justification.FULLJUSTIFYLASTLINELEFT;
  for(var i=0;i<tf.paragraphs.length;i++) tf.paragraphs[i].paragraphAttributes.justification=value;
}
function figaiCreateText(container,node,context){
  var tf=null, p=figaiNodePosition(node,context.artboard);
  // Prefer point text for maximum compatibility; width/height remain metadata and editable text stays live.
  if(container.textFrames && container.textFrames.add) tf=container.textFrames.add();
  if(!tf){ context.warnings.push({code:'TEXT_CREATE_FAILED',message:'Container cannot create text frame',nodeId:node.id,nodeName:node.name}); return null; }
  tf.name=node.name||'Text'; tf.contents=node.characters||''; tf.position=[p.left,p.top];
  if(typeof node.opacity==='number') tf.opacity=node.opacity*100;
  var runs=node.runs||[]; for(var r=0;r<runs.length;r++) figaiApplyRunToCharacters(tf,runs[r],context,node);
  figaiApplyParagraphAlignment(tf,node.textAlignHorizontal);
  if(node.rotation && tf.rotate) tf.rotate(-node.rotation);
  context.counts.text++;
  return tf;
}


// ---- src/nodes/images.jsx ----
function figaiBase64ToBinaryChunk(input,start,end){
  var chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=', output='', i=start;
  while(i<end){
    var e1=chars.indexOf(input.charAt(i++)), e2=chars.indexOf(input.charAt(i++)), e3=chars.indexOf(input.charAt(i++)), e4=chars.indexOf(input.charAt(i++));
    var c1=(e1<<2)|(e2>>4), c2=((e2&15)<<4)|(e3>>2), c3=((e3&3)<<6)|e4;
    output+=String.fromCharCode(c1);
    if(e3!==64 && e3!==-1) output+=String.fromCharCode(c2);
    if(e4!==64 && e4!==-1) output+=String.fromCharCode(c3);
  }
  return output;
}
function figaiWriteBase64Binary(file,input){
  var str=String(input||'').replace(/[^A-Za-z0-9\+\/\=]/g,''), start=0, end, chunkSize=32768;
  while(start<str.length){
    end=Math.min(start+chunkSize,str.length);
    if(end<str.length) end-=end%4;
    if(end<=start) end=Math.min(start+4,str.length);
    file.write(figaiBase64ToBinaryChunk(str,start,end)); start=end;
  }
}
function figaiBinaryCodes(binary){ var a=[]; for(var i=0;i<binary.length;i++) a.push(binary.charCodeAt(i)&255); return a; }
function figaiShouldEmbedAsset(asset){ return !!asset && String(asset.base64||'').length<=1000000; }
function figaiImageFolder(context){
  var parent=(context&&context.sourceFolder)?context.sourceFolder:Folder.temp, folder=new Folder(parent.fsName+'/FIGAI Assets');
  if(!folder.exists && folder.create) folder.create();
  return folder;
}
function figaiAssetById(context,id){ for(var i=0;i<context.assets.length;i++) if(context.assets[i].id===id) return context.assets[i]; return null; }
function figaiAssetExtension(mime){ if(mime==='image/png') return '.png'; if(mime==='image/jpeg') return '.jpg'; if(mime==='image/gif') return '.gif'; return '.bin'; }
function figaiWriteBinaryTemp(asset,context){
  var path=figaiImageFolder(context).fsName+'/figai-'+asset.id+'-'+(new Date().getTime())+figaiAssetExtension(asset.mimeType), file=new File(path);
  file.encoding='BINARY'; if(!file.open('w')) throw new Error('Could not create temporary image file'); figaiWriteBase64Binary(file,asset.base64); file.close(); return file;
}
function figaiCreateImage(container,node,context){
  var asset=figaiAssetById(context,node.assetId); if(!asset){ context.warnings.push({code:'IMAGE_ASSET_MISSING',message:'Missing image asset '+node.assetId,nodeId:node.id,nodeName:node.name}); return null; }
  var file=figaiWriteBinaryTemp(asset,context), group=null, placed=null, embedded=false;
  try{
    if(container.groupItems && container.groupItems.add){
      group=container.groupItems.add(); group.name=node.name||'Image';
      var p=figaiNodePosition(node,context.artboard), w=figaiPxToPt(node.width), h=figaiPxToPt(node.height);
      var clip=group.pathItems.rectangle(p.top,p.left,w,h); clip.clipping=true; clip.filled=false; clip.stroked=false;
      placed=group.placedItems.add(); placed.file=file; placed.position=[p.left,p.top]; placed.width=w; placed.height=h; placed.name=(node.name||'Image')+' Asset';
      if(typeof node.opacity==='number') placed.opacity=node.opacity*100;
      if(node.rotation && placed.rotate) placed.rotate(-node.rotation);
      group.clipped=true;
      if(node.imageTransform) context.warnings.push({code:'IMAGE_CROP_APPROX',message:'Image crop transform was approximated to the clipping bounds',nodeId:node.id,nodeName:node.name});
      if(figaiShouldEmbedAsset(asset) && placed.embed){
        try { placed.embed(); embedded=true; } catch(embedError){ context.warnings.push({code:'IMAGE_EMBED_FAILED',message:'Image kept linked after embed failed: '+embedError.message,nodeId:node.id,nodeName:node.name}); }
      } else {
        context.warnings.push({code:'IMAGE_LINKED_FOR_STABILITY',message:'Large image kept linked; keep the FIGAI Assets folder with the Illustrator file',nodeId:node.id,nodeName:node.name});
      }
      context.counts.images++;
      return group;
    }
    context.warnings.push({code:'IMAGE_CONTAINER_UNSUPPORTED',message:'Container cannot create clipped image',nodeId:node.id,nodeName:node.name}); return null;
  } finally { try{ if(embedded && file && file.remove) file.remove(); }catch(_e){} }
}


// ---- src/nodes/fallback.jsx ----
function figaiWriteSvgTemp(node){
  var path=Folder.temp.fsName+'/figai-svg-'+String(node.id||'node').replace(/[^A-Za-z0-9_-]/g,'_')+'-'+(new Date().getTime())+'.svg', file=new File(path);
  file.encoding='UTF-8'; if(!file.open('w')) throw new Error('Could not create temporary SVG file'); file.write(node.svg||''); file.close(); return file;
}
function figaiCreateSvgFallback(container,node,context){
  if(!node.svg){ context.warnings.push({code:'EMPTY_SVG_FALLBACK',message:'SVG fallback is empty',nodeId:node.id,nodeName:node.name}); return null; }
  var file=figaiWriteSvgTemp(node), imported=null;
  try{
    imported=app.activeDocument.groupItems.createFromFile(file);
    imported.name=node.name||'SVG Fallback';
    var p=figaiNodePosition(node,context.artboard); imported.position=[p.left,p.top];
    var w=figaiPxToPt(node.width), h=figaiPxToPt(node.height); if(w>0) imported.width=w; if(h>0) imported.height=h;
    if(node.rotation && imported.rotate) imported.rotate(-node.rotation);
    if(imported.move && container && typeof ElementPlacement!=='undefined') imported.move(container,ElementPlacement.PLACEATEND);
    context.counts.svg++;
    return imported;
  } finally { try{ if(file && file.remove) file.remove(); }catch(_e){} }
}


// ---- src/report.jsx ----
function figaiBuildReport(context,artboards){
  var c=context.counts||{}, w=context.warnings||[];
  var lines=[
    'FIGAI Import Complete','',
    'Artboards: '+Number(artboards||0),
    'Objects: '+Number(c.objects||0),
    'Editable text: '+Number(c.text||0),
    'Native vectors: '+Number(c.vectors||0),
    'SVG fallbacks: '+Number(c.svg||0),
    'Images: '+Number(c.images||0),
    'Missing fonts: '+Number(c.missingFonts||0),
    'Warnings: '+w.length
  ];
  if(w.length){
    lines.push('','Warnings:');
    var max=Math.min(w.length,12);
    for(var i=0;i<max;i++) lines.push('- ['+(w[i].code||'WARN')+'] '+(w[i].message||''));
    if(w.length>max) lines.push('- … '+(w.length-max)+' more');
  }
  return lines.join('\n');
}
function figaiShowImportReport(context,artboards){
  var text=figaiBuildReport(context,artboards);
  if(typeof alert==='function') alert(text);
  return text;
}


// ---- src/FIGAI Import.jsx ----
function figaiImportNode(doc,container,node,context){
  if(!node || node.visible===false) return null;
  if(context.counts) context.counts.objects++;
  if(node.type==='GROUP'){
    var g=figaiCreateGroup(container,node.name), kids=node.children||[];
    for(var i=0;i<kids.length;i++) figaiImportNode(doc,g,kids[i],context);
    return g;
  }
  if(node.type==='RECTANGLE'||node.type==='ELLIPSE'||node.type==='VECTOR') return figaiCreateNativeShape(container,node,context);
  if(node.type==='TEXT' && typeof figaiCreateText==='function') return figaiCreateText(container,node,context);
  if(node.type==='IMAGE' && typeof figaiCreateImage==='function') return figaiCreateImage(container,node,context);
  if(node.type==='FALLBACK_SVG' && typeof figaiCreateSvgFallback==='function') return figaiCreateSvgFallback(container,node,context);
  context.warnings.push({code:'UNSUPPORTED_NODE',message:'Unsupported node '+node.type,nodeId:node.id,nodeName:node.name}); return null;
}
function figaiImportPackage(pkg,sourceFolder){
  var validation=figaiValidatePackage(pkg); if(!validation.ok) throw new Error('Invalid FIGAI: '+validation.errors.join(', '));
  var context={warnings:(pkg.warnings||[]).slice(0),colorMode:pkg.document.colorMode,sourceFolder:sourceFolder||null,assets:pkg.assets.images||[],counts:{objects:0,text:0,vectors:0,svg:0,images:0,missingFonts:0}};
  var created=figaiCreateDocument(pkg,context), doc=created.document;
  for(var a=0;a<created.artboards.length;a++){
    var info=created.artboards[a], layer=figaiCreateTopLayer(doc,info.name); context.artboard=info;
    var children=info.source.children||[];
    for(var i=0;i<children.length;i++) figaiImportNode(doc,layer,children[i],context);
  }
  if(typeof figaiShowImportReport==='function') figaiShowImportReport(context,created.artboards.length);
  return {document:doc,context:context,artboards:created.artboards};
}
function figaiRunImporter(){
  try{
    var file=File.openDialog('Choose a .figai file','FIGAI:*.figai;*.json'); if(!file) return;
    file.encoding='UTF-8'; if(!file.open('r')) throw new Error('Could not open file'); var raw=file.read(); file.close();
    var pkg=figaiParseJson(raw); figaiImportPackage(pkg,file.parent);
  }catch(e){ alert('FIGAI import failed:\n'+e.message); }
}
if(typeof File!=='undefined' && typeof File.openDialog==='function' && typeof app!=='undefined' && app.documents) figaiRunImporter();
