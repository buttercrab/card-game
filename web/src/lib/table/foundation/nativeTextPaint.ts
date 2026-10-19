interface TextContainer<Child extends {readonly nodeType:number}> {
    readonly childNodes:ArrayLike<Child>;
    textContent:string|null;
    removeChild(child:Child):unknown;
}

/** Planned child elements own their text; retire only a prior direct label. */
export function paintNativeTextContent<Child extends {readonly nodeType:number}>(element:TextContainer<Child>,label:string,paintChildren=false):void {
    if(paintChildren){
        // Snapshot the live NodeList so adjacent text nodes are all removed.
        for(const child of Array.from(element.childNodes))if(child.nodeType===3)element.removeChild(child);
    }else if(element.textContent!==label)element.textContent=label;
}
