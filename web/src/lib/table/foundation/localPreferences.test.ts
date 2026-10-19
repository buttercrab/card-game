import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
    settings: { fourColor: true, singleTap: false, tips: false, hints: true, haptics: true, sound: true, music: false, volume: 0.7, musicVolume: 0.5, speed: 'normal', textScale: 1, cardBack: 'charcoal', tableTone: 'hanji' },
    unlocked: {} as unknown,
}));
vi.mock('../../settings.svelte', () => ({ settings: state.settings }));
vi.mock('../../games/mighty/achievements', async importOriginal => {
    const original = await importOriginal<typeof import('../../games/mighty/achievements')>();
    return { ...original, loadUnlocked: () => state.unlocked };
});
import { validatePreferenceFields } from './roomShell';
import { applyLocalPreference, localCardActivation, localTextScale, projectLocalPreferences } from './localPreferences';

beforeEach(() => {
    Object.assign(state.settings, { fourColor: true, singleTap: false, tips: false, hints: true, haptics: true, sound: true, music: false, volume: 0.7, musicVolume: 0.5, speed: 'normal', textScale: 1, cardBack: 'charcoal', tableTone: 'hanji' });
    state.unlocked = {};
});

describe('host local preference whitelist', () => {
    it('projects bounded inert fields and all locked/unlocked cosmetic options', () => {
        const fields = projectLocalPreferences();
        validatePreferenceFields(fields);
        expect(fields).toHaveLength(13);
        expect(new Set(fields.map(field => field.id)).size).toBe(fields.length);
        expect(Object.isFrozen(fields)).toBe(true);
        for (const field of fields) {
            expect(field.id.length).toBeGreaterThan(0);
            expect(field.id.length).toBeLessThanOrEqual(128);
            expect(field.help?.length ?? 0).toBeLessThanOrEqual(500);
            expect(Object.isFrozen(field)).toBe(true);
            if (field.kind === 'select') {
                expect(field.options.length).toBeLessThanOrEqual(16);
                for (const option of field.options) {
                    expect(option.id.length).toBeLessThanOrEqual(128);
                    if (!option.enabled) expect(option.help).toContain('잠김');
                }
            }
        }
        expect(fields.find(field => field.label === '카드 뒷면')).toMatchObject({ options: expect.arrayContaining([
            expect.objectContaining({ id: 'back:01', enabled: true }), expect.objectContaining({ id: 'back:02', enabled: false }),
        ]) });
        expect(fields.find(field => field.label === '테이블 색')).toMatchObject({ options: expect.any(Array) });
    });

    it('maps every toggle explicitly without accepting underlying setting names', () => {
        for (const [id, key] of [['local:01', 'fourColor'], ['local:02', 'singleTap'], ['local:03', 'tips'], ['local:04', 'hints'], ['local:05', 'haptics'], ['local:06', 'sound'], ['local:08', 'music']] as const) {
            const value = !state.settings[key];
            expect(applyLocalPreference({ fieldId: id, value })).toBe(true);
            expect(state.settings[key]).toBe(value);
            expect(applyLocalPreference({ fieldId: key, value: !value })).toBe(false);
        }
        expect(applyLocalPreference({ fieldId: '__proto__', value: true })).toBe(false);
        expect(applyLocalPreference({ fieldId: 'local:01', value: 'true' })).toBe(false);
    });

    it('rechecks live audio enabling and rejects wrong types, nonfinite, out-of-range or off-step volume', () => {
        expect(applyLocalPreference({ fieldId: 'local:09', value: 0.6 })).toBe(false);
        expect(applyLocalPreference({ fieldId: 'local:08', value: true })).toBe(true);
        expect(applyLocalPreference({ fieldId: 'local:09', value: 0.6 })).toBe(true);
        for (const value of [-0.1, 1.1, 0.35, NaN, Infinity, '0.5', false]) {
            expect(applyLocalPreference({ fieldId: 'local:07', value })).toBe(false);
        }
        for (const value of [0, 0.3, 0.1 + 0.2, 1]) expect(applyLocalPreference({ fieldId: 'local:07', value })).toBe(true);
        applyLocalPreference({ fieldId: 'local:06', value: false });
        expect(applyLocalPreference({ fieldId: 'local:07', value: 0.5 })).toBe(false);
    });

    it('rechecks unlocks after projection and refuses raw or unknown option IDs', () => {
        state.unlocked = { 'first-win': 100, 'declarer-win': 101 };
        expect(projectLocalPreferences().find(field => field.id === 'local:10')).toMatchObject({ options: expect.arrayContaining([expect.objectContaining({ id: 'back:02', enabled: true })]) });
        state.unlocked = {};
        expect(applyLocalPreference({ fieldId: 'local:10', value: 'back:02' })).toBe(false);
        state.unlocked = { 'first-win': 100, 'declarer-win': 101 };
        expect(applyLocalPreference({ fieldId: 'local:10', value: 'back:02' })).toBe(true);
        expect(state.settings.cardBack).toBe('plum');
        expect(applyLocalPreference({ fieldId: 'local:11', value: 'tone:02' })).toBe(true);
        expect(state.settings.tableTone).toBe('celadon');
        for (const value of ['plum', 'back:99', true, 1]) expect(applyLocalPreference({ fieldId: 'local:10', value })).toBe(false);
        expect(applyLocalPreference({ fieldId: 'local:12', value: 'motion:02' })).toBe(true);
        expect(state.settings.speed).toBe('fast');
        expect(applyLocalPreference({ fieldId: 'local:12', value: 'off' })).toBe(false);
    });

    it('tolerates corrupt unlock storage without granting inherited or invalid unlocks', () => {
        for (const unlocked of [null, [], 'first-win', { 'first-win': 'yes' }, Object.create({ 'first-win': 100 })]) {
            state.unlocked = unlocked;
            expect(applyLocalPreference({ fieldId: 'local:10', value: 'back:02' })).toBe(false);
            expect(applyLocalPreference({ fieldId: 'local:10', value: 'back:01' })).toBe(true);
        }
    });

    it('derives card activation from the current host preference', () => {
        expect(localCardActivation()).toEqual({ cardActivation: 'repeat' });
        applyLocalPreference({ fieldId: 'local:02', value: true });
        expect(localCardActivation()).toEqual({ cardActivation: 'single' });
    });
});

