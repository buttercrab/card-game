import {writeFile} from 'node:fs/promises';
import {expect,test,type Page,type TestInfo} from '@playwright/test';
import {presetRules} from '../src/lib/games/mighty/catalog';
import {foundationBotButton,joinFoundation} from './foundationHelpers';
const port=Number(process.env.PORT??4317);
test.use({baseURL:`http://127.0.0.1:${port+1}`});
interface Probe {viewer:any;state:any;room:any;sent:any[];}
const ready=(page:Page)=>expect(page.locator('.live-surface')).toHaveAttribute('data-foundation-status','ready');
async function snapshot(page:Page){return page.evaluate(()=>{
 const p=(window as typeof window&{activeVisual:Probe}).activeVisual,s=p.state;
 return{actor:p.viewer?.id,seat:p.viewer?.seat,participantIds:p.room?.participant_ids,version:s?.version,handNumber:s?.command?.scope?.hand,session:s?.command?.scope?.session_id,phase:s?.view?.phase,hand:s?.view?.hand,firstBidder:s?.view?.first_bidder,bids:s?.view?.bids,turn:s?.turn,turnSeconds:p.room?.table?.turn_secs};
});}
/** Explicit hierarchy/readability gates supplement, rather than replace,
 * inspection of the matched original/candidate screenshots. */
