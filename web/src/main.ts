import { mount } from 'svelte';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import 'wanted-sans/fonts/webfonts/variable/split/WantedSansVariable.css';
import './app.css';
import App from './App.svelte';
import { installErrorReports } from './lib/errors';
import './lib/music.svelte';

installErrorReports();
mount(App, { target: document.getElementById('app')! });
