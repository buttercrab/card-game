import type {Environment,InformationAtom,TextRole} from './contracts';

/** Public value meaning selects typography; labels never select a style. */
export function informationAtomRole(atom:InformationAtom,context:'value'|'primary'|'primary-inline'='value',override?:TextRole):TextRole {
 if(override)return override;
 if(context!=='value'&&atom.kind==='token')return 'information-token';
 if(context!=='value'&&atom.kind==='number')return 'information-number';
 if(context==='primary-inline'&&atom.kind==='text')return 'information-token';
 if(context==='primary'&&atom.kind==='text')return 'information-prose';
 return atom.kind==='participant'?'name':'body';
}
/** Font loading, native measurement and paint share this exact family owner. */
export function textFontFamily(role:TextRole,environment:Environment):string {
 return role==='art'||role==='display'||role==='information-number'?(environment.artFontFamily??environment.fontFamily):environment.fontFamily;
}
