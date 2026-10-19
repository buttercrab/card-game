import {expect,test} from '@playwright/test';
import {presetRules} from '../src/lib/games/mighty/catalog';
import {foundationBotButton,joinFoundation} from './foundationHelpers';
const port=Number(process.env.PORT??4317);test.use({baseURL:`http://127.0.0.1:${port+1}`,reducedMotion:'no-preference'});
for(const textScale of [1,2])test(`real server deadline at ${textScale}x paints monotonically without authority-frame churn and emits each last-second tick once`,async({page,request},info)=>{
 test.skip(info.project.name!=='1440x900-dark','one actual deadline/audio-graph lifecycle');test.setTimeout(45000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(({textScale})=>{
  localStorage.setItem('name',JSON.stringify('시간 검증'));localStorage.setItem('mighty.settings',JSON.stringify({sound:true,volume:.1,music:false,haptics:false,speed:'off',hints:false,tips:false,textScale}));
  const scope=window as typeof window&{clockSources:{duration:number;at:number}[]};scope.clockSources=[];
  // Exercise native Web Audio scheduling while disconnecting all audible output.
  const connect=AudioNode.prototype.connect;AudioNode.prototype.connect=function(destination:AudioNode|AudioParam,...args:unknown[]){if(destination instanceof AudioDestinationNode)return destination;return (connect as (...values:unknown[])=>AudioNode).call(this,destination,...args);} as typeof connect;
  const create=AudioContext.prototype.createBufferSource;AudioContext.prototype.createBufferSource=function(){const source=create.call(this),start=source.start;source.start=function(...args:Parameters<AudioBufferSourceNode['start']>){scope.clockSources.push({duration:args[2]??0,at:performance.now()});return start.apply(this,args);};return source;};
 },{textScale});
 const response=await request.post('/api/games/mighty/rooms',{data:{preset:'default',rules:(()=>{const rules=presetRules('default');rules.misdeal.threshold=-128;rules.misdeal.all_points=false;return rules;})()}});const {id}=await response.json();await page.goto(`/r/${id}?foundation=1`);await joinFoundation(page);
 await page.getByRole('button',{name:'설정',exact:true}).click();await page.getByRole('dialog',{name:'설정',exact:true}).getByRole('button',{name:'테이블 설정',exact:true}).click();const settings=page.getByRole('dialog',{name:'테이블 설정',exact:true});await settings.getByRole('combobox',{name:'턴 시간',exact:true}).selectOption({label:'20초'});await settings.getByRole('button',{name:'적용하기',exact:true}).click();await expect(settings).toContainText('적용했어요');await settings.getByRole('button',{name:'닫기',exact:true}).click();await page.keyboard.press('Escape');
 for(let index=0;index<4;index++){await foundationBotButton(page).click();if(index<3)await expect(foundationBotButton(page)).toBeEnabled();}
 await page.getByRole('button',{name:'시작',exact:true}).click();await expect(page.getByRole('button',{name:'패스',exact:true})).toBeEnabled({timeout:15000});
 const surface=page.locator('.live-surface'),seconds=page.locator('[data-foundation-node="identity-figure"] [data-clock-seconds]'),ring=page.locator('[data-foundation-node="identity-figure"] [data-clock-ring]');
 await expect(seconds).toHaveText('5',{timeout:30000});await seconds.scrollIntoViewIfNeeded();await expect(page.locator('[data-foundation-node="identity-figure"]')).toBeInViewport({ratio:1});
 const glyph=await seconds.evaluate(element=>{const text=element as SVGTextElement,box=text.getBBox(),matrix=text.getScreenCTM()!,viewport=text.ownerSVGElement!.getBoundingClientRect();const corners=[[box.x,box.y],[box.x+box.width,box.y],[box.x,box.y+box.height],[box.x+box.width,box.y+box.height]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(matrix));return {font:parseFloat(getComputedStyle(text).fontSize),left:Math.min(...corners.map(point=>point.x)),top:Math.min(...corners.map(point=>point.y)),right:Math.max(...corners.map(point=>point.x)),bottom:Math.max(...corners.map(point=>point.y)),viewport:{left:viewport.left,top:viewport.top,right:viewport.right,bottom:viewport.bottom}};});
 expect(glyph.font).toBe(20*textScale);expect(glyph.left).toBeGreaterThanOrEqual(glyph.viewport.left-.5);expect(glyph.top).toBeGreaterThanOrEqual(glyph.viewport.top-.5);expect(glyph.right).toBeLessThanOrEqual(glyph.viewport.right+.5);expect(glyph.bottom).toBeLessThanOrEqual(glyph.viewport.bottom+.5);
 const before=await surface.getAttribute('data-foundation-frame'),first=Number(await ring.getAttribute('stroke-dashoffset'));
 const ticks=()=>page.evaluate(()=>(window as typeof window&{clockSources:{duration:number;at:number}[]}).clockSources.filter(source=>Math.abs(source.duration-.054)<.000001));
 await expect.poll(async()=>(await ticks()).length).toBe(1);await expect(seconds).toHaveText('4');expect(await surface.getAttribute('data-foundation-frame')).toBe(before);const second=Number(await ring.getAttribute('stroke-dashoffset'));expect(second).toBeGreaterThan(first);await expect.poll(async()=>(await ticks()).length).toBe(2);
 await page.setViewportSize({width:1420,height:900});await expect(surface).toHaveAttribute('data-foundation-status','ready');await expect.poll(async()=>Number(await ring.getAttribute('stroke-dashoffset'))).toBeGreaterThanOrEqual(second);await expect(seconds).toHaveText('3');await expect.poll(async()=>(await ticks()).length).toBe(3);expect(errors).toEqual([]);
 // Native scheduling evidence, not an audibility or hardware haptics claim.
 await test.info().attach('clock-sources',{body:JSON.stringify(await ticks()),contentType:'application/json'});
});
