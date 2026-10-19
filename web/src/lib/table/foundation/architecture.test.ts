// @ts-expect-error the browser tsconfig intentionally omits Node ambient types
import {readFileSync,readdirSync} from 'node:fs';
import {expect,test} from 'vitest';
import ts from 'typescript';
import {createCardTable} from './index';
import {createCardSession} from './session';
import type {TableDocument} from './contracts';
import {proofDocument,type ProofAction} from './fixtures';

const source=(name:string)=>readFileSync(new URL(name,import.meta.url),'utf8');
const importEdges=(name:string,text:string)=>{
  const body=name.endsWith('.svelte')?[...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match=>match[1]).join('\n'):text;
  const file=ts.createSourceFile(name,body,ts.ScriptTarget.Latest,true),edges:{path:string;names:string}[]=[];
  const add=(path:ts.Node|undefined,names='')=>{if(path&&ts.isStringLiteralLike(path))edges.push({path:path.text,names});};
  const visit=(node:ts.Node)=>{
    if(ts.isImportDeclaration(node))add(node.moduleSpecifier,node.importClause?.namedBindings?.getText(file)??'');
    else if(ts.isExportDeclaration(node))add(node.moduleSpecifier,node.exportClause?.getText(file)??'');
    else if(ts.isImportEqualsDeclaration(node)&&ts.isExternalModuleReference(node.moduleReference))add(node.moduleReference.expression);
    else if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword){
      expect(node.arguments[0]&&ts.isStringLiteralLike(node.arguments[0]),`${name}: dynamic module edges must be inspectable`).toBe(true);add(node.arguments[0]);
    }else if(ts.isImportTypeNode(node)&&ts.isLiteralTypeNode(node.argument))add(node.argument.literal);
    ts.forEachChild(node,visit);
  };
  visit(file);return edges;
};
const imports=(name:string)=>importEdges(name,source(name));
// This directory also hosts explicitly named application bridges and executable
// harnesses. They are not the reusable engine and cannot be imported by it.
// New modules are protected by default; an exemption requires a visible edit.
const hostAndHarness=new Set([
  'ConnectedRoom.svelte','FoundationEntry.svelte','FoundationPreview.svelte','localPreferences.ts',
  'fixtures.ts','arenaFixture.ts','cardFixtures.ts','countedLandingFixture.ts','flowFixture.ts','completionReceiveFixture.ts',
  'informationFixture.ts','largeChoiceFixture.ts','mightyBidPressureFixture.ts','mightyJokerFixture.ts','pressureFixtures.ts',
  'seatDealFixture.ts','shellFixture.ts','domainPressure.ts',
]);
const productionModules=(readdirSync(new URL('.',import.meta.url),{recursive:true}) as string[]).filter(name=>/\.(?:ts|svelte)$/.test(name)&&!name.endsWith('.test.ts'));
const engineModules=productionModules.filter(name=>!hostAndHarness.has(name));
const numericPolicies=new Set(['framePolicy','dockPolicy','participantPolicy','hudPolicy','jointDecisionLayout']);
const retainedPolicies=['../frameLayout','../dockLayout','../seatIdentityLayout','../feedbackLayout','../hudLayout'];
// Bundler resolution accepts a .js specifier for a .ts implementation. Compare
// source identities rather than allowing that spelling to bypass the boundary.
const stripModuleExtension=(name:string)=>name.replace(/\.(?:ts|js|svelte)$/,'');
const moduleIdentity=(name:string)=>stripModuleExtension(new URL(name,import.meta.url).pathname);
const protectedPolicyModules=new Set([...numericPolicies].map(name=>moduleIdentity(`./${name}`)).concat(retainedPolicies.map(moduleIdentity)));
const isPolicyEdge=(owner:string,path:string)=>protectedPolicyModules.has(stripModuleExtension(new URL(path,new URL(owner,import.meta.url)).pathname));
const targetModule=(path:string)=>stripModuleExtension(path.split('/').at(-1)!);
const hostAndHarnessNames=new Set([...hostAndHarness].map(stripModuleExtension));
test('new geometry and runtime do not delegate authority to legacy layout/controllers',()=>{
  for(const name of engineModules){
    for(const entry of imports(name)){
      expect(entry.path).not.toMatch(/(?:frameLayout|dockLayout|seatIdentityLayout|feedbackLayout|hudLayout|frameMeasurements|measurementScheduler|coordinateContext|(?:^|\/)games(?:\/|$))/i);
      const target=targetModule(entry.path);
      expect(hostAndHarnessNames.has(target),`${name} imports application/harness module ${entry.path}`).toBe(false);
      expect(entry.names).not.toMatch(/\bDecisionController\b/);
    }
  }
  for(const name of ['planner.ts','fixtures.ts','cardFixtures.ts','cardSelection.ts','selectionMotion.ts','transferMotion.ts','flowFixture.ts','seatDealFixture.ts','pressureFixtures.ts','composition.ts','fontResources.ts','yogaComposition.ts'])expect(source(name)).not.toMatch(/\b(?:window|globalThis\.document)\s*\.|\bdocument\.(?:createElement|querySelector|body|fonts)|\b(?:setTimeout|requestAnimationFrame|ResizeObserver|MutationObserver)\s*\(/);
  expect(source('SharedArtwork.svelte')).not.toMatch(/PlayingCard|cardGeometry|onclick|onkeydown|getBoundingClientRect|ResizeObserver|\.admit\(|\.act\(/);
  expect(source('domSurface.ts')).not.toMatch(/\.admit\(|\.act\(|\.transport\(/);
});
test('public roots cannot replace engine policy with a planner',()=>{
  const session=createCardSession({transport:()=>{}});
  const createInvalid=()=>{
    // @ts-expect-error kernel injection is internal test infrastructure, not a public game API
    createCardTable({session,planner:()=>({kind:'ready'})});
  };
  const bypassGeometry=()=>{
    // @ts-expect-error game documents have no per-widget geometry override
    const document:TableDocument<ProofAction>={...proofDocument(),dockHeight:64};
    return document;
  };
  expect(bypassGeometry).toBeTypeOf('function');
  expect(createInvalid).toBeTypeOf('function');session.dispose();
});

test('generic connected host owns freshness/session/surface without game or legacy imports',()=>{
    const host=source('ConnectedRoom.svelte'),contract=source('connected.ts');
    for(const edge of imports('ConnectedRoom.svelte')){
        expect(edge.path).not.toMatch(/(?:frameLayout|dockLayout|seatIdentityLayout|feedbackLayout|hudLayout|frameMeasurements|measurementScheduler|coordinateContext|(?:^|\/)games(?:\/|$))/i);
        expect(isPolicyEdge('ConnectedRoom.svelte',edge.path),`connected host cannot arrange through ${edge.path}`).toBe(false);
        const target=edge.path.split('/').at(-1)!.replace(/\.(?:ts|svelte)$/,'');
        expect(hostAndHarnessNames.has(target)&&target!=='localPreferences',`connected host imports unauthorized harness ${edge.path}`).toBe(false);
    }
    for(const core of [host,contract]){
        expect(core).not.toMatch(/TableUi|TableSession|frameMeasurements|coordinateContext|from ['"].*(?:\/Room|\/Table)\.svelte/);
        expect(core).not.toMatch(/\bfrom\s*['"][^'"]*(?:\/games\/|\/mighty(?:\/|['"]))/);
        expect(core).not.toMatch(/\bstate\.view\.|\bgame\.view\./);
    }
    expect(host).toContain('$state.snapshot(selectCurrentRoom(room))');
    expect(host).not.toMatch(/\$state\.snapshot\((?:client\.)?room\)/);
    expect(host).not.toContain('JSON.stringify([room,state');
    expect(host).toContain('client.publicationReady');
    expect(host).toContain("type Command=HostCommand<A,G['settings']>");
    expect(host).toContain('createCardSession<Command>');
    expect(host).toContain('domSurface=createDomSurface(host);domSurface.setTextScale(localTextScale());table.attach(domSurface)');
    expect(host).toContain('if(mounted)domSurface?.setTextScale(scale)');
    expect(host).toContain('table.dispose();domSurface=null;');
    expect(host).toContain('submitConnectedOnce((submitGame,submitRoom)=>{');
    expect(host).toContain('adapter.submit(commandClient,command.candidate,submitGame,submitRoom)');
    expect(host).not.toContain('adapter.submit(client,');
    expect(host).toContain('createConnectedCommandClient<G>({status:client.status,room:ownedRoom(),game:ownedState()');
    expect(host).toContain('client.commands.submit(submission.id,window.scope,action)');
    expect(host).toContain("client.commands.submitRoom(submission.id,command.kind==='room'?command.expected:window.scope,action,command.kind==='room'&&submission.formInstanceId&&(action.type==='join'||action.type==='rename')?'adopt-name':undefined)");
    expect(host).toContain('const publication=disclose(connectedDocument({...source,...(assistance?{assistance}:{}),...(feedbackProjection?{feedback:feedbackProjection}:{}),interaction:localCardActivation()},');
    expect(host).toContain('if(!publication)return;');
    expect(host).toContain('session.receive(publication,{connected:transportReady})');
    expect(host).toContain('client=new RoomClient<G>(id,{feedback:\'external\'})');
    expect(host).toContain('sameAssistanceScope(operation.scope,authority.scope)');
    expect(host).toContain('session.receive(publicConnectedDocument(details,');
    expect(host).not.toMatch(/<header|connection-notice|<GameMenu|<PeopleSheet|<SettingsSheet/);
    expect(contract).toContain('submit(client: ConnectedCommandClient<G>');
    const composition=source('connectedDocument.ts');
    expect(composition).not.toMatch(/from ['"][^'"]*\/games\/|\b(?:window|document)\.(?:createElement|querySelector)|\.commands\.submit|\.act\(/);
});
test.each(['mighty','poker'] as const)('connected %s wrapper and adapter cannot create a second lifecycle/layout owner',gameId=>{
    const wrapper=source(`../../games/${gameId}/FoundationRoom.svelte`),adapter=source(`../../games/${gameId}/foundation.ts`),connection=source(`../../games/${gameId}/connected.ts`);
    expect(wrapper).toContain(`<ConnectedRoom adapter={${gameId}ConnectedGame}/>`);
    for(const game of [wrapper,connection])expect(game).not.toMatch(/RoomClient|createCardSession|createCardTable|createDomSurface|\$effect|\$state\.snapshot|setTimeout|publicationReady|TableUi|TableSession/);
    expect(adapter).not.toMatch(/frameLayout|dockLayout|DecisionController|createCardSession|createCardTable|createDomSurface|new RoomClient|\.style\.|getBoundingClientRect/);
    for(const name of [`../../games/${gameId}/FoundationRoom.svelte`,`../../games/${gameId}/foundation.ts`,`../../games/${gameId}/connected.ts`])for(const edge of imports(name))expect(isPolicyEdge(name,edge.path),`${name} imports numeric authority ${edge.path}`).toBe(false);
    if(gameId==='mighty'){
      expect(connection).toContain('mightyDocument(client,revision,graceReady,priorGeneration,true,history)');
      expect(connection).toContain('prepareMightyCommand(client, command)');
    }else expect(connection).toContain('pokerDocument(client,revision,graceReady,true)');
    expect(connection).not.toMatch(/sendMightyCommand|client\.(?:act|join|start|ready|commands)\b/);
});

test('canonical numeric policies have an inward runtime and type dependency closure',()=>{
 const allowed:Record<string,readonly string[]>={framePolicy:['participantPolicy','dockPolicy'],dockPolicy:['contracts'],participantPolicy:['contracts','hudPolicy'],hudPolicy:['contracts']};
 for(const [name,targets] of Object.entries(allowed))for(const edge of imports(`${name}.ts`)){
  expect(edge.path.startsWith('./')&&!edge.path.slice(2).includes('/'),`${name} external edge ${edge.path}`).toBe(true);
  expect(targets,`${name} delegates numeric authority through ${edge.path}`).toContain(targetModule(edge.path));
 }
 for(const [name,formatters]of [['../frameLayout.ts',['frameStyle']],['../dockLayout.ts',[]],['../seatIdentityLayout.ts',['boundsStyle']],['../feedbackLayout.ts',[]],['../hudLayout.ts',[]]] as const){
  const text=source(name),file=ts.createSourceFile(name,text,ts.ScriptTarget.Latest,true);
  for(const statement of file.statements){
   if(ts.isFunctionDeclaration(statement))expect(formatters as readonly string[],`${name} retains competing numeric function`).toContain(statement.name?.text);
   else expect(ts.isImportDeclaration(statement)||ts.isExportDeclaration(statement)||ts.isTypeAliasDeclaration(statement),`${name} retains numeric state or policy`).toBe(true);
  }
  for(const edge of imports(name))expect(edge.path,`${name} must consume the canonical core`).toMatch(/^\.\/foundation\/(?:framePolicy|dockPolicy|participantPolicy|hudPolicy|contracts)$/);
 }
 for(const edge of imports('index.ts'))expect(isPolicyEdge('index.ts',edge.path),'public game API must not expose geometry policy').toBe(false);
});

// Exercise the edge classifier independently of current source absence: each game
// role must reject every authority module regardless of import syntax or alias.
test('all game adapter roles reject canonical and retained numeric edges',()=>{
 const targets=[...numericPolicies].map(name=>`../../table/foundation/${name}`).concat(['frameLayout','dockLayout','seatIdentityLayout','feedbackLayout','hudLayout'].map(name=>`../../table/${name}`));
 const forms=(path:string)=>[
  `import {anything as alias} from '${path}';`,
  `import * as alias from '${path}';`,
  `import type {Anything as Alias} from '${path}';`,
  `export {anything as alias} from '${path}';`,
  `export type {Anything} from '${path}';`,
  `type Alias=import('${path}').Anything;`,
  `const value=import('${path}');`,
  `import alias = require('${path}');`,
 ];
 for(const role of ['FoundationRoom.svelte','foundation.ts','connected.ts']){
  const owner=`../../games/mighty/${role}`;
  for(const base of targets)for(const target of [base,`${base}.ts`,`${base}.js`])for(const code of forms(target)){
   const edges=importEdges(owner,role.endsWith('.svelte')?`<script lang="ts">${code}</script>`:code);
   expect(edges).toHaveLength(1);expect(isPolicyEdge(owner,edges[0].path),`${role}: ${code}`).toBe(true);
  }
  for(const target of ['../../table/foundation/ConnectedRoom.svelte','../../table/foundation/contracts','../../table/foundation/index'])expect(isPolicyEdge(owner,target)).toBe(false);
 }
});

test('public facade rejects direct canonical and retained numeric edges',()=>{
 const targets=[...numericPolicies].map(name=>`./${name}`).concat(retainedPolicies);
 for(const base of targets)for(const target of [base,`${base}.ts`,`${base}.js`])for(const code of [
  `export * from '${target}';`,
  `export {anything as alias} from '${target}';`,
  `export type {Anything} from '${target}';`,
  `import {anything as alias} from '${target}';`,
  `type Alias=import('${target}').Anything;`,
  `const value=import('${target}');`,
 ]){
  const edges=importEdges('index.ts',code);expect(edges).toHaveLength(1);
  expect(isPolicyEdge('index.ts',edges[0].path),code).toBe(true);
 }
 for(const target of ['./runtime','./contracts','./session','./publicGame'])expect(isPolicyEdge('index.ts',target)).toBe(false);
});

test('policy classification follows TypeScript JavaScript-specifier resolution',()=>{
 const owner=new URL('../../games/mighty/foundation.ts',import.meta.url).pathname;
 const path='../../table/foundation/framePolicy.js';
 const resolved=ts.resolveModuleName(path,owner,{module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler},ts.sys).resolvedModule;
 expect(resolved?.resolvedFileName).toBe(new URL('./framePolicy.ts',import.meta.url).pathname);
 expect(isPolicyEdge('../../games/mighty/foundation.ts',path)).toBe(true);
 expect(isPolicyEdge('index.ts','./framePolicy.js')).toBe(true);
});

test('foundation consumes only neutral decision semantics, never the retained controller facade',()=>{
 for(const name of engineModules)for(const edge of imports(name))expect(stripModuleExtension(new URL(edge.path,new URL(name,import.meta.url)).pathname),'foundation must not mount a second draft/transport controller').not.toBe(moduleIdentity('../decision'));
});
test('neutral decision model/core/card algebra have a closed pure inward graph',()=>{
 const allowed:Record<string,readonly string[]>={decisionModel:['presentation','../cardTypes'],decisionCore:['presentation','decisionModel','cardSelection'],cardSelection:['presentation','../generated/protocol'],decisionDescriptor:['decisionModel']};
 for(const [module,targets]of Object.entries(allowed)){
  const name=`../${module}.ts`,text=source(name),file=ts.createSourceFile(name,text,ts.ScriptTarget.Latest,true);
  expect(text).not.toMatch(/foundation\/|DecisionController|\b(?:window|setTimeout|requestAnimationFrame|transport|fetch)\s*[.(]|\bdocument\.(?:createElement|querySelector|body|fonts)/);
  for(const edge of imports(name)){const target=stripModuleExtension(new URL(edge.path,new URL(name,import.meta.url)).pathname);expect(targets.map(path=>moduleIdentity(`../${path}`)),`${module}: ${edge.path}`).toContain(target);}
  for(const node of file.statements)if(ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier)&&node.moduleSpecifier.text==='../generated/protocol'){
   const bindings=node.importClause?.namedBindings;expect(node.importClause?.name).toBeUndefined();expect(bindings&&ts.isNamedImports(bindings)).toBe(true);
   if(bindings&&ts.isNamedImports(bindings))expect(bindings.elements.map(element=>(element.propertyName??element.name).text)).toEqual(['MAX_COMMAND_BATCH']);
  }
 }
});
