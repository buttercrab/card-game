import { mount } from 'svelte';
import { isFoundationRoute } from './rootRoute';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import 'wanted-sans/fonts/webfonts/variable/split/WantedSansVariable.css';
import './app.css';
import { installErrorReports } from './lib/errors';
import './lib/music.svelte';

installErrorReports();
// An isolated engine surface must not load legacy game/room styles. Their
// responsive media rules can invalidate document-wide font matching on resize.
const foundation = isFoundationRoute(location.pathname, location.search);
const root = foundation
  ? (location.pathname.startsWith('/r/') ? import('./lib/table/foundation/FoundationEntry.svelte') : import('./lib/table/foundation/FoundationPreview.svelte'))
  : import('./App.svelte');
void root.then(({ default: Root }) => mount(Root, { target: document.getElementById('app')! }));
