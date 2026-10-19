/** A root boundary requires document navigation, not a second router mount. */
export function isFoundationRoute(pathname: string, search: string): boolean {
    const selection=new URLSearchParams(search).get('foundation');
    if(/^\/r\/[a-z0-9]+\/?$/.test(pathname))return selection!=='0';
    return pathname.replace(/\/$/,'')==='/preview'&&selection==='1';
}
