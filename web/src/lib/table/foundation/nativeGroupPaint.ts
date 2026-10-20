import type {PlannedNode} from './contracts';
type GroupPaintNode=Pick<PlannedNode,'kind'|'parent'|'decoration'|'participantStatusFor'|'appearance'|'tone'>;
type GroupSurface=Pick<CSSStyleDeclaration,'outline'|'outlineOffset'|'borderRadius'|'boxShadow'|'background'|'color'>;
/** Engine surfaces reuse the original design tokens. This paint owns no
 * padding/border dimensions; the measured composition owns every inset. */
export function paintNativeGroupSurface(style:GroupSurface,node:GroupPaintNode):void {
 if(node.kind!=='group')return;
 style.outline=node.decoration==='tray'?'3px solid var(--accent)':'';
 style.outlineOffset=node.decoration==='tray'?'-3px':'';
 const roleTeam=node.decoration==='pill'&&node.participantStatusFor?node.appearance?.team:null;
 const teamPill=roleTeam==='defense'?'defense':roleTeam==='declarer'||roleTeam==='friend'?'declarer':null;
 // Only the persistent identity row overlaps the robe. Announcement and
 // reaction surfaces deliberately retain their separate paint recipes.
 const standingPill=node.decoration==='pill'&&!!node.participantStatusFor&&node.parent===JSON.stringify(['identity-meta-content',node.participantStatusFor]);
 const countPill=standingPill&&!teamPill&&node.tone!=='accent';
 const accentPill=node.decoration==='pill'&&node.tone==='accent'&&!teamPill,prompt=node.decoration==='prompt'||node.decoration==='announcement';
 style.borderRadius=node.decoration==='pill'||prompt?'var(--r-pill)':node.decoration?'var(--r-panel)':'';
 style.boxShadow=standingPill&&teamPill?'0 0 0 2px var(--table)':countPill?'0 0 0 1px var(--line)':node.decoration==='result'?'var(--lip)':prompt?'inset 0 0 0 1px var(--card-edge), var(--lip)':node.decoration==='pill'&&!teamPill&&!accentPill?'inset 0 0 0 1px var(--line)':'';
 style.background=countPill?'var(--table)':prompt?'var(--card)':teamPill?`var(--team-${teamPill})`:accentPill?'var(--accent)':node.decoration==='panel'||node.decoration==='result'?'var(--panel)':node.decoration==='callout'?`color-mix(in srgb, var(${node.tone==='gold'?'--gold':node.tone==='danger'?'--danger':'--accent'}) 12%, var(--panel))`:'';
 style.color=countPill?'var(--ink)':prompt?'var(--card-ink)':teamPill?`var(--on-team-${teamPill})`:accentPill?'var(--on-accent)':'';
}
