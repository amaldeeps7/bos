// GST: place of supply decides CGST+SGST (same state) or IGST (different state).

export const STATE_CODES: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
  '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '18': 'Assam',
  '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '32': 'Kerala', '33': 'Tamil Nadu',
  '34': 'Puducherry', '36': 'Telangana', '37': 'Andhra Pradesh',
};

export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const stateOf = (gstin: string): string | undefined => STATE_CODES[String(gstin || '').slice(0, 2)];
export const isValidGstin = (g: string): boolean => GSTIN_RE.test(String(g || '').toUpperCase()) && !!stateOf(g);

export interface Line { d: string; qty: number | string; unit: string; rate: number | string; disc: number | string; sac: string }
export interface CalcRow extends Line { gross: number; discAmt: number; taxable: number; tax: number; taxRate: number; total: number }
export interface Calc {
  rows: CalcRow[]; sub: number; disc: number; taxable: number; tax: number; intra: boolean; grand: number; maxDisc: number;
  taxRows: [string, number][];
}

/** Line, discount and tax maths. `sacRates` maps SAC code to GST %; unknown codes charge 18%. */
export function calc(lines: Line[], customerState: string | undefined, ourState: string | undefined, sacRates: Record<string, number> = {}): Calc {
  let sub = 0, disc = 0, taxable = 0, tax = 0; const byRate: Record<number, number> = {};
  const rows = lines.map(l => {
    const g = Math.round((+l.qty || 0) * (+l.rate || 0)); const da = Math.round(g * (+l.disc || 0) / 100); const tx = g - da;
    const tr = sacRates[l.sac] ?? 18; const t = Math.round(tx * tr / 100);
    sub += g; disc += da; taxable += tx; tax += t; byRate[tr] = (byRate[tr] || 0) + t;
    return { ...l, gross: g, discAmt: da, taxable: tx, tax: t, taxRate: tr, total: tx + t };
  });
  const intra = !!customerState && customerState === ourState;
  const taxRows = Object.keys(byRate).map(Number).filter(r => r > 0).sort((a, b) => a - b).flatMap(r => {
    const v = byRate[r]; const h = Math.round(v / 2);
    return intra ? [[`CGST ${r / 2}%`, h], [`SGST ${r / 2}%`, v - h]] as [string, number][] : [[`IGST ${r}%`, v]] as [string, number][];
  });
  return { rows, sub, disc, taxable, tax, intra, grand: taxable + tax, maxDisc: Math.max(0, ...lines.map(l => +l.disc || 0)), taxRows };
}

export const gstText = (intra: boolean) => (intra ? 'CGST 9% + SGST 9%' : 'IGST 18%');
