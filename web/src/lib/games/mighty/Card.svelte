<script lang="ts" module>
  export { rankText, cardName } from '../../ui/cards/types';
  export type { CardSize } from '../../ui/cards/types';
</script>
<script lang="ts">
  import PlayingCard from '../../ui/cards/PlayingCard.svelte';
  import { cardName, type CardSize } from '../../ui/cards/types';
  import type { Card } from './types';
  import type { Seal } from './cards';
  import type { Attachment } from 'svelte/attachments';
  let {
    card = null,
    size = 'hand',
    seal = null,
    twoJokers = true,
    raised = false,
    selected = false,
    stationary = false,
    hinted = false,
    unplayable = false,
    won = false,
    kitty = false,
    powerless = false,
    picked = false,
    leading = false,
    dimmed = false,
    overlapped = false,
    tilt = 0,
    width,
    id,
    attach,
    onclick,
  }: {
    /** null draws the back. */
    card?: Card | null;
    size?: CardSize;
    seal?: Seal | null;
    /** With one joker in the deck it needs no colour name. */
    twoJokers?: boolean;
    raised?: boolean;
    selected?: boolean;
    stationary?: boolean;
    /** Suggested by the 💡 hint. */
    hinted?: boolean;
    unplayable?: boolean;
    won?: boolean;
    kitty?: boolean;
    /** Played where its special power does not apply. */
    powerless?: boolean;
    /** Chosen among several (the exchange's discards): lifted clear of its
     * row, with no raised shadow, which would show as a second edge. */
    picked?: boolean;
    /** Winning the round so far: it sits up a little, outlined in ink (news,
     * not a call to act, which is what plum means). */
    leading?: boolean;
    /** Lost the round as it resolves: less colour, still solid paper. */
    dimmed?: boolean;
    /** Under the next card in a fan: its stray corner glyph is not drawn. */
    overlapped?: boolean;
    /** Lying a little crooked on the table, in degrees. */
    tilt?: number;
    /** Overrides the size's width in pixels. */
    width?: number;
    /** Exposed as data-card, for tests and for the hand's own lookups. */
    id?: string;
    /** Registers the card's element (the table's motion finds it so). */
    attach?: Attachment<HTMLElement>;
    onclick?: () => void;
  } = $props();

  const label = $derived.by(() => {
    if (!card) return '비공개 카드';
    const parts = [cardName(card)];
    if (seal === 'mighty') parts.push('마이티');
    if (seal === 'call') parts.push('조커콜');
    if (powerless) parts.push('효력 없음');
    if (kitty) parts.push('키티');
    if (unplayable) parts.push('낼 수 없음');
    return parts.join(', ');
  });
</script>
<PlayingCard {card} {size} emphasis={seal === 'mighty' ? 'special' : seal} labelOverride={label}
  {twoJokers} {raised} {selected} {stationary} {hinted} {unplayable} {won} {kitty} {powerless} {picked} {leading}
  {dimmed} {overlapped} {tilt} {width} {id} {attach} {onclick} />
