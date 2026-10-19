import {ownDisclosureDocument} from './disclosures';
import type {DisclosureDocument} from './disclosureTypes';
/** A settled public overview is one complete readonly matrix, never an archive,
 * executable scene, or arbitrary stack of disclosure sections. */
export function ownOutcomeOverview(input:DisclosureDocument):DisclosureDocument{
 const value=ownDisclosureDocument(input);
 if(value.sections.length!==1||value.sections[0].kind!=='matrix')throw Error('Invalid outcome overview matrix');
 const matrix=value.sections[0],people=new Set(value.roster.map(person=>person.id));
 if(matrix.rows.length!==value.roster.length||new Set(matrix.rows.map(row=>row.personId)).size!==people.size||matrix.rows.some(row=>!people.has(row.personId)||row.cells.length!==matrix.columns.length))throw Error('Incomplete outcome overview roster');
 const referenced=new Set(matrix.rows.flatMap(row=>row.cells.flatMap(cell=>cell?[cell.cardId]:[])));
 if(value.cards.some(card=>!referenced.has(card.id)))throw Error('Unreferenced outcome overview artwork');
 return value;
}
