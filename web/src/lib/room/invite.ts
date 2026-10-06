/** Invites a friend to this table: the phone's share sheet where there is
 * one, else the link copied. Says which happened, or 'failed' (the share
 * sheet dismissed, or the clipboard refused and nothing was copied). */
export async function invite(code: string): Promise<'shared' | 'copied' | 'failed'> {
  const url = location.origin + location.pathname;
  // Phones only: a desktop's share sheet is an odd place to land.
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ title: '마이티 한 판 해요', text: `마이티 테이블 ${code}`, url });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'failed';
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    prompt('이 링크를 복사하세요', url);
    return 'failed';
  }
}
