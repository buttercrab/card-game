import {writeFile} from 'node:fs/promises';
import {expect,test,type BrowserContext,type Page} from '@playwright/test';
import {presetRules} from '../src/lib/games/mighty/catalog';
import {cardLabel} from '../src/lib/games/mighty/cards';
import {joinFoundation} from './foundationHelpers';

const port=Number(process.env.PORT??4317);
test.use({baseURL:`http://127.0.0.1:${port+1}`});
type Probe={state:any;sent:any[];received:any[]};
const ready=(page:Page)=>expect(page.locator('.live-surface')).toHaveAttribute('data-foundation-status','ready');

async function gameMaskEvidence(page:Page){return page.evaluate(()=>{
 const lane=document.querySelector<HTMLElement>('[data-foundation-node="decisions"]'),inputs=[...document.querySelectorAll<HTMLButtonElement|HTMLSelectElement>('.live-surface button[data-foundation-zone="hand"],.live-surface [data-foundation-node="decisions"] button,.live-surface [data-foundation-node="decisions"] select')],state=(window as typeof window&{misdealProbe:Probe}).misdealProbe.state;
 const masks=inputs.map(input=>{const ancestors:unknown[]=[];for(let node:HTMLElement|null=input;node?.closest('.live-surface');node=node.parentElement)ancestors.push({node:node.dataset.foundationNode??null,inert:node.inert,aria:node.getAttribute('aria-hidden'),opacity:getComputedStyle(node).opacity});return{disabled:input.disabled,ancestors};});
 return{count:inputs.length,disabled:inputs.every(input=>input.disabled),lane:lane?{aria:lane.getAttribute('aria-hidden'),inert:lane.inert,opacity:getComputedStyle(lane).opacity}:null,masks,native:{version:state?.version,turn:state?.turn,legalCount:Array.isArray(state?.legal)?state.legal.length:null}};
 });}

async function install(page:Page,name:string,speed:'off'|'normal'='off'){
 await page.addInitScript(({name,speed})=>{
  localStorage.setItem('name',JSON.stringify(name));
  localStorage.setItem('mighty.settings',JSON.stringify({sound:false,music:false,haptics:false,speed,hints:false,tips:false}));
  const scope=window as typeof window&{misdealProbe:Probe};scope.misdealProbe={state:null,sent:[],received:[]};
  const Native=WebSocket;
  window.WebSocket=class extends Native{
   constructor(url:string|URL,protocols?:string|string[]){super(url,protocols);this.addEventListener('message',event=>{const message=JSON.parse(String(event.data));scope.misdealProbe.received.push(message);if(message.type==='state')scope.misdealProbe.state=message;});}
   send(data:string|ArrayBufferLike|Blob|ArrayBufferView){if(typeof data==='string')scope.misdealProbe.sent.push(JSON.parse(data));super.send(data);}
  };
 },{name,speed});
}

