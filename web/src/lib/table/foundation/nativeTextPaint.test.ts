import {expect,test} from 'vitest';
import {paintNativeTextContent} from './nativeTextPaint';

type Child={nodeType:number;textContent:string;id?:string};
function control(){
    const children:Child[]=[];
    return {
        childNodes:children,
        dataset:{foundationFrame:'21',foundationNode:'submit',foundationAction:'play'},
        attributes:new Map([['aria-label','카드 내기']]),disabled:false,inert:false,
        get textContent(){return children.filter(child=>child.nodeType!==8).map(child=>child.textContent).join('');},
        set textContent(value:string|null){children.splice(0,children.length,...value?[{nodeType:3,textContent:value}]:[]);},
        removeChild(child:Child){const index=children.indexOf(child);if(index<0)throw new Error('Foreign child');return children.splice(index,1)[0];},
    };
}

test('text → typed caption → text → different caption reuse leaks no direct label or control authority',()=>{
    const element=control(),authority={dataset:{...element.dataset},attributes:new Map(element.attributes),disabled:element.disabled,inert:element.inert};
    paintNativeTextContent(element,'이전 확인');
    // The publication loop reuses these owned elements before painting their leaves.
    const prefix:Child={nodeType:1,id:'prefix',textContent:'내 차례'},remaining:Child={nodeType:1,id:'remaining',textContent:' · 카드를 누르세요'},art:Child={nodeType:1,id:'art',textContent:''},comment:Child={nodeType:8,textContent:'owned mount'};
    element.childNodes.push(prefix,remaining,art,comment,{nodeType:3,textContent:'stale adjacent'},{nodeType:3,textContent:'stale second'});
    paintNativeTextContent(element,'내 차례 · 카드를 누르세요',true);
    expect(element.childNodes).toEqual([prefix,remaining,art,comment]);
    expect(element.childNodes[0]).toBe(prefix);expect(element.childNodes[2]).toBe(art);
    expect(element.textContent).toBe('내 차례 · 카드를 누르세요');
    // A repeated caption publication must preserve nested text/art ownership.
    paintNativeTextContent(element,'ignored accessible full label',true);
    expect(element.childNodes).toEqual([prefix,remaining,art,comment]);
    paintNativeTextContent(element,'다음 확인');
    expect(element.childNodes).toEqual([{nodeType:3,textContent:'다음 확인'}]);
    paintNativeTextContent(element,'내 차례 · 한 번 더 누르세요',true);
    expect(element.childNodes).toEqual([]);
    prefix.textContent='내 차례';remaining.textContent=' · 한 번 더 누르세요';
    element.childNodes.push(prefix,remaining,art);
    expect(element.textContent).toBe('내 차례 · 한 번 더 누르세요');
    expect({dataset:element.dataset,attributes:element.attributes,disabled:element.disabled,inert:element.inert}).toEqual(authority);
});

test('planned child preparation removes every direct text node and nothing else',()=>{
    const element=control(),nested:Child={nodeType:1,id:'nested',textContent:'owned nested text'},comment:Child={nodeType:8,textContent:'mount'};
    element.childNodes.push({nodeType:3,textContent:'first'},nested,{nodeType:3,textContent:''},comment,{nodeType:3,textContent:'last'});
    paintNativeTextContent(element,'caption',true);
    expect(element.childNodes).toEqual([nested,comment]);expect(element.childNodes[0]).toBe(nested);expect(element.childNodes[1]).toBe(comment);
});
