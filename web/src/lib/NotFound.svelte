<script lang="ts">
  // Any path the app does not know. A room link to a closed table is not
  // this: the room says so itself.
</script>

<section class="missing">
  <h1>페이지를 찾을 수 없어요</h1>
  <p class="muted">주소가 바뀌었거나 없는 페이지예요. 주소를 다시 확인해 주세요.</p>
  <a class="home" href="/">처음으로</a>
</section>

<style>
  .missing {
    display: grid;
    justify-items: center;
    gap: 12px;
    padding-top: 15vh;
    text-align: center;
  }
  h1 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 26px;
    font-weight: 800;
  }
  p {
    margin: 0 0 8px;
    max-width: 24em;
    text-wrap: balance;
  }
  /* 처음으로 is a link dressed as the plain button, like the rulebook's. */
  .home {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 10px 16px;
    border-radius: var(--r-control);
    background: var(--btn);
    color: var(--ink);
    box-shadow: 0 3px 0 var(--btn-lip);
    font-size: var(--text-body);
    font-weight: 600;
    text-decoration: none;
  }
</style>
