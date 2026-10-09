// Amounts in words, Indian style (lakh, crore), as printed on GST invoices.
const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

const two = (n: number) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : ''));
const three = (n: number) => { const h = Math.floor(n / 100), r = n % 100; return [h ? ONES[h] + ' hundred' : '', r ? two(r) : ''].filter(Boolean).join(' '); };

export function inWords(n: number): string {
  n = Math.floor(Math.abs(n));
  if (!n) return 'zero';
  const crore = Math.floor(n / 1e7), lakh = Math.floor((n % 1e7) / 1e5), thousand = Math.floor((n % 1e5) / 1e3), rest = n % 1000;
  return [crore ? `${crore >= 100 ? inWords(crore) : two(crore)} crore` : '', lakh ? `${two(lakh)} lakh` : '', thousand ? `${two(thousand)} thousand` : '', rest ? three(rest) : ''].filter(Boolean).join(' ');
}

/** "Rupees three lakh seventy-seven thousand six hundred only" */
export const rupeesInWords = (n: number): string => { const w = inWords(n); return `Rupees ${w}${Math.round((n % 1) * 100) ? ` and ${two(Math.round((n % 1) * 100))} paise` : ''} only`; };
