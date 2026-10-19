import { expect, test, type Page } from '@playwright/test';
import {bidMaximum} from './drive-deal';

const port = Number(process.env.PORT ?? 4317);
test.use({ baseURL: `http://127.0.0.1:${port + 1}`, reducedMotion: 'no-preference' });
const preferences = (name: string) => ({name, settings: {speed:'normal',sound:false,music:false,singleTap:false}});
async function init(page: Page, name: string) {
  await page.addInitScript(({name,settings}) => {localStorage.setItem('name', JSON.stringify(name)); localStorage.setItem('mighty.settings', JSON.stringify(settings));}, preferences(name));
}
async function create(page: Page) {
  await page.goto('/');
  await page.getByRole('button', {name:'테이블 만들기',exact:true}).click();
  await page.waitForURL(/\/r\/[a-z0-9]+$/);
  await page.getByRole('button',{name:'빈자리에 앉기',exact:true}).click();
}
async function finish(page: Page) {
  await bidMaximum(page);
  for(let i=0;i<3;i++) await page.locator('.hand button.card:not(.picked):not(.unplayable)').last().press('Enter');
  await page.getByRole('button',{name:'버리기',exact:true}).click();
  await page.getByRole('button',{name:/^프렌드 /}).click();
  for(let left=10;left>0;left--) {
    await expect(page.locator('.side .turn-line strong')).toHaveText('내 차례',{timeout:15_000});
    const card=page.locator('.hand button.card:not(.unplayable)').first();
    await card.press('Enter'); await card.press('Enter');
    const variants=page.locator('.variants .chip'); if(await variants.count()) await variants.first().click();
    await expect(page.locator('.hand .card')).toHaveCount(left-1);
  }
  await expect(page.locator('.result')).toBeVisible({timeout:15_000});
}
async function replayLast(page: Page, originalName?: string) {
  await page.getByRole('button',{name:'메뉴',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'이번 판 다시 보기',exact:true}).click();
  const replay=page.getByRole('dialog',{name:'더보기',exact:true});
  await expect(replay).toBeVisible();
  if(originalName) { await expect(replay.locator('.plays')).toContainText(originalName); await expect(replay.locator('.plays')).not.toContainText('수연'); }
  for(let i=0;i<9;i++) await replay.getByRole('button',{name:'다음 라운드',exact:true}).click();
  await expect(replay.locator('.stepper')).toContainText('10/10');
  await replay.getByRole('button',{name:'현재 테이블로 돌아가기',exact:true}).click();
}

test('an empty-room observer can select, confirm and start without scrolling',async({page},info)=>{
  await init(page,'참여 검증');
  await page.setExtraHTTPHeaders({'X-Forwarded-For':`192.0.2.${info.workerIndex + 150}`});
  await page.goto('/');
  await page.getByRole('button',{name:'테이블 만들기',exact:true}).click();
  await page.waitForURL(/\/r\/[a-z0-9]+$/);
  const lane=page.locator('.participation-area');
  const join=lane.getByRole('button',{name:'빈자리에 앉기',exact:true});
  await expect(join).toBeVisible();
  const withinViewport=async()=>expect(await lane.locator('button').evaluateAll(nodes=>nodes.every(e=>{
    const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth;
  }))).toBe(true);
  await withinViewport();
  await page.locator('.seat-act').first().click();
  const confirm=lane.getByRole('button',{name:'이 자리에서 참여',exact:true});
  await expect(confirm).toBeVisible();await withinViewport();
  expect(await page.evaluate(()=>scrollY)).toBe(0);
  await confirm.click();
  await expect(page.locator('.seat-act',{hasText:'봇 추가'})).toHaveCount(4);
  for(let i=0;i<4;i++) await page.locator('.seat-act',{hasText:'봇 추가'}).first().click();
  await page.getByRole('button',{name:'시작',exact:true}).click();
  await expect(page.locator('.hand .card')).toHaveCount(10);
});