it('projects a normalized stored volume into the exact declared number domain',async()=>{
 const {normalizeSettings}=await import('../../settingsValues');Object.assign(state.settings,normalizeSettings({volume:0.35,musicVolume:0.65,singleTap:'true'}));
 const fields=projectLocalPreferences();expect(()=>validatePreferenceFields(fields)).not.toThrow();
 expect(fields.find(field=>field.id==='local:07')).toMatchObject({value:0.4,step:0.1});expect(fields.find(field=>field.id==='local:09')).toMatchObject({value:0.7,step:0.1});
 expect(localCardActivation()).toEqual({cardActivation:'repeat'});
 Object.assign(state.settings,{volume:0.35,musicVolume:NaN,singleTap:'true'});expect(()=>validatePreferenceFields(projectLocalPreferences())).not.toThrow();expect(localCardActivation()).toEqual({cardActivation:'repeat'});
});


it('projects text size as opaque finite options and applies only the live whitelist',()=>{
 const field=projectLocalPreferences().find(field=>field.id==='local:13');expect(field).toEqual({id:'local:13',kind:'select',label:'글자 크기',enabled:true,value:'scale:01',options:[{id:'scale:01',label:'100%',enabled:true},{id:'scale:02',label:'125%',enabled:true},{id:'scale:03',label:'150%',enabled:true},{id:'scale:04',label:'200%',enabled:true}]});
 for(const [id,value] of [['scale:01',1],['scale:02',1.25],['scale:03',1.5],['scale:04',2]] as const){expect(applyLocalPreference({fieldId:'local:13',value:id})).toBe(true);expect(state.settings.textScale).toBe(value);expect(localTextScale()).toBe(value);expect(projectLocalPreferences().find(field=>field.id==='local:13')?.value).toBe(id);}
 for(const value of ['scale:05','1.5',1.5,true])expect(applyLocalPreference({fieldId:'local:13',value})).toBe(false);expect(applyLocalPreference({fieldId:'textScale',value:'scale:03'})).toBe(false);expect(state.settings.textScale).toBe(2);
});
it('normalizes a malformed live text size for projection without overwriting settings',()=>{
 for(const textScale of ['1.5',1.75,NaN,Infinity,null]){Object.assign(state.settings,{textScale});expect(localTextScale()).toBe(1);expect(projectLocalPreferences().find(field=>field.id==='local:13')?.value).toBe('scale:01');expect(state.settings.textScale).toBe(textScale);}
 expect(applyLocalPreference({fieldId:'local:13',value:'scale:03'})).toBe(true);expect(localTextScale()).toBe(1.5);
});
