import type {TableCard,TableDocument} from './contracts';
export type EssentialInputAction={readonly kind:'play';readonly cardId:string}|{readonly kind:'pass'}|{readonly kind:'deal'};
/** Non-vacuous native input fixture: twenty actionable local faces arrive at
 * their visible counted anchor while four independent peer backs remain. */
export function essentialInputDocument({revision=1,dealt=false}:{revision?:number;dealt?:boolean}={}):TableDocument<EssentialInputAction>{
 if(!Number.isSafeInteger(revision)||revision<1||typeof dealt!=='boolean')throw Error('Invalid essential input fixture');
 const cards:TableCard[]=dealt?Array.from({length:20},(_,index)=>({id:`essential-card-${index}`,label:`배분 카드 ${index+1}`,visual:{kind:'standard',suit:(['Spade','Heart','Diamond','Club'] as const)[Math.floor(index/13)],rank:index%13+2}})):[];
 const actions:TableDocument<EssentialInputAction>['offer']['actions']=dealt?[{id:'pass',kind:'command',label:'패스',intent:'secondary',enabled:true,action:{kind:'pass'}},...cards.map(card=>({id:`play:${card.id}`,kind:'command' as const,label:'카드 내기',intent:'primary' as const,enabled:true,action:{kind:'play' as const,cardId:card.id}}))]:[{id:'deal',kind:'command',label:'24장 배분',intent:'primary',enabled:true,action:{kind:'deal'}}];
 return{stage:'active',context:{session:'essential-input-proof',audience:'local',generation:'deal1',revision:String(revision)},participant:{id:'local',name:'입력 검증',markers:[]},opponents:Array.from({length:4},(_,index)=>({id:`peer-${index}`,name:`상대 ${index+1}`,handCount:dealt?1:0})),hand:cards,collections:[{id:'stock',label:'덱',purpose:'stock',hiddenCount:dealt?80:104,cards:[]}],facts:[],
  decision:dealt?{kind:'card-selection',id:'essential-play',commands:['pass'],mode:'one',variants:cards.map(card=>({cardIds:[card.id],actionId:`play:${card.id}`})),submit:{prefix:'선택 확정'}}:{kind:'commands',id:'essential-ready',commands:['deal']},
  offer:{id:`essential-input:${revision}`,actions},...(dealt?{deals:[{id:'essential-deal24',source:'stock',cardIds:cards.map(card=>card.id),recipients:Array.from({length:4},(_,index)=>({participantId:`peer-${index}`,count:1}))}]}:{})};
}
