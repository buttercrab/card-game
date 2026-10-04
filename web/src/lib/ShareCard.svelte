<script lang="ts">
  // The session so far as one image to send to the group chat: standings,
  // the MVP and the biggest hand. Drawn on a canvas, shared through the
  // phone's share sheet, or saved where sharing files is not supported.
  import { botName } from './names';
  import { PRESET_NAME } from './presets';
  import type { RoomMsg } from './types';

  let { room, onclose }: { room: RoomMsg; onclose: () => void } = $props();

  const W = 1080;
  const H = 1350;
  let url = $state<string | null>(null);
  let file: File | null = null;
  let status = $state<string | null>(null);

  const names = $derived(room.seats.map((s, i) => (s.kind === 'human' ? s.name : s.kind === 'bot' ? botName(i) : `자리 ${i + 1}`)));
  const history = $derived(room.history ?? []);
  const standings = $derived(
    room.scores.map((score, seat) => ({ seat, score, name: names[seat] })).sort((a, b) => b.score - a.score),
  );
  /** The hand with the largest single payoff, and whose it was. */
  const biggest = $derived.by(() => {
    let best: { hand: number; seat: number; payoff: number } | null = null;
    history.forEach((pays, hand) =>
      pays.forEach((payoff, seat) => {
        if (!best || Math.abs(payoff) > Math.abs(best.payoff)) best = { hand, seat, payoff };
      }),
    );
    return best as { hand: number; seat: number; payoff: number } | null;
  });

  const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

  async function draw() {
    await document.fonts?.ready;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d')!;
    const display = getComputedStyle(document.documentElement).getPropertyValue('--font-display') || 'sans-serif';
    const paper = '#efebe3';
    const ink = '#1c1915';
    const muted = '#645d53';
    // The card is always paper, whatever the app's theme.
    const accent = '#8e2f6b';
    const danger = '#b3261e';
    const gold = '#a77a12';

    g.fillStyle = paper;
    g.fillRect(0, 0, W, H);

    // A tilted 마이티 card in the corner.
    g.save();
    g.translate(890, 200);
    g.rotate(0.12);
    g.fillStyle = '#fbf8f2';
    g.strokeStyle = '#d9d1c2';
    g.lineWidth = 4;
    g.beginPath();
    g.roundRect(-90, -125, 180, 250, 18);
    g.fill();
    g.stroke();
    g.fillStyle = ink;
    g.font = `800 64px ${display}`;
    g.textAlign = 'center';
    g.fillText('♠', 0, 22);
    g.font = `800 36px ${display}`;
    g.textAlign = 'left';
    g.fillText('A', -72, -78);
    g.restore();

    g.textAlign = 'left';
    g.fillStyle = muted;
    g.font = `600 34px ${display}`;
    const date = new Date();
    g.fillText(`${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()} · ${PRESET_NAME[room.settings.preset] ?? room.settings.preset} · ${room.hands_played}판`, 90, 150);
    g.fillStyle = ink;
    g.font = `800 96px ${display}`;
    g.fillText('오늘의 마이티', 90, 260);

    // Standings.
    let y = 420;
    standings.forEach((row, rank) => {
      const top = rank === 0;
      g.fillStyle = top ? '#fbf8f2' : 'transparent';
      if (top) {
        g.beginPath();
        g.roundRect(70, y - 74, W - 140, 112, 24);
        g.fill();
      }
      g.fillStyle = muted;
      g.font = `700 40px ${display}`;
      g.fillText(String(rank + 1), 110, y);
      g.fillStyle = ink;
      g.font = `${top ? 800 : 700} 52px ${display}`;
      const name = row.name.length > 10 ? `${row.name.slice(0, 10)}…` : row.name;
      g.fillText(name, 180, y);
      if (top && room.hands_played > 0) {
        const w = g.measureText(name).width;
        g.fillStyle = gold;
        g.font = `800 30px ${display}`;
        g.fillText('MVP', 200 + w, y - 6);
      }
      g.textAlign = 'right';
      g.fillStyle = row.score > 0 ? accent : row.score < 0 ? danger : muted;
      g.font = `800 56px ${display}`;
      g.fillText(signed(row.score), W - 110, y);
      g.textAlign = 'left';
      y += 132;
    });

    // The biggest hand.
    if (biggest) {
      y += 20;
      g.fillStyle = muted;
      g.font = `600 34px ${display}`;
      g.fillText('가장 큰 판', 90, y);
      g.fillStyle = ink;
      g.font = `800 46px ${display}`;
      g.fillText(`${names[biggest.seat]} ${signed(biggest.payoff)} · ${biggest.hand + 1}판째`, 90, y + 64);
    }

    g.fillStyle = muted;
    g.font = `600 30px ${display}`;
    g.fillText('cards.buttercrab.io', 90, H - 80);

    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (!blob) return;
    file = new File([blob], `mighty-${date.toISOString().slice(0, 10)}.png`, { type: 'image/png' });
    url = URL.createObjectURL(blob);
  }

  async function share() {
    if (!file) return;
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: '오늘의 마이티' });
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

  let dialog: HTMLDialogElement;
  $effect(() => {
    dialog.showModal();
    void draw();
    return () => url && URL.revokeObjectURL(url);
  });
</script>

<dialog bind:this={dialog} onclose={onclose} aria-labelledby="share-title">
  <h2 id="share-title">결과 카드</h2>
  {#if url}
    <img src={url} alt="오늘의 마이티 결과: {standings.map((s) => `${s.name} ${signed(s.score)}`).join(', ')}" />
  {:else}
    <p class="muted">그리는 중…</p>
  {/if}
  {#if status}<p class="muted status">{status}</p>{/if}
  <div class="actions">
    <form method="dialog"><button>닫기</button></form>
    <button class="primary" disabled={!url} onclick={share}>공유하기</button>
  </div>
</dialog>

<style>
  dialog {
    width: min(100% - 32px, 420px);
    max-height: calc(100% - 32px);
    padding: 20px;
    border: none;
    border-radius: 16px;
    background: var(--panel);
    color: var(--ink);
  }
  dialog::backdrop {
    background: rgb(23 25 28 / 0.4);
  }
  h2 {
    margin: 0 0 12px;
    font-size: 22px;
  }
  img {
    display: block;
    width: 100%;
    max-height: 60vh;
    object-fit: contain;
    border-radius: 12px;
    box-shadow: var(--shadow-card);
    animation: fade-up 260ms var(--ease-standard) both;
  }
  .status {
    margin: 8px 0 0;
    font-size: 13px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 14px;
  }
  .actions .primary {
    min-width: 120px;
  }
</style>