test('a current-hand result has one continuation and no history/session ceremony', async ({page}) => {
  await page.goto('/preview?state=done&room');
  await expect(page.locator('.result')).toBeVisible();
  await expect(page.locator('.result table')).toHaveCount(0);
  await expect(page.locator('.result .primary')).toHaveCount(1);
  await expect(page.getByRole('button',{name:/모임 마치기|판 기록|새 모임/})).toHaveCount(0);
  await expect(page.getByRole('button',{name:/^(테이블 보기|결과 다시 보기)$/})).toHaveCount(0);
  await expect(page.locator('.finished-hands .hands > li')).toHaveCount(5);
  await expect(page.locator('.result .summary')).toBeVisible();
  await page.getByRole('button',{name:'더보기',exact:true}).click();
  const details=page.getByRole('dialog',{name:'더보기',exact:true});
  await details.getByRole('radio',{name:'점수·교환',exact:true}).click();
  await expect(details).toContainText('주공이 버린 카드');
  await page.keyboard.press('Escape');
  await expect(page.locator('.result .summary')).toBeVisible();
});

test('a live observer reserves a bot and joins between hands without inheriting its result', async ({page,browser},info) => {
  test.skip(info.project.name !== '1440x900-dark','one real-server flow with full client motion');
  test.setTimeout(120_000);
  await page.setExtraHTTPHeaders({'X-Forwarded-For': `192.0.2.${info.workerIndex + 80}`});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await init(page,'검증'); await create(page);
  for(let i=0;i<4;i++) await page.locator('.seat-act',{hasText:'봇 추가'}).first().click();
  await page.getByRole('button',{name:'시작',exact:true}).click();
  await expect(page.locator('.hand .card')).toHaveCount(10);
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  const watcher=await context.newPage();await init(watcher,'수연');await watcher.goto(page.url());
  const twin=await context.newPage();await twin.goto(page.url());
  await expect(page.getByRole('button',{name:/관전자\s+1\s*명/})).toBeVisible();
  const originalBot = await watcher.locator('.me-seat .name').innerText();
  await watcher.locator('.participation-area').getByRole('button',{name:'다음 판 참여',exact:true}).click();
  await expect(watcher.locator('.participation-area')).toContainText('다음 판부터');
  await watcher.locator('.participation-area').getByRole('button',{name:'참여 취소',exact:true}).click();
  await expect(watcher.locator('.participation-area').getByRole('button',{name:'다음 판 참여',exact:true})).toBeVisible();
  await watcher.locator('.participation-area').getByRole('button',{name:'다음 판 참여',exact:true}).click();
  await expect(watcher.locator('.hand .card')).toHaveCount(0);
  await finish(page);
  await expect(page.locator('.result .primary')).toBeDisabled();
  await watcher.locator('.participation-area').getByRole('button',{name:'앉아서 다음 판 준비',exact:true}).click();
  await expect(watcher.locator('.me-seat .name')).toHaveText('수연');
  await expect(watcher.locator('.result .summary')).toContainText('다음 판부터 참여해요');
  await expect(watcher.locator('.result .summary strong')).toHaveCount(0);
  await expect(watcher.locator('.hand .card')).toHaveCount(0);
  await expect(twin.locator('.participation-area')).toBeVisible();
  await replayLast(watcher,originalBot);
  await page.getByRole('button',{name:'메뉴',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'점수 초기화',exact:true}).click();
  await page.getByRole('dialog',{name:'누적 점수를 초기화할까요?'}).getByRole('button',{name:'점수 초기화',exact:true}).click();
  await expect(page.locator('.side .total')).toHaveText(['0','0','0','0','0']);
  await replayLast(page);
  await page.reload(); await expect(page.locator('.me-seat .name')).toHaveText('검증');
  await replayLast(page);
  await page.locator('.result .primary').click();
  await watcher.locator('.result .primary').click();
  await expect(page.getByRole('button',{name:'다음 판',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'다음 판',exact:true}).click();
  await expect(watcher.locator('.hand .card')).toHaveCount(10);
  await expect(page.locator('.hand .card')).toHaveCount(10);
  expect(errors).toEqual([]);await context.close();
});

test('five humans offer and accept a seat explicitly without silent displacement',async ({page,browser},info)=>{
  test.skip(info.project.name !== '1440x900-dark','one multi-context human handoff');
  test.setTimeout(60_000);
  await page.setExtraHTTPHeaders({'X-Forwarded-For': `192.0.2.${info.workerIndex + 100}`});
  await init(page,'기존');await create(page);const url=page.url();
  const contexts=[];
  const players:Page[]=[];
  for(const name of ['민수','호두','단추','보리']) {
    const context=await browser.newContext({viewport:{width:1440,height:900}});contexts.push(context);
    const player=await context.newPage();players.push(player);await init(player,name);await player.goto(url);
    await player.getByRole('button',{name:'빈자리에 앉기',exact:true}).click();
    await expect(player.locator('.me-seat .name')).toHaveText(name);
  }
  const incomingContext=await browser.newContext({viewport:{width:1440,height:900}});contexts.push(incomingContext);
  const incoming=await incomingContext.newPage();await init(incoming,'수연');await incoming.goto(url);
  await incoming.locator('.participation-area').getByRole('button',{name:'다음 판 참여',exact:true}).click();
  await expect(incoming.locator('.participation-area')).toContainText('1번째');
  const outgoing=players[0]; // Seat 1 differs from the observer's existing bottom seat 0.
  await outgoing.locator('.watching').click();
  const handoff=outgoing.getByRole('dialog',{name:'함께 있는 사람'});
  await handoff.getByRole('button',{name:'다음 판 쉬기',exact:true}).click();
  await expect(outgoing.locator('.me-seat .name')).toHaveText('민수');
  await handoff.getByRole('button',{name:'자리 양보 취소',exact:true}).click();
  await expect(incoming.locator('.participation-area')).toContainText('자리 양보 기다리는 중');
  await handoff.getByRole('button',{name:'다음 판 쉬기',exact:true}).click();
  const bottomName=await incoming.locator('.me-seat .name').innerText();
  await incoming.locator('.participation-area').getByRole('button',{name:'앉아서 다음 판 준비',exact:true}).click();
  await expect(incoming.getByRole('button',{name:'이 자리에서 참여',exact:true})).toBeVisible();
  await expect(incoming.locator('.me-seat .name')).toHaveText('민수');
  await incoming.locator('.participation-area').getByRole('button',{name:'취소',exact:true}).click();
  await expect(incoming.locator('.me-seat .name')).toHaveText(bottomName);
  await expect(outgoing.locator('.me-seat .name')).toHaveText('민수');
  await incoming.locator('.participation-area').getByRole('button',{name:'앉아서 다음 판 준비',exact:true}).click();
  await incoming.getByRole('button',{name:'이 자리에서 참여',exact:true}).click();
  await expect(incoming.locator('.me-seat .name')).toHaveText('수연');
  await expect(outgoing.locator('.participation-area')).toContainText('관전 중');
  await expect(incoming.locator('.side .score-rows')).not.toContainText('민수');
  await expect(incoming.locator('.side .score-rows')).toContainText('수연');
  await incoming.reload();
  await expect(incoming.locator('.me-seat .name')).toHaveText('수연');
  await outgoing.reload();
  await expect(outgoing.locator('.participation-area')).toContainText('관전 중');
  await expect(incoming.locator('.me-seat .name')).toHaveText('수연');
  for(const context of contexts) await context.close();
});

test('a newly mounted result rejects the prior card click for 400ms with motion off', async ({page},info) => {
  test.skip(info.project.name !== '390x844-dark','one controlled clock for result-entry input safety');
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 60_000));
  await page.addInitScript(() => localStorage.setItem('mighty.settings', JSON.stringify({speed:'off',sound:false,music:false})));
  await page.goto('/preview?state=done&room');
  const next=page.locator('.result .primary');
  await expect(next).toHaveText('다음 판');
  await expect(next).toBeDisabled();
  // HTMLElement.click models the trailing activation against the replaced
  // card region; native disabled semantics must suppress it without motion.
  await next.evaluate(button => (button as HTMLButtonElement).click());
  await expect(page.locator('.result')).toBeVisible();
  await expect(page.locator('.hand .card')).toHaveCount(0);
  await page.clock.runFor(399);
  await expect(next).toBeDisabled();
  await page.clock.runFor(1);
  await expect(next).toBeEnabled();
  await next.click();
});
