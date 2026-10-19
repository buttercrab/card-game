import {writeFile} from 'node:fs/promises';
import {expect,test} from '@playwright/test';
import {foundationBotButton, joinFoundation, openFoundationPeople } from './foundationHelpers';
const port=Number(process.env.PORT??4317);
test.use({baseURL:`http://127.0.0.1:${port+1}`});
test('real poker shares the connected engine, raises exact amounts and settles another independent hand',async({page,request},info)=>{
 test.skip(info.project.name!=='390x844-light','one real Poker lifecycle');test.setTimeout(90000);
 await page.addInitScript(()=>{localStorage.setItem('name',JSON.stringify('포커 검증'));localStorage.setItem('mighty.settings',JSON.stringify({sound:false,music:false,speed:'off'}));});
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));const sent:unknown[]=[];
 page.on('websocket',socket=>socket.on('framesent',frame=>{const value=JSON.parse(String(frame.payload));if(value.type==='submit')sent.push(value.action);}));
 const response=await request.post('/api/games/poker/rooms',{data:{preset:'holdem'}});expect(response.ok()).toBe(true);const {id}=await response.json();
 await page.goto(`/r/${id}?foundation=1`);await expect(page.locator('[data-live-status]')).toHaveAttribute('data-live-status','open');
 await joinFoundation(page);
 for(let index=0;index<2;index++){await foundationBotButton(page).click();if(index===0)await expect(foundationBotButton(page)).toBeEnabled();}
 await page.getByRole('button',{name:'시작',exact:true}).click();
 const hand=page.locator('.live-surface [data-foundation-kind="card"][data-foundation-zone="hand"]');await expect(hand).toHaveCount(2);
 const amount=page.getByRole('combobox',{name:'레이즈 후 이번 스트리트 총액',exact:true});await expect(amount.locator('option')).toHaveCount(97);await amount.selectOption('10');
 await page.getByRole('button',{name:'확정 레이즈 총 10',exact:true}).click();
 await expect.poll(()=>sent.some(action=>JSON.stringify(action)===JSON.stringify({type:'raise_to',amount:10}))).toBe(true);
 const result=page.getByRole('group',{name:'이번 판 결과',exact:true});
 await expect(async()=>{
  if(await result.count())return;
  const call=page.getByRole('button',{name:/^콜 \d+$/}),check=page.getByRole('button',{name:'체크',exact:true});
  if(await check.isEnabled({timeout:100}).catch(()=>false))await check.click({timeout:1000});
  else if(await call.isEnabled({timeout:100}).catch(()=>false))await call.click({timeout:1000});
  await expect(result).toHaveCount(1);
 }).toPass({timeout:45000,intervals:[100]});
 await expect(page.getByRole('button',{name:'새 독립 판',exact:true})).toBeEnabled();
 await page.screenshot({path:'/tmp/foundation-poker-real-result.png',fullPage:true});
 const before=sent.length;await page.reload();await expect(result).toHaveCount(1);expect(sent.length).toBe(before);
 await page.getByRole('button',{name:'새 독립 판',exact:true}).click();await expect(hand).toHaveCount(2);expect(errors).toEqual([]);
});

test('a replacement Poker occupant receives only public settled cards while original reclaim retains its own cards',async({page,request,browser},info)=>{
 test.skip(info.project.name!=='390x844-light','one real settled privacy lifecycle');test.setTimeout(90000);
 await page.addInitScript(()=>{localStorage.setItem('name',JSON.stringify('원래 참가자'));localStorage.setItem('mighty.settings',JSON.stringify({sound:false,music:false,speed:'off'}));});
 let room:any=null,state:any=null;const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 page.on('websocket',socket=>socket.on('framereceived',frame=>{const message=JSON.parse(String(frame.payload));if(message.type==='room')room=message;if(message.type==='state')state=message;}));
 const response=await request.post('/api/games/poker/rooms',{data:{preset:'holdem'}});expect(response.ok()).toBe(true);const{id}=await response.json();await page.goto(`/r/${id}?foundation=1`);await joinFoundation(page,{seat:0});
 for(let index=0;index<2;index++){await foundationBotButton(page).click();if(index===0)await expect(foundationBotButton(page)).toBeEnabled();}
 await page.getByRole('button',{name:'시작',exact:true}).click();await expect(page.getByRole('button',{name:'폴드',exact:true})).toBeEnabled();await page.getByRole('button',{name:'폴드',exact:true}).click();
 const result=page.getByRole('group',{name:'이번 판 결과',exact:true});await expect(result).toBeVisible({timeout:45000});expect(state.view.players[0].folded).toBe(true);expect(state.view.players[0].shown).toBe(false);expect(state.view.players[0].hole).toHaveLength(2);
 const originalId=room.participant_ids[0];await page.reload();await expect(result).toBeVisible();await expect.poll(()=>state?.view?.viewer).toBe(0);expect(state.view.players[0].hole).toHaveLength(2);
 const people=await openFoundationPeople(page);await people.locator(`[data-foundation-node='${JSON.stringify(['room-person',originalId])}']`).getByRole('button',{name:'관리',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'관전으로 전환',exact:true}).click();await expect.poll(()=>room.seats[0].kind).toBe('empty');
 const replacementContext=await browser.newContext({baseURL:`http://127.0.0.1:${port+1}`}),replacement=await replacementContext.newPage();let latest:any=null,replacementRoom:any=null;const packets:any[]=[];
 try{
  await replacement.addInitScript(()=>{localStorage.setItem('name',JSON.stringify('새 참가자'));localStorage.setItem('mighty.settings',JSON.stringify({sound:false,music:false,speed:'off'}));});
  replacement.on('pageerror',error=>errors.push(error.message));replacement.on('websocket',socket=>socket.on('framereceived',frame=>{const message=JSON.parse(String(frame.payload));if(message.type==='room')replacementRoom=message;if(message.type==='state'){latest=message;packets.push(message);}}));
  await replacement.goto(`/r/${id}?foundation=1`);await joinFoundation(replacement,{seat:0});await expect(replacement.getByRole('group',{name:'이번 판 결과',exact:true})).toBeVisible();await expect.poll(()=>replacementRoom?.seats?.[0]?.name).toBe('새 참가자');expect(replacementRoom.participant_ids[0]).not.toBe(originalId);await expect.poll(()=>latest?.view?.viewer).toBeNull();
  expect(packets.length).toBeGreaterThan(0);expect(packets.every(packet=>packet.view.players.every((player:any)=>player.hole===null||player.shown))).toBe(true);expect(latest.view.players[0].hole).toBeNull();expect(latest.legal).toEqual([]);expect(latest.out_of_turn).toEqual([]);expect(latest.command??null).toBeNull();await expect(replacement.locator('.live-surface [data-foundation-kind="card"][data-foundation-zone="hand"]')).toHaveCount(0);
  await replacement.reload();await expect(replacement.getByRole('group',{name:'이번 판 결과',exact:true})).toBeVisible();expect(latest.view.viewer).toBeNull();expect(latest.view.players[0].hole).toBeNull();expect(errors).toEqual([]);
  await writeFile(info.outputPath('settled-privacy.json'),JSON.stringify({originalReclaimPrivate:true,replacementActorDifferent:true,receivedStates:packets.length,everyPacketPublic:packets.every(packet=>packet.view.players.every((player:any)=>player.hole===null||player.shown)),noPrivateHand:true,replacementReloadPublic:true,errors},null,2));await replacement.screenshot({path:info.outputPath('settled-replacement.png'),fullPage:true});
 }finally{await replacementContext.close();}
});
