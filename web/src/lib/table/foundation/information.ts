import type {InformationAtom, InformationValue, TableDocument} from './contracts';
const isArray=(value:unknown):boolean=>Array.isArray(value);
const tones=new Set(['accent','gold','danger','plain','muted']);
const suits=new Set(['Spade','Diamond','Heart','Club']);
const text=(value:unknown)=>typeof value==='string'&&value.length>0&&value.length<=500;
const id=(value:unknown)=>typeof value==='string'&&value.length>0&&value.length<=128;
const unique=(values:readonly unknown[])=>new Set(values).size===values.length;
/** A short semantic symbol and its full accessible meaning; no paint hints or
 * participant/card/action identity can enter this closed inert atom. */
export function validInformationToken(input:unknown):input is Extract<InformationAtom,{kind:'token'}>{
 if(!input||typeof input!=='object'||Array.isArray(input)||![Object.prototype,null].includes(Object.getPrototypeOf(input)))return false;
 const fields=Object.getOwnPropertyDescriptors(input),keys=Reflect.ownKeys(input);
 if(keys.length!==3||keys.some(key=>typeof key!=='string'||!['kind','token','label'].includes(key)||!('value'in fields[key])||!fields[key].enumerable))return false;
 const kind=fields.kind?.value,token=fields.token?.value,label=fields.label?.value;
 return kind==='token'&&typeof token==='string'&&token.trim().length>0&&token.length<=16&&typeof label==='string'&&label.trim().length>0&&label.length<=500;
}
/** Validate read-only, bounded information independently of layout or game IDs. */
export function validateInformation<A>(document:TableDocument<A>):void {
  const people=new Set([...(document.participant.role==='observer'?[]:[document.participant.id]),...(document.opponents??[]).map(person=>person.id)]);
  const atom=(value:InformationAtom):boolean=>{
    if(!value||typeof value!=='object'||'join'in value)return false;const kind=Object.getOwnPropertyDescriptor(value,'kind');if(!kind||!('value'in kind))return false; // Caption lexical boundaries are not fact-atom metadata.
    switch(value.kind){
      case 'text':return text(value.text);
      case 'token':return validInformationToken(value);
      case 'number':return Number.isFinite(value.value);
      case 'participant':return people.has(value.participantId);
      case 'suit':return suits.has(value.suit)&&text(value.label);
      case 'card':{
        const visual=value.visual;
        return text(value.label)&&!!visual&&(visual.kind==='standard'&&suits.has(visual.suit)&&Number.isInteger(visual.rank)&&visual.rank>=2&&visual.rank<=14||visual.kind==='joker'&&['Black','Red'].includes(visual.color))&&
          !('id' in value||'entityId' in value||'cardId' in value||'ownerId' in value);
      }
      default:return false;
    }
  };
  const value=(value:InformationValue)=>value?.kind==='inline'?isArray(value.values)&&value.values.length>0&&value.values.length<=4&&value.values.every(atom):atom(value);
  const badges=(items:readonly {text:string;tone:string}[]|undefined)=>items===undefined||isArray(items)&&items.length<=8&&items.every(item=>text(item.text)&&tones.has(item.tone));
  const panels=document.information??[];
  if(!isArray(panels)||panels.length>4||!unique(panels.map(panel=>panel.id)))throw new Error('Invalid information panels');
  let budget=0;
  for(const panel of panels){
    if(!id(panel.id)||!text(panel.title)||!isArray(panel.fields)||panel.fields.length>12||!unique(panel.fields.map(field=>field.id))||
      panel.summary&&!badges([panel.summary])||panel.primary&&(!value(panel.primary.value)||panel.primary.label!==undefined&&!text(panel.primary.label))||
      panel.fields.some(field=>!id(field.id)||!text(field.label)||!value(field.value))||!badges(panel.badges))throw new Error('Invalid information panel');
    budget+=panel.fields.length*5+16;
    const progress=panel.progress;
    if(progress){
      if(!text(progress.label)||!Number.isFinite(progress.total)||progress.total<=0||progress.total>1e9||
        progress.target!==undefined&&(!Number.isFinite(progress.target)||progress.target<0||progress.target>progress.total)||
        !isArray(progress.series)||progress.series.length<1||progress.series.length>4||!unique(progress.series.map(item=>item.id))||
        progress.series.some(item=>!id(item.id)||!text(item.label)||!Number.isFinite(item.value)||item.value<0||!tones.has(item.tone)||!['start','end'].includes(item.from))||
        progress.series.reduce((sum,item)=>sum+item.value,0)>progress.total)throw new Error('Invalid conserved progress');
      budget+=40;
    }
  }
  const scoreboard=document.scoreboard;
  if(scoreboard){
    if(!id(scoreboard.id)||!text(scoreboard.title)||!isArray(scoreboard.columns)||scoreboard.columns.length<1||scoreboard.columns.length>4||
      !unique(scoreboard.columns.map(column=>column.id))||scoreboard.columns.some(column=>!id(column.id)||!text(column.label))||
      !isArray(scoreboard.rows)||scoreboard.rows.length>9||!unique(scoreboard.rows.map(row=>row.participantId))||
      scoreboard.rows.some(row=>!people.has(row.participantId)||!isArray(row.values)||row.values.length!==scoreboard.columns.length||row.values.some(value=>value!==null&&!Number.isFinite(value))||!badges(row.badges))||
      scoreboard.disclosure&&(!text(scoreboard.disclosure.openLabel)||!text(scoreboard.disclosure.closeLabel)))throw new Error('Invalid participant scoreboard');
    budget+=scoreboard.rows.length*(scoreboard.columns.length*2+8);
  }
  if(budget>700)throw new Error('Information composition budget exceeded');
}
