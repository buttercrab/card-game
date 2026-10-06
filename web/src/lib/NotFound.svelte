<script lang="ts">
  // Any path the app does not know. A room link to a closed table is not
  // this: the room says so itself.
</script>

<section class="missing">
  <h1>페이지를 찾을 수 없어요</h1>
  <p class="muted">주소가 바뀌었거나 없는 페이지예요. 주소를 다시 확인해 주세요.</p>
  <a class="btn" href="/">처음으로</a>
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
</style>
