/** Admission leaf sizing and spacing, independent of room action semantics. */
export function participationLayout(nameLength: number, viewportWidth = 390) {
  return { width: Math.min(280,Math.max(0,viewportWidth-32)), nameWidth: Math.max(52.5, Math.min(135, (nameLength + 1) * 15)), identityGap: 4, actionGap: 8, editGap: 2 };
}
