/** Measured requirements for one table composition. This policy never estimates
 * text or hides essential content to manufacture a fitting board. */
export interface TableStackRequirements {
    readonly height: number;
    readonly arena: { readonly minimum: number; readonly preferred: number };
    readonly decision?: { readonly minimum: number; readonly preferred: number };
    readonly dock: number;
    readonly status?: number;
    readonly tools?: number;
    readonly preferredGap: number;
    /** Native target envelopes may require separation even in root flow. */
    readonly minimumGap?:number;
}
export interface TableStackAllocation {
    readonly kind: 'fit' | 'overflow';
    readonly gap: number;
    readonly arena: number;
    readonly decision: number;
    readonly contentHeight: number;
    readonly deficit: number;
}
/** Protect complete measured cohorts first. Preferred spacing and region sizes
 * consume remaining space; impossible combinations retain their full minima and
 * report ordinary document overflow rather than an essential-region slit. */
export function allocateTableStack(input: TableStackRequirements): TableStackAllocation {
    const values=[input.height,input.arena.minimum,input.arena.preferred,input.dock,input.status??0,input.tools??0,input.preferredGap,input.minimumGap??0,...(input.decision?[input.decision.minimum,input.decision.preferred]:[])];
    if(values.some(value=>!Number.isFinite(value)||value<0)||(input.minimumGap??0)>input.preferredGap||input.arena.preferred<input.arena.minimum||input.arena.minimum===0&&input.arena.preferred>0||input.decision&&(input.decision.preferred<input.decision.minimum||input.decision.minimum===0&&input.decision.preferred>0))throw Error('Invalid measured table requirements');
    const decisionMinimum=input.decision?.minimum??0;
    const fixed=input.dock+(input.status??0)+(input.tools??0);
    // An expandable cohort must have a positive measured minimum. Zero is
    // reserved for an omitted region, matching the composer's child list.
    const gapCount=Math.max(0,[input.arena.minimum,input.dock,input.status??0,input.tools??0,decisionMinimum].filter(value=>value>0).length-1);
    const minimumGap=input.minimumGap??0,minimum=fixed+input.arena.minimum+decisionMinimum+minimumGap*gapCount;
    if(minimum>input.height)return {kind:'overflow',gap:minimumGap,arena:input.arena.minimum,decision:decisionMinimum,contentHeight:minimum,deficit:minimum-input.height};
    let remaining=input.height-minimum;
    const gap=gapCount>0?minimumGap+Math.min(input.preferredGap-minimumGap,remaining/gapCount):0;
    remaining-=(gap-minimumGap)*gapCount;
    const decision=decisionMinimum+Math.min(remaining,(input.decision?.preferred??0)-decisionMinimum);
    remaining-=decision-decisionMinimum;
    const arena=input.arena.minimum+Math.min(remaining,input.arena.preferred-input.arena.minimum);
    const contentHeight=fixed+decision+arena+gap*gapCount;
    return {kind:'fit',gap,arena,decision,contentHeight,deficit:0};
}

/** Evaluate complete measured compositions in preference order. Tools keep a
 * bounded native viewport and stable ancestry across content changes. If no
 * complete composition fits, retain the smallest real minimum in root flow. */
export function chooseTableStack<C>(candidates:readonly {readonly candidate:C;readonly requirements:TableStackRequirements}[]):{readonly candidate:C;readonly allocation:TableStackAllocation} {
    if(!candidates.length)throw Error('Missing measured table candidates');
    const measured=candidates.map(item=>({...item,allocation:allocateTableStack(item.requirements)}));
    return measured.find(item=>item.allocation.kind==='fit')??measured.reduce((best,item)=>item.allocation.deficit<best.allocation.deficit?item:best);
}
