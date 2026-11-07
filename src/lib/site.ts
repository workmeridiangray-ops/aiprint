export const SITE_PAGES = ['/', '/software', '/services', '/how-it-works', '/plans', '/pricing', '/faq', '/contact', '/terms', '/privacy', '/refund-policy', '/acceptable-use'] as const;
// Facts below are enforced by the application (see src/server/*); keep them in sync with the limits there.
export const FACTS = { formats: 'JPG and PNG', maxMb: 25, maxMp: 40, maxSideMm: 500, maxOutputMp: 80, outputs: 'PNG, JPG, TIFF and a single flattened PDF page (RGB)', quoteMinutes: 15, retentionDays: 90, warnDays: 7 };
export const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
