import type { Line } from '@bos/shared';
/** The quotation/invoice being edited, so the assistant can check it against pricing policy. */
export const editorStore: { lines: Line[] } = { lines: [] };
