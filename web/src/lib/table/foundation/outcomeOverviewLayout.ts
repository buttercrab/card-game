import type {Environment,InformationValue,PlannedNode,Size,TextRole} from './contracts';
import type {DisclosureCard,DisclosureDocument} from './disclosureTypes';
import type {DisclosureFragment,DisclosureLayoutKit} from './disclosureLayout';
import {ownOutcomeOverview} from './outcomeOverview';
export interface OutcomeOverviewLayoutKit extends Pick<DisclosureLayoutKit,'text'|'group'|'column'|'rows'>{
 measureText(label:string,role:TextRole):Size;
 card(id:string,card:DisclosureCard,width:number,height:number):DisclosureFragment;
}
const key=(...parts:string[])=>JSON.stringify(parts);
function columnWidths(document:DisclosureDocument,allocationWidth:number,measureText:OutcomeOverviewLayoutKit['measureText']):number[]{
 const section=document.sections[0];if(section.kind!=='matrix')throw Error('Invalid outcome overview matrix');const cardWidth=allocationWidth<240?16:24;
 return section.columns.map(column=>{const size=measureText(column.shortLabel??column.label,'small');if(!size||![size.width,size.height].every(Number.isFinite)||size.width<0||size.height<0)throw Error('Invalid overview column metric');return Math.max(cardWidth,size.width);});
}
/** Measured lower bound for this allocation's chosen artwork density. Shared
 * with arena allocation; it neither shrinks text nor assumes a column count. */
export function outcomeOverviewMinimumWidth(input:DisclosureDocument,allocationWidth:number,environment:Environment,measureText:OutcomeOverviewLayoutKit['measureText']):number{
 if(!Number.isFinite(allocationWidth)||allocationWidth<=0||!Number.isFinite(environment.textScale)||environment.textScale<=0)throw Error('Invalid outcome overview allocation');
 const widths=columnWidths(ownOutcomeOverview(input),allocationWidth,measureText);return widths.reduce((sum,value)=>sum+value,0)+Math.max(0,widths.length-1);
}
/** Dense current-result artwork. Names and references resolve exclusively
 * against the owned public overview, never the live table participant map. */
