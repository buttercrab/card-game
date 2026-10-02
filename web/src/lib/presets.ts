// House rules the server knows, by id, in the order players pick them.
export const PRESETS: { id: string; name: string; note?: string }[] = [
  { id: 'gshs', name: '경기과고', note: '조커 두 장' },
  { id: 'default', name: '기본' },
  { id: 'ddshs', name: '대구동신과고' },
  { id: 'dshs', name: '대구과고' },
  { id: 'kmla', name: '민사고' },
  { id: 'gsa', name: '광주과고' },
  { id: 'skku', name: '성균관대' },
  { id: 'sshs', name: '서울과고' },
  { id: 'yonsei', name: '연세대' },
];

export const PRESET_NAME: Record<string, string> = Object.fromEntries(PRESETS.map((p) => [p.id, p.name]));
