import { expect, test, type Page } from '@playwright/test';

async function ready(page:Page){await expect(page.locator('.foundation-surface')).toHaveAttribute('data-foundation-status','ready');}
async function open(page:Page){await page.goto('/preview?foundation=1');await ready(page);}
const nodes=(page:Page)=>page.locator('[data-foundation-node]');

test('measured child footprints remain contained across resize, long names, large text and forty cards',async({page},info)=>{
  test.skip(info.project.name!=='1440x900-dark','one retained surface through all physical layouts');
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await open(page);
  await page.getByRole('button',{name:'긴 이름',exact:true}).click();await ready(page);
  await page.getByRole('button',{name:'큰 글자',exact:true}).click();await ready(page);
  await page.getByRole('button',{name:'40장',exact:true}).click();await ready(page);
  for(const [width,height]of [[320,568],[390,844],[568,320],[768,1024],[1024,768],[1440,900],[898,700],[390,844]]){
    await page.setViewportSize({width,height});await ready(page);
    await expect.poll(()=>page.locator('.foundation-surface').evaluate(surface=>{const root=surface.querySelector('[data-foundation-node="table"]');return root?Math.abs(root.getBoundingClientRect().width-surface.clientWidth):Infinity;})).toBeLessThanOrEqual(.1);
    const failures=await nodes(page).evaluateAll(elements=>{
      const failures:string[]=[];
      for(const element of elements){
        const box=element.getBoundingClientRect(),parent=element.parentElement!;
        if(!parent.hasAttribute('data-foundation-node'))continue;
        const bounds=parent.getBoundingClientRect();
        const scrollFan=getComputedStyle(parent).overflowX==='auto'&&element.getAttribute('data-foundation-arrangement')==='fan';
        if(box.top<bounds.top-.5||box.bottom>bounds.bottom+.5||!scrollFan&&(box.left<bounds.left-.5||box.right>bounds.right+.5))failures.push(`outside:${element.getAttribute('data-foundation-node')}`);
        if(parent.getAttribute('data-foundation-arrangement')==='fan')continue;
        for(const other of [...parent.children]){
          if(other===element||!other.hasAttribute('data-foundation-node'))continue;
          const b=other.getBoundingClientRect();
          if(Math.min(box.right,b.right)-Math.max(box.left,b.left)>.5&&Math.min(box.bottom,b.bottom)-Math.max(box.top,b.top)>.5)failures.push(`overlap:${element.getAttribute('data-foundation-node')}`);
        }
      }
      const figure=elements.find(e=>e.getAttribute('data-foundation-node')==='identity-figure')!.getBoundingClientRect();
      const tray=elements.find(e=>e.getAttribute('data-foundation-node')==='dock')!.getBoundingClientRect();
      if(figure.top<tray.top+7)failures.push('figure-crosses-rim');
      return failures;
    });
    expect(failures,`${width}x${height}`).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await expect(page.locator('[data-foundation-kind="card"][data-foundation-zone="hand"][data-foundation-entity]:not([data-foundation-entity=""])')).toHaveCount(40);
    await expect(page.locator('[data-foundation-node="identity-name"]')).toContainText('긴 이름');
  }
  await expect(page.locator('[data-foundation-probe]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('native choices repair a coupled bid and submit only its committed exact command',async({page})=>{
  await open(page);await page.getByRole('button',{name:'제한된 선택지',exact:true}).click();await ready(page);
  const counts=page.getByRole('radiogroup',{name:'공약 수',exact:true});
  const twenty=counts.getByRole('radio',{name:'20',exact:true});
  await twenty.click();await ready(page);
  await expect(page.getByRole('radiogroup',{name:'기루다',exact:true}).getByRole('radio',{name:'노기루다',exact:true})).toHaveAttribute('aria-checked','true');
  await expect(page.locator('[data-foundation-action]')).toHaveText('');
  const submit=page.getByRole('button',{name:'공약 노기루다 20',exact:true});await submit.scrollIntoViewIfNeeded();
  const hit=await submit.evaluate(e=>{const b=e.getBoundingClientRect(),hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return hit===e||!!hit&&e.contains(hit);});expect(hit).toBe(true);
  await submit.click();await expect(page.locator('[data-foundation-action]')).toHaveText('{"Bid":{"trump":null,"count":20}}');
  await expect(submit).toBeDisabled();
  await page.getByRole('button',{name:'분리',exact:true}).click();await expect(nodes(page)).toHaveCount(0);
  await page.getByRole('button',{name:'다시 연결',exact:true}).click();await ready(page);
  await expect(page.getByRole('button',{name:'공약 노기루다 20',exact:true})).toBeDisabled();
});

test('held Space and detached controls cannot cross resize, offer replacement or remount',async({page})=>{
  await open(page);
  const pass=page.getByRole('button',{name:'패스',exact:true});await pass.scrollIntoViewIfNeeded();await pass.focus();await page.keyboard.down('Space');
  const original=page.viewportSize()!;await page.setViewportSize({width:original.width===390?768:390,height:844});await ready(page);await page.keyboard.up('Space');
  await expect(page.locator('[data-foundation-action]')).toHaveText('');
  const detached=await pass.elementHandle();
  await page.getByRole('button',{name:'분리',exact:true}).click();await expect(nodes(page)).toHaveCount(0);
  await page.getByRole('button',{name:'다시 연결',exact:true}).click();await ready(page);
  await detached!.evaluate(e=>{document.querySelector('.foundation-surface')!.append(e);(e as HTMLButtonElement).click();e.remove();});
  await expect(page.locator('[data-foundation-action]')).toHaveText('');
  await page.getByRole('button',{name:'새 선택지',exact:true}).click();await ready(page);
  const current=page.getByRole('button',{name:'패스',exact:true});await current.scrollIntoViewIfNeeded();await current.press('Enter');
  await expect(page.locator('[data-foundation-action]')).toHaveText('"Pass"');
});

test('keyboard navigation, revocation and explicit non-fit remain usable',async({page})=>{
  await open(page);const counts=page.getByRole('radiogroup',{name:'공약 수',exact:true});
  const first=counts.getByRole('radio',{name:'14',exact:true}),next=counts.getByRole('radio',{name:'15',exact:true});
  await first.focus();await first.press('ArrowRight');await ready(page);await expect(next).toBeFocused();await expect(next).toHaveAttribute('aria-checked','true');
  await next.press('ArrowLeft');await ready(page);await expect(first).toBeFocused();await expect(first).toHaveAttribute('aria-checked','true');
  await page.locator('.foundation-surface').evaluate(e=>(e as HTMLElement).style.width='100px');
  await expect(page.locator('.foundation-surface')).toHaveAttribute('data-foundation-status','fallback');await expect(page.locator('.foundation-surface').getByRole('status')).toContainText('창을 넓혀');
  await page.locator('.foundation-surface').evaluate(e=>(e as HTMLElement).style.width='');await ready(page);
  await expect(page.locator('.foundation-surface').getByRole('status')).toHaveCount(0);
  await page.getByRole('button',{name:'권한 해제',exact:true}).click();await expect(nodes(page)).toHaveCount(0);await expect(page.locator('[data-foundation-probe]')).toHaveCount(0);
  await expect(page.locator('[data-foundation-summary]')).toContainText('측정 캐시 0');
});

test('engine controls use shared primitive styles and contain the selection pulse',async({page},info)=>{
  await page.emulateMedia({reducedMotion:'no-preference'});
  await open(page);
  const report=await page.locator('.foundation-surface').evaluate(host=>{
    const failures:string[]=[];let pulses=0;
    for(const button of host.querySelectorAll<HTMLButtonElement>('button[data-foundation-node]')){
      const choice=button.getAttribute('data-foundation-kind')==='choice';
      const reference=document.createElement('button');
      reference.className=choice?'chip':button.className;
      if(choice)reference.setAttribute('aria-checked',button.getAttribute('aria-checked')!);
      reference.disabled=button.disabled;
      reference.style.position='fixed';reference.style.visibility='hidden';
      host.append(reference);
      const actual=getComputedStyle(button),expected=getComputedStyle(reference);
      for(const property of ['border-radius','background-color','color','box-shadow','font-size','font-weight','line-height','padding-left','padding-right','padding-top','padding-bottom']){
        if(actual.getPropertyValue(property)!==expected.getPropertyValue(property))failures.push(`${button.textContent}:${property}`);
      }
      reference.remove();
      if(choice&&button.getAttribute('aria-checked')==='true'){
        button.setAttribute('aria-checked','false');getComputedStyle(button).scale;
        button.setAttribute('aria-checked','true');
        const animations=button.getAnimations();
        if(!animations.length)failures.push('missing-selection-pulse');
        for(const animation of animations){animation.pause();animation.currentTime=72;}
        if(Number(getComputedStyle(button).scale)<=1)failures.push('pulse-not-scaled');
        pulses+=animations.length;
      }
      const box=button.getBoundingClientRect(),envelope=button.parentElement!.getBoundingClientRect();
      // Include the chip's expanded native target and the bottom lip.
      const horizontal=choice?2:0,vertical=choice?4:0;
      if(box.left-horizontal<envelope.left-.5||box.right+horizontal>envelope.right+.5||box.top-vertical<envelope.top-.5||box.bottom+Math.max(vertical,3)>envelope.bottom+.5)failures.push(`${button.textContent}:paint-outside`);
      for(const animation of button.getAnimations())animation.finish();
    }
    if(!pulses)failures.push('no-pulse-sampled');
    return failures;
  });
  expect(report).toEqual([]);
  await page.screenshot({path:`/tmp/foundation-design-system-${info.project.name}.png`,fullPage:true});
});


test('allocation change rejects activation before ResizeObserver has delivered',async({page})=>{
  await open(page);
  const pass=page.getByRole('button',{name:'패스',exact:true});
  await pass.scrollIntoViewIfNeeded();await pass.focus();await page.keyboard.down('Space');
  await pass.evaluate(button=>{
    const host=document.querySelector<HTMLElement>('.foundation-surface')!;
    host.style.width='280px';
    // One native task: no observer can have announced the changed allocation yet.
    (button as HTMLButtonElement).click();
  });
  await page.keyboard.up('Space');await ready(page);
  await expect(page.locator('[data-foundation-action]')).toHaveText('');
});

test('resize reuses scoped card leaves and revocation removes retained private DOM',async({page})=>{
  await open(page);
  const leaf=page.locator('[data-foundation-kind="card"][data-foundation-zone="hand"][data-foundation-entity]:not([data-foundation-entity=""])').first();
  await expect(leaf).toHaveAttribute('data-foundation-entity','card-0');
  const card=await leaf.elementHandle();
  const svg=await card!.evaluateHandle(element=>element.firstElementChild);
  const before=await page.locator('.foundation-surface').getAttribute('data-foundation-frame');
  await page.setViewportSize({width:768,height:1024});await ready(page);
  await expect.poll(()=>page.locator('.foundation-surface').getAttribute('data-foundation-frame')).not.toBe(before);
  expect(await card!.evaluate(element=>element.isConnected)).toBe(true);
  expect(await svg.evaluate(element=>element!.isConnected)).toBe(true);
  await page.getByRole('button',{name:'권한 해제',exact:true}).click();
  await expect(nodes(page)).toHaveCount(0);
  expect(await card!.evaluate(element=>element.isConnected)).toBe(false);
  expect(await svg.evaluate(element=>element!.isConnected)).toBe(false);
});


test('pending resize keeps retained DOM paint-suppressed and input-fenced while preserving logical focus',async({page})=>{
  await open(page);
  const choice=page.getByRole('radio',{name:'15',exact:true});
  await choice.scrollIntoViewIfNeeded();await choice.focus();
  const pending=await page.locator('.foundation-surface').evaluate(host=>new Promise<{hidden:boolean;disabled:boolean;focusEntered:boolean;aria:string|null}>(resolve=>{
    const surface=host as HTMLElement;
    const observer=new MutationObserver(()=>{
      if(surface.dataset.foundationStatus!=='pending')return;
      const content=surface.querySelector<HTMLElement>('.foundation-content')!;
      const controls=[...content.querySelectorAll<HTMLButtonElement|HTMLSelectElement|HTMLInputElement>('button,select,input')];
      let focusEntered=false;for(const control of controls){control.focus();if(content.contains(document.activeElement))focusEntered=true;}
      const result={hidden:getComputedStyle(content).opacity==='0',disabled:controls.length>0&&controls.every(control=>control.disabled),focusEntered,aria:content.getAttribute('aria-hidden')};
      // The invalid frame's retained native button must not execute.
      const pass=[...content.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='패스');
      pass?.click();observer.disconnect();resolve(result);
    });
    observer.observe(surface,{attributes:true,attributeFilter:['data-foundation-status']});
    surface.style.width='281px';
  }));
  expect(pending).toEqual({hidden:true,disabled:true,focusEntered:false,aria:'true'});
  await ready(page);await expect(choice).toBeFocused();
  await expect(page.locator('[data-foundation-action]')).toHaveText('');
});

test('unchanged font notifications reuse metrics while new resources trigger measurement',async({page})=>{
  await open(page);
  // Settle any genuine initial font resource arrivals before capturing the frame.
  await page.evaluate(()=>document.fonts.ready);await ready(page);
  const before=await page.locator('.foundation-surface').evaluate(host=>JSON.parse((host as HTMLElement).dataset.foundationPerformance!));
  await page.evaluate(()=>{
    const faces=[...document.fonts].filter(face=>face.status==='loaded');
    for(let iteration=0;iteration<10;iteration++)document.fonts.dispatchEvent(new FontFaceSetLoadEvent('loadingdone',{fontfaces:faces}));
  });
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  const unchanged=await page.locator('.foundation-surface').evaluate(host=>JSON.parse((host as HTMLElement).dataset.foundationPerformance!));
  expect(unchanged.frame).toBe(before.frame);expect(unchanged.requests).toBe(before.requests);
  await page.evaluate(async()=>{
    const url=performance.getEntriesByType('resource').find(entry=>entry.name.includes('PretendardVariable')&&entry.name.endsWith('.woff2'))?.name;
    if(!url)throw new Error('Expected a loaded bundled font');
    const resource=new FontFace('Foundation font replacement',`url("${url}")`);
    await resource.load();document.fonts.add(resource);
    document.fonts.dispatchEvent(new FontFaceSetLoadEvent('loadingdone',{fontfaces:[resource]}));
  });
  await ready(page);
  await expect.poll(()=>page.locator('.foundation-surface').getAttribute('data-foundation-frame')).not.toBe(String(before.frame));
  const changed=await page.locator('.foundation-surface').evaluate(host=>JSON.parse((host as HTMLElement).dataset.foundationPerformance!));
  expect(changed.requests).toBeGreaterThan(before.requests);
});


test('an event during pending measurement cannot swallow a newer environment',async({page})=>{
  await open(page);
  await page.getByRole('button',{name:'패스',exact:true}).evaluate(button=>{
    const host=document.querySelector<HTMLElement>('.foundation-surface')!;
    host.style.width='281px';
    (button as HTMLButtonElement).click();
    host.style.width='282px';
    button.dispatchEvent(new MouseEvent('click',{bubbles:true}));
  });
  await ready(page);
  await expect.poll(()=>page.locator('[data-foundation-node="table"]').evaluate(table=>table.getBoundingClientRect().width)).toBe(282);
  await expect(page.locator('[data-foundation-action]')).toHaveText('');
});

test('fresh foundation root loads shared fonts without legacy responsive styles',async({page})=>{
  await open(page);
  const styles=await page.evaluate(()=>{
    let faces=0;const media:string[]=[];
    const visit=(sheet:CSSStyleSheet|CSSGroupingRule)=>{
      for(const rule of sheet.cssRules){
        if(rule instanceof CSSFontFaceRule)faces++;
        if(rule instanceof CSSMediaRule)media.push(rule.conditionText);
        if('cssRules' in rule)visit(rule as CSSGroupingRule);
      }
    };
    for(const sheet of document.styleSheets)visit(sheet);
    return {faces,media,font:getComputedStyle(document.querySelector('.foundation-surface')!).fontFamily};
  });
  expect(styles.faces).toBeGreaterThan(0);expect(styles.font).toContain('Pretendard');expect(styles.media.filter(query=>/width|height|orientation|aspect-ratio/.test(query))).toEqual([]);
});

test('ordinary application boot and responsive dialog padding remain intact',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');await page.getByRole('button',{name:'설정',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'설정',exact:true});await expect(dialog).toBeVisible();
  for(const width of [375,390]){
    await page.setViewportSize({width,height:844});
    await expect.poll(()=>dialog.evaluate(element=>getComputedStyle(element).getPropertyValue('--pad').trim())).toBe(width<=380?'16px':'20px');
  }
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('navigation from the ordinary app crosses the engine root boundary',async({page})=>{
  await page.goto('/');await expect(page.getByRole('button',{name:'설정',exact:true})).toBeVisible();
  const original=await page.evaluate(()=>performance.timeOrigin);
  // An ordinary same-origin link must get document navigation at this boundary.
  await page.evaluate(()=>{const link=document.createElement('a');link.href='/preview/?foundation=1';link.textContent='엔진 검증으로';document.querySelector('main')!.append(link);});
  await page.getByRole('link',{name:'엔진 검증으로',exact:true}).click();await ready(page);
  expect(await page.evaluate(()=>performance.timeOrigin)).not.toBe(original);
  const queries=await page.evaluate(()=>{
    const media:string[]=[];const visit=(sheet:CSSStyleSheet|CSSGroupingRule)=>{for(const rule of sheet.cssRules){if(rule instanceof CSSMediaRule)media.push(rule.conditionText);if('cssRules'in rule)visit(rule as CSSGroupingRule);}};
    for(const sheet of document.styleSheets)visit(sheet);return media.filter(query=>/width|height|orientation|aspect-ratio/.test(query));
  });
  expect(queries).toEqual([]);
});

test('suspended overflowing groups cannot acquire keyboard or programmatic focus',async({page},info)=>{
 test.skip(info.project.name!=='1440x900-dark','one Chromium native scroll-focus lifecycle');
 await page.setViewportSize({width:390,height:844});await open(page);await page.getByRole('button',{name:'40장',exact:true}).click();await ready(page);
 const focused=await page.locator('.foundation-content').evaluate(content=>{
  const group=[...content.querySelectorAll<HTMLElement>('[data-foundation-node]')].find(el=>(['auto','scroll'].includes(el.style.overflowX)||['auto','scroll'].includes(el.style.overflowY))&&(el.scrollWidth>el.clientWidth||el.scrollHeight>el.clientHeight))!;
  group.focus();return {id:group.dataset.foundationNode!,focused:document.activeElement===group};
 });expect(focused.focused).toBe(true);
 const suspend=async(width:string)=>page.evaluate(width=>{
  const state=window as typeof window&{releaseSuspendedFonts?:()=>void};const load=document.fonts.load.bind(document.fonts);const releases:(()=>void)[]=[];
  state.releaseSuspendedFonts=()=>{document.fonts.load=load;releases.splice(0).forEach(release=>release());};
  document.fonts.load=(...args)=>load(...args).then(faces=>new Promise(resolve=>releases.push(()=>resolve(faces))));
  document.querySelector<HTMLElement>('.foundation-surface')!.style.width=width;
 },width);
 await suspend('281px');
 await expect(page.locator('.foundation-surface')).toHaveAttribute('data-foundation-status','pending');
 const hidden=await page.locator('.foundation-content').evaluate(content=>{
  const groups=[...content.querySelectorAll<HTMLElement>('[data-foundation-node]')].filter(el=>el.scrollWidth>el.clientWidth||el.scrollHeight>el.clientHeight);
  return {paint:getComputedStyle(content).opacity,overflowing:groups.length,stops:groups.every(el=>el.getAttribute('tabindex')==='-1'||!['auto','scroll'].includes(el.style.overflowX)&&!['auto','scroll'].includes(el.style.overflowY))};
 });
 expect(await page.locator('.foundation-content').evaluate(content=>content.contains(document.activeElement))).toBe(false);
 expect(hidden.paint).toBe('0');expect(hidden.overflowing).toBeGreaterThan(0);expect(hidden.stops).toBe(true);
 expect(await page.locator('.foundation-content').evaluate(content=>{const scroll=[...content.querySelectorAll<HTMLElement>('[tabindex="-1"]')][0];scroll?.focus();return content.contains(document.activeElement);})).toBe(false);
 await page.evaluate(()=>(window as typeof window&{releaseSuspendedFonts?:()=>void}).releaseSuspendedFonts!());await ready(page);
 await expect.poll(()=>page.evaluate(()=>document.activeElement instanceof HTMLElement?document.activeElement.dataset.foundationNode:null)).toBe(focused.id);
 // Deliberately leaving during a later preparation must not steal focus back.
 await suspend('289px');await expect(page.locator('.foundation-surface')).toHaveAttribute('data-foundation-status','pending');
 for(let i=0;i<6;i++){
  await page.keyboard.press('Tab');expect(await page.locator('.foundation-content').evaluate(content=>content.contains(document.activeElement))).toBe(false);
 }
 await page.evaluate(()=>(window as typeof window&{releaseSuspendedFonts?:()=>void}).releaseSuspendedFonts!());await ready(page);
 expect(await page.locator('.foundation-content').evaluate(content=>content.contains(document.activeElement))).toBe(false);
 await expect(page.locator('[data-foundation-action]')).toHaveText('');
});