export function createOutcomeOverviewLayout(input:DisclosureDocument,width:number,environment:Environment,kit:OutcomeOverviewLayoutKit):DisclosureFragment{
 if(!Number.isFinite(width)||width<=0||!Number.isFinite(environment.textScale)||environment.textScale<=0||!Number.isFinite(environment.scrollbarHeight??0)||(environment.scrollbarHeight??0)<0)throw Error('Invalid outcome overview allocation');
 const document=ownOutcomeOverview(input),matrix=document.sections[0];if(matrix.kind!=='matrix')throw Error('Invalid outcome overview matrix');
 const prefix=key('outcome-overview',document.entryId),id=(...parts:string[])=>key(prefix,...parts),gap=0,cardWidth=width<240?16:24,cardHeight=Math.round(cardWidth*90/64);
 const people=new Map(document.roster.map(person=>[person.id,person])),cards=new Map(document.cards.map(card=>[card.id,card]));
 const widths=columnWidths(document,width,kit.measureText);
 const glyphWidth=widths.reduce((sum,value)=>sum+value,0),columnGap=widths.length>1?Math.max(1,Math.min(4,(width-glyphWidth)/(widths.length-1))):0;
 const natural=glyphWidth+Math.max(0,widths.length-1)*columnGap,contentWidth=Math.max(width,natural),extra=widths.length?(contentWidth-natural)/widths.length:0;
 const columns=widths.map(value=>value+extra),positions:number[]=[];let x=0;for(const allocation of columns){positions.push(x);x+=allocation+columnGap;}
 const text=(suffix:string,value:string,role:TextRole,allocation:number,center=false)=>{const fragment=kit.text(id(suffix),value,role,allocation);return center?{...fragment,nodes:fragment.nodes.map(node=>node.kind==='text'?{...node,textAlign:'center' as const}:node)}:fragment;};
 const atom=(value:InformationValue):string=>{
  if(value.kind==='inline')return value.values.map(atom).join(' ');
  if(value.kind==='participant')return people.get(value.participantId)?.name??'—';
  return value.kind==='text'?value.text:value.kind==='number'?String(value.value):value.label;
 };
 const headings=matrix.columns.map((column,index)=>{const label=text(`heading-text:${index}`,column.shortLabel??column.label,'small',columns[index],true);return kit.group(id(`heading:${index}`),columns[index],label.height,[{fragment:label,x:0,y:0}],{semanticRole:'columnheader',label:column.label});});
 const heading=kit.group(id('head'),contentWidth,Math.max(0,...headings.map(fragment=>fragment.height)),headings.map((fragment,index)=>({fragment,x:positions[index],y:0})),{semanticRole:'row',label:'라운드'});
 const rows:DisclosureFragment[]=[heading];
 for(const [rowIndex,row] of matrix.rows.entries()){
  const person=people.get(row.personId)!;
  const name=[person.name,...(person.badges??[]).map(badge=>badge.text)].join(' · '),nameText=text(`row-name-text:${rowIndex}`,name,'small',width);
  const nameCell=kit.group(id(`row-name:${rowIndex}`),contentWidth,nameText.height,[{fragment:nameText,x:0,y:0}],{semanticRole:'rowheader',label:name,...(matrix.columns.length?{columnSpan:matrix.columns.length}:{})});
  const cells=row.cells.map((reference,columnIndex)=>{
   const cellId=id(`cell:${rowIndex}:${columnIndex}`),column=matrix.columns[columnIndex],allocation=columns[columnIndex];
   if(!reference){const blank=text(`blank:${rowIndex}:${columnIndex}`,'—','small',allocation,true);return kit.group(cellId,allocation,Math.max(cardHeight,blank.height),[{fragment:blank,x:0,y:0}],{semanticRole:'cell',label:`${name} · ${column.label} · 카드 없음`});}
   const card=cards.get(reference.cardId)!,art=kit.card(key(cellId,'art'),card,cardWidth,cardHeight),flags=[reference.leader?'선공':'',reference.winner?'승리':'',...(reference.annotations??[]).map(annotation=>annotation.text),reference.lead?atom(reference.lead):''].filter(Boolean);
   const label=[name,column.label,card.label,...flags].join(' · ');
   return kit.group(cellId,allocation,Math.max(cardHeight,art.height),[{fragment:art,x:(allocation-art.width)/2,y:0}],{semanticRole:'cell',label,...(reference.winner?{decoration:'callout' as const,tone:'gold' as const}:{})});
  });
  const cellHeight=Math.max(cardHeight,...cells.map(fragment=>fragment.height)),nameRow=kit.group(id(`name-row:${rowIndex}`),contentWidth,nameCell.height,[{fragment:nameCell,x:0,y:0}],{semanticRole:'row',label:name}),cardRow=kit.group(id(`cards-row:${rowIndex}`),contentWidth,cellHeight,cells.map((fragment,index)=>({fragment,x:positions[index],y:0})),{semanticRole:'row',label:`${name} · 라운드 카드`}),rowHeight=nameCell.height+gap+cellHeight;
  rows.push(kit.group(id(`row:${rowIndex}`),contentWidth,rowHeight,[{fragment:nameRow,x:0,y:0},{fragment:cardRow,x:0,y:nameCell.height+gap}],{semanticRole:'rowgroup',label:name}));
 }
 const table=kit.column(id('matrix'),contentWidth,rows,2),semantic={...table,nodes:[{...table.nodes[0],semanticRole:'table' as const,label:matrix.title},...table.nodes.slice(1)]};
 const overflow=contentWidth>width+.1,viewport=kit.group(id('viewport'),width,table.height+(overflow?(environment.scrollbarHeight??0):0),[{fragment:semantic,x:0,y:0}],{readonlyMatrixViewport:true,...(overflow?{scroll:true,scrollAxis:'x' as const}:{}),semanticRole:'group',label:overflow?`${matrix.title} · 가로 스크롤`:matrix.title});
 // This is the primary settled matrix, not a separate record reader. Its
 // complete title remains on the accessible group/table without consuming a
 // second visual heading above the already labelled result workspace.
 const result=kit.group(id('overview'),width,viewport.height,[{fragment:viewport,x:0,y:0}],{semanticRole:'group',label:document.title});
 const prohibited:readonly(keyof PlannedNode)[]=['cardActionPickerIntent','cardActionOptionId','catalogueIntent','choiceLeaseId','entityId','ownerId','zoneId','recipientId','recipientCount','stockCount','ownHandAnchor','cardId','inspectCardId','actionId','fieldId','optionId','localIntent','shellActionId','shellIntent','formIntent','formField','formNavigation','editor','preference','assistanceIntent','disclosureIntent','disclosureCatalogId','disclosureFormActionId','modalLeaseId','feedbackDismissId','formActionId','formLeaseId','inspectionPreviewFor','recycleAnchor','recycleCaption','publicDisclosureEventId','clockPaint','figureCue'];
 if(result.nodes.length>4096||new Set(result.nodes.map(node=>node.id)).size!==result.nodes.length||result.nodes.some(node=>!['group','text','card'].includes(node.kind)||node.enabled!==undefined||prohibited.some(key=>node[key]!==undefined)))throw Error('Outcome overview contains live authority');
 return result;
}
