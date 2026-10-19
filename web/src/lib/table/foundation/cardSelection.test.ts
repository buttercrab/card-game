import { describe, expect, it } from 'vitest';
import type { ActionOffer, CommandSpec } from '../presentation';
import { availableCardIds, selectedCardAction, toggleCards, validateCardSelection, type CardSelectionDecision } from './cardSelection';

const action = (id: string, enabled = true): CommandSpec<string> => Object.freeze({ kind: 'command', id, label: id, intent: 'primary', enabled, action: id });
const offer: ActionOffer<string> = Object.freeze({ id: 'offer', actions: Object.freeze([action('pass'), action('ab'), action('ac'), action('d', false)]) });
const decision: CardSelectionDecision = Object.freeze({ kind: 'card-selection', id: 'discard', mode: 'many', commands: Object.freeze(['pass']), submit: Object.freeze({ prefix: 'Discard' }), variants: Object.freeze([
    Object.freeze({ cardIds: Object.freeze(['a', 'b']), actionId: 'ab' }),
    Object.freeze({ cardIds: Object.freeze(['a', 'c']), actionId: 'ac' }),
    Object.freeze({ cardIds: Object.freeze(['d']), actionId: 'd' }),
]) });
const hand = ['a', 'b', 'c', 'd', 'unused'];

