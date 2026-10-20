import type {Environment,InformationPanel,InformationValue,PlannedNode,TextRole} from './contracts';
import type {DisclosureCard,DisclosureCardRef,DisclosureDocument} from './disclosureTypes';
import type {DisclosureIntent,DisclosureView} from './disclosureView';
export interface DisclosureFragment {readonly width:number;readonly height:number;readonly nodes:readonly PlannedNode[];}
interface Placement {fragment:DisclosureFragment;x:number;y:number;}
export interface DisclosureLayoutKit {
 text(id:string,value:string,role:TextRole,width:number,intrinsic?:boolean):DisclosureFragment;
 button(id:string,label:string,width:number,intent:DisclosureIntent|undefined,extra?:Partial<PlannedNode>):DisclosureFragment;
 column(id:string,width:number,children:readonly DisclosureFragment[],gap?:number):DisclosureFragment;
 rows(id:string,width:number,children:readonly DisclosureFragment[],extra?:Partial<PlannedNode>):DisclosureFragment;
 group(id:string,width:number,height:number,placements:readonly Placement[],extra?:Partial<PlannedNode>):DisclosureFragment;
 information(document:DisclosureDocument,panel:InformationPanel,width:number,prefix:string):DisclosureFragment;
 value(document:DisclosureDocument,value:InformationValue,width:number,id:string):DisclosureFragment;
 card(id:string,card:DisclosureCard):DisclosureFragment;
}
const key=(...parts:string[])=>JSON.stringify(parts);
/** The matrix offset is an exact local cursor, never rounded to a page boundary. */
export function disclosureWindow(view:DisclosureView,environment:Environment){
 const width=Math.max(1,Math.min(environment.width-32,960*environment.textScale)),contentWidth=Math.max(1,width-32-(environment.scrollbarWidth??0));
 const section=view.selected?.sections.find(section=>section.id===view.sectionId)??view.selected?.sections[0];
 const start=section?.kind==='matrix'?Math.max(0,Math.min(view.matrixStart,Math.max(0,section.columns.length-1))):0;
 const labelWidth=Math.min(contentWidth*.42,Math.max(72,112*environment.textScale));
 const columnCount=Math.max(1,Math.min(6,Math.floor((contentWidth-labelWidth-8)/72)));
 return {width,contentWidth,section,start,labelWidth,columnCount,round:section?.kind==='rounds'?section.rounds[Math.max(0,Math.min(view.roundIndex,section.rounds.length-1))]:undefined};
}
/** Only the active section/window is materialized; archives and unused card-library rows remain inert data. */
export function createDisclosureDialog(view:DisclosureView,environment:Environment,kit:DisclosureLayoutKit):DisclosureFragment {
 const window=disclosureWindow(view,environment),{width,contentWidth:w,section}=window,lease=view.leaseId,doc=view.selected,prefix=key('disclosure',lease),panelId=key('disclosure-panel',lease);
 const id=(...parts:string[])=>key(prefix,...parts),text=(suffix:string,value:string,role:TextRole='body',allocation=w)=>kit.text(id(suffix),value,role,allocation);
 const command=(suffix:string,label:string,intent:DisclosureIntent,enabled=true,extra:Partial<PlannedNode>={})=>kit.button(id(suffix),label,w,intent,{enabled,intent:'quiet',...extra});
 const close=command('close','닫기',{kind:'close',leaseId:lease});
 // Natural measured children share a row when they fit; narrow views wrap
 // without shrinking text, hit targets, or historical artwork.
 const title=kit.text(id('title'),doc?.title??view.title,'name',w,true);
 const measuredRow=(rowId:string,parts:DisclosureFragment[],end=false)=>{
  if(parts.reduce((sum,part)=>sum+part.width,0)+8*(parts.length-1)>w)return kit.rows(rowId,w,parts);
  const height=Math.max(...parts.map(part=>part.height));let x=0;
  return kit.group(rowId,w,height,parts.map((fragment,index)=>{const placement={fragment,x:end&&index===parts.length-1?w-fragment.width:x,y:(height-fragment.height)/2};x+=fragment.width+8;return placement;}));
 };
 const children:DisclosureFragment[]=[measuredRow(id('heading'),[title,close],true)];
 let fitMatrixSpacing:((overflow:number)=>number)|undefined;
 if(view.error)children.push(text('error',view.error));
 if(view.pending){
  if(view.pending.status==='loading')children.push(text('loading','기록을 불러오는 중이에요'));
  children.push(command('back','기록 목록',{kind:'back',leaseId:lease},view.canReturnToCatalog!==false));
 }else if(!doc){
  const page=view.page;
  if(!page)children.push(text('loading','기록을 불러오는 중이에요'));
  else {
   if(!page.entries.length)children.push(text('empty','아직 기록이 없어요'));
   let previousGroup:string|undefined;
   for(const entry of page.entries){if(entry.group&&entry.group.id!==previousGroup){children.push(text(`group:${entry.group.id}`,entry.group.title,'name'));previousGroup=entry.group.id;}
    children.push(command(`entry:${entry.id}`,entry.title,{kind:'entry',leaseId:lease,entryId:entry.id}));if(entry.description)children.push(text(`description:${entry.id}`,entry.description,'small'));
   }
   const pages=Math.max(1,Math.ceil(page.total/page.pageSize));
   children.push(text('page',`${page.page+1} / ${pages}`,'small'),kit.rows(id('pages'),w,[command('previous-page','이전 페이지',{kind:'catalog-page',leaseId:lease,page:page.page-1},page.page>0),command('next-page','다음 페이지',{kind:'catalog-page',leaseId:lease,page:page.page+1},page.page+1<pages)]));
  }
 }else{
  const entryId=doc.entryId,person=(personId:string)=>doc.roster.find(person=>person.id===personId)?.name??'—',cards=new Map(doc.cards.map(card=>[card.id,card]));
  const index=view.page?.entries.findIndex(entry=>entry.id===entryId)??-1;
  const singleton=view.page?.total===1&&view.page.entries.length===1&&index===0;
  if(!singleton)children.push(kit.rows(id('records'),w,[command('back','기록 목록',{kind:'back',leaseId:lease},view.canReturnToCatalog!==false),command('previous-record','이전 기록',{kind:'record-step',leaseId:lease,entryId,direction:-1},index>=0&&(index>0||(view.page?.page??0)>0)),command('next-record','다음 기록',{kind:'record-step',leaseId:lease,entryId,direction:1},!!view.page&&index>=0&&view.page.page*view.page.pageSize+index+1<view.page.total)]));
  children.push(kit.rows(id('tabs'),w,doc.sections.map(item=>command(`tab:${item.id}`,item.title,{kind:'section',leaseId:lease,entryId,sectionId:item.id},true,{semanticRole:'tab',checked:item.id===section?.id,controlsId:panelId})),{semanticRole:'tablist',label:'기록 항목'}));
  const content:DisclosureFragment[]=[];
  const tile=(reference:DisclosureCardRef,tileId:string,tileWidth:number,name?:string)=>{
   const card=cards.get(reference.cardId),parts:DisclosureFragment[]=[];
   if(name)parts.push(kit.text(key(tileId,'person'),name,'name',tileWidth));
   if(card)parts.push(kit.card(key(tileId,'art'),card));
   const flags=[reference.leader?'선공':'',reference.winner?'승리':'',...(reference.annotations??[]).map(annotation=>annotation.text)].filter(Boolean).join(' · ');
   if(flags)parts.push(kit.text(key(tileId,'flags'),flags,'small',tileWidth));
   if(reference.lead)parts.push(kit.value(doc,reference.lead,tileWidth,key(tileId,'lead')));
   return kit.column(tileId,tileWidth,parts,4);
  };
  if(!section)content.push(text('empty-section','표시할 내용이 없어요'));
  else if(section.kind==='content'){
   for(const panel of section.information??[])content.push(kit.information(doc,panel,w,id(`information:${section.id}:${panel.id}`)));
   const groups=(section.cardGroups??[]).map(group=>{
    const labels=[{suffix:`group-label:${group.id}`,value:group.label,role:'name' as TextRole},...(group.personId&&person(group.personId)!==group.label?[{suffix:`group-person:${group.id}`,value:person(group.personId),role:'name' as TextRole}]:[]),...(group.description?[{suffix:`group-description:${group.id}`,value:group.description,role:'small' as TextRole}]:[])];
    return {group,labels,art:group.cardIds.map((cardId,index)=>tile({cardId},id(`card:${group.id}:${index}`),64))};
   });
   const labelWidth=Math.max(0,...groups.flatMap(({labels})=>labels.map(label=>kit.text(id(label.suffix),label.value,label.role,w,true).width)));
   const cardMinimum=Math.max(0,...groups.flatMap(({art})=>art.map(card=>card.width))),adjacent=cardMinimum>0&&labelWidth+12+cardMinimum<=w;
   for(const {group,labels,art} of groups){
    // A label already naming this person is one identity, not two headings.
    // Shared measured metadata keeps every participant's cards on one column.
    const heading=kit.column(id(`group-heading:${group.id}`),adjacent?labelWidth:w,labels.map(label=>kit.text(id(label.suffix),label.value,label.role,adjacent?labelWidth:w)),8);
    const cardRow=kit.rows(id(`cards:${group.id}`),adjacent?w-labelWidth-12:w,art);
    content.push(adjacent?kit.group(id(`group:${group.id}`),w,Math.max(heading.height,cardRow.height),[{fragment:heading,x:0,y:0},{fragment:cardRow,x:labelWidth+12,y:0}]):kit.column(id(`group:${group.id}`),w,[heading,cardRow],8));
   }
  }else if(section.kind==='rounds'){
   const round=window.round,index=round?section.rounds.indexOf(round):0;
   content.push(text('round-index',`${section.rounds.length?index+1:0} / ${section.rounds.length}`,'small'),kit.rows(id('round-navigation'),w,[command('previous-round','이전 라운드',{kind:'round',leaseId:lease,entryId,sectionId:section.id,index:index-1},index>0),command('next-round','다음 라운드',{kind:'round',leaseId:lease,entryId,sectionId:section.id,index:index+1},index+1<section.rounds.length)]));
   if(round){content.push(text(`round:${round.id}`,round.title,'name'));if(round.summary)content.push(text('round-summary',round.summary));if(round.lead)content.push(kit.value(doc,round.lead,w,id('round-lead')));const tileWidth=Math.min(w,Math.max(96,Math.min(160*environment.textScale,(w-8)/2)));content.push(kit.rows(id('round-plays'),w,round.plays.map((play,index)=>tile(play,id(`play:${index}`),tileWidth,person(play.personId)))));}else content.push(text('no-rounds','아직 라운드가 없어요'));
  }else{
   const visible=section.columns.slice(window.start,window.start+window.columnCount),colWidth=visible.length?(w-window.labelWidth-8*(visible.length))/visible.length:64;
   content.push(measuredRow(id('matrix-navigation'),[kit.text(id('matrix-index'),`${visible.length?window.start+1:0}–${window.start+visible.length} / ${section.columns.length}`,'small',w,true),command('previous-columns','이전 열',{kind:'matrix-page',leaseId:lease,entryId,sectionId:section.id,start:Math.max(0,window.start-window.columnCount)},window.start>0),command('next-columns','다음 열',{kind:'matrix-page',leaseId:lease,entryId,sectionId:section.id,start:window.start+visible.length},window.start+visible.length<section.columns.length)]));
   const row=(rowId:string,cells:DisclosureFragment[],role:'row'='row')=>kit.group(rowId,w,Math.max(0,...cells.map(cell=>cell.height)),cells.map((fragment,index)=>({fragment,x:index===0?0:window.labelWidth+8+(index-1)*(colWidth+8),y:0})),{semanticRole:role});
   const semantic=(fragment:DisclosureFragment,role:'rowheader'|'columnheader'|'cell')=>({...fragment,nodes:[{...fragment.nodes[0],semanticRole:role,kind:'group' as const},...fragment.nodes.slice(1)]});
   const cellText=(cellId:string,label:string,allocation:number,role:'rowheader'|'columnheader'|'cell')=>semantic(kit.column(cellId,allocation,[kit.text(key(cellId,'text'),label,'small',allocation)],0),role);
   const blankCell=(cellId:string)=>{const blank=cellText(cellId,'—',colWidth,'cell');return {...blank,nodes:[{...blank.nodes[0],label:'카드 없음'},...blank.nodes.slice(1)]};};
   const matrixRows=[row(id('matrix-head'),[cellText(id('matrix-person-heading'),'참가자',window.labelWidth,'columnheader'),...visible.map(column=>cellText(id(`column:${column.id}`),column.label,colWidth,'columnheader'))])];
   for(const [index,item]of section.rows.entries()){matrixRows.push(row(id(`matrix-row:${index}`),[cellText(id(`row-name:${index}`),person(item.personId),window.labelWidth,'rowheader'),...visible.map((column,offset)=>{const reference=item.cells[window.start+offset];return reference?semantic(tile(reference,id(`cell:${index}:${column.id}`),colWidth),'cell'):blankCell(id(`cell:${index}:${column.id}`));})]));}
   const matrixIndex=content.length,panelIndex=children.length;
   const matrixAt=(gap:number)=>{const matrix=kit.column(id('matrix'),w,matrixRows,gap);return {...matrix,nodes:[{...matrix.nodes[0],semanticRole:'table' as const,label:section.title},...matrix.nodes.slice(1)]};};
   content.push(matrixAt(8));
   // Preserve measured card/text heights. Only inter-row breathing room yields
   // to the viewport, down to the design system's smallest spacing token.
   // Whole-pixel gaps round down so allocation never exceeds its height budget.
   fitMatrixSpacing=overflow=>{
    const rowGaps=Math.max(0,matrixRows.length-1),gap=Math.max(4,Math.floor(8-overflow/Math.max(1,rowGaps)));content[matrixIndex]=matrixAt(gap);
    const remaining=Math.max(0,overflow-(8-gap)*rowGaps),panelGaps=Math.max(0,content.length-1),panelGap=Math.max(4,Math.floor(12-remaining/Math.max(1,panelGaps)));
    const panel=kit.column(panelId,w,content,panelGap);children[panelIndex]={...panel,nodes:[{...panel.nodes[0],semanticRole:'tabpanel',label:section.title},...panel.nodes.slice(1)]};
    return Math.max(0,remaining-(12-panelGap)*panelGaps);
   };
  }
  if(!content.length)content.push(text('empty-content','표시할 내용이 없어요'));
  const panel=kit.column(panelId,w,content,12);children.push({...panel,nodes:[{...panel.nodes[0],semanticRole:'tabpanel',label:section?.title??'기록 내용'},...panel.nodes.slice(1)]});
  const formActions=(view.formActions??[]).map(action=>kit.button(id(`form-action:${action.id}`),action.label,w,undefined,{enabled:true,intent:action.intent,disclosureFormActionId:action.id}));
  if(formActions.length)children.push(kit.rows(id('form-actions'),w,formActions));
 }
 let content=kit.column(id('content'),w,children,12);
 const overflow=content.height-Math.max(1,environment.height-64);
 if(overflow>0&&fitMatrixSpacing){const remaining=fitMatrixSpacing(overflow),gap=Math.max(4,Math.floor(12-remaining/Math.max(1,children.length-1)));content=kit.column(id('content'),w,children,gap);}
 const height=Math.max(1,Math.min(environment.height-32,content.height+32));
 const viewport=kit.group(key('disclosure-viewport',lease),width-32,Math.max(1,height-32),[{fragment:content,x:0,y:0}],{scroll:true,scrollAxis:'y',semanticRole:'group',label:'기록 내용',scrollbarGutter:environment.scrollbarWidth??0,scrollResetKey:JSON.stringify([view.page?.page,section?doc!.sections.indexOf(section):-1,view.roundIndex,view.matrixStart])});
 return kit.group(key('disclosure-dialog',lease),width,height,[{fragment:viewport,x:16,y:16}],{semanticRole:'dialog',label:doc?.title??view.title,decoration:'dialog',modalLeaseId:lease});
}
