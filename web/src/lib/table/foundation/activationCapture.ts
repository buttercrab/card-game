/** Adapter-local physical gesture ownership; never an authority or game decision. */
export type ActivationBinding = Readonly<{frameId:number;nodeId:string}>;
export type PhysicalActivation = ActivationBinding & {readonly source:string;cancelled:boolean;consumed:boolean;abandoned:boolean;released:boolean};
export function createActivationCapture(){
    const held=new Map<string,PhysicalActivation>();
    return {
        begin(source:string,binding:ActivationBinding):PhysicalActivation|null{
            // Repeated keydown cannot acquire a new publication while held.
            const prior=held.get(source);if(prior&&!prior.abandoned&&!prior.released)return null;
            const capture={...binding,source,cancelled:false,consumed:false,abandoned:false,released:false};held.set(source,capture);return capture;
        },
        cancel(nodeId?:string){for(const capture of held.values())if(!nodeId||capture.nodeId===nodeId)capture.cancelled=true;},
        get(source:string){return held.get(source);},
        abandon(){for(const capture of held.values()){capture.cancelled=true;capture.abandoned=true;}},
        release(source:string){const capture=held.get(source);if(capture){capture.abandoned=false;capture.released=true;}return capture;},
        retire(capture:PhysicalActivation){if(held.get(capture.source)===capture)held.delete(capture.source);},
        activation(pointer:boolean,pointerId?:number):({kind:'direct'}|{kind:'physical';binding:ActivationBinding}|{kind:'blocked'}){
            const captures=[...held.values()];
            // detail=0 can be keyboard default action OR AT. Any pending down
            // owns that default action through release; it cannot become AT.
            const pointers=captures.filter(value=>value.source.startsWith('pointer:'));
            const capture=pointer?(pointerId===undefined?(pointers.length===1?pointers[0]:undefined):held.get(`pointer:${pointerId}`)):captures.filter(value=>!value.abandoned).at(-1);
            if(!capture)return pointer?{kind:'blocked'}:{kind:'direct'};
            if(capture.cancelled||capture.consumed)return {kind:'blocked'};
            capture.consumed=true;return {kind:'physical',binding:{frameId:capture.frameId,nodeId:capture.nodeId}};
        },
        clear(){held.clear();}
    };
}
