/** Host-only bridge from inert engine preferences to this device's settings. */
import { settings } from '../../settings.svelte';
import {normalizeSettings} from '../../settingsValues';
import { BACK_NAMES, TABLE_NAMES, type CardBack, type TableTone } from '../../looks';
import { ACHIEVEMENTS, isUnlocked, loadUnlocked } from '../../games/mighty/achievements';
import { acceptPreferenceValue, type PreferenceChange, type PreferenceField } from './roomShell';

const BACKS: readonly [string, CardBack][] = [
    ['back:01', 'charcoal'], ['back:02', 'plum'], ['back:03', 'indigo'],
    ['back:04', 'gold'], ['back:05', 'ink'], ['back:06', 'jade'],
];
const TONES: readonly [string, TableTone][] = [
    ['tone:01', 'hanji'], ['tone:02', 'celadon'], ['tone:03', 'indigo'], ['tone:04', 'blush'],
];
const TEXT_SCALES = [['scale:01',1,'100%'],['scale:02',1.25,'125%'],['scale:03',1.5,'150%'],['scale:04',2,'200%']] as const;
const SPEEDS = [['motion:01', 'normal', '보통'], ['motion:02', 'fast', '빠르게'], ['motion:03', 'off', '끄기']] as const;

// Storage can be corrupt. Only own recorded unlocks may authorize a cosmetic.
function unlocks(): Record<string, number> {
    const stored: unknown = loadUnlocked();
    const safe: Record<string, number> = Object.create(null);
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
        for (const [key, value] of Object.entries(stored)) {
            if (typeof value === 'number' && Number.isFinite(value) && value >= 0) safe[key] = value;
        }
    }
    return safe;
}

/** This projection is fresh on each call; option IDs never expose settings keys. */
export function projectLocalPreferences(): readonly PreferenceField[] {
    const current=normalizeSettings({...settings});
    const unlocked = unlocks();
    const looks = <T extends CardBack | TableTone>(kind: 'back' | 'table', entries: readonly [string, T][], names: Record<T, string>) =>
        entries.map(([id, value]) => {
            const enabled = isUnlocked({ kind, id: value } as Parameters<typeof isUnlocked>[0], unlocked);
            const how = ACHIEVEMENTS.find(item => item.reward?.kind === kind && item.reward.id === value)?.how;
            return Object.freeze({ id, label: names[value], enabled, ...(!enabled ? { help: `잠김 · ${how ?? '업적으로 얻을 수 있어요'}` } : {}) });
        });
    const fields: PreferenceField[] = [
        { id: 'local:01', kind: 'toggle', label: '4색 덱', help: '♦ 주황, ♣ 파랑', enabled: true, value: current.fourColor },
        { id: 'local:02', kind: 'toggle', label: '한 번 눌러 내기', help: '끄면 두 번 눌러야 카드를 내요', enabled: true, value: current.singleTap },
        { id: 'local:03', kind: 'toggle', label: '초보 도움말', help: '내 차례마다 뭘 하면 되는지 알려 줘요', enabled: true, value: current.tips },
        { id: 'local:04', kind: 'toggle', label: '힌트 버튼', help: '내 차례에 봇이라면 뭘 할지 알려 줘요', enabled: true, value: current.hints },
        { id: 'local:05', kind: 'toggle', label: '진동', help: '내 차례가 되면 짧게 (안드로이드)', enabled: true, value: current.haptics },
        { id: 'local:06', kind: 'toggle', label: '효과음', enabled: true, value: current.sound },
        { id: 'local:07', kind: 'number', label: '효과음 음량', enabled: current.sound, value: current.volume, min: 0, max: 1, step: 0.1 },
        { id: 'local:08', kind: 'toggle', label: '배경 음악', help: '잔잔한 재즈', enabled: true, value: current.music },
        { id: 'local:09', kind: 'number', label: '배경 음악 음량', enabled: current.music, value: current.musicVolume, min: 0, max: 1, step: 0.1 },
        { id: 'local:10', kind: 'select', label: '카드 뒷면', help: '업적으로 더 얻을 수 있어요', enabled: true,
            value: BACKS.find(([, value]) => value === current.cardBack)?.[0] ?? BACKS[0][0], options: Object.freeze(looks('back', BACKS, BACK_NAMES)) },
        { id: 'local:11', kind: 'select', label: '테이블 색', enabled: true,
            value: TONES.find(([, value]) => value === current.tableTone)?.[0] ?? TONES[0][0], options: Object.freeze(looks('table', TONES, TABLE_NAMES)) },
        { id: 'local:12', kind: 'select', label: '애니메이션', enabled: true,
            value: SPEEDS.find(([, value]) => value === current.speed)?.[0] ?? SPEEDS[0][0],
            options: Object.freeze(SPEEDS.map(([id, , label]) => Object.freeze({ id, label, enabled: true }))) },
        { id: 'local:13', kind: 'select', label: '글자 크기', enabled: true,
            value: TEXT_SCALES.find(([,value]) => value === current.textScale)![0],
            options: Object.freeze(TEXT_SCALES.map(([id,,label]) => Object.freeze({id,label,enabled:true}))) },
    ];
    return Object.freeze(fields.map(field => Object.freeze(field)));
}

/** Revalidate live enabled/unlock state before an explicit whitelisted assignment. */
export function applyLocalPreference(change: PreferenceChange): boolean {
    if (!change || typeof change.fieldId !== 'string') return false;
    const field = projectLocalPreferences().find(item => item.id === change.fieldId);
    if (!field || !acceptPreferenceValue(field, change.value)) return false;
    const value = change.value;
    switch (field.id) {
        case 'local:01': settings.fourColor = value as boolean; break;
        case 'local:02': settings.singleTap = value as boolean; break;
        case 'local:03': settings.tips = value as boolean; break;
        case 'local:04': settings.hints = value as boolean; break;
        case 'local:05': settings.haptics = value as boolean; break;
        case 'local:06': settings.sound = value as boolean; break;
        case 'local:07': settings.volume = Math.round((value as number)*10)/10; break;
        case 'local:08': settings.music = value as boolean; break;
        case 'local:09': settings.musicVolume = Math.round((value as number)*10)/10; break;
        case 'local:10': settings.cardBack = BACKS.find(([id]) => id === value)![1]; break;
        case 'local:11': settings.tableTone = TONES.find(([id]) => id === value)![1]; break;
        case 'local:12': settings.speed = SPEEDS.find(([id]) => id === value)![1]; break;
        case 'local:13': settings.textScale = TEXT_SCALES.find(([id]) => id === value)![1]; break;
        default: return false;
    }
    return true;
}

export function localCardActivation(): { cardActivation: 'single' | 'repeat' } {
    return { cardActivation: settings.singleTap===true ? 'single' : 'repeat' };
}

/** Semantic host input; the engine receives the number without knowing a preference key. */
export function localTextScale(): number {
    return normalizeSettings({...settings}).textScale;
}