describe('exact offered card selection', () => {
    it('validates sparse enabled and disabled sets without inventing combinations', () => {
        expect(validateCardSelection(decision, offer, hand)).toEqual([]);
        expect(availableCardIds(decision, offer, [])).toEqual(['a', 'b', 'c']);
        expect(toggleCards(decision, offer, [], 'b')).toEqual(['b']);
        expect(availableCardIds(decision, offer, ['b'])).toEqual(['a', 'b']);
        expect(toggleCards(decision, offer, ['b'], 'c')).toBeNull();
        expect(toggleCards(decision, offer, ['a', 'b'], 'c')).toBeNull();
        for (const selected of [[], ['b'], ['b', 'c'], ['a', 'b', 'c']]) expect(selectedCardAction(decision, offer, selected)).toBeNull();
    });
    it('matches unordered exact sets and returns the original offered command', () => {
        expect(selectedCardAction(decision, offer, ['b', 'a'])).toBe(offer.actions[1]);
        expect(selectedCardAction(decision, offer, ['c', 'a'])).toBe(offer.actions[2]);
    });
    it('rejects disabled variants and always permits deselection from valid drafts', () => {
        expect(toggleCards(decision, offer, [], 'd')).toBeNull();
        expect(selectedCardAction(decision, offer, ['d'])).toBeNull();
        expect(toggleCards(decision, offer, ['d'], 'd')).toEqual([]);
        expect(availableCardIds(decision, offer, ['d'])).toEqual(['d']);
        expect(toggleCards(decision, offer, ['b', 'c'], 'b')).toEqual(['c']);
    });
    it('one mode replaces rather than growing selection', () => {
        const single: CardSelectionDecision = { ...decision, mode: 'one', variants: [{ cardIds: ['a'], actionId: 'ab' }, { cardIds: ['b'], actionId: 'ac' }, { cardIds: ['d'], actionId: 'd' }] };
        expect(validateCardSelection(single, offer, hand)).toEqual([]);
        expect(toggleCards(single, offer, ['a'], 'b')).toEqual(['b']);
        expect(availableCardIds(single, offer, ['a'])).toEqual(['a', 'b']);
        expect(toggleCards(single, offer, ['a'], 'a')).toEqual([]);
        expect(toggleCards(single, offer, ['a', 'b'], 'a')).toBeNull();
    });
    it('does not mutate inputs and returns immutable drafts', () => {
        const selected = Object.freeze(['a']);
        const before = JSON.stringify({ decision, offer, selected, hand });
        expect(Object.isFrozen(toggleCards(decision, offer, selected, 'b'))).toBe(true);
        expect(Object.isFrozen(availableCardIds(decision, offer, selected))).toBe(true);
        expect(Object.isFrozen(validateCardSelection(decision, offer, hand))).toBe(true);
        expect(JSON.stringify({ decision, offer, selected, hand })).toBe(before);
    });
    it('rejects unknown, empty and duplicate draft cards', () => {
        for (const selected of [['unknown'], ['a', 'a'], ['']]) {
            expect(toggleCards(decision, offer, selected, 'a')).toBeNull();
            expect(selectedCardAction(decision, offer, selected)).toBeNull();
            expect(availableCardIds(decision, offer, selected)).toEqual([]);
        }
        for (const id of ['unknown', 'unused', '', ' ']) expect(toggleCards(decision, offer, [], id)).toBeNull();
    });
    it.each([
        ['decision id', { ...decision, id: '' }],
        ['commands', { ...decision, commands: ['pass', 'pass'] }],
        ['empty command id', { ...decision, commands: [''] }],
        ['missing command', { ...decision, commands: ['absent'] }],
        ['empty prefix', { ...decision, submit: { prefix: ' ' } }],
        ['empty variant', { ...decision, variants: [{ cardIds: [], actionId: 'ab' }] }],
        ['empty card id', { ...decision, variants: [{ cardIds: [''], actionId: 'ab' }] }],
        ['duplicate cards', { ...decision, variants: [{ cardIds: ['a', 'a'], actionId: 'ab' }] }],
        ['unknown card', { ...decision, variants: [{ cardIds: ['unknown'], actionId: 'ab' }] }],
        ['one-card cardinality', { ...decision, mode: 'one' as const }],
        ['ambiguous unordered set', { ...decision, variants: [{ cardIds: ['a', 'b'], actionId: 'ab' }, { cardIds: ['b', 'a'], actionId: 'ac' }] }],
        ['overlapping command', { ...decision, commands: ['ab'] }],
        ['overlapping variant action', { ...decision, variants: [{ cardIds: ['a'], actionId: 'ab' }, { cardIds: ['b'], actionId: 'ab' }] }],
        ['missing variant action', { ...decision, variants: [{ cardIds: ['a'], actionId: 'absent' }] }],
    ])('rejects invalid %s', (_label, spec) => {
        expect(validateCardSelection(spec, offer, hand).length).toBeGreaterThan(0);
    });
    it('fails closed for invalid offers and non-command bindings', () => {
        const malformed = { ...offer, actions: [{ ...action('ab'), label: ' ' }, ...offer.actions] };
        expect(validateCardSelection(decision, malformed, hand)).toContain('invalid action ids');
        expect(toggleCards(decision, malformed, [], 'a')).toBeNull();
        expect(selectedCardAction(decision, malformed, ['a', 'b'])).toBeNull();
        expect(availableCardIds(decision, malformed, [])).toEqual([]);
        expect(validateCardSelection(decision, { ...offer, id: '' }, hand).length).toBeGreaterThan(0);
        expect(validateCardSelection(decision, offer, ['a', 'a']).length).toBeGreaterThan(0);
        expect(validateCardSelection(decision, offer, ['', ...hand]).length).toBeGreaterThan(0);
        const numeric: ActionOffer<unknown> = { id: 'offer', actions: [{ kind: 'number', id: 'ab', label: 'number', intent: 'primary', enabled: true, min: 0, max: 1, step: 1, initial: 0, createAction: value => value }] };
        expect(validateCardSelection({ ...decision, commands: [], variants: [{ cardIds: ['a'], actionId: 'ab' }] }, numeric, hand)).toContain('invalid command binding: ab');
        expect(validateCardSelection(decision, { ...offer, actions: offer.actions.map(item => ({ ...item, label: ' ' })) }, hand)).toContain('missing action label: ab');
    });
    it('resolves every exact three-card discard from a thirteen-card hand', () => {
        const cards = Array.from({ length: 13 }, (_, index) => `card-${index}`);
        const variants: { cardIds: string[]; actionId: string }[] = [];
        for (let a = 0; a < cards.length; a++) for (let b = a + 1; b < cards.length; b++) for (let c = b + 1; c < cards.length; c++) {
            variants.push({ cardIds: [cards[a], cards[b], cards[c]], actionId: `discard-${a}-${b}-${c}` });
        }
        const discard: CardSelectionDecision = { ...decision, commands: [], variants };
        const offered: ActionOffer<string> = { id: 'discard-offer', actions: variants.map(variant => action(variant.actionId)) };
        expect(variants).toHaveLength(286);
        expect(validateCardSelection(discard, offered, cards)).toEqual([]);
        for (let index = 0; index < variants.length; index++) {
            const selected = [...variants[index].cardIds].reverse();
            expect(selectedCardAction(discard, offered, selected)).toBe(offered.actions[index]);
            expect(availableCardIds(discard, offered, selected)).toEqual(cards.filter(card => selected.includes(card)));
        }
        expect(toggleCards(discard, offered, cards.slice(0, 3), cards[3])).toBeNull();
        expect(selectedCardAction(discard, offered, cards.slice(0, 2))).toBeNull();
        expect(availableCardIds(discard, offered, cards.slice(0, 2))).toHaveLength(13);
    });
    it('allows no offered sets as an unavailable decision', () => {
        const empty = { ...decision, variants: [] };
        expect(validateCardSelection(empty, offer, hand)).toEqual([]);
        expect(availableCardIds(empty, offer, [])).toEqual([]);
        expect(selectedCardAction(empty, offer, [])).toBeNull();
    });
});

