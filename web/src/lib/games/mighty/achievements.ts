import {ACHIEVEMENTS,type Reward} from './achievementCatalog';
import {readDeviceRecords} from './completionStore';
export {ACHIEVEMENTS,type Achievement,type Reward} from './achievementCatalog';
export {BACK_NAMES,TABLE_NAMES,type CardBack,type TableTone} from '../../looks';
export function loadUnlocked():Record<string,number> {
 const result=readDeviceRecords();return result.status==='ready'?{...result.records.unlocked}:{};
}
/** Defaults are always available. Failed storage reads grant no paid-for looks. */
export function isUnlocked(reward:Reward,unlocked=loadUnlocked()):boolean {
 if((reward.kind==='back'&&reward.id==='charcoal')||(reward.kind==='table'&&reward.id==='hanji'))return true;
 const by=ACHIEVEMENTS.find(a=>a.reward?.kind===reward.kind&&a.reward.id===reward.id);return !!by&&Object.hasOwn(unlocked,by.id);
}
