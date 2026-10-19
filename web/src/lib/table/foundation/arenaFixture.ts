import {proofDocument} from './fixtures';
/** Synthetic whole-table pressure fixture; games still supply no geometry. */
export function arenaDocument(options:Parameters<typeof proofDocument>[0]={}){
    const base=proofDocument(options);
    return {...base,
        opponents:['모과','호두','보리','단추'].map((name,index)=>({id:`peer-${index}`,name:options?.longName?`${name} · 여러 줄로 표시되는 긴 참가자 이름`:name,handCount:10,appearance:{bot:true}})),
        collections:[{id:'trick',label:'현재 트릭',purpose:'play' as const,cards:base.hand.slice(0,3).map(card=>({...card,id:`public-${card.id}`}))}],
        facts:[
            {id:'status',label:'상태',value:'내 차례',subject:'table' as const,essential:true},
            {id:'phase',label:'단계',value:'공약 고르기 · 합성 배치 검증',subject:'table' as const,essential:true},
            {id:'contract',label:'기루다',value:'스페이드 · 공약 17',subject:'table' as const,essential:true},
            {id:'scores',label:'누적 점수',value:'재용 0 · 모과 0 · 호두 0 · 보리 0 · 단추 0',subject:'table' as const,essential:true},
        ],
    };
}
