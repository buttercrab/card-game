let cloneSequence=0;
/** Cloned SVG defs must survive source removal without duplicate document IDs. */
export function cloneTransferArtwork(source:SVGSVGElement):SVGSVGElement {
    const clone=source.cloneNode(true) as SVGSVGElement;
    const prefix=`foundation-flight-${++cloneSequence}-`;
    const ids=new Map<string,string>();
    for(const element of [clone,...clone.querySelectorAll('[id]')]){
        if(element.id){const id=element.id;ids.set(id,prefix+id);element.id=prefix+id;}
    }
    for(const element of [clone,...clone.querySelectorAll('*')]){
        for(const attribute of Array.from(element.attributes)){
            let value=attribute.value;
            for(const [oldId,newId] of ids){
                value=value.replaceAll(`url(#${oldId})`,`url(#${newId})`);
                if((attribute.localName==='href')&&value===`#${oldId}`)value=`#${newId}`;
            }
            if(value!==attribute.value)element.setAttributeNS(attribute.namespaceURI,attribute.name,value);
        }
    }
    return clone;
}