async function activeHierarchy(page:Page,baseline:Awaited<ReturnType<typeof snapshot>>,textScale:number,info:TestInfo){
 const status=page.locator('[data-foundation-node="table-active-status"]'),decisions=page.locator('[data-foundation-node="decisions"]'),hand=page.locator('[data-foundation-node="hand"]');
 await expect(status).toBeVisible();await expect(decisions).toBeVisible();await expect(hand).toBeVisible();
 await expect(status).toContainText('차례');
 await expect(status).toContainText(String(baseline.phase.Bidding.best?.[1]?.count??14));
 const geometry=await page.evaluate(()=>{
  const bounds=(element:Element)=>{const box=element.getBoundingClientRect();return{x:box.x,y:box.y,width:box.width,height:box.height,bottom:box.bottom,right:box.right,fontSize:Number.parseFloat(getComputedStyle(element).fontSize)};};
  const rect=(selector:string)=>{const element=document.querySelector<HTMLElement>(selector);if(!element)throw new Error(`Missing ${selector}`);return bounds(element);};
  const node=(id:string)=>rect(`[data-foundation-node="${id}"]`);
  const ancestors=(id:string)=>{const values=[];for(let element=document.querySelector<HTMLElement>(`[data-foundation-node="${id}"]`);element;element=element.parentElement){const css=getComputedStyle(element);values.push({id:element.dataset.foundationNode??element.tagName,box:bounds(element),planned:element.dataset.foundationBox,parent:element.dataset.foundationParent,scrollTop:element.scrollTop,clientHeight:element.clientHeight,scrollHeight:element.scrollHeight,overflowX:css.overflowX,overflowY:css.overflowY});if(!element.parentElement?.dataset.foundationNode)break;}return values;};
  const glyphs=[...document.querySelectorAll<HTMLElement>('[data-foundation-node="table-active-status"] [data-foundation-kind="text"]')].filter(element=>element.textContent?.trim()).map(element=>{
   const range=document.createRange();range.selectNodeContents(element);const boxes=[...range.getClientRects()].filter(box=>box.width&&box.height);let left=0,top=0,right=innerWidth,bottom=innerHeight,painted=true;
   for(let parent:HTMLElement|null=element;parent;parent=parent.parentElement){const css=getComputedStyle(parent);if(css.visibility!=='visible'||Number(css.opacity)===0||parent.getAttribute('aria-hidden')==='true'||parent.hasAttribute('hidden'))painted=false;const box=parent.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(css.overflowX)){left=Math.max(left,box.left+parent.clientLeft);right=Math.min(right,box.left+parent.clientLeft+parent.clientWidth);}if(/auto|scroll|hidden|clip/.test(css.overflowY)){top=Math.max(top,box.top+parent.clientTop);bottom=Math.min(bottom,box.top+parent.clientTop+parent.clientHeight);}}
   return{text:element.textContent,rectangles:boxes.map(box=>({left:box.left,top:box.top,right:box.right,bottom:box.bottom})),painted:painted&&boxes.length>0&&boxes.every(box=>box.left>=left-.5&&box.top>=top-.5&&box.right<=right+.5&&box.bottom<=bottom+.5)};
  });
  return{viewportHeight:innerHeight,handCards:[...document.querySelectorAll<HTMLElement>('[data-foundation-kind="card"][data-foundation-zone="hand"]')].map(bounds),status:node('table-active-status'),decisions:node('decisions'),decisionStrip:document.querySelector('[data-foundation-node="table-decision-strip"]')?node('table-decision-strip'):null,hand:node('hand'),figure:node('identity-figure'),name:node('identity-name'),glyphs,ancestors:{status:ancestors('table-active-status'),decisions:ancestors('decisions'),hand:ancestors('hand')},controls:[...document.querySelectorAll<HTMLElement>('[data-foundation-node="decisions"] button,[data-foundation-node="decisions"] select')].map(element=>{const box=element.getBoundingClientRect();return{label:element.getAttribute('aria-label')??element.textContent?.trim(),width:box.width,height:box.height};})};
 });
 const evidencePath=info.outputPath(`active-hierarchy-${textScale}-${page.viewportSize()!.width}.json`);await writeFile(evidencePath,JSON.stringify({...geometry,baseline},null,2));await info.attach(`active-hierarchy-${textScale}`,{path:evidencePath,contentType:'application/json'});
 await page.screenshot({path:info.outputPath(`active-hierarchy-${textScale}-${page.viewportSize()!.width}.png`),fullPage:true,animations:'disabled'});
 expect(geometry.status.bottom).toBeLessThanOrEqual(geometry.decisions.y+.5);
 expect.soft(geometry.decisions.bottom).toBeLessThanOrEqual(geometry.hand.y+.5);
 for(const card of geometry.handCards){expect.soft(card.y,'bidding hand stays in initial viewport').toBeGreaterThanOrEqual(0);expect.soft(card.bottom,'bidding hand bottom fits initial viewport').toBeLessThanOrEqual(geometry.viewportHeight+.5);}
 expect(geometry.figure.width).toBeGreaterThanOrEqual(64);expect(geometry.figure.height).toBeGreaterThanOrEqual(64);
 expect(geometry.name.fontSize).toBeGreaterThanOrEqual(18*textScale);
 const sideBySide=geometry.figure.right<=geometry.name.x+.5||geometry.name.right<=geometry.figure.x+.5;
 const centerDelta=sideBySide?Math.abs(geometry.name.y+geometry.name.height/2-geometry.figure.y-geometry.figure.height/2):Math.abs(geometry.name.x+geometry.name.width/2-geometry.figure.x-geometry.figure.width/2);
 expect.soft(centerDelta,sideBySide?'side-by-side self name and avatar should share a vertical center':'stacked self name and avatar should share a horizontal center').toBeLessThanOrEqual(2);
 expect(geometry.glyphs.length).toBeGreaterThan(0);for(const glyph of geometry.glyphs)expect.soft(glyph.painted,`essential status glyphs must be painted in the initial viewport: ${glyph.text}`).toBe(true);
 const overlapWidth=Math.min(geometry.figure.right,geometry.name.right)-Math.max(geometry.figure.x,geometry.name.x),overlapHeight=Math.min(geometry.figure.bottom,geometry.name.bottom)-Math.max(geometry.figure.y,geometry.name.y);
 expect(overlapWidth<=.5||overlapHeight<=.5,'local avatar and name must not overlap').toBe(true);
 expect(geometry.controls.length).toBeGreaterThan(1);
 for(const control of geometry.controls){expect(control.width,control.label).toBeGreaterThanOrEqual(44);expect(control.height,control.label).toBeGreaterThanOrEqual(44);}
 // Match original bidNote: only the current best bidder or a passed seat
 // has a status. A superseded bid is history, not a current badge.
 const bidding=baseline.phase.Bidding;
 for(let seat=0;seat<baseline.participantIds.length;seat++){
  if(seat===baseline.seat)continue;
  const exact=page.locator(`[data-foundation-participant-status=${JSON.stringify(baseline.participantIds[seat])}]`),best=bidding.best?.[0]===seat?bidding.best[1]:null;
  if(!best&&!bidding.passed[seat]){await expect(exact).toHaveCount(0);continue;}
  await expect(exact).toHaveCount(1);await expect(exact).toBeVisible();await expect(exact).toContainText(best?String(best.count):'패스');
 }
 return geometry;
}
async function graph(page:Page,candidate:boolean){return page.evaluate(candidate=>{
 const rect=(element:Element)=>{const r=element.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};
 const painted=(element:HTMLElement)=>{const r=element.getBoundingClientRect();let left=0,top=0,right=innerWidth,bottom=innerHeight;for(let parent:HTMLElement|null=element;parent;parent=parent.parentElement){const css=getComputedStyle(parent),box=parent.getBoundingClientRect();if(css.visibility!=='visible'||Number(css.opacity)===0||parent.hidden||parent.getAttribute('aria-hidden')==='true')return false;if(/auto|scroll|hidden|clip/.test(css.overflowX)){left=Math.max(left,box.left+parent.clientLeft);right=Math.min(right,box.left+parent.clientLeft+parent.clientWidth);}if(/auto|scroll|hidden|clip/.test(css.overflowY)){top=Math.max(top,box.top+parent.clientTop);bottom=Math.min(bottom,box.top+parent.clientTop+parent.clientHeight);}}return r.width>0&&r.height>0&&r.left>=left-.5&&r.right<=right+.5&&r.top>=top-.5&&r.bottom<=bottom+.5;};
 const artwork=[...document.querySelectorAll<SVGGraphicsElement>('[data-foundation-node=identity-figure] svg')].map(svg=>{const b=svg.getBBox(),m=svg.getScreenCTM();const points=m?[[b.x,b.y],[b.x+b.width,b.y+b.height]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(m)):[];return{box:rect(svg),local:{x:b.x,y:b.y,width:b.width,height:b.height},paint:points.map(p=>({x:p.x,y:p.y}))};});
 const selectors=candidate?['[data-foundation-node="identity-figure"]','[data-foundation-node="identity-name"]','[data-foundation-node="own-hand-count"]']:['.seat .name','.seat svg','.seat .count'];
 const peerLeaves=[...document.querySelectorAll<HTMLElement>('.live-surface [data-foundation-node]')].filter(element=>{try{const id=JSON.parse(element.dataset.foundationNode!);return Array.isArray(id)&&id[0]==='opponent';}catch{return false;}}).flatMap(root=>[...root.querySelectorAll<HTMLElement>('[data-foundation-kind=text],[data-foundation-kind=figure],[data-foundation-recipient]')].filter(element=>element.getBoundingClientRect().height>0).map(element=>({label:element.getAttribute('aria-label')??element.textContent?.trim(),box:rect(element),painted:painted(element)})));
 return{artwork,peerLeaves,figures:[...document.querySelectorAll<HTMLElement>('.live-surface [data-foundation-kind="figure"][data-foundation-owner]')].map(element=>({owner:element.dataset.foundationOwner,box:rect(element),painted:painted(element)})),peerNames:[...document.querySelectorAll<HTMLElement>('.live-surface [data-foundation-kind="text"]')].filter(element=>{try{const id=JSON.parse(element.dataset.foundationNode!);return Array.isArray(id)&&id[1]==='name'&&JSON.parse(id[0])[0]==='opponent';}catch{return false;}}).map(element=>({text:element.textContent,box:rect(element),painted:painted(element)})),overviewCards:[...document.querySelectorAll<HTMLElement>('.live-surface [data-foundation-kind="card"]')].filter(element=>element.dataset.foundationNode?.includes('outcome-overview')).map(element=>({box:rect(element),painted:painted(element)})),handCards:[...document.querySelectorAll<HTMLElement>('.live-surface [data-foundation-kind="card"][data-foundation-zone="hand"]')].map(element=>({box:rect(element)})),identity:selectors.map(selector=>({selector,nodes:[...document.querySelectorAll(selector)].map(element=>({text:element.textContent?.trim(),box:rect(element)}))})),controls:[...document.querySelectorAll<HTMLElement>(candidate?'.live-surface button,.live-surface select,.live-surface input,.live-surface textarea':'button,select,input,textarea')].map(element=>({tag:element.tagName,node:element.dataset.foundationNode,label:element.getAttribute('aria-label')??element.textContent?.trim(),disabled:'disabled'in element&&!!element.disabled,box:rect(element)}))};
 },candidate);}
