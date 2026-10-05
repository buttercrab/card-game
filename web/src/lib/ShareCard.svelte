<script lang="ts">
  // The session so far as one image to send to the group chat, Wordle style:
  // one row per hand, one square per trick, coloured by the side that took
  // its point cards, then the standings. Drawn on a canvas, shared through
  // the phone's share sheet or saved, or copied as text for KakaoTalk.
  import { occupantName } from './names';
  import { presetTitle } from './catalog';
  import { PATHS } from './SuitIcon.svelte';
  import { FIXED, SUIT_INK, THEME } from './tokens';
  import type { HandSummary, RoomMsg, Suit } from './types';
  import Button from './ui/Button.svelte';
  import Sheet from './ui/Sheet.svelte';

  let { room, onclose }: { room: RoomMsg; onclose: () => void } = $props();

  const W = 1080;
  const H = 1350;
  /** The most hands the card shows; earlier ones are counted, not drawn. */
  const MAX_ROWS = 8;
  let url = $state<string | null>(null);
  let file: File | null = null;
  let status = $state<string | null>(null);

  const names = $derived(room.seats.map((s, i) => occupantName(s, i) ?? `자리 ${i + 1}`));
  const hands = $derived(room.hands);
  const shown = $derived(hands.slice(-MAX_ROWS));
  const hidden = $derived(hands.length - shown.length);
  const standings = $derived(
    room.scores.map((score, seat) => ({ seat, score, name: names[seat] })).sort((a, b) => b.score - a.score),
  );
  const top = $derived(room.hands_played > 0 ? Math.max(...room.scores) : null);
  const ruleset = $derived(presetTitle(room.settings.preset));

  const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
  const short = (name: string) => (name.length > 10 ? `${name.slice(0, 10)}…` : name);

  // A picture to send around: always the light theme's paper and ink.
  const PAPER = THEME.table.light;
  const CARD = THEME.card.light;
  const INK = THEME.ink.light;
  const MUTED = THEME['ink-muted'].light;
  const LINE = THEME.line.light;
  const DECLARER = FIXED['team-declarer'];
  const DEFENSE = THEME['team-defense'].light;
  const GOLD = FIXED['card-gold'];
  const DANGER = THEME.danger.light;
  const SUIT_TEXT: Record<Suit, string> = { Spade: '♠', Heart: '♥', Diamond: '♦', Club: '♣' };

  /** The session as text for a chat, with emoji squares in place of the grid. */
  function asText(date: Date): string {
    const lines = [`마이티 ${date.getMonth() + 1}/${date.getDate()} · ${ruleset} · ${room.hands_played}판`];
    for (const h of shown) {
      const contract = `${h.contract.trump ? SUIT_TEXT[h.contract.trump] : '노'}${h.contract.count}`;
      const squares = h.rounds.map((r) => (r > 0 ? '🟧' : r < 0 ? '🟦' : '⬜')).join('');
      lines.push(`${contract} ${h.made ? '✓' : '✗'} ${squares}`);
    }
    if (hidden > 0) lines.push(`외 ${hidden}판`);
    lines.push('');
    for (const row of standings) {
      lines.push(`${row.score === top ? '👑 ' : ''}${row.name} ${signed(row.score)}`);
    }
    return lines.join('\n');
  }

  async function draw() {
    await document.fonts?.ready;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d')!;
    const display = getComputedStyle(document.documentElement).getPropertyValue('--font-display') || 'sans-serif';
    const date = new Date();

    g.fillStyle = PAPER;
    g.fillRect(0, 0, W, H);

    const left = 80;
    const right = W - 80;
    // Squares fill the grid's width, however many tricks a hand has.
    const tricks = Math.max(10, ...shown.map((h) => h.rounds.length));
    const gap = 12;
    const gridLeft = 332;
    const sq = Math.min(56, Math.floor((right - gridLeft + gap) / tricks) - gap);
    const rowH = sq + gap;
    const standH = 64;

    // Lay out first so the whole card sits in the middle.
    const headerH = 150;
    const noteH = hidden > 0 ? 56 : 0;
    const gridH = shown.length ? shown.length * rowH - gap + noteH : 40;
    const total = headerH + 64 + gridH + 64 + 64 + standings.length * standH - 20;
    let y = Math.max(80, (H - total) / 2);

    // Header.
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillStyle = INK;
    g.font = `800 104px ${display}`;
    g.fillText('마이티', left - 4, y + 92);
    g.fillStyle = MUTED;
    g.font = `600 34px ${display}`;
    g.fillText(`${date.getMonth() + 1}월 ${date.getDate()}일 · ${ruleset} · ${room.hands_played}판`, left, y + 150);
    y += headerH + 64;

    // The grid: a row per hand.
    if (!shown.length) {
      g.fillStyle = MUTED;
      g.font = `600 34px ${display}`;
      g.fillText('아직 끝난 판이 없어요', left, y + 30);
      y += gridH;
    } else {
      for (const hand of shown) {
        drawLabel(g, display, hand, left, y, sq);
        hand.rounds.forEach((r, i) => {
          const x = gridLeft + i * (sq + gap);
          g.beginPath();
          if (r === 0) {
            g.roundRect(x + 2, y + 2, sq - 4, sq - 4, 8);
            g.strokeStyle = LINE;
            g.lineWidth = 4;
            g.stroke();
          } else {
            g.roundRect(x, y, sq, sq, 10);
            g.fillStyle = r > 0 ? DECLARER : DEFENSE;
            g.fill();
          }
          if (hand.friend_revealed === i) {
            g.beginPath();
            g.arc(x + sq / 2, y + sq / 2, sq * 0.13, 0, Math.PI * 2);
            g.fillStyle = r === 0 ? MUTED : CARD;
            g.fill();
          }
        });
        y += rowH;
      }
      y -= gap;
      // Earlier hands are counted under the grid, not drawn.
      if (hidden > 0) {
        g.fillStyle = MUTED;
        g.font = `600 30px ${display}`;
        g.textBaseline = 'alphabetic';
        g.textAlign = 'left';
        g.fillText(`외 ${hidden}판`, gridLeft, y + 46);
        y += noteH;
      }
    }
    y += 64;

    g.fillStyle = LINE;
    g.fillRect(left, y, right - left, 3);
    y += 64;

    // Standings.
    g.textBaseline = 'middle';
    for (const row of standings) {
      const mid = y + 22;
      if (row.score === top) drawCrown(g, left, mid);
      g.textAlign = 'left';
      g.fillStyle = INK;
      g.font = `${row.score === top ? 800 : 700} 44px ${display}`;
      g.fillText(short(row.name), left + 72, mid);
      g.textAlign = 'right';
      // Scores are ink with a sign; only a loss is red. Plum is the game's
      // "act now" and means nothing on a card that is only looked at.
      g.fillStyle = row.score < 0 ? DANGER : row.score > 0 ? INK : MUTED;
      g.font = `800 48px ${display}`;
      g.fillText(signed(row.score), right, mid);
      y += standH;
    }

    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (!blob) return;
    file = new File([blob], `mighty-${date.toISOString().slice(0, 10)}.png`, { type: 'image/png' });
    url = URL.createObjectURL(blob);
  }

  /** The contract (suit and count) and whether it was made, left of a row. */
  function drawLabel(g: CanvasRenderingContext2D, display: string, hand: HandSummary, x: number, y: number, sq: number) {
    const mid = y + sq / 2;
    const trump = hand.contract.trump;
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    if (trump) {
      const size = 44;
      g.save();
      g.translate(x, mid - size / 2);
      g.scale(size / 100, size / 100);
      g.fillStyle = SUIT_INK[trump];
      g.fill(new Path2D(PATHS[trump]));
      g.restore();
    } else {
      g.fillStyle = INK;
      g.font = `800 44px ${display}`;
      g.fillText('노', x, mid + 3);
    }
    g.fillStyle = INK;
    g.font = `800 46px ${display}`;
    g.fillText(String(hand.contract.count), x + 56, mid + 3);

    // ✓ or ✗, as strokes.
    const cx = x + 186;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.lineWidth = 7;
    g.beginPath();
    if (hand.made) {
      g.strokeStyle = INK;
      g.moveTo(cx - 15, mid + 1);
      g.lineTo(cx - 4, mid + 12);
      g.lineTo(cx + 16, mid - 12);
    } else {
      g.strokeStyle = DANGER;
      g.moveTo(cx - 12, mid - 12);
      g.lineTo(cx + 12, mid + 12);
      g.moveTo(cx + 12, mid - 12);
      g.lineTo(cx - 12, mid + 12);
    }
    g.stroke();
  }

  /** A flat paper crown for the leader, centred on `mid`. */
  function drawCrown(g: CanvasRenderingContext2D, x: number, mid: number) {
    const w = 48;
    const h = 36;
    const t = mid - h / 2;
    g.fillStyle = GOLD;
    g.beginPath();
    g.moveTo(x, t + 8);
    g.lineTo(x + w * 0.27, t + h * 0.55);
    g.lineTo(x + w / 2, t);
    g.lineTo(x + w * 0.73, t + h * 0.55);
    g.lineTo(x + w, t + 8);
    g.lineTo(x + w - 4, t + h);
    g.lineTo(x + 4, t + h);
    g.closePath();
    g.fill();
    for (const px of [x, x + w / 2, x + w]) {
      g.beginPath();
      g.arc(px, px === x + w / 2 ? t : t + 8, 4.5, 0, Math.PI * 2);
      g.fill();
    }
  }

  async function share() {
    if (!file) return;
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: '마이티' });
        status = null;
      } catch {
        // Closing the share sheet is not an error worth showing.
      }
    } else {
      const a = document.createElement('a');
      a.href = url!;
      a.download = file.name;
      a.click();
      status = '이미지를 저장했어요';
    }
  }

  let copied: ReturnType<typeof setTimeout> | undefined;
  async function copyText() {
    const text = asText(new Date());
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Older browsers, or a page without clipboard permission.
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      (dialog ?? document.body).append(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      if (!ok) {
        status = '복사하지 못했어요';
        return;
      }
    }
    status = '복사했어요';
    clearTimeout(copied);
    copied = setTimeout(() => status === '복사했어요' && (status = null), 2000);
  }

  let dialog = $state<HTMLDialogElement>();
  $effect(() => {
    void draw();
    return () => {
      clearTimeout(copied);
      if (url) URL.revokeObjectURL(url);
    };
  });
</script>

<Sheet title="결과 카드" bind:dialog {onclose}>
  {#if url}
    <img src={url} alt="마이티 {room.hands_played}판 결과: {standings.map((s) => `${s.name} ${signed(s.score)}`).join(', ')}" />
  {:else}
    <p class="muted">그리는 중…</p>
  {/if}
  <p class="muted status" role="status">{status ?? ''}</p>
  {#snippet footer(close)}
    <Button variant="ghost" onclick={close}>닫기</Button>
    <Button onclick={copyText}>텍스트 복사</Button>
    <Button variant="primary" disabled={!url} onclick={share}>공유하기</Button>
  {/snippet}
</Sheet>

<style>
  img {
    display: block;
    width: 100%;
    max-height: 60dvh;
    object-fit: contain;
    border-radius: var(--r-control);
    box-shadow: var(--shadow-card);
    animation: fade-up 260ms var(--ease-standard) both;
  }
  :global(:root[data-motion='reduced']) img {
    animation-name: fade;
  }
  .status {
    min-height: 1.4em;
    margin: 8px 0 0;
    font-size: var(--text-label);
  }
</style>
