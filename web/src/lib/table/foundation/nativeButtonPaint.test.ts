import {expect,test} from 'vitest';
import {paintNativeButtonAvailability} from './nativeButtonPaint';
import type {PlannedNode} from './contracts';

const node=(patch:Partial<PlannedNode>={}):PlannedNode=>({id:'control',parent:null,kind:'choice',label:'Lead',enabled:true,box:{x:0,y:0,width:100,height:44},...patch});
test('disabled native choices lose the lip and use the established button treatment without replacing checked ink',()=>{
    for(const checked of [false,true]){
        const style={opacity:'',boxShadow:'',background:checked?'var(--ink)':'var(--btn)',color:checked?'var(--table)':'var(--ink)'};
        paintNativeButtonAvailability(style,node({checked,enabled:false}));
        expect(style).toEqual({opacity:'.4',boxShadow:'none',background:checked?'var(--ink)':'var(--btn)',color:checked?'var(--table)':'var(--ink)'});
        paintNativeButtonAvailability(style,node({checked,enabled:true}));
        expect(style.opacity).toBe('');expect(style.boxShadow).toBe('');
    }
});
test('native element reuse clears choice dimming while preserving command CSS and tab geometry',()=>{
    const style={opacity:'',boxShadow:''};
    paintNativeButtonAvailability(style,node({enabled:false}));
    paintNativeButtonAvailability(style,node({kind:'command',intent:'primary',enabled:false}));
    expect(style).toEqual({opacity:'',boxShadow:''}); // .btn.primary:disabled owns its neutral paint.
    paintNativeButtonAvailability(style,node({semanticRole:'tab',enabled:false}));
    expect(style).toEqual({opacity:'.4',boxShadow:'none'});
    paintNativeButtonAvailability(style,node({semanticRole:'tab',enabled:true}));
    expect(style).toEqual({opacity:'',boxShadow:'none'});
    paintNativeButtonAvailability(style,node());expect(style).toEqual({opacity:'',boxShadow:''});
});
test('toggles restore availability paint and inspectable or choice-card artwork remains untouched',()=>{
    const style={opacity:'',boxShadow:''};
    paintNativeButtonAvailability(style,node({kind:'toggle',enabled:false}));expect(style.opacity).toBe('.4');
    paintNativeButtonAvailability(style,node({kind:'toggle',enabled:true}));expect(style.opacity).toBe('1');
    for(const card of [node({kind:'card',enabled:false}),node({kind:'card',enabled:true,inspectCardId:'private-card'}),node({choiceCard:true,enabled:false})]){
        const artStyle={opacity:'0',boxShadow:'motion-owned'};
        paintNativeButtonAvailability(artStyle,card);expect(artStyle).toEqual({opacity:'0',boxShadow:'motion-owned'});
    }
});
