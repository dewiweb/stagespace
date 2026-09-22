// Objet mutable global — mis à jour à 60fps par le render loop et le listener IPC
// sans déclencher de re-renders React. Le composant lit via requestAnimationFrame.
export const debugPerf = {
  renderFps: 0,
  renderStutter: 0,
  ipcFps: 0,
  ipcMaxGap: 0,
  posLen: 0,
  mvts: 0,
  glMs: 0,
  labelMs: 0,
  animateMs: 0,
};
