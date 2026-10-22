/** Runs exclusively in an isolated world. No page-defined functions or console bridge. */
export function browserAnnotationPickerSource(config: { sessionId: string; mode: 'element' | 'region' }): string {
  return `(${installPickerSource})(${JSON.stringify(config)})`
}

const installPickerSource = String.raw`function(config) {
  const key = '__bandalAnnotationPickerV1';
  if (globalThis[key]) globalThis[key].stop();
  const host = document.createElement('div');
  host.setAttribute('data-bandal-annotation', '');
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:auto;cursor:crosshair;';
  const shadow = host.attachShadow({mode:'closed'});
  const box = document.createElement('div'), label = document.createElement('div');
  box.style.cssText = 'position:fixed;border:2px solid #5b7cfa;border-radius:5px;background:rgba(91,124,250,.09);box-sizing:border-box;display:none;pointer-events:none;';
  label.style.cssText = 'position:fixed;padding:5px 9px;background:#222;color:white;font:12px system-ui;border-radius:5px;max-width:320px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:none;pointer-events:none;';
  shadow.append(box, label); document.documentElement.append(host);
  const original = window.getSelection(), ranges = original ? Array.from({length:original.rangeCount},(_,i)=>original.getRangeAt(i).cloneRange()) : [];
  const events = [], selections = new Map(), inFlight = [], drainWaiters = new Set(); let selectionId = 0, stopped = false, frame = 0, point = null, candidate = null, drag = null, capturing = false;
  function rectangle(rect) {
    const x=Math.max(0,rect.x), y=Math.max(0,rect.y), right=Math.min(innerWidth,rect.x+rect.width), bottom=Math.min(innerHeight,rect.y+rect.height);
    return {x,y,width:Math.max(0,right-x),height:Math.max(0,bottom-y)};
  }
  function selector(el) {
    const parts=[];
    for (let current=el;current&&current!==document.documentElement&&parts.length<8;current=current.parentElement) {
      if(current.id) {parts.unshift('#'+CSS.escape(current.id));break;}
      const siblings=current.parentElement?Array.from(current.parentElement.children).filter(s=>s.tagName===current.tagName):[];
      parts.unshift(current.tagName.toLowerCase()+(siblings.length>1?':nth-of-type('+(siblings.indexOf(current)+1)+')':''));
    }
    return parts.join(' > ');
  }
  function quoteFor(el) {return (el.tagName==='IMG'?(el.getAttribute('alt')||''):el.tagName==='IFRAME'?(el.getAttribute('title')||''):(el.innerText||el.textContent||'')).trim().slice(0,8000);}
  function pick(x,y) {
    host.style.pointerEvents='none';
    let el=document.elementFromPoint(x,y);
    host.style.pointerEvents='auto';
    if(!el||el===host||el===document.documentElement||el===document.body) return null;
    const sensitive=el.closest('input,textarea,[type="password"]');
    if(sensitive) return null;
    el=el.closest('p,li,h1,h2,h3,h4,h5,h6,blockquote,pre,td,th,figcaption,img,video,canvas,button,a,[role="button"],iframe')||el;
    const rect=rectangle(el.getBoundingClientRect());
    if(rect.width<2||rect.height<2) return null;
    return {rect, quote:quoteFor(el), selector:selector(el), element:el, source:el.currentSrc||el.src||''};
  }
  function paint(value) {
    if(!value||capturing) {box.style.display='none';label.style.display='none';return;}
    const r=value.rect;box.style.display='block';box.style.left=r.x+'px';box.style.top=r.y+'px';box.style.width=r.width+'px';box.style.height=r.height+'px';
    label.textContent=config.mode==='region'?'드래그해서 영역 선택 · Esc 종료':'클릭해서 AI에 추가 · Esc 종료';
    label.style.display='block';label.style.left=Math.min(r.x,Math.max(0,innerWidth-300))+'px';label.style.top=Math.max(4,r.y-31)+'px';
  }
  function move(e) {
    point={x:e.clientX,y:e.clientY};
    if(frame) return;
    frame=requestAnimationFrame(()=>{frame=0;if(stopped||!point)return;
      candidate=drag?{rect:rectangle({x:Math.min(drag.x,point.x),y:Math.min(drag.y,point.y),width:Math.abs(point.x-drag.x),height:Math.abs(point.y-drag.y)}),quote:'',selector:''}:pick(point.x,point.y);paint(candidate);
    });
  }
  function down(e) {
    if(e.button!==0)return;
    e.preventDefault();e.stopImmediatePropagation();
    if(config.mode==='region')drag={x:e.clientX,y:e.clientY};
  }
  function up(e) {
    if(e.button!==0)return;e.preventDefault();e.stopImmediatePropagation();
    if(config.mode==='region') {
      if(!drag)return;
      candidate={rect:rectangle({x:Math.min(drag.x,e.clientX),y:Math.min(drag.y,e.clientY),width:Math.abs(e.clientX-drag.x),height:Math.abs(e.clientY-drag.y)}),quote:'',selector:''};drag=null;
    } else candidate=pick(e.clientX,e.clientY);
    if(!candidate||candidate.rect.width<4||candidate.rect.height<4)return;
    if(events.length<20){const pickId=++selectionId;selections.set(pickId,candidate);events.push({pickId,rect:candidate.rect,quote:candidate.quote,selector:candidate.selector,title:document.title,url:location.href,viewport:{width:innerWidth,height:innerHeight},scrollX,scrollY,mode:config.mode});}
    candidate=null;paint(null);
  }
  function click(e){e.preventDefault();e.stopImmediatePropagation();}
  function keydown(e){if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();events.push({cancelled:true});stop(false);}}
  function invalidate(){candidate=null;drag=null;paint(null);}
  function stop(remove=true){
    if(!stopped){stopped=true;cancelAnimationFrame(frame);document.removeEventListener('pointermove',move,true);document.removeEventListener('pointerdown',down,true);document.removeEventListener('pointerup',up,true);document.removeEventListener('click',click,true);document.removeEventListener('dblclick',click,true);window.removeEventListener('keydown',keydown,true);window.removeEventListener('scroll',invalidate,true);window.removeEventListener('resize',invalidate);host.remove();
      const selection=window.getSelection();try{selection.removeAllRanges();for(const range of ranges)if(range.startContainer.isConnected)selection.addRange(range);}catch{}
    }
    for(const settle of drainWaiters)settle();
    if(remove){selections.clear();delete globalThis[key];}
  }
  document.addEventListener('pointermove',move,true);document.addEventListener('pointerdown',down,true);document.addEventListener('pointerup',up,true);document.addEventListener('click',click,true);document.addEventListener('dblclick',click,true);window.addEventListener('keydown',keydown,true);window.addEventListener('scroll',invalidate,true);window.addEventListener('resize',invalidate);
  globalThis[key]={sessionId:config.sessionId,stop,valid(pickId){const selected=selections.get(pickId);if(!selected)return false;if(!selected.element)return true;const el=selected.element;if(!el.isConnected||quoteFor(el)!==selected.quote||(el.currentSrc||el.src||'')!==selected.source)return false;const r=rectangle(el.getBoundingClientRect());return ['x','y','width','height'].every(k=>Math.abs(r[k]-selected.rect[k])<1);},drain(){const result=()=>{const batch=events.splice(0);inFlight.push(...batch.map(event=>event.pickId));return {events:batch,url:location.href,scrollX,scrollY,viewport:{width:innerWidth,height:innerHeight}}};if(!events.length||stopped)return result();capturing=true;paint(null);return new Promise(resolve=>{let settled=false;const settle=()=>{if(settled)return;settled=true;drainWaiters.delete(settle);resolve(result());};drainWaiters.add(settle);requestAnimationFrame(()=>requestAnimationFrame(settle));})},resume(){for(const id of inFlight.splice(0))selections.delete(id);capturing=false;paint(candidate)}};
  return {url:location.href};
}`
