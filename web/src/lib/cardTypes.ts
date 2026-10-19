/** Ordinary playing-card primitives shared by projections and renderers. */
export type Suit = 'Spade' | 'Heart' | 'Diamond' | 'Club';
export type StandardCard = { Normal: [Suit, number] } | { Joker: 'Black' | 'Red' };
export type CardSize = 'hand' | 'trick' | 'mini' | 'fluid';
export type CardEmphasis = 'special' | 'joker' | 'call';
export type CardVisual = {kind:'standard';rank:number;suit:Suit} | {kind:'joker';color:'Black'|'Red'};
