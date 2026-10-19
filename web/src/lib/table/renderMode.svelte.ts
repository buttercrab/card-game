export type RenderMode = 'dom';
/** The shared coordinate engine positions canonical native components. */
export const rendering = new class {
  mode = $state<RenderMode>('dom');
  select(mode: RenderMode) { this.mode = mode; }
};