it('explicit disambiguation permits shared sets while preserving exact action identity and disabled options',async()=>{
    const {selectedCardActions,cardSelectionAuthority}=await import('./cardSelection');
    const shared:CardSelectionDecision={...decision,mode:'one',disambiguation:'choose-action',commands:[],variants:[{cardIds:['a'],actionId:'ab'},{cardIds:['a'],actionId:'ac'},{cardIds:['a'],actionId:'d'}]};
    expect(validateCardSelection(shared,offer,hand)).toEqual([]);
    expect(selectedCardActions(shared,offer,['a'])).toEqual(offer.actions.slice(1));
    expect(selectedCardAction(shared,offer,['a'])).toBeNull();
    expect(selectedCardAction(shared,offer,['a'],'ac')).toBe(offer.actions[2]);
    expect(selectedCardAction(shared,offer,['a'],'d')).toBeNull();
    expect(selectedCardAction(shared,offer,['a'],'pass')).toBeNull();
    expect(validateCardSelection({...shared,disambiguation:undefined},offer,hand)).toContain('ambiguous variant card set');
    expect(validateCardSelection({...shared,variants:[shared.variants[0],shared.variants[0]]},offer,hand)).toContain('overlapping action binding: ab');
    const count={...shared,mode:'count',count:1};
    expect(validateCardSelection(count as unknown as CardSelectionDecision,offer,hand)).toContain('invalid card action disambiguation');
    const onlyOneEnabled={...offer,actions:offer.actions.map(action=>({...action,enabled:action.id==='ab'}))};
    expect(selectedCardAction(shared,onlyOneEnabled,['a'])).toBeNull();
    const many={...shared,mode:'many' as const,variants:shared.variants.map(row=>({...row,cardIds:['a','b']}))};
    expect(validateCardSelection(many,offer,hand)).toEqual([]);expect(selectedCardAction(many,offer,['b','a'],'ac')).toBe(offer.actions[2]);
    const doc={context:{session:'s',audience:'a',generation:'g',revision:'1'},offer,decision:shared,hand:hand.map(id=>({id}))} as unknown as import('./contracts').TableDocument<string>;
    expect(cardSelectionAuthority({...doc,decision:{...shared,disambiguation:undefined}})).not.toBe(cardSelectionAuthority(doc));
});

