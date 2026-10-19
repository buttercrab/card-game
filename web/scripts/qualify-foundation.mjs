/** Sequential functional qualification with fresh default-limited servers per
 * file. Run performance separately, with no other build/browser workers.
 * PORT, SERVER_BIN and WEB_DIST use playwright.config.ts's ordinary meanings.
 * FOUNDATION_OUTPUT selects a new receipt directory; never overwrites one.
 * Optional spec filenames run focused checks; only the full inventory can
 * set the qualification manifest's passed flag.
 */
import {readdir,readFile,mkdir,writeFile,open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {resolve,join,basename} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const excluded=new Set(['foundation-comparison.spec.ts','foundation-measurement.spec.ts','foundation-mighty-bid-pressure.spec.ts','foundation-style-trace.spec.ts','foundation-max-bid-trace.spec.ts']);
const inventory=(await readdir(join(root,'e2e'))).filter(name=>/^foundation.*\.spec\.ts$/.test(name)&&!excluded.has(name)).sort();
if(!inventory.length)throw Error('The functional qualification inventory is empty');
const requested=process.argv.slice(2).map(name=>basename(name));
if(requested.some(name=>!inventory.includes(name)))throw Error('Requested file is outside the functional qualification inventory');
const files=requested.length?inventory.filter(name=>requested.includes(name)):inventory;
const fullSelection=files.length===inventory.length&&files.every((file,index)=>file===inventory[index]);
const output=resolve(process.env.FOUNDATION_OUTPUT??`/tmp/foundation-functional-${Date.now()}`);
await mkdir(output); // An existing receipt is evidence, never scratch space.
const digest=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
async function sourceTree(directory,prefix=''){
 const entries=[];
 for(const item of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
  const name=join(prefix,item.name),path=join(directory,item.name);
  if(item.isDirectory())entries.push(...await sourceTree(path,name));
  else if(item.isFile())entries.push([name,await digest(path)]);
 }
 return entries;
}
const dist=resolve(root,process.env.WEB_DIST??'dist'),server=resolve(root,process.env.SERVER_BIN??'../target/debug/server');
const assets=Object.fromEntries(await Promise.all((await readdir(join(dist,'assets'),{withFileTypes:true})).filter(item=>item.isFile()).map(item=>item.name).sort().map(async name=>[name,await digest(join(dist,'assets',name))])));
const manifest={revision:'foundation-functional-isolated-v2',startedAt:new Date().toISOString(),node:process.version,
 boundary:'Sequential Chromium phone/light and desktop/dark, one worker. Each file owns a fresh ephemeral server pair with unchanged production rate/resource limits. No physical device, AT, OS IME, audible hardware or performance claim.',
 projects:['390x844-light','1440x900-dark'],port:Number(process.env.PORT??4317),server,serverSha256:await digest(server),assets,servedFiles:Object.fromEntries(await sourceTree(dist)),
 runnerSha256:await digest(fileURLToPath(import.meta.url)),playwrightConfigSha256:await digest(join(root,'playwright.config.ts')),
 packageLockSha256:await digest(join(root,'package-lock.json')),packageJsonSha256:await digest(join(root,'package.json')),
 e2eSources:Object.fromEntries(await sourceTree(join(root,'e2e'))),webSources:Object.fromEntries(await sourceTree(join(root,'src'))),publicSources:Object.fromEntries(await sourceTree(join(root,'public'))),
 inventory,selection:files,scope:fullSelection?'full':'focused',excludedPerformanceAndDiagnostics:[...excluded],files:[],finishedAt:null,selectedPassed:false,passed:false};
for(const [index,file] of files.entries()){
 const logPath=join(output,`${file}.log`),log=await open(logPath,'wx');
 const args=['playwright','test',`e2e/${file}`,...manifest.projects.map(project=>`--project=${project}`),'--workers=1','--forbid-only',`--output=${join(output,file)}`];
 let code;
 try{code=await new Promise((done,reject)=>{const child=spawn('npx',args,{cwd:root,env:process.env,stdio:['ignore',log.fd,log.fd]});child.once('error',reject);child.once('exit',(exit,signal)=>done(signal?null:exit));});}finally{await log.close();}
 const text=await readFile(logPath,'utf8'),count=label=>Number(text.match(new RegExp(`^\\s*(\\d+) ${label}(?: |$)`,'m'))?.[1]??0);
 const receipt={file,testSha256:await digest(join(root,'e2e',file)),exitCode:code,passed:count('passed'),failed:count('failed'),skipped:count('skipped'),didNotRun:count('did not run'),log:logPath};
 manifest.files.push(receipt);
 await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2));
 console.log(`[${index+1}/${files.length}] ${code===0?'PASS':'FAIL'} ${file}: ${receipt.passed} passed, ${receipt.failed} failed, ${receipt.skipped} skipped`);
}
manifest.finishedAt=new Date().toISOString();
manifest.totals=Object.fromEntries(['passed','failed','skipped','didNotRun'].map(key=>[key,manifest.files.reduce((sum,file)=>sum+file[key],0)]));
manifest.selectedPassed=manifest.files.length===files.length&&manifest.files.every(file=>file.exitCode===0&&file.didNotRun===0&&file.passed>0);
manifest.passed=fullSelection&&manifest.selectedPassed;
await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({output,scope:manifest.scope,selectedPassed:manifest.selectedPassed,passed:manifest.passed,totals:manifest.totals}));
process.exitCode=manifest.selectedPassed?0:1;
