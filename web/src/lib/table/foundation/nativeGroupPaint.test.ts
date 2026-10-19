import {expect,it} from 'vitest';
import {paintNativeGroupSurface} from './nativeGroupPaint';
import type {PlannedNode} from './contracts';
const node=(patch:Partial<PlannedNode>={}):PlannedNode=>({id:'surface',parent:null,kind:'group',label:'',box:{x:0,y:0,width:250,height:32},...patch});
const surface=()=>({outline:'',outlineOffset:'',borderRadius:'',boxShadow:'',background:'',color:''});
it('uses the original prompt paper tokens without adding any geometry or typography',()=>{
 const style={...surface(),padding:'unchanged',border:'unchanged',fontWeight:'unchanged',width:'250px',height:'32px'};
 paintNativeGroupSurface(style,node({decoration:'prompt'}));
 expect(style).toEqual({outline:'',outlineOffset:'',borderRadius:'var(--r-pill)',boxShadow:'inset 0 0 0 1px var(--card-edge), var(--lip)',background:'var(--card)',color:'var(--card-ink)',padding:'unchanged',border:'unchanged',fontWeight:'unchanged',width:'250px',height:'32px'});
});
it('clears prompt paint on reuse and preserves established panel, pill and tray surfaces',()=>{
 const style=surface();paintNativeGroupSurface(style,node({decoration:'prompt'}));
 paintNativeGroupSurface(style,node({decoration:'panel'}));expect(style).toMatchObject({background:'var(--panel)',color:'',borderRadius:'var(--r-panel)',boxShadow:''});
 paintNativeGroupSurface(style,node({decoration:'pill',tone:'accent'}));expect(style).toMatchObject({background:'var(--accent)',color:'var(--on-accent)',borderRadius:'var(--r-pill)',boxShadow:''});
 paintNativeGroupSurface(style,node({decoration:'pill'}));expect(style).toMatchObject({background:'',color:'',boxShadow:'inset 0 0 0 1px var(--line)'});
 paintNativeGroupSurface(style,node({decoration:'tray'}));expect(style).toMatchObject({outline:'3px solid var(--accent)',outlineOffset:'-3px',background:'',color:'',boxShadow:''});
 paintNativeGroupSurface(style,node());expect(style).toEqual(surface());
});
it('prompt reuse never retains role-team paint and non-group artwork is untouched',()=>{
 const style=surface();paintNativeGroupSurface(style,node({decoration:'pill',participantStatusFor:'peer',appearance:{team:'defense'}}));expect(style.background).toBe('var(--team-defense)');
 paintNativeGroupSurface(style,node({decoration:'prompt'}));expect(style.background).toBe('var(--card)');expect(style.color).toBe('var(--card-ink)');
 const art={...style};paintNativeGroupSurface(style,node({kind:'card'}));expect(style).toEqual(art);
});
it('result paper alone uses the original result panel radius and lip',()=>{const style=surface();paintNativeGroupSurface(style,node({decoration:'result'}));expect(style).toMatchObject({background:'var(--panel)',borderRadius:'var(--r-panel)',boxShadow:'var(--lip)'});paintNativeGroupSurface(style,node({decoration:'panel'}));expect(style.boxShadow).toBe('');});
it('permanent announcement bubbles reuse the original card-paper bid surface and clear on reuse',()=>{const style=surface();paintNativeGroupSurface(style,node({decoration:'announcement'}));expect(style).toMatchObject({background:'var(--card)',color:'var(--card-ink)',borderRadius:'var(--r-pill)',boxShadow:'inset 0 0 0 1px var(--card-edge), var(--lip)'});paintNativeGroupSurface(style,node({decoration:'pill',participantStatusFor:'p',appearance:{team:'friend'}}));expect(style.background).toBe('var(--team-declarer)');paintNativeGroupSurface(style,node({decoration:'announcement'}));expect(style.background).toBe('var(--card)');});