// Five independent humans keep this transition causal: no bot can bid, pass or
// call a second misdeal while its first public disclosure is being measured.
test('actual public misdeal cards are read-only for peers and expire without replay after resize',async({page,context,request},info)=>{
 test.skip(!['390x844-light','1440x900-dark'].includes(info.project.name),'phone and desktop public-feedback gate');
 test.setTimeout(90000);
 const errors:string[]=[],owned:BrowserContext[]=[],players:Page[]=[page];
 page.on('pageerror',error=>errors.push(error.message));
 try{
  const rules=presetRules('default');rules.misdeal.threshold=8;rules.misdeal.all_points=false;rules.misdeal.window='AllBidding';
  const response=await request.post('/api/games/mighty/rooms',{data:{preset:'default',rules}});expect(response.ok()).toBe(true);const {id}=await response.json();
  for(let seat=0;seat<5;seat++){
   let actor=page;
   if(seat){const isolated=await context.browser()!.newContext({baseURL:`http://127.0.0.1:${port+1}`,viewport:page.viewportSize()??undefined,reducedMotion:'reduce'});owned.push(isolated);actor=await isolated.newPage();actor.on('pageerror',error=>errors.push(error.message));players.push(actor);}
   await install(actor,`공개 검증 ${seat+1}`);await actor.goto(`/r/${id}?foundation=1`);await joinFoundation(actor,{seat});
  }
  // Disable server turns through the actual room editor so no deadline can
  // change the tested transition while a peer is being inspected.
  await page.getByRole('button',{name:'설정',exact:true}).click();
  await page.getByRole('dialog',{name:'설정',exact:true}).getByRole('button',{name:'테이블 설정',exact:true}).click();
  const settings=page.getByRole('dialog',{name:'테이블 설정',exact:true});
  await settings.getByRole('combobox',{name:'턴 시간',exact:true}).selectOption({label:'끔'});
  await settings.getByRole('button',{name:'적용하기',exact:true}).click();await expect(settings).toContainText('적용했어요');
  await settings.getByRole('button',{name:'닫기',exact:true}).click();await page.keyboard.press('Escape');
  for(const actor of players){await ready(actor);const button=actor.getByRole('button',{name:'준비하기',exact:true});if(await button.count())await button.click();}
  await expect(page.getByRole('button',{name:'시작',exact:true})).toBeEnabled();await page.getByRole('button',{name:'시작',exact:true}).click();
  await Promise.all(players.map(actor=>expect.poll(()=>actor.evaluate(()=>!!(window as typeof window&{misdealProbe:Probe}).misdealProbe.state?.view?.phase?.Bidding)).toBe(true)));
  let caller:Page|undefined;
  for(const actor of players){await ready(actor);if(await actor.getByRole('button',{name:'딜미스',exact:true}).isEnabled({timeout:100}).catch(()=>false)){caller=actor;break;}}
  expect(caller,'at least one of five hands must be below the supported threshold').toBeTruthy();
  const peer=players.find(actor=>actor!==caller)!;
  const before=await peer.evaluate(()=>(window as typeof window&{misdealProbe:Probe}).misdealProbe.sent.filter(message=>message.type==='submit').length);
  const started=Date.now();await caller!.getByRole('button',{name:'딜미스',exact:true}).click({timeout:5000});
  await expect.poll(()=>peer.evaluate(()=>(window as typeof window&{misdealProbe:Probe}).misdealProbe.state?.view?.redealt?.why?.Misdeal?.hand?.length??0)).toBe(10);
  const hand=await peer.evaluate(()=>(window as typeof window&{misdealProbe:Probe}).misdealProbe.state.view.redealt.why.Misdeal.hand);
  // These are the dedicated feedback nodes, never the new private hand or an
  // unrelated neutral/card-back landmark. Every disclosed face must be exact.
  const revealed=peer.locator('[data-foundation-node*="feedback-disclosure"][data-foundation-kind="card"]');
  await expect(revealed).toHaveCount(10);
  await expect(revealed.first()).toBeInViewport({ratio:.95,timeout:1500});
  await expect.poll(()=>revealed.first().evaluate(element=>{for(let node:Element|null=element;node;node=node.parentElement){const style=getComputedStyle(node);if(style.display==='none'||style.visibility!=='visible'||Number(style.opacity)===0||node.getAttribute('aria-hidden')==='true'||node.hasAttribute('inert')||node.hasAttribute('hidden'))return false;}return true;}),{timeout:1500}).toBe(true);const visibleAt=Date.now();
  expect(await revealed.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label')))).toEqual(hand.map(cardLabel));
  expect(await revealed.evaluateAll(nodes=>nodes.every(node=>!node.getAttribute('data-foundation-entity')&&!node.getAttribute('data-foundation-activation')&&node.tagName!=='BUTTON'&&!node.querySelector('button')))).toBe(true);
  await peer.screenshot({path:info.outputPath('public-misdeal.png'),fullPage:true});
  await expect(revealed).toHaveCount(0,{timeout:6000});const elapsed=Date.now()-started;
  const visibleDuration=Date.now()-visibleAt;expect(visibleDuration).toBeGreaterThanOrEqual(3500);expect(elapsed).toBeLessThan(6500);
  const size=peer.viewportSize()!;await peer.setViewportSize({width:size.width+12,height:size.height});await ready(peer);await expect(revealed).toHaveCount(0);
  expect(await peer.evaluate(()=>(window as typeof window&{misdealProbe:Probe}).misdealProbe.sent.filter(message=>message.type==='submit').length)).toBe(before);
  expect(errors).toEqual([]);await info.attach('public-misdeal-receipt',{body:JSON.stringify({room:id,profile:info.project.name,elapsed,visibleDuration,publicHand:hand,peerSubmitted:false,errors}),contentType:'application/json'});
 }finally{await Promise.all(owned.map(owned=>owned.close()));}
});


// The caller's pending receipt must not erase presentation ownership. Its one
// originating command is permitted; settlement must never generate another.
for(const audience of ['peer','caller'] as const)test(`a current held fifty-back redeal keeps public disclosure unfocusable until settlement then shows it for four seconds · ${audience}`,async({page,context,request},info)=>{
 test.skip(info.project.name!=='390x844-light','one real phone full-motion disclosure/deal coexistence');test.setTimeout(90000);await page.emulateMedia({reducedMotion:'no-preference'});
 const errors:string[]=[],owned:BrowserContext[]=[],players:Page[]=[page];page.on('pageerror',error=>errors.push(error.message));
 try{
  const rules=presetRules('default');rules.misdeal.threshold=8;rules.misdeal.all_points=false;rules.misdeal.window='AllBidding';
  const response=await request.post('/api/games/mighty/rooms',{data:{preset:'default',rules}});expect(response.ok()).toBe(true);const{id}=await response.json();
  for(let seat=0;seat<5;seat++){
   let actor=page;if(seat){const isolated=await context.browser()!.newContext({baseURL:`http://127.0.0.1:${port+1}`,viewport:{width:390,height:844},reducedMotion:'no-preference'});owned.push(isolated);actor=await isolated.newPage();actor.on('pageerror',error=>errors.push(error.message));players.push(actor);}
   await install(actor,`배분 공개 검증 ${seat+1}`,'normal');await actor.goto(`/r/${id}?foundation=1`);await joinFoundation(actor,{seat});
  }
  await page.getByRole('button',{name:'설정',exact:true}).click();await page.getByRole('dialog',{name:'설정',exact:true}).getByRole('button',{name:'테이블 설정',exact:true}).click();const settings=page.getByRole('dialog',{name:'테이블 설정',exact:true});await settings.getByRole('combobox',{name:'턴 시간',exact:true}).selectOption({label:'끔'});await settings.getByRole('button',{name:'적용하기',exact:true}).click();await expect(settings).toContainText('적용했어요');await settings.getByRole('button',{name:'닫기',exact:true}).click();await page.keyboard.press('Escape');
  for(const actor of players){await ready(actor);const button=actor.getByRole('button',{name:'준비하기',exact:true});if(await button.count())await button.click();}
  await page.getByRole('button',{name:'시작',exact:true}).click();await Promise.all(players.map(actor=>expect.poll(()=>actor.evaluate(()=>!!(window as typeof window&{misdealProbe:Probe}).misdealProbe.state?.view?.phase?.Bidding)).toBe(true)));
  await Promise.all(players.map(async actor=>{await expect(actor.locator('[data-foundation-kind="card"][data-foundation-zone="hand"]')).toHaveCount(10);await ready(actor);await expect(actor.locator('[data-foundation-flight]')).toHaveCount(0,{timeout:10000});await ready(actor);}));
  let callerIndex=-1;await expect.poll(async()=>{for(let index=0;index<players.length;index++)if(await players[index].getByRole('button',{name:'딜미스',exact:true}).isEnabled({timeout:100}).catch(()=>false)){callerIndex=index;return true;}return false;},{timeout:10000}).toBe(true);const caller=players[callerIndex],peer=audience==='caller'?caller:players.find(actor=>actor!==caller)!;
  // Retire the initial deal before arming the hook. The only captured cohort
  // must be created by the subsequent real server Misdeal transition.
  await expect(peer.locator('[data-foundation-flight]')).toHaveCount(0,{timeout:10000});await ready(peer);
  const before=await peer.evaluate(()=>(window as typeof window&{misdealProbe:Probe}).misdealProbe.sent.filter(message=>message.type==='submit').length);
  await peer.evaluate(()=>{
   type Cohort={portal:HTMLElement;animations:Animation[];receivedAt:number;misdeal:boolean};const scope=window as typeof window&{misdealProbe:Probe;heldMisdealCohorts:Cohort[];holdMisdeal:boolean};scope.heldMisdealCohorts=[];scope.holdMisdeal=true;
   const samples:unknown[]=[];(scope as typeof scope&{recollectionSamples:unknown[]}).recollectionSamples=samples;
   const observer=new MutationObserver(()=>{const marker=document.querySelector<HTMLElement>('[data-foundation-recycle]');if(!marker)return;const surface=document.querySelector<HTMLElement>('.live-surface'),cards=[...(surface?.querySelectorAll<HTMLElement>('[data-foundation-zone="hand"][data-foundation-kind="card"]')??[])],art=cards.map(card=>card.firstElementChild),controls=cards.filter((card):card is HTMLButtonElement=>card instanceof HTMLButtonElement);samples.push({at:performance.now(),visible:Number(getComputedStyle(marker).opacity)===1,faces:cards.length,paintHidden:art.every(node=>node instanceof SVGSVGElement&&Number(getComputedStyle(node).opacity)===0),axHidden:cards.every(card=>card.getAttribute('aria-hidden')==='true'),inputsDisabled:controls.every(card=>card.disabled),inputCount:controls.length,label:marker.getAttribute('aria-label')});while(samples.length>64)samples.shift();});observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['style','aria-hidden','disabled']});
   const animate=Element.prototype.animate;Element.prototype.animate=function(...args){const animation=animate.apply(this,args),portal=this.parentElement;if(scope.holdMisdeal&&this instanceof SVGSVGElement&&portal?.hasAttribute('data-foundation-flight')){let cohort=scope.heldMisdealCohorts.find(item=>item.portal===portal);if(!cohort){cohort={portal,animations:[],receivedAt:scope.misdealProbe.received.length,misdeal:!!scope.misdealProbe.state?.view?.redealt?.why?.Misdeal};scope.heldMisdealCohorts.push(cohort);}cohort.animations.push(animation);animation.pause();animation.currentTime=0;}return animation;};
  });
  await caller!.getByRole('button',{name:'딜미스',exact:true}).click({timeout:5000});await expect.poll(()=>peer.evaluate(()=>(window as typeof window&{misdealProbe:Probe}).misdealProbe.state?.view?.redealt?.why?.Misdeal?.hand?.length??0)).toBe(10);
  const portal=peer.locator('[data-foundation-flight]'),revealed=peer.locator('[data-foundation-node*="feedback-disclosure"][data-foundation-kind="card"]');
  await expect(portal.locator(':scope > svg')).toHaveCount(50);await expect(portal.locator('svg[data-card-back]')).toHaveCount(50);await expect(portal.locator('text')).toHaveCount(0);await expect(revealed).toHaveCount(10);
  const cohort=await peer.evaluate(()=>{const scope=window as typeof window&{misdealProbe:Probe;heldMisdealCohorts:{portal:HTMLElement;animations:Animation[];receivedAt:number;misdeal:boolean}[]};const current=scope.heldMisdealCohorts.filter(item=>item.portal.isConnected);return{current:current.length,newest:current[0]===scope.heldMisdealCohorts.at(-1),total:scope.heldMisdealCohorts.length,count:current[0]?.animations.length,misdeal:current[0]?.misdeal,receivedAt:current[0]?.receivedAt,lastReceived:scope.misdealProbe.received.length,paused:current[0]?.animations.every(animation=>animation.playState==='paused'),backs:current[0]?[...current[0].portal.children].every(svg=>svg instanceof SVGSVGElement&&svg.dataset.flightPresentation==='back'&&svg.dataset.flightFromZone==='stock'):false};});
  const recollection=await peer.evaluate(()=>(window as typeof window&{recollectionSamples:{visible:boolean;faces:number;paintHidden:boolean;axHidden:boolean;inputsDisabled:boolean;inputCount:number;label:string}[]}).recollectionSamples);expect(recollection.some(sample=>sample.visible&&sample.faces===10&&sample.paintHidden&&sample.axHidden&&sample.inputsDisabled),'new private faces must remain unpainted/AX-hidden during the actually visible neutral phase before any deal flight').toBe(true);
  expect(cohort).toMatchObject({current:1,newest:true,count:50,misdeal:true,paused:true,backs:true});expect(cohort.receivedAt).toBeGreaterThan(0);expect(cohort.receivedAt).toBeLessThanOrEqual(cohort.lastReceived);
  const publicRoot=revealed.first().locator('xpath=ancestor::*[@aria-hidden][1]');await expect(publicRoot).toHaveAttribute('aria-hidden','true');await expect(publicRoot).toHaveCSS('opacity','0');
  const scroll=publicRoot.locator('[data-foundation-kind="group"][tabindex]');expect(await scroll.evaluateAll(nodes=>nodes.every(node=>(node as HTMLElement).tabIndex===-1))).toBe(true);
  // A fitting fan has no scroll Tab stop. Still prove that even forced native
  // focus cannot enter its hidden viewport, without requiring fake overflow.
  expect(await publicRoot.evaluate(element=>{const target=element.querySelector<HTMLElement>('[data-foundation-kind="group"]')??element as HTMLElement,prior=target.getAttribute('tabindex');try{target.tabIndex=0;target.focus();return target===document.activeElement||target.contains(document.activeElement);}finally{if(prior===null)target.removeAttribute('tabindex');else target.setAttribute('tabindex',prior);}})).toBe(false);
  const heldMask=await gameMaskEvidence(peer);if(heldMask.count){expect(heldMask.disabled).toBe(true);expect(heldMask.lane).toMatchObject({aria:'true',inert:true,opacity:'0'});}
  // The visible lifetime must not run while the actual newest cohort is held.
  await peer.waitForTimeout(4500);await expect(revealed).toHaveCount(10);await expect(publicRoot).toHaveAttribute('aria-hidden','true');await expect(portal.locator(':scope > svg')).toHaveCount(50);
  await peer.screenshot({path:info.outputPath('misdeal-held-fifty-hidden-fan.png'),fullPage:true});
  const localFinished=await portal.evaluate(element=>{const scope=window as typeof window&{heldMisdealCohorts:{portal:HTMLElement;animations:Animation[]}[]},cohort=scope.heldMisdealCohorts.find(item=>item.portal===element);if(!cohort||!element.isConnected||cohort.animations.length!==50||cohort.animations.some(animation=>animation.playState!=='paused'))throw Error('No exact current fifty-card cohort');const local=[...element.querySelectorAll<SVGSVGElement>(':scope > svg[data-flight-to-zone="hand"]')];if(local.length!==10)throw Error('Missing exact ten local flights');for(const art of local){const animation=art.getAnimations()[0];if(!animation)throw Error('Missing owned local animation');animation.finish();}return local.length;});expect(localFinished).toBe(10);
  await expect(portal.locator(':scope > svg')).toHaveCount(40);
  const partial=await gameMaskEvidence(peer);await info.attach('held-game-input-capability',{body:JSON.stringify({heldMask,partial}),contentType:'application/json'});expect(partial.count).toBe(heldMask.count);expect(partial.native.version).toBe(heldMask.native.version);if(heldMask.count){expect(partial.disabled,'local arrival cannot re-enable real game inputs while forty peer flights remain').toBe(true);expect(partial.lane).toMatchObject({aria:'true',inert:true,opacity:'0'});}else expect(partial.count,'a readonly participant has no game-input lease to hide').toBe(0);await expect(publicRoot).toHaveAttribute('aria-hidden','true');
  await portal.evaluate(element=>{const scope=window as typeof window&{holdMisdeal:boolean;heldMisdealCohorts:{portal:HTMLElement;animations:Animation[]}[]},cohort=scope.heldMisdealCohorts.find(item=>item.portal===element);if(!cohort||!element.isConnected||cohort.animations.length!==50)throw Error('No current fifty-card cohort after local arrival');scope.holdMisdeal=false;for(const animation of cohort.animations)if(animation.playState==='paused')animation.play();});
  await expect(portal).toHaveCount(0,{timeout:5000});await expect(revealed.first()).toBeInViewport({ratio:.95,timeout:1500});await expect(publicRoot).toHaveAttribute('aria-hidden','false');
  await expect.poll(()=>revealed.first().evaluate(element=>{for(let node:Element|null=element;node;node=node.parentElement){const css=getComputedStyle(node);if(css.display==='none'||css.visibility!=='visible'||Number(css.opacity)===0||node.getAttribute('aria-hidden')==='true'||node.hasAttribute('inert')||node.hasAttribute('hidden'))return false;}return true;}),{timeout:1500}).toBe(true);const visibleAt=Date.now();
  const hand=await peer.evaluate(()=>(window as typeof window&{misdealProbe:Probe}).misdealProbe.state.view.redealt.why.Misdeal.hand);expect(await revealed.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label')))).toEqual(hand.map(cardLabel));expect(await revealed.evaluateAll(nodes=>nodes.every(node=>!node.getAttribute('data-foundation-entity')&&!node.getAttribute('data-foundation-activation')&&node.tagName!=='BUTTON'&&!node.querySelector('button')))).toBe(true);
  await peer.screenshot({path:info.outputPath('misdeal-fan-after-current-cohort-arrival.png'),fullPage:true});await expect(revealed).toHaveCount(0,{timeout:6000});const visibleDuration=Date.now()-visibleAt;expect(visibleDuration).toBeGreaterThanOrEqual(3500);expect(visibleDuration).toBeLessThan(6000);
  await peer.setViewportSize({width:402,height:844});await ready(peer);await expect(revealed).toHaveCount(0);const submitted=await peer.evaluate(()=>(window as typeof window&{misdealProbe:Probe}).misdealProbe.sent.filter(message=>message.type==='submit'));expect(submitted).toHaveLength(before+(audience==='caller'?1:0));if(audience==='caller')expect(submitted.slice(before).map(message=>message.action)).toEqual(['Misdeal']);expect(errors).toEqual([]);
  await info.attach('held-public-misdeal-receipt',{body:JSON.stringify({room:id,audience,cohort,recollection,heldMask,partial,visibleDuration,originatingCommands:audience==='caller'?1:0,additionalSubmitted:false,publicHand:hand,errors}),contentType:'application/json'});
 }catch(error){
  const diagnostic=await Promise.all(players.map(async(actor,index)=>({index,...await actor.evaluate(()=>{
   const host=document.querySelector<HTMLElement>('.live-surface'),scope=window as typeof window&{heldMisdealCohorts?:{portal:HTMLElement;animations:Animation[]}[];recollectionSamples?:unknown[];misdealProbe?:Probe};
   return{timeline:scope.misdealProbe?.received.filter(message=>['state','room','room_command_window'].includes(message.type)).slice(-24).map(message=>message.type==='state'?{type:'state',version:message.version,roomVersion:message.room_version,scope:message.command?.scope,phase:typeof message.view?.phase==='object'?Object.keys(message.view.phase):message.view?.phase,counts:message.view?.hand_sizes,redealt:message.view?.redealt?{count:message.view.redealt.count,why:typeof message.view.redealt.why==='object'?Object.keys(message.view.redealt.why):message.view.redealt.why,seat:message.view.redealt.why?.Misdeal?.seat}:null}:message.type==='room_command_window'?{type:message.type,scope:message.command?.scope}:{type:'room',version:message.room_version,session:message.session_id,handsPlayed:message.hands_played,showing:message.showing,inHand:message.in_hand,participants:message.participant_ids}),host:host?{...host.dataset}:null,cohorts:scope.heldMisdealCohorts?.map(item=>({connected:item.portal.isConnected,count:item.animations.length,states:item.animations.map(animation=>animation.playState)})),recollection:scope.recollectionSamples,scroll:{x:scrollX,y:scrollY},flight:document.querySelector('[data-foundation-flight]')?.children.length??0,recycle:[...document.querySelectorAll<HTMLElement>('[data-foundation-recycle]')].map(node=>({label:node.getAttribute('aria-label'),opacity:getComputedStyle(node).opacity})),cards:host?.querySelectorAll('[data-foundation-zone="hand"][data-foundation-kind="card"]').length};
  }).catch(reason=>({readError:String(reason)}))})));
  await writeFile(info.outputPath('held-misdeal-failure-diagnostic.json'),JSON.stringify({diagnostic,errors},null,2));
  await info.attach('held-misdeal-failure-diagnostic',{body:JSON.stringify({diagnostic,errors}),contentType:'application/json'});
  for(const[index,actor]of players.entries())await actor.screenshot({path:info.outputPath(`held-misdeal-failure-${index}.png`),fullPage:true});throw error;
 }finally{await Promise.all(owned.map(owned=>owned.close()));}
});