async function scale(page:Page,label:'100%'|'200%'){
 await page.getByRole('button',{name:'설정',exact:true}).click();const dialog=page.getByRole('dialog',{name:'설정',exact:true});await dialog.getByRole('combobox',{name:'글자 크기',exact:true}).selectOption({label});await ready(page);await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await ready(page);await page.mouse.click(1,1);
}
async function installActiveProbe(page:Page,name='진행 비교'){
 await page.addInitScript(name=>{
  if(!localStorage.getItem('active-visual-seeded')){localStorage.setItem('active-visual-seeded','1');localStorage.setItem('name',JSON.stringify(name));localStorage.setItem('mighty.settings',JSON.stringify({textScale:1,sound:false,music:false,haptics:false,speed:'off',hints:false,tips:false}));}
  const scope=window as typeof window&{activeVisual:Probe};scope.activeVisual={viewer:null,state:null,room:null,sent:[]};const Native=WebSocket;
  window.WebSocket=class extends Native{constructor(url:string|URL,protocols?:string|string[]){super(url,protocols);this.addEventListener('message',event=>{const value=JSON.parse(String(event.data));if(value.type==='visitor_welcome')scope.activeVisual.viewer=value;if(value.type==='state')scope.activeVisual.state=value;if(value.type==='room')scope.activeVisual.room=value;});}send(data:string|ArrayBufferLike|Blob|ArrayBufferView){if(typeof data==='string')scope.activeVisual.sent.push(JSON.parse(data));super.send(data);}};
 },name);
}
for(const [width,height] of [[390,844],[768,1024],[1440,900],[1280,720],[1280,800]])test(`same bidding hand visual comparison at ${width}px${width===1280?` ×${height}`:''} with candidate 200%`,async({page,request},info)=>{
 test.skip(!['390x844-light','1440x900-dark'].includes(info.project.name),'one mobile/light and desktop/dark profile');test.setTimeout(90000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await installActiveProbe(page);
 await page.setViewportSize({width,height});const rules=presetRules('default');rules.misdeal.threshold=-128;rules.misdeal.all_points=false;
 const response=await request.post('/api/games/mighty/rooms',{data:{preset:'default',rules}});expect(response.ok()).toBe(true);const{id}=await response.json();await page.goto(`/r/${id}?foundation=1`);
 // First hand opens at seat0; the human in seat4 lets every bot take its real turn before capture.
 await joinFoundation(page,{seat:4});await page.getByRole('button',{name:'설정',exact:true}).click();await page.getByRole('dialog',{name:'설정',exact:true}).getByRole('button',{name:'테이블 설정',exact:true}).click();const table=page.getByRole('dialog',{name:'테이블 설정',exact:true});await table.getByRole('combobox',{name:'턴 시간',exact:true}).selectOption({label:'끔'});await table.getByRole('button',{name:'적용하기',exact:true}).click();await expect(table).toContainText('적용했어요');await table.getByRole('button',{name:'닫기',exact:true}).click();if(await page.getByRole('dialog').count())await page.keyboard.press('Escape');await ready(page);
 for(let index=0;index<4;index++){await foundationBotButton(page).click();if(index<3)await expect(foundationBotButton(page)).toBeEnabled();}
 await page.getByRole('button',{name:'시작',exact:true}).click();await expect.poll(async()=>{const s=await snapshot(page);return s.seat===4&&s.firstBidder===0&&s.phase?.Bidding?.to_act===4&&s.turn?.Seat===4&&s.hand?.length===10&&new Set(s.bids?.map((bid:any)=>bid.seat)).size===4;},{timeout:30000}).toBe(true);await ready(page);await expect(page.getByRole('button',{name:'패스',exact:true})).toBeEnabled();
 const baseline=await snapshot(page);expect(baseline.turnSeconds).toBe(0);expect(baseline.version).toBeGreaterThan(0);expect(baseline.actor).toBeTruthy();
 const candidate=info.outputPath(`candidate-bidding-100-${width}.png`);await page.mouse.click(1,1);await page.evaluate(async()=>{await document.fonts.ready;});const candidateHierarchy=await activeHierarchy(page,baseline,1,info),candidateGraph=await graph(page,true);expect(candidateGraph.figures.filter(figure=>figure.owner)).toHaveLength(5);expect(candidateGraph.peerNames).toHaveLength(4);expect(candidateGraph.peerLeaves.length).toBeGreaterThanOrEqual(12);expect(candidateGraph.peerLeaves.filter(leaf=>!leaf.painted)).toEqual([]);await page.screenshot({path:candidate,fullPage:true,animations:'disabled'});
 await scale(page,'200%');await expect.poll(()=>snapshot(page)).toEqual(baseline);const largeHierarchy=await activeHierarchy(page,baseline,2,info),candidateLarge=info.outputPath(`candidate-bidding-200-${width}.png`),largeGraph=await graph(page,true);await page.screenshot({path:candidateLarge,fullPage:true,animations:'disabled'});
 await scale(page,'100%');await expect.poll(()=>snapshot(page)).toEqual(baseline);
 // Explicit original route. Reclaiming the same actor must not mutate this bidding authority.
 await page.goto(`/r/${id}?foundation=0`);await expect(page.getByText('새 버전이 나왔어요.',{exact:true})).toHaveCount(0);await expect(page.locator('.seat .name').filter({hasText:/^진행 비교$/})).toHaveCount(1);await expect(page.getByRole('button',{name:'패스',exact:true})).toBeEnabled();await expect.poll(()=>snapshot(page)).toEqual(baseline);await page.evaluate(async()=>{await document.fonts.ready;});
 const original=info.outputPath(`original-bidding-${width}.png`),originalGraph=await graph(page,false);await page.screenshot({path:original,fullPage:true,animations:'disabled'});expect(errors).toEqual([]);
 expect(await page.evaluate(()=>(window as typeof window&{activeVisual:Probe}).activeVisual.sent.filter(message=>['act','submit','submit_room'].includes(message.type)))).toEqual([]);
 const evidence={room:id,profile:info.project.name,width,height,baseline,after:await snapshot(page),candidateHierarchy,largeHierarchy,candidateGraph,largeGraph,originalGraph,errors,notes:'Screenshots require human visual review. Only candidate engine 200% is claimed; original fixed typography is captured at its normal size.'};const evidencePath=info.outputPath('same-hand-and-geometry.json');await writeFile(evidencePath,JSON.stringify(evidence,null,2));await info.attach('same-hand-and-geometry',{path:evidencePath,contentType:'application/json'});
 for(const [name,path] of [['candidate-bidding-100',candidate],['candidate-bidding-200',candidateLarge],['original-bidding',original]])await info.attach(`${name}-${width}`,{path,contentType:'image/png'});
});

async function takeCurrentMove(page:Page,shouldStop:()=>Promise<boolean>=async()=>false){
 if(await shouldStop())return;
 const pass=page.getByRole('button',{name:'패스',exact:true});
 if(await pass.isEnabled({timeout:100}).catch(()=>false)){if(!await shouldStop())await pass.click();return;}
 const cards=page.locator('.live-surface button[data-foundation-kind="card"][aria-pressed]:enabled');
 if(await cards.count()){
  if(await shouldStop())return;
  await cards.first().click({position:{x:8,y:30}});
  const submit=page.getByRole('button',{name:/^선택 확정 /});
  if(await submit.isEnabled({timeout:100}).catch(()=>false)&&!await shouldStop())await submit.click();
  return;
 }
 const commands=page.locator(`.live-surface button[data-foundation-kind="command"][data-foundation-node^='["command",']:enabled:not([aria-expanded])`).filter({hasNotText:'딜미스'}).filter({hasNotText:'다음 판'}).filter({hasNotText:'준비'});
 if(await commands.count()&&!await shouldStop())await commands.first().click();
}

/** Freeze on the real human turn (or settled outcome), then compare routes.
 * Reclaim and settings changes must preserve the exact server publication. */
async function compareCurrentPhase(page:Page,id:string,phase:'late-play'|'outcome',info:TestInfo){
 const baseline=await snapshot(page),receipts=[];if(phase==='late-play')expect(baseline.turn).toEqual({Seat:baseline.seat});
 for(const [width,height] of [[390,844],[768,1024],[1440,900]]){
  await page.setViewportSize({width,height});await page.evaluate(async()=>{await document.fonts.ready;await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});await ready(page);
  for(const [label,textScale] of [['100%',1],['200%',2]] as const){
   await scale(page,label);await expect.poll(()=>snapshot(page)).toEqual(baseline);
   if(phase==='outcome')await expect(page.getByRole('group',{name:'이번 판 결과',exact:true})).toBeVisible();
   else{
    await expect(page.locator('[data-foundation-node="table-active-status"]')).toBeVisible();
    await expect(page.locator('[data-foundation-zone="hand"][data-foundation-kind="card"]')).toHaveCount(baseline.hand.length);
   }
   const path=info.outputPath(`${phase}-candidate-${width}-${textScale}.png`);
   const measured=await graph(page,true);receipts.push({width,height,textScale,baseline,graph:measured});
   await page.screenshot({path,fullPage:true,animations:'disabled'});await info.attach(`${phase}-candidate-${width}-${textScale}`,{path,contentType:'image/png'});
   // Preserve screenshots even when the source is geometrically admissible
   // but fails the primary playable-table hierarchy.
   const owners=new Set(measured.figures.map(figure=>figure.owner));
   for(const participant of baseline.participantIds)expect.soft(owners.has(participant),`${phase} retains the actual five-player identity composition at ${width}px/${textScale}x`).toBe(true);
   const paintedOwners=new Set(measured.figures.filter(figure=>figure.painted).map(figure=>figure.owner));
   if(textScale===1)for(const participant of baseline.participantIds)expect.soft(paintedOwners.has(participant),`${phase} initially paints each of the five identities at ${width}px`).toBe(true);
   expect.soft(paintedOwners.has(baseline.actor),`${phase} keeps own identity painted at ${width}px/${textScale}x`).toBe(true);
   if(textScale===1){
    expect.soft(measured.peerNames).toHaveLength(4);
    for(const name of measured.peerNames)expect.soft(name.painted,`${phase} paints the whole peer name ${name.text} at ${width}px`).toBe(true);
    if(phase==='outcome'){
     expect.soft(measured.overviewCards).toHaveLength(50);
     expect.soft(measured.overviewCards.filter(card=>card.painted),`the full ten-round five-player result is visible at ${width}px/1x`).toHaveLength(50);
    }
   }
   if(phase==='late-play'){
    expect.soft(measured.handCards).toHaveLength(baseline.hand.length);
    for(const card of measured.handCards){expect.soft(card.box.y,'own hand stays available in the initial viewport').toBeGreaterThanOrEqual(0);expect.soft(card.box.y+card.box.height,`own hand bottom fits the initial ${height}px viewport at ${textScale}x`).toBeLessThanOrEqual(height+.5);}
   }
  }
  await scale(page,'100%');await page.goto(`/r/${id}?foundation=0`);
  await expect(page.locator('.seat .name').filter({hasText:/^진행 비교$/})).toHaveCount(1);
  await expect.poll(()=>snapshot(page)).toEqual(baseline);await page.evaluate(async()=>{await document.fonts.ready;});
  const path=info.outputPath(`${phase}-original-${width}.png`);
  receipts.push({width,height,textScale:1,baseline,original:true,graph:await graph(page,false)});
  await page.screenshot({path,fullPage:true,animations:'disabled'});await info.attach(`${phase}-original-${width}`,{path,contentType:'image/png'});
  // No room/game command may be generated by reclaiming either renderer.
  expect(await page.evaluate(()=>(window as typeof window&{activeVisual:Probe}).activeVisual.sent.filter(message=>['act','submit','submit_room'].includes(message.type)))).toEqual([]);
  await page.goto(`/r/${id}?foundation=1`);await ready(page);await expect.poll(()=>snapshot(page)).toEqual(baseline);
  expect(await page.evaluate(()=>(window as typeof window&{activeVisual:Probe}).activeVisual.sent.filter(message=>['act','submit','submit_room'].includes(message.type)))).toEqual([]);
 }
 const receiptPath=info.outputPath(`${phase}-matched-publication.json`);await writeFile(receiptPath,JSON.stringify({baseline,receipts},null,2));
 await info.attach(`${phase}-matched-publication`,{path:receiptPath,contentType:'application/json'});
}

test('late play and settled outcome preserve one actual five-player publication across original and candidate layouts',async({page,request},info)=>{
 test.skip(info.project.name!=='390x844-light','one actual late-play/outcome comparison');test.setTimeout(180000);
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await installActiveProbe(page);await page.setViewportSize({width:390,height:844});
 const rules=presetRules('default');rules.misdeal.threshold=-128;rules.misdeal.all_points=false;
 const response=await request.post('/api/games/mighty/rooms',{data:{preset:'default',rules}});expect(response.ok()).toBe(true);const{id}=await response.json();await page.goto(`/r/${id}?foundation=1`);await joinFoundation(page,{seat:4});
 await page.getByRole('button',{name:'설정',exact:true}).click();await page.getByRole('dialog',{name:'설정',exact:true}).getByRole('button',{name:'테이블 설정',exact:true}).click();
 const settings=page.getByRole('dialog',{name:'테이블 설정',exact:true});await settings.getByRole('combobox',{name:'턴 시간',exact:true}).selectOption({label:'끔'});await settings.getByRole('button',{name:'적용하기',exact:true}).click();await expect(settings).toContainText('적용했어요');await settings.getByRole('button',{name:'닫기',exact:true}).click();if(await page.getByRole('dialog').count())await page.keyboard.press('Escape');await ready(page);
 for(let index=0;index<4;index++){await foundationBotButton(page).click();if(index<3)await expect(foundationBotButton(page)).toBeEnabled();}
 await page.getByRole('button',{name:'시작',exact:true}).click();
 let lateReached=false;
 const driverSteps:unknown[]=[];
 const lateProbe=()=>page.evaluate(()=>{
  const p=(window as typeof window&{activeVisual:Probe}).activeVisual,s=p.state,host=document.querySelector<HTMLElement>('.live-surface'),cards=[...document.querySelectorAll<HTMLButtonElement>('.live-surface button[data-foundation-kind="card"][data-foundation-zone="hand"][data-foundation-entity]')];
  return{seat:p.viewer?.seat,version:s?.version,play:!!s?.view?.phase?.Play,turn:s?.turn?.Seat,handKeys:(s?.view?.hand??[]).map((card:unknown)=>JSON.stringify(card)).sort(),renderedKeys:cards.map(card=>card.dataset.foundationEntity!).sort(),frame:host?.dataset.foundationFrame,status:host?.dataset.foundationStatus,enabled:cards.filter(card=>!card.disabled&&card.dataset.foundationFrame===host?.dataset.foundationFrame).length};
 });
 const stopLateDriver=async()=>{
  const current=await lateProbe();
  if(current.play&&(current.handKeys.length>0&&current.handKeys.length<=4||current.renderedKeys.length>0&&current.renderedKeys.length<=4))lateReached=true;
  driverSteps.push({...current,lateReached});if(driverSteps.length>24)driverSteps.shift();return lateReached;
 };
 await expect(async()=>{
  await ready(page);await stopLateDriver();const current=await lateProbe();
  if(lateReached){expect(current.play).toBe(true);expect(current.seat).toBe(4);expect(current.turn).toBe(4);expect(current.handKeys.length).toBeGreaterThan(0);expect(current.handKeys.length).toBeLessThanOrEqual(4);expect(current.status).toBe('ready');expect(current.enabled).toBeGreaterThan(0);expect(current.renderedKeys).toEqual(current.handKeys);return;}
  await takeCurrentMove(page,stopLateDriver);throw Error('Wait for a fresh human late-play publication after the submitted move');
 }).toPass({timeout:60000,intervals:[100]}).catch(async error=>{await info.attach('late-play-driver-publications',{body:JSON.stringify(driverSteps,null,2),contentType:'application/json'});throw error;});
 await ready(page);const late=await snapshot(page);expect(late.turnSeconds).toBe(0);expect(late.hand.length).toBeGreaterThan(0);await compareCurrentPhase(page,id,'late-play',info);
 const result=page.getByRole('group',{name:'이번 판 결과',exact:true});
 await expect(async()=>{if(await result.count())return;await takeCurrentMove(page);await expect(result).toBeVisible();}).toPass({timeout:45000,intervals:[100]});await ready(page);
 const outcome=await snapshot(page);expect(outcome.phase?.Done).toBeTruthy();expect(outcome.hand).toHaveLength(0);await compareCurrentPhase(page,id,'outcome',info);expect(errors).toEqual([]);
});

test('short desktop preserves whole identities through canonically empty and acting decision lanes',async({page,context,request},info)=>{
 test.skip(info.project.name!=='1440x900-dark','one deterministic five-human short desktop');test.setTimeout(60000);await page.setViewportSize({width:1280,height:720});const owned:import('@playwright/test').BrowserContext[]=[],players:Page[]=[page];
 try{
  const rules=presetRules('default');rules.misdeal.threshold=-128;rules.misdeal.all_points=false;const response=await request.post('/api/games/mighty/rooms',{data:{preset:'default',rules}});expect(response.ok()).toBe(true);const{id}=await response.json();
  for(let seat=0;seat<5;seat++){let actor=page;if(seat){const isolated=await context.browser()!.newContext({baseURL:`http://127.0.0.1:${port+1}`,viewport:{width:1280,height:720},reducedMotion:'reduce',colorScheme:'dark'});owned.push(isolated);actor=await isolated.newPage();players.push(actor);}await installActiveProbe(actor,['모과','호두','보리','단추','수연'][seat]);await actor.goto(`/r/${id}?foundation=1`);await joinFoundation(actor,{seat});}
  await page.getByRole('button',{name:'설정',exact:true}).click();await page.getByRole('dialog',{name:'설정',exact:true}).getByRole('button',{name:'테이블 설정',exact:true}).click();const settings=page.getByRole('dialog',{name:'테이블 설정',exact:true});await settings.getByRole('combobox',{name:'턴 시간',exact:true}).selectOption({label:'끔'});await settings.getByRole('button',{name:'적용하기',exact:true}).click();await expect(settings).toContainText('적용했어요');await settings.getByRole('button',{name:'닫기',exact:true}).click();if(await page.getByRole('dialog').count())await page.keyboard.press('Escape');
  for(const actor of players){await ready(actor);const button=actor.getByRole('button',{name:'준비하기',exact:true});if(await button.count())await button.click();}await expect(page.getByRole('button',{name:'시작',exact:true})).toBeEnabled();await page.getByRole('button',{name:'시작',exact:true}).click();const focal=players[4];await expect.poll(async()=>{const s=await snapshot(focal);return s.hand?.length===10&&s.turn?.Seat===0;}).toBe(true);await ready(focal);
  await expect(focal.locator('[data-foundation-node="decisions"]')).toHaveCount(0);const idle=await graph(focal,true);expect(idle.peerLeaves.filter(leaf=>!leaf.painted)).toEqual([]);expect(idle.figures.filter(figure=>figure.owner)).toHaveLength(5);for(const card of idle.handCards)expect(card.box.y+card.box.height).toBeLessThanOrEqual(720);await focal.screenshot({path:info.outputPath('short-desktop-empty-100.png')});
  for(const size of ['150%','200%','100%']){await scale(focal,size);await ready(focal);await expect(focal.locator('[data-foundation-node="decisions"]')).toHaveCount(0);const enlarged=await graph(focal,true);for(const card of enlarged.handCards)expect(card.box.y+card.box.height).toBeLessThanOrEqual(720);}
  for(let seat=0;seat<4;seat++){const actor=players[seat];await expect.poll(async()=>(await snapshot(actor)).turn?.Seat).toBe(seat);const pass=actor.getByRole('button',{name:'패스',exact:true});await expect(pass).toBeEnabled();await pass.click();}
  await expect.poll(async()=>(await snapshot(focal)).turn?.Seat).toBe(4);await ready(focal);await expect(focal.getByRole('button',{name:'패스',exact:true})).toBeEnabled();const acting=await graph(focal,true);expect(acting.peerLeaves.filter(leaf=>!leaf.painted)).toEqual([]);await activeHierarchy(focal,await snapshot(focal),1,info);await focal.screenshot({path:info.outputPath('short-desktop-acting-100.png')});await writeFile(info.outputPath('short-desktop-empty-acting.json'),JSON.stringify({idle,acting},null,2));
 }finally{await Promise.all(owned.map(owner=>owner.close()));}
});
