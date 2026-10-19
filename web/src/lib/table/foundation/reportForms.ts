import { copyFormData, validateFormOffer, validateFormValues, type FormOffer, type HostFormPolicy, type FormStatus, type FormSubmission, type FormValues } from './forms';

export interface ReportFormOptions { readonly roomId: string; readonly actorId: string; readonly seat: number | null; readonly reportMax: number; readonly instanceId?: string; }
export interface ReportMetadata { readonly ua: string; readonly screen: string; readonly path: string; readonly standalone: boolean; }
export type ReportFetcher = (url: string, init: RequestInit) => Promise<{ readonly status: number }>;
export type ReportOutcome = Extract<FormStatus, 'processed' | 'rejected' | 'uncertain'>;
export const REPORT_POLICY_ID = 'report:v1';
export const REPORT_TEXT_FIELD = 'report:text';

export function reportFormOffer(options: ReportFormOptions): FormOffer<never> {
    const { roomId, actorId, seat, reportMax, instanceId } = options;
    if (!roomId || roomId.length > 128 || !actorId || actorId.length > 128 || !(seat === null || Number.isSafeInteger(seat) && seat >= 0 && seat <= 255) ||
        !Number.isSafeInteger(reportMax) || reportMax < 1 || reportMax > 8192) throw new Error('Invalid report form scope');
    return validateFormOffer<never>({
        target: { kind: 'host' }, id: 'report', instanceId: instanceId ?? JSON.stringify([roomId, actorId]), schemaVersion: '1', policyId: REPORT_POLICY_ID,
        baseVersion: '1', editBinding: JSON.stringify([roomId, actorId, seat]), title: '문제 신고',
        help: '무엇이 이상했는지 적어 주세요. 이 테이블의 지금 판 기록이 함께 가요.', submitLabel: '보내기', enabled: true,
        fields: [{ id: REPORT_TEXT_FIELD, label: '문제 설명', kind: 'multiline', maxCodePoints: reportMax, maxCodeUnits: reportMax * 2, required: true, initial: '' }],
        binding: { roomId, actorId, seat, reportMax },
    });
}
function requireReport(offer: FormOffer): FormOffer {
    const owned = validateFormOffer(offer);
    if (owned.id !== 'report' || owned.policyId !== REPORT_POLICY_ID || owned.schemaVersion !== '1' || owned.fields.length !== 1 || owned.fields[0].id !== REPORT_TEXT_FIELD || owned.fields[0].kind !== 'multiline') throw new Error('Invalid report policy offer');
    return owned;
}
export const REPORT_POLICY: HostFormPolicy = Object.freeze({
    id: REPORT_POLICY_ID,
    normalize(offer: FormOffer, raw: FormValues) {
        const owned = requireReport(offer);
        // Structural validation must happen before string normalization; length errors remain visible.
        const source = copyFormData(raw);
        validateFormValues(owned, source);
        const text = source[REPORT_TEXT_FIELD];
        if (text !== undefined && typeof text !== 'string') throw new Error('Invalid report text');
        const values = Object.freeze({ [REPORT_TEXT_FIELD]: text?.trim() ?? '' });
        return Object.freeze({ values, issues: validateFormValues(owned, values) });
    },
    compile(offer: FormOffer, raw: FormValues) {
        const owned = requireReport(offer);
        const values = copyFormData(raw);
        const issues = validateFormValues(owned, values);
        const text = values[REPORT_TEXT_FIELD];
        if (Object.keys(issues).length || typeof text !== 'string' || !text.trim() || text !== text.trim()) throw new Error('Report draft is not normalized and valid');
        return Object.freeze({ text });
    },
});

function boundedMetadata(input: ReportMetadata): ReportMetadata {
    const metadata = copyFormData(input);
    if (!metadata || Array.isArray(metadata) || Object.keys(metadata).length !== 4 || Object.keys(metadata).some(key => !['ua','screen','path','standalone'].includes(key)) ||
        typeof metadata.ua !== 'string' || typeof metadata.screen !== 'string' || typeof metadata.path !== 'string' || typeof metadata.standalone !== 'boolean') throw new Error('Invalid report metadata');
    // Metadata is diagnostic context, never an endpoint or submission authority.
    return Object.freeze({ ua: metadata.ua.slice(0, 1024), screen: metadata.screen.slice(0, 128), path: metadata.path.slice(0, 2048), standalone: metadata.standalone });
}
/** One attempt only. A 204 confirms processing, not durable storage; ambiguity never retries. */
export async function sendReport(submission: FormSubmission, fetcher: ReportFetcher, metadata: ReportMetadata): Promise<ReportOutcome> {
    let body: string;
    try {
        const owned = copyFormData(submission);
        const binding = owned.binding;
        if (owned.policyId !== REPORT_POLICY_ID || !binding || Object.keys(binding).length !== 4 || Object.keys(binding).some(key => !['roomId','actorId','seat','reportMax'].includes(key)) ||
            typeof binding.roomId !== 'string' || typeof binding.actorId !== 'string' || typeof binding.reportMax !== 'number' || !(binding.seat === null || typeof binding.seat === 'number') ||
            !owned.payload || typeof owned.payload !== 'object' || Array.isArray(owned.payload) || Object.keys(owned.payload).length !== 1 || !('text' in owned.payload) || typeof owned.payload.text !== 'string') throw new Error('Invalid report submission');
        const offer = reportFormOffer({ roomId: binding.roomId, actorId: binding.actorId, seat: binding.seat, reportMax: binding.reportMax });
        const payload = REPORT_POLICY.compile(offer, { [REPORT_TEXT_FIELD]: owned.payload.text });
        body = JSON.stringify({ text: payload.text, room: binding.roomId, seat: binding.seat, client: boundedMetadata(metadata) });
    } catch { return 'rejected'; }
    try {
        const response = await fetcher('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
        if (response.status === 204) return 'processed';
        if (response.status === 400 || response.status === 429) return 'rejected';
        return 'uncertain';
    } catch { return 'uncertain'; }
}
