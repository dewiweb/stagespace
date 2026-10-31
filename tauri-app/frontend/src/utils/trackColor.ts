/// Couleur de track unifiée — une seule teinte pour la grille, la 3D et les
/// chips : la même track doit avoir la même couleur partout. Teinte par
/// index dans la liste des objets (stable entre moves). Divergeait avant :
/// TrackGrid HSL(index tableau) vs TrajectoryViz setHSL(track_index).
export function trackHue(trackIndex: number, nObjects: number): number {
  return trackIndex / Math.max(nObjects, 1);
}

/// Variante CSS — grille, chips, markers DOM.
export function trackColor(trackIndex: number, nObjects: number): string {
  const hue = trackHue(trackIndex, nObjects) * 360;
  return `hsl(${hue.toFixed(0)}, 70%, 55%)`;
}
