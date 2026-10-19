import { expect, type Locator, type Page } from '@playwright/test';

export interface FoundationJoinOptions {
    /** Omit to choose the first empty seat exposed by the People page. */
    seat?: number;
    /** Omit to keep the server-authorized initial name in the native editor. */
    name?: string;
}

async function settled(page: Page): Promise<void> {
    await expect(page.locator('.live-surface')).toHaveAttribute('data-foundation-status', 'ready');
}

/** Navigate through the engine's disclosure stack, without sending a room command. */
export async function openFoundationPeople(page: Page): Promise<Locator> {
    const people = page.getByRole('dialog', { name: '함께 있는 사람', exact: true });
    for (let depth = 0; depth < 8; depth++) {
        if (await people.isVisible()) return people;
        const dialog = page.getByRole('dialog').last();
        if (!await dialog.count()) break;
        const close = dialog.getByRole('button', { name: '닫기', exact: true });
        if (await close.count()) await close.click();
        else await page.keyboard.press('Escape');
        await settled(page);
    }
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: /함께 있는 사람/ }).first().click();
    await expect(people).toBeVisible();
    return people;
}

/** Opens the real join editor; callers may install receipt faults before submitting. */
export async function openFoundationJoin(page: Page, options: FoundationJoinOptions = {}): Promise<Locator> {
    const people = await openFoundationPeople(page);
    const row = options.seat === undefined
        ? people.locator('[data-foundation-node^=\'["room-seat",\']').first()
        : people.locator(`[data-foundation-node='${JSON.stringify(['room-seat', String(options.seat)])}']`);
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: '관리', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '이 자리에 앉기', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '이름을 정하고 앉기', exact: true });
    await expect(dialog).toBeVisible();
    const editor = dialog.getByRole('textbox', { name: '이름', exact: true });
    if (options.name !== undefined) await editor.fill(options.name);
    else await expect(editor).not.toHaveValue(/^\s*$/);
    await expect(dialog.getByRole('button', { name: '앉기', exact: true })).toBeEnabled();
    return dialog;
}

/** Submit exactly one explicit native join and await its authoritative seat transition. */
export async function joinFoundation(page: Page, options: FoundationJoinOptions = {}): Promise<void> {
    const dialog = await openFoundationJoin(page, options);
    await dialog.getByRole('button', { name: '앉기', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await settled(page);
}

/** Waiting-stage setup is per seat. Omission chooses the first currently
 * rendered vacant-seat action; exact captured authority stays engine-owned. */
export function foundationBotButton(page:Page,seat?:number):Locator {
 const scope=seat===undefined?page.locator('.live-surface'):page.getByRole('group',{name:new RegExp(`^${seat+1}번 자리 · `)});
 return scope.getByRole('button',{name:'봇 추가',exact:true}).first();
}
