import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { joinFoundation, openFoundationJoin } from './foundationHelpers';
const port = Number(process.env.PORT ?? 4317);
test.use({ baseURL: `http://127.0.0.1:${port + 1}` });
interface Probe { sent: any[]; receipts: any[]; room: any; }
async function instrument(page: Page, name: string) {
    await page.addInitScript(name => {
        const state = window as typeof window & { roomOpsProbe: Probe };
        state.roomOpsProbe = { sent: [], receipts: [], room: null };
        const Native = WebSocket;
        window.WebSocket = class extends Native {
            constructor(url: string | URL, protocols?: string | string[]) {
                super(url, protocols);
                this.addEventListener('message', event => {
                    const value = JSON.parse(String(event.data));
                    if (value.type === 'room') state.roomOpsProbe.room = value;
                    if (value.type === 'operation_receipt') state.roomOpsProbe.receipts.push(value);
                });
            }
            send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
                if (typeof data === 'string') state.roomOpsProbe.sent.push(JSON.parse(data));
                super.send(data);
            }
        };
        localStorage.setItem('name', JSON.stringify(name));
        localStorage.setItem('mighty.settings', JSON.stringify({ sound: false, music: false, speed: 'off' }));
    }, name);
}
async function createRoom(request: APIRequestContext) {
    const response = await request.post('/api/games/mighty/rooms', { data: { preset: 'default' } });
    expect(response.ok()).toBe(true); return (await response.json()).id as string;
}
async function visit(page: Page, id: string, name: string, seated = true) {
    await instrument(page, name); await page.goto(`/r/${id}?foundation=1`);
    await expect(page.locator('[data-live-status]')).toHaveAttribute('data-live-status', 'open');
    if (seated) {
        await joinFoundation(page);
        await accepted(page, 'join', 1);
        const join = (await submitted(page, 'join')).at(-1);
        await expect.poll(() => page.evaluate(({ seat, actor }) => {
            const room = (window as typeof window & { roomOpsProbe: Probe }).roomOpsProbe.room;
            return room?.seats[seat]?.kind === 'human' && room.participant_ids?.[seat] === actor;
        }, { seat: join.action.seat, actor: join.expected.actor_id })).toBe(true);
    }
}
const modal = (page: Page) => page.locator('[data-foundation-node="room-dialog"]');
async function people(page: Page) {
    for (let attempt = 0; attempt < 4; attempt++) {
        if (await page.getByRole('dialog', { name: '함께 있는 사람', exact: true }).count()) return;
        if (!await modal(page).count()) break;
        await modal(page).getByRole('button', { name: '닫기', exact: true }).click();
    }
    await page.getByRole('button', { name: /함께 있는 사람/ }).first().click();
    await expect(page.getByRole('dialog', { name: '함께 있는 사람', exact: true })).toBeVisible();
}
const node = (page: Page, parts: string[]) => page.locator(`[data-foundation-node='${JSON.stringify(parts)}']`);
async function inspectSeat(page: Page, seat: number) {
    await people(page);
    const room = await page.evaluate(() => (window as typeof window & { roomOpsProbe: Probe }).roomOpsProbe.room);
    const person = room.participant_ids?.[seat];
    const row = room.seats[seat].kind === 'empty' ? node(page, ['room-seat', String(seat)]) : node(page, ['room-person', person || `seat-${seat}`]);
    await row.getByRole('button', { name: '관리', exact: true }).click();
    await expect(modal(page)).toHaveAccessibleName(new RegExp(`^${seat + 1}번 자리 · `));
}
async function inspectRoom(page: Page) {
    await people(page);
    // The room action is a direct child of the page action list, after roster rows.
    await modal(page).getByRole('button', { name: '관리', exact: true }).last().click();
    await expect(page.getByRole('dialog', { name: '테이블 관리', exact: true })).toBeVisible();
}
async function submitted(page: Page, type: string) {
    return page.evaluate(type => (window as typeof window & { roomOpsProbe: Probe }).roomOpsProbe.sent.filter(value => value.type === 'submit_room' && value.action?.type === type), type);
}
async function accepted(page: Page, type: string, count: number) {
    await expect.poll(async () => (await submitted(page, type)).length).toBe(count);
    await expect.poll(() => page.evaluate(type => {
        const probe = (window as typeof window & { roomOpsProbe: Probe }).roomOpsProbe;
        const latest = probe.sent.filter(value => value.type === 'submit_room' && value.action?.type === type).at(-1);
        return probe.receipts.some(receipt => receipt.operation_id === latest?.operation_id && receipt.outcome.status === 'accepted');
    }, type)).toBe(true);
}
test('native management adds, changes and removes bots, confirms reset, and stands without exiting', async ({ page, request }, info) => {
    test.skip(info.project.name !== '390x844-light', 'one real scoped management lifecycle'); test.setTimeout(60000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const id = await createRoom(request); await visit(page, id, '관리 확인');
    await inspectSeat(page, 1); await modal(page).getByRole('button', { name: /초보 봇 앉히기$/ }).click(); await accepted(page, 'add_bot', 1);
    await inspectSeat(page, 1); await modal(page).getByRole('button', { name: /고수 봇으로 변경$/ }).click(); await accepted(page, 'add_bot', 2);
    await inspectSeat(page, 1); await modal(page).getByRole('button', { name: /봇 빼기$/ }).click(); await accepted(page, 'remove_bot', 1);
    await inspectRoom(page); await modal(page).getByRole('button', { name: '점수 초기화', exact: true }).click();
    await expect(modal(page)).toHaveAccessibleName('누적 점수를 초기화할까요?');
    await modal(page).getByRole('button', { name: '취소', exact: true }).click(); expect(await submitted(page, 'reset_scores')).toHaveLength(0);
    await modal(page).getByRole('button', { name: '점수 초기화', exact: true }).click();
    await modal(page).getByRole('button', { name: '점수 초기화', exact: true }).click(); await accepted(page, 'reset_scores', 1);
    await inspectSeat(page, 0); await modal(page).getByRole('button', { name: '관전으로 전환', exact: true }).click(); await accepted(page, 'leave', 1);
    await expect(page).toHaveURL(new RegExp(`/r/${id}\\?foundation=1$`));
    await openFoundationJoin(page,{seat:0});
    const sent = await page.evaluate(() => (window as typeof window & { roomOpsProbe: Probe }).roomOpsProbe.sent);
    expect(sent.filter(value => ['add_bot', 'remove_bot', 'reset_scores', 'leave'].includes(value.type))).toEqual([]);
    const commands = sent.filter(value => value.type === 'submit_room');
    expect(new Set(commands.map(value => value.operation_id)).size).toBe(commands.length);
    for (const command of commands) expect(command.expected).toMatchObject({ domain: 'room', room_id: id });
    expect(errors).toEqual([]);
});
test('named observer requests participation, receives a human offer and accepts its exact reservation', async ({ page, context, request }, info) => {
    test.skip(info.project.name !== '390x844-light', 'one two-actor participation lifecycle'); test.setTimeout(60000);
    const id = await createRoom(request); await visit(page, id, '자리 주인');
    const otherContext = await context.browser()!.newContext({ baseURL: `http://127.0.0.1:${port + 1}` });
    const observer = await otherContext.newPage(), fillers = [];
    try {
        // The server auto-reserves any nonhuman seat; a human offer requires a full human table.
        for (let index = 0; index < 4; index++) {
            const fillerContext = await context.browser()!.newContext({ baseURL: `http://127.0.0.1:${port + 1}` });
            fillers.push(fillerContext); await visit(await fillerContext.newPage(), id, `다른 참가자 ${index + 1}`);
        }
        await visit(observer, id, '참여 관전자', false); await people(observer);
        const observerId = await observer.evaluate(() => (window as typeof window & { roomOpsProbe: Probe }).roomOpsProbe.room.observers.find((person: { name: string }) => person.name === '참여 관전자').id);
        await node(observer, ['room-person', observerId]).getByRole('button', { name: '관리', exact: true }).click();
        await observer.getByRole('dialog').getByRole('button', { name: '다음 판 참여', exact: true }).click(); await accepted(observer, 'request_seat', 1);
        await inspectSeat(page, 0); await modal(page).getByRole('button', { name: '참여 관전자님에게 다음 판 자리 양보', exact: true }).click(); await accepted(page, 'offer_seat', 1);
        await people(observer);
        const room = await observer.evaluate(() => (window as typeof window & { roomOpsProbe: Probe }).roomOpsProbe.room);
        const identity = room.observers.find((person: { name: string }) => person.name === '참여 관전자').id;
        await node(observer, ['room-person', identity]).getByRole('button', { name: '관리', exact: true }).click();
        await observer.getByRole('dialog').getByRole('button', { name: '앉아서 다음 판 준비', exact: true }).click(); await accepted(observer, 'accept_seat', 1);
        expect((await submitted(observer, 'request_seat'))[0].expected.seat).toBeNull();
        expect((await submitted(observer, 'accept_seat'))[0].expected.seat).toBeNull();
        await expect(observer).toHaveURL(new RegExp(`/r/${id}\\?foundation=1$`));
    } finally { await otherContext.close(); for (const filler of fillers) await filler.close(); }
});
test('an intervening room revision invalidates an open destructive confirmation', async ({ page, context, request }, info) => {
    test.skip(info.project.name !== '390x844-light', 'one real stale confirmation fence'); test.setTimeout(60000);
    const id = await createRoom(request); await visit(page, id, '초기화 확인');
    const otherContext = await context.browser()!.newContext({ baseURL: `http://127.0.0.1:${port + 1}` }), other = await otherContext.newPage();
    try {
        await visit(other, id, '동시 관리');
        await inspectRoom(page); await modal(page).getByRole('button', { name: '점수 초기화', exact: true }).click();
        await expect(modal(page)).toHaveAccessibleName('누적 점수를 초기화할까요?');
        await inspectSeat(other, 2); await other.getByRole('dialog').getByRole('button', { name: /초보 봇 앉히기$/ }).click(); await accepted(other, 'add_bot', 1);
        await expect(page.getByRole('alertdialog', { name: '누적 점수를 초기화할까요?', exact: true })).toHaveCount(0);
        expect(await submitted(page, 'reset_scores')).toHaveLength(0);
        await inspectRoom(page); await modal(page).getByRole('button', { name: '점수 초기화', exact: true }).click();
        expect(await submitted(page, 'reset_scores')).toHaveLength(0);
        await modal(page).getByRole('button', { name: '점수 초기화', exact: true }).click(); await accepted(page, 'reset_scores', 1);
    } finally { await otherContext.close(); }
});
test('a participant leaving during seat-clear confirmation cannot transfer confirmation to a replacement bot', async ({ page, context, request }, info) => {
    test.skip(info.project.name !== '390x844-light', 'one real target replacement fence'); test.setTimeout(60000);
    const id = await createRoom(request); await visit(page, id, '자리 관리자');
    const otherContext = await context.browser()!.newContext({ baseURL: `http://127.0.0.1:${port + 1}` }), other = await otherContext.newPage();
    try {
        await visit(other, id, '교체 참가자');
        await inspectSeat(page, 1); await modal(page).getByRole('button', { name: '교체 참가자님을 관전으로 전환', exact: true }).click();
        await expect(modal(page)).toHaveAccessibleName('교체 참가자님을 구경하는 자리로 옮길까요?');
        await inspectSeat(other, 1); await other.getByRole('dialog').getByRole('button', { name: '관전으로 전환', exact: true }).click(); await accepted(other, 'leave', 1);
        await expect(page.getByRole('alertdialog', { name: '교체 참가자님을 구경하는 자리로 옮길까요?', exact: true })).toHaveCount(0);
        expect(await submitted(page, 'clear_seat')).toHaveLength(0);
        await inspectSeat(page, 1); await modal(page).getByRole('button', { name: /초보 봇 앉히기$/ }).click(); await accepted(page, 'add_bot', 1);
        await inspectSeat(page, 1);
        await expect(modal(page)).not.toHaveAccessibleName(/교체 참가자/);
        await expect(modal(page).getByRole('button', { name: '교체 참가자님을 관전으로 전환', exact: true })).toHaveCount(0);
        expect(await submitted(page, 'clear_seat')).toHaveLength(0);
    } finally { await otherContext.close(); }
});
