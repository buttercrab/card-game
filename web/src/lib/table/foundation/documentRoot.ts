import type {TableDocument,ViewContext} from './contracts';
const fields={presentation:true,stage:true,disclosures:true,disclosureFormActions:true,disclosureContext:true,outcome:true,assistance:true,feedback:true,statusPresentation:true,interaction:true,context:true,participant:true,hand:true,opponents:true,collections:true,shell:true,forms:true,information:true,scoreboard:true,facts:true,decision:true,offer:true,recycle:true,deals:true,stockReturn:true,reveals:true} satisfies Record<keyof TableDocument<unknown>,true>;
function ownContext(input:unknown):ViewContext{
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid view context');
 const names=['session','audience','generation','revision'] as const,keys=Reflect.ownKeys(input);if(keys.length!==names.length||keys.some(key=>typeof key!=='string'||!names.includes(key as typeof names[number])))throw Error('Invalid view context');
 const result:Record<string,string>={};for(const key of names){const descriptor=Object.getOwnPropertyDescriptor(input,key);if(!descriptor||!('value'in descriptor)||!descriptor.enumerable||typeof descriptor.value!=='string'||!descriptor.value.trim()||descriptor.value.length>2048)throw Error('Invalid view context');result[key]=descriptor.value;}return Object.freeze(result) as unknown as ViewContext;
}
/** Own the closed shallow schema before visiting its independently validated
 * payloads. This is not a second traversal of card/action/history graphs. */
export function ownDocumentRoot<A>(input:TableDocument<A>):TableDocument<A>{
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid table document root');
 const keys=Reflect.ownKeys(input);if(keys.length>Object.keys(fields).length||keys.some(key=>typeof key!=='string'||!Object.hasOwn(fields,key)))throw Error('Unknown table document root field');
 const result:Record<string,unknown>={};for(const key of keys){const descriptor=Object.getOwnPropertyDescriptor(input,key);if(!descriptor||!('value'in descriptor)||!descriptor.enumerable)throw Error(key==='context'?'Invalid view context property':key==='stage'?'Invalid table stage':'Invalid table document root property');if(typeof descriptor.value==='function')throw Error('Callable table document root field');Object.defineProperty(result,key,{value:key==='context'?ownContext(descriptor.value):descriptor.value,enumerable:true});}
 return Object.freeze(result) as unknown as TableDocument<A>;
}