it('runtime owns action drafts, requires explicit confirmation and clears authority changes',async()=>{
 const {createCardSession}=await import('./session'),{createCardTable}=await import('./runtime'),{vi}=await import('vitest');
 type Doc=import('./contracts').TableDocument<{native:string}>;
 const source:Doc={context:{session:'s',audience:'p',generation:'g',revision:'1'},participant:{id:'p',name:'P',markers:[]},interaction:{cardActivation:'single'},hand:['a','b'].map(id=>({id,label:id,visual:{kind:'standard',suit:'Spade',rank:2}})),facts:[],decision:{kind:'card-selection',id:'d',mode:'one',disambiguation:'choose-action',commands:[],variants:[{cardIds:['a'],actionId:'normal'},{cardIds:['a'],actionId:'call'},{cardIds:['a'],actionId:'disabled'},{cardIds:['b'],actionId:'other'}],submit:{prefix:'Play'}},offer:{id:'o',actions:['normal','call','disabled','other'].map(id=>({kind:'command',id,label:id,intent:'primary',enabled:id!=='disabled',action:{native:id}}))}};
 const send=vi.fn(),session=createCardSession<{native:string}>({transport:send});session.receive(source);
 let callbacks:import('./contracts').SurfaceCallbacks;let view:import('./contracts').ChoiceView;
 const {planTable}=await import('./planner');
 const table=createCardTable({session,planner:(doc,env,choices,metrics)=>{view=choices;return planTable(doc,env,choices,metrics);}});
 table.attach({identity:{},environment:()=>({width:500,height:700,revision:'1',fontRevision:'1',fontFamily:'sans-serif',textScale:1,controls:{command:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1},choice:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:14,paddingY:8,minHeight:40,pulse:1}}}),listen(next){callbacks=next;return()=>{};},measure(requests,reply){reply(requests.map(request=>{const natural=request.text.length*8,width=request.width??natural;return {key:request.key,size:{width:Math.min(natural,width),height:Math.max(1,Math.ceil(natural/Math.max(1,width)))*20}};}));return()=>{};},publish:()=>{},disarm:()=>{},invalidate:()=>{},fallback:reason=>{throw Error(reason);},clear:()=>{}});
 const activate=(nodeId:string,frameId=table.inspect().frame!.id)=>callbacks.intent({kind:'activate',nodeId,frameId,provenance:'direct'});
 activate(JSON.stringify(['hand','card','a']));expect(view!.cards?.actionVariants?.map(row=>row.id)).toEqual(['normal','call','disabled']);expect(view!.selected?.enabled).toBe(false);expect(send).not.toHaveBeenCalled();
 activate('card-action-open');activate('card-action-confirm');activate(JSON.stringify(['card-action-option','disabled']));expect(view!.cards?.selectedActionId).toBeUndefined();
 activate(JSON.stringify(['card-action-option','call']));expect(view!.cards?.selectedActionId).toBe('call');expect(view!.selected).toMatchObject({id:'call',enabled:true});expect(send).not.toHaveBeenCalled();
 const stale=table.inspect().frame!.id;
 session.receive({...source,context:{...source.context,revision:'2'},offer:{...source.offer,actions:source.offer.actions.map(action=>({...action,label:`new ${action.label}`}))}});
 expect(view!.cards?.selectedActionId).toBe('call');expect(view!.selected?.label).toBe('Play new call');
 activate('card-action-confirm',stale);expect(send).not.toHaveBeenCalled();
 table.back();activate(JSON.stringify(['hand','card','a']));expect(view!.cards?.selectedActionId).toBeUndefined();expect(view!.cards?.selected).toEqual([]);expect(send).not.toHaveBeenCalled();
 activate(JSON.stringify(['hand','card','a']));activate('card-action-open');activate(JSON.stringify(['card-action-option','normal']));expect(view!.cards?.selectedActionId).toBe('normal');
 session.receive({...source,context:{...source.context,revision:'3'},offer:{...source.offer,actions:source.offer.actions.map(action=>({...action,action:{native:`changed:${action.id}`}}))}});
 expect(view!.cards?.selectedActionId).toBeUndefined();expect(view!.cards?.selected).toEqual([]);
 activate(JSON.stringify(['hand','card','a']));activate('card-action-open');activate(JSON.stringify(['card-action-option','call']));const canonical=session.snapshot().document!.offer.actions[1];activate('card-action-confirm');await Promise.resolve();expect(send).toHaveBeenCalledTimes(1);expect(send.mock.calls[0][0].action).toBe(canonical.kind==='command'?canonical.action:null);
 table.dispose();session.dispose();
});
