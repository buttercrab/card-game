# Card Game

General online trump card game platform that users can define their own rules and play with others.

## Simple Roadmap

front-end: [Svelte](https://svelte.dev/) + [astro](https://astro.build/) + [tailwindcss](https://tailwindcss.com/)

back-end: [warp](https://github.com/seanmonstar/warp) + [deno core (V8)](https://crates.io/crates/deno_core) +
postgresql + redis

Users will write their rules in js, which would be executed in sandbox space in server.

### Diagram

In one game, it would be like below

```
┌──────Server──────┐
│                  │
│        ┌──────┐  │           ┌─ Client1
│ ┌──┐   │ Rule │  │ Websocket │
│ │DB╞═══╡  JS  ├──│───────────┼─ Client2
│ └──┘   └──────┘  │           │
│       V8 sandbox │           └─ Client3
│                  │
└──────────────────┘
```
               