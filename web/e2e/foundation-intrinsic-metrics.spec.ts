import {expect,test} from '@playwright/test';
test('real host max-content metrics preserve whitespace and height at exact and fractional fit widths',async({page},info)=>{
 test.skip(info.project.name!=='1440x900-dark','one actual browser text-recipe proof');
 await page.goto('/preview?foundation=1');await expect(page.locator('.foundation-surface')).toHaveAttribute('data-foundation-status','ready');
 const receipts=await page.evaluate(async()=>{
  await document.fonts.ready;
  const painted=document.querySelector<HTMLElement>('.foundation-surface button[data-foundation-kind="command"]')!,style=getComputedStyle(painted),root=document.createElement('div');root.style.cssText='position:fixed;left:0;top:0;visibility:hidden;contain:layout style';document.body.append(root);
  const rows:{text:string;scale:number;natural:{width:number;height:number};exact:number;fractional:number}[]=[];
  try{for(const scale of [1,2])for(const text of ['공약 노기루다 255','a\nb','trailing spaces  ','tab\tand spaces','한글🙂 A\nsecond line  ']){
   const span=document.createElement('span');Object.assign(span.style,{position:'absolute',display:'block',padding:'0',border:'0',margin:'0',boxSizing:'border-box',fontFamily:style.fontFamily,fontSize:`${parseFloat(style.fontSize)*scale}px`,lineHeight:`${parseFloat(style.lineHeight)*scale}px`,fontWeight:style.fontWeight,whiteSpace:'pre-wrap',overflowWrap:'anywhere',letterSpacing:'normal',width:'max-content'});span.textContent=text;root.append(span);
   // Native cloning must preserve explicit typography without inheriting
   // another request's text or constrained width from the batch template.
   const clone=span.cloneNode(false) as HTMLSpanElement;if(clone.childNodes.length)throw Error('Template retained text');clone.textContent=text;root.append(clone);
   const natural=span.getBoundingClientRect(),cloned=clone.getBoundingClientRect();if(cloned.width!==natural.width||cloned.height!==natural.height)throw Error('Cloned intrinsic paint differs');
   span.style.width=`${natural.width}px`;clone.style.width=`${natural.width}px`;const exact=span.getBoundingClientRect().height;if(clone.getBoundingClientRect().height!==exact)throw Error('Cloned exact wrapping differs');
   span.style.width=`${natural.width+.25}px`;clone.style.width=`${natural.width+.25}px`;const fractional=span.getBoundingClientRect().height;if(clone.getBoundingClientRect().height!==fractional)throw Error('Cloned fractional wrapping differs');rows.push({text,scale,natural:{width:natural.width,height:natural.height},exact,fractional});clone.remove();span.remove();
  }return rows;}finally{root.remove();}
 });
 for(const row of receipts){expect(row.natural.width).toBeGreaterThan(0);expect(row.natural.height).toBeGreaterThan(0);expect(row.exact).toBe(row.natural.height);expect(row.fractional).toBe(row.natural.height);}
 await info.attach('actual-font-whitespace-metrics',{body:JSON.stringify(receipts),contentType:'application/json'});
});

test('publication repairs inline geometry and clears matching important priorities',async({page},info)=>{
 await page.goto('/preview?foundation=1&fixture=mighty');const host=page.locator('.foundation-surface');await expect(host).toHaveAttribute('data-foundation-status','ready');const before=await host.getAttribute('data-foundation-frame');
 await host.evaluate(h=>{const table=h.querySelector<HTMLElement>('[data-foundation-node="table"]')!;for(const property of ['left','top','width','height','overflow-x','overflow-y'])table.style.setProperty(property,table.style.getPropertyValue(property),'important');const name=h.querySelector<HTMLElement>('[data-foundation-node="identity-name"]')!;name.style.left='1500px';name.style.width='1px';});
 await page.getByRole('button',{name:'새 선택지',exact:true}).click();await expect(host).toHaveAttribute('data-foundation-status','ready');await expect.poll(()=>host.getAttribute('data-foundation-frame')).not.toBe(before);
 const result=await host.evaluate(h=>{const table=h.querySelector<HTMLElement>('[data-foundation-node="table"]')!,name=h.querySelector<HTMLElement>('[data-foundation-node="identity-name"]')!,box=JSON.parse(name.dataset.foundationBox!);return{priorities:['left','top','width','height','overflow-x','overflow-y'].map(p=>table.style.getPropertyPriority(p)),actual:{left:name.style.left,width:name.style.width},expected:{left:`${box.x}px`,width:`${box.width}px`}};});expect(result.priorities).toEqual(['','','','','','']);expect(result.actual).toEqual(result.expected);const {writeFileSync}=await import('node:fs');writeFileSync(info.outputPath('geometry-priority-repair.json'),JSON.stringify(result));
});
test('unchanged publication avoids repeated physical geometry setters',async({page},info)=>{
 await page.goto('/preview?foundation=1&fixture=mighty');const host=page.locator('.foundation-surface');await expect(host).toHaveAttribute('data-foundation-status','ready');const before=await host.getAttribute('data-foundation-frame');
 await host.evaluate(h=>{const table=h.querySelector<HTMLElement>('[data-foundation-node="table"]')!,native=table.style,counts:Record<string,number>={};const style=new Proxy(native,{get(target,key){const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;},set(target,key,value){if(['left','top','width','height','overflowX','overflowY'].includes(String(key)))counts[String(key)]=(counts[String(key)]??0)+1;return Reflect.set(target,key,value,target);}});Object.defineProperty(table,'style',{configurable:true,get:()=>style});(window as any).geometryWrites={counts,tamper(){native.left='1500px';},restore(){delete (table as any).style;}};});
 try{
 await page.getByRole('button',{name:'새 선택지',exact:true}).click();await expect(host).toHaveAttribute('data-foundation-status','ready');await expect.poll(()=>host.getAttribute('data-foundation-frame')).not.toBe(before);const counts=await page.evaluate(()=>(window as any).geometryWrites.counts);expect(counts).toEqual({});const previous=await host.getAttribute('data-foundation-frame');await page.evaluate(()=>(window as any).geometryWrites.tamper());await page.getByRole('button',{name:'새 선택지',exact:true}).click();await expect(host).toHaveAttribute('data-foundation-status','ready');await expect.poll(()=>host.getAttribute('data-foundation-frame')).not.toBe(previous);const repaired=await page.evaluate(()=>{return (window as any).geometryWrites.counts;});expect(repaired).toEqual({left:1});const {writeFileSync}=await import('node:fs');writeFileSync(info.outputPath('unchanged-geometry-writes.json'),JSON.stringify({counts,repaired}));
 }finally{await page.evaluate(()=>(window as any).geometryWrites.restore());}
});
