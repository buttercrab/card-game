import type {CurrentRoomViewOf} from '../../room/currentRoom';
import type {PokerSettings,PokerRules,PokerView,PokerAction,PokerNotes,PokerSummary} from '../../generated/protocol';
import type {RoomViewOf,StateMsgOf} from '../../room/types';
export interface Poker {
    settings:PokerSettings;
    rules:PokerRules;
    view:PokerView;
    action:PokerAction;
    notes:PokerNotes;
    hand:PokerSummary;
}
export type RoomView=RoomViewOf<Poker>;
export type StateMsg=StateMsgOf<Poker>;

/** Bounded current presentation input; archives are resolved separately. */
export type CurrentRoomView = CurrentRoomViewOf<Poker>;
